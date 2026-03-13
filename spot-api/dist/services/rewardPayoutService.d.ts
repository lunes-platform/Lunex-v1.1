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
export interface PayoutResult {
    success: boolean;
    txHash: string | null;
    error: string | null;
}
/** Convert a human-readable LUNES amount to plancks (smallest unit). */
export declare function lunesToPlancks(amount: number): bigint;
/** Convert plancks to human-readable LUNES. */
export declare function plancksToLunes(plancks: bigint): number;
declare class RewardPayoutService {
    private api;
    private stakingContract;
    private relayer;
    private initPromise;
    private fundMethodKey;
    private distributeMethodKey;
    private distributePaginatedMethodKey;
    private isConfigured;
    isEnabled(): boolean;
    ensureReady(): Promise<boolean>;
    private initialize;
    /** Get the relayer wallet's native LUNES balance (in plancks). */
    getRelayerBalance(): Promise<bigint>;
    /** Get the relayer's available balance in LUNES (human-readable). */
    getRelayerBalanceLunes(): Promise<number>;
    /**
     * Send LUNES to the Staking contract via fund_staking_rewards.
     * This is a PAYABLE call — the LUNES value is attached to the transaction.
     *
     * @param amountLunes Human-readable amount (e.g., 1000.5)
     * @returns PayoutResult with txHash
     */
    fundStakingRewards(amountLunes: number): Promise<PayoutResult>;
    /**
     * Trigger on-chain distribution of rewards to stakers.
     * Uses paginated version if available to avoid gas limits.
     *
     * @param startIndex Optional pagination start
     * @param batchSize Optional pagination batch size
     */
    distributeRewards(startIndex?: number, batchSize?: number): Promise<PayoutResult>;
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
    transferNative(toAddress: string, amountLunes: number): Promise<PayoutResult>;
    private signAndSendContract;
}
export declare const rewardPayoutService: RewardPayoutService;
export {};
//# sourceMappingURL=rewardPayoutService.d.ts.map