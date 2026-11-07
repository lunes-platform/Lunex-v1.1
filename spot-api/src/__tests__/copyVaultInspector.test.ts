import { compactAddLength, hexToU8a, u8aConcat } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import {
  COPY_VAULT_SELECTORS,
  createPolkadotVaultContractInspector,
} from '../services/copyVaultService';

const LEADER = '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw';
const VAULT = '5ChgZcpZR6LiS6H5p5Tn27KatMxivEZFJwBKJcekqoj9d9tf';

function fakeApi(returnData: Uint8Array) {
  const call = jest.fn(async () => ({
    result: {
      isOk: true,
      asOk: {
        flags: { isRevert: false },
        data: { toU8a: () => returnData },
      },
    },
  }));
  return { api: { call: { contractsApi: { call } } }, call };
}

describe('createPolkadotVaultContractInspector.readLeader', () => {
  it('sends the selector as length-prefixed Vec<u8> input data', async () => {
    // Raw selector bytes would be decoded as a compact length by
    // createType(Vec<u8>, Uint8Array) and blow up on a real node.
    const { api, call } = fakeApi(
      u8aConcat(new Uint8Array([0]), decodeAddress(LEADER)),
    );
    const inspector = createPolkadotVaultContractInspector(api as never);
    await inspector.readLeader(VAULT);
    const input = (call.mock.calls[0] as unknown[])[5];
    expect(input).toEqual(
      compactAddLength(hexToU8a(COPY_VAULT_SELECTORS.getLeader)),
    );
  });

  it('decodes Ok(AccountId) into an ss58 address', async () => {
    const { api } = fakeApi(
      u8aConcat(new Uint8Array([0]), decodeAddress(LEADER)),
    );
    const inspector = createPolkadotVaultContractInspector(api as never);
    expect(await inspector.readLeader(VAULT)).toBe(
      encodeAddress(decodeAddress(LEADER)),
    );
  });
});
