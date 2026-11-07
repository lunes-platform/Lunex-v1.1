import { Prisma } from '@prisma/client';
import prisma from '../db';
import {
  settlementService,
  SettlementResult,
  SettlementSubmission,
  TradeSettlementInput,
} from './settlementService';
import { affiliateService } from './affiliateService';
import { log } from '../utils/logger';
import { DEFAULT_TX_TIMEOUT_MS } from '../utils/txWithTimeout';

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000, 900_000];

/**
 * Slack for GRANDPA finality under load on top of the tx timeout. A worker
 * holding a SETTLING claim is still legitimately waiting for finality until
 * at least DEFAULT_TX_TIMEOUT_MS has elapsed.
 */
export const SETTLEMENT_FINALITY_MARGIN_MS = 5 * 60_000;

/**
 * A SETTLING claim older than this is considered abandoned (crashed worker).
 * Strictly greater than tx timeout + finality margin (BE-07: it used to equal
 * the 60 s timeout, so a live worker's claim could be re-claimed while its
 * extrinsic was still in flight). Even then, a stale claim that already has a
 * submission marker is reconciled against the chain, never re-claimed.
 */
export const STALE_SETTLING_MS =
  DEFAULT_TX_TIMEOUT_MS + SETTLEMENT_FINALITY_MARGIN_MS + 60_000;

/**
 * Statuses that are not yet a terminal settlement outcome (metrics/backlog).
 * RECONCILE_REQUIRED is included: an ambiguous on-chain outcome is backlog
 * until the chain proves it either way.
 */
export const PENDING_SETTLEMENT_STATUSES = [
  'PENDING',
  'SETTLING',
  'FAILED',
  'RECONCILE_REQUIRED',
] as const;

