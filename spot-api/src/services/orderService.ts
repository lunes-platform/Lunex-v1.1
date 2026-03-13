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
import prisma from '../db'
import { orderbookManager, MatchResult } from '../utils/orderbook'
import { CreateOrderInput } from '../utils/validation'
import { computeOrderHash, decimalToNumber } from '../utils/helpers'
import { tradeService } from './tradeService'
import { Decimal } from '@prisma/client/runtime/library'
import { settlementService } from './settlementService'
import type { Prisma, OrderStatus } from '@prisma/client'
import { ApiError } from '../middleware/errors'

const STOP_PENDING_STATUS = 'PENDING_TRIGGER'

function decimalToUnits(value: string, decimals: number) {
  const normalized = value.trim()
  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized
  const [wholePart, fractionPart = ''] = unsigned.split('.')
  const base = 10n ** BigInt(decimals)
  const whole = BigInt(wholePart || '0') * base
  const fraction = BigInt((fractionPart + '0'.repeat(decimals)).slice(0, decimals) || '0')
  const result = whole + fraction
  return negative ? -result : result
}

async function getReferencePrice(pairId: string, pairSymbol: string): Promise<number | null> {
  const lastTrade = await prisma.trade.findFirst({
    where: { pairId },
    orderBy: { createdAt: 'desc' },
  })

  if (lastTrade) {
    return decimalToNumber(lastTrade.price)
  }

  const book = orderbookManager.get(pairSymbol)
  if (!book) return null

  const bestBid = book.getBestBid()
  const bestAsk = book.getBestAsk()

  if (bestBid !== null && bestAsk !== null) {
    return (bestBid + bestAsk) / 2
  }

  return bestBid ?? bestAsk ?? null
}

function isStopTriggered(
  order: { side: string; stopPrice: Decimal | null },
  referencePrice: number,
) {
  const stopPrice = order.stopPrice ? decimalToNumber(order.stopPrice) : 0
  if (stopPrice <= 0) return false

  return order.side === 'BUY'
    ? referencePrice >= stopPrice
    : referencePrice <= stopPrice
}

async function finalizeMarketLikeOrder(orderId: string) {
  const currentOrder = await prisma.order.findUnique({ where: { id: orderId } })
  if (!currentOrder) throw new Error('Order not found after execution')

  if (currentOrder.remainingAmount.gt(0) && currentOrder.status !== 'FILLED') {
    return prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    })
  }

  return currentOrder
}

async function executeOrderOnBook(
  pairId: string,
  pairSymbol: string,
  order: {
    id: string
    side: string
    type: string
    price: Decimal
    remainingAmount: Decimal
    makerAddress: string
  },
) {
  const executableAmount = decimalToNumber(order.remainingAmount)
  if (executableAmount <= 0) {
    return prisma.order.findUnique({ where: { id: order.id } })
  }

  const book = orderbookManager.getOrCreate(pairSymbol)
  let matches: MatchResult[]

  if (order.type === 'MARKET' || order.type === 'STOP') {
    matches = book.addMarketOrder(
      order.id,
      order.side as 'BUY' | 'SELL',
      executableAmount,
      order.makerAddress,
    )
  } else {
    matches = book.addLimitOrder(
      order.id,
      order.side as 'BUY' | 'SELL',
      decimalToNumber(order.price),
      executableAmount,
      order.makerAddress,
    )
  }

  if (matches.length > 0) {
    await tradeService.processMatches(pairId, matches)
  }

  if (order.type === 'MARKET' || order.type === 'STOP') {
    return finalizeMarketLikeOrder(order.id)
  }

  return prisma.order.findUnique({ where: { id: order.id } })
}

async function processTriggeredOrders(pairId: string, pairSymbol: string) {
  let iteration = 0

  while (iteration < 20) {
    iteration += 1

    const referencePrice = await getReferencePrice(pairId, pairSymbol)
    if (referencePrice === null) return

    const pendingOrders = await prisma.order.findMany({
      where: {
        pairId,
        type: { in: ['STOP', 'STOP_LIMIT'] },
        status: STOP_PENDING_STATUS,
      },
      orderBy: { createdAt: 'asc' },
    })

    const triggeredOrder = pendingOrders.find((order) => isStopTriggered(order, referencePrice))
    if (!triggeredOrder) return

    const activatedOrder = await prisma.order.update({
      where: { id: triggeredOrder.id },
      data: { status: 'OPEN' },
    })

    await executeOrderOnBook(pairId, pairSymbol, activatedOrder)
  }
}

