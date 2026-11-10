import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { z } from 'zod';

/**
 * SS58 prefix every wallet address is stored and compared in (M-09). There is
 * no network-prefix setting in config: 42 (generic Substrate) is what the
 * backend already produces (Keyring default) and what seeds and deploy
 * manifests use. The Lunes chain spec declares 57
 * (docs/PRD_LUNES_NATIVE_ASSETS.md); switching to it needs a data migration.
 */
export const CANONICAL_SS58_PREFIX = 42;

/**
 * Prefixes a wallet may have written into the `address:` line of a signed
 * message (generic and Lunes). Auth tries these when the canonical form does
 * not verify, so normalizing the request field does not break signatures.
 */
export const SIGNING_SS58_PREFIXES: readonly number[] = [
  CANONICAL_SS58_PREFIX,
  57,
];

/** 32-byte account id of an SS58 (or 0x hex) address, or null if invalid. */
export function decodeAccountId(address: string): Uint8Array | null {
  try {
    const publicKey = decodeAddress(address);
    return publicKey.length === 32 ? publicKey : null;
  } catch {
    return null;
  }
}

/** Same account re-encoded with CANONICAL_SS58_PREFIX, or null if invalid. */
export function toCanonicalAddress(address: string): string | null {
  const publicKey = decodeAccountId(address);
  return publicKey ? encodeAddress(publicKey, CANONICAL_SS58_PREFIX) : null;
}

/**
 * Every string the same account may be stored or signed under: the input as
 * given, then its encoding in each SIGNING_SS58_PREFIXES (canonical first).
 * An undecodable input yields just itself, so legacy raw rows still match.
 */
export function accountAddressVariants(address: string): string[] {
  const publicKey = decodeAccountId(address);
  if (!publicKey) return [address];
  return [
    ...new Set([
      address,
      ...SIGNING_SS58_PREFIXES.map((prefix) =>
        encodeAddress(publicKey, prefix),
      ),
    ]),
  ];
}

/**
 * Prisma string filter for every row of an account: `{ in: variants }`, or
 * plain equality when the input is undecodable (legacy raw rows). Rows in an
 * encoding outside the variants (hex/other prefix, not the input) need the
 * data migration.
 */
export function accountAddressFilter(
  address: string,
): string | { in: string[] } {
  const variants = accountAddressVariants(address);
  return variants.length === 1 ? variants[0] : { in: variants };
}

/** Same account id (any SS58 prefix); plain string equality if undecodable. */
export function isSameAccount(a: string, b: string): boolean {
  const left = toCanonicalAddress(a);
  return left !== null ? left === toCanonicalAddress(b) : a === b;
}

/**
 * The address string the client wrote in the `address:` line it signed: the
 * raw request field (hex, any SS58 prefix) when it is the same account as
 * the canonical one, otherwise the canonical address. Only rebuilds the
 * signed message; identity stays canonical.
 */
export function signedAddressFor(raw: unknown, canonical: string): string {
  return typeof raw === 'string' && isSameAccount(raw, canonical)
    ? raw
    : canonical;
}

/**
 * Wallet address field: accepts any SS58 prefix (or a hex account id) and
 * outputs the canonical encoding, so one key is one identity for bans,
 * limits, nonces and balance reservation.
 */
export const ss58Address = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .transform((value, ctx) => {
    const canonical = toCanonicalAddress(value);
    if (!canonical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid SS58 address',
      });
      return z.NEVER;
    }
    return canonical;
  });

const SignedWalletActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

/**
 * External link stored and later rendered as `href` by web/admin. Only
 * https: is accepted — `z.string().url()` alone accepts `javascript:`,
 * `data:` and `vbscript:` URLs (stored XSS, BE-14).
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .url()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          Boolean(url.hostname) &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    },
    { message: 'Only https URLs are allowed' },
  );

/** Optional https link; empty string clears the field. */
export const optionalHttpsUrl = httpsUrl.optional().or(z.literal(''));

// Avatar: an https URL or a small inline PNG/JPEG/WebP data URI. SVG and any
// other media type are rejected (SVG can carry script).
const MAX_AVATAR_DATA_URI_LENGTH = 90_000; // ~64 KB image (body limit 100 KB)
const avatarDataUri = z
  .string()
  .trim()
  .max(MAX_AVATAR_DATA_URI_LENGTH)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, {
    message: 'Avatar must be a PNG, JPEG or WebP data URI',
  });

