/**
 * CopyVault On-Chain Proof Service
 *
 * SECURITY (BE-01 / BE-02): the backend NEVER signs CopyVault deposits or
 * withdrawals. The ink! contract credits/pays `env().caller()` with
 * `env().transferred_value()`, so a relayer-signed call would spend the
 * relayer's LUNES and credit the shares to the relayer. Instead:
 *
 *   1. The follower's own wallet signs `contracts.call(deposit|withdraw)` on
 *      the vault contract (frontend) and waits for `isFinalized`.
 *   2. The follower submits `{ txHash, blockHash }` to the API.
 *   3. This service proves, READ-ONLY, that:
 *        - the block is finalized and on the canonical chain,
 *        - the extrinsic with `txHash` is in that block, signed by the
 *          follower, calling `contracts.call` on this vault with the expected
 *          message selector,
 *        - the extrinsic succeeded and the vault contract emitted the
 *          matching Deposited/Withdrawn event for the follower.
 *   4. The caller journals the DB using the amounts FROM THE CHAIN EVENT.
 *
 * Replay protection (same txHash credited twice) is enforced by the caller via
 * the unique `txHash` columns on CopyVaultDeposit / CopyVaultWithdrawal.
 */

import fs from 'fs';
import path from 'path';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { compactAddLength, hexToU8a, u8aToHex } from '@polkadot/util';
import { Decimal } from '@prisma/client/runtime/library';
import { config } from '../config';
import { ApiError } from '../middleware/errors';
import { log } from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────

/** LUNES (native) has 8 decimals; the CopyVault contract holds native LUNES. */
const PLANCKS_PER_UNIT = new Decimal('100000000');

/**
 * ink! message selectors (blake2b("deposit"/"withdraw")[0..4]); stable across
 * contract versions — see lunes-dex-main/src/abis/CopyVault.json.
 */
export const COPY_VAULT_SELECTORS = {
  deposit: '0x2d10c9bd',
  withdraw: '0x410fcc9d',
  getLeader: '0x87aba724',
} as const;

/**
 * ink! 4 encodes contract events as `[variant index: u8] ++ SCALE(fields)`,
 * where the index is the declaration order in Lunex/contracts/copy_vault/lib.rs
 * (Deposited = 0, Withdrawn = 1).
 */
const EVENT_INDEX = { deposit: 0, withdraw: 1 } as const;
const ACCOUNT_LEN = 32;
const U128_LEN = 16;

// ─── Types ──────────────────────────────────────────────────────

export type VaultTxKind = 'deposit' | 'withdraw';

export type ChainExtrinsicView = {
  hash: string;
  signer: string | null;
  section: string;
  method: string;
  /** contracts.call `dest` (SS58), null for other calls. */
  dest: string | null;
  /** First 4 bytes of contracts.call `data` (0x-hex), null otherwise. */
  selector: string | null;
  /** contracts.call `value` in plancks, null otherwise. */
  value: bigint | null;
};

export type ChainEventView = {
  extrinsicIndex: number | null;
  section: string;
  method: string;
  /** contracts.ContractEmitted emitting contract (SS58). */
  contract?: string;
  /** contracts.ContractEmitted raw event payload. */
  data?: Uint8Array;
};

/** Minimal read-only view of the chain needed to prove a vault tx. */
export interface VaultChainReader {
  getBlockNumber(blockHash: string): Promise<number | null>;
  getFinalizedBlockNumber(): Promise<number>;
  getCanonicalBlockHash(blockNumber: number): Promise<string>;
  getExtrinsics(blockHash: string): Promise<ChainExtrinsicView[]>;
  getEvents(blockHash: string): Promise<ChainEventView[]>;
}

export type VaultTxProofParams = {
  kind: VaultTxKind;
  vaultAddress: string;
  followerAddress: string;
  txHash: string;
  blockHash: string;
};

