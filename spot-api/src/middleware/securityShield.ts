import type { NextFunction, Request, Response } from 'express';
import { log } from '../utils/logger';

const MAX_QUERY_KEYS = 50;
const BLOCKED_PATH_PATTERNS = [
  /\.\.[/\\]/,
  /%2e%2e/i,
  /%00/i,
  /(?:^|[/\\])\.env(?:$|[/?#])/i,
  /(?:^|[/\\])\.git(?:$|[/?#])/i,
];

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function securityShield() {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawUrl = req.originalUrl || req.url;
    const decodedUrl = safeDecode(rawUrl);
    const queryKeyCount = Object.keys(req.query ?? {}).length;

    if (
      queryKeyCount > MAX_QUERY_KEYS ||
      BLOCKED_PATH_PATTERNS.some(
        (pattern) => pattern.test(rawUrl) || pattern.test(decodedUrl),
      )
    ) {
      log.warn(
        {
          ip: req.ip,
          method: req.method,
          path: req.path,
          queryKeyCount,
        },
        '[SECURITY] Request blocked by application shield',
      );
      return res.status(400).json({ error: 'Bad request' });
    }

    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()',
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
}
