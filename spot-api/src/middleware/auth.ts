import { cryptoWaitReady, signatureVerify } from '@polkadot/util-crypto';
import { getRedis } from '../utils/redis';
import { config } from '../config';
import { log } from '../utils/logger';

const SIGNED_ACTION_TTL_MS = 5 * 60 * 1000;

// ─── Redis-backed nonce store (with in-memory fallback) ──────────
const fallbackNonces = new Map<string, number>();

function pruneSignedActionNoncesFallback(now: number) {
  for (const [key, expiresAt] of fallbackNonces.entries()) {
    if (expiresAt <= now) fallbackNonces.delete(key);
  }
}

async function isNonceUsed(key: string): Promise<boolean> {
  // Always check in-memory fallback first — covers nonces written during a Redis
  // outage. Without this, a nonce stored in the fallback while Redis was down
  // would be invisible once Redis recovers, enabling replay attacks.
  if (fallbackNonces.has(key)) return true;
  try {
    const result = await getRedis().get(key);
    return result !== null;
  } catch {
    return false;
  }
}

async function markNonceUsed(key: string): Promise<void> {
  try {
    await getRedis().set(key, '1', 'EX', config.redis.nonceTtlSeconds);
  } catch {
    // Redis unavailable — fall back to in-memory
    pruneSignedActionNoncesFallback(Date.now());
    fallbackNonces.set(key, Date.now() + SIGNED_ACTION_TTL_MS);
  }
}

type SpotOrderMessageInput = {
  pairSymbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
  price?: string;
  stopPrice?: string;
  amount: string;
  nonce: string;
  /** Unix ms timestamp. Required for new orders; omit only when re-verifying legacy stored orders. */
  timestamp?: number;
};

export function buildSpotOrderMessage(input: SpotOrderMessageInput) {
  const base = `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${
    input.price || '0'
  }:${input.stopPrice || '0'}:${input.amount}:${input.nonce}`;
  return input.timestamp !== undefined ? `${base}:${input.timestamp}` : base;
}

export { isNonceUsed, markNonceUsed };

export function buildSpotCancelMessage(orderId: string) {
  return `lunex-cancel:${orderId}`;
}

function normalizeSignedValue(
  value: string | number | boolean | Array<string | number> | undefined | null,
) {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return value == null ? '' : String(value);
}

export function buildWalletActionMessage(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
}) {
  const lines = [`lunex-auth:${input.action}`, `address:${input.address}`];

  const orderedFields = Object.entries(input.fields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${normalizeSignedValue(value)}`);
  }

  lines.push(`nonce:${input.nonce}`);
  lines.push(`timestamp:${normalizeSignedValue(input.timestamp)}`);
  return lines.join('\n');
}

export async function verifyAddressSignature(
  message: string,
  signature: string,
  address: string,
) {
  await cryptoWaitReady();

  try {
    return signatureVerify(message, signature, address).isValid;
  } catch {
    return false;
  }
}

export async function verifyWalletActionSignature(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  signature: string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
}) {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_timestamp',
      },
      '[SECURITY] Wallet signature rejected',
    );
    return { ok: false as const, error: 'Invalid timestamp' };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > SIGNED_ACTION_TTL_MS) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'expired',
        drift: Math.abs(now - timestamp),
      },
      '[SECURITY] Wallet signature rejected — expired TTL',
    );
    return { ok: false as const, error: 'Expired signature' };
  }

  const replayKey = `nonce:${input.action}:${input.address}:${input.nonce}`;
  if (await isNonceUsed(replayKey)) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
        reason: 'replay',
      },
      '[SECURITY] Wallet signature rejected — nonce replay detected',
    );
    return { ok: false as const, error: 'Signature nonce already used' };
  }

  const message = buildWalletActionMessage({
    action: input.action,
    address: input.address,
    nonce: input.nonce,
    timestamp,
    fields: input.fields,
  });

  const isValid = await verifyAddressSignature(
    message,
    input.signature,
    input.address,
  );
  if (!isValid) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_signature',
      },
      '[SECURITY] Wallet signature rejected — sr25519 verification failed',
    );
    return { ok: false as const, error: 'Invalid signature' };
  }

  await markNonceUsed(replayKey);
  return { ok: true as const, message };
}

export async function verifyWalletReadSignature(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  signature: string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
}) {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_timestamp',
      },
      '[SECURITY] Wallet read signature rejected',
    );
    return { ok: false as const, error: 'Invalid timestamp' };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > SIGNED_ACTION_TTL_MS) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'expired',
        drift: Math.abs(now - timestamp),
      },
      '[SECURITY] Wallet read signature rejected — expired TTL',
    );
    return { ok: false as const, error: 'Expired signature' };
  }

  const message = buildWalletActionMessage({
    action: input.action,
    address: input.address,
    nonce: input.nonce,
    timestamp,
    fields: input.fields,
  });

  const isValid = await verifyAddressSignature(
    message,
    input.signature,
    input.address,
  );
  if (!isValid) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_signature',
      },
      '[SECURITY] Wallet read signature rejected — sr25519 verification failed',
    );
    return { ok: false as const, error: 'Invalid signature' };
  }

  return { ok: true as const, message };
}
