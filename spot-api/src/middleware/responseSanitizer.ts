import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

type JsonObject = Record<string, unknown>;

const ERROR_DETAIL_KEYS = new Set(['details', 'stack', 'trace']);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeErrorBody(body: JsonObject): JsonObject {
  const sanitized: JsonObject = {};

  for (const [key, value] of Object.entries(body)) {
    if (ERROR_DETAIL_KEYS.has(key)) continue;
    sanitized[key] = value;
  }

  return sanitized;
}

export function responseSanitizer({
  isProduction = config.isProd,
}: { isProduction?: boolean } = {}) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = ((body?: unknown) => {
      if (isProduction && res.statusCode >= 400 && isJsonObject(body)) {
        return originalJson(sanitizeErrorBody(body));
      }

      return originalJson(body);
    }) as Response['json'];

    next();
  };
}
