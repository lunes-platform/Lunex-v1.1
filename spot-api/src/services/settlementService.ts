import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import {
  cryptoWaitReady,
  secp256k1PairFromSeed,
  secp256k1Compress,
  blake2AsU8a,
} from '@polkadot/util-crypto';
import { secp256k1Sign as wasmSecp256k1Sign } from '@polkadot/wasm-crypto';
import { hexToU8a, isHex, u8aToHex } from '@polkadot/util';
import { config } from '../config';
import { log } from '../utils/logger';
import {
  buildSpotOrderMessage,
  buildLegacySpotOrderMessage,
  verifySpotOrderSignature,
} from '../middleware/auth';
import { withTxTimeout } from '../utils/txWithTimeout';
import {
  reconcileFinalizedExtrinsic,
  type ExtrinsicReconciliation,
} from '../utils/extrinsicReconciliation';
import {
  toSettlementPriceUnits,
  toSettlementOrderPriceUnits,
} from '../utils/settlementUnits';
import {
  readContractBalance,
  readContractBoolean,
} from '../utils/contractResult';

type PairSettlementSnapshot = {
  symbol: string;
  baseToken: string;
  quoteToken: string;
  isNativeBase: boolean;
  isNativeQuote: boolean;
  baseDecimals: number;
  // Optional only for old persisted payloads, which must fail closed until repaired.
  quoteDecimals?: number;
};

type OrderSettlementSnapshot = {
  timeInForce?: string;
  makerAddress: string;
  side: string;
  type: string;
  price: string;
  stopPrice?: string | null;
  amount: string;
  filledAmount: string;
  nonce: string;
  signature: string;
  signatureTimestamp?: Date | null;
  expiresAt: Date | null;
};

export type TradeSettlementInput = {
  tradeId: string;
  pair: PairSettlementSnapshot;
  makerOrder: OrderSettlementSnapshot;
  takerOrder: OrderSettlementSnapshot;
  fillAmount: string;
  fillPrice: string;
};

/**
 * Mortal-era length (in blocks) of every settle_trade extrinsic. Once the
 * finalized head is past `birthBlock + SETTLEMENT_TX_MORTALITY_BLOCKS` a
 * not-yet-included extrinsic can never be included, which is what makes an
 * ambiguous submission provably resolvable (BE-07).
 */
export const SETTLEMENT_TX_MORTALITY_BLOCKS = 64;

/** Persisted before broadcast so an ambiguous outcome can be reconciled. */
export type SettlementSubmission = {
  txHash: string;
  relayerNonce: number;
  birthBlock: number;
  mortality: number;
};

export type SettlementHooks = {
  /**
   * Called with the signed extrinsic's hash/nonce/era right BEFORE it is
   * broadcast. If it throws, nothing is broadcast (fail closed).
   */
  onBeforeBroadcast?: (
    tradeId: string,
    submission: SettlementSubmission,
  ) => Promise<void>;
};

export type SettlementResult = {
  tradeId: string;
  /**
   * UNKNOWN: the extrinsic was broadcast but its outcome is not known (e.g.
   * timeout before finality, dropped, RPC error). It may still land and must
   * NOT be re-submitted until reconciled.
   */
  status: 'SETTLED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';
  txHash?: string;
  error?: string;
  submission?: SettlementSubmission;
  /**
   * SETTLED because the contract already records this fill as settled
   * (is_fill_settled at the finalized head) — no funds moved in this attempt
   * and the settling extrinsic hash is not known here.
   */
  alreadySettled?: boolean;
};

export type SubmissionReconciliation =
  | ExtrinsicReconciliation
  /**
   * The contract records this fill as settled at the FINALIZED head
   * (is_fill_settled). Idempotent contract: any still-pending copy of our
   * extrinsic would revert with TradeAlreadySettled, so this is final.
   */
  | { outcome: 'ALREADY_SETTLED' };

/** Outcome after broadcast is final: the extrinsic did not / cannot apply. */
class DefinitiveSettlementFailure extends Error {}

/** The contract already settled this fill (TradeAlreadySettled). */
class FillAlreadySettled extends Error {}

/**
 * Variant name of a contract-level `Err` in a decoded MessageResult
 * (`Ok(Err(SpotError::X))`), or null when the message returned Ok / the
 * output is not decodable.
 */
export function contractErrorVariant(output: unknown): string | null {
  const toJSON = (output as { toJSON?: () => unknown } | null)?.toJSON;
  if (typeof toJSON !== 'function') return null;
  const json = toJSON.call(output) as Record<string, unknown> | null;
  if (!json || typeof json !== 'object') return null;
  const inner = (json.ok ?? json.Ok) as Record<string, unknown> | undefined;
  if (!inner || typeof inner !== 'object') return null;
  const err = inner.err ?? inner.Err;
  if (err === undefined || err === null) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') return Object.keys(err)[0] ?? 'Unknown';
  return String(err);
}

function isTradeAlreadySettled(variant: string | null) {
  return variant?.toLowerCase() === 'tradealreadysettled';
}

/** Broadcast happened (or may have) and the outcome is unknown. */
class AmbiguousSubmissionError extends Error {
  constructor(
    message: string,
    public readonly submission: SettlementSubmission,
  ) {
    super(message);
  }
}

type ContractMethodKind = 'tx' | 'query';

/** The order fields exactly as signed at intake (input of every format). */
function settlementOrderMessageInput(
  pair: Pick<PairSettlementSnapshot, 'symbol'>,
  order: OrderSettlementSnapshot,
) {
  if (!order.signatureTimestamp) {
    throw new Error(
      `Missing order signature timestamp for ${order.makerAddress}`,
    );
  }
  return {
    timeInForce: order.timeInForce || 'GTC',
    expiresAt: order.expiresAt,
    pairSymbol: pair.symbol,
    side: order.side as 'BUY' | 'SELL',
    type: order.type as 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT',
    price: order.price,
    stopPrice: order.stopPrice || undefined,
    amount: order.amount,
    nonce: order.nonce,
    timestamp: order.signatureTimestamp.getTime(),
  };
}

