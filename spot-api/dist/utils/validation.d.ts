import { z } from 'zod';
export declare const CreateOrderSchema: z.ZodObject<{
    pairSymbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    type: z.ZodEnum<["LIMIT", "MARKET", "STOP", "STOP_LIMIT"]>;
    price: z.ZodOptional<z.ZodString>;
    stopPrice: z.ZodOptional<z.ZodString>;
    amount: z.ZodString;
    timeInForce: z.ZodDefault<z.ZodEnum<["GTC", "IOC", "FOK"]>>;
    nonce: z.ZodString;
    signature: z.ZodString;
    makerAddress: z.ZodString;
    expiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
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
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: string;
    signature: string;
    address: string;
    token: string;
}, {
    amount: string;
    signature: string;
    address: string;
    token?: string | undefined;
}>;
export declare const MarginOpenPositionSchema: z.ZodObject<{
    address: z.ZodString;
    pairSymbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    collateralAmount: z.ZodString;
    leverage: z.ZodString;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    side: "BUY" | "SELL";
    signature: string;
    pairSymbol: string;
    address: string;
    collateralAmount: string;
    leverage: string;
}, {
    side: "BUY" | "SELL";
    signature: string;
    pairSymbol: string;
    address: string;
    collateralAmount: string;
    leverage: string;
}>;
export declare const MarginClosePositionSchema: z.ZodObject<{
    address: z.ZodString;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    signature: string;
    address: string;
}, {
    signature: string;
    address: string;
}>;
export declare const MarginLiquidatePositionSchema: z.ZodObject<{
    liquidatorAddress: z.ZodString;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    signature: string;
    liquidatorAddress: string;
}, {
    signature: string;
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
    tab?: "all" | "traders" | "bots" | undefined;
    search?: string | undefined;
}, {
    limit?: number | undefined;
    tab?: "all" | "traders" | "bots" | undefined;
    search?: string | undefined;
    sortBy?: "roi30d" | "followers" | "winRate" | "sharpe" | undefined;
}>;
export declare const FollowLeaderSchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
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
    address: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
    content: string;
}, {
    address: string;
    content: string;
}>;
export declare const CopyVaultDepositSchema: z.ZodObject<{
    followerAddress: z.ZodString;
    token: z.ZodString;
    amount: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: string;
    token: string;
    followerAddress: string;
}, {
    amount: string;
    token: string;
    followerAddress: string;
}>;
export declare const CopyVaultWithdrawSchema: z.ZodObject<{
    followerAddress: z.ZodString;
    shares: z.ZodString;
}, "strip", z.ZodTypeAny, {
    followerAddress: string;
    shares: string;
}, {
    followerAddress: string;
    shares: string;
}>;
export declare const CopyTradeSignalSchema: z.ZodObject<{
    leaderId: z.ZodOptional<z.ZodString>;
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
}, "strip", z.ZodTypeAny, {
    side: "BUY" | "SELL";
    pairSymbol: string;
    source: "API" | "WEB3";
    amountIn: string;
    amountOutMin: string;
    maxSlippageBps: number;
    leaderId?: string | undefined;
    strategyTag?: string | undefined;
    route?: string[] | undefined;
    executionPrice?: string | undefined;
    realizedPnlPct?: string | undefined;
}, {
    side: "BUY" | "SELL";
    pairSymbol: string;
    amountIn: string;
    amountOutMin: string;
    leaderId?: string | undefined;
    source?: "API" | "WEB3" | undefined;
    strategyTag?: string | undefined;
    route?: string[] | undefined;
    maxSlippageBps?: number | undefined;
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
    address?: string | undefined;
    limit?: number | undefined;
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