import { Prisma } from '@prisma/client';
import prisma from '../db';
import {
  settlementService,
  SettlementResult,
  TradeSettlementInput,
} from './settlementService';

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000, 900_000];
const STALE_SETTLING_MS = 60_000;

type SerializedTradeSettlementInput = Omit<
  TradeSettlementInput,
  'makerOrder' | 'takerOrder'
> & {
  makerOrder: Omit<
    TradeSettlementInput['makerOrder'],
    'expiresAt' | 'signatureTimestamp'
  > & {
    expiresAt: string | null;
    signatureTimestamp: string | null;
  };
  takerOrder: Omit<
    TradeSettlementInput['takerOrder'],
    'expiresAt' | 'signatureTimestamp'
  > & {
    expiresAt: string | null;
    signatureTimestamp: string | null;
  };
};

export function serializeSettlementInput(
  input: TradeSettlementInput,
): SerializedTradeSettlementInput {
  return {
    ...input,
    makerOrder: {
      ...input.makerOrder,
      expiresAt: input.makerOrder.expiresAt
        ? input.makerOrder.expiresAt.toISOString()
        : null,
      signatureTimestamp: input.makerOrder.signatureTimestamp
        ? input.makerOrder.signatureTimestamp.toISOString()
        : null,
    },
    takerOrder: {
      ...input.takerOrder,
      expiresAt: input.takerOrder.expiresAt
        ? input.takerOrder.expiresAt.toISOString()
        : null,
      signatureTimestamp: input.takerOrder.signatureTimestamp
        ? input.takerOrder.signatureTimestamp.toISOString()
        : null,
    },
  };
}

export function deserializeSettlementInput(
  payload: SerializedTradeSettlementInput,
): TradeSettlementInput {
  return {
    ...payload,
    makerOrder: {
      ...payload.makerOrder,
      expiresAt: payload.makerOrder.expiresAt
        ? new Date(payload.makerOrder.expiresAt)
        : null,
      signatureTimestamp: payload.makerOrder.signatureTimestamp
        ? new Date(payload.makerOrder.signatureTimestamp)
        : null,
    },
    takerOrder: {
      ...payload.takerOrder,
      expiresAt: payload.takerOrder.expiresAt
        ? new Date(payload.takerOrder.expiresAt)
        : null,
      signatureTimestamp: payload.takerOrder.signatureTimestamp
        ? new Date(payload.takerOrder.signatureTimestamp)
        : null,
    },
  };
}

function getNextRetryAt(attempts: number) {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  if (!delay) return null;
  return new Date(Date.now() + delay);
}

function payloadForPrisma(input: TradeSettlementInput): Prisma.InputJsonValue {
  return serializeSettlementInput(input) as unknown as Prisma.InputJsonValue;
}

async function markTradesSkipped(inputs: TradeSettlementInput[]) {
  for (const input of inputs) {
    await prisma.trade.update({
      where: { id: input.tradeId },
      data: {
        settlementStatus: 'SKIPPED',
        settlementPayload: payloadForPrisma(input),
        settlementError: null,
        nextSettlementRetryAt: null,
      },
    });
  }
}

async function markTradesSettling(inputs: TradeSettlementInput[]) {
  const attemptsByTradeId = new Map<string, number>();
  const claimedInputs: TradeSettlementInput[] = [];
  const startedAt = new Date();
  // Stale threshold: a SETTLING trade whose last attempt was more than
  // STALE_SETTLING_MS ago is considered abandoned and eligible for re-claim.
  const staleSettlingBefore = new Date(startedAt.getTime() - STALE_SETTLING_MS);

  for (const input of inputs) {
    // Optimistic claim: only update if the trade is in a retryable state.
    // This prevents two concurrent workers from double-settling the same trade.
    const claimed = await prisma.trade.updateMany({
      where: {
        id: input.tradeId,
        OR: [
          { settlementStatus: { in: ['PENDING', 'FAILED'] } },
          // Allow re-claiming stale SETTLING records (abandoned by a crashed worker)
          {
            settlementStatus: 'SETTLING',
            lastSettlementAttemptAt: { lte: staleSettlingBefore },
          },
        ],
      },
      data: {
        settlementStatus: 'SETTLING',
        settlementAttempts: { increment: 1 },
        settlementPayload: payloadForPrisma(input),
        settlementError: null,
        lastSettlementAttemptAt: startedAt,
        nextSettlementRetryAt: null,
      },
    });

    if (claimed.count === 0) {
      // Another worker already claimed this trade — skip to avoid duplicate TX
      continue;
    }

    const updatedTrade = await prisma.trade.findUnique({
      where: { id: input.tradeId },
      select: { id: true, settlementAttempts: true },
    });

    if (updatedTrade) {
      attemptsByTradeId.set(updatedTrade.id, updatedTrade.settlementAttempts);
      claimedInputs.push(input);
    }
  }

  return { attemptsByTradeId, claimedInputs };
}

