/**
 * Reward Payout Service — Real On-Chain Integration
 *
 * Handles actual LUNES transfers using the relayer wallet:
 * 1. fund_staking_rewards — payable call to send LUNES into staking pool
 * 2. distribute_trading_rewards_paginated — trigger staker reward distribution
 * 3. transferNative — direct LUNES transfer to leader wallets
 *
 * Uses the same ApiPromise + relayer pattern as settlementService.
 * Follows ink! 4.x best practices (https://use.ink/docs/v4/).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { BN } from '@polkadot/util';
import { config } from '../config';
import { log } from '../utils/logger';
import { withTxTimeout } from '../utils/txWithTimeout';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayoutResult {
  success: boolean;
  txHash: string | null;
  error: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeMethodKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveMethod(
  contract: ContractPromise,
  label: string,
  kind: 'tx' | 'query',
) {
  const expected = normalizeMethodKey(label);
  const source = kind === 'tx' ? contract.tx : contract.query;
  return (
    Object.keys(source).find((k) => normalizeMethodKey(k).includes(expected)) ||
    null
  );
}

// LUNES has 8 decimals (like BTC)
const LUNES_DECIMALS = 8;
const PLANCKS_PER_LUNES = BigInt(10 ** LUNES_DECIMALS);

/** Convert a human-readable LUNES amount to plancks (smallest unit). */
export function lunesToPlancks(amount: number): bigint {
  // Use string manipulation to avoid floating point issues
  const str = amount.toFixed(LUNES_DECIMALS);
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = (frac + '0'.repeat(LUNES_DECIMALS)).slice(
    0,
    LUNES_DECIMALS,
  );
  return BigInt(whole) * PLANCKS_PER_LUNES + BigInt(paddedFrac);
}

/** Convert plancks to human-readable LUNES. */
export function plancksToLunes(plancks: bigint): number {
  const whole = plancks / PLANCKS_PER_LUNES;
  const frac = plancks % PLANCKS_PER_LUNES;
  return Number(whole) + Number(frac) / Number(PLANCKS_PER_LUNES);
}

// ─── Service ─────────────────────────────────────────────────────────────────

class RewardPayoutService {
  private api: ApiPromise | null = null;
  private stakingContract: ContractPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
  private initPromise: Promise<boolean> | null = null;

  // Resolved method keys
  private fundMethodKey: string | null = null;
  private distributeMethodKey: string | null = null;
  private distributePaginatedMethodKey: string | null = null;

  // ─── Configuration Check ───────────────────────────────────────────────

  private isConfigured(): boolean {
    return Boolean(
      config.blockchain.wsUrl &&
      config.blockchain.relayerSeed &&
      config.rewards.stakingContractAddress,
    );
  }

  isEnabled(): boolean {
    return config.rewards.enabled && this.isConfigured();
  }

  // ─── Initialization ────────────────────────────────────────────────────

  async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<boolean> {
    try {
      await cryptoWaitReady();

      const metadataPath = path.resolve(
        config.rewards.stakingContractMetadataPath,
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
        config.rewards.stakingContractAddress,
      );

      // Resolve method keys from ABI
      this.fundMethodKey = resolveMethod(
        contract,
        'fund_staking_rewards',
        'tx',
      );
      this.distributeMethodKey = resolveMethod(
        contract,
        'distribute_trading_rewards',
        'tx',
      );
      this.distributePaginatedMethodKey = resolveMethod(
        contract,
        'distribute_trading_rewards_paginated',
        'tx',
      );

      if (!this.fundMethodKey) {
        log.warn(
          '[RewardPayout] fund_staking_rewards method not found in Staking ABI',
        );
        return false;
      }

      if (!this.distributeMethodKey && !this.distributePaginatedMethodKey) {
        log.warn(
          '[RewardPayout] distribute_trading_rewards method not found in Staking ABI',
        );
        return false;
      }

      this.api = api;
      this.stakingContract = contract;
      this.relayer = relayer;

      log.info(
        {
          relayerAddress: relayer.address,
          stakingContract: config.rewards.stakingContractAddress,
          fundMethod: this.fundMethodKey,
          distributeMethod:
            this.distributePaginatedMethodKey || this.distributeMethodKey,
        },
        '[RewardPayout] On-chain reward payout service initialized',
      );

      return true;
    } catch (error) {
      log.error({ err: error }, '[RewardPayout] Failed to initialize');
      return false;
    }
  }