const positiveDecimalString = z
  .string()
  .min(1)
  .max(128)
  .regex(/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i, 'Must be a decimal number')
  .refine(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    },
    { message: 'Must be a positive number' },
  );

export const CreateOrderSchema = z.object({
  pairSymbol: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9]+\/[A-Z0-9]+$/, {
      message: 'Invalid pair symbol format (e.g. LUNES/LUSDT)',
    }),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT']),
  price: positiveDecimalString.optional(), // Required for LIMIT, STOP_LIMIT
  stopPrice: positiveDecimalString.optional(), // Required for STOP, STOP_LIMIT
  amount: positiveDecimalString,
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).default('GTC'),
  nonce: z.string().min(1),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(1),
  makerAddress: ss58Address,
  expiresAt: z.string().datetime().optional(),
});

export const CancelOrderSchema = SignedWalletActionSchema.extend({
  makerAddress: ss58Address,
});

export const MarginPriceHealthQuerySchema = z.object({
  pairSymbol: z.string().min(3).optional(),
});

export const MarginPriceHealthResetSchema = z.object({
  pairSymbol: z.string().min(3).optional(),
});

export const MarginCollateralSchema = z
  .object({
    address: ss58Address,
    token: z.string().trim().min(2).max(32).default('USDT'),
    amount: z.string().min(1),
  })
  .merge(SignedWalletActionSchema);

export const MarginOpenPositionSchema = z
  .object({
    address: ss58Address,
    pairSymbol: z.string().min(3),
    side: z.enum(['BUY', 'SELL']),
    collateralAmount: z.string().min(1),
    leverage: z.string().min(1),
  })
  .merge(SignedWalletActionSchema);

export const MarginClosePositionSchema = z
  .object({
    address: ss58Address,
  })
  .merge(SignedWalletActionSchema);

export const MarginLiquidatePositionSchema = z
  .object({
    liquidatorAddress: ss58Address,
  })
  .merge(SignedWalletActionSchema);

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const TradeSettlementStatusSchema = z.enum([
  'PENDING',
  'SETTLING',
  'SETTLED',
  'FAILED',
  'SKIPPED',
  // Broadcast with unknown outcome; awaiting chain reconciliation (BE-07).
  'RECONCILE_REQUIRED',
]);

export const TradeSettlementQuerySchema = z.object({
  status: TradeSettlementStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const RetryTradeSettlementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Pair symbol taken from a path segment or `?symbol=`. Must be a plain
 * string: qs turns `symbol[not]=x` into an object, which would otherwise
 * reach Prisma as an operator (BE-19).
 */
export const PairSymbolParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/, {
    message: 'Invalid pair symbol',
  });

/** Resolves `?symbol=` (preferred) or the `:symbol` path param, validated. */
export function parsePairSymbol(
  query: unknown,
  param: unknown,
): { ok: true; symbol: string } | { ok: false } {
  const raw = query !== undefined ? query : param;
  const parsed = PairSymbolParamSchema.safeParse(raw);
  return parsed.success ? { ok: true, symbol: parsed.data } : { ok: false };
}

export const RewardWeeksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(52).default(10),
});

export const RewardClaimSchema = SignedWalletActionSchema.extend({
  address: z.string().min(8).max(128),
});

