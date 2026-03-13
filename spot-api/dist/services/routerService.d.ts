/**
 * Smart Router V2 — Lunex Protocol
 *
 * Simulates and compares three liquidity sources to find the optimal
 * execution path for a given trade:
 *
 *   1. AMM V1 (Uniswap V2 model)  — Pair.reserveX / reserveY via DB
 *   2. Orderbook                  — in-memory best bid/ask spread
 *   3. Asymmetric Pool (V2)       — parametric curve y = k·(1-x/x₀)^γ - t·x
 *
 * The router picks the route with the highest `amountOut` net of fees,
 * accounting for price impact on each source. When a route produces
 * insufficient liquidity, it is skipped with a `INSUFFICIENT_LIQUIDITY`
 * reason.
 *
 * Usage:
 *   const quote = await routerService.getQuote({ pairSymbol, side, amountIn })
 *   const exec  = await routerService.executeViaRouter({ ... })
 */
export type RoutingSource = 'AMM_V1' | 'ORDERBOOK' | 'ASYMMETRIC';
export interface RouteQuote {
    source: RoutingSource;
    amountIn: number;
    amountOut: number;
    effectivePrice: number;
    priceImpactBps: number;
    feeBps: number;
    txCostEstimate: 'LOW' | 'MEDIUM' | 'HIGH';
    available: boolean;
    unavailableReason?: string;
}
export interface SmartQuote {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    amountIn: number;
    bestRoute: RoutingSource;
    bestAmountOut: number;
    bestEffectivePrice: number;
    routes: RouteQuote[];
    computedAt: string;
}
export declare const routerService: {
    /**
     * Simulate all three liquidity sources and return quotes.
     * Does NOT execute any trade — purely read-only.
     */
    getQuote(params: {
        pairSymbol: string;
        side: "BUY" | "SELL";
        amountIn: number;
    }): Promise<SmartQuote>;
    /**
     * Execute a swap routed through the best available source.
     *
     * For AMM_V1 / ORDERBOOK: delegates to orderService (existing path).
     * For ASYMMETRIC: calls the on-chain contract via rebalancerService pattern.
     *
     * Returns the quote used and the execution result metadata.
     */
    executeViaRouter(params: {
        pairSymbol: string;
        side: "BUY" | "SELL";
        amountIn: number;
        maxSlippageBps?: number;
        makerAddress: string;
        nonce: string;
        agentId?: string;
    }): Promise<{
        quote: SmartQuote;
        executedVia: "AMM_V1" | "ORDERBOOK";
        order: {
            price: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            id: string;
            pairId: string;
            makerAddress: string;
            side: import(".prisma/client").$Enums.OrderSide;
            type: import(".prisma/client").$Enums.OrderType;
            stopPrice: import("@prisma/client/runtime/library").Decimal | null;
            filledAmount: import("@prisma/client/runtime/library").Decimal;
            remainingAmount: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.OrderStatus;
            signature: string;
            nonce: string;
            orderHash: string;
            timeInForce: import(".prisma/client").$Enums.TimeInForce;
            expiresAt: Date | null;
            createdAt: Date;
            updatedAt: Date;
        } | null;
        minAmountOut: number;
        success: boolean;
        requiresWalletSignature?: undefined;
        contractCallIntent?: undefined;
        message?: undefined;
    } | {
        quote: SmartQuote;
        executedVia: "ASYMMETRIC";
        success: boolean;
        requiresWalletSignature: boolean;
        contractCallIntent: {
            contractAddress: string;
            method: string;
            side: "BUY" | "SELL";
            amountIn: number;
            minAmountOut: number;
            makerAddress: string;
            nonce: string;
            agentId: string | null;
        };
        message: string;
        order?: undefined;
        minAmountOut?: undefined;
    }>;
};
//# sourceMappingURL=routerService.d.ts.map