/**
 * One-signature READ sessions.
 *
 * A wallet signs `auth.session` once (via verifyWalletActionSignature — single
 * use nonce, TTL and replay protection unchanged) and receives a short,
 * stateless, HMAC-SHA256 signed bearer token with scope `read`. The token lets
 * the holder perform PRIVATE READS for its own address (`sub`) without a fresh
 * wallet signature per request.
 *
 * SECURITY INVARIANTS
 * - The token only ever authorizes reads routed through `verifyWalletReadAccess`.
 *   It is never consulted by `verifyWalletActionSignature`, order signatures or
 *   any fund-moving / state-changing path.
 * - `sub` must equal the requested address exactly (case-sensitive SS58).
 * - Tokens are revocable by `sid` until they expire (Redis + in-memory fallback).
 * - Legacy per-request signed reads keep working unchanged when no bearer is sent.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { getRedis } from '../utils/redis';
import { log } from '../utils/logger';
import { verifyWalletReadSignature } from './auth';

export const READ_SESSION_TOKEN_PREFIX = 'lxs1';
export const READ_SESSION_SCOPE = 'read';
export const READ_SESSION_ACTION = 'auth.session';

export type ReadSessionClaims = {
  v: 1;
  sub: string;
  scope: typeof READ_SESSION_SCOPE;
  /** Issued at — unix seconds. */
  iat: number;
  /** Expires at — unix seconds. */
  exp: number;
  sid: string;
};

type ReadSessionState =
  | { status: 'none' }
  | { status: 'valid'; claims: ReadSessionClaims }
  | { status: 'invalid'; reason: string };

type VerifyTokenResult =
  { ok: true; claims: ReadSessionClaims } | { ok: false; reason: string };

// ─── Secret handling ─────────────────────────────────────────────

let ephemeralSecret: string | null = null;

function getSessionSecret(): string {
  if (config.session.secret) return config.session.secret;
  if (config.isProd) {
    // Production boot is aborted by collectProductionConfigErrors before we
    // ever get here; fail closed regardless.
    throw new Error('SESSION_SECRET is required in production');
  }
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(48).toString('hex');
    log.warn(
      '[SECURITY] SESSION_SECRET not set — using a random per-process secret (read sessions reset on restart)',
    );
  }
  return ephemeralSecret;
}

// ─── Token encode / verify ───────────────────────────────────────

function hmac(input: string) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(input)
    .digest('base64url');
}

const ClaimsSchema = z
  .object({
    v: z.literal(1),
    sub: z.string().min(8).max(128),
    scope: z.literal(READ_SESSION_SCOPE),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
    sid: z.string().min(16).max(64),
  })
  .strict();

