import type { ApiPromise } from '@polkadot/api';
import { withTxTimeout } from './txWithTimeout';

/**
 * Shared primitives for fund-moving extrinsics whose outcome may be
 * ambiguous (BE-07 pattern: settle_trade, reward payouts).
 *
 *  1. Sign with an explicit mortal era anchored on the finalized head, so the
 *     extrinsic is only valid in blocks [birth, birth + mortality).
 *  2. Persist hash + era BEFORE broadcasting (caller's responsibility).
 *  3. After broadcast only finalized / pool-definitive statuses are final;
 *     anything else (timeout, dropped, RPC error) is AMBIGUOUS.
 *  4. Ambiguous submissions are resolved from FINALIZED blocks only: the
 *     extrinsic either appears in its era window (success / failed), or the
 *     finalized head passes the window without it (can never land).
 */

/** Default mortal-era length in blocks for fund-moving extrinsics. */
export const DEFAULT_MORTALITY_BLOCKS = 64;

export type MortalSubmission = {
  txHash: string;
  birthBlock: number;
  mortality: number;
};

export type ExtrinsicReconciliation =
  | { outcome: 'INCLUDED_SUCCESS'; txHash: string; blockHash: string }
  | {
      outcome: 'INCLUDED_FAILED';
      txHash: string;
      blockHash: string;
      error: string;
    }
  /** Finalized head is past the mortal era and the extrinsic is absent. */
  | { outcome: 'NOT_INCLUDED' }
  /** Era still open: the extrinsic may still be included. Do nothing. */
  | { outcome: 'PENDING' }
  | { outcome: 'UNAVAILABLE'; error: string };

/** Outcome after broadcast is final: the extrinsic did not / cannot apply. */
export class DefinitiveTxFailure extends Error {}

/** Signing options for a mortal era anchored on the current finalized head. */
export async function anchorMortalEra(
  api: ApiPromise,
  mortality = DEFAULT_MORTALITY_BLOCKS,
) {
  const blockHash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(blockHash);
  const birthBlock = header.number.toNumber();
  const era = api.registry.createType('ExtrinsicEra', {
    current: birthBlock,
    period: mortality,
  });
  return { blockHash, era, birthBlock, mortality };
}

type SendableExtrinsic = {
  send: (
    cb: (result: {
      status: Record<string, boolean | undefined>;
      dispatchError?: { toString(): string };
    }) => void,
  ) => Promise<() => void>;
};

/**
 * Broadcasts an already-signed extrinsic and resolves with `txHash` only once
 * it is FINALIZED without a dispatch error. Rejects with DefinitiveTxFailure
 * for finalized dispatch errors, Invalid and Usurped; any other rejection
 * (timeout, Dropped, FinalityTimeout, RPC error) is ambiguous.
 */
export function awaitFinalizedSend(
  extrinsic: SendableExtrinsic,
  label: string,
  txHash: string,
  timeoutMs?: number,
): Promise<string> {
  const txPromise = new Promise<string>((resolve, reject) => {
    let unsub: (() => void) | undefined;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (unsub) unsub();
      fn();
    };

    extrinsic
      .send((txResult) => {
        const status = txResult.status ?? {};
        // Definitive: rejected by the pool / nonce taken by another tx.
        if (status.isInvalid || status.isUsurped) {
          finish(() =>
            reject(
              new DefinitiveTxFailure(
                `${label} ${status.isInvalid ? 'Invalid' : 'Usurped'}`,
              ),
            ),
          );
          return;
        }
        // Ambiguous: may still be gossiped and included elsewhere.
        if (status.isDropped || status.isFinalityTimeout) {
          finish(() =>
            reject(new Error(`${label} dropped / finality timeout`)),
          );
          return;
        }
        // Only finalized state is final: a non-finalized block can be
        // reorged out and the extrinsic re-included.
        if (status.isFinalized) {
          if (txResult.dispatchError) {
            const message = txResult.dispatchError.toString();
            finish(() => reject(new DefinitiveTxFailure(message)));
            return;
          }
          finish(() => resolve(txHash));
        }
      })
      .then((unsubscribe) => {
        unsub = unsubscribe;
        if (done) unsubscribe();
      })
      .catch((err: unknown) => finish(() => reject(err)));
  });

  return withTxTimeout(label, txPromise, timeoutMs);
}

/**
 * Resolves an ambiguous submission from FINALIZED chain data only. Scans the
 * extrinsic's mortal-era window [birthBlock, birthBlock + mortality], clamped
 * to the finalized head, for the persisted hash.
 */
export async function reconcileFinalizedExtrinsic(
  api: ApiPromise,
  submission: MortalSubmission,
): Promise<ExtrinsicReconciliation> {
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const finalizedNumber = (
    await api.rpc.chain.getHeader(finalizedHash)
  ).number.toNumber();
  const lastValidBlock = submission.birthBlock + submission.mortality;
  const scanTo = Math.min(finalizedNumber, lastValidBlock);
  const wanted = submission.txHash.toLowerCase();

  for (let n = submission.birthBlock; n <= scanTo; n++) {
    const blockHash = await api.rpc.chain.getBlockHash(n);
    const { block } = await api.rpc.chain.getBlock(blockHash);
    const index = block.extrinsics.findIndex(
      (ex: { hash: { toHex(): string } }) =>
        ex.hash.toHex().toLowerCase() === wanted,
    );
    if (index < 0) continue;

    const apiAt = await api.at(blockHash);
    const records = (await apiAt.query.system.events()) as unknown as Array<{
      phase: {
        isApplyExtrinsic: boolean;
        asApplyExtrinsic: { toNumber(): number };
      };
      event: { section: string; method: string; data?: unknown };
    }>;
    const outcome = records.find(
      (r) =>
        r.phase.isApplyExtrinsic &&
        r.phase.asApplyExtrinsic.toNumber() === index &&
        r.event.section === 'system' &&
        (r.event.method === 'ExtrinsicSuccess' ||
          r.event.method === 'ExtrinsicFailed'),
    );
    const blockHashHex = blockHash.toHex();
    if (outcome?.event.method === 'ExtrinsicSuccess') {
      return {
        outcome: 'INCLUDED_SUCCESS',
        txHash: submission.txHash,
        blockHash: blockHashHex,
      };
    }
    return {
      outcome: 'INCLUDED_FAILED',
      txHash: submission.txHash,
      blockHash: blockHashHex,
      error: outcome
        ? `ExtrinsicFailed ${String(outcome.event.data ?? '')}`.trim()
        : 'Included without an ExtrinsicSuccess event',
    };
  }

  if (finalizedNumber > lastValidBlock) return { outcome: 'NOT_INCLUDED' };
  return { outcome: 'PENDING' };
}
