/**
 * Order Service — Lunex Spot Exchange
 *
 * Manages the full lifecycle of a spot order:
 *   1. Zod validation + sr25519 signature verification
 *   2. Nonce replay-protection check (Redis)
 *   3. DB persistence (status: OPEN)
 *   4. In-memory orderbook insertion
 *   5. FIFO, price-time priority matching engine
 *   6. Trade recording and settlement scheduling
 *   7. WebSocket broadcast (orderbook:PAIR, user:ADDRESS)
 *
 * Order Types:
 *   - LIMIT       — Rests in book until matched or cancelled
 *   - MARKET      — Matches immediately at best available price
 *   - STOP_LIMIT  — Triggers a LIMIT order when stop price is reached
 *   - STOP_MARKET — Triggers a MARKET order when stop price is reached
 *
 * Time In Force:
 *   - GTC (Good Till Cancel) — Rests until manually cancelled
 *   - IOC (Immediate or Cancel) — Fills what it can, cancels remainder
 *   - FOK (Fill or Kill) — Must fill entirely or is cancelled
 *
 * @module orderService
 */
import prisma from '../db';
import { orderbookManager, MatchResult } from '../utils/orderbook';
import {
  accountAddressFilter,
  CreateOrderInput,
  isSameAccount,
  toCanonicalAddress,
} from '../utils/validation';
import { computeOrderHash, decimalToNumber } from '../utils/helpers';
import { tradeService } from './tradeService';
import { Decimal } from '@prisma/client/runtime/library';
import { settlementService } from './settlementService';
import { walletRiskService } from './walletRiskService';
import { withMatchingLock } from './matchingLockService';
import { rehydrateOrderbookForPair } from './orderbookBootstrapService';
import type { Prisma, OrderStatus } from '@prisma/client';
import { ApiError } from '../middleware/errors';
import { balanceService } from './balanceService';
import {
  spotAssetKey,
  toSpotUnits,
  quoteReserveUnits,
} from '../utils/spotReservation';
import { broadcastOrderbook } from '../websocket/server';

const STOP_PENDING_STATUS = 'PENDING_TRIGGER';

/** Off-chain signature markers used by agent/router orders. */
const isSyntheticOrderSignature = (signature: string) =>
  signature.startsWith('agent:') || signature.startsWith('manual:');

/** Per-maker admission lock key (see createOrder). */
const makerLockKey = (makerAddress: string) => `maker:${makerAddress}`;

async function getReferencePrice(
  pairId: string,
  pairSymbol: string,
): Promise<number | null> {
  const lastTrade = await prisma.trade.findFirst({
    where: { pairId },
    orderBy: { createdAt: 'desc' },
  });

  if (lastTrade) {
    return decimalToNumber(lastTrade.price);
  }

  const book = orderbookManager.get(pairSymbol);
  if (!book) return null;

  const bestBid = book.getBestBid();
  const bestAsk = book.getBestAsk();

  if (bestBid !== null && bestAsk !== null) {
    return (bestBid + bestAsk) / 2;
  }

  return bestBid ?? bestAsk ?? null;
}

function isStopTriggered(
  order: { side: string; stopPrice: Decimal | null },
  referencePrice: number,
) {
  const stopPrice = order.stopPrice ? decimalToNumber(order.stopPrice) : 0;
  if (stopPrice <= 0) return false;

  return order.side === 'BUY'
    ? referencePrice >= stopPrice
    : referencePrice <= stopPrice;
}

function sanitizeOrderForUserRead<T extends Record<string, unknown>>(order: T) {
  const { signature, nonce, orderHash, ...safeOrder } = order;
  void signature;
  void nonce;
  void orderHash;
  return safeOrder;
}

async function finalizeMarketLikeOrder(orderId: string) {
  const currentOrder = await prisma.order.findUnique({
    where: { id: orderId },
  });
  if (!currentOrder) throw new Error('Order not found after execution');

  if (currentOrder.remainingAmount.gt(0) && currentOrder.status !== 'FILLED') {
    return prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }

  return currentOrder;
}