export type VerifiedVaultTx = {
  kind: VaultTxKind;
  txHash: string;
  blockHash: string;
  blockNumber: number;
  /** deposit: amount deposited · withdraw: net amount received (units). */
  amount: string;
  /** deposit: shares minted · withdraw: shares burned (units). */
  shares: string;
  /** withdraw only: performance fee paid to the leader (units). */
  performanceFee: string;
};

// ─── Pure helpers ───────────────────────────────────────────────

function invalidProof(message: string): ApiError {
  return new ApiError(422, 'INVALID_VAULT_TX_PROOF', message);
}

function accountHex(address: string): string | null {
  try {
    return u8aToHex(decodeAddress(address));
  } catch {
    return null;
  }
}

function sameAccount(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = accountHex(a);
  const right = accountHex(b);
  return left !== null && left === right;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = U128_LEN - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[offset + i]);
  }
  return value;
}

export function plancksToUnits(plancks: bigint): string {
  return new Decimal(plancks.toString()).div(PLANCKS_PER_UNIT).toString();
}

export function unitsToPlancks(units: string): bigint {
  const value = new Decimal(units);
  if (!value.isFinite() || value.lte(0)) {
    throw new Error('[CopyVault] Amount must be positive');
  }
  return BigInt(value.mul(PLANCKS_PER_UNIT).toFixed(0, Decimal.ROUND_DOWN));
}

type DecodedVaultEvent = {
  depositor: string;
  first: bigint;
  second: bigint;
  third: bigint;
};

/**
 * Decode Deposited (depositor, amount, shares_minted, share_price, ts) or
 * Withdrawn (depositor, shares_burned, amount_received, performance_fee, ts).
 */
function decodeVaultEvent(
  kind: VaultTxKind,
  data: Uint8Array | undefined,
): DecodedVaultEvent | null {
  const minLength = 1 + ACCOUNT_LEN + U128_LEN * 3;
  if (!data || data.length < minLength) return null;
  if (data[0] !== EVENT_INDEX[kind]) return null;
  const depositor = u8aToHex(data.slice(1, 1 + ACCOUNT_LEN));
  const base = 1 + ACCOUNT_LEN;
  return {
    depositor,
    first: readU128(data, base),
    second: readU128(data, base + U128_LEN),
    third: readU128(data, base + U128_LEN * 2),
  };
}

/**
 * Prove a follower-signed CopyVault tx against a finalized canonical block.
 * Throws ApiError (409 not finalized yet, 422 invalid proof); never returns a
 * partial result.
 */
