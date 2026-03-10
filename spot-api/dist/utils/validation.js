"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyTradeApiKeySchema = exports.CopyTradeApiKeyChallengeSchema = exports.CopyTradeActivityQuerySchema = exports.CopyTradeSignalSchema = exports.CopyVaultWithdrawSchema = exports.CopyVaultDepositSchema = exports.CreateIdeaCommentSchema = exports.UpsertLeaderProfileSchema = exports.LeaderProfileByAddressSchema = exports.FollowLeaderSchema = exports.SocialLeadersQuerySchema = exports.CandleQuerySchema = exports.RetryTradeSettlementsSchema = exports.TradeSettlementQuerySchema = exports.TradeSettlementStatusSchema = exports.PaginationSchema = exports.MarginLiquidatePositionSchema = exports.MarginClosePositionSchema = exports.MarginOpenPositionSchema = exports.MarginCollateralSchema = exports.MarginPriceHealthResetSchema = exports.MarginPriceHealthQuerySchema = exports.MarginOverviewQuerySchema = exports.CancelOrderSchema = exports.CreateOrderSchema = void 0;
const zod_1 = require("zod");
exports.CreateOrderSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL']),
    type: zod_1.z.enum(['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT']),
    price: zod_1.z.string().optional(), // Required for LIMIT, STOP_LIMIT
    stopPrice: zod_1.z.string().optional(), // Required for STOP, STOP_LIMIT
    amount: zod_1.z.string().min(1),
    timeInForce: zod_1.z.enum(['GTC', 'IOC', 'FOK']).default('GTC'),
    nonce: zod_1.z.string().min(1),
    signature: zod_1.z.string().min(1),
    makerAddress: zod_1.z.string().min(1),
    expiresAt: zod_1.z.string().datetime().optional(),
});
exports.CancelOrderSchema = zod_1.z.object({
    signature: zod_1.z.string().min(1),
    makerAddress: zod_1.z.string().min(1),
});
exports.MarginOverviewQuerySchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
});
exports.MarginPriceHealthQuerySchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(3).optional(),
});
exports.MarginPriceHealthResetSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(3).optional(),
});
exports.MarginCollateralSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    token: zod_1.z.string().trim().min(2).max(32).default('USDT'),
    amount: zod_1.z.string().min(1),
    signature: zod_1.z.string().min(1),
});
exports.MarginOpenPositionSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    pairSymbol: zod_1.z.string().min(3),
    side: zod_1.z.enum(['BUY', 'SELL']),
    collateralAmount: zod_1.z.string().min(1),
    leverage: zod_1.z.string().min(1),
    signature: zod_1.z.string().min(1),
});
exports.MarginClosePositionSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    signature: zod_1.z.string().min(1),
});
exports.MarginLiquidatePositionSchema = zod_1.z.object({
    liquidatorAddress: zod_1.z.string().min(3),
    signature: zod_1.z.string().min(1),
});
exports.PaginationSchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    offset: zod_1.z.coerce.number().int().min(0).default(0),
});
exports.TradeSettlementStatusSchema = zod_1.z.enum(['PENDING', 'SETTLING', 'SETTLED', 'FAILED', 'SKIPPED']);
exports.TradeSettlementQuerySchema = zod_1.z.object({
    status: exports.TradeSettlementStatusSchema.optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    offset: zod_1.z.coerce.number().int().min(0).default(0),
});
exports.RetryTradeSettlementsSchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
exports.CandleQuerySchema = zod_1.z.object({
    timeframe: zod_1.z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),
    limit: zod_1.z.coerce.number().int().min(1).max(1000).default(200),
});
exports.SocialLeadersQuerySchema = zod_1.z.object({
    tab: zod_1.z.enum(['all', 'traders', 'bots']).optional(),
    search: zod_1.z.string().trim().max(100).optional(),
    sortBy: zod_1.z.enum(['roi30d', 'followers', 'winRate', 'sharpe']).default('roi30d'),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
});
exports.FollowLeaderSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
});
exports.LeaderProfileByAddressSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    viewerAddress: zod_1.z.string().min(3).optional(),
});
exports.UpsertLeaderProfileSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    name: zod_1.z.string().trim().min(2).max(64),
    username: zod_1.z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9_\-.]+$/),
    bio: zod_1.z.string().trim().min(1).max(500),
    avatar: zod_1.z.string().trim().max(5000000).optional().or(zod_1.z.literal('')),
    fee: zod_1.z.coerce.number().min(5).max(50),
    twitterUrl: zod_1.z.string().trim().url().max(300).optional().or(zod_1.z.literal('')),
    telegramUrl: zod_1.z.string().trim().url().max(300).optional().or(zod_1.z.literal('')),
    discordUrl: zod_1.z.string().trim().url().max(300).optional().or(zod_1.z.literal('')),
});
exports.CreateIdeaCommentSchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
    content: zod_1.z.string().trim().min(1).max(2000),
});
exports.CopyVaultDepositSchema = zod_1.z.object({
    followerAddress: zod_1.z.string().min(3),
    token: zod_1.z.string().trim().min(2).max(32),
    amount: zod_1.z.string().min(1),
});
exports.CopyVaultWithdrawSchema = zod_1.z.object({
    followerAddress: zod_1.z.string().min(3),
    shares: zod_1.z.string().min(1),
});
exports.CopyTradeSignalSchema = zod_1.z.object({
    leaderId: zod_1.z.string().uuid().optional(),
    pairSymbol: zod_1.z.string().min(3),
    side: zod_1.z.enum(['BUY', 'SELL']),
    source: zod_1.z.enum(['API', 'WEB3']).default('API'),
    strategyTag: zod_1.z.string().trim().max(100).optional(),
    amountIn: zod_1.z.string().min(1),
    amountOutMin: zod_1.z.string().min(1),
    route: zod_1.z.array(zod_1.z.string().min(1)).max(4).optional(),
    maxSlippageBps: zod_1.z.coerce.number().int().min(1).max(2000).default(100),
    executionPrice: zod_1.z.string().optional(),
    realizedPnlPct: zod_1.z.string().optional(),
});
exports.CopyTradeActivityQuerySchema = zod_1.z.object({
    address: zod_1.z.string().min(3).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
});
exports.CopyTradeApiKeyChallengeSchema = zod_1.z.object({
    leaderAddress: zod_1.z.string().min(3),
});
exports.CopyTradeApiKeySchema = zod_1.z.object({
    leaderAddress: zod_1.z.string().min(3),
    challengeId: zod_1.z.string().min(8),
    signature: zod_1.z.string().min(8),
});
//# sourceMappingURL=validation.js.map