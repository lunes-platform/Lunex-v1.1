import { cryptoWaitReady, signatureVerify } from '@polkadot/util-crypto';
import { getRedis } from '../utils/redis';
import { config } from '../config';
import { log } from '../utils/logger';
import { walletRiskService } from '../services/walletRiskService';
import {
  accountAddressVariants,
  isSameAccount,
  toCanonicalAddress,
} from '../utils/validation';

const SIGNED_ACTION_TTL_MS = 5 * 60 * 1000;
// Max clock skew tolerated for timestamps in the future. A signed message is
// usable while |now - timestamp| <= TTL, so without this bound a payload
// stamped +5 min stays valid for 10 min.
const MAX_FUTURE_SKEW_MS = 60 * 1000;
/**
 * Nonces must outlive every instant at which their signature is still
 * accepted (first use can happen as early as timestamp - skew, last valid
 * instant is timestamp + TTL). 2 × TTL covers it with margin and cannot be
 * lowered by NONCE_TTL_SECONDS.
 */
export const NONCE_RETENTION_SECONDS = Math.ceil(
  (2 * SIGNED_ACTION_TTL_MS) / 1000,
);

function nonceTtlSeconds() {
  return Math.max(
    config.redis?.nonceTtlSeconds ?? 0,
    NONCE_RETENTION_SECONDS,
  );
}

type TimestampCheck = 'ok' | 'expired' | 'future';

/** Shared freshness rule for wallet actions, reads and order intake. */
export function checkSignedTimestamp(
  timestamp: number,
  now = Date.now(),
): TimestampCheck {
  if (timestamp - now > MAX_FUTURE_SKEW_MS) return 'future';
  if (now - timestamp > SIGNED_ACTION_TTL_MS) return 'expired';
  return 'ok';
}

// ─── Signing context (FE-03) ─────────────────────────────────────
export type SigningContext = { domain: string; chain: string };

/** Domain + chain genesis this deployment binds every signature to. */
export function getSigningContext(): SigningContext {
  return {
    domain: config.signing?.domain ?? 'localhost',
    chain: config.signing?.genesisHash ?? '',
  };
}

function acceptLegacySignatures() {
  return config.signing?.acceptLegacy ?? !config.isProd;
}

// ─── Redis-backed nonce store (with in-memory fallback) ──────────
const fallbackNonces = new Map<string, number>();
type NonceState = 'used' | 'unused' | 'unavailable';
type ConsumeNonceResult =
  | { ok: true }
  | { ok: false; error: 'replay' | 'unavailable' };

function pruneSignedActionNoncesFallback(now: number) {
  for (const [key, expiresAt] of fallbackNonces.entries()) {
    if (expiresAt <= now) fallbackNonces.delete(key);
  }
}

async function isNonceUsed(key: string): Promise<boolean> {
  return (await getNonceState(key)) === 'used';
}

async function getNonceState(key: string): Promise<NonceState> {
  // Always check in-memory fallback first — covers nonces written during a Redis
  // outage. Without this, a nonce stored in the fallback while Redis was down
  // would be invisible once Redis recovers, enabling replay attacks.
  if (fallbackNonces.has(key)) return 'used';
  try {
    const result = await getRedis().get(key);
    return result !== null ? 'used' : 'unused';
  } catch {
    return config.isProd ? 'unavailable' : 'unused';
  }
}

async function markNonceUsed(key: string): Promise<void> {
  const result = await consumeNonce(key);
  if (!result.ok) {
    throw new Error(
      result.error === 'replay'
        ? 'Nonce already used'
        : 'Nonce store unavailable',
    );
  }
}

async function consumeNonce(key: string): Promise<ConsumeNonceResult> {
  if (fallbackNonces.has(key)) {
    return { ok: false, error: 'replay' };
  }

  try {
    const result = await getRedis().set(
      key,
      '1',
      'EX',
      nonceTtlSeconds(),
      'NX',
    );
    return result === 'OK' ? { ok: true } : { ok: false, error: 'replay' };
  } catch {
    if (config.isProd) {
      log.error(
        { nonceKey: key },
        '[SECURITY] Redis nonce store unavailable in production',
      );
      return { ok: false, error: 'unavailable' };
    }

    // Redis unavailable outside production — fall back to in-memory.
    pruneSignedActionNoncesFallback(Date.now());
    if (fallbackNonces.has(key)) {
      return { ok: false, error: 'replay' };
    }
    fallbackNonces.set(key, Date.now() + nonceTtlSeconds() * 1000);
    return { ok: true };
  }
}

