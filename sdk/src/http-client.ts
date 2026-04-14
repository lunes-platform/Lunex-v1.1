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
};

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

    // Response interceptor
    this.instance.interceptors.response.use(
      (response) => response.data,
      (error: AxiosError<ApiError>) => {
        return Promise.reject(this.handleError(error));
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
