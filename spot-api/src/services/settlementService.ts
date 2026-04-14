import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { hexToU8a, isHex } from '@polkadot/util';
import { config } from '../config';
import { log } from '../utils/logger';
import prisma from '../db';
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
 * Three cases:
 *   1. Real sr25519 hex signature ("0x…" or bare hex, 128 hex chars = 64 bytes)
 *      → decode directly.
 *   2. Agent-delegated order ("agent:<id>")
 *      → the agent's orders are pre-validated off-chain via the agent registry;
 *        we encode a non-zero sentinel so the contract's blank-signature guard
 *        does not reject it. The first byte is 0x01 (agent marker), remaining
 *        bytes are the UTF-8 of the agent id (up to 63 bytes), zero-padded.
 *   3. Any other unexpected format
 *      → throws, preventing an invalid settlement from reaching the chain.
 */
function signatureToBytes(sig: string): number[] {
  // Case 1 — real sr25519 signature
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

  // Case 2 — agent-delegated order: off-chain verification already passed via
  // assertOrderTrustedSource. Encode as non-zero sentinel for contract storage.
  if (sig.startsWith('agent:')) {
    const idBytes = Buffer.from(sig.slice('agent:'.length), 'utf-8').subarray(
      0,
      63,
    );
    const out = new Uint8Array(64);
    out[0] = 0x01; // agent marker — non-zero so the blank-sig guard doesn't fire
    out.set(idBytes, 1);
    return Array.from(out);
  }

  throw new Error(
    `Unrecognised signature format for settlement: ${sig.slice(0, 20)}…. ` +
      `Expected a 64-byte sr25519 hex signature or "agent:<id>".`,
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

  private isConfigured() {
    return Boolean(
      config.blockchain.wsUrl &&
      config.blockchain.spotContractAddress &&
      config.blockchain.spotContractMetadataPath &&
      config.blockchain.relayerSeed,
    );
  }

  isEnabled() {
    return this.isConfigured();
  }

  async ensureReady() {
    if (!this.isConfigured()) {
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
      { gasLimit: -1, storageDepositLimit: null },
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
      { gasLimit: -1, storageDepositLimit: null },
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
      { gasLimit: -1, storageDepositLimit: null },
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

  private buildOrderSignatureMessage(
    pair: PairSettlementSnapshot,
    order: OrderSettlementSnapshot,
  ) {
    return buildSpotOrderMessage({
      pairSymbol: pair.symbol,
      side: order.side as 'BUY' | 'SELL',
      type: order.type as 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT',
      price: order.price,
      stopPrice: order.stopPrice || undefined,
      amount: order.amount,
      nonce: order.nonce,
    });
  }

  private async assertOrderTrustedSource(
    pair: PairSettlementSnapshot,
    order: OrderSettlementSnapshot,
  ) {
    if (!order.signature || order.signature.length < 8) {
      throw new Error(`Missing order signature for ${order.makerAddress}`);
    }

    if (order.signature.startsWith('agent:')) {
      const agentId = order.signature.slice('agent:'.length);
      if (!agentId) {
        throw new Error(`Malformed agent signature for ${order.makerAddress}`);
      }

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          walletAddress: true,
          isActive: true,
          isBanned: true,
        },
      });

      if (
        !agent ||
        agent.walletAddress !== order.makerAddress ||
        !agent.isActive ||
        agent.isBanned
      ) {
        throw new Error(
          `Untrusted agent order origin for ${order.makerAddress}`,
        );
      }

      return;
    }

    if (order.signature.startsWith('manual:')) {
      throw new Error(
        `Unsupported synthetic signature for ${order.makerAddress}`,
      );
    }

    const isValid = await verifyAddressSignature(
      this.buildOrderSignatureMessage(pair, order),
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
      { gasLimit: -1, storageDepositLimit: null },
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

    const txPromise = new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      txMethod(
        { gasLimit: gasRequired, storageDepositLimit: null },
        makerOrder,
        takerOrder,
        fillAmount,
        fillPrice,
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

            if (txResult.status.isInBlock || txResult.status.isFinalized) {
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

    return withTxTimeout(`settle_trade:${input.tradeId}`, txPromise);
  }

  async settleTrades(
    inputs: TradeSettlementInput[],
  ): Promise<SettlementResult[]> {
    const settlements: SettlementResult[] = [];

    for (const input of inputs) {
      try {
        const txHash = await this.submitSettlement(input);
        if (txHash) {
          settlements.push({
            tradeId: input.tradeId,
            status: 'SETTLED',
            txHash,
          });
        } else {
          settlements.push({
            tradeId: input.tradeId,
            status: 'FAILED',
            error: 'Settlement service unavailable',
          });
        }
      } catch (error) {
        log.error(
          { err: error, tradeId: input.tradeId },
          '[SpotSettlement] Failed to settle trade',
        );
        settlements.push({
          tradeId: input.tradeId,
          status: 'FAILED',
          error:
            error instanceof Error
              ? error.message
              : 'Unknown settlement failure',
        });
      }
    }

    return settlements;
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
      { gasLimit: -1, storageDepositLimit: null },
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
        { gasLimit: gasRequired, storageDepositLimit: null },
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

            if (txResult.status.isInBlock || txResult.status.isFinalized) {
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
