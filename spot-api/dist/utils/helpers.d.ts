/**
 * Generate a deterministic order hash from order parameters
 */
export declare function computeOrderHash(params: {
    makerAddress: string;
    pairSymbol: string;
    side: string;
    type: string;
    price: string;
    stopPrice?: string | null;
    amount: string;
    nonce: string;
    timeInForce?: string | null;
    expiresAt?: string | null;
}): string;
/**
 * Format a Decimal to a number for orderbook operations
 */
export declare function decimalToNumber(val: any): number;
/**
 * Get the candle open time for a given timestamp and timeframe
 */
export declare function getCandleOpenTime(timestamp: Date, timeframe: string): Date;
//# sourceMappingURL=helpers.d.ts.map