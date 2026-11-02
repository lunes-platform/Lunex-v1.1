import { ApiPromise } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import {
  cryptoWaitReady,
  decodeAddress,
  encodeAddress,
} from '@polkadot/util-crypto';
import { verifyAsymmetricContract } from '../services/asymmetricContractVerifier';

jest.mock('@polkadot/api', () => ({
  ApiPromise: { create: jest.fn() },
  WsProvider: jest.fn().mockImplementation(() => ({
    disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@polkadot/api-contract', () => ({ ContractPromise: jest.fn() }));

const alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const bob = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const hash = '0x' + 'ab'.repeat(32);
const getOwner = jest.fn();
const api = {
  query: { contracts: { contractInfoOf: jest.fn() } },
  registry: { createType: jest.fn() },
  disconnect: jest.fn(),
};
const input = {
  address: bob,
  ownerAddress: alice,
  rpcUrl: 'ws://localhost:9944',
  expectedCodeHash: hash,
  requireCodeHash: true,
  loadAbi: () => ({}),
};
beforeAll(async () => {
  await cryptoWaitReady();
});
beforeEach(() => {
  jest.clearAllMocks();
  (ApiPromise.create as jest.Mock).mockResolvedValue(api);
  (ContractPromise as unknown as jest.Mock).mockImplementation(() => ({
    query: { getOwner },
  }));
  api.query.contracts.contractInfoOf.mockResolvedValue({
    isSome: true,
    unwrap: () => ({ codeHash: { toHex: () => hash } }),
  });
  getOwner.mockResolvedValue({
    result: { isErr: false },
    output: { toJSON: () => ({ ok: alice }) },
  });
});

it('accepts the on-chain owner and disconnects RPC', async () => {
  expect(await verifyAsymmetricContract(input)).toEqual({
    ok: true,
    owner: alice,
    codeHash: hash,
  });
  expect(api.disconnect).toHaveBeenCalledTimes(1);
});
it('rejects a different wallet even for an official contract', async () => {
  expect(
    await verifyAsymmetricContract({ ...input, ownerAddress: bob }),
  ).toMatchObject({ ok: false, status: 403 });
});
it('accepts the same AccountId under another SS58 prefix', async () => {
  const ownerAddress = encodeAddress(decodeAddress(alice), 0);
  expect(
    await verifyAsymmetricContract({ ...input, ownerAddress }),
  ).toMatchObject({ ok: true });
});
it('rejects a code hash mismatch before querying ownership', async () => {
  expect(
    await verifyAsymmetricContract({ ...input, expectedCodeHash: 'wrong' }),
  ).toMatchObject({ ok: false, status: 403 });
  expect(getOwner).not.toHaveBeenCalled();
});
it('requires an official hash in production', async () => {
  expect(
    await verifyAsymmetricContract({ ...input, expectedCodeHash: '' }),
  ).toMatchObject({ ok: false, status: 503 });
  expect(ApiPromise.create).not.toHaveBeenCalled();
});
it('does not authorize an owner when the RPC or contract returns an error', async () => {
  getOwner.mockResolvedValue({
    result: { isErr: false },
    output: { toJSON: () => ({ ok: { err: 'Unavailable' } }) },
  });
  expect(await verifyAsymmetricContract(input)).toMatchObject({
    ok: false,
    status: 503,
  });
  expect(api.disconnect).toHaveBeenCalledTimes(1);
});
it('returns unavailable when the node connection fails', async () => {
  (ApiPromise.create as jest.Mock).mockRejectedValue(new Error('offline'));
  expect(await verifyAsymmetricContract(input)).toMatchObject({
    ok: false,
    status: 503,
  });
});