type SpotOrderMessageInput = {
  timeInForce?: string;
  expiresAt?: string | Date | null;
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

function canonicalOrderDecimal(value: string | undefined): string {
  const match = (value || '0')
    .trim()
    .match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[1] && !match[2]))
    throw new Error('Invalid order decimal');
  let digits = (match[1] + (match[2] || '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(match[3] || '0') - (match[2] || '').length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000)
    throw new Error('Invalid order decimal exponent');
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  const point = digits.length + exponent;
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}

function spotOrderBody(input: SpotOrderMessageInput) {
  const expiry = input.expiresAt ? new Date(input.expiresAt).getTime() : 0;
  return `${input.pairSymbol}:${input.side}:${input.type}:${canonicalOrderDecimal(input.price)}:${canonicalOrderDecimal(input.stopPrice)}:${canonicalOrderDecimal(input.amount)}:${input.nonce}:${input.timestamp ?? 0}:${input.timeInForce || 'GTC'}:${expiry}`;
}

/**
 * Canonical order message (v3): bound to the signing domain and the chain
 * genesis, so an order signed for sandbox/testnet never validates here.
 */
export function buildSpotOrderMessage(
  input: SpotOrderMessageInput,
  context: SigningContext = getSigningContext(),
) {
  return `lunex-order-v3:${context.domain}:${context.chain}:${spotOrderBody(input)}`;
}

/** Legacy v2 order message (no domain/chain). Deprecated. */
export function buildSpotOrderMessageV2(input: SpotOrderMessageInput) {
  return `lunex-order-v2:${spotOrderBody(input)}`;
}

export function buildLegacySpotOrderMessage(input: SpotOrderMessageInput) {
  const base = `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${
    input.price || '0'
  }:${input.stopPrice || '0'}:${input.amount}:${input.nonce}`;
  return input.timestamp !== undefined ? `${base}:${input.timestamp}` : base;
}

export { consumeNonce, isNonceUsed, markNonceUsed };

export type SpotOrderSignatureVersion = 'v3' | 'v2' | 'v1';

/**
 * Verifies an order signature against the bound v3 format and — only when
 * SIGNING_ACCEPT_LEGACY is on — the unbound v2 / v1 formats (v1 only for a
 * plain GTC order without expiry, which v1 never covered).
 */
export async function verifySpotOrderSignature(
  input: SpotOrderMessageInput,
  signature: string,
  address: string,
): Promise<SpotOrderSignatureVersion | null> {
  if (await verifyAddressSignature(buildSpotOrderMessage(input), signature, address)) {
    return 'v3';
  }
  if (!acceptLegacySignatures()) return null;
  if (await verifyAddressSignature(buildSpotOrderMessageV2(input), signature, address)) {
    return 'v2';
  }
  if (
    (input.timeInForce || 'GTC') === 'GTC' &&
    !input.expiresAt &&
    (await verifyAddressSignature(
      buildLegacySpotOrderMessage(input),
      signature,
      address,
    ))
  ) {
    return 'v1';
  }
  return null;
}

function firstSignedValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function getSignedAuthInput(
  req: {
    get(name: string): string | undefined;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
  fallbackSource: 'query' | 'body' = 'query',
) {
  const fallback = req[fallbackSource] ?? {};
  return {
    nonce: req.get('X-Lunex-Nonce') ?? firstSignedValue(fallback.nonce),
    timestamp:
      req.get('X-Lunex-Timestamp') ?? firstSignedValue(fallback.timestamp),
    signature:
      req.get('X-Lunex-Signature') ?? firstSignedValue(fallback.signature),
  };
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

type WalletActionMessageInput = {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
};

/**
 * Canonical wallet-action message: `lunex-auth:<action>`, then `domain:` and
 * `chain:` (FE-03), then address, sorted fields, nonce and timestamp. The
 * second line (`domain:` vs `address:`) makes it unambiguous with legacy.
 */
export function buildWalletActionMessage(
  input: WalletActionMessageInput,
  context: SigningContext = getSigningContext(),
) {
  return buildActionLines(input, [
    `domain:${context.domain}`,
    `chain:${context.chain}`,
  ]);
}

/** Legacy unbound wallet-action message. Deprecated (SIGNING_ACCEPT_LEGACY). */
export function buildLegacyWalletActionMessage(input: WalletActionMessageInput) {
  return buildActionLines(input, []);
}

async function verifyWalletMessage(
  input: WalletActionMessageInput & {
    signature: string;
    signedAddress?: string;
  },
): Promise<{ format: 'bound' | 'legacy'; message: string } | null> {
  const { signature, signedAddress, ...messageInput } = input;
  // Request schemas hand auth the canonical form, while the wallet signed the
  // `address:` line in whatever encoding it uses (M-09): try the string as
  // sent (only if it is the same account), then 42/57. The key is always
  // the claimed account's, so no line can admit another account.
  const candidates = [
    ...(signedAddress !== undefined &&
    isSameAccount(signedAddress, input.address)
      ? [signedAddress]
      : []),
    ...accountAddressVariants(input.address),
  ];
  for (const address of new Set(candidates)) {
    const bound = buildWalletActionMessage({ ...messageInput, address });
    if (await verifyAddressSignature(bound, signature, input.address)) {
      return { format: 'bound', message: bound };
    }
    if (!acceptLegacySignatures()) continue;
    const legacy = buildLegacyWalletActionMessage({ ...messageInput, address });
    if (await verifyAddressSignature(legacy, signature, input.address)) {
      log.warn(
        { address: input.address, action: input.action },
        '[SECURITY] Legacy unbound wallet signature accepted (deprecated)',
      );
      return { format: 'legacy', message: legacy };
    }
  }
  return null;
}

function buildActionLines(input: WalletActionMessageInput, binding: string[]) {
  const lines = [`lunex-auth:${input.action}`, ...binding, `address:${input.address}`];

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
  /** Address string exactly as the client sent (and signed) it. */
  signedAddress?: string;
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
  const freshness = checkSignedTimestamp(timestamp, now);
  if (freshness !== 'ok') {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: freshness,
        drift: timestamp - now,
      },
      '[SECURITY] Wallet signature rejected — ' +
        (freshness === 'future' ? 'timestamp in the future' : 'expired TTL'),
    );
    return {
      ok: false as const,
      error:
        freshness === 'future' ? 'Timestamp in the future' : 'Expired signature',
    };
  }

  // One key, one identity: nonces (and bans) use the canonical address (M-09).
  const address = toCanonicalAddress(input.address);
  if (!address) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_address',
      },
      '[SECURITY] Wallet signature rejected',
    );
    return { ok: false as const, error: 'Invalid signature' };
  }

  const replayKey = `nonce:${input.action}:${address}:${input.nonce}`;
  const nonceState = await getNonceState(replayKey);
  if (nonceState === 'unavailable') {
    log.error(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
      },
      '[SECURITY] Wallet signature rejected — nonce store unavailable',
    );
    return { ok: false as const, error: 'Nonce store unavailable' };
  }
  if (nonceState === 'used') {
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

  const verified = await verifyWalletMessage({
    action: input.action,
    address: input.address,
    nonce: input.nonce,
    timestamp,
    fields: input.fields,
    signature: input.signature,
    signedAddress: input.signedAddress,
  });
  if (!verified) {
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

  try {
    await walletRiskService.assertWalletCanAct(address);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Wallet is not allowed';
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'wallet_blocked',
      },
      '[SECURITY] Wallet signature rejected — wallet blocked',
    );
    return { ok: false as const, error: message };
  }

  const consumeResult = await consumeNonce(replayKey);
  if (!consumeResult.ok) {
    const error =
      consumeResult.error === 'replay'
        ? 'Signature nonce already used'
        : 'Nonce store unavailable';
    log.warn(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
        reason: consumeResult.error,
      },
      '[SECURITY] Wallet signature rejected — nonce consume failed',
    );
    return { ok: false as const, error };
  }
  return { ok: true as const, message: verified.message };
}

