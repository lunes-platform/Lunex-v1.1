export interface PerformanceFeeResult {
    profitAmount: number;
    feeAmount: number;
    highWaterMarkConsumed: number;
    remainingHighWaterMark: number;
}
export declare function toNumber(value: string | number): number;
export declare function calculateSharesToMint(depositAmount: string | number, totalShares: string | number, totalEquity: string | number): number;
export declare function calculateGrossWithdrawal(sharesToBurn: string | number, totalShares: string | number, totalEquity: string | number): number;
export declare function calculatePerformanceFeeOnWithdrawal(params: {
    grossAmount: string | number;
    sharesToBurn: string | number;
    shareBalanceBefore: string | number;
    highWaterMarkValue: string | number;
    performanceFeeBps: number;
}): PerformanceFeeResult;
export declare function calculatePositionValue(shareBalance: string | number, totalShares: string | number, totalEquity: string | number): number;
export declare function planTwapSlices(totalAmount: string | number, threshold: string | number): number[];
export declare function hashApiKey(apiKey: string): string;
export declare function abbreviateAum(value: string | number): string;
export declare function formatMemberSince(date: Date): string;
export declare function deriveAmountOut(params: {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    amountIn: number;
    executionPrice: number;
}): number;
//# sourceMappingURL=copytrade.d.ts.map