async function estimateRequiredQuoteUnits(
  pair: {
    id: string
    symbol: string
    quoteDecimals: number
  },
  order: {
    type: string
    price?: string | Decimal | null
    stopPrice?: string | Decimal | null
    amount: string | Decimal
  },
) {
  let executionPrice = parseFloat(order.price?.toString() || '0')

  if (executionPrice <= 0 && (order.type === 'STOP' || order.type === 'STOP_LIMIT')) {
    executionPrice = parseFloat(order.stopPrice?.toString() || '0')
  }

  if (executionPrice <= 0) {
    executionPrice = (await getReferencePrice(pair.id, pair.symbol)) || 0
  }

  if (executionPrice <= 0) {
    throw new Error('Unable to estimate quote required for BUY order from on-chain vault state')
  }

  const quoteEstimate = executionPrice * parseFloat(order.amount.toString())
  return decimalToUnits(quoteEstimate.toFixed(pair.quoteDecimals), pair.quoteDecimals)
}

async function getReservedVaultAmounts(
  makerAddress: string,
  tokenAddress: string,
  side: 'BUY' | 'SELL',
) {
  const relevantOrders = await prisma.order.findMany({
    where: {
      makerAddress,
      status: { in: ['OPEN', 'PARTIAL', STOP_PENDING_STATUS] },
    },
    include: {
      pair: true,
    },
  })

  let reserved = 0n

  for (const order of relevantOrders) {
    if (side === 'SELL' && order.side === 'SELL' && order.pair.baseToken === tokenAddress) {
      reserved += decimalToUnits(order.remainingAmount.toString(), order.pair.baseDecimals)
    }

    if (side === 'BUY' && order.side === 'BUY' && order.pair.quoteToken === tokenAddress) {
      reserved += await estimateRequiredQuoteUnits(
        {
          id: order.pair.id,
          symbol: order.pair.symbol,
          quoteDecimals: order.pair.quoteDecimals,
        },
        {
          type: order.type,
          price: order.price,
          stopPrice: order.stopPrice,
          amount: order.remainingAmount,
        },
      )
    }
  }

  return reserved
}

async function assertValidOnChainState(
  pair: {
    id: string
    symbol: string
    baseToken: string
    quoteToken: string
    baseDecimals: number
    quoteDecimals: number
    isNativeBase: boolean
    isNativeQuote: boolean
  },
  input: CreateOrderInput,
) {
  const settlementEnabled = settlementService.isEnabled()
  const onChainNonceUsed = await settlementService.isNonceUsed(input.makerAddress, input.nonce)
  if (settlementEnabled && onChainNonceUsed === null) {
    throw ApiError.internal('On-chain nonce validation unavailable')
  }
  if (onChainNonceUsed) throw ApiError.conflict('Nonce already used on-chain')

  const onChainNonceCancelled = await settlementService.isNonceCancelled(input.makerAddress, input.nonce)
  if (settlementEnabled && onChainNonceCancelled === null) {
    throw ApiError.internal('On-chain cancel validation unavailable')
  }
  if (onChainNonceCancelled) throw ApiError.conflict('Nonce already cancelled on-chain')

  const requiredBase = input.side === 'SELL'
    ? decimalToUnits(input.amount, pair.baseDecimals)
    : 0n

  let requiredQuote = 0n
  if (input.side === 'BUY') {
    requiredQuote = await estimateRequiredQuoteUnits(pair, {
      type: input.type,
      price: input.price,
      stopPrice: input.stopPrice,
      amount: input.amount,
    })
  }

  if (requiredBase > 0n) {
    const baseBalance = await settlementService.getVaultBalance(
      input.makerAddress,
      pair.baseToken,
      pair.isNativeBase,
    )
    if (settlementEnabled && baseBalance === null) {
      throw new Error('On-chain base balance validation unavailable')
    }
    const reservedBase = await getReservedVaultAmounts(input.makerAddress, pair.baseToken, 'SELL')
    if (baseBalance !== null && baseBalance - reservedBase < requiredBase) {
      throw new Error('Insufficient base token balance in Spot vault')
    }
  }

  if (requiredQuote > 0n) {
    const quoteBalance = await settlementService.getVaultBalance(
      input.makerAddress,
      pair.quoteToken,
      pair.isNativeQuote,
    )
    if (settlementEnabled && quoteBalance === null) {
      throw new Error('On-chain quote balance validation unavailable')
    }
    const reservedQuote = await getReservedVaultAmounts(input.makerAddress, pair.quoteToken, 'BUY')
    if (quoteBalance !== null && quoteBalance - reservedQuote < requiredQuote) {
      throw new Error('Insufficient quote token balance in Spot vault')
    }
  }
}

