import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { log } from '../utils/logger';

function normalizeIp(rawIp: string | undefined) {
  if (!rawIp) return '';
  if (rawIp === '::1') return '127.0.0.1';
  if (rawIp.startsWith('::ffff:')) return rawIp.slice(7);
  return rawIp;
}

function isPrivateOrLoopbackIp(rawIp: string | undefined) {
  const ip = normalizeIp(rawIp);
  if (!ip) return false;

  if (ip === '127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  return false;
}

/**
 * Shared admin guard middleware.
 *
 * - Constant-time comparison via `crypto.timingSafeEqual` to prevent timing attacks.
 * - Structured security logging for failed attempts.
 * - Used exclusively for internal maintenance endpoints (listing activation,
 *   pair registration, reward triggers, etc.).
 *
 * ⚠️  MUST NEVER be used to bypass Web3 signature verification on trading endpoints.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = config.adminSecret;
  if (!secret) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth attempt but ADMIN_SECRET is not configured',
    );
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth attempt with missing token',
    );
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Constant-time comparison to prevent timing-based side-channel attacks
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);

  if (
    tokenBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(tokenBuf, secretBuf)
  ) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth failed — invalid token',
    );
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * Allows trusted internal scrape traffic without bearer token while keeping
 * external /metrics access protected by ADMIN_SECRET.
 *
 * Defence against `X-Forwarded-For` spoofing: even if `req.ip` resolves to a
 * private/loopback IP, refuse the bypass when ANY `X-Forwarded-For` header is
 * present — that means the request came through a proxy, which (in our
 * topology) only happens for external traffic. Internal scrapes go directly
 * api:4000 from the Docker network with no XFF header.
 */
export function requireAdminOrInternal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const hasForwardedHeader =
    Boolean(req.headers['x-forwarded-for']) ||
    Boolean(req.headers['x-forwarded-host']) ||
    Boolean(req.headers['forwarded']);

  if (!hasForwardedHeader && isPrivateOrLoopbackIp(req.ip)) {
    return next();
  }

  return requireAdmin(req, res, next);
}
