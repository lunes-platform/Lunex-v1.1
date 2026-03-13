"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.affiliateService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const library_1 = require("@prisma/client/runtime/library");
const db_1 = __importDefault(require("../db"));
// Aggressive model: 4% → 3% → 1.5% → 1% → 0.5%
const AFFILIATE_RATES_BPS = [400, 300, 150, 100, 50];
const MAX_LEVELS = 5;
const BPS_DENOMINATOR = 10000;
const PAYOUT_INTERVAL_DAYS = 7;
function generateCode(address) {
    const hash = crypto_1.default.createHash('sha256').update(address).digest('hex');
    return hash.substring(0, 8).toUpperCase();
}
exports.affiliateService = {
    /**
     * Get or generate a referral code for an address
     */
    async getOrCreateReferralCode(address) {
        const existing = await db_1.default.referral.findFirst({
            where: { referrerAddress: address },
            select: { referralCode: true },
        });
        if (existing)
            return existing.referralCode;
        return generateCode(address);
    },
    /**
     * Register a new referral. Links refereeAddress to the owner of the referralCode.
     */
    async registerReferral(refereeAddress, referralCode) {
        const alreadyReferred = await db_1.default.referral.findUnique({
            where: { refereeAddress },
        });
        if (alreadyReferred) {
            throw new Error('Address already has a referrer');
        }
        // Find the referrer — look for someone whose code matches
        const referrerRef = await db_1.default.referral.findFirst({
            where: { referralCode },
            select: { referrerAddress: true },
        });
        const referralData = {
            referrerAddress: referrerRef?.referrerAddress ?? `code:${referralCode}`,
            refereeAddress,
            referralCode,
            level: 1,
        };
        const referral = await db_1.default.referral.create({ data: referralData });
        return referral;
    },
    /**
     * Walk up the referral chain from a given address, returning ancestors up to MAX_LEVELS.
     * Uses a single loop with sequential findUnique — max 5 queries total (bounded depth).
     */
    async getReferralChain(address) {
        const chain = [];
        let currentAddress = address;
        for (let level = 1; level <= MAX_LEVELS; level++) {
            const referral = await db_1.default.referral.findUnique({
                where: { refereeAddress: currentAddress },
            });
            if (!referral)
                break;
            chain.push({ address: referral.referrerAddress, level });
            currentAddress = referral.referrerAddress;
        }
        return chain;
    },
    /**
     * Core hook: distribute affiliate commissions from a fee event.
     * Called after a trade/margin/copytrade fee is collected.
     */
    async distributeCommissions(sourceAddr, feeToken, feeAmount, sourceType, sourceTradeId) {
        const fee = typeof feeAmount === 'string' ? parseFloat(feeAmount) : feeAmount;
        if (fee <= 0)
            return [];
        const chain = await this.getReferralChain(sourceAddr);
        if (chain.length === 0)
            return [];
        const commissions = [];
        for (const ancestor of chain) {
            const rateBps = AFFILIATE_RATES_BPS[ancestor.level - 1];
            if (!rateBps)
                break;
            const commissionAmount = (fee * rateBps) / BPS_DENOMINATOR;
            if (commissionAmount <= 0)
                continue;
            const commission = await db_1.default.affiliateCommission.create({
                data: {
                    beneficiaryAddr: ancestor.address,
                    sourceAddr,
                    sourceTradeId,
                    sourceType,
                    level: ancestor.level,
                    feeToken,
                    feeAmount: new library_1.Decimal(fee.toString()),
                    commissionRate: rateBps,
                    commissionAmount: new library_1.Decimal(commissionAmount.toString()),
                    isPaid: false,
                },
            });
            commissions.push(commission);
        }
        return commissions;
    },
    /**
     * Dashboard: aggregate earnings for an affiliate
     */
    async getDashboard(address) {
        const [earningsByLevel, unpaid, paid, directReferrals, referralCode] = await Promise.all([
            db_1.default.affiliateCommission.groupBy({
                by: ['level', 'feeToken'],
                where: { beneficiaryAddr: address },
                _sum: { commissionAmount: true },
                _count: true,
            }),
            db_1.default.affiliateCommission.aggregate({
                where: { beneficiaryAddr: address, isPaid: false },
                _sum: { commissionAmount: true },
                _count: true,
            }),
            db_1.default.affiliateCommission.aggregate({
                where: { beneficiaryAddr: address, isPaid: true },
                _sum: { commissionAmount: true },
                _count: true,
            }),
            db_1.default.referral.count({ where: { referrerAddress: address } }),
            this.getOrCreateReferralCode(address),
        ]);
        return {
            referralCode,
            directReferrals,
            earningsByLevel: earningsByLevel.map((e) => ({
                level: e.level,
                token: e.feeToken,
                totalEarned: parseFloat(e._sum.commissionAmount?.toString() || '0'),
                tradeCount: typeof e._count === 'number' ? e._count : 0,
            })),
            totalUnpaid: parseFloat(unpaid._sum.commissionAmount?.toString() || '0'),
            unpaidCount: unpaid._count,
            totalPaid: parseFloat(paid._sum.commissionAmount?.toString() || '0'),
            paidCount: paid._count,
            levels: AFFILIATE_RATES_BPS.map((rate, i) => ({
                level: i + 1,
                ratePct: rate / 100,
                rateBps: rate,
            })),
        };
    },
    /**
     * Referral tree: get downstream referees for an address.
     *
     * B1 FIX: Instead of 2 queries per referee in a loop (N+1),
     * we batch-fetch all counts and earnings in a single groupBy + aggregate
     * at each depth level before building the node list.
     */
    async getReferralTree(address, maxDepth = 3) {
        return this._buildTreeBatched(address, 1, maxDepth);
    },
    async _buildTreeBatched(address, currentDepth, maxDepth) {
        if (currentDepth > maxDepth)
            return [];
        const directs = await db_1.default.referral.findMany({
            where: { referrerAddress: address },
            select: { refereeAddress: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        if (directs.length === 0)
            return [];
        const refereeAddresses = directs.map((d) => d.refereeAddress);
        // B1 FIX: Batch all counts and earnings in 2 queries instead of 2×N
        const [subCountsRaw, earningsRaw] = await Promise.all([
            db_1.default.referral.groupBy({
                by: ['referrerAddress'],
                where: { referrerAddress: { in: refereeAddresses } },
                _count: { id: true },
            }),
            db_1.default.affiliateCommission.groupBy({
                by: ['sourceAddr'],
                where: { sourceAddr: { in: refereeAddresses } },
                _sum: { commissionAmount: true },
            }),
        ]);
        const subCountMap = new Map(subCountsRaw.map((r) => [r.referrerAddress, r._count.id]));
        const earningsMap = new Map(earningsRaw.map((r) => [r.sourceAddr, r._sum.commissionAmount]));
        const childrenResults = currentDepth < maxDepth
            ? await Promise.all(refereeAddresses.map((addr) => this._buildTreeBatched(addr, currentDepth + 1, maxDepth)))
            : refereeAddresses.map(() => []);
        return directs.map((ref, i) => ({
            address: ref.refereeAddress,
            joinedAt: ref.createdAt,
            level: currentDepth,
            subReferrals: subCountMap.get(ref.refereeAddress) ?? 0,
            totalFeeGenerated: parseFloat(earningsMap.get(ref.refereeAddress)?.toString() || '0'),
            children: childrenResults[i],
        }));
    },
    /**
     * Payout history: list completed commissions for an address
     */
    async getPayoutHistory(address, limit = 20) {
        const commissions = await db_1.default.affiliateCommission.findMany({
            where: { beneficiaryAddr: address, isPaid: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { batch: true },
        });
        return commissions.map((c) => ({
            id: c.id,
            level: c.level,
            token: c.feeToken,
            amount: parseFloat(c.commissionAmount.toString()),
            sourceType: c.sourceType,
            paidAt: c.batch?.processedAt || c.createdAt,
            batchId: c.batchId,
        }));
    },
    /**
     * Process payout batch — mark unpaid commissions as paid.
     * Called by a cron job every 7 days.
     */
    async processPayoutBatch() {
        const now = new Date();
        const periodEnd = now;
        const periodStart = new Date(now.getTime() - PAYOUT_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
        const batch = await db_1.default.affiliatePayoutBatch.create({
            data: { periodStart, periodEnd, status: 'PROCESSING' },
        });
        try {
            const unpaid = await db_1.default.affiliateCommission.findMany({
                where: { isPaid: false, createdAt: { lte: periodEnd } },
            });
            if (unpaid.length === 0) {
                await db_1.default.affiliatePayoutBatch.update({
                    where: { id: batch.id },
                    data: { status: 'COMPLETED', processedAt: now, totalPaid: new library_1.Decimal('0') },
                });
                return { batchId: batch.id, processed: 0, totalPaid: 0 };
            }
            let totalPaid = new library_1.Decimal('0');
            // Batch the updates in a single transaction instead of per-loop awaits
            await db_1.default.$transaction(unpaid.map((commission) => db_1.default.affiliateCommission.update({
                where: { id: commission.id },
                data: { isPaid: true, batchId: batch.id },
            })));
            for (const commission of unpaid) {
                totalPaid = totalPaid.plus(commission.commissionAmount);
            }
            await db_1.default.affiliatePayoutBatch.update({
                where: { id: batch.id },
                data: { status: 'COMPLETED', processedAt: now, totalPaid },
            });
            return { batchId: batch.id, processed: unpaid.length, totalPaid: parseFloat(totalPaid.toString()) };
        }
        catch (error) {
            await db_1.default.affiliatePayoutBatch.update({
                where: { id: batch.id },
                data: { status: 'FAILED' },
            });
            throw error;
        }
    },
};
//# sourceMappingURL=affiliateService.js.map