export const orderService = {
  /**
   * Create a new order, attempt matching, persist to DB
   */
  async createOrder(input: CreateOrderInput) {
    // 1. Find pair
    const pair = await prisma.pair.findUnique({
      where: { symbol: input.pairSymbol },
    })
    if (!pair) throw ApiError.notFound(`Pair ${input.pairSymbol} not found`)
    if (!pair.isActive) throw ApiError.badRequest(`Pair ${input.pairSymbol} is not active`)

    // 2. Validate price for executable order types
    const price = input.price || '0'
    if ((input.type === 'LIMIT' || input.type === 'STOP_LIMIT') && parseFloat(price) <= 0) {
      throw new Error('Price required for LIMIT/STOP_LIMIT orders')
    }
    if ((input.type === 'STOP' || input.type === 'STOP_LIMIT') && parseFloat(input.stopPrice || '0') <= 0) {
      throw new Error('stopPrice required for STOP/STOP_LIMIT orders')
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
    })

    // 4. Check nonce uniqueness
    const existing = await prisma.order.findFirst({
      where: {
        makerAddress: input.makerAddress,
        nonce: input.nonce,
      },
    })
    if (existing) throw ApiError.conflict('Nonce already used')

    await assertValidOnChainState(pair, input)

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
        status: input.type === 'STOP' || input.type === 'STOP_LIMIT' ? STOP_PENDING_STATUS : 'OPEN',
        signature: input.signature,
        nonce: input.nonce,
        orderHash,
        timeInForce: input.timeInForce,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    })

    // 6. Add active orders to the in-memory book and attempt matching
    if (input.type === 'LIMIT' || input.type === 'MARKET') {
      await executeOrderOnBook(pair.id, pair.symbol, order)
    }

    await processTriggeredOrders(pair.id, pair.symbol)

    return prisma.order.findUnique({ where: { id: order.id } })
  },

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, makerAddress: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw ApiError.notFound('Order not found')
    if (order.makerAddress !== makerAddress) throw ApiError.forbidden('Not order owner')
    if (order.status === 'FILLED') throw ApiError.conflict('Order already filled')
    if (order.status === 'CANCELLED') throw ApiError.conflict('Order already cancelled')

    // Remove from in-memory orderbook
    const pair = await prisma.pair.findUnique({ where: { id: order.pairId } })
    if (pair) {
      const book = orderbookManager.get(pair.symbol)
      if (book) book.cancelOrder(orderId)
    }

    await settlementService.cancelOrderFor(makerAddress, order.nonce)

    // Update DB
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    })

    return updated
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
    const where: Prisma.OrderWhereInput = { makerAddress }
    if (status) where.status = status as OrderStatus

    return prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { pair: { select: { symbol: true } } },
    })
  },

  /**
   * Get open orders for a pair (for API)
   */
  async getOpenOrders(pairSymbol: string, limit = 50) {
    const pair = await prisma.pair.findUnique({ where: { symbol: pairSymbol } })
    if (!pair) throw new Error('Pair not found')

    return prisma.order.findMany({
      where: { pairId: pair.id, status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },
}
