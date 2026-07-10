/**
 * Regression test for the gas-fix across the rebalancer / rewardPayout /
 * copyVault / factory services: the Lunes pallet-contracts rejects the
 * polkadot.js sentinel `gasLimit: -1` with `contracts.OutOfGas`, so every
 * contract dry-run / extrinsic on those services failed.
 *
 * The fix is the shared `contractGas` util (same WeightV2 pattern proven
 * on-chain by settlementService): dry-runs pass a generous explicit WeightV2
 * ceiling, and real extrinsics submit the measured `gasRequired` + 50% margin.
 *
 * These tests prove the helpers produce WeightV2 objects via
 * `registry.createType('WeightV2', { refTime, proofSize })` and never the
 * `-1` sentinel, and that a consuming service (rebalancer.getManager) wires
 * the helper into its dry-run options.
 */

import { dryRunGasLimit, txGasLimit } from '../utils/contractGas';

// A fake WeightV2 marker so we can recognise objects built via createType.
class FakeWeightV2 {
  public readonly __weightV2 = true;
  constructor(
    public readonly refTime: { toBigInt(): bigint },
    public readonly proofSize: { toBigInt(): bigint },
  ) {}
}

function makeWeight(refTime: bigint, proofSize: bigint) {
  return new FakeWeightV2(
    { toBigInt: () => refTime },
    { toBigInt: () => proofSize },
  );
}

function fakeApi() {
  const createType = jest.fn((type: string, value: any) => {
    if (type === 'WeightV2') {
      return makeWeight(value.refTime, value.proofSize);
    }
    return { __type: type, value };
  });
  return { registry: { createType }, createType } as any;
}

describe('contractGas helpers (gas-fix regression)', () => {
  it('dryRunGasLimit returns an explicit WeightV2, never gasLimit:-1', () => {
    const api = fakeApi();
    const gas = dryRunGasLimit(api);

    expect(gas).not.toBe(-1);
    expect(gas).toBeInstanceOf(FakeWeightV2);
    // Generous ceiling proven on-chain: refTime 600e9, proofSize 8e6.
    expect(api.registry.createType).toHaveBeenCalledWith('WeightV2', {
      refTime: 600_000_000_000n,
      proofSize: 8_000_000n,
    });
  });

  it('txGasLimit applies +50% margin over measured gasRequired (WeightV2)', () => {
    const api = fakeApi();
    const gasRequired = makeWeight(123_000_000_000n, 2_000_000n);

    const gas = txGasLimit(api, gasRequired);

    expect(gas).not.toBe(-1);
    expect(gas).toBeInstanceOf(FakeWeightV2);
    const w = gas as unknown as FakeWeightV2;
    expect(w.refTime.toBigInt()).toBe((123_000_000_000n * 150n) / 100n);
    expect(w.proofSize.toBigInt()).toBe((2_000_000n * 150n) / 100n);
  });
});

describe('rebalancerService.getManager dry-run gas (gas-fix regression)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('passes an explicit WeightV2 to the contract query, never gasLimit:-1', async () => {
    jest.resetModules();

    let capturedGas: any = null;
    const createType = jest.fn((type: string, value: any) => {
      if (type === 'WeightV2') return makeWeight(value.refTime, value.proofSize);
      return { __type: type, value };
    });

    // Mock the contract so query.getManager records the gas option it receives.
    jest.doMock('@polkadot/api-contract', () => ({
      ContractPromise: class {
        public query = {
          getManager: jest.fn((_caller: string, opts: any) => {
            capturedGas = opts.gasLimit;
            return { output: { toJSON: () => '5Fmanager' } };
          }),
        };
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rebalancerService } = require('../services/rebalancerService');
    const svc = rebalancerService as any;

    svc.api = { registry: { createType }, createType };
    svc.asymmetricPairAbi = {};
    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(svc, 'getRelayerAddress').mockResolvedValue('5Frelayer');

    await rebalancerService.getManager('5Fpair');

    expect(capturedGas).not.toBeNull();
    expect(capturedGas).not.toBe(-1);
    expect(capturedGas).toBeInstanceOf(FakeWeightV2);
    expect(createType).toHaveBeenCalledWith('WeightV2', {
      refTime: 600_000_000_000n,
      proofSize: 8_000_000n,
    });
  });
});