/**
 * Canonical (v3, domain + genesis bound) message for a stored order, or the
 * deprecated unbound v1 format. Verification at settlement goes through
 * verifySpotOrderSignature, which owns the legacy gate.
 */
export function buildSettlementOrderSignatureMessage(
  pair: Pick<PairSettlementSnapshot, 'symbol'>,
  order: OrderSettlementSnapshot,
  version: 'v1' | 'v3' = 'v3',
) {
  const input = settlementOrderMessageInput(pair, order);
  return version === 'v1'
    ? buildLegacySpotOrderMessage(input)
    : buildSpotOrderMessage(input);
}

function normalizeMethodKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveMethodKey(contract: ContractPromise, expectedLabel: string) {
  const expected = normalizeMethodKey(expectedLabel);
  return (
    Object.keys(contract.tx).find((key) =>
      normalizeMethodKey(key).includes(expected),
    ) || null
  );
}

function resolveMethodKeyByKind(
  contract: ContractPromise,
  expectedLabel: string,
  kind: ContractMethodKind,
) {
  const expected = normalizeMethodKey(expectedLabel);
  const source = kind === 'tx' ? contract.tx : contract.query;
  return (
    Object.keys(source).find((key) =>
      normalizeMethodKey(key).includes(expected),
    ) || null
  );
}

function decimalToUnits(value: string, decimals: number) {
  const normalized = value.trim();
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fractionPart = ''] = unsigned.split('.');
  const base = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || '0') * base;
  const fraction = BigInt(
    (fractionPart + '0'.repeat(decimals)).slice(0, decimals) || '0',
  );
  const result = whole + fraction;
  return negative ? -result : result;
}

/**
 * Convert an order signature string to a 64-byte Uint8Array suitable for
 * the on-chain `SignedOrder.signature: [u8; 64]` field.
 *
 * Only real sr25519 hex signatures are valid on the on-chain settlement path.
 * Synthetic `agent:` and `manual:` signatures are off-chain markers and must
 * not be encoded into contract payloads until contract-level delegated auth
 * exists.
 */
export function signatureToBytes(sig: string): number[] {
  if (isHex(sig) || /^[0-9a-fA-F]{128}$/.test(sig)) {
    const hex = sig.startsWith('0x') ? sig : `0x${sig}`;
    const bytes = hexToU8a(hex);
    if (bytes.length !== 64) {
      throw new Error(
        `Invalid sr25519 signature length: expected 64 bytes, got ${bytes.length}. ` +
          `Signature (truncated): ${sig.slice(0, 20)}…`,
      );
    }
    return Array.from(bytes);
  }

  if (sig.startsWith('agent:') || sig.startsWith('manual:')) {
    throw new Error(
      `Synthetic agent/manual signatures cannot be used for on-chain settlement: ${sig.slice(
        0,
        20,
      )}...`,
    );
  }

  throw new Error(
    `Unrecognised signature format for settlement: ${sig.slice(0, 20)}... ` +
      `Expected a 64-byte sr25519 hex signature.`,
  );
}

function nonceToU64(nonce: string) {
  const digits = nonce.replace(/\D/g, '');
  if (!digits) {
    throw new Error(`Invalid numeric nonce: ${nonce}`);
  }

  const trimmed = digits.slice(-20);
  const parsed = BigInt(trimmed);
  const maxU64 = BigInt('18446744073709551615');
  if (parsed > maxU64) {
    return BigInt(trimmed.slice(-19));
  }
  return parsed;
}

/**
 * Shape of the on-chain `SignedOrder` payload AFTER `toSignedOrder()` has
 * converted DB values into contract-native representations: `maker`,
 * `base_token`, `quote_token` are Substrate `AccountId` codec instances (32
 * bytes), `side` is 0|1, and `price`/`amount`/`nonce`/`expiry` are decimal
 * strings already scaled to the smallest unit (u128 / u64).
 */
type OnChainSignedOrder = {
  maker: { toU8a(): Uint8Array };
  base_token: { toU8a(): Uint8Array };
  quote_token: { toU8a(): Uint8Array };
  side: number;
  price: string;
  amount: string;
  nonce: string;
  expiry: string;
  signature: number[];
};

