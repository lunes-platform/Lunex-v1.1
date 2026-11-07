// BE-01/BE-02: a CopyVault deposit/withdraw is credited ONLY after the backend
// proves, against a finalized canonical block, that the follower's own wallet
// signed `contracts.call` on that vault contract and that the contract emitted
// the matching Deposited/Withdrawn event for the follower.

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { decodeAddress } from '@polkadot/util-crypto';
import {
  COPY_VAULT_SELECTORS,
  VaultChainReader,
  ChainEventView,
  ChainExtrinsicView,
  verifyVaultTxProof,
} from '../services/copyVaultService';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const VAULT = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y';
const OTHER_VAULT = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy';
const TX = `0x${'aa'.repeat(32)}`;
const BLOCK = `0x${'bb'.repeat(32)}`;

function u128(value: bigint): number[] {
  const out: number[] = [];
  let v = value;
  for (let i = 0; i < 16; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

function u64(value: bigint): number[] {
  return u128(value).slice(0, 8);
}

function depositedEvent(depositor: string, amount: bigint, shares: bigint) {
  return Uint8Array.from([
    0,
    ...decodeAddress(depositor),
    ...u128(amount),
    ...u128(shares),
    ...u128(100_000_000n),
    ...u64(1_700_000_000_000n),
  ]);
}

function withdrawnEvent(
  depositor: string,
  shares: bigint,
  received: bigint,
  fee: bigint,
) {
  return Uint8Array.from([
    1,
    ...decodeAddress(depositor),
    ...u128(shares),
    ...u128(received),
    ...u128(fee),
    ...u64(1_700_000_000_000n),
  ]);
}

function makeReader(overrides?: {
  blockNumber?: number | null;
  finalized?: number;
  canonical?: string;
  extrinsics?: ChainExtrinsicView[];
  events?: ChainEventView[];
}): VaultChainReader {
  const extrinsics = overrides?.extrinsics ?? [
    {
      hash: '0x01',
      signer: null,
      section: 'timestamp',
      method: 'set',
      dest: null,
      selector: null,
      value: null,
    },
    {
      hash: TX,
      signer: ALICE,
      section: 'contracts',
      method: 'call',
      dest: VAULT,
      selector: COPY_VAULT_SELECTORS.deposit,
      value: 1_500_000_000n,
    },
  ];
  const events = overrides?.events ?? [
    {
      extrinsicIndex: 1,
      section: 'contracts',
      method: 'ContractEmitted',
      contract: VAULT,
      data: depositedEvent(ALICE, 1_500_000_000n, 1_200_000_000n),
    },
    { extrinsicIndex: 1, section: 'system', method: 'ExtrinsicSuccess' },
  ];
  return {
    getBlockNumber: jest
      .fn()
      .mockResolvedValue(
        overrides && 'blockNumber' in overrides ? overrides.blockNumber : 100,
      ),
    getFinalizedBlockNumber: jest
      .fn()
      .mockResolvedValue(overrides?.finalized ?? 120),
    getCanonicalBlockHash: jest
      .fn()
      .mockResolvedValue(overrides?.canonical ?? BLOCK),
    getExtrinsics: jest.fn().mockResolvedValue(extrinsics),
    getEvents: jest.fn().mockResolvedValue(events),
  };
}

const depositParams = {
  kind: 'deposit' as const,
  vaultAddress: VAULT,
  followerAddress: ALICE,
  txHash: TX,
  blockHash: BLOCK,
};

describe('verifyVaultTxProof — deposit', () => {
  it('returns on-chain amount and shares (8-decimal LUNES) for a valid finalized deposit', async () => {
    const proof = await verifyVaultTxProof(makeReader(), depositParams);
    expect(proof).toMatchObject({
      kind: 'deposit',
      txHash: TX,
      blockHash: BLOCK,
      amount: '15',
      shares: '12',
    });
  });

  it('rejects a block that is not finalized yet', async () => {
    await expect(
      verifyVaultTxProof(makeReader({ finalized: 99 }), depositParams),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a block hash that is not on the canonical finalized chain (fork)', async () => {
    await expect(
      verifyVaultTxProof(
        makeReader({ canonical: `0x${'cc'.repeat(32)}` }),
        depositParams,
      ),
    ).rejects.toThrow(/canonical/i);
  });

  it('rejects an unknown block', async () => {
    await expect(
      verifyVaultTxProof(makeReader({ blockNumber: null }), depositParams),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects when the tx hash is not in the block', async () => {
    await expect(
      verifyVaultTxProof(makeReader(), {
        ...depositParams,
        txHash: `0x${'dd'.repeat(32)}`,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects when the extrinsic was signed by someone else (relayer or third party)', async () => {
    await expect(
      verifyVaultTxProof(makeReader(), {
        ...depositParams,
        followerAddress: BOB,
      }),
    ).rejects.toThrow(/signer/i);
  });

  it('rejects a call to a different contract', async () => {
    await expect(
      verifyVaultTxProof(makeReader(), {
        ...depositParams,
        vaultAddress: OTHER_VAULT,
      }),
    ).rejects.toThrow(/vault contract/i);
  });

  it('rejects a call to a different message (selector)', async () => {
    const reader = makeReader({
      extrinsics: [
        {
          hash: TX,
          signer: ALICE,
          section: 'contracts',
          method: 'call',
          dest: VAULT,
          selector: COPY_VAULT_SELECTORS.withdraw,
          value: 0n,
        },
      ],
    });
    await expect(verifyVaultTxProof(reader, depositParams)).rejects.toThrow(
      /selector/i,
    );
  });

  it('rejects a failed extrinsic', async () => {
    const reader = makeReader({
      events: [
        { extrinsicIndex: 1, section: 'system', method: 'ExtrinsicFailed' },
      ],
    });
    await expect(verifyVaultTxProof(reader, depositParams)).rejects.toThrow(
      /failed/i,
    );
  });

  it('rejects when the Deposited event credits another depositor', async () => {
    const reader = makeReader({
      events: [
        {
          extrinsicIndex: 1,
          section: 'contracts',
          method: 'ContractEmitted',
          contract: VAULT,
          data: depositedEvent(BOB, 1_500_000_000n, 1_200_000_000n),
        },
        { extrinsicIndex: 1, section: 'system', method: 'ExtrinsicSuccess' },
      ],
    });
    await expect(verifyVaultTxProof(reader, depositParams)).rejects.toThrow(
      /Deposited event/i,
    );
  });

  it('rejects events emitted for a different extrinsic or contract', async () => {
    const reader = makeReader({
      events: [
        {
          extrinsicIndex: 0,
          section: 'contracts',
          method: 'ContractEmitted',
          contract: VAULT,
          data: depositedEvent(ALICE, 1_500_000_000n, 1_200_000_000n),
        },
        {
          extrinsicIndex: 1,
          section: 'contracts',
          method: 'ContractEmitted',
          contract: OTHER_VAULT,
          data: depositedEvent(ALICE, 1_500_000_000n, 1_200_000_000n),
        },
        { extrinsicIndex: 1, section: 'system', method: 'ExtrinsicSuccess' },
      ],
    });
    await expect(verifyVaultTxProof(reader, depositParams)).rejects.toThrow(
      /Deposited event/i,
    );
  });

  it('rejects when the event amount differs from the transferred value', async () => {
    const reader = makeReader({
      events: [
        {
          extrinsicIndex: 1,
          section: 'contracts',
          method: 'ContractEmitted',
          contract: VAULT,
          data: depositedEvent(ALICE, 9_000_000_000n, 1_200_000_000n),
        },
        { extrinsicIndex: 1, section: 'system', method: 'ExtrinsicSuccess' },
      ],
    });
    await expect(verifyVaultTxProof(reader, depositParams)).rejects.toThrow(
      /transferred value/i,
    );
  });
});

describe('verifyVaultTxProof — withdraw', () => {
  it('returns shares burned, net received and fee from the Withdrawn event', async () => {
    const reader = makeReader({
      extrinsics: [
        {
          hash: TX,
          signer: ALICE,
          section: 'contracts',
          method: 'call',
          dest: VAULT,
          selector: COPY_VAULT_SELECTORS.withdraw,
          value: 0n,
        },
      ],
      events: [
        {
          extrinsicIndex: 0,
          section: 'contracts',
          method: 'ContractEmitted',
          contract: VAULT,
          data: withdrawnEvent(ALICE, 500_000_000n, 900_000_000n, 100_000_000n),
        },
        { extrinsicIndex: 0, section: 'system', method: 'ExtrinsicSuccess' },
      ],
    });
    const proof = await verifyVaultTxProof(reader, {
      ...depositParams,
      kind: 'withdraw',
    });
    expect(proof).toMatchObject({
      kind: 'withdraw',
      shares: '5',
      amount: '9',
      performanceFee: '1',
    });
  });

  it('rejects a withdraw tx that emitted no Withdrawn event (e.g. cooldown request only)', async () => {
    const reader = makeReader({
      extrinsics: [
        {
          hash: TX,
          signer: ALICE,
          section: 'contracts',
          method: 'call',
          dest: VAULT,
          selector: COPY_VAULT_SELECTORS.withdraw,
          value: 0n,
        },
      ],
      events: [
        { extrinsicIndex: 0, section: 'system', method: 'ExtrinsicSuccess' },
      ],
    });
    await expect(
      verifyVaultTxProof(reader, { ...depositParams, kind: 'withdraw' }),
    ).rejects.toThrow(/Withdrawn event/i);
  });
});