async function executeOrderOnBook(
  pairId: string,
  pairSymbol: string,
  order: {
    id: string;
    side: string;
    type: string;
    price: Decimal;
    remainingAmount: Decimal;
    makerAddress: string;
    timeInForce?: string;
  },
) {
  const executableAmount = decimalToNumber(order.remainingAmount);
  if (executableAmount <= 0) {
    return prisma.order.findUnique({ where: { id: order.id } });
  }

  const book = orderbookManager.getOrCreate(pairSymbol);
  const checkpoint = book.createCheckpoint();
  let matches: MatchResult[];

  try {
    if (order.type === 'MARKET' || order.type === 'STOP') {
      matches = book.addMarketOrder(
        order.id,
        order.side as 'BUY' | 'SELL',
        executableAmount,
        order.makerAddress,
      );
    } else {
      matches = book.addLimitOrder(
        order.id,
        order.side as 'BUY' | 'SELL',
        decimalToNumber(order.price),
        executableAmount,
        order.makerAddress,
      );
    }

    if (
      order.timeInForce === 'FOK' &&
      !matches
        .reduce(
          (sum, match) => sum.plus(match.fillAmount.toString()),
          new Decimal(0),
        )
        .eq(order.remainingAmount)
    ) {
      book.restoreCheckpoint(checkpoint);
      return prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
    }

    if (matches.length > 0) {
      await tradeService.processMatches(pairId, matches);
    }
  } catch (err) {
    book.restoreCheckpoint(checkpoint);
    throw err;
  }

  if (order.timeInForce === 'IOC' || order.timeInForce === 'FOK') {
    book.cancelOrder(order.id);
    return finalizeMarketLikeOrder(order.id);
  }

  if (order.type === 'MARKET' || order.type === 'STOP') {
    return finalizeMarketLikeOrder(order.id);
  }

  return prisma.order.findUnique({ where: { id: order.id } });
}

async function processTriggeredOrders(pairId: string, pairSymbol: string) {
  let iteration = 0;

  while (iteration < 20) {
    iteration += 1;

    const referencePrice = await getReferencePrice(pairId, pairSymbol);
    if (referencePrice === null) return;

    const pendingOrders = await prisma.order.findMany({
      where: {
        pairId,
        type: { in: ['STOP', 'STOP_LIMIT'] },
        status: STOP_PENDING_STATUS,
      },
      orderBy: { createdAt: 'asc' },
    });

    const triggeredOrder = pendingOrders.find(
      (order) =>
        (!order.expiresAt || order.expiresAt.getTime() > Date.now()) &&
        isStopTriggered(order, referencePrice),
    );
    if (!triggeredOrder) return;

    const activatedOrder = await prisma.order.update({
      where: { id: triggeredOrder.id },
      data: { status: 'OPEN' },
    });

    await executeOrderOnBook(pairId, pairSymbol, activatedOrder);
  }
}

async function estimateRequiredQuoteUnits(
  pair: {
    id: string;
    symbol: string;
    quoteDecimals: number;
    makerFeeBps?: number;
    takerFeeBps?: number;
  },
  order: {
    type: string;
    price?: string | Decimal | null;
    stopPrice?: string | Decimal | null;
    amount: string | Decimal;
  },
) {
  let executionPrice = parseFloat(order.price?.toString() || '0');

  if (
    executionPrice <= 0 &&
    (order.type === 'STOP' || order.type === 'STOP_LIMIT')
  ) {
    executionPrice = parseFloat(order.stopPrice?.toString() || '0');
  }

  if (executionPrice <= 0) {
    executionPrice = (await getReferencePrice(pair.id, pair.symbol)) || 0;
  }

  if (executionPrice <= 0) {
    throw new Error(
      'Unable to estimate quote required for BUY order from on-chain vault state',
    );
  }

  const exactPrice = new Decimal(order.price?.toString() || '0').gt(0)
    ? order.price!.toString()
    : executionPrice.toString();
  return quoteReserveUnits(exactPrice, order.amount.toString(), pair);
}

async function getReservedVaultAmounts(
  makerAddress: string,
  tokenAddress: string,
  decimals: number,
  isNative: boolean,
) {
  const locked = await balanceService.computeLockedByToken(makerAddress);
  return toSpotUnits(
    (
      locked.get(spotAssetKey(tokenAddress, isNative)) ?? new Decimal(0)
    ).toString(),
    decimals,
  );
}

