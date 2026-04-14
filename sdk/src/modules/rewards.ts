import { HttpClient } from '../http-client';
import {
  DistributedRewardWeek,
  PendingRewardsSummary,
  RewardClaimResult,
  RewardHistoryEntry,
  RewardRankingsResponse,
  RewardsPoolInfo,
} from '../types';

type SignedWalletProof = {
  address: string;
  nonce: string;
  timestamp: number;
  signature: string;
};

export type RewardsPendingInput = SignedWalletProof;

export type RewardsHistoryInput = SignedWalletProof & {
  limit?: number;
};

export type RewardsRankingsInput = {
  limit?: number;
  segment?: 'all' | 'traders' | 'bots';
  week?: 'current' | 'previous';
};

export class RewardsModule {
  constructor(private http: HttpClient) {}

  /**
   * Get the current reward pool state for the active week.
   */
  async getPool(): Promise<RewardsPoolInfo> {
    const response = await this.http.get<{ pool: RewardsPoolInfo }>(
      '/api/v1/rewards/pool',
    );
    return response.pool;
  }

  /**
   * Get DB-backed pending rewards for leaders/traders.
   * Staker rewards are funded and claimed on-chain, so this call reports
   * `stakerClaimMode: "on-chain"` instead of returning per-user staker rows.
   */
  async getPending(input: RewardsPendingInput): Promise<PendingRewardsSummary> {
    const response = await this.http.get<{ pending: PendingRewardsSummary }>(
      '/api/v1/rewards/pending',
      input,
    );
    return response.pending;
  }

  /**
   * Get DB-backed reward history for leader/trader rewards.
   * Staker rewards live in the staking contract and are not materialized here.
   */
  async getHistory(input: RewardsHistoryInput): Promise<RewardHistoryEntry[]> {
    const response = await this.http.get<{ history: RewardHistoryEntry[] }>(
      '/api/v1/rewards/history',
      input,
    );
    return response.history;
  }

  /**
   * Get recently distributed reward weeks.
   */
  async getWeeks(limit = 10): Promise<DistributedRewardWeek[]> {
    const response = await this.http.get<{ weeks: DistributedRewardWeek[] }>(
      '/api/v1/rewards/weeks',
      { limit },
    );
    return response.weeks;
  }

  /**
   * Get public leader/trader rankings from the canonical reward engine.
   */
  async getRankings(
    input: RewardsRankingsInput = {},
  ): Promise<RewardRankingsResponse> {
    const response = await this.http.get<{ rankings: RewardRankingsResponse }>(
      '/api/v1/rewards/rankings',
      input,
    );
    return response.rankings;
  }

  /**
   * Claim DB-backed leader/trader rewards.
   * Staker rewards must be claimed via the staking contract.
   */
  async claimRewards(input: SignedWalletProof): Promise<RewardClaimResult> {
    const response = await this.http.post<{ result: RewardClaimResult }>(
      '/api/v1/rewards/claim',
      input,
    );
    return response.result;
  }

  /**
   * Calculate staking tier from the user's staked volume.
   */
  calculateTier(
    stakedAmount: string,
  ): 'Bronze' | 'Silver' | 'Gold' | 'Platinum' {
    const amount = BigInt(stakedAmount);
    const decimals = BigInt(100_000_000); // 8 decimals

    const silverThreshold = BigInt(10_000) * decimals;
    const goldThreshold = BigInt(50_000) * decimals;
    const platinumThreshold = BigInt(200_000) * decimals;

    if (amount >= platinumThreshold) return 'Platinum';
    if (amount >= goldThreshold) return 'Gold';
    if (amount >= silverThreshold) return 'Silver';
    return 'Bronze';
  }

  /**
   * Get staking reward multiplier by tier.
   */
  getTierMultiplier(tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'): number {
    const multipliers = {
      Bronze: 1.0,
      Silver: 1.5,
      Gold: 2.0,
      Platinum: 3.0,
    };
    return multipliers[tier];
  }
}
