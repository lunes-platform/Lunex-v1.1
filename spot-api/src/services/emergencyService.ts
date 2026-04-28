import { ContractPromise } from '@polkadot/api-contract';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from '../config';
import { log } from '../utils/logger';
import { withTxTimeout } from '../utils/txWithTimeout';

/**
 * Emergency controls — wraps the on-chain pause/unpause messages of
 * spot_settlement (and, in the future, copy_vault and staking) for use by
 * the admin panel. Only the contracts that already exist with audited pause
 * semantics are wired here; vault/staking pauses are exposed as TODOs so the
 * admin UI can communicate scope honestly.
 */

type ContractMethodKind = 'tx' | 'query';

function normalizeMethodKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveMethodKey(
  contract: ContractPromise,
  expected: string,
  kind: ContractMethodKind,
) {
  const target = normalizeMethodKey(expected);
  const source = kind === 'tx' ? contract.tx : contract.query;
  return (
    Object.keys(source).find((key) =>
      normalizeMethodKey(key).includes(target),
    ) || null
  );
}

export type EmergencyComponentStatus = {
  component: 'spot_settlement' | 'copy_vault' | 'staking';
  available: boolean;
  paused: boolean | null;
  txHash?: string;
  error?: string;
};

export type EmergencyActionResult = {
  ok: boolean;
  results: EmergencyComponentStatus[];
};

class EmergencyService {
  private api: ApiPromise | null = null;
  private spotContract: ContractPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
  private spotPauseTxKey: string | null = null;
  private spotUnpauseTxKey: string | null = null;
  private spotIsPausedQueryKey: string | null = null;
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
    if (!this.isConfigured()) return false;
    if (!this.initPromise) this.initPromise = this.initialize();
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

      this.api = api;
      this.spotContract = contract;
      this.relayer = relayer;
      this.spotPauseTxKey = resolveMethodKey(contract, 'pause', 'tx');
      this.spotUnpauseTxKey = resolveMethodKey(contract, 'unpause', 'tx');
      // The contract uses an internal `paused: bool` flag; query message name
      // varies (`is_paused`, `paused`). Try both.
      this.spotIsPausedQueryKey =
        resolveMethodKey(contract, 'is_paused', 'query') ||
        resolveMethodKey(contract, 'paused', 'query');

      if (!this.spotPauseTxKey || !this.spotUnpauseTxKey) {
        log.warn(
          '[Emergency] spot_settlement contract metadata is missing pause/unpause messages',
        );
      }

      return true;
    } catch (err) {
      log.error({ err }, '[Emergency] Failed to initialize emergency service');
      return false;
    }
  }

  async getStatus(): Promise<EmergencyActionResult> {
    const ready = await this.ensureReady();
    const spot = await this.querySpotPaused(ready);

    return {
      ok: spot.available,
      results: [
        spot,
        // TODO: wire copy_vault and staking pause status once their metadata
        // paths are configured and the contracts ship with their stub fixes.
        {
          component: 'copy_vault',
          available: false,
          paused: null,
          error:
            'Not wired in admin yet — pause copy_vault directly via polkadot.js or the contract owner key.',
        },
        {
          component: 'staking',
          available: false,
          paused: null,
          error:
            'Not wired in admin yet — pause staking directly via polkadot.js or the contract owner key.',
        },
      ],
    };
  }

  private async querySpotPaused(
    ready: boolean,
  ): Promise<EmergencyComponentStatus> {
    if (!ready || !this.spotContract || !this.spotIsPausedQueryKey || !this.relayer) {
      return {
        component: 'spot_settlement',
        available: false,
        paused: null,
        error: 'spot_settlement contract not configured',
      };
    }

    try {
      const queryFn = (this.spotContract.query as any)[this.spotIsPausedQueryKey];
      const { result, output } = await queryFn(this.relayer.address, {});
      if (!result.isOk) {
        return {
          component: 'spot_settlement',
          available: true,
          paused: null,
          error: 'paused() query reverted',
        };
      }
      const value = output?.toJSON?.() as { ok?: boolean } | boolean | null | undefined;
      const paused = typeof value === 'boolean'
        ? value
        : (value && typeof value === 'object' && 'ok' in value)
          ? Boolean((value as { ok?: boolean }).ok)
          : null;
      return {
        component: 'spot_settlement',
        available: true,
        paused,
      };
    } catch (err) {
      return {
        component: 'spot_settlement',
        available: false,
        paused: null,
        error: (err as Error).message,
      };
    }
  }

  async pauseSpot(): Promise<EmergencyComponentStatus> {
    return this.runSpotPauseTx(this.spotPauseTxKey, 'pause');
  }

  async unpauseSpot(): Promise<EmergencyComponentStatus> {
    return this.runSpotPauseTx(this.spotUnpauseTxKey, 'unpause');
  }

  private async runSpotPauseTx(
    methodKey: string | null,
    action: 'pause' | 'unpause',
  ): Promise<EmergencyComponentStatus> {
    const ready = await this.ensureReady();
    if (
      !ready ||
      !this.api ||
      !this.spotContract ||
      !this.relayer ||
      !methodKey
    ) {
      return {
        component: 'spot_settlement',
        available: false,
        paused: null,
        error: `spot_settlement.${action} not available`,
      };
    }

    try {
      const txFn = (this.spotContract.tx as any)[methodKey];
      const tx = txFn({
        gasLimit: this.api.registry.createType('WeightV2', {
          refTime: 30_000_000_000n,
          proofSize: 1_000_000n,
        }),
        storageDepositLimit: null,
      });

      const txHash = await withTxTimeout(
        `spot_settlement.${action}`,
        new Promise<string>((resolve, reject) => {
          tx.signAndSend(this.relayer!, ({ status, dispatchError, txHash: hash }: any) => {
            if (dispatchError) {
              reject(new Error(dispatchError.toString()));
              return;
            }
            if (status.isFinalized || status.isInBlock) {
              resolve(hash.toHex());
            }
          }).catch(reject);
        }),
        60_000,
      );

      log.warn(
        { action, txHash, by: 'admin emergency endpoint' },
        '[Emergency] spot_settlement state changed via admin action',
      );

      return {
        component: 'spot_settlement',
        available: true,
        paused: action === 'pause',
        txHash,
      };
    } catch (err) {
      log.error({ err, action }, '[Emergency] spot_settlement state change failed');
      return {
        component: 'spot_settlement',
        available: true,
        paused: null,
        error: (err as Error).message,
      };
    }
  }
}

export const emergencyService = new EmergencyService();