async function assertValidOnChainState(
  pair: {
    id: string;
    symbol: string;
    baseToken: string;
    quoteToken: string;
    baseDecimals: number;
    quoteDecimals: number;
    isNativeBase: boolean;
    isNativeQuote: boolean;
  },
  input: CreateOrderInput,
) {
  const settlementEnabled = settlementService.isEnabled();
  const onChainNonceUsed = await settlementService.isNonceUsed(
    input.makerAddress,
    input.nonce,
  );
  if (settlementEnabled && onChainNonceUsed === null) {
    throw ApiError.internal('On-chain nonce validation unavailable');
  }
  if (onChainNonceUsed) throw ApiError.conflict('Nonce already used on-chain');

  const onChainNonceCancelled = await settlementService.isNonceCancelled(
    input.makerAddress,
    input.nonce,
  );
  if (settlementEnabled && onChainNonceCancelled === null) {
    throw ApiError.internal('On-chain cancel validation unavailable');
  }
  if (onChainNonceCancelled)
    throw ApiError.conflict('Nonce already cancelled on-chain');

  const baseAmount = toSpotUnits(input.amount, pair.baseDecimals);
  const requiredBase = input.side === 'SELL' ? baseAmount : 0n;

  let requiredQuote = 0n;
  if (input.side === 'BUY') {
    requiredQuote = await estimateRequiredQuoteUnits(pair, {
      type: input.type,
      price: input.price,
      stopPrice: input.stopPrice,
      amount: input.amount,
    });
  }

  if (requiredBase > 0n) {
    const baseBalance = await settlementService.getVaultBalance(
      input.makerAddress,
      pair.baseToken,
      pair.isNativeBase,
    );
    if (settlementEnabled && baseBalance === null) {
      throw new Error('On-chain base balance validation unavailable');
    }
    const reservedBase = await getReservedVaultAmounts(
      input.makerAddress,
      pair.baseToken,
      pair.baseDecimals,
      pair.isNativeBase,
    );
    if (baseBalance !== null && baseBalance - reservedBase < requiredBase) {
      throw ApiError.badRequest(
        'Insufficient base token balance in Spot vault',
      );
    }
  }

  if (requiredQuote > 0n) {
    const quoteBalance = await settlementService.getVaultBalance(
      input.makerAddress,
      pair.quoteToken,
      pair.isNativeQuote,
    );
    if (settlementEnabled && quoteBalance === null) {
      throw new Error('On-chain quote balance validation unavailable');
    }
    const reservedQuote = await getReservedVaultAmounts(
      input.makerAddress,
      pair.quoteToken,
      pair.quoteDecimals,
      pair.isNativeQuote,
    );
    if (quoteBalance !== null && quoteBalance - reservedQuote < requiredQuote) {
      throw ApiError.badRequest(
        'Insufficient quote token balance in Spot vault',
      );
    }
  }
}

