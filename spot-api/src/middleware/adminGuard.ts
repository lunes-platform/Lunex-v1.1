import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { config } from '../config'
import { log } from '../utils/logger'

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
  const secret = config.adminSecret
  if (!secret) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth attempt but ADMIN_SECRET is not configured',
    )
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (!token) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth attempt with missing token',
    )
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Constant-time comparison to prevent timing-based side-channel attacks
  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    log.warn(
      { ip: req.ip, endpoint: req.originalUrl },
      '[SECURITY] Admin auth failed — invalid token',
    )
    return res.status(401).json({ error: 'Unauthorized' })
  }

  next()
}