export function issueReadSessionToken(
  address: string,
  nowMs = Date.now(),
): { token: string; claims: ReadSessionClaims } {
  const iat = Math.floor(nowMs / 1000);
  const claims: ReadSessionClaims = {
    v: 1,
    sub: address,
    scope: READ_SESSION_SCOPE,
    iat,
    exp: iat + config.session.ttlSeconds,
    sid: crypto.randomBytes(16).toString('hex'),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${READ_SESSION_TOKEN_PREFIX}.${payload}`;
  return { token: `${signingInput}.${hmac(signingInput)}`, claims };
}

export function verifyReadSessionToken(
  token: string,
  nowMs = Date.now(),
): VerifyTokenResult {
  if (token.length > 1024) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== READ_SESSION_TOKEN_PREFIX) {
    return { ok: false, reason: 'malformed' };
  }
  const [prefix, payload, signature] = parts;

  const expected = Buffer.from(hmac(`${prefix}.${payload}`));
  const provided = Buffer.from(signature);
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = ClaimsSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, reason: 'bad_claims' };

  const claims = parsed.data as ReadSessionClaims;
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.exp <= nowSec) return { ok: false, reason: 'expired' };
  if (claims.iat > nowSec + 60) return { ok: false, reason: 'not_yet_valid' };
  if (claims.exp - claims.iat > config.session.ttlSeconds) {
    return { ok: false, reason: 'bad_claims' };
  }
  return { ok: true, claims };
}

// ─── Revocation store (Redis with in-memory fallback) ────────────

const fallbackRevoked = new Map<string, number>();

function revokedKey(sid: string) {
  return `session:revoked:${sid}`;
}

function pruneRevokedFallback(nowMs: number) {
  for (const [sid, expiresAt] of fallbackRevoked.entries()) {
    if (expiresAt <= nowMs) fallbackRevoked.delete(sid);
  }
}

type RevocationState = 'revoked' | 'active' | 'unavailable';

async function getRevocationState(sid: string): Promise<RevocationState> {
  // In-memory first: covers revocations recorded during a Redis outage.
  const local = fallbackRevoked.get(sid);
  if (local !== undefined && local > Date.now()) return 'revoked';
  try {
    const result = await getRedis().get(revokedKey(sid));
    return result !== null ? 'revoked' : 'active';
  } catch {
    return config.isProd ? 'unavailable' : 'active';
  }
}

export async function revokeReadSession(claims: ReadSessionClaims) {
  const nowMs = Date.now();
  const ttlSeconds = Math.max(1, claims.exp - Math.floor(nowMs / 1000));
  pruneRevokedFallback(nowMs);
  // Always record locally so revocation is effective even if Redis is down.
  fallbackRevoked.set(claims.sid, claims.exp * 1000);
  try {
    await getRedis().set(revokedKey(claims.sid), '1', 'EX', ttlSeconds);
  } catch {
    log.error(
      { sid: claims.sid, address: claims.sub },
      '[SECURITY] Redis unavailable while revoking read session — recorded in memory only',
    );
  }
  log.info(
    { sid: claims.sid, address: claims.sub },
    '[SECURITY] Read session revoked',
  );
}

// ─── Request state ───────────────────────────────────────────────

const requestState = new WeakMap<Request, ReadSessionState>();

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  // Only our own token format — admin / agent bearer secrets are ignored here.
  return match[1].startsWith(`${READ_SESSION_TOKEN_PREFIX}.`) ? match[1] : null;
}

export async function resolveReadSession(
  req: Request,
): Promise<ReadSessionState> {
  const cached = requestState.get(req);
  if (cached) return cached;

  let state: ReadSessionState = { status: 'none' };
  const token = extractBearer(req);
  if (token) {
    const verified = verifyReadSessionToken(token);
    if (!verified.ok) {
      log.warn(
        { reason: verified.reason, path: req.path },
        '[SECURITY] Read session token rejected',
      );
      state = { status: 'invalid', reason: verified.reason };
    } else {
      const revocation = await getRevocationState(verified.claims.sid);
      if (revocation === 'active') {
        state = { status: 'valid', claims: verified.claims };
      } else {
        log.warn(
          {
            reason: revocation,
            sid: verified.claims.sid,
            address: verified.claims.sub,
            path: req.path,
          },
          revocation === 'revoked'
            ? '[SECURITY] Read session token rejected — revoked'
            : '[SECURITY] Read session token rejected — revocation store unavailable',
        );
        state = { status: 'invalid', reason: revocation };
      }
    }
  }

  requestState.set(req, state);
  return state;
}

export function getReadSessionState(req: Request): ReadSessionState {
  return requestState.get(req) ?? { status: 'none' };
}

/**
 * Annotates the request with its read-session state. Never rejects: routes
 * decide (via `verifyWalletReadAccess`) whether the session is acceptable.
 */
export function attachReadSession() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await resolveReadSession(req);
      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}

// ─── Route helpers ───────────────────────────────────────────────

type SignedReadShape = z.ZodRawShape & {
  nonce: z.ZodTypeAny;
  timestamp: z.ZodTypeAny;
  signature: z.ZodTypeAny;
};

/**
 * Returns the schema to validate a signed READ request with. When the request
 * presents a read-session bearer the signature fields become optional (the
 * session itself is then checked by `verifyWalletReadAccess`, which rejects
 * with 401 unless the session is valid for the address or a full legacy
 * signature is also present). Without a bearer the strict (legacy) schema is
 * returned unchanged.
 */
export function readAuthSchema<T extends SignedReadShape>(
  req: Request,
  schema: z.ZodObject<T>,
) {
  const relaxed = schema.extend({
    nonce: schema.shape.nonce.optional() as z.ZodOptional<T['nonce']>,
    timestamp: schema.shape.timestamp.optional() as z.ZodOptional<
      T['timestamp']
    >,
    signature: schema.shape.signature.optional() as z.ZodOptional<
      T['signature']
    >,
  });
  return getReadSessionState(req).status !== 'none'
    ? relaxed
    : (schema as unknown as typeof relaxed);
}

type ReadAccessInput = {
  action: string;
  address: string;
  nonce?: string;
  timestamp?: number | string;
  signature?: string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
};

/**
 * Authorizes a PRIVATE READ for `address`, either via a valid read session
 * bound to that address or via the legacy per-request wallet signature.
 * MUST NOT be used for state-changing routes.
 */
export async function verifyWalletReadAccess(
  req: Request,
  input: ReadAccessInput,
) {
  const state = await resolveReadSession(req);
  const hasSignature =
    typeof input.nonce === 'string' &&
    input.timestamp !== undefined &&
    typeof input.signature === 'string';

  if (state.status === 'valid') {
    if (state.claims.sub === input.address) {
      return { ok: true as const, via: 'session' as const };
    }
    log.warn(
      {
        sessionAddress: state.claims.sub,
        address: input.address,
        action: input.action,
        sid: state.claims.sid,
      },
      '[SECURITY] Read session rejected — address mismatch',
    );
    if (!hasSignature) {
      return {
        ok: false as const,
        error: 'Session not valid for this address',
      };
    }
  } else if (state.status === 'invalid' && !hasSignature) {
    return { ok: false as const, error: 'Invalid or expired session' };
  }

  if (!hasSignature) {
    return { ok: false as const, error: 'Missing signature' };
  }

  const result = await verifyWalletReadSignature({
    action: input.action,
    address: input.address,
    nonce: input.nonce as string,
    timestamp: input.timestamp as number | string,
    signature: input.signature as string,
    fields: input.fields,
  });
  return result.ok
    ? { ok: true as const, via: 'signature' as const }
    : { ok: false as const, error: result.error };
}

/** Test-only: reset in-memory state. */
export function __resetReadSessionStateForTests() {
  fallbackRevoked.clear();
  ephemeralSecret = null;
}