export async function verifyWalletReadSignature(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  signature: string;
  /** Address string exactly as the client sent (and signed) it. */
  signedAddress?: string;
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
  const freshness = checkSignedTimestamp(timestamp, now);
  if (freshness !== 'ok') {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: freshness,
        drift: timestamp - now,
      },
      '[SECURITY] Wallet read signature rejected — ' +
        (freshness === 'future' ? 'timestamp in the future' : 'expired TTL'),
    );
    return {
      ok: false as const,
      error:
        freshness === 'future' ? 'Timestamp in the future' : 'Expired signature',
    };
  }

  // One key, one identity: the nonce key uses the canonical address (M-09).
  const address = toCanonicalAddress(input.address);
  if (!address) {
    log.warn(
      {
        address: input.address,
        action: input.action,
        reason: 'invalid_address',
      },
      '[SECURITY] Wallet read signature rejected',
    );
    return { ok: false as const, error: 'Invalid signature' };
  }

  const replayKey = `nonce:read:${input.action}:${address}:${input.nonce}`;
  const nonceState = await getNonceState(replayKey);
  if (nonceState === 'unavailable') {
    log.error(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
      },
      '[SECURITY] Wallet read signature rejected — nonce store unavailable',
    );
    return { ok: false as const, error: 'Nonce store unavailable' };
  }
  if (nonceState === 'used') {
    log.warn(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
        reason: 'replay',
      },
      '[SECURITY] Wallet read signature rejected — nonce replay detected',
    );
    return { ok: false as const, error: 'Signature nonce already used' };
  }

  const verified = await verifyWalletMessage({
    action: input.action,
    address: input.address,
    nonce: input.nonce,
    timestamp,
    fields: input.fields,
    signature: input.signature,
    signedAddress: input.signedAddress,
  });
  if (!verified) {
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

  const consumeResult = await consumeNonce(replayKey);
  if (!consumeResult.ok) {
    const error =
      consumeResult.error === 'replay'
        ? 'Signature nonce already used'
        : 'Nonce store unavailable';
    log.warn(
      {
        address: input.address,
        action: input.action,
        nonce: input.nonce,
        reason: consumeResult.error,
      },
      '[SECURITY] Wallet read signature rejected — nonce consume failed',
    );
    return { ok: false as const, error };
  }
  return { ok: true as const, message: verified.message };
}
