import { Decimal } from '@prisma/client/runtime/library';
export declare const candleService: {
    /**
     * Update or create candles for all timeframes when a trade occurs
     */
    updateCandle(pairId: string, price: number, amount: number, quoteVolume: number): Promise<void>;
    /**
     * Get candles for a pair
     */
    getCandles(pairSymbol: string, timeframe: string, limit?: number): Promise<{
        close: Decimal;
        open: Decimal;
        id: string;
        pairId: string;
        timeframe: string;
        openTime: Date;
        high: Decimal;
        low: Decimal;
        volume: Decimal;
        quoteVolume: Decimal;
        tradeCount: number;
    }[]>;
};
//# sourceMappingURL=candleService.d.ts.map