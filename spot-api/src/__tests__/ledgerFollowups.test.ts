/**
 * Follow-ups to the ledger fixes:
 *  1. RECONCILE_REQUIRED is filterable through the admin settlement query.
 *  2. The pending-settlements gauge counts RECONCILE_REQUIRED, and a dedicated
 *     gauge exposes it so an alert can fire on any ambiguous settlement.
 *  3. stakeChainVerifier dry-runs with an explicit WeightV2, never the
 *     `gasLimit: -1` sentinel the Lunes pallet-contracts rejects (OutOfGas).
 */
jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { TradeSettlementQuerySchema } from '../utils/validation';
import { PENDING_SETTLEMENT_STATUSES } from '../services/tradeSettlementService';
import { metricsRegistry } from '../utils/metrics';
import { stakingChainVerifier } from '../services/stakeChainVerifier';

describe('RECONCILE_REQUIRED visibility', () => {
  it('admin settlement query accepts status=RECONCILE_REQUIRED', () => {
    const parsed = TradeSettlementQuerySchema.safeParse({
      status: 'RECONCILE_REQUIRED',
    });
    expect(parsed.success).toBe(true);
  });

  it('pending-settlement statuses include RECONCILE_REQUIRED', () => {
    expect(PENDING_SETTLEMENT_STATUSES).toEqual(
      expect.arrayContaining([
        'PENDING',
        'SETTLING',
        'FAILED',
        'RECONCILE_REQUIRED',
      ]),
    );
  });

  it('exposes a dedicated lunex_settlements_reconcile_required gauge', () => {
    expect(
      metricsRegistry.getSingleMetric('lunex_settlements_reconcile_required'),
    ).toBeDefined();
  });
});

describe('stakeChainVerifier gas (gasLimit:-1 regression)', () => {
  it('dry-runs get_stake with an explicit WeightV2', async () => {
    const svc = stakingChainVerifier as any;
    const createType = jest.fn((type: string, value: any) => ({
      __type: type,
      value,
    }));
    const query = jest.fn(async () => ({
      result: { isErr: false },
      output: { toHuman: () => ({ Ok: { Some: { amount: '1,000,000,000' } } }) },
    }));
    svc.api = { registry: { createType } };
    svc.contract = { query: { get_stake: query } };
    svc.getStakeKey = 'get_stake';
    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);

    await svc.getOnChainStakeAmount('5Wallet');

    const opts = (query.mock.calls[0] as unknown[])[1] as {
      gasLimit: unknown;
    };
    expect(opts.gasLimit).not.toBe(-1);
    expect(opts.gasLimit).toEqual({
      __type: 'WeightV2',
      value: { refTime: 600_000_000_000n, proofSize: 8_000_000n },
    });
  });
});