export const orderService = {
  /**
   * Create a new order, attempt matching, persist to DB
   */
  async createOrder(rawInput: CreateOrderInput) {
    // M-09: one string per key for storage, ban check, balance reservation
    // and self-trade comparison. Agent API-key orders reach here with
    // `agent.walletAddress`, which no request schema normalized.
    const makerAddress = toCanonicalAddress(rawInput.makerAddress);
    if (!makerAddress) throw ApiError.badRequest('Invalid maker address');
    const input: CreateOrderInput = { ...rawInput, makerAddress };

    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      throw ApiError.badRequest('Order already expired');
    }
    // Synthetic `agent:` / `manual:` markers are not wallet sr25519 signatures
    // over the order message: settlement (assertOrderTrustedSource) always
    // rejects them, so with on-chain settlement on such an order would only
    // consume counterparty liquidity and produce trades that never settle.
    // Same gate as routes/tradeApi.ts /swap and /limit, before any side effect.
    if (
      settlementService.isEnabled() &&
      isSyntheticOrderSignature(input.signature)
    ) {
      throw new ApiError(
        409,
        'SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED',
        'Orders without a wallet signature cannot be settled on-chain',
      );
    }
    // 1. Find pair
    const pair = await prisma.pair.findUnique({
      where: { symbol: input.pairSymbol },
    });
    if (!pair) throw ApiError.notFound(`Pair ${input.pairSymbol} not found`);
    if (!pair.isActive)
      throw ApiError.badRequest(`Pair ${input.pairSymbol} is not active`);

    await walletRiskService.assertWalletCanAct(input.makerAddress);

    // 2. Validate price for executable order types
    const price = input.price || '0';
    if (
      (input.type === 'LIMIT' || input.type === 'STOP_LIMIT') &&
      parseFloat(price) <= 0
    ) {
      throw new Error('Price required for LIMIT/STOP_LIMIT orders');
    }
    if (
      (input.type === 'STOP' || input.type === 'STOP_LIMIT') &&
      parseFloat(input.stopPrice || '0') <= 0
    ) {
      throw new Error('stopPrice required for STOP/STOP_LIMIT orders');
    }

    // 3. Compute order hash
    const orderHash = computeOrderHash({
      makerAddress: input.makerAddress,
      pairSymbol: input.pairSymbol,
      side: input.side,
      type: input.type,
      price,
      stopPrice: input.stopPrice,
      amount: input.amount,
      nonce: input.nonce,
      timeInForce: input.timeInForce,
      expiresAt: input.expiresAt || null,
    });

    // 4. Check nonce uniqueness
    const existing = await prisma.order.findFirst({
      where: {
        makerAddress: input.makerAddress,
        nonce: input.nonce,
      },
    });
    if (existing) throw ApiError.conflict('Nonce already used');

    // Lock order: maker (outer) → pair (inner). The pair lock alone does not
    // serialize two orders of the same maker on DIFFERENT pairs that share a
    // vault token (e.g. LUNES as base on one pair and quote on another): both
    // would pass the balance check against the same funds. Nothing acquires
    // these locks in the opposite order, so nesting cannot deadlock.
    return withMatchingLock(makerLockKey(input.makerAddress), () =>
      withMatchingLock(pair.symbol, async () => {
        await rehydrateOrderbookForPair(pair.id, pair.symbol);
        await assertValidOnChainState(pair, input);

        if (
          input.expiresAt &&
          new Date(input.expiresAt).getTime() <= Date.now()
        ) {
          throw ApiError.badRequest('Order already expired');
        }

        // 5. Create order in DB
        const order = await prisma.order.create({
          data: {
            pairId: pair.id,
            makerAddress: input.makerAddress,
            side: input.side,
            type: input.type,
            price: new Decimal(price),
            stopPrice: input.stopPrice ? new Decimal(input.stopPrice) : null,
            amount: new Decimal(input.amount),
            remainingAmount: new Decimal(input.amount),
            filledAmount: new Decimal('0'),
            status:
              input.type === 'STOP' || input.type === 'STOP_LIMIT'
                ? STOP_PENDING_STATUS
                : 'OPEN',
            signature: input.signature,
            signatureTimestamp: new Date(input.timestamp),
            nonce: input.nonce,
            orderHash,
            timeInForce: input.timeInForce,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          },
        });

        // 6. Add active orders to the in-memory book and attempt matching
        if (input.type === 'LIMIT' || input.type === 'MARKET') {
          await executeOrderOnBook(pair.id, pair.symbol, order);
        }

        await processTriggeredOrders(pair.id, pair.symbol);
        broadcastOrderbook(pair.symbol);

        return prisma.order.findUnique({ where: { id: order.id } });
      }),
    );
  },

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, makerAddress: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw ApiError.notFound('Order not found');
    // Account ids, not strings: the order may be stored under another prefix.
    if (!isSameAccount(order.makerAddress, makerAddress))
      throw ApiError.forbidden('Not order owner');
    if (order.status === 'FILLED')
      throw ApiError.conflict('Order already filled');
    if (order.status === 'CANCELLED')
      throw ApiError.conflict('Order already cancelled');

    const pair = await prisma.pair.findUnique({ where: { id: order.pairId } });
    if (!pair) throw ApiError.notFound('Pair not found');

    return withMatchingLock(pair.symbol, async () => {
      await rehydrateOrderbookForPair(pair.id, pair.symbol);

      const lockedOrder = await prisma.order.findUnique({
        where: { id: orderId },
      });
      if (!lockedOrder) throw ApiError.notFound('Order not found');
      if (!isSameAccount(lockedOrder.makerAddress, makerAddress))
        throw ApiError.forbidden('Not order owner');
      if (lockedOrder.status === 'FILLED')
        throw ApiError.conflict('Order already filled');
      if (lockedOrder.status === 'CANCELLED')
        throw ApiError.conflict('Order already cancelled');

      const cancelTxHash = await settlementService.cancelOrderFor(
        makerAddress,
        lockedOrder.nonce,
      );
      if (settlementService.isEnabled() && cancelTxHash === null) {
        throw new Error('On-chain cancellation unavailable');
      }

      // Update DB first. The in-memory book is derived state and can be
      // rehydrated from the canonical DB state on the next locked mutation.
      const updated = await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });

      const book = orderbookManager.get(pair.symbol);
      if (book) book.cancelOrder(orderId);
      broadcastOrderbook(pair.symbol);

      return updated;
    });
  },

  /**
   * Get orders for a user
   */
  async getUserOrders(
    makerAddress: string,
    status?: string,
    limit = 50,
    offset = 0,
  ) {
    // M-09: canonical rows plus legacy rows under the string given.
    const where: Prisma.OrderWhereInput = {
      makerAddress: accountAddressFilter(makerAddress),
    };
    if (status) where.status = status as OrderStatus;

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { pair: { select: { symbol: true } } },
    });

    return orders.map((order) => sanitizeOrderForUserRead(order));
  },

  /**
   * Get open orders for a pair (for API)
   */
  async getOpenOrders(pairSymbol: string, limit = 50) {
    const pair = await prisma.pair.findUnique({
      where: { symbol: pairSymbol },
    });
    if (!pair) throw new Error('Pair not found');

    return prisma.order.findMany({
      where: { pairId: pair.id, status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