function u128LeBytes(value: string): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) {
    throw new Error(`Negative balance cannot be encoded as u128: ${value}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new Error(`Balance exceeds u128 range: ${value}`);
  }
  return out;
}

function u64LeBytes(value: string): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) {
    throw new Error(`Negative value cannot be encoded as u64: ${value}`);
  }
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new Error(`Value exceeds u64 range: ${value}`);
  }
  return out;
}

/**
 * Byte-for-byte reconstruction of the contract's `build_order_message_v2`
 * (see `Lunex/contracts/spot_settlement/lib.rs`). The attestor signs the
 * blake2_256 of THIS exact payload; any divergence makes `ecdsa_recover`
 * return a pubkey that does not match `attestor_pubkey`, reverting settlement.
 *
 * Layout (must match the contract exactly):
 *   b"lunex:v2:spot-order\n"      (20 bytes, PREFIX_V2)
 *   maker                          (32 bytes, AccountId)
 *   base_token                     (32 bytes, AccountId)
 *   quote_token                    (32 bytes, AccountId)
 *   side                           (1 byte, 0=BUY 1=SELL)
 *   price                          (16 bytes, u128 little-endian)
 *   amount                         (16 bytes, u128 little-endian)
 *   nonce                          (8 bytes, u64 little-endian)
 *   expiry                         (8 bytes, u64 little-endian)
 * filled_amount is INTENTIONALLY excluded — on-chain storage is canonical.
 */
export function buildOrderMessageV2(order: OnChainSignedOrder): Uint8Array {
  const prefix = new TextEncoder().encode('lunex:v2:spot-order\n');
  const maker = order.maker.toU8a();
  const baseToken = order.base_token.toU8a();
  const quoteToken = order.quote_token.toU8a();
  if (
    maker.length !== 32 ||
    baseToken.length !== 32 ||
    quoteToken.length !== 32
  ) {
    throw new Error('AccountId encoding must be exactly 32 bytes');
  }
  const parts: Uint8Array[] = [
    prefix,
    maker,
    baseToken,
    quoteToken,
    Uint8Array.of(order.side),
    u128LeBytes(order.price),
    u128LeBytes(order.amount),
    u64LeBytes(order.nonce),
    u64LeBytes(order.expiry),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const msg = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    msg.set(p, offset);
    offset += p.length;
  }
  return msg;
}

/**
 * The 32-byte hash the attestor signs: `blake2_256(build_order_message_v2)`.
 * Mirrors `build_attestation_hash` in the contract.
 */
export function buildAttestationHash(order: OnChainSignedOrder): Uint8Array {
  return blake2AsU8a(buildOrderMessageV2(order), 256);
}

/**
 * Resolve the attestor's 32-byte secp256k1 seed from configuration. Accepts a
 * `0x`-prefixed (or bare) 64-hex-char string. Returns null when no attestor is
 * configured (settlement then stays fail-closed under enforced mode).
 */
export function resolveAttestorSeed(): Uint8Array | null {
  const raw = (config.settlement.attestorSeed || '').trim();
  if (!raw) {
    return null;
  }
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ATTESTOR_SEED must be a 32-byte (64 hex char) secp256k1 seed',
    );
  }
  return hexToU8a(hex);
}

/**
 * Derive the attestor secp256k1 keypair from its seed. The public key is
 * returned in 33-byte compressed SEC1 form — exactly what
 * `set_attestor_key(pubkey: [u8;33])` stores and what the contract's
 * `ecdsa_recover` produces for comparison.
 */
export function attestorKeypairFromSeed(seed: Uint8Array): {
  secretKey: Uint8Array;
  publicKeyCompressed: Uint8Array;
} {
  const pair = secp256k1PairFromSeed(seed);
  const publicKeyCompressed = secp256k1Compress(pair.publicKey);
  if (publicKeyCompressed.length !== 33) {
    throw new Error('Compressed attestor pubkey must be 33 bytes');
  }
  return { secretKey: pair.secretKey, publicKeyCompressed };
}

/**
 * Produce the 65-byte recoverable ECDSA attestation (`r ‖ s ‖ v`, v∈{0,1})
 * over `blake2_256(build_order_message_v2(order))`, signed with the attestor's
 * secp256k1 secret key. The wasm signer operates on the 32-byte digest
 * DIRECTLY (no second hash), matching `ink::env::ecdsa_recover` semantics.
 */
export function attestOrder(
  order: OnChainSignedOrder,
  attestorSecretKey: Uint8Array,
): number[] {
  const hash = buildAttestationHash(order);
  const sig = wasmSecp256k1Sign(hash, attestorSecretKey);
  if (sig.length !== 65) {
    throw new Error(`Attestation must be 65 bytes (r‖s‖v), got ${sig.length}`);
  }
  return Array.from(sig);
}

class SpotSettlementService {
  private api: ApiPromise | null = null;
  private contract: ContractPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
  private attestorSecretKey: Uint8Array | null = null;
  private attestorPublicKeyCompressed: Uint8Array | null = null;
  private settleMethodKey: string | null = null;
  private getBalanceMethodKey: string | null = null;
  private isNonceUsedMethodKey: string | null = null;
  private isNonceCancelledMethodKey: string | null = null;
  private cancelOrderForMethodKey: string | null = null;
  private initPromise: Promise<boolean> | null = null;

  // Relayer nonce pipeline. settle_trade is submitted concurrently (throttled
  // by MAX_SETTLE_CONCURRENCY) instead of serialized one-per-finalized-block.
  // polkadot.js `signAndSend(account, cb)` resolves the nonce lazily via
  // `system.accountNextIndex`, which does NOT account for not-yet-included
  // in-flight extrinsics — so N parallel submissions would all grab the SAME
  // nonce and the node would drop all but one. We therefore manage the nonce
  // explicitly: seed once from chain, then hand out monotonically increasing
  // values guarded by a single-flight async lock so each in-flight extrinsic
  // gets a distinct nonce. This preserves custody-grade correctness — each
  // trade still produces exactly one settle_trade extrinsic; the contract's
  // `used_nonces` guard (NonceAlreadyUsed) remains the idempotency backstop.
  private nextRelayerNonce: bigint | null = null;
  private nonceLock: Promise<void> = Promise.resolve();

  private isConfigured() {
    return Boolean(
      config.blockchain.wsUrl &&
      config.blockchain.spotContractAddress &&
      config.blockchain.spotContractMetadataPath &&
      config.blockchain.relayerSeed,
    );
  }

  isEnabled() {
    // Master-switch: even when fully configured, settlement stays OFF unless
    // SETTLEMENT_ENABLED is explicitly 'true' (default OFF if absent). This
    // makes a coordinated restart safe — config can be staged without arming
    // on-chain settlement.
    return this.isConfigured() && process.env.SETTLEMENT_ENABLED === 'true';
  }

  async ensureReady() {
    // Gate on isEnabled() (NOT isConfigured()): when SETTLEMENT_ENABLED!=true,
    // the relayer must not connect and on-chain paths (settle_trade,
    // cancel_order_for, nonce/balance reads) must short-circuit. Otherwise a
    // fully-configured-but-disabled deployment would still fire on-chain cancel
    // extrinsics per order cancellation. The master-switch must be complete.
    if (!this.isEnabled()) {
      return false;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    return this.initPromise;
  }

  private async initialize() {
    try {
      await cryptoWaitReady();

      const metadataPath = path.resolve(
        config.blockchain.spotContractMetadataPath,
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      const provider = new WsProvider(config.blockchain.wsUrl);
      const api = await ApiPromise.create({ provider });
      await api.isReady;

      const keyring = new Keyring({ type: 'sr25519' });
      const relayer = keyring.addFromUri(config.blockchain.relayerSeed);

      // Load the independent ECDSA attestor key (ADR-001 option c). When set,
      // every settle_trade carries a per-order attestation the contract
      // verifies via ecdsa_recover. Without it, settlement reverts under
      // enforced mode (fail-closed) — see verify_order_signature in lib.rs.
      const attestorSeed = resolveAttestorSeed();
      if (attestorSeed) {
        const { secretKey, publicKeyCompressed } =
          attestorKeypairFromSeed(attestorSeed);
        this.attestorSecretKey = secretKey;
        this.attestorPublicKeyCompressed = publicKeyCompressed;
        log.info(
          { attestorPubkey: u8aToHex(publicKeyCompressed) },
          '[SpotSettlement] Attestor key loaded; orders will carry ECDSA attestations',
        );
      } else {
        this.attestorSecretKey = null;
        this.attestorPublicKeyCompressed = null;
        log.warn(
          '[SpotSettlement] No ATTESTOR_SEED configured — settle_trade will REVERT under enforced signature mode',
        );
      }
      const contract = new ContractPromise(
        api as any,
        metadata as any,
        config.blockchain.spotContractAddress,
      );
      const settleMethodKey = resolveMethodKey(contract, 'settle_trade');
      const getBalanceMethodKey = resolveMethodKeyByKind(
        contract,
        'get_balance',
        'query',
      );
      const isNonceUsedMethodKey = resolveMethodKeyByKind(
        contract,
        'is_nonce_used',
        'query',
      );
      const isNonceCancelledMethodKey = resolveMethodKeyByKind(
        contract,
        'is_nonce_cancelled',
        'query',
      );
      const cancelOrderForMethodKey = resolveMethodKeyByKind(
        contract,
        'cancel_order_for',
        'tx',
      );

      if (
        !settleMethodKey ||
        !getBalanceMethodKey ||
        !isNonceUsedMethodKey ||
        !isNonceCancelledMethodKey
      ) {
        log.warn(
          '[SpotSettlement] Required contract methods not found in contract metadata',
        );
        return false;
      }

      this.api = api;
      this.contract = contract;
      this.relayer = relayer;
      // Seed the relayer nonce pipeline from chain on (re)connect. Any
      // previously cached value is discarded so a reconnect re-syncs with the
      // node's view and never reuses a stale nonce.
      this.nextRelayerNonce = null;
      this.settleMethodKey = settleMethodKey;
      this.getBalanceMethodKey = getBalanceMethodKey;
      this.isNonceUsedMethodKey = isNonceUsedMethodKey;
      this.isNonceCancelledMethodKey = isNonceCancelledMethodKey;
      this.cancelOrderForMethodKey = cancelOrderForMethodKey;

      log.info('[SpotSettlement] On-chain settlement enabled');
      return true;
    } catch (error) {
      log.error(
        { err: error },
        '[SpotSettlement] Failed to initialize settlement service',
      );
      return false;
    }
  }

  private toAccountId(address: string, isNative: boolean) {
    if (!this.api) throw new Error('Settlement API not initialized');

    if (isNative) {
      // Native token (LUNES) must be represented by a known placeholder AccountId
      // that matches the on-chain constant in the Spot contract (typically 0x00...00 or a specific sentinel).
      // Configure NATIVE_TOKEN_ADDRESS in .env to match the contract's expectation.
      const nativeAddr = config.blockchain.nativeTokenAddress;
      if (!nativeAddr) {
        log.warn(
          '[SpotSettlement] NATIVE_TOKEN_ADDRESS not set in config — falling back to zero AccountId. ' +
            'This may cause settlement failures for native-token pairs. ' +
            'Set NATIVE_TOKEN_ADDRESS in your .env to the sentinel address expected by the Spot contract.',
        );
        return this.api.createType('AccountId', new Uint8Array(32));
      }
      return this.api.createType('AccountId', nativeAddr);
    }

    return this.api.createType('AccountId', address);
  }

  private toUserAccountId(address: string) {
    if (!this.api) throw new Error('Settlement API not initialized');
    return this.api.createType('AccountId', address);
  }

  private getQueryMethod(methodKey: string | null) {
    if (!this.contract || !methodKey) return null;
    return (this.contract.query as Record<string, any>)[methodKey] || null;
  }

  private getTxMethod(methodKey: string | null) {
    if (!this.contract || !methodKey) return null;
    return (this.contract.tx as Record<string, any>)[methodKey] || null;
  }

  /**
   * Gas limit for contract dry-runs (query.* simulation).
   *
   * The Lunes pallet-contracts rejects the polkadot.js sentinel `gasLimit: -1`
   * with `contracts.OutOfGas` (module 24, error 0x02), which made every
   * settle_trade / cancel_order_for / nonce / balance dry-run fail. Substrate
   * expects an explicit WeightV2 ceiling on this chain. We pass a generous
   * WeightV2 so the dry-run can run to completion and return an accurate
   * `gasRequired`; the real extrinsic is then submitted with that measured
   * `gasRequired` (with built-in client margin), not this ceiling.
   *
   * Proven on-chain: cancel_order_for with WeightV2{refTime:600e9,proofSize:8e6}
   * dry-runs to {ok:{ok:null}}, whereas gasLimit:-1 returns OutOfGas.
   */
  private dryRunGasLimit() {
    if (!this.api) throw new Error('Settlement API not initialized');
    return this.api.registry.createType('WeightV2', {
      refTime: 600_000_000_000n,
      proofSize: 8_000_000n,
    });
  }

  /**
   * Gas limit for the REAL extrinsic, derived from the dry-run `gasRequired`
   * plus a safety margin. `gasRequired` is the exact measured weight of the
   * dry-run; on-chain execution can consume marginally more (storage growth,
   * block-state differences), so we add +50% headroom to avoid OutOfGas on
   * submit while still bounding the relayer's exposure.
   */
  private txGasLimit(gasRequired: {
    refTime: { toBigInt(): bigint };
    proofSize: { toBigInt(): bigint };
  }) {
    if (!this.api) throw new Error('Settlement API not initialized');
    const refTime = (gasRequired.refTime.toBigInt() * 150n) / 100n;
    const proofSize = (gasRequired.proofSize.toBigInt() * 150n) / 100n;
    return this.api.registry.createType('WeightV2', { refTime, proofSize });
  }

  /**
   * Max number of settle_trade extrinsics kept in flight simultaneously.
   * Bounds the relayer's exposure and protects the node's tx-pool from being
   * flooded. Configurable via MAX_SETTLE_CONCURRENCY (default 8). Clamped to
   * [1, 64] so a misconfiguration can never serialize (0) or flood the chain.
   */
  private settleConcurrency() {
    const raw = parseInt(process.env.MAX_SETTLE_CONCURRENCY || '8', 10);
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(raw, 64);
  }

  /**
   * Hands out a distinct, monotonically increasing relayer nonce for each
   * in-flight extrinsic. Seeds lazily from `system.accountNextIndex` on first
   * use after (re)connect, then increments locally. Serialized by a
   * single-flight async lock so concurrent callers can never observe the same
   * value (the seeding RPC await is a yield point, hence the lock).
   */
  private async nextNonce(): Promise<bigint> {
    if (!this.api || !this.relayer) {
      throw new Error('Settlement API not initialized');
    }

    let release!: () => void;
    const prev = this.nonceLock;
    this.nonceLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;

    try {
      if (this.nextRelayerNonce === null) {
        const onChain = await this.api.rpc.system.accountNextIndex(
          this.relayer.address,
        );
        this.nextRelayerNonce = BigInt(onChain.toString());
      }
      const nonce = this.nextRelayerNonce;
      this.nextRelayerNonce = nonce + 1n;
      return nonce;
    } finally {
      release();
    }
  }

  /**
   * Runs `worker` over `items` with at most `limit` concurrent invocations,
   * returning results in input order. Used to pipeline settle_trade
   * submissions without serializing on finality (one-per-block) or flooding
   * the node with the entire batch at once.
   */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const runner = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    };

    const pool = Array.from({ length: Math.min(limit, items.length) }, () =>
      runner(),
    );
    await Promise.all(pool);
    return results;
  }

  async getVaultBalance(
    userAddress: string,
    tokenAddress: string,
    isNative: boolean,
  ): Promise<bigint | null> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.relayer) return null;

    const queryMethod = this.getQueryMethod(this.getBalanceMethodKey);
    if (!queryMethod) return null;

    const { output, result } = await queryMethod(
      this.relayer.address,
      { gasLimit: this.dryRunGasLimit(), storageDepositLimit: null },
      this.toUserAccountId(userAddress),
      this.toAccountId(tokenAddress, isNative),
    );

    if (result.isErr || !output) {
      throw new Error(
        `[SpotSettlement] Failed to fetch vault balance for ${userAddress}`,
      );
    }

    return readContractBalance(output);
  }

  async isNonceUsed(
    userAddress: string,
    nonce: string,
  ): Promise<boolean | null> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.relayer) return null;

    const queryMethod = this.getQueryMethod(this.isNonceUsedMethodKey);
    if (!queryMethod) return null;

    const { output, result } = await queryMethod(
      this.relayer.address,
      { gasLimit: this.dryRunGasLimit(), storageDepositLimit: null },
      this.toUserAccountId(userAddress),
      nonceToU64(nonce).toString(),
    );

    if (result.isErr || !output) {
      throw new Error(
        `[SpotSettlement] Failed to fetch nonce usage for ${userAddress}`,
      );
    }

    return readContractBoolean(output);
  }

  async isNonceCancelled(
    userAddress: string,
    nonce: string,
  ): Promise<boolean | null> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.relayer) return null;

    const queryMethod = this.getQueryMethod(this.isNonceCancelledMethodKey);
    if (!queryMethod) return null;

    const { output, result } = await queryMethod(
      this.relayer.address,
      { gasLimit: this.dryRunGasLimit(), storageDepositLimit: null },
      this.toUserAccountId(userAddress),
      nonceToU64(nonce).toString(),
    );

    if (result.isErr || !output) {
      throw new Error(
        `[SpotSettlement] Failed to fetch cancelled nonce for ${userAddress}`,
      );
    }

    return readContractBoolean(output);
  }

  private toSignedOrder(
    pair: PairSettlementSnapshot,
    order: OrderSettlementSnapshot,
  ) {
    const signedOrder = {
      maker: this.toUserAccountId(order.makerAddress),
      base_token: this.toAccountId(pair.baseToken, pair.isNativeBase),
      quote_token: this.toAccountId(pair.quoteToken, pair.isNativeQuote),
      side: order.side === 'BUY' ? 0 : 1,
      price: toSettlementOrderPriceUnits(order, pair),
      amount: decimalToUnits(order.amount, pair.baseDecimals).toString(),
      filled_amount: decimalToUnits(
        order.filledAmount,
        pair.baseDecimals,
      ).toString(),
      nonce: nonceToU64(order.nonce).toString(),
      expiry: order.expiresAt ? String(order.expiresAt.getTime()) : '0',
      // sr25519 signature bytes stored on-chain for auditability.
      // Off-chain verification is done in assertOrderTrustedSource() before
      // this call. See verify_order_signature() in spot_settlement/lib.rs.
      signature: signatureToBytes(order.signature),
      // ECDSA attestation by the independent attestor over the canonical v2
      // order hash (65 bytes r‖s‖v), filled in below once all field values
      // are known. When enforced==true the contract recovers the pubkey and
      // compares it with attestor_pubkey; a 65-zero placeholder (no attestor
      // configured) always reverts under enforced mode.
      attestation: new Array(65).fill(0) as number[],
    };
    // Sign the FINAL on-chain field values — buildOrderMessageV2 reads the
    // exact same maker/token/side/price/amount/nonce/expiry the contract sees.
    if (this.attestorSecretKey) {
      signedOrder.attestation = attestOrder(
        signedOrder,
        this.attestorSecretKey,
      );
    }
    return signedOrder;
  }

  private async assertOrderTrustedSource(
    pair: PairSettlementSnapshot,
    order: OrderSettlementSnapshot,
  ) {
    if (!order.signature || order.signature.length < 8) {
      throw new Error(`Missing order signature for ${order.makerAddress}`);
    }

    if (order.signature.startsWith('agent:')) {
      throw new Error(
        `Synthetic agent signatures cannot be used for on-chain settlement for ${order.makerAddress}`,
      );
    }

    if (order.signature.startsWith('manual:')) {
      throw new Error(
        `Unsupported synthetic signature for ${order.makerAddress}`,
      );
    }

    // Same acceptance rules as order intake: v3 always; legacy v2 / v1 only
    // with SIGNING_ACCEPT_LEGACY (v1 only for plain GTC without expiry).
    const version = await verifySpotOrderSignature(
      settlementOrderMessageInput(pair, order),
      order.signature,
      order.makerAddress,
    );

    if (!version) {
      throw new Error(`Invalid order signature for ${order.makerAddress}`);
    }
  }

  private async assertSettlementInputTrusted(input: TradeSettlementInput) {
    await Promise.all([
      this.assertOrderTrustedSource(input.pair, input.makerOrder),
      this.assertOrderTrustedSource(input.pair, input.takerOrder),
    ]);
  }

  private async submitSettlement(
    input: TradeSettlementInput,
    hooks: SettlementHooks = {},
  ): Promise<string | null> {
    await this.assertSettlementInputTrusted(input);

    const isReady = await this.ensureReady();
    if (!isReady || !this.contract || !this.relayer || !this.settleMethodKey) {
      return null;
    }

    const queryMethod = (this.contract.query as Record<string, any>)[
      this.settleMethodKey
    ];
    const txMethod = (this.contract.tx as Record<string, any>)[
      this.settleMethodKey
    ];
    if (!queryMethod || !txMethod) {
      throw new Error(
        `Missing contract method binding for ${this.settleMethodKey}`,
      );
    }

    const makerOrder = this.toSignedOrder(input.pair, input.makerOrder);
    const takerOrder = this.toSignedOrder(input.pair, input.takerOrder);
    const fillAmount = decimalToUnits(
      input.fillAmount,
      input.pair.baseDecimals,
    ).toString();
    const fillPrice = toSettlementPriceUnits(input.fillPrice, input.pair);

    const { gasRequired, result, output } = await queryMethod(
      this.relayer.address,
      { gasLimit: this.dryRunGasLimit(), storageDepositLimit: null },
      makerOrder,
      takerOrder,
      fillAmount,
      fillPrice,
    );

    if (result.isErr) {
      throw new Error(
        `[SpotSettlement] Query failed for trade ${input.tradeId}: ${result.toString()}`,
      );
    }

    // Contract-level Err in the dry-run: never broadcast a call that reverts.
    // TradeAlreadySettled (idempotent spot_settlement) is only trusted once
    // the FINALIZED state confirms the fill — then no funds move here.
    const dryRunError = contractErrorVariant(output);
    if (dryRunError) {
      if (
        isTradeAlreadySettled(dryRunError) &&
        (await this.isFillSettled(input)) === true
      ) {
        throw new FillAlreadySettled(
          `Fill for trade ${input.tradeId} already settled on-chain`,
        );
      }
      throw new Error(
        `[SpotSettlement] Dry-run reverted for trade ${input.tradeId}: ${dryRunError}`,
      );
    }

    // Acquire an explicit, distinct relayer nonce immediately before submit.
    // Without this, concurrent settle_trade submissions (pipeline mode) would
    // share a lazily-resolved nonce and the node would silently drop all but
    // one. With it, each in-flight extrinsic is uniquely sequenced; the
    // contract's used_nonces guard still rejects any genuine replay.
    const relayerNonce = await this.nextNonce();
    const api = this.api!;
    let submission: SettlementSubmission | null = null;

    try {
      // Explicit mortal era anchored on the finalized head: the extrinsic is
      // only valid in blocks [birth, birth + MORTALITY). This bounds how long
      // an ambiguous submission can still land, so reconciliation can prove
      // "not included" from finalized data alone (BE-07).
      const birthHash = await api.rpc.chain.getFinalizedHead();
      const birthHeader = await api.rpc.chain.getHeader(birthHash);
      const birthBlock = birthHeader.number.toNumber();
      const era = api.registry.createType('ExtrinsicEra', {
        current: birthBlock,
        period: SETTLEMENT_TX_MORTALITY_BLOCKS,
      });

      const extrinsic = txMethod(
        { gasLimit: this.txGasLimit(gasRequired), storageDepositLimit: null },
        makerOrder,
        takerOrder,
        fillAmount,
        fillPrice,
      );
      await extrinsic.signAsync(this.relayer!, {
        nonce: relayerNonce,
        blockHash: birthHash,
        era,
      });
      const signed: SettlementSubmission = {
        txHash: extrinsic.hash.toHex(),
        relayerNonce: Number(relayerNonce),
        birthBlock,
        mortality: SETTLEMENT_TX_MORTALITY_BLOCKS,
      };

      // Persist BEFORE broadcast. If this throws (DB error, or the claim was
      // superseded by another worker) nothing has been sent.
      if (hooks.onBeforeBroadcast) {
        await hooks.onBeforeBroadcast(input.tradeId, signed);
      }
      submission = signed;

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
          .send(
            (txResult: {
              status: Record<string, boolean | undefined>;
              dispatchError?: { toString(): string };
            }) => {
              const status = txResult.status ?? {};
              // Definitive: the pool rejected it or another extrinsic took
              // its nonce — it can never be included.
              if (status.isInvalid || status.isUsurped) {
                finish(() =>
                  reject(
                    new DefinitiveSettlementFailure(
                      `settle_trade ${status.isInvalid ? 'Invalid' : 'Usurped'}`,
                    ),
                  ),
                );
                return;
              }
              // Ambiguous: dropped from the local pool / finality timeout —
              // it may still be gossiped and included elsewhere.
              if (status.isDropped || status.isFinalityTimeout) {
                finish(() =>
                  reject(new Error('settle_trade dropped / finality timeout')),
                );
                return;
              }
              // Only finalized state is final: an error (or success) in a
              // non-finalized block can be reorged out and re-included.
              if (status.isFinalized) {
                if (txResult.dispatchError) {
                  const message = txResult.dispatchError.toString();
                  finish(() =>
                    reject(new DefinitiveSettlementFailure(message)),
                  );
                  return;
                }
                finish(() => resolve(signed.txHash));
              }
            },
          )
          .then((unsubscribe: () => void) => {
            unsub = unsubscribe;
            if (done) unsubscribe();
          })
          .catch((err: unknown) => finish(() => reject(err)));
      });

      return await withTxTimeout(`settle_trade:${input.tradeId}`, txPromise);
    } catch (err: unknown) {
      // The reserved nonce may never be consumed (gap) — re-seed from the
      // node's accountNextIndex, which also counts our still-pooled tx.
      this.invalidateNonce();
      if (
        err instanceof DefinitiveSettlementFailure &&
        (await this.isFillSettled(input)) === true
      ) {
        // Our extrinsic reverted (e.g. TradeAlreadySettled — ink! revert data
        // is not in the dispatch error) but the fill IS settled at the
        // finalized head: nothing to retry.
        throw new FillAlreadySettled(
          `Fill for trade ${input.tradeId} already settled on-chain`,
        );
      }
      if (submission && !(err instanceof DefinitiveSettlementFailure)) {
        // Broadcast (or attempted): the extrinsic may still land within its
        // mortal era. Even with the idempotent contract this must
        // be reconciled, never blindly re-submitted.
        throw new AmbiguousSubmissionError(
          err instanceof Error ? err.message : 'Unknown submission outcome',
          submission,
        );
      }
      throw err;
    }
  }

  /**
   * Reads `is_fill_settled(maker, taker, fill, price)` at the FINALIZED head
   * (contractsApi.call on `api.at(finalizedHash)`), so a reorg cannot undo
   * the answer. Returns null when it cannot be determined (service not
   * ready, legacy contract without the message, revert, decode failure).
   */
  async isFillSettled(input: TradeSettlementInput): Promise<boolean | null> {
    try {
      const isReady = await this.ensureReady();
      if (!isReady || !this.api || !this.contract || !this.relayer) {
        return null;
      }
      const message = this.contract.abi.messages.find(
        (m) =>
          normalizeMethodKey(m.identifier) ===
          normalizeMethodKey('is_fill_settled'),
      );
      if (!message) return null;

      const data = message.toU8a([
        this.toSignedOrder(input.pair, input.makerOrder),
        this.toSignedOrder(input.pair, input.takerOrder),
        decimalToUnits(input.fillAmount, input.pair.baseDecimals).toString(),
        toSettlementPriceUnits(input.fillPrice, input.pair),
      ]);

      const finalizedHash = await this.api.rpc.chain.getFinalizedHead();
      const apiAt = await this.api.at(finalizedHash);
      const exec = (await apiAt.call.contractsApi.call(
        this.relayer.address,
        this.contract.address,
        0,
        this.dryRunGasLimit(),
        null,
        data,
      )) as unknown as {
        result: {
          isOk: boolean;
          asOk: {
            flags: { isRevert: boolean };
            data: { toU8a(isBare?: boolean): Uint8Array };
          };
        };
      };
      if (!exec.result.isOk || exec.result.asOk.flags.isRevert) return null;

      const returnType = message.returnType;
      if (!returnType) return null;
      const output = this.contract.abi.registry.createTypeUnsafe(
        returnType.lookupName || returnType.type,
        [exec.result.asOk.data.toU8a(true)],
        { isPedantic: true },
      );
      return readContractBoolean(output as never);
    } catch (err: unknown) {
      log.warn(
        { err, tradeId: input.tradeId },
        '[SpotSettlement] is_fill_settled unavailable',
      );
      return null;
    }
  }

  /**
   * Resolves an ambiguous settle_trade submission from FINALIZED chain data
   * only (BE-07). Scans the extrinsic's whole mortal-era window
   * [birthBlock, birthBlock + mortality] (clamped to the finalized head) for
   * the persisted extrinsic hash:
   *   - found + ExtrinsicSuccess → INCLUDED_SUCCESS
   *   - found + ExtrinsicFailed  → INCLUDED_FAILED (contract reverted)
   *   - absent and finalized head past the window → NOT_INCLUDED (can never
   *     land: safe to re-submit)
   *   - absent and window still open → PENDING (do nothing)
   * With the trade `input`, the idempotent contract adds a second finalized
   * signal: if is_fill_settled is true at the finalized head, any verdict
   * other than INCLUDED_SUCCESS becomes ALREADY_SETTLED (a late landing of
   * our extrinsic would revert with TradeAlreadySettled).
   */
  async reconcileSubmission(
    submission: SettlementSubmission,
    input?: TradeSettlementInput,
  ): Promise<SubmissionReconciliation> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.api) {
      return {
        outcome: 'UNAVAILABLE',
        error: 'Settlement service unavailable',
      };
    }
    let verdict: ExtrinsicReconciliation;
    try {
      verdict = await reconcileFinalizedExtrinsic(this.api, submission);
    } catch (err: unknown) {
      log.error(
        { err, txHash: submission.txHash },
        '[SpotSettlement] reconcileSubmission failed',
      );
      verdict = {
        outcome: 'UNAVAILABLE',
        error: err instanceof Error ? err.message : 'Reconciliation failed',
      };
    }

    if (
      input &&
      verdict.outcome !== 'INCLUDED_SUCCESS' &&
      (await this.isFillSettled(input)) === true
    ) {
      return { outcome: 'ALREADY_SETTLED' };
    }
    return verdict;
  }

  /**
   * Drops the cached relayer nonce so the next acquisition re-seeds from
   * chain. Serialized through the same lock as nextNonce so it cannot race a
   * concurrent acquisition.
   */
  private invalidateNonce() {
    this.nonceLock = this.nonceLock.then(() => {
      this.nextRelayerNonce = null;
    });
  }

  async settleTrades(
    inputs: TradeSettlementInput[],
    hooks: SettlementHooks = {},
  ): Promise<SettlementResult[]> {
    // Pipeline mode: submit up to settleConcurrency() settle_trade extrinsics
    // concurrently instead of serializing one-per-finalized-block. Results are
    // collected in input order. Each trade maps to exactly one extrinsic with a
    // distinct relayer nonce, and a single failure is isolated to its own
    // result without blocking siblings. An ambiguous submission is returned
    // as UNKNOWN and reconciled (reconcileSubmission), never re-submitted
    // (BE-07). The idempotent contract (settled_trades / TradeAlreadySettled)
    // is a second line of defence: a repeat reverts instead of re-applying,
    // and a fill already settled at the finalized head is marked SETTLED.
    return this.mapWithConcurrency(
      inputs,
      this.settleConcurrency(),
      async (input): Promise<SettlementResult> => {
        try {
          const txHash = await this.submitSettlement(input, hooks);
          if (txHash) {
            return { tradeId: input.tradeId, status: 'SETTLED', txHash };
          }
          return {
            tradeId: input.tradeId,
            status: 'FAILED',
            error: 'Settlement service unavailable',
          };
        } catch (error) {
          if (error instanceof FillAlreadySettled) {
            log.warn(
              { tradeId: input.tradeId },
              '[SpotSettlement] fill already settled on-chain (finalized); marking SETTLED without moving funds',
            );
            return {
              tradeId: input.tradeId,
              status: 'SETTLED',
              alreadySettled: true,
            };
          }
          if (error instanceof AmbiguousSubmissionError) {
            log.error(
              {
                err: error,
                tradeId: input.tradeId,
                txHash: error.submission.txHash,
              },
              '[SpotSettlement] settle_trade outcome unknown; parked for reconciliation',
            );
            return {
              tradeId: input.tradeId,
              status: 'UNKNOWN',
              error: error.message,
              submission: error.submission,
            };
          }
          log.error(
            { err: error, tradeId: input.tradeId },
            '[SpotSettlement] Failed to settle trade',
          );
          return {
            tradeId: input.tradeId,
            status: 'FAILED',
            error:
              error instanceof Error
                ? error.message
                : 'Unknown settlement failure',
          };
        }
      },
    );
  }

  async cancelOrderFor(
    makerAddress: string,
    nonce: string,
  ): Promise<string | null> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.relayer) return null;

    const txMethod = this.getTxMethod(this.cancelOrderForMethodKey);
    if (!txMethod) {
      log.warn(
        '[SpotSettlement] cancel_order_for method not found in contract metadata',
      );
      return null;
    }

    const maker = this.toUserAccountId(makerAddress);
    const nonceValue = nonceToU64(nonce).toString();

    const queryMethod = this.getQueryMethod(this.cancelOrderForMethodKey);
    if (!queryMethod) {
      log.warn(
        '[SpotSettlement] cancel_order_for query binding not found in contract metadata',
      );
      return null;
    }

    const { gasRequired, result } = await queryMethod(
      this.relayer.address,
      { gasLimit: this.dryRunGasLimit(), storageDepositLimit: null },
      maker,
      nonceValue,
    );

    if (result.isErr) {
      throw new Error(
        `[SpotSettlement] Failed to simulate cancel_order_for for ${makerAddress}`,
      );
    }

    const relayerNonce = await this.nextNonce();
    const cancelPromise = new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      txMethod(
        { gasLimit: this.txGasLimit(gasRequired), storageDepositLimit: null },
        maker,
        nonceValue,
      )
        .signAndSend(
          this.relayer!,
          { nonce: relayerNonce },
          (txResult: {
            status: { isInBlock: boolean; isFinalized: boolean };
            dispatchError?: { toString(): string };
            txHash: { toHex(): string };
          }) => {
            if (txResult.dispatchError) {
              if (unsub) unsub();
              reject(new Error(txResult.dispatchError.toString()));
              return;
            }

            // Wait for finality — `isInBlock` only means included in a
            // non-finalized block, which forks can revert. For operations
            // that move user funds (settlements, cancels), the off-chain
            // DB state must only update after the chain confirms finality.
            if (txResult.status.isFinalized) {
              const txHash = txResult.txHash.toHex();
              if (unsub) unsub();
              resolve(txHash);
            }
          },
        )
        .then((unsubscribe: () => void) => {
          unsub = unsubscribe;
        })
        .catch(reject);
    });

    return withTxTimeout(
      `cancel_order_for:${makerAddress}:${nonce}`,
      cancelPromise,
    ).catch((error) => {
      this.invalidateNonce();
      throw error;
    });
  }
}

export const settlementService = new SpotSettlementService();
