import { Decimal } from '@prisma/client/runtime/library';
export declare const affiliateService: {
    /**
     * Get or generate a referral code for an address
     */
    getOrCreateReferralCode(address: string): Promise<string>;
    /**
     * Register a new referral. Links refereeAddress to the owner of the referralCode.
     */
    registerReferral(refereeAddress: string, referralCode: string): Promise<{
        level: number;
        id: string;
        createdAt: Date;
        referrerAddress: string;
        refereeAddress: string;
        referralCode: string;
    }>;
    /**
     * Walk up the referral chain from a given address, returning ancestors up to MAX_LEVELS.
     * Uses a single loop with sequential findUnique — max 5 queries total (bounded depth).
     */
    getReferralChain(address: string): Promise<{
        address: string;
        level: number;
    }[]>;
    /**
     * Core hook: distribute affiliate commissions from a fee event.
     * Called after a trade/margin/copytrade fee is collected.
     */
    distributeCommissions(sourceAddr: string, feeToken: string, feeAmount: number | string, sourceType: "SPOT" | "MARGIN" | "COPYTRADE", sourceTradeId?: string): Promise<{
        level: number;
        id: string;
        createdAt: Date;
        feeAmount: Decimal;
        beneficiaryAddr: string;
        sourceAddr: string;
        sourceTradeId: string | null;
        sourceType: import(".prisma/client").$Enums.AffiliateSourceType;
        feeToken: string;
        commissionRate: number;
        commissionAmount: Decimal;
        isPaid: boolean;
        batchId: string | null;
    }[]>;
    /**
     * Dashboard: aggregate earnings for an affiliate
     */
    getDashboard(address: string): Promise<{
        referralCode: string;
        directReferrals: number;
        earningsByLevel: {
            level: number;
            token: string;
            totalEarned: number;
            tradeCount: number;
        }[];
        totalUnpaid: number;
        unpaidCount: number;
        totalPaid: number;
        paidCount: number;
        levels: {
            level: number;
            ratePct: number;
            rateBps: number;
        }[];
    }>;
    /**
     * Referral tree: get downstream referees for an address.
     *
     * B1 FIX: Instead of 2 queries per referee in a loop (N+1),
     * we batch-fetch all counts and earnings in a single groupBy + aggregate
     * at each depth level before building the node list.
     */
    getReferralTree(address: string, maxDepth?: number): Promise<unknown[]>;
    _buildTreeBatched(address: string, currentDepth: number, maxDepth: number): Promise<unknown[]>;
    /**
     * Payout history: list completed commissions for an address
     */
    getPayoutHistory(address: string, limit?: number): Promise<{
        id: string;
        level: number;
        token: string;
        amount: number;
        sourceType: string;
        paidAt: Date;
        batchId: string | null;
    }[]>;
    /**
     * Process payout batch — mark unpaid commissions as paid.
     * Called by a cron job every 7 days.
     */
    processPayoutBatch(): Promise<{
        batchId: string;
        processed: number;
        totalPaid: number;
    }>;
};
//# sourceMappingURL=affiliateService.d.ts.map