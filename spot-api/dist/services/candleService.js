"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.candleService = void 0;
const db_1 = __importDefault(require("../db"));
const helpers_1 = require("../utils/helpers");
const library_1 = require("@prisma/client/runtime/library");
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
exports.candleService = {
    /**
     * Update or create candles for all timeframes when a trade occurs
     */
    async updateCandle(pairId, price, amount, quoteVolume) {
        const now = new Date();
        for (const tf of TIMEFRAMES) {
            const openTime = (0, helpers_1.getCandleOpenTime)(now, tf);
            const priceDecimal = new library_1.Decimal(price.toString());
            const volumeDecimal = new library_1.Decimal(amount.toString());
            const quoteVolumeDecimal = new library_1.Decimal(quoteVolume.toString());
            const existing = await db_1.default.candle.findUnique({
                where: {
                    pairId_timeframe_openTime: {
                        pairId,
                        timeframe: tf,
                        openTime,
                    },
                },
            });
            if (existing) {
                await db_1.default.candle.update({
                    where: { id: existing.id },
                    data: {
                        high: priceDecimal.gt(existing.high) ? priceDecimal : existing.high,
                        low: priceDecimal.lt(existing.low) ? priceDecimal : existing.low,
                        close: priceDecimal,
                        volume: new library_1.Decimal(existing.volume.toString()).plus(volumeDecimal),
                        quoteVolume: new library_1.Decimal(existing.quoteVolume.toString()).plus(quoteVolumeDecimal),
                        tradeCount: existing.tradeCount + 1,
                    },
                });
            }
            else {
                await db_1.default.candle.create({
                    data: {
                        pairId,
                        timeframe: tf,
                        openTime,
                        open: priceDecimal,
                        high: priceDecimal,
                        low: priceDecimal,
                        close: priceDecimal,
                        volume: volumeDecimal,
                        quoteVolume: quoteVolumeDecimal,
                        tradeCount: 1,
                    },
                });
            }
        }
    },
    /**
     * Get candles for a pair
     */
    async getCandles(pairSymbol, timeframe, limit = 200) {
        const pair = await db_1.default.pair.findUnique({ where: { symbol: pairSymbol } });
        if (!pair)
            throw new Error('Pair not found');
        return db_1.default.candle.findMany({
            where: { pairId: pair.id, timeframe },
            orderBy: { openTime: 'desc' },
            take: limit,
        });
    },
};
//# sourceMappingURL=candleService.js.map