export const CandleQuerySchema = z.object({
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const SocialLeadersQuerySchema = z.object({
  tab: z.enum(['all', 'traders', 'bots']).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z
    .enum(['roi30d', 'followers', 'winRate', 'sharpe'])
    .default('roi30d'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Risk limits for the copy-engine. Reused by follow + deposit so the
// frontend has a single, stable contract for risk configuration.
//   copyMultiplier  : scales the copied position size (0.1x .. 10x).
//   maxPerTradeUsdt : hard cap (in collateral/USDT) per copied trade.
//   stopLossPct     : pause copy when vault loss exceeds this % of deposits.
//   maxDrawdownPct  : pause copy when drawdown from peak exceeds this %.
// copyMultiplier is optional on the wire; the copy-engine treats an absent
// value as 1x (see readVaultRiskConfig). Range still enforced when present.
const CopyRiskConfigSchema = z.object({
  copyMultiplier: z.coerce.number().min(0.1).max(10).optional(),
  maxPerTradeUsdt: z.coerce.number().min(0).optional(),
  stopLossPct: z.coerce.number().min(1).max(100).optional(),
  maxDrawdownPct: z.coerce.number().min(1).max(100).optional(),
});

export const FollowLeaderSchema = SignedWalletActionSchema.extend({
  address: z.string().min(3),
}).merge(CopyRiskConfigSchema);

export const LeaderProfileByAddressSchema = z.object({
  address: z.string().min(3),
  viewerAddress: z.string().min(3).optional(),
});

export const UpsertLeaderProfileSchema = SignedWalletActionSchema.extend({
  address: z.string().min(3),
  name: z.string().trim().min(2).max(64),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_\-.]+$/),
  bio: z.string().trim().min(1).max(500),
  avatar: z
    .union([httpsUrl, avatarDataUri])
    .optional()
    .or(z.literal('')),
  fee: z.coerce.number().min(5).max(50),
  twitterUrl: optionalHttpsUrl,
  telegramUrl: optionalHttpsUrl,
  discordUrl: optionalHttpsUrl,
});

export const CreateIdeaCommentSchema = SignedWalletActionSchema.extend({
  address: z.string().min(3),
  content: z.string().trim().min(1).max(2000),
});

export const CopyVaultDepositSchema = SignedWalletActionSchema.extend({
  followerAddress: z.string().min(3),
  token: z.string().trim().min(2).max(32),
  amount: z.string().min(1),
}).merge(CopyRiskConfigSchema);

export const CopyVaultWithdrawSchema = SignedWalletActionSchema.extend({
  followerAddress: z.string().min(3),
  shares: z.string().min(1),
});

export const CopyTradeSignalSchema = z.object({
  leaderId: z.string().uuid().optional(),
  leaderAddress: z.string().min(3).optional(),
  pairSymbol: z.string().min(3),
  side: z.enum(['BUY', 'SELL']),
  positionEffect: z.enum(['AUTO', 'OPEN', 'CLOSE']).default('AUTO'),
  signalMode: z.enum(['AUTO', 'JOURNAL', 'EXECUTE_VAULT']).default('AUTO'),
  source: z.enum(['API', 'WEB3']).default('API'),
  strategyTag: z.string().trim().max(100).optional(),
  amountIn: positiveDecimalString,
  amountOutMin: positiveDecimalString,
  route: z.array(z.string().min(1)).max(4).optional(),
  maxSlippageBps: z.coerce.number().int().min(1).max(2000).default(100),
  executionPrice: positiveDecimalString.optional(),
  realizedPnlPct: z.string().optional(), // deprecated: ignored for execution semantics
  nonce: z.string().min(8).optional(),
  timestamp: z.coerce.number().int().positive().optional(),
  signature: z.string().min(8).optional(),
});

export const CopyTradeSignalWalletConfirmationSchema =
  SignedWalletActionSchema.extend({
    leaderAddress: z.string().min(3),
    txHash: z.string().trim().min(10).max(256),
    amountOut: positiveDecimalString.optional(),
    executionPrice: positiveDecimalString.optional(),
  });

export const CopyTradeApiKeyChallengeSchema = z.object({
  leaderAddress: z.string().min(3),
});

export const CopyTradeApiKeySchema = z.object({
  leaderAddress: z.string().min(3),
  challengeId: z.string().min(8),
  signature: z.string().min(8),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type SocialLeadersQuery = z.infer<typeof SocialLeadersQuerySchema>;
export type UpsertLeaderProfileInput = z.infer<
  typeof UpsertLeaderProfileSchema
>;
export type CopyVaultDepositInput = z.infer<typeof CopyVaultDepositSchema>;
export type CopyVaultWithdrawInput = z.infer<typeof CopyVaultWithdrawSchema>;
export type CopyTradeSignalInput = z.infer<typeof CopyTradeSignalSchema>;
export type CopyTradeSignalWalletConfirmationInput = z.infer<
  typeof CopyTradeSignalWalletConfirmationSchema
>;
export type CopyTradeApiKeyChallengeInput = z.infer<
  typeof CopyTradeApiKeyChallengeSchema
>;
export type CopyTradeApiKeyInput = z.infer<typeof CopyTradeApiKeySchema>;
