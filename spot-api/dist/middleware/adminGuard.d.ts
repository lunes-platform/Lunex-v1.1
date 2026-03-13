import { Request, Response, NextFunction } from 'express';
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
export declare function requireAdmin(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=adminGuard.d.ts.map