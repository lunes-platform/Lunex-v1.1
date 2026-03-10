export interface EquityPoint {
    timestamp: number;
    equity: number;
}
export declare function toFiniteNumber(value: unknown): number;
export declare function roundMetric(value: number, decimals?: number): number;
export declare function sumNumbers(values: number[]): number;
export declare function calculateRoi(initialEquity: number, currentEquity: number): number;
export declare function calculateWinRate(winningTrades: number, totalTrades: number): number;
export declare function calculateAverageProfit(pnls: number[]): number;
export declare function calculateSharpe(returns: number[]): number;
export declare function calculateMaxDrawdown(points: EquityPoint[]): number;
export declare function buildPnlHistory(points: EquityPoint[], limit?: number): number[];
export declare function getWindowRoi(points: EquityPoint[], days: number, referenceTime?: number): number;
export declare function getSequentialReturns(points: EquityPoint[]): number[];
//# sourceMappingURL=socialAnalyticsMath.d.ts.map