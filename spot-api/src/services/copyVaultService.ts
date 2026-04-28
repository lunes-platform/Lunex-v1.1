/**
 * CopyVault On-Chain Service
 *
 * Handles real blockchain interactions with the CopyVault ink! smart contract.
 * Replaces the mock DB-only deposit/withdraw pattern in socialService.
 *
 * Flow:
 *   1. User signs deposit/withdraw request
 *   2. This service calls the CopyVault contract via Polkadot.js
 *   3. Waits for on-chain confirmation (inBlock or isFinalized)
 *   4. Returns the tx hash — caller updates DB only AFTER confirmation
 */

import * as fs from 'fs';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { BN } from '@polkadot/util';
import { Decimal } from '@prisma/client/runtime/library';
import { config } from '../config';
import { log } from '../utils/logger';
import { withTxTimeout } from '../utils/txWithTimeout';

// ─── Constants ──────────────────────────────────────────────────

const COPY_VAULT_ABI_PATH = path.resolve(
  __dirname,
  '../../../lunes-dex-main/src/abis/CopyVault.json',
);

const PLANCKS_PER_UNIT = new Decimal('100000000'); // 10^8 for LUNES

function unitsToPlancks(value: string | number): BN {
  const normalized = new Decimal(value);

  if (!normalized.isFinite() || normalized.lte(0)) {
    throw new Error('[CopyVault] Amount must be positive');
  }

  return new BN(normalized.mul(PLANCKS_PER_UNIT).toFixed(0));
}

// ─── Types ──────────────────────────────────────────────────────

export interface VaultDepositResult {
  txHash: string;
  blockHash: string;
  shares: string;
  success: true;
}

export interface VaultWithdrawResult {
  txHash: string;
  blockHash: string;
  amount: string;
  success: true;
}

// ─── Service ────────────────────────────────────────────────────

class CopyVaultService {
  private api: ApiPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
  private abi: any = null;
  private initPromise: Promise<boolean> | null = null;

  private isConfigured(): boolean {
    return Boolean(config.blockchain.wsUrl && config.blockchain.relayerSeed);
  }

  isEnabled(): boolean {
    return this.isConfigured();
  }

  async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<boolean> {
    try {
      await cryptoWaitReady();
      const provider = new WsProvider(config.blockchain.wsUrl);
      this.api = await ApiPromise.create({ provider });
      await this.api.isReady;

      const keyring = new Keyring({ type: 'sr25519' });
      this.relayer = keyring.addFromUri(config.blockchain.relayerSeed);

      // Load CopyVault ABI
      if (fs.existsSync(COPY_VAULT_ABI_PATH)) {
        const raw = fs.readFileSync(COPY_VAULT_ABI_PATH, 'utf-8');
        this.abi = JSON.parse(raw);
        log.info('[CopyVault] Service initialized — on-chain mode');
      } else {
        log.warn('[CopyVault] ABI not found — service disabled');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ err: error }, '[CopyVault] Initialization failed');
      return false;
    }
  }

  /**
   * Call the CopyVault contract's `deposit()` method on-chain.
   * The contract mints shares proportional to deposited amount.
   */
  async deposit(
    vaultAddress: string,
    depositorAddress: string,
    amount: string,
  ): Promise<VaultDepositResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.api || !this.relayer || !this.abi) {
      throw new Error('[CopyVault] Service not ready for on-chain calls');
    }

    const contract = new ContractPromise(
      this.api as any,
      this.abi,
      vaultAddress,
    );
    const value = unitsToPlancks(amount);

    // Dry-run for gas estimate
    const { gasRequired, result } = await contract.query.deposit(
      depositorAddress,
      { gasLimit: -1, storageDepositLimit: null, value },
    );

    if (result.isErr) {
      throw new Error(
        `[CopyVault] Deposit dry-run failed: ${result.toString()}`,
      );
    }

    // Execute real transaction
    const depositPromise = new Promise<VaultDepositResult>(
      (resolve, reject) => {
        let unsub: (() => void) | undefined;

        contract.tx
          .deposit({ gasLimit: gasRequired, storageDepositLimit: null, value })
          .signAndSend(this.relayer!, (txResult: any) => {
            if (txResult.dispatchError) {
              if (unsub) unsub();
              reject(
                new Error(
                  `[CopyVault] Deposit failed: ${txResult.dispatchError.toString()}`,
                ),
              );
              return;
            }
            // Wait for finality — vault deposits move user funds. Resolving
            // on `isInBlock` would let an off-chain rollback (DB write) commit
            // shares against an on-chain transfer that a fork later reverts.
            if (txResult.status.isFinalized) {
              const txHash = txResult.txHash.toHex();
              const blockHash = txResult.status.asFinalized.toHex();

              if (unsub) unsub();
              resolve({
                txHash,
                blockHash,
                shares: '0', // Parsed from events by caller
                success: true,
              });
            }
          })
          .then((unsubscribe: () => void) => {
            unsub = unsubscribe;
          })
          .catch(reject);
      },
    );

    return withTxTimeout(
      `vault_deposit:${vaultAddress}:${depositorAddress}`,
      depositPromise,
    );
  }

  /**
   * Call the CopyVault contract's `withdraw()` method on-chain.
   * Burns shares and returns the proportional underlying tokens.
   */
  async withdraw(
    vaultAddress: string,
    withdrawerAddress: string,
    shares: string,
  ): Promise<VaultWithdrawResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.api || !this.relayer || !this.abi) {
      throw new Error('[CopyVault] Service not ready for on-chain calls');
    }

    const contract = new ContractPromise(
      this.api as any,
      this.abi,
      vaultAddress,
    );
    const shareBN = unitsToPlancks(shares);

    // Dry-run
    const { gasRequired, result } = await contract.query.withdraw(
      withdrawerAddress,
      { gasLimit: -1, storageDepositLimit: null },
      shareBN,
    );

    if (result.isErr) {
      throw new Error(
        `[CopyVault] Withdraw dry-run failed: ${result.toString()}`,
      );
    }

    const withdrawPromise = new Promise<VaultWithdrawResult>(
      (resolve, reject) => {
        let unsub: (() => void) | undefined;

        contract.tx
          .withdraw(
            { gasLimit: gasRequired, storageDepositLimit: null },
            shareBN,
          )
          .signAndSend(this.relayer!, (txResult: any) => {
            if (txResult.dispatchError) {
              if (unsub) unsub();
              reject(
                new Error(
                  `[CopyVault] Withdraw failed: ${txResult.dispatchError.toString()}`,
                ),
              );
              return;
            }
            // Wait for finality — withdrawal returns underlying tokens.
            if (txResult.status.isFinalized) {
              const txHash = txResult.txHash.toHex();
              const blockHash = txResult.status.asFinalized.toHex();

              if (unsub) unsub();
              resolve({
                txHash,
                blockHash,
                amount: '0', // Parsed from events by caller
                success: true,
              });
            }
          })
          .then((unsubscribe: () => void) => {
            unsub = unsubscribe;
          })
          .catch(reject);
      },
    );

    return withTxTimeout(
      `vault_withdraw:${vaultAddress}:${withdrawerAddress}`,
      withdrawPromise,
    );
  }
}

export const copyVaultService = new CopyVaultService();
