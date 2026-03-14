import { HttpClient } from '../http-client';
import {
    TradingPosition,
    TransactionResult,
    RewardsStats,
    LeaderboardEntry,
    EpochInfo,
} from '../types';

export class RewardsModule {
    constructor(private http: HttpClient) { }

    /**
     * Get trading position for an address
     * @param address - Trader address
     * @returns Trading position with volume and tier info
     */
    async getPosition(address: string): Promise<TradingPosition> {
        return this.http.get(`/rewards/position/${address}`);
    }

    /**
     * Claim trading rewards
     * @param gasLimit - Optional gas limit
     * @returns Transaction result with rewards amount
     */
    async claimRewards(gasLimit?: string): Promise<
        TransactionResult & {
            amount: string;
        }
    > {
        return this.http.post('/rewards/claim', {
            gasLimit: gasLimit || '200000000000',
        });
    }

    /**
     * Get trading rewards statistics
     * @returns Global rewards statistics
     */
    async getStats(): Promise<RewardsStats> {
        return this.http.get('/rewards/stats');
    }

    /**
     * Get trading leaderboard
     * @param params - Period and limit parameters
     * @returns Leaderboard entries
     */
    async getLeaderboard(params?: {
        period?: 'daily' | 'weekly' | 'monthly' | 'all-time';
        limit?: number;
    }): Promise<{
        period: string;
        leaderboard: LeaderboardEntry[];
    }> {
        return this.http.get('/rewards/leaderboard', params);
    }

    /**
     * Get current epoch information
     * @returns Current epoch details
     */
    async getCurrentEpoch(): Promise<EpochInfo> {
        return this.http.get('/rewards/epoch/current');
    }

    /**
     * Get rewards for a specific epoch
     * @param epochId - Epoch ID
     * @param trader - Trader address
     * @returns Rewards amount for the epoch
     */
    async getEpochRewards(epochId: number, trader: string): Promise<{
        epochId: number;
        rewards: string;
    }> {
        return this.http.get(`/rewards/epoch/${epochId}/trader/${trader}`);
    }

    /**
     * Claim rewards from a specific epoch
     * @param epochId - Epoch ID
     * @param gasLimit - Optional gas limit
     * @returns Transaction result with rewards amount
     */
    async claimEpochRewards(
        epochId: number,
        gasLimit?: string
    ): Promise<
        TransactionResult & {
            amount: string;
        }
    > {
        return this.http.post(`/rewards/epoch/${epochId}/claim`, {
            gasLimit: gasLimit || '200000000000',
        });
    }

    /**
     * Get anti-fraud parameters
     * @returns Current anti-fraud configuration
     */
    async getAntifraudParameters(): Promise<{
        minTradeVolume: string;
        tradeCooldown: number;
        maxDailyVolume: string;
    }> {
        return this.http.get('/rewards/antifraud/parameters');
    }

    /**
     * Calculate tier from volume
     * @param monthlyVolume - Monthly trading volume
     * @returns Tier name
     */
    calculateTier(monthlyVolume: string): 'Bronze' | 'Silver' | 'Gold' | 'Platinum' {
        const volume = BigInt(monthlyVolume);
        const DECIMALS = BigInt(100_000_000); // 8 decimals

        const SILVER_THRESHOLD = BigInt(10_000) * DECIMALS;
        const GOLD_THRESHOLD = BigInt(50_000) * DECIMALS;
        const PLATINUM_THRESHOLD = BigInt(200_000) * DECIMALS;

        if (volume >= PLATINUM_THRESHOLD) return 'Platinum';
        if (volume >= GOLD_THRESHOLD) return 'Gold';
        if (volume >= SILVER_THRESHOLD) return 'Silver';
        return 'Bronze';
    }

    /**
     * Get tier multiplier
     * @param tier - Trading tier
     * @returns Multiplier value
     */
    getTierMultiplier(tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'): number {
        const multipliers = {
            Bronze: 1.0,
            Silver: 1.2,
            Gold: 1.5,
            Platinum: 2.0,
        };
        return multipliers[tier];
    }
}
