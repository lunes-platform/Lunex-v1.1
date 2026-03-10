type PairSettlementSnapshot = {
    baseToken: string;
    quoteToken: string;
    isNativeBase: boolean;
    isNativeQuote: boolean;
    baseDecimals: number;
};
type OrderSettlementSnapshot = {
    makerAddress: string;
    side: string;
    price: string;
    amount: string;
    filledAmount: string;
    nonce: string;
    expiresAt: Date | null;
};
export type TradeSettlementInput = {
    tradeId: string;
    pair: PairSettlementSnapshot;
    makerOrder: OrderSettlementSnapshot;
    takerOrder: OrderSettlementSnapshot;
    fillAmount: string;
    fillPrice: string;
};
export type SettlementResult = {
    tradeId: string;
    status: 'SETTLED' | 'FAILED' | 'SKIPPED';
    txHash?: string;
    error?: string;
};
declare class SpotSettlementService {
    private api;
    private contract;
    private relayer;
    private settleMethodKey;
    private getBalanceMethodKey;
    private isNonceUsedMethodKey;
    private isNonceCancelledMethodKey;
    private cancelOrderForMethodKey;
    private initPromise;
    private isConfigured;
    isEnabled(): boolean;
    ensureReady(): Promise<boolean>;
    private initialize;
    private toAccountId;
    private toUserAccountId;
    private getQueryMethod;
    private getTxMethod;
    getVaultBalance(userAddress: string, tokenAddress: string, isNative: boolean): Promise<bigint | null>;
    isNonceUsed(userAddress: string, nonce: string): Promise<boolean | null>;
    isNonceCancelled(userAddress: string, nonce: string): Promise<boolean | null>;
    private toSignedOrder;
    private submitSettlement;
    settleTrades(inputs: TradeSettlementInput[]): Promise<SettlementResult[]>;
    cancelOrderFor(makerAddress: string, nonce: string): Promise<string | null>;
}
export declare const settlementService: SpotSettlementService;
export {};
//# sourceMappingURL=settlementService.d.ts.map