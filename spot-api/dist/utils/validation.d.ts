import { z } from 'zod';
export declare const CreateOrderSchema: z.ZodObject<{
    pairSymbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    type: z.ZodEnum<["LIMIT", "MARKET", "STOP", "STOP_LIMIT"]>;
    price: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    stopPrice: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    amount: z.ZodEffects<z.ZodString, string, string>;
    timeInForce: z.ZodDefault<z.ZodEnum<["GTC", "IOC", "FOK"]>>;
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
    makerAddress: z.ZodString;
    expiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    timestamp: number;
    makerAddress: string;
    side: "BUY" | "SELL";
    type: "LIMIT" | "STOP_LIMIT" | "MARKET" | "STOP";
    signature: string;
    nonce: string;
    timeInForce: "GTC" | "IOC" | "FOK";
    pairSymbol: string;
    price?: string | undefined;
    stopPrice?: string | undefined;
    expiresAt?: string | undefined;
}, {
    amount: string;
    timestamp: number;
    makerAddress: string;
    side: "BUY" | "SELL";
    type: "LIMIT" | "STOP_LIMIT" | "MARKET" | "STOP";
    signature: string;
    nonce: string;
    pairSymbol: string;
    price?: string | undefined;
    stopPrice?: string | undefined;
    timeInForce?: "GTC" | "IOC" | "FOK" | undefined;
    expiresAt?: string | undefined;
}>;
export declare const CancelOrderSchema: z.ZodObject<{
    signature: z.ZodString;
    makerAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    makerAddress: string;
    signature: string;
}, {
    makerAddress: string;
    signature: string;
}>;
export declare const MarginOverviewQuerySchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
    address: string;
}>;
export declare const MarginPriceHealthQuerySchema: z.ZodObject<{
    pairSymbol: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    pairSymbol?: string | undefined;
}, {
    pairSymbol?: string | undefined;
}>;
export declare const MarginPriceHealthResetSchema: z.ZodObject<{
    pairSymbol: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    pairSymbol?: string | undefined;
}, {
    pairSymbol?: string | undefined;
}>;
export declare const MarginCollateralSchema: z.ZodObject<{
    address: z.ZodString;
    token: z.ZodDefault<z.ZodString>;
    amount: z.ZodString;
} & {
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: string;
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
    token: string;
}, {
    amount: string;
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
    token?: string | undefined;
}>;
export declare const MarginOpenPositionSchema: z.ZodObject<{
    address: z.ZodString;
    pairSymbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    collateralAmount: z.ZodString;
    leverage: z.ZodString;
} & {
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    side: "BUY" | "SELL";
    signature: string;
    nonce: string;
    pairSymbol: string;
    address: string;
    collateralAmount: string;
    leverage: string;
}, {
    timestamp: number;
    side: "BUY" | "SELL";
    signature: string;
    nonce: string;
    pairSymbol: string;
    address: string;
    collateralAmount: string;
    leverage: string;
}>;
export declare const MarginClosePositionSchema: z.ZodObject<{
    address: z.ZodString;
} & {
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
}>;
export declare const MarginLiquidatePositionSchema: z.ZodObject<{
    liquidatorAddress: z.ZodString;
} & {
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    liquidatorAddress: string;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    liquidatorAddress: string;
}>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    offset: number;
}, {
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export declare const TradeSettlementStatusSchema: z.ZodEnum<["PENDING", "SETTLING", "SETTLED", "FAILED", "SKIPPED"]>;
export declare const TradeSettlementQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["PENDING", "SETTLING", "SETTLED", "FAILED", "SKIPPED"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    offset: number;
    status?: "PENDING" | "SETTLING" | "SETTLED" | "FAILED" | "SKIPPED" | undefined;
}, {
    status?: "PENDING" | "SETTLING" | "SETTLED" | "FAILED" | "SKIPPED" | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export declare const RetryTradeSettlementsSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
}, {
    limit?: number | undefined;
}>;
export declare const CandleQuerySchema: z.ZodObject<{
    timeframe: z.ZodDefault<z.ZodEnum<["1m", "5m", "15m", "1h", "4h", "1d", "1w"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
}, {
    limit?: number | undefined;
    timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | undefined;
}>;
export declare const SocialLeadersQuerySchema: z.ZodObject<{
    tab: z.ZodOptional<z.ZodEnum<["all", "traders", "bots"]>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodDefault<z.ZodEnum<["roi30d", "followers", "winRate", "sharpe"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    sortBy: "roi30d" | "followers" | "winRate" | "sharpe";
    search?: string | undefined;
    tab?: "all" | "traders" | "bots" | undefined;
}, {
    limit?: number | undefined;
    search?: string | undefined;
    tab?: "all" | "traders" | "bots" | undefined;
    sortBy?: "roi30d" | "followers" | "winRate" | "sharpe" | undefined;
}>;
export declare const FollowLeaderSchema: z.ZodObject<{
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
} & {
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
}>;
export declare const LeaderProfileByAddressSchema: z.ZodObject<{
    address: z.ZodString;
    viewerAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    viewerAddress?: string | undefined;
}, {
    address: string;
    viewerAddress?: string | undefined;
}>;
export declare const UpsertLeaderProfileSchema: z.ZodObject<{
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
} & {
    address: z.ZodString;
    name: z.ZodString;
    username: z.ZodString;
    bio: z.ZodString;
    avatar: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    fee: z.ZodNumber;
    twitterUrl: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    telegramUrl: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    discordUrl: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    name: string;
    address: string;
    username: string;
    bio: string;
    fee: number;
    avatar?: string | undefined;
    twitterUrl?: string | undefined;
    telegramUrl?: string | undefined;
    discordUrl?: string | undefined;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    name: string;
    address: string;
    username: string;
    bio: string;
    fee: number;
    avatar?: string | undefined;
    twitterUrl?: string | undefined;
    telegramUrl?: string | undefined;
    discordUrl?: string | undefined;
}>;
export declare const CreateIdeaCommentSchema: z.ZodObject<{
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
} & {
    address: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
    content: string;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    address: string;
    content: string;
}>;
export declare const CopyVaultDepositSchema: z.ZodObject<{
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
} & {
    followerAddress: z.ZodString;
    token: z.ZodString;
    amount: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: string;
    timestamp: number;
    signature: string;
    nonce: string;
    token: string;
    followerAddress: string;
}, {
    amount: string;
    timestamp: number;
    signature: string;
    nonce: string;
    token: string;
    followerAddress: string;
}>;
export declare const CopyVaultWithdrawSchema: z.ZodObject<{
    nonce: z.ZodString;
    timestamp: z.ZodNumber;
    signature: z.ZodString;
} & {
    followerAddress: z.ZodString;
    shares: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    signature: string;
    nonce: string;
    followerAddress: string;
    shares: string;
}, {
    timestamp: number;
    signature: string;
    nonce: string;
    followerAddress: string;
    shares: string;
}>;
export declare const CopyTradeSignalSchema: z.ZodObject<{
    leaderId: z.ZodOptional<z.ZodString>;
    leaderAddress: z.ZodOptional<z.ZodString>;
    pairSymbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    source: z.ZodDefault<z.ZodEnum<["API", "WEB3"]>>;
    strategyTag: z.ZodOptional<z.ZodString>;
    amountIn: z.ZodString;
    amountOutMin: z.ZodString;
    route: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    maxSlippageBps: z.ZodDefault<z.ZodNumber>;
    executionPrice: z.ZodOptional<z.ZodString>;
    realizedPnlPct: z.ZodOptional<z.ZodString>;
    nonce: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    signature: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    side: "BUY" | "SELL";
    maxSlippageBps: number;
    pairSymbol: string;
    source: "API" | "WEB3";
    amountIn: string;
    amountOutMin: string;
    timestamp?: number | undefined;
    signature?: string | undefined;
    nonce?: string | undefined;
    route?: string[] | undefined;
    leaderId?: string | undefined;
    leaderAddress?: string | undefined;
    strategyTag?: string | undefined;
    executionPrice?: string | undefined;
    realizedPnlPct?: string | undefined;
}, {
    side: "BUY" | "SELL";
    pairSymbol: string;
    amountIn: string;
    amountOutMin: string;
    timestamp?: number | undefined;
    signature?: string | undefined;
    nonce?: string | undefined;
    route?: string[] | undefined;
    leaderId?: string | undefined;
    maxSlippageBps?: number | undefined;
    leaderAddress?: string | undefined;
    source?: "API" | "WEB3" | undefined;
    strategyTag?: string | undefined;
    executionPrice?: string | undefined;
    realizedPnlPct?: string | undefined;
}>;
export declare const CopyTradeActivityQuerySchema: z.ZodObject<{
    address: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    address?: string | undefined;
}, {
    limit?: number | undefined;
    address?: string | undefined;
}>;
export declare const CopyTradeApiKeyChallengeSchema: z.ZodObject<{
    leaderAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    leaderAddress: string;
}, {
    leaderAddress: string;
}>;
export declare const CopyTradeApiKeySchema: z.ZodObject<{
    leaderAddress: z.ZodString;
    challengeId: z.ZodString;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    signature: string;
    leaderAddress: string;
    challengeId: string;
}, {
    signature: string;
    leaderAddress: string;
    challengeId: string;
}>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
export type MarginOverviewQueryInput = z.infer<typeof MarginOverviewQuerySchema>;
export type MarginPriceHealthQueryInput = z.infer<typeof MarginPriceHealthQuerySchema>;
export type MarginPriceHealthResetInput = z.infer<typeof MarginPriceHealthResetSchema>;
export type MarginCollateralInput = z.infer<typeof MarginCollateralSchema>;
export type MarginOpenPositionInput = z.infer<typeof MarginOpenPositionSchema>;
export type MarginClosePositionInput = z.infer<typeof MarginClosePositionSchema>;
export type MarginLiquidatePositionInput = z.infer<typeof MarginLiquidatePositionSchema>;
export type TradeSettlementQueryInput = z.infer<typeof TradeSettlementQuerySchema>;
export type SocialLeadersQuery = z.infer<typeof SocialLeadersQuerySchema>;
export type LeaderProfileByAddressInput = z.infer<typeof LeaderProfileByAddressSchema>;
export type UpsertLeaderProfileInput = z.infer<typeof UpsertLeaderProfileSchema>;
export type CopyVaultDepositInput = z.infer<typeof CopyVaultDepositSchema>;
export type CopyVaultWithdrawInput = z.infer<typeof CopyVaultWithdrawSchema>;
export type CopyTradeSignalInput = z.infer<typeof CopyTradeSignalSchema>;
export type CopyTradeApiKeyChallengeInput = z.infer<typeof CopyTradeApiKeyChallengeSchema>;
export type CopyTradeApiKeyInput = z.infer<typeof CopyTradeApiKeySchema>;
export type RetryTradeSettlementsInput = z.infer<typeof RetryTradeSettlementsSchema>;
//# sourceMappingURL=validation.d.ts.map