import { ApiPromise, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { decodeAddress } from '@polkadot/util-crypto';
import { u8aEq } from '@polkadot/util';
import { dryRunGasLimit } from '../utils/contractGas';
import { withTxTimeout } from '../utils/txWithTimeout';

type Verification =
  | { ok: true; owner: string; codeHash: string }
  | { ok: false; status: 403 | 503; error: string };

export async function verifyAsymmetricContract(input: {
  address: string;
  ownerAddress: string;
  rpcUrl: string;
  expectedCodeHash: string;
  requireCodeHash: boolean;
  loadAbi: () => unknown;
}): Promise<Verification> {
  if (input.requireCodeHash && !input.expectedCodeHash) {
    return {
      ok: false,
      status: 503,
      error: 'ASYMMETRIC_PAIR_CODE_HASH is required in production.',
    };
  }

  let api: ApiPromise | undefined;
  let provider: WsProvider | undefined;
  try {
    provider = new WsProvider(input.rpcUrl);
    api = await withTxTimeout(
      'asymmetric-owner-connect',
      ApiPromise.create({ provider, noInitWarn: true }),
      10_000,
    );
    const info = await withTxTimeout(
      'asymmetric-contract-info',
      api.query.contracts.contractInfoOf(input.address),
      10_000,
    );
    const codeHash = (info as any).isSome
      ? (info as any).unwrap().codeHash.toHex()
      : '';
    if (
      !codeHash ||
      (input.expectedCodeHash && codeHash !== input.expectedCodeHash)
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Contract is not an official deployed AsymmetricPair.',
      };
    }

    const contract = new ContractPromise(
      api,
      input.loadAbi() as any,
      input.address,
    );
    const { result, output } = await withTxTimeout(
      'asymmetric-owner-query',
      contract.query.getOwner(input.ownerAddress, {
        gasLimit: dryRunGasLimit(api),
        storageDepositLimit: null,
      }),
      10_000,
    );
    if (result.isErr || !output) throw new Error('Owner query unavailable');

    let owner: unknown = output.toJSON();
    while (owner && typeof owner === 'object') {
      const envelope = owner as Record<string, unknown>;
      if ('err' in envelope || 'Err' in envelope)
        throw new Error('Owner query failed');
      if ('ok' in envelope) owner = envelope.ok;
      else if ('Ok' in envelope) owner = envelope.Ok;
      else break;
    }
    if (typeof owner !== 'string') throw new Error('Invalid owner response');
    if (
      owner !== input.ownerAddress &&
      !u8aEq(decodeAddress(owner), decodeAddress(input.ownerAddress))
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Only the on-chain owner can register this asymmetric strategy.',
      };
    }
    return { ok: true, owner, codeHash };
  } catch {
    return {
      ok: false,
      status: 503,
      error:
        'Unable to verify the asymmetric contract owner. Retry when chain connectivity is restored.',
    };
  } finally {
    if (api) await api.disconnect();
    else await provider?.disconnect();
  }
}
