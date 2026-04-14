import prisma from '../db';
import { getCandleOpenTime } from '../utils/helpers';
import { Decimal } from '@prisma/client/runtime/library';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export const candleService = {
  /**
   * Update or create candles for all timeframes when a trade occurs
   */
  async updateCandle(
    pairId: string,
    price: number,
    amount: number,
    quoteVolume: number,
  ) {
    const now = new Date();

    for (const tf of TIMEFRAMES) {
      const openTime = getCandleOpenTime(now, tf);
      const priceDecimal = new Decimal(price.toString());
      const volumeDecimal = new Decimal(amount.toString());
      const quoteVolumeDecimal = new Decimal(quoteVolume.toString());

      const existing = await prisma.candle.findUnique({
        where: {
          pairId_timeframe_openTime: {
            pairId,
            timeframe: tf,
            openTime,
          },
        },
      });

      if (existing) {
        await prisma.candle.update({
          where: { id: existing.id },
          data: {
            high: priceDecimal.gt(existing.high) ? priceDecimal : existing.high,
            low: priceDecimal.lt(existing.low) ? priceDecimal : existing.low,
            close: priceDecimal,
            volume: new Decimal(existing.volume.toString()).plus(volumeDecimal),
            quoteVolume: new Decimal(existing.quoteVolume.toString()).plus(
              quoteVolumeDecimal,
            ),
            tradeCount: existing.tradeCount + 1,
          },
        });
      } else {
        await prisma.candle.create({
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
  async getCandles(pairSymbol: string, timeframe: string, limit = 200) {
    const pair = await prisma.pair.findUnique({
      where: { symbol: pairSymbol },
    });
    if (!pair) throw new Error('Pair not found');

    return prisma.candle.findMany({
      where: { pairId: pair.id, timeframe },
      orderBy: { openTime: 'desc' },
      take: limit,
    });
  },
};
