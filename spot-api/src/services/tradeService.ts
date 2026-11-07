import prisma from '../db';
import { MatchResult } from '../utils/orderbook';
import { candleService } from './candleService';
import { Decimal } from '@prisma/client/runtime/library';
import { TradeSettlementInput } from './settlementService';
import {
  serializeSettlementInput,
  tradeSettlementService,
} from './tradeSettlementService';
import { affiliateService } from './affiliateService';
import { log } from '../utils/logger';
import { broadcast } from '../websocket/server';
import { orderbookManager } from '../utils/orderbook';

const prismaAny = prisma as any;

function sanitizeTradeForClient<T extends Record<string, unknown>>(trade: T) {
  const {
    pairId,
    makerOrderId,
    takerOrderId,
    settlementPayload,
    settlementError,
    settlementAttempts,
    lastSettlementAttemptAt,
    nextSettlementRetryAt,
    ...safeTrade
  } = trade;
  void pairId;
  void makerOrderId;
  void takerOrderId;
  void settlementPayload;
  void settlementError;
  void settlementAttempts;
  void lastSettlementAttemptAt;
  void nextSettlementRetryAt;
  return safeTrade;
}

export const tradeService = {
  /**
   * Process matches from the matching engine.
   * Updates orders, creates trades, updates candles.
   */
  async processMatches(pairId: string, matches: MatchResult[]) {
    const { trades, settlementInputs } = await prisma.$transaction(
      async (tx) => {
        const txAny = tx as any;
        const transactionTrades = [];
        const transactionSettlementInputs: TradeSettlementInput[] = [];

        for (const match of matches) {
          // 1. Update maker order
          const makerOrder = await tx.order.findUnique({
            where: { id: match.makerOrderId },
          });
          if (!makerOrder) throw new Error('Maker order not found');

          const makerNewFilled = new Decimal(
            makerOrder.filledAmount.toString(),
          ).plus(match.fillAmount.toString());
          const makerNewRemaining = new Decimal(
            makerOrder.amount.toString(),
          ).minus(makerNewFilled.toString());
          const makerStatus = makerNewRemaining.lte(0) ? 'FILLED' : 'PARTIAL';

          await tx.order.update({
            where: { id: match.makerOrderId },
            data: {
              filledAmount: makerNewFilled,
              remainingAmount: makerNewRemaining.lt(0)
                ? new Decimal(0)
                : makerNewRemaining,
              status: makerStatus,
            },
          });

          // 2. Update taker order
          const takerOrder = await tx.order.findUnique({
            where: { id: match.takerOrderId },
          });
          if (!takerOrder) throw new Error('Taker order not found');

          const takerNewFilled = new Decimal(
            takerOrder.filledAmount.toString(),
          ).plus(match.fillAmount.toString());
          const takerNewRemaining = new Decimal(
            takerOrder.amount.toString(),
          ).minus(takerNewFilled.toString());
          const takerStatus = takerNewRemaining.lte(0) ? 'FILLED' : 'PARTIAL';

          await tx.order.update({
            where: { id: match.takerOrderId },
            data: {
              filledAmount: takerNewFilled,
              remainingAmount: takerNewRemaining.lt(0)
                ? new Decimal(0)
                : takerNewRemaining,
              status: takerStatus,
            },
          });

          // 3. Get pair for fee calculation
          const pair = await tx.pair.findUnique({ where: { id: pairId } });
          if (!pair) throw new Error('Pair not found');

          const quoteAmount = match.fillAmount * match.fillPrice;
          const makerFee = (quoteAmount * pair.makerFeeBps) / 10000;
          const takerFee = (quoteAmount * pair.takerFeeBps) / 10000;

          // 4. Determine taker side
          const takerSide = takerOrder.side;

          const settlementInput: TradeSettlementInput = {
            tradeId: 'pending-trade-id',
            pair: {
              symbol: pair.symbol,
              baseToken: pair.baseToken,
              quoteToken: pair.quoteToken,
              isNativeBase: pair.isNativeBase,
              isNativeQuote: pair.isNativeQuote,
              baseDecimals: pair.baseDecimals,
            },
            makerOrder: {
              makerAddress: makerOrder.makerAddress,
              side: makerOrder.side,
              type: makerOrder.type,
              price: makerOrder.price.toString(),
              stopPrice: makerOrder.stopPrice?.toString() || null,
              amount: makerOrder.amount.toString(),
              filledAmount: makerOrder.filledAmount.toString(),
              nonce: makerOrder.nonce,
              signature: makerOrder.signature,
              signatureTimestamp: makerOrder.signatureTimestamp ?? null,
              expiresAt: makerOrder.expiresAt,
            },
            takerOrder: {
              makerAddress: takerOrder.makerAddress,
              side: takerOrder.side,
              type: takerOrder.type,
              price: takerOrder.price.toString(),
              stopPrice: takerOrder.stopPrice?.toString() || null,
              amount: takerOrder.amount.toString(),
              filledAmount: takerOrder.filledAmount.toString(),
              nonce: takerOrder.nonce,
              signature: takerOrder.signature,
              signatureTimestamp: takerOrder.signatureTimestamp ?? null,
              expiresAt: takerOrder.expiresAt,
            },
            fillAmount: match.fillAmount.toString(),
            fillPrice: match.fillPrice.toString(),
          };

          // 5. Create trade record (settlementPayload set after to use real trade ID)
          const newTrade = await txAny.trade.create({
            data: {
              pairId,
              makerOrderId: match.makerOrderId,
              takerOrderId: match.takerOrderId,
              makerAddress: match.makerAddress,
              takerAddress: match.takerAddress,
              side: takerSide,
              price: new Decimal(match.fillPrice.toString()),
              amount: new Decimal(match.fillAmount.toString()),
              quoteAmount: new Decimal(quoteAmount.toString()),
              makerFee: new Decimal(makerFee.toString()),
              takerFee: new Decimal(takerFee.toString()),
              settlementStatus: 'PENDING',
              settlementAttempts: 0,
              settlementPayload: null,
            },
          });

          const persistedSettlementInput = {
            ...settlementInput,
            tradeId: newTrade.id,
          };

          await txAny.trade.update({
            where: { id: newTrade.id },
            data: {
              settlementPayload: serializeSettlementInput(
                persistedSettlementInput,
              ),
            },
          });

          transactionSettlementInputs.push(persistedSettlementInput);
          transactionTrades.push(newTrade);
        }

        return {
          trades: transactionTrades,
          settlementInputs: transactionSettlementInputs,
        };
      },
    );

    for (const match of matches) {
      // 6. Update candles (outside transaction for performance)
      try {
        await candleService.updateCandle(
          pairId,
          match.fillPrice,
          match.fillAmount,
          match.fillPrice * match.fillAmount,
        );
      } catch (err) {
        log.error({ err }, 'Failed to update candle');
      }
    }

    try {
      await tradeSettlementService.processNewTradeSettlements(settlementInputs);
    } catch (err) {
      log.error(
        {
          err,
          tradeIds: settlementInputs.map((input) => input.tradeId),
        },
        'Trade settlement scheduling failed; trades remain retryable',
      );
    }

    // 7. Real-time push (best effort — never affects persisted state).
    //    Public channels carry no wallet addresses; each side of a fill gets
    //    a private `user:<address>` event (session-authenticated channel).
    try {
      publishTrades(pairId, trades);
    } catch (err) {
      log.error({ err, pairId }, 'Trade broadcast failed');
    }

    // Distribute affiliate commissions for each trade
    for (const trade of trades) {
      try {
        const pair = await prisma.pair.findUnique({
          where: { id: trade.pairId },
        });
        if (!pair) continue;
        const takerFee = parseFloat(trade.takerFee.toString());
        const makerFee = parseFloat(trade.makerFee.toString());
        if (takerFee > 0) {
          await affiliateService.distributeCommissions(
            trade.takerAddress,
            pair.quoteName,
            takerFee,
            'SPOT',
            trade.id,
          );
        }
        if (makerFee > 0) {
          await affiliateService.distributeCommissions(
            trade.makerAddress,
            pair.quoteName,
            makerFee,
            'SPOT',
            trade.id,
          );
        }
      } catch (err) {
        log.error(
          { err, tradeId: trade.id },
          'Affiliate commission distribution failed for trade',
        );
      }
    }

    return trades;
  },

  /**
   * Get recent trades for a pair
   */
  async getRecentTrades(pairSymbol: string, limit = 50) {
    const pair = await prisma.pair.findUnique({
      where: { symbol: pairSymbol },
    });
    if (!pair) throw new Error('Pair not found');

    const trades = await prisma.trade.findMany({
      where: { pairId: pair.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return trades.map((trade) => sanitizeTradeForClient(trade));
  },

  /**
   * Get trades for a specific user
   */
  async getUserTrades(address: string, limit = 50, offset = 0) {
    const trades = await prisma.trade.findMany({
      where: {
        OR: [{ makerAddress: address }, { takerAddress: address }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        pair: { select: { symbol: true } },
      },
    });

    return trades.map((trade) => sanitizeTradeForClient(trade));
  },

  async getTradesBySettlementStatus(
    status?: 'PENDING' | 'SETTLING' | 'SETTLED' | 'FAILED' | 'SKIPPED',
    limit = 50,
    offset = 0,
  ) {
    return prismaAny.trade.findMany({
      where: status ? { settlementStatus: status } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      skip: offset,
      include: {
        pair: { select: { symbol: true } },
      },
    });
  },

  async retryTradeSettlements(limit = 25) {
    return tradeSettlementService.retryPendingSettlements(limit);
  },
};

type BroadcastTrade = {
  id: string;
  pairId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerAddress: string;
  takerAddress: string;
  side: string;
  price: { toString(): string };
  amount: { toString(): string };
  quoteAmount: { toString(): string };
  createdAt?: Date;
};

const pairSymbolCache = new Map<string, string>();

async function resolvePairSymbol(pairId: string) {
  const cached = pairSymbolCache.get(pairId);
  if (cached) return cached;
  const pair = await prisma.pair.findUnique({ where: { id: pairId } });
  if (pair?.symbol) pairSymbolCache.set(pairId, pair.symbol);
  return pair?.symbol ?? null;
}

function publishTrades(pairId: string, trades: BroadcastTrade[]) {
  if (!trades.length) return;
  void resolvePairSymbol(pairId)
    .then((symbol) => {
      if (!symbol) return;
      for (const t of trades) {
        const createdAt = (t.createdAt ?? new Date()).toISOString();
        const base = {
          id: t.id,
          pairId: t.pairId,
          side: t.side,
          price: t.price.toString(),
          amount: t.amount.toString(),
          quoteAmount: t.quoteAmount.toString(),
          createdAt,
        };
        broadcast(`trades:${symbol}`, base);
        const makerSide = t.side === 'BUY' ? 'SELL' : 'BUY';
        broadcast(`user:${t.makerAddress}`, {
          type: 'fill',
          role: 'maker',
          pairSymbol: symbol,
          orderId: t.makerOrderId,
          tradeId: t.id,
          side: makerSide,
          price: base.price,
          amount: base.amount,
          createdAt,
        });
        if (t.takerAddress !== t.makerAddress) {
          broadcast(`user:${t.takerAddress}`, {
            type: 'fill',
            role: 'taker',
            pairSymbol: symbol,
            orderId: t.takerOrderId,
            tradeId: t.id,
            side: t.side,
            price: base.price,
            amount: base.amount,
            createdAt,
          });
        }
      }
      const book = orderbookManager.get(symbol);
      if (book) broadcast(`orderbook:${symbol}`, book.getSnapshot(10));
    })
    .catch((err: unknown) => {
      log.error({ err, pairId }, 'Trade broadcast: pair lookup failed');
    });
}
