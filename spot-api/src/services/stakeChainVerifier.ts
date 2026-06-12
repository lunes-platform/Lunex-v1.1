/**
 * On-chain stake verifier for agent staking.
 *
 * Backs agentService.verifyStake() with a real read against the Staking
 * contract's `get_stake(account)` query. Used to confirm that an agent's
 * recorded stake is actually backed on-chain BEFORE crediting a trading tier.
 *
 * This module deliberately performs READ-ONLY contract queries (no signing,
 * no fund movement). It reuses the same ApiPromise + ContractPromise pattern as
 * rewardPayoutService / settlementService.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { config } from '../config';
import { log } from '../utils/logger';
import type { StakeChainVerifier } from './agentService';

// LUNES has 8 decimals (matches rewardPayoutService).
const LUNES_DECIMALS = 8;
const PLANCKS_PER_LUNES = BigInt(10 ** LUNES_DECIMALS);

function plancksToLunes(plancks: bigint): number {
  const whole = plancks / PLANCKS_PER_LUNES;
  const frac = plancks % PLANCKS_PER_LUNES;
  return Number(whole) + Number(frac) / Number(PLANCKS_PER_LUNES);
}

function normalizeKey(key: string): string {
  return key.replace(/_/g, '').toLowerCase();
}

class StakingChainVerifier implements StakeChainVerifier {
  private api: ApiPromise | null = null;
  private contract: ContractPromise | null = null;
  private initPromise: Promise<boolean> | null = null;
  private getStakeKey: string | null = null;

  isConfigured(): boolean {
    return Boolean(
      config.blockchain.wsUrl && config.rewards.stakingContractAddress,
    );
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<boolean> {
    try {
      const metadataPath = path.resolve(
        config.rewards.stakingContractMetadataPath,
      );
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

      const provider = new WsProvider(config.blockchain.wsUrl);
      const api = await ApiPromise.create({ provider });
      await api.isReady;

      const contract = new ContractPromise(
        api as never,
        metadata as never,
        config.rewards.stakingContractAddress,
      );

      this.getStakeKey =
        Object.keys(contract.query).find(
          (k) => normalizeKey(k) === normalizeKey('get_stake'),
        ) ?? null;

      if (!this.getStakeKey) {
        log.error('[StakeVerify] get_stake query not found in ABI');
        return false;
      }

      this.api = api;
      this.contract = contract;
      return true;
    } catch (error) {
      log.error({ err: error }, '[StakeVerify] Failed to initialize');
      return false;
    }
  }

  async getOnChainStakeAmount(walletAddress: string): Promise<number | null> {
    const ready = await this.ensureReady();
    if (!ready || !this.contract || !this.api || !this.getStakeKey) {
      // Treat an unavailable chain as "cannot verify" — fail-closed upstream.
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryMethod = (this.contract.query as Record<string, any>)[
      this.getStakeKey
    ];

    const { result, output } = await queryMethod(walletAddress, {
      gasLimit: -1,
      storageDepositLimit: null,
    });

    if (result.isErr || !output) {
      return null;
    }

    // get_stake returns Result<Option<Stake>>. Decode defensively.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const human = (output.toHuman() as any)?.Ok ?? output.toHuman();
    if (human === null || human === undefined || human === 'None') {
      return null;
    }

    // Some(Stake { amount, ... }) — amount may live under .Some or directly.
    const stakeObj = human.Some ?? human;
    const rawAmount = stakeObj?.amount;
    if (rawAmount === undefined || rawAmount === null) {
      return null;
    }

    // toHuman() formats integers with comma separators — strip them.
    const plancks = BigInt(String(rawAmount).replace(/[^0-9]/g, '') || '0');
    return plancksToLunes(plancks);
  }
}

export const stakingChainVerifier = new StakingChainVerifier();