async function applySettlementResults(
  results: SettlementResult[],
  attemptsByTradeId: Map<string, number>,
) {
  const settledAt = new Date();

  // Wrap the batch update in a transaction so that a partial failure cannot
  // leave the DB in an inconsistent state where some trades are recorded as
  // SETTLED while siblings stay in SETTLING. Without this, a crash mid-loop
  // produces phantom SETTLING records that the retry path will re-attempt
  // on-chain (the contract idempotency catches it, but the duplicate call is
  // wasted gas + latency and pollutes the FAILED-with-already-settled state).
  await prisma.$transaction(async (tx) => {
    for (const result of results) {
      if (result.status === 'SETTLED') {
        await tx.trade.update({
          where: { id: result.tradeId },
          data: {
            settlementStatus: 'SETTLED',
            txHash: result.txHash,
            settledAt,
            settlementError: null,
            nextSettlementRetryAt: null,
          },
        });
        continue;
      }

      if (result.status === 'SKIPPED') {
        await tx.trade.update({
          where: { id: result.tradeId },
          data: {
            settlementStatus: 'SKIPPED',
            settlementError: result.error || null,
            nextSettlementRetryAt: null,
          },
        });
        continue;
      }

      const attempts = attemptsByTradeId.get(result.tradeId) || 1;
      await tx.trade.update({
        where: { id: result.tradeId },
        data: {
          settlementStatus: 'FAILED',
          settlementError: result.error || 'Unknown settlement failure',
          nextSettlementRetryAt: getNextRetryAt(attempts),
        },
      });
    }
  });
}

async function processAttempt(inputs: TradeSettlementInput[]) {
  const { attemptsByTradeId, claimedInputs } = await markTradesSettling(inputs);
  if (claimedInputs.length === 0) return [];
  const results = await settlementService.settleTrades(claimedInputs);
  await applySettlementResults(results, attemptsByTradeId);
  return results;
}

export const tradeSettlementService = {
  async processNewTradeSettlements(inputs: TradeSettlementInput[]) {
    if (inputs.length === 0) return [];

    if (!settlementService.isEnabled()) {
      await markTradesSkipped(inputs);
      return inputs.map((input) => ({
        tradeId: input.tradeId,
        status: 'SKIPPED' as const,
        error: 'On-chain settlement disabled for this environment',
      }));
    }

    return processAttempt(inputs);
  },

  async retryPendingSettlements(limit = 25) {
    if (!settlementService.isEnabled()) {
      return {
        processed: 0,
        settled: 0,
        failed: 0,
      };
    }

    const now = new Date();
    const staleSettlingBefore = new Date(now.getTime() - STALE_SETTLING_MS);

    const trades = await prisma.trade.findMany({
      where: {
        settlementPayload: { not: Prisma.DbNull },
        OR: [
          { settlementStatus: 'PENDING' },
          { settlementStatus: 'FAILED', nextSettlementRetryAt: { lte: now } },
          {
            settlementStatus: 'SETTLING',
            lastSettlementAttemptAt: { lte: staleSettlingBefore },
          },
        ],
      },
      orderBy: [{ lastSettlementAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        settlementPayload: true,
      },
    });

    const inputs = trades
      .filter((trade) => trade.settlementPayload !== null)
      .map((trade) =>
        deserializeSettlementInput(
          trade.settlementPayload as unknown as SerializedTradeSettlementInput,
        ),
      );

    if (inputs.length === 0) {
      return {
        processed: 0,
        settled: 0,
        failed: 0,
      };
    }

    const results = await processAttempt(inputs);

    return {
      processed: results.length,
      settled: results.filter((result) => result.status === 'SETTLED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
    };
  },
};