  // ─── Balance Queries ───────────────────────────────────────────────────

  /** Get the relayer wallet's native LUNES balance (in plancks). */
  async getRelayerBalance(): Promise<bigint> {
    if (!this.api || !this.relayer) {
      throw new Error('[RewardPayout] Service not initialized');
    }

    const {
      data: { free },
    } = (await this.api.query.system.account(this.relayer.address)) as any;

    return BigInt(free.toString());
  }

  /** Get the relayer's available balance in LUNES (human-readable). */
  async getRelayerBalanceLunes(): Promise<number> {
    const plancks = await this.getRelayerBalance();
    return plancksToLunes(plancks);
  }

  // ─── Fund Staking Rewards (Payable) ────────────────────────────────────

  /**
   * Send LUNES to the Staking contract via fund_staking_rewards.
   * This is a PAYABLE call — the LUNES value is attached to the transaction.
   *
   * @param amountLunes Human-readable amount (e.g., 1000.5)
   * @returns PayoutResult with txHash
   */
  async fundStakingRewards(amountLunes: number): Promise<PayoutResult> {
    const ready = await this.ensureReady();
    if (
      !ready ||
      !this.api ||
      !this.stakingContract ||
      !this.relayer ||
      !this.fundMethodKey
    ) {
      return {
        success: false,
        txHash: null,
        error: 'Payout service not initialized',
      };
    }

    if (amountLunes <= 0) {
      return { success: false, txHash: null, error: 'Amount must be positive' };
    }

    const amountPlancks = lunesToPlancks(amountLunes);

    // Safety: check relayer has enough balance
    const balance = await this.getRelayerBalance();
    const minRequired = amountPlancks + BigInt(1_000_000); // +0.01 LUNES for gas
    if (balance < minRequired) {
      const errMsg = `Insufficient relayer balance: has ${plancksToLunes(balance)} LUNES, needs ${amountLunes}`;
      log.error(errMsg);
      return { success: false, txHash: null, error: errMsg };
    }

    try {
      const queryMethod = (this.stakingContract.query as Record<string, any>)[
        this.fundMethodKey
      ];
      const txMethod = (this.stakingContract.tx as Record<string, any>)[
        this.fundMethodKey
      ];

      if (!queryMethod || !txMethod) {
        return {
          success: false,
          txHash: null,
          error: 'Contract method binding missing',
        };
      }

      // Dry-run to estimate gas (payable: attach value)
      const value = new BN(amountPlancks.toString());
      const { gasRequired, result } = await queryMethod(this.relayer.address, {
        gasLimit: -1,
        storageDepositLimit: null,
        value,
      });

      if (result.isErr) {
        return {
          success: false,
          txHash: null,
          error: `Dry-run failed: ${result.toString()}`,
        };
      }

      // Submit real transaction
      const txHash = await this.signAndSendContract(
        txMethod,
        { gasLimit: gasRequired, storageDepositLimit: null, value },
        [],
        `fund_staking_rewards:${amountLunes}`,
      );

      log.info(
        { txHash, amountLunes },
        '[RewardPayout] Funded staking rewards',
      );
      return { success: true, txHash, error: null };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { err: error, amountLunes },
        '[RewardPayout] fund_staking_rewards failed',
      );
      return { success: false, txHash: null, error: errMsg };
    }
  }

  // ─── Distribute Trading Rewards ────────────────────────────────────────

  /**
   * Trigger on-chain distribution of rewards to stakers.
   * Uses paginated version if available to avoid gas limits.
   *
   * @param startIndex Optional pagination start
   * @param batchSize Optional pagination batch size
   */
  async distributeRewards(
    startIndex?: number,
    batchSize?: number,
  ): Promise<PayoutResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.api || !this.stakingContract || !this.relayer) {
      return {
        success: false,
        txHash: null,
        error: 'Payout service not initialized',
      };
    }

    const methodKey =
      this.distributePaginatedMethodKey || this.distributeMethodKey;
    if (!methodKey) {
      return {
        success: false,
        txHash: null,
        error: 'distribute method not found',
      };
    }

    try {
      const queryMethod = (this.stakingContract.query as Record<string, any>)[
        methodKey
      ];
      const txMethod = (this.stakingContract.tx as Record<string, any>)[
        methodKey
      ];

      if (!queryMethod || !txMethod) {
        return {
          success: false,
          txHash: null,
          error: 'Contract method binding missing',
        };
      }

      // Build args for paginated vs non-paginated
      const args: any[] = [];
      if (this.distributePaginatedMethodKey === methodKey) {
        args.push(startIndex ?? null); // Option<u32>
        args.push(batchSize ?? null); // Option<u32>
      }

      const { gasRequired, result } = await queryMethod(
        this.relayer.address,
        { gasLimit: -1, storageDepositLimit: null },
        ...args,
      );

      if (result.isErr) {
        return {
          success: false,
          txHash: null,
          error: `Dry-run failed: ${result.toString()}`,
        };
      }

      const txHash = await this.signAndSendContract(
        txMethod,
        { gasLimit: gasRequired, storageDepositLimit: null },
        args,
        `distribute_trading_rewards${startIndex != null ? `:${startIndex}` : ''}`,
      );

      log.info(
        { txHash, startIndex, batchSize },
        '[RewardPayout] Distributed trading rewards',
      );
      return { success: true, txHash, error: null };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { err: error },
        '[RewardPayout] distribute_trading_rewards failed',
      );
      return { success: false, txHash: null, error: errMsg };
    }
  }

  // ─── Native LUNES Transfer (for Leader Rewards) ────────────────────────

  /**
   * Transfer native LUNES to a wallet address.
   * Used for leader copytrade rewards (direct to wallet, no contract needed).
   *
   * Uses `api.tx.balances.transferKeepAlive` (safer than `transfer`
   * because it keeps the sender account alive).
   *
   * @param toAddress Destination wallet
   * @param amountLunes Human-readable amount
   */
  async transferNative(
    toAddress: string,
    amountLunes: number,
  ): Promise<PayoutResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.api || !this.relayer) {
      return {
        success: false,
        txHash: null,
        error: 'Payout service not initialized',
      };
    }

    if (amountLunes <= 0) {
      return { success: false, txHash: null, error: 'Amount must be positive' };
    }

    const amountPlancks = lunesToPlancks(amountLunes);

    // Safety: balance check
    const balance = await this.getRelayerBalance();
    const minRequired = amountPlancks + BigInt(1_000_000);
    if (balance < minRequired) {
      const errMsg = `Insufficient relayer balance for transfer: has ${plancksToLunes(balance)}, needs ${amountLunes}`;
      log.error(errMsg);
      return { success: false, txHash: null, error: errMsg };
    }

    try {
      const txPromise = new Promise<string>((resolve, reject) => {
        let unsub: (() => void) | undefined;

        this.api!.tx.balances.transferKeepAlive(
          toAddress,
          new BN(amountPlancks.toString()),
        )
          .signAndSend(this.relayer!, (txResult: any) => {
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
          })
          .then((unsubscribe: () => void) => {
            unsub = unsubscribe;
          })
          .catch(reject);
      });

      const txHash = await withTxTimeout(
        `transfer:${toAddress}:${amountLunes}`,
        txPromise,
      );

      log.info(
        { txHash, toAddress, amountLunes },
        '[RewardPayout] Native LUNES transferred',
      );
      return { success: true, txHash, error: null };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { err: error, toAddress, amountLunes },
        '[RewardPayout] Native transfer failed',
      );
      return { success: false, txHash: null, error: errMsg };
    }
  }

  // ─── Shared signAndSend for Contract Calls ─────────────────────────────

  private async signAndSendContract(
    txMethod: any,
    options: Record<string, any>,
    args: any[],
    label: string,
  ): Promise<string> {
    const txPromise = new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      txMethod(options, ...args)
        .signAndSend(this.relayer!, (txResult: any) => {
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
        })
        .then((unsubscribe: () => void) => {
          unsub = unsubscribe;
        })
        .catch(reject);
    });

    return withTxTimeout(label, txPromise);
  }
}

export const rewardPayoutService = new RewardPayoutService();
