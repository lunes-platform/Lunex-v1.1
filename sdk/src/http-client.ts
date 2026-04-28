import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosInstance,
  AxiosRequestConfig,
} from 'axios';
import { LunexConfig, ApiResponse, ApiError } from './types';

type HttpRequestOptions = {
  apiKey?: string;
  headers?: Record<string, string>;
  omitAuth?: boolean;
};

type AxiosConfigWithLunexOptions = AxiosRequestConfig & {
  lunexOptions?: HttpRequestOptions;
  /** Internal: tracks how many times this request has been retried. */
  _lunexRetryCount?: number;
};

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;

function computeRetryDelayMs(
  attempt: number,
  retryAfterHeader: string | undefined,
): number {
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed * 1000, RETRY_MAX_DELAY_MS);
    }
  }
  // Exponential backoff with ±20% jitter.
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.min(Math.max(base + jitter, 0), RETRY_MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  private instance: AxiosInstance;
  private authToken: string | null = null;
  private apiKey: string | null = null;

  constructor(config: LunexConfig) {
    this.apiKey = config.apiKey || null;

    this.instance = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.instance.interceptors.request.use(
      (config) => {
        const lunexOptions = (config as AxiosConfigWithLunexOptions)
          .lunexOptions;
        const effectiveApiKey = lunexOptions?.apiKey || this.apiKey;
        const headers = AxiosHeaders.from(config.headers || {});

        Object.entries(lunexOptions?.headers || {}).forEach(([key, value]) => {
          headers.set(key, value);
        });

        if (this.authToken && !lunexOptions?.omitAuth) {
          headers.set('Authorization', `Bearer ${this.authToken}`);
        }

        if (effectiveApiKey) {
          headers.set('x-api-key', effectiveApiKey);
        }

        config.headers = headers;

        return config;
      },
      (error) => Promise.reject(error),
    );

    // Response interceptor — retries transient failures (429/502/503/504,
    // network resets, timeouts) with exponential backoff + jitter. Honours
    // `Retry-After` header on 429. Non-transient errors and 4xx other than
    // 429 are surfaced immediately.
    this.instance.interceptors.response.use(
      (response) => response.data,
      async (error: AxiosError<ApiError>) => {
        const config = error.config as AxiosConfigWithLunexOptions | undefined;
        if (!config) return Promise.reject(this.handleError(error));

        const status = error.response?.status;
        const code = error.code;
        const isRetryableStatus =
          typeof status === 'number' && RETRYABLE_STATUS.has(status);
        const isRetryableNetwork =
          typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code);

        if (!isRetryableStatus && !isRetryableNetwork) {
          return Promise.reject(this.handleError(error));
        }

        const attempt = (config._lunexRetryCount ?? 0) + 1;
        if (attempt > MAX_RETRIES) {
          return Promise.reject(this.handleError(error));
        }

        config._lunexRetryCount = attempt;

        const retryAfter =
          (error.response?.headers?.['retry-after'] as string | undefined) ??
          undefined;
        const delayMs = computeRetryDelayMs(attempt, retryAfter);
        await sleep(delayMs);

        return this.instance.request(config);
      },
    );
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  clearAuthToken(): void {
    this.authToken = null;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  clearApiKey(): void {
    this.apiKey = null;
  }

  async get<T>(
    url: string,
    params?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await this.instance.get<any, unknown>(url, {
      params,
      lunexOptions: options,
    } as AxiosConfigWithLunexOptions);
    return this.unwrapResponse<T>(response);
  }

  async post<T>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await this.instance.post<any, unknown>(url, data, {
      lunexOptions: options,
    } as AxiosConfigWithLunexOptions);
    return this.unwrapResponse<T>(response);
  }

  async put<T>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await this.instance.put<any, unknown>(url, data, {
      lunexOptions: options,
    } as AxiosConfigWithLunexOptions);
    return this.unwrapResponse<T>(response);
  }

  async patch<T>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await this.instance.patch<any, unknown>(url, data, {
      lunexOptions: options,
    } as AxiosConfigWithLunexOptions);
    return this.unwrapResponse<T>(response);
  }

  async delete<T>(
    url: string,
    params?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await this.instance.delete<any, unknown>(url, {
      data: params,
      params,
      lunexOptions: options,
    } as AxiosConfigWithLunexOptions);
    return this.unwrapResponse<T>(response);
  }

  private handleError(error: AxiosError<ApiError>): Error {
    const responseData = error.response?.data as any;

    if (typeof responseData?.error === 'string') {
      const customError = new Error(responseData.error);
      (customError as any).details = responseData.details;
      (customError as any).statusCode = error.response?.status;
      return customError;
    }

    if (responseData?.error) {
      const apiError = responseData.error as ApiError['error'];
      const customError = new Error(apiError.message);
      (customError as any).code = apiError.code;
      (customError as any).details = apiError.details;
      (customError as any).statusCode = error.response?.status;
      return customError;
    }

    if (error.code === 'ECONNABORTED') {
      return new Error('Request timeout');
    }

    if (error.message === 'Network Error') {
      return new Error('Network connection failed');
    }

    return error;
  }

  private unwrapResponse<T>(response: unknown): T {
    if (
      response &&
      typeof response === 'object' &&
      'success' in response &&
      'data' in response
    ) {
      return (response as ApiResponse<T>).data;
    }

    return response as T;
  }
}
