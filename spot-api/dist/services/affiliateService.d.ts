export declare const affiliateService: {
    /**
     * Get or generate a referral code for an address
     */
    getOrCreateReferralCode(address: string): Promise<string>;
    /**
     * Register a new referral. Links refereeAddress to the owner of the referralCode.
     * Computes chain depth (level) — max 5 levels.
     */
    registerReferral(refereeAddress: string, referralCode: string): Promise<any>;
    /**
     * Walk up the referral chain from a given address, returning ancestors up to MAX_LEVELS.
     * Returns array of { address, level } where level 1 = direct referrer.
     */
    getReferralChain(address: string): Promise<{
        address: string;
        level: number;
    }[]>;
    /**
     * Core hook: distribute affiliate commissions from a fee event.
     * Called after a trade/margin/copytrade fee is collected.
     */
    distributeCommissions(sourceAddr: string, feeToken: string, feeAmount: number | string, sourceType: "SPOT" | "MARGIN" | "COPYTRADE", sourceTradeId?: string): Promise<any[]>;
    /**
     * Dashboard: aggregate earnings for an affiliate
     */
    getDashboard(address: string): Promise<{
        referralCode: string;
        directReferrals: any;
        earningsByLevel: any;
        totalUnpaid: number;
        unpaidCount: any;
        totalPaid: number;
        paidCount: any;
        levels: {
            level: number;
            ratePct: number;
            rateBps: number;
        }[];
    }>;
    /**
     * Referral tree: get downstream referees for an address
     */
    getReferralTree(address: string, maxDepth?: number): Promise<any[]>;
    _buildTree(address: string, currentDepth: number, maxDepth: number): Promise<any[]>;
    /**
     * Payout history: list completed batches for an address
     */
    getPayoutHistory(address: string, limit?: number): Promise<any>;
    /**
     * Process payout batch — mark unpaid commissions as paid.
     * Called by a cron job every 7 days.
     */
    processPayoutBatch(): Promise<{
        batchId: any;
        processed: any;
        totalPaid: number;
    }>;
};
//# sourceMappingURL=affiliateService.d.ts.map