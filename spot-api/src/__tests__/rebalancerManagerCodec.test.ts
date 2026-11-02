jest.mock('@polkadot/api-contract', () => ({ ContractPromise: jest.fn() }));
import { ContractPromise } from '@polkadot/api-contract';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { rebalancerService } from '../services/rebalancerService';

const alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const svc = rebalancerService as any;
let query: jest.Mock;
beforeEach(() => {
  query = jest.fn();
  (ContractPromise as unknown as jest.Mock).mockImplementation(() => ({
    query: { getManager: query },
  }));
  svc.api = { registry: { createType: jest.fn((_type, value) => value) } };
  svc.asymmetricPairAbi = {};
  jest.spyOn(rebalancerService, 'ensureReady').mockResolvedValue(true);
  jest.spyOn(rebalancerService, 'getRelayerAddress').mockResolvedValue(alice);
});
afterEach(() => {
  jest.restoreAllMocks();
  svc.api = null;
  svc.asymmetricPairAbi = null;
});
function response(value: unknown, isErr = false) {
  query.mockResolvedValue({
    result: { isErr },
    output: { toJSON: () => value, toString: () => JSON.stringify(value) },
  });
}
it('decodes the real ink4 None response instead of exposing JSON as a manager', async () => {
  response({ ok: null });
  await expect(rebalancerService.getManager('pair')).resolves.toBeNull();
});
it.each([{ ok: alice }, { Ok: { ok: { some: alice } } }])(
  'decodes an Option AccountId response %j',
  async (value) => {
    response(value);
    await expect(rebalancerService.getManager('pair')).resolves.toBe(alice);
  },
);
it('does not authorize a contract language error', async () => {
  response({ err: 'CouldNotReadInput' });
  await expect(rebalancerService.getManager('pair')).rejects.toThrow();
});
it('does not expose a manager from a failed dispatch', async () => {
  response({ ok: alice }, true);
  await expect(rebalancerService.getManager('pair')).rejects.toThrow();
});
it('recognizes the same manager with a different SS58 prefix', async () => {
  response({ ok: encodeAddress(decodeAddress(alice), 0) });
  await expect(rebalancerService.isManagedByRelayer('pair')).resolves.toBe(
    true,
  );
});
it('rejects malformed manager output rather than treating JSON as an address', async () => {
  response({ ok: { unexpected: alice } });
  await expect(rebalancerService.getManager('pair')).rejects.toThrow();
});
