import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { CorsOptions } from 'cors';
import type { HelmetOptions } from 'helmet';

/**
 * Security headers for a JSON API. Nothing served here is meant to render
 * as a document, so CSP denies everything and framing is forbidden.
 * HSTS only in production (TLS terminates at nginx in front of the API).
 */
export function buildHelmetOptions(isProd: boolean): HelmetOptions {
  return {
    hsts: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Token logos (/tokens) are loaded cross-origin by the DEX UI.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/**
 * CORS: production uses the explicit allowlist; development reflects any
 * origin for local DX. Credentials are never enabled — the API authenticates
 * with signatures / bearer headers, not cookies — so a reflected origin can
 * never be combined with `Access-Control-Allow-Credentials: true`.
 */
export function buildCorsOptions(input: {
  isProd: boolean;
  allowedOrigins: string[];
}): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (!input.isProd) return callback(null, true);
      // No Origin (server-to-server, CLI, MCP): strict routes are enforced
      // separately in index.ts.
      if (!origin) return callback(null, true);
      if (input.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('CORS: origin not allowed'));
    },
    credentials: false,
    maxAge: 86400,
  };
}

/**
 * Production HTTPS enforcement. The redirect target is the configured
 * canonical origin — never the client-supplied Host header (open redirect /
 * host header injection, BE-22). Non-idempotent methods are refused instead
 * of redirected (a 301 would silently replay them as GET).
 */
export function createHttpsEnforcer(publicApiOrigin: string): RequestHandler {
  let origin: string | null = null;
  try {
    const url = new URL(publicApiOrigin);
    if (url.protocol === 'https:') origin = url.origin;
  } catch {
    origin = null;
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['x-forwarded-proto'] === 'https') return next();
    if (!origin || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return res
        .status(400)
        .json({ error: 'HTTPS required', code: 'HTTPS_REQUIRED' });
    }
    const target = new URL(req.originalUrl || '/', origin);
    if (target.origin !== origin) {
      return res
        .status(400)
        .json({ error: 'HTTPS required', code: 'HTTPS_REQUIRED' });
    }
    return res.redirect(301, `${origin}${target.pathname}${target.search}`);
  };
}