const CLEARED_SUBMISSION = {
  submittedTxHash: null,
  submittedRelayerNonce: null,
  submittedBirthBlock: null,
  submittedMortality: null,
  submittedAt: null,
} as const;

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
    // A trade carrying a submission marker has (or may have) a broadcast
    // extrinsic that can still land: it is never claimable for re-submission,
    // only reconcilable (BE-07).
    const claimed = await prisma.trade.updateMany({
      where: {
        id: input.tradeId,
        OR: [
          {
            settlementStatus: { in: ['PENDING', 'FAILED'] },
            submittedTxHash: null,
          },
          // Allow re-claiming stale SETTLING records abandoned by a worker
          // that crashed BEFORE broadcasting (no marker persisted).
          {
            settlementStatus: 'SETTLING',
            lastSettlementAttemptAt: { lte: staleSettlingBefore },
            submittedTxHash: null,
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
  //
  // Every write is guarded on the attempt number this worker claimed
  // (optimistic lock): if another worker re-claimed the trade meanwhile, this
  // stale result is dropped instead of overwriting the newer attempt's state.
  await prisma.$transaction(async (tx) => {
    for (const result of results) {
      const attempts = attemptsByTradeId.get(result.tradeId) || 1;
      const where = { id: result.tradeId, settlementAttempts: attempts };
      let data: Prisma.TradeUpdateManyMutationInput;

      if (result.status === 'SETTLED') {
        data = {
          settlementStatus: 'SETTLED',
          txHash: result.txHash,
          settledAt,
          settlementError: null,
          nextSettlementRetryAt: null,
        };
      } else if (result.status === 'SKIPPED') {
        data = {
          settlementStatus: 'SKIPPED',
          settlementError: result.error || null,
          nextSettlementRetryAt: null,
        };
      } else if (result.status === 'UNKNOWN') {
        // Broadcast with unknown outcome: park it. No retry schedule — only
        // reconcileSubmission (finalized chain data) may resolve it.
        data = {
          settlementStatus: 'RECONCILE_REQUIRED',
          settlementError: `Outcome unknown, reconciliation required: ${
            result.error || 'unknown'
          }`,
          nextSettlementRetryAt: null,
        };
      } else {
        // Definitive failure (nothing broadcast, or it can never land): the
        // marker is cleared so the retry path may safely re-submit.
        data = {
          settlementStatus: 'FAILED',
          settlementError: result.error || 'Unknown settlement failure',
          nextSettlementRetryAt: getNextRetryAt(attempts),
          ...CLEARED_SUBMISSION,
        };
      }

      const applied = await tx.trade.updateMany({ where, data });
      if (applied.count === 0) {
        log.warn(
          { tradeId: result.tradeId, attempts, status: result.status },
          '[Settlement] result superseded by a newer attempt; dropped',
        );
      }
    }
  });
}

/**
 * Persists the submission marker right before broadcast, guarded by this
 * worker's claim. Throws (→ no broadcast) if the claim was superseded or the
 * marker already exists.
 */
function buildBroadcastHook(attemptsByTradeId: Map<string, number>) {
  return async (tradeId: string, submission: SettlementSubmission) => {
    const persisted = await prisma.trade.updateMany({
      where: {
        id: tradeId,
        settlementStatus: 'SETTLING',
        settlementAttempts: attemptsByTradeId.get(tradeId) ?? -1,
        submittedTxHash: null,
      },
      data: {
        submittedTxHash: submission.txHash,
        submittedRelayerNonce: submission.relayerNonce,
        submittedBirthBlock: submission.birthBlock,
        submittedMortality: submission.mortality,
        submittedAt: new Date(),
      },
    });
    if (persisted.count !== 1) {
      throw new Error(
        `Settlement claim for trade ${tradeId} superseded; not broadcasting`,
      );
    }
  };
}

async function processAttempt(inputs: TradeSettlementInput[]) {
  const { attemptsByTradeId, claimedInputs } = await markTradesSettling(inputs);
  if (claimedInputs.length === 0) return [];
  const results = await settlementService.settleTrades(claimedInputs, {
    onBeforeBroadcast: buildBroadcastHook(attemptsByTradeId),
  });
  await applySettlementResults(results, attemptsByTradeId);

  // Credit SPOT affiliate commissions only for trades that actually settled
  // on-chain (fail-closed: SKIPPED/FAILED never earn commission — parity with
  // copytrade crediting post-onChainConfirmation). This single point covers
  // both first-attempt and retry success, so a FAILED trade that settles on a
  // later retry earns its commission at that moment. Best-effort and OUTSIDE
  // the applySettlementResults transaction: if this throws, settlement is NOT
  // rolled back. A lost credit here is NOT permanent — the reconciliation at
  // the start of processPayoutBatch re-captures SETTLED trades missing a
  // commission, and the unique constraint makes that re-capture idempotent.
  const settledIds = results
    .filter((r) => r.status === 'SETTLED')
    .map((r) => r.tradeId);
  if (settledIds.length > 0) {
    try {
      await affiliateService.distributeSpotTradeCommissions(settledIds);
    } catch (err) {
      log.error(
        { err, tradeIds: settledIds },
        '[Affiliate] post-settlement commission credit failed; reconciliation will recover',
      );
    }
  }

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

  /**
   * Resolves trades whose settle_trade may have been broadcast (BE-07):
   * RECONCILE_REQUIRED, plus stale SETTLING claims that carry a submission
   * marker (worker died after broadcast). Never re-submits; it only moves a
   * trade to SETTLED (included + success), to retryable FAILED (provably not
   * included, or included and reverted), or parks it as RECONCILE_REQUIRED.
   */
  async reconcileAmbiguousSettlements(limit = 25) {
    const staleSettlingBefore = new Date(Date.now() - STALE_SETTLING_MS);
    const candidates = await prisma.trade.findMany({
      where: {
        OR: [
          { settlementStatus: 'RECONCILE_REQUIRED' },
          {
            settlementStatus: 'SETTLING',
            submittedTxHash: { not: null },
            lastSettlementAttemptAt: { lte: staleSettlingBefore },
          },
        ],
      },
      orderBy: [{ lastSettlementAttemptAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        settlementStatus: true,
        settlementAttempts: true,
        submittedTxHash: true,
        submittedRelayerNonce: true,
        submittedBirthBlock: true,
        submittedMortality: true,
        settlementPayload: true,
      },
    });

    let reconciled = 0;
    const settledIds: string[] = [];

    for (const trade of candidates) {
      if (
        !trade.submittedTxHash ||
        trade.submittedRelayerNonce === null ||
        trade.submittedBirthBlock === null ||
        trade.submittedMortality === null
      ) {
        // No usable marker — cannot be proven either way. Manual only.
        log.error(
          { tradeId: trade.id, status: trade.settlementStatus },
          '[Settlement] ambiguous trade without submission marker; manual reconciliation required',
        );
        continue;
      }

      // The persisted payload lets the idempotent contract answer
      // is_fill_settled at the finalized head (second finalized signal).
      let tradeInput: TradeSettlementInput | undefined;
      if (trade.settlementPayload) {
        try {
          tradeInput = deserializeSettlementInput(
            trade.settlementPayload as unknown as SerializedTradeSettlementInput,
          );
        } catch (err: unknown) {
          log.warn(
            { err, tradeId: trade.id },
            '[Settlement] unreadable settlement payload; hash-only reconciliation',
          );
        }
      }

      const verdict = await settlementService.reconcileSubmission(
        {
          txHash: trade.submittedTxHash,
          relayerNonce: trade.submittedRelayerNonce,
          birthBlock: trade.submittedBirthBlock,
          mortality: trade.submittedMortality,
        },
        tradeInput,
      );

      // Guarded on the exact marker + attempt we read, so two reconcilers (or
      // a reconciler and a late result) cannot both apply a transition.
      const where: Prisma.TradeWhereInput = {
        id: trade.id,
        settlementAttempts: trade.settlementAttempts,
        submittedTxHash: trade.submittedTxHash,
      };
      let data: Prisma.TradeUpdateManyMutationInput | null = null;

      if (verdict.outcome === 'INCLUDED_SUCCESS') {
        data = {
          settlementStatus: 'SETTLED',
          txHash: verdict.txHash,
          settledAt: new Date(),
          settlementError: null,
          nextSettlementRetryAt: null,
        };
      } else if (verdict.outcome === 'ALREADY_SETTLED') {
        // The contract records the fill as settled at the finalized head; a
        // late copy of our extrinsic would revert (TradeAlreadySettled). The
        // settling extrinsic is not known here, so txHash is left as is.
        data = {
          settlementStatus: 'SETTLED',
          settledAt: new Date(),
          settlementError: null,
          nextSettlementRetryAt: null,
        };
      } else if (
        verdict.outcome === 'NOT_INCLUDED' ||
        verdict.outcome === 'INCLUDED_FAILED'
      ) {
        data = {
          settlementStatus: 'FAILED',
          settlementError:
            verdict.outcome === 'NOT_INCLUDED'
              ? 'Previous submission expired without inclusion (finalized)'
              : `Previous submission reverted on-chain: ${verdict.error}`,
          nextSettlementRetryAt: new Date(),
          ...CLEARED_SUBMISSION,
        };
      } else if (trade.settlementStatus === 'SETTLING') {
        // Still unresolved: park the abandoned claim explicitly.
        where.settlementStatus = 'SETTLING';
        data = {
          settlementStatus: 'RECONCILE_REQUIRED',
          settlementError:
            verdict.outcome === 'UNAVAILABLE'
              ? `Reconciliation unavailable: ${verdict.error}`
              : 'Outcome unknown (worker abandoned claim after broadcast)',
          nextSettlementRetryAt: null,
        };
      }

      if (!data) continue;
      const applied = await prisma.trade.updateMany({ where, data });
      if (
        applied.count === 1 &&
        data.settlementStatus !== 'RECONCILE_REQUIRED'
      ) {
        reconciled += 1;
        if (data.settlementStatus === 'SETTLED') settledIds.push(trade.id);
      }
    }

    if (settledIds.length > 0) {
      try {
        await affiliateService.distributeSpotTradeCommissions(settledIds);
      } catch (err: unknown) {
        log.error(
          { err, tradeIds: settledIds },
          '[Affiliate] post-reconciliation commission credit failed; reconciliation will recover',
        );
      }
    }

    return { reconciled, settled: settledIds.length };
  },

  async retryPendingSettlements(limit = 25) {
    if (!settlementService.isEnabled()) {
      return {
        processed: 0,
        settled: 0,
        failed: 0,
        reconciled: 0,
      };
    }

    const reconciliation = await this.reconcileAmbiguousSettlements(limit);

    const now = new Date();
    const staleSettlingBefore = new Date(now.getTime() - STALE_SETTLING_MS);

    // Rows with a submission marker are excluded: they belong to the
    // reconciler above, never to re-submission.
    const trades = await prisma.trade.findMany({
      where: {
        settlementPayload: { not: Prisma.DbNull },
        OR: [
          { settlementStatus: 'PENDING', submittedTxHash: null },
          {
            settlementStatus: 'FAILED',
            nextSettlementRetryAt: { lte: now },
            submittedTxHash: null,
          },
          {
            settlementStatus: 'SETTLING',
            lastSettlementAttemptAt: { lte: staleSettlingBefore },
            submittedTxHash: null,
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
        reconciled: reconciliation.reconciled,
      };
    }

    const results = await processAttempt(inputs);

    return {
      processed: results.length,
      settled: results.filter((result) => result.status === 'SETTLED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      reconciled: reconciliation.reconciled,
    };
  },
};
