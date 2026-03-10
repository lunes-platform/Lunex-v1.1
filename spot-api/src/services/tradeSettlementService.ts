import prisma from '../db'
import { settlementService, SettlementResult, TradeSettlementInput } from './settlementService'

const prismaAny = prisma as any
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000, 900_000]
const STALE_SETTLING_MS = 60_000

type SerializedTradeSettlementInput = Omit<TradeSettlementInput, 'makerOrder' | 'takerOrder'> & {
  makerOrder: Omit<TradeSettlementInput['makerOrder'], 'expiresAt'> & { expiresAt: string | null }
  takerOrder: Omit<TradeSettlementInput['takerOrder'], 'expiresAt'> & { expiresAt: string | null }
}

export function serializeSettlementInput(input: TradeSettlementInput): SerializedTradeSettlementInput {
  return {
    ...input,
    makerOrder: {
      ...input.makerOrder,
      expiresAt: input.makerOrder.expiresAt ? input.makerOrder.expiresAt.toISOString() : null,
    },
    takerOrder: {
      ...input.takerOrder,
      expiresAt: input.takerOrder.expiresAt ? input.takerOrder.expiresAt.toISOString() : null,
    },
  }
}

export function deserializeSettlementInput(payload: SerializedTradeSettlementInput): TradeSettlementInput {
  return {
    ...payload,
    makerOrder: {
      ...payload.makerOrder,
      expiresAt: payload.makerOrder.expiresAt ? new Date(payload.makerOrder.expiresAt) : null,
    },
    takerOrder: {
      ...payload.takerOrder,
      expiresAt: payload.takerOrder.expiresAt ? new Date(payload.takerOrder.expiresAt) : null,
    },
  }
}

function getNextRetryAt(attempts: number) {
  const delay = RETRY_DELAYS_MS[attempts - 1]
  if (!delay) return null
  return new Date(Date.now() + delay)
}

async function markTradesSkipped(inputs: TradeSettlementInput[]) {
  for (const input of inputs) {
    await prismaAny.trade.update({
      where: { id: input.tradeId },
      data: {
        settlementStatus: 'SKIPPED',
        settlementPayload: serializeSettlementInput(input),
        settlementError: null,
        nextSettlementRetryAt: null,
      },
    })
  }
}

async function markTradesSettling(inputs: TradeSettlementInput[]) {
  const attemptsByTradeId = new Map<string, number>()
  const startedAt = new Date()

  for (const input of inputs) {
    const updatedTrade = await prismaAny.trade.update({
      where: { id: input.tradeId },
      data: {
        settlementStatus: 'SETTLING',
        settlementAttempts: { increment: 1 },
        settlementPayload: serializeSettlementInput(input),
        settlementError: null,
        lastSettlementAttemptAt: startedAt,
        nextSettlementRetryAt: null,
      },
      select: {
        id: true,
        settlementAttempts: true,
      },
    })

    attemptsByTradeId.set(updatedTrade.id, updatedTrade.settlementAttempts)
  }

  return attemptsByTradeId
}

async function applySettlementResults(results: SettlementResult[], attemptsByTradeId: Map<string, number>) {
  const settledAt = new Date()

  for (const result of results) {
    if (result.status === 'SETTLED') {
      await prismaAny.trade.update({
        where: { id: result.tradeId },
        data: {
          settlementStatus: 'SETTLED',
          txHash: result.txHash,
          settledAt,
          settlementError: null,
          nextSettlementRetryAt: null,
        },
      })
      continue
    }

    if (result.status === 'SKIPPED') {
      await prismaAny.trade.update({
        where: { id: result.tradeId },
        data: {
          settlementStatus: 'SKIPPED',
          settlementError: result.error || null,
          nextSettlementRetryAt: null,
        },
      })
      continue
    }

    const attempts = attemptsByTradeId.get(result.tradeId) || 1
    await prismaAny.trade.update({
      where: { id: result.tradeId },
      data: {
        settlementStatus: 'FAILED',
        settlementError: result.error || 'Unknown settlement failure',
        nextSettlementRetryAt: getNextRetryAt(attempts),
      },
    })
  }
}

async function processAttempt(inputs: TradeSettlementInput[]) {
  const attemptsByTradeId = await markTradesSettling(inputs)
  const results = await settlementService.settleTrades(inputs)
  await applySettlementResults(results, attemptsByTradeId)
  return results
}

export const tradeSettlementService = {
  async processNewTradeSettlements(inputs: TradeSettlementInput[]) {
    if (inputs.length === 0) return []

    if (!settlementService.isEnabled()) {
      await markTradesSkipped(inputs)
      return inputs.map((input) => ({
        tradeId: input.tradeId,
        status: 'SKIPPED' as const,
        error: 'On-chain settlement disabled for this environment',
      }))
    }

    return processAttempt(inputs)
  },

  async retryPendingSettlements(limit = 25) {
    if (!settlementService.isEnabled()) {
      return {
        processed: 0,
        settled: 0,
        failed: 0,
      }
    }

    const now = new Date()
    const staleSettlingBefore = new Date(now.getTime() - STALE_SETTLING_MS)

    const trades = await prismaAny.trade.findMany({
      where: {
        settlementPayload: { not: null },
        OR: [
          { settlementStatus: 'PENDING' },
          { settlementStatus: 'FAILED', nextSettlementRetryAt: { lte: now } },
          { settlementStatus: 'SETTLING', lastSettlementAttemptAt: { lte: staleSettlingBefore } },
        ],
      },
      orderBy: [{ lastSettlementAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        settlementPayload: true,
      },
    })

    const inputs = trades
      .filter((trade: { settlementPayload: SerializedTradeSettlementInput | null }) => Boolean(trade.settlementPayload))
      .map((trade: { settlementPayload: SerializedTradeSettlementInput }) => deserializeSettlementInput(trade.settlementPayload))

    if (inputs.length === 0) {
      return {
        processed: 0,
        settled: 0,
        failed: 0,
      }
    }

    const results = await processAttempt(inputs)

    return {
      processed: results.length,
      settled: results.filter((result) => result.status === 'SETTLED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
    }
  },
}
