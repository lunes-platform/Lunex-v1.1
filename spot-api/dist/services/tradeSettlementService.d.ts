import { SettlementResult, TradeSettlementInput } from './settlementService';
type SerializedTradeSettlementInput = Omit<TradeSettlementInput, 'makerOrder' | 'takerOrder'> & {
    makerOrder: Omit<TradeSettlementInput['makerOrder'], 'expiresAt'> & {
        expiresAt: string | null;
    };
    takerOrder: Omit<TradeSettlementInput['takerOrder'], 'expiresAt'> & {
        expiresAt: string | null;
    };
};
export declare function serializeSettlementInput(input: TradeSettlementInput): SerializedTradeSettlementInput;
export declare function deserializeSettlementInput(payload: SerializedTradeSettlementInput): TradeSettlementInput;
export declare const tradeSettlementService: {
    processNewTradeSettlements(inputs: TradeSettlementInput[]): Promise<SettlementResult[] | {
        tradeId: string;
        status: "SKIPPED";
        error: string;
    }[]>;
    retryPendingSettlements(limit?: number): Promise<{
        processed: number;
        settled: number;
        failed: number;
    }>;
};
export {};
//# sourceMappingURL=tradeSettlementService.d.ts.map