export async function verifyVaultTxProof(
  reader: VaultChainReader,
  params: VaultTxProofParams,
): Promise<VerifiedVaultTx> {
  const txHash = params.txHash.toLowerCase();
  const blockHash = params.blockHash.toLowerCase();

  const blockNumber = await reader.getBlockNumber(blockHash);
  if (blockNumber === null || blockNumber === undefined) {
    throw invalidProof('Block not found on chain');
  }

  const finalizedNumber = await reader.getFinalizedBlockNumber();
  if (blockNumber > finalizedNumber) {
    throw new ApiError(
      409,
      'TX_NOT_FINALIZED',
      'Vault transaction is not finalized yet; retry after finality',
    );
  }

  const canonical = (
    await reader.getCanonicalBlockHash(blockNumber)
  ).toLowerCase();
  if (canonical !== blockHash) {
    throw invalidProof('Block is not on the canonical finalized chain');
  }

  const extrinsics = await reader.getExtrinsics(blockHash);
  const index = extrinsics.findIndex((ex) => ex.hash.toLowerCase() === txHash);
  if (index < 0) throw invalidProof('Transaction not found in block');
  const extrinsic = extrinsics[index];

  if (!sameAccount(extrinsic.signer, params.followerAddress)) {
    throw invalidProof('Transaction signer is not the follower wallet');
  }
  if (extrinsic.section !== 'contracts' || extrinsic.method !== 'call') {
    throw invalidProof('Transaction is not a contracts.call');
  }
  if (!sameAccount(extrinsic.dest, params.vaultAddress)) {
    throw invalidProof('Transaction does not target this vault contract');
  }
  if (
    (extrinsic.selector ?? '').toLowerCase() !==
    COPY_VAULT_SELECTORS[params.kind]
  ) {
    throw invalidProof(`Transaction selector is not CopyVault.${params.kind}`);
  }

  const events = (await reader.getEvents(blockHash)).filter(
    (event) => event.extrinsicIndex === index,
  );
  const succeeded = events.some(
    (e) => e.section === 'system' && e.method === 'ExtrinsicSuccess',
  );
  const failed = events.some(
    (e) => e.section === 'system' && e.method === 'ExtrinsicFailed',
  );
  if (!succeeded || failed) throw invalidProof('Vault transaction failed');

  const followerHex = accountHex(params.followerAddress);
  const decoded = events
    .filter(
      (e) =>
        e.section === 'contracts' &&
        e.method === 'ContractEmitted' &&
        sameAccount(e.contract, params.vaultAddress),
    )
    .map((e) => decodeVaultEvent(params.kind, e.data))
    .filter(
      (e): e is DecodedVaultEvent => e !== null && e.depositor === followerHex,
    );

  const eventName = params.kind === 'deposit' ? 'Deposited' : 'Withdrawn';
  if (decoded.length !== 1) {
    throw invalidProof(
      `Expected exactly one ${eventName} event for the follower from this vault`,
    );
  }
  const event = decoded[0];

  if (params.kind === 'deposit') {
    if (extrinsic.value === null || extrinsic.value !== event.first) {
      throw invalidProof(
        'Deposited amount does not match the transferred value',
      );
    }
    return {
      kind: 'deposit',
      txHash,
      blockHash,
      blockNumber,
      amount: plancksToUnits(event.first),
      shares: plancksToUnits(event.second),
      performanceFee: '0',
    };
  }

  return {
    kind: 'withdraw',
    txHash,
    blockHash,
    blockNumber,
    amount: plancksToUnits(event.second),
    shares: plancksToUnits(event.first),
    performanceFee: plancksToUnits(event.third),
  };
}

// ─── Polkadot.js adapter ────────────────────────────────────────

type CodecLike = {
  toString(): string;
  toHex?(): string;
  toU8a?(isBare?: boolean): Uint8Array;
};

type MultiAddressLike = CodecLike & { isId?: boolean; asId?: CodecLike };

function readDest(arg: MultiAddressLike | undefined): string | null {
  if (!arg) return null;
  if (arg.isId && arg.asId) return arg.asId.toString();
  return arg.toString();
}

export function createPolkadotVaultChainReader(
  api: ApiPromise,
): VaultChainReader {
  return {
    async getBlockNumber(blockHash) {
      try {
        const header = await api.rpc.chain.getHeader(blockHash);
        return header.number.toNumber();
      } catch {
        return null;
      }
    },
    async getFinalizedBlockNumber() {
      const head = await api.rpc.chain.getFinalizedHead();
      const header = await api.rpc.chain.getHeader(head);
      return header.number.toNumber();
    },
    async getCanonicalBlockHash(blockNumber) {
      return (await api.rpc.chain.getBlockHash(blockNumber)).toHex();
    },
    async getExtrinsics(blockHash) {
      const signedBlock = await api.rpc.chain.getBlock(blockHash);
      return signedBlock.block.extrinsics.map((ex) => {
        const { section, method } = ex.method;
        const isCall = section === 'contracts' && method === 'call';
        const args = ex.method.args as unknown as CodecLike[];
        const data = isCall ? args[4]?.toU8a?.(true) : undefined;
        return {
          hash: ex.hash.toHex(),
          signer: ex.isSigned ? ex.signer.toString() : null,
          section,
          method,
          dest: isCall ? readDest(args[0] as MultiAddressLike) : null,
          selector:
            data && data.length >= 4 ? u8aToHex(data.slice(0, 4)) : null,
          value: isCall && args[1] ? BigInt(args[1].toString()) : null,
        };
      });
    },
    async getEvents(blockHash) {
      const apiAt = await api.at(blockHash);
      const records = (await apiAt.query.system.events()) as unknown as Array<{
        phase: {
          isApplyExtrinsic: boolean;
          asApplyExtrinsic: { toNumber(): number };
        };
        event: { section: string; method: string; data: CodecLike[] };
      }>;
      return records.map((record) => {
        const { section, method, data } = record.event;
        const isEmitted =
          section === 'contracts' && method === 'ContractEmitted';
        return {
          extrinsicIndex: record.phase.isApplyExtrinsic
            ? record.phase.asApplyExtrinsic.toNumber()
            : null,
          section,
          method,
          contract: isEmitted ? data[0]?.toString() : undefined,
          data: isEmitted ? data[1]?.toU8a?.(true) : undefined,
        };
      });
    },
  };
}

