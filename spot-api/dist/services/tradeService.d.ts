import { MatchResult } from '../utils/orderbook';
import { Decimal } from '@prisma/client/runtime/library';
export declare const tradeService: {
    /**
     * Process matches from the matching engine.
     * Updates orders, creates trades, updates candles.
     */
    processMatches(pairId: string, matches: MatchResult[]): Promise<any[]>;
    /**
     * Get recent trades for a pair
     */
    getRecentTrades(pairSymbol: string, limit?: number): Promise<{
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        createdAt: Date;
        makerOrderId: string;
        takerOrderId: string;
        takerAddress: string;
        quoteAmount: Decimal;
        makerFee: Decimal;
        takerFee: Decimal;
        settlementStatus: import(".prisma/client").$Enums.TradeSettlementStatus;
        settlementAttempts: number;
        settlementPayload: import("@prisma/client/runtime/library").JsonValue | null;
        settlementError: string | null;
        lastSettlementAttemptAt: Date | null;
        nextSettlementRetryAt: Date | null;
        txHash: string | null;
        settledAt: Date | null;
    }[]>;
    /**
     * Get trades for a specific user
     */
    getUserTrades(address: string, limit?: number, offset?: number): Promise<({
        pair: {
            symbol: string;
        };
    } & {
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        createdAt: Date;
        makerOrderId: string;
        takerOrderId: string;
        takerAddress: string;
        quoteAmount: Decimal;
        makerFee: Decimal;
        takerFee: Decimal;
        settlementStatus: import(".prisma/client").$Enums.TradeSettlementStatus;
        settlementAttempts: number;
        settlementPayload: import("@prisma/client/runtime/library").JsonValue | null;
        settlementError: string | null;
        lastSettlementAttemptAt: Date | null;
        nextSettlementRetryAt: Date | null;
        txHash: string | null;
        settledAt: Date | null;
    })[]>;
    getTradesBySettlementStatus(status?: "PENDING" | "SETTLING" | "SETTLED" | "FAILED" | "SKIPPED", limit?: number, offset?: number): Promise<any>;
    retryTradeSettlements(limit?: number): Promise<{
        processed: number;
        settled: number;
        failed: number;
    }>;
};
//# sourceMappingURL=tradeService.d.ts.map