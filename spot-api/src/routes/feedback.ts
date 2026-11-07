/**
 * Beta feedback + client error telemetry (P0-10) — self-hosted path that
 * keeps working when the frontend's console is stripped in production.
 *
 *   POST /api/v1/feedback                  anonymous bug report / feedback
 *   POST /api/v1/telemetry/client-errors   frontend error report (deduplicated)
 *   GET  /api/v1/feedback                  admin (requireAdmin)
 *   GET  /api/v1/telemetry/client-errors   admin (requireAdmin)
 *
 * Privacy: no IP or e-mail is stored. The wallet address is only kept when
 * the tester explicitly attaches it to a feedback report; ss58 addresses in
 * error messages/stacks are scrubbed server-side as defence in depth.
 *
 * Mounted at `/api/v1` (routes are absolute below that prefix).
 */

import crypto from 'crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import prisma from '../db';
import { requireAdmin } from '../middleware/adminGuard';
import { checkRedisRateLimit } from '../utils/redisRateLimit';
import { log } from '../utils/logger';

const router = Router();

export const FEEDBACK_CATEGORIES = [
  'BUG',
  'UX',
  'FEATURE',
  'FAUCET',
  'OTHER',
] as const;
export const CLIENT_ERROR_SOURCES = [
  'boundary',
  'window',
  'unhandledrejection',
  'manual',
] as const;

const FEEDBACK_RATE = { limit: 10, windowMs: 60 * 60 * 1000 }; // 10 / hour / IP
const ERROR_RATE = { limit: 60, windowMs: 10 * 60 * 1000 }; // 60 / 10 min / IP

const SS58_RE = /\b[1-9A-HJ-NP-Za-km-z]{47,48}\b/g;
const SS58_STRICT = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;

const truncated = (max: number) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .optional();

const scrubAddresses = (s: string) => s.replace(SS58_RE, '[address]');

const commonContext = {
  page: z.string().trim().max(300).optional(),
  userAgent: truncated(300),
  appVersion: z.string().trim().max(64).optional(),
  network: z.string().trim().max(32).optional(),
};

const FeedbackSchema = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES),
    message: z.string().trim().min(5).max(4000),
    walletAddress: z.string().trim().regex(SS58_STRICT).optional(),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    ...commonContext,
  })
  .strict();

const ClientErrorSchema = z
  .object({
    source: z.enum(CLIENT_ERROR_SOURCES),
    message: z
      .string()
      .min(1)
      .transform((s) => s.slice(0, 1000)),
    stack: truncated(4000),
    /** Occurrences aggregated client-side since the last report. */
    count: z.coerce.number().int().min(1).max(1000).default(1),
    ...commonContext,
  })
  .strict();

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 200)),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
});

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function rateLimited(
  req: Request,
  res: Response,
  bucket: string,
  rate: { limit: number; windowMs: number },
): Promise<boolean> {
  const result = await checkRedisRateLimit({
    key: `rl:${bucket}:${clientKey(req)}`,
    ...rate,
  });
  if (result.allowed) return false;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
  return true;
}

function validationError(res: Response, error: z.ZodError) {
  return res.status(400).json({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** Stable fingerprint: source + normalized message + first stack frame. */
export function fingerprintClientError(source: string, message: string, stack?: string): string {
  const normMessage = message
    .replace(/0x[0-9a-fA-F]+/g, '0x')
    .replace(/\d+/g, '0')
    .slice(0, 300);
  const firstFrame = (stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || l.includes('@')) || '';
  return crypto
    .createHash('sha256')
    .update(`${source}|${normMessage}|${firstFrame.replace(/:\d+:\d+/g, '')}`)
    .digest('hex')
    .slice(0, 32);
}

router.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (await rateLimited(req, res, 'feedback', FEEDBACK_RATE)) return;
    const parsed = FeedbackSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const d = parsed.data;
    const created = await prisma.clientFeedback.create({
      data: {
        category: d.category,
        message: d.message,
        walletAddress: d.walletAddress ?? null,
        txHash: d.txHash ?? null,
        page: d.page ?? null,
        userAgent: d.userAgent ?? ((req.get('user-agent') || '').slice(0, 300) || null),
        appVersion: d.appVersion ?? null,
        network: d.network ?? null,
      },
    });
    log.info({ id: created.id, category: d.category }, '[Feedback] report received');
    res.status(201).json({ id: created.id });
  } catch (err: unknown) {
    next(err);
  }
});

router.post(
  '/telemetry/client-errors',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (await rateLimited(req, res, 'client-errors', ERROR_RATE)) return;
      const parsed = ClientErrorSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed.error);
      const d = parsed.data;
      const message = scrubAddresses(d.message);
      const stack = d.stack ? scrubAddresses(d.stack) : null;
      const appVersion = d.appVersion ?? '';
      const fingerprint = fingerprintClientError(d.source, message, stack ?? undefined);
      const now = new Date();
      await prisma.clientError.upsert({
        where: { fingerprint_appVersion: { fingerprint, appVersion } },
        create: {
          fingerprint,
          appVersion,
          source: d.source,
          message,
          stack,
          page: d.page ?? null,
          userAgent: d.userAgent ?? null,
          network: d.network ?? null,
          count: d.count,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          count: { increment: d.count },
          lastSeenAt: now,
          page: d.page ?? undefined,
        },
      });
      res.status(202).json({ ok: true });
    } catch (err: unknown) {
      next(err);
    }
  },
);

router.get('/feedback', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error);
    const items = await prisma.clientFeedback.findMany({
      where: parsed.data.category ? { category: parsed.data.category } : {},
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
    });
    res.json({ items });
  } catch (err: unknown) {
    next(err);
  }
});

router.get(
  '/telemetry/client-errors',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ListQuery.omit({ category: true }).safeParse(req.query);
      if (!parsed.success) return validationError(res, parsed.error);
      const items = await prisma.clientError.findMany({
        orderBy: { lastSeenAt: 'desc' },
        take: parsed.data.limit,
      });
      res.json({ items });
    } catch (err: unknown) {
      next(err);
    }
  },
);

export default router;