// ─── Contract binding (item 7) ──────────────────────────────────

/**
 * READ-ONLY view of a deployed contract, used before an operator binds a DB
 * vault to it. Injectable so it is unit-testable without a node.
 */
export interface VaultContractInspector {
  /** Code hash of the contract at `contractAddress`; null if none exists. */
  getCodeHash(contractAddress: string): Promise<string | null>;
  /** `get_leader()` of the contract; null when it cannot be read. */
  readLeader(contractAddress: string): Promise<string | null>;
}

export type VaultContractBinding = {
  contractAddress: string;
  codeHash: string;
};

/**
 * Proves that `contractAddress` is a live CopyVault running the audited code
 * (`expectedCodeHash`, from the bundled ABI) whose leader is `leaderAddress`.
 */
export async function verifyVaultContractBinding(
  inspector: VaultContractInspector,
  params: {
    contractAddress: string;
    leaderAddress: string;
    expectedCodeHash: string;
  },
): Promise<VaultContractBinding> {
  const codeHash = await inspector.getCodeHash(params.contractAddress);
  if (!codeHash) {
    throw new ApiError(
      422,
      'VAULT_CONTRACT_NOT_FOUND',
      'No contract is deployed at this address',
    );
  }
  if (codeHash.toLowerCase() !== params.expectedCodeHash.toLowerCase()) {
    throw new ApiError(
      422,
      'VAULT_CODE_HASH_MISMATCH',
      'Contract code is not the audited CopyVault build',
      { codeHash, expectedCodeHash: params.expectedCodeHash },
    );
  }
  const leader = await inspector.readLeader(params.contractAddress);
  if (!sameAccount(leader, params.leaderAddress)) {
    throw new ApiError(
      422,
      'VAULT_LEADER_MISMATCH',
      'Vault contract leader does not match the vault leader wallet',
    );
  }
  return { contractAddress: params.contractAddress, codeHash };
}

type ContractInfoLike = {
  isNone: boolean;
  unwrap(): { codeHash: { toHex(): string } };
};
type ContractCallResultLike = {
  result: {
    isOk: boolean;
    asOk: {
      flags: { isRevert: boolean };
      data: { toU8a(bare?: boolean): Uint8Array };
    };
  };
};

