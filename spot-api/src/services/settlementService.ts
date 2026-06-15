import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { hexToU8a, isHex } from '@polkadot/util';
import { config } from '../config';
import { log } from '../utils/logger';
import {
  buildSpotOrderMessage,
  verifyAddressSignature,
} from '../middleware/auth';
import { withTxTimeout } from '../utils/txWithTimeout';

type PairSettlementSnapshot = {
  symbol: string;
  baseToken: string;
  quoteToken: string;
  isNativeBase: boolean;
  isNativeQuote: boolean;
  baseDecimals: number;
};

type OrderSettlementSnapshot = {
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

export type SettlementResult = {
  tradeId: string;
  status: 'SETTLED' | 'FAILED' | 'SKIPPED';
  txHash?: string;
  error?: string;
};

type ContractMethodKind = 'tx' | 'query';

export function buildSettlementOrderSignatureMessage(
  pair: Pick<PairSettlementSnapshot, 'symbol'>,
  order: OrderSettlementSnapshot,
) {
  if (!order.signatureTimestamp) {
    throw new Error(
      `Missing order signature timestamp for ${order.makerAddress}`,
    );
  }

  return buildSpotOrderMessage({
    pairSymbol: pair.symbol,
    side: order.side as 'BUY' | 'SELL',
    type: order.type as 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT',
    price: order.price,
    stopPrice: order.stopPrice || undefined,
    amount: order.amount,
    nonce: order.nonce,
    timestamp: order.signatureTimestamp.getTime(),
  });
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

class SpotSettlementService {
  private api: ApiPromise | null = null;
  private contract: ContractPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
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
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    };

    const pool = Array.from(
      { length: Math.min(limit, items.length) },
      () => runner(),
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

    return BigInt(output.toString());
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

    return output.toString() === 'true';
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

    return output.toString() === 'true';
  }

  private toSignedOrder(
    pair: PairSettlementSnapshot,
    order: OrderSettlementSnapshot,
  ) {
    return {
      maker: order.makerAddress,
      base_token: this.toAccountId(pair.baseToken, pair.isNativeBase),
      quote_token: this.toAccountId(pair.quoteToken, pair.isNativeQuote),
      side: order.side === 'BUY' ? 0 : 1,
      price: decimalToUnits(order.price, 8).toString(),
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
    };
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

    const isValid = await verifyAddressSignature(
      buildSettlementOrderSignatureMessage(pair, order),
      order.signature,
      order.makerAddress,
    );

    if (!isValid) {
      throw new Error(`Invalid order signature for ${order.makerAddress}`);
    }
  }

  private async assertSettlementInputTrusted(input: TradeSettlementInput) {
    await Promise.all([
      this.assertOrderTrustedSource(input.pair, input.makerOrder),
      this.assertOrderTrustedSource(input.pair, input.takerOrder),
    ]);
  }

  private async submitSettlement(input: TradeSettlementInput) {
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
    const fillPrice = decimalToUnits(input.fillPrice, 8).toString();

    const { gasRequired, result } = await queryMethod(
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

    // Acquire an explicit, distinct relayer nonce immediately before submit.
    // Without this, concurrent settle_trade submissions (pipeline mode) would
    // share a lazily-resolved nonce and the node would silently drop all but
    // one. With it, each in-flight extrinsic is uniquely sequenced; the
    // contract's used_nonces guard still rejects any genuine replay.
    const relayerNonce = await this.nextNonce();

    const txPromise = new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      txMethod(
        { gasLimit: this.txGasLimit(gasRequired), storageDepositLimit: null },
        makerOrder,
        takerOrder,
        fillAmount,
        fillPrice,
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

    // If this submission fails (dispatch error, broadcast failure, or
    // timeout), the nonce we reserved may never be consumed on-chain, which
    // would leave a gap and stall every subsequent settle_trade. Invalidate
    // the cached counter so the next nextNonce() re-seeds from the node's
    // authoritative accountNextIndex. The contract's used_nonces guard makes
    // any accidental re-submission of an already-settled trade a no-op revert.
    return withTxTimeout(`settle_trade:${input.tradeId}`, txPromise).catch(
      (err) => {
        this.invalidateNonce();
        throw err;
      },
    );
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
  ): Promise<SettlementResult[]> {
    // Pipeline mode: submit up to settleConcurrency() settle_trade extrinsics
    // concurrently instead of serializing one-per-finalized-block. Results are
    // collected in input order. Each trade still maps to exactly one extrinsic
    // with a distinct relayer nonce, so no trade is ever settled twice (the
    // on-chain used_nonces guard is the final idempotency backstop), and a
    // single failure is isolated to its own result without blocking siblings.
    return this.mapWithConcurrency(
      inputs,
      this.settleConcurrency(),
      async (input): Promise<SettlementResult> => {
        try {
          const txHash = await this.submitSettlement(input);
          if (txHash) {
            return { tradeId: input.tradeId, status: 'SETTLED', txHash };
          }
          return {
            tradeId: input.tradeId,
            status: 'FAILED',
            error: 'Settlement service unavailable',
          };
        } catch (error) {
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

    const cancelPromise = new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      txMethod(
        { gasLimit: this.txGasLimit(gasRequired), storageDepositLimit: null },
        maker,
        nonceValue,
      )
        .signAndSend(
          this.relayer!,
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
    );
  }
}

export const settlementService = new SpotSettlementService();
