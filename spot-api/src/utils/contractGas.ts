import type { ApiPromise } from '@polkadot/api';
import type { WeightV2 } from '@polkadot/types/interfaces';

/**
 * Shared WeightV2 gas helpers for pallet-contracts dry-runs and extrinsics on
 * the Lunes chain.
 *
 * The Lunes pallet-contracts rejects the polkadot.js sentinel `gasLimit: -1`
 * with `contracts.OutOfGas` (module 24, error 0x02): every contract `query.*`
 * dry-run and `tx.*` submit fails. Substrate expects an explicit WeightV2
 * ceiling on this chain. We pass a generous WeightV2 so the dry-run can run to
 * completion and return an accurate `gasRequired`; the real extrinsic is then
 * submitted with that measured `gasRequired` (plus a safety margin), not this
 * ceiling.
 *
 * Proven on-chain (settlementService): cancel_order_for with
 * WeightV2{refTime:600e9, proofSize:8e6} dry-runs to {ok:{ok:null}}, whereas
 * gasLimit:-1 returns OutOfGas. This util replicates that proven pattern so
 * the rebalancer / rewardPayout / copyVault / factory services share one
 * source of truth instead of each re-deriving the WeightV2 ceiling.
 */

/** Generous WeightV2 ceiling for dry-runs (query.* simulation). */
const DRY_RUN_REF_TIME = 600_000_000_000n;
const DRY_RUN_PROOF_SIZE = 8_000_000n;

/** Safety margin applied to the measured `gasRequired` on real extrinsics. */
const TX_MARGIN_NUMERATOR = 150n;
const TX_MARGIN_DENOMINATOR = 100n;

/**
 * Gas limit for contract dry-runs (`query.*`). Pass this as `gasLimit` in the
 * dry-run options object instead of the `-1` sentinel.
 */
export function dryRunGasLimit(api: ApiPromise): WeightV2 {
  return api.registry.createType('WeightV2', {
    refTime: DRY_RUN_REF_TIME,
    proofSize: DRY_RUN_PROOF_SIZE,
  }) as WeightV2;
}

/**
 * Gas limit for the REAL extrinsic, derived from the dry-run `gasRequired`
 * plus a safety margin. `gasRequired` is the exact measured weight of the
 * dry-run; on-chain execution can consume marginally more (storage growth,
 * block-state differences), so we add +50% headroom to avoid OutOfGas on
 * submit while still bounding the relayer's exposure.
 */
export function txGasLimit(
  api: ApiPromise,
  gasRequired: {
    refTime: { toBigInt(): bigint };
    proofSize: { toBigInt(): bigint };
  },
): WeightV2 {
  const refTime =
    (gasRequired.refTime.toBigInt() * TX_MARGIN_NUMERATOR) /
    TX_MARGIN_DENOMINATOR;
  const proofSize =
    (gasRequired.proofSize.toBigInt() * TX_MARGIN_NUMERATOR) /
    TX_MARGIN_DENOMINATOR;
  return api.registry.createType('WeightV2', { refTime, proofSize }) as WeightV2;
}