export function createPolkadotVaultContractInspector(
  api: ApiPromise,
): VaultContractInspector {
  return {
    async getCodeHash(contractAddress) {
      const info = (await api.query.contracts.contractInfoOf(
        contractAddress,
      )) as unknown as ContractInfoLike;
      return info.isNone ? null : info.unwrap().codeHash.toHex();
    },
    async readLeader(contractAddress) {
      const call = api.call.contractsApi.call as unknown as (
        ...args: unknown[]
      ) => Promise<ContractCallResultLike>;
      // Dry-run (no tx): origin = the contract itself, no value, max weight.
      const res = await call(
        contractAddress,
        contractAddress,
        0,
        null,
        null,
        // Vec<u8> input: a raw Uint8Array is decoded as SCALE, so it needs
        // its compact length prefix (like AbiMessage.toU8a produces).
        compactAddLength(hexToU8a(COPY_VAULT_SELECTORS.getLeader)),
      );
      if (!res.result.isOk || res.result.asOk.flags.isRevert) return null;
      // MessageResult<AccountId> = Ok(0x00) ++ 32-byte AccountId.
      const data = res.result.asOk.data.toU8a(true);
      if (data.length !== 1 + ACCOUNT_LEN || data[0] !== 0) return null;
      return encodeAddress(data.slice(1));
    },
  };
}

const COPY_VAULT_ABI_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'lunes-dex-main',
  'src',
  'abis',
  'CopyVault.json',
);

/** Code hash of the audited CopyVault build shipped with the frontend ABI. */
function loadExpectedCodeHash(): string {
  try {
    const abi = JSON.parse(fs.readFileSync(COPY_VAULT_ABI_PATH, 'utf8')) as {
      source?: { hash?: string };
    };
    const hash = abi.source?.hash;
    if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) return hash;
  } catch (err: unknown) {
    log.error({ err }, '[CopyVault] Cannot read CopyVault ABI');
  }
  throw new ApiError(
    503,
    'COPY_VAULT_ABI_UNAVAILABLE',
    'Audited CopyVault code hash is unavailable',
  );
}

// ─── Service ────────────────────────────────────────────────────

class CopyVaultService {
  private reader: VaultChainReader | null = null;
  private inspector: VaultContractInspector | null = null;
  private initPromise: Promise<VaultChainReader | null> | null = null;

  /** On-chain verification needs only a node RPC (no signing key). */
  isEnabled(): boolean {
    return Boolean(config.blockchain.wsUrl);
  }

  private async getReader(): Promise<VaultChainReader> {
    if (!this.isEnabled()) {
      throw new ApiError(
        503,
        'CHAIN_UNAVAILABLE',
        'On-chain vault verification is unavailable',
      );
    }
    if (this.reader) return this.reader;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const api = await ApiPromise.create({
            provider: new WsProvider(config.blockchain.wsUrl),
          });
          await api.isReady;
          this.reader = createPolkadotVaultChainReader(api);
          this.inspector = createPolkadotVaultContractInspector(api);
          return this.reader;
        } catch (err: unknown) {
          log.error({ err }, '[CopyVault] Chain connection failed');
          this.initPromise = null;
          return null;
        }
      })();
    }
    const reader = await this.initPromise;
    if (!reader) {
      throw new ApiError(
        503,
        'CHAIN_UNAVAILABLE',
        'On-chain vault verification is unavailable',
      );
    }
    return reader;
  }

  async verifyDeposit(
    params: Omit<VaultTxProofParams, 'kind'>,
  ): Promise<VerifiedVaultTx> {
    return verifyVaultTxProof(await this.getReader(), {
      ...params,
      kind: 'deposit',
    });
  }

  /** Item 7: proves a vault contract before an operator binds it. */
  async verifyContractBinding(params: {
    contractAddress: string;
    leaderAddress: string;
  }): Promise<VaultContractBinding> {
    const expectedCodeHash = loadExpectedCodeHash();
    await this.getReader();
    if (!this.inspector) {
      throw new ApiError(
        503,
        'CHAIN_UNAVAILABLE',
        'On-chain vault verification is unavailable',
      );
    }
    return verifyVaultContractBinding(this.inspector, {
      ...params,
      expectedCodeHash,
    });
  }

  async verifyWithdrawal(
    params: Omit<VaultTxProofParams, 'kind'>,
  ): Promise<VerifiedVaultTx> {
    return verifyVaultTxProof(await this.getReader(), {
      ...params,
      kind: 'withdraw',
    });
  }
}

export const copyVaultService = new CopyVaultService();
