import { z } from 'zod'

const SignedWalletActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
})

export const CreateOrderSchema = z.object({
  pairSymbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT']),
  price: z.string().optional(), // Required for LIMIT, STOP_LIMIT
  stopPrice: z.string().optional(), // Required for STOP, STOP_LIMIT
  amount: z.string().min(1),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).default('GTC'),
  nonce: z.string().min(1),
  signature: z.string().min(1),
  makerAddress: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
})

export const CancelOrderSchema = z.object({
  signature: z.string().min(1),
  makerAddress: z.string().min(1),
})

export const MarginOverviewQuerySchema = z.object({
  address: z.string().min(3),
})

export const MarginPriceHealthQuerySchema = z.object({
  pairSymbol: z.string().min(3).optional(),
})

export const MarginPriceHealthResetSchema = z.object({
  pairSymbol: z.string().min(3).optional(),
})

export const MarginCollateralSchema = z.object({
  address: z.string().min(3),
  token: z.string().trim().min(2).max(32).default('USDT'),
  amount: z.string().min(1),
}).merge(SignedWalletActionSchema)

export const MarginOpenPositionSchema = z.object({
  address: z.string().min(3),
  pairSymbol: z.string().min(3),
  side: z.enum(['BUY', 'SELL']),
  collateralAmount: z.string().min(1),
  leverage: z.string().min(1),
}).merge(SignedWalletActionSchema)

export const MarginClosePositionSchema = z.object({
  address: z.string().min(3),
}).merge(SignedWalletActionSchema)

export const MarginLiquidatePositionSchema = z.object({
  liquidatorAddress: z.string().min(3),
}).merge(SignedWalletActionSchema)

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const TradeSettlementStatusSchema = z.enum(['PENDING', 'SETTLING', 'SETTLED', 'FAILED', 'SKIPPED'])

export const TradeSettlementQuerySchema = z.object({
  status: TradeSettlementStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const RetryTradeSettlementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const CandleQuerySchema = z.object({
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
})

export const SocialLeadersQuerySchema = z.object({
  tab: z.enum(['all', 'traders', 'bots']).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(['roi30d', 'followers', 'winRate', 'sharpe']).default('roi30d'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const FollowLeaderSchema = SignedWalletActionSchema.extend({
  address: z.string().min(3),
})

export const LeaderProfileByAddressSchema = z.object({
  address: z.string().min(3),
  viewerAddress: z.string().min(3).optional(),
})

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
  avatar: z.string().trim().max(5_000_000).optional().or(z.literal('')),
  fee: z.coerce.number().min(5).max(50),
  twitterUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  telegramUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  discordUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
})

export const CreateIdeaCommentSchema = SignedWalletActionSchema.extend({
  address: z.string().min(3),
  content: z.string().trim().min(1).max(2000),
})

export const CopyVaultDepositSchema = SignedWalletActionSchema.extend({
  followerAddress: z.string().min(3),
  token: z.string().trim().min(2).max(32),
  amount: z.string().min(1),
})

export const CopyVaultWithdrawSchema = SignedWalletActionSchema.extend({
  followerAddress: z.string().min(3),
  shares: z.string().min(1),
})

export const CopyTradeSignalSchema = z.object({
  leaderId: z.string().uuid().optional(),
  leaderAddress: z.string().min(3).optional(),
  pairSymbol: z.string().min(3),
  side: z.enum(['BUY', 'SELL']),
  source: z.enum(['API', 'WEB3']).default('API'),
  strategyTag: z.string().trim().max(100).optional(),
  amountIn: z.string().min(1),
  amountOutMin: z.string().min(1),
  route: z.array(z.string().min(1)).max(4).optional(),
  maxSlippageBps: z.coerce.number().int().min(1).max(2000).default(100),
  executionPrice: z.string().optional(),
  realizedPnlPct: z.string().optional(),
  nonce: z.string().min(8).optional(),
  timestamp: z.coerce.number().int().positive().optional(),
  signature: z.string().min(8).optional(),
})

export const CopyTradeActivityQuerySchema = z.object({
  address: z.string().min(3).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const CopyTradeApiKeyChallengeSchema = z.object({
  leaderAddress: z.string().min(3),
})

export const CopyTradeApiKeySchema = z.object({
  leaderAddress: z.string().min(3),
  challengeId: z.string().min(8),
  signature: z.string().min(8),
})

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>
export type MarginOverviewQueryInput = z.infer<typeof MarginOverviewQuerySchema>
export type MarginPriceHealthQueryInput = z.infer<typeof MarginPriceHealthQuerySchema>
export type MarginPriceHealthResetInput = z.infer<typeof MarginPriceHealthResetSchema>
export type MarginCollateralInput = z.infer<typeof MarginCollateralSchema>
export type MarginOpenPositionInput = z.infer<typeof MarginOpenPositionSchema>
export type MarginClosePositionInput = z.infer<typeof MarginClosePositionSchema>
export type MarginLiquidatePositionInput = z.infer<typeof MarginLiquidatePositionSchema>
export type TradeSettlementQueryInput = z.infer<typeof TradeSettlementQuerySchema>
export type SocialLeadersQuery = z.infer<typeof SocialLeadersQuerySchema>
export type LeaderProfileByAddressInput = z.infer<typeof LeaderProfileByAddressSchema>
export type UpsertLeaderProfileInput = z.infer<typeof UpsertLeaderProfileSchema>
export type CopyVaultDepositInput = z.infer<typeof CopyVaultDepositSchema>
export type CopyVaultWithdrawInput = z.infer<typeof CopyVaultWithdrawSchema>
export type CopyTradeSignalInput = z.infer<typeof CopyTradeSignalSchema>
export type CopyTradeApiKeyChallengeInput = z.infer<typeof CopyTradeApiKeyChallengeSchema>
export type CopyTradeApiKeyInput = z.infer<typeof CopyTradeApiKeySchema>
export type RetryTradeSettlementsInput = z.infer<typeof RetryTradeSettlementsSchema>
