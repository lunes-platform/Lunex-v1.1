/**
 * Read-session authentication.
 *
 * POST /api/v1/auth/session         — exchange ONE wallet signature
 *                                      (action "auth.session") for an 8h
 *                                      read-only bearer token.
 * POST /api/v1/auth/session/revoke  — revoke the presented bearer token.
 *
 * Read sessions never authorize state-changing or fund-moving actions.
 */
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { verifyWalletActionSignature } from '../middleware/auth';
import {
  READ_SESSION_ACTION,
  READ_SESSION_SCOPE,
  issueReadSessionToken,
  resolveReadSession,
  revokeReadSession,
} from '../middleware/readSession';
import { log } from '../utils/logger';

const router = Router();

const CreateSessionSchema = z.object({
  address: z.string().min(8).max(128),
  nonce: z.string().min(8).max(128),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8).max(256),
});

router.post(
  '/session',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { address, nonce, timestamp, signature } = parsed.data;
      const auth = await verifyWalletActionSignature({
        action: READ_SESSION_ACTION,
        address,
        nonce,
        timestamp,
        signature,
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const { token, claims } = issueReadSessionToken(address);
      log.info(
        { address, sid: claims.sid, exp: claims.exp },
        '[SECURITY] Read session issued',
      );
      return res.status(201).json({
        token,
        tokenType: 'Bearer',
        scope: READ_SESSION_SCOPE,
        expiresAt: claims.exp * 1000,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

router.post(
  '/session/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await resolveReadSession(req);
      if (state.status !== 'valid') {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      await revokeReadSession(state.claims);
      return res.json({ revoked: true });
    } catch (err: unknown) {
      next(err);
    }
  },
);

export default router;
