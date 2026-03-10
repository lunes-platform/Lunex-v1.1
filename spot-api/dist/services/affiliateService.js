"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.affiliateService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const library_1 = require("@prisma/client/runtime/library");
const db_1 = __importDefault(require("../db"));
const prismaAny = db_1.default;
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
        const existing = await prismaAny.referral.findFirst({
            where: { referrerAddress: address },
            select: { referralCode: true },
        });
        if (existing)
            return existing.referralCode;
        return generateCode(address);
    },
    /**
     * Register a new referral. Links refereeAddress to the owner of the referralCode.
     * Computes chain depth (level) — max 5 levels.
     */
    async registerReferral(refereeAddress, referralCode) {
        const alreadyReferred = await prismaAny.referral.findUnique({
            where: { refereeAddress },
        });
        if (alreadyReferred) {
            throw new Error('Address already has a referrer');
        }
        // Find the referrer — look for someone whose code matches
        const referrerRef = await prismaAny.referral.findFirst({
            where: { referralCode },
            select: { referrerAddress: true },
        });
        // The referralCode may belong to a user who has never been referred themselves
        // In that case, find the address that generates this code
        let referrerAddress = null;
        if (referrerRef) {
            referrerAddress = referrerRef.referrerAddress;
        }
        else {
            // The code is generated from an address hash — try to find existing referrals with this code
            // or accept the code as-is (first-time referrer)
        }
        // If we still can't find the referrer from DB, the code is from a new address
        // We store the referral with level 1
        const referral = await prismaAny.referral.create({
            data: {
                referrerAddress: referrerAddress || `code:${referralCode}`,
                refereeAddress,
                referralCode,
                level: 1,
            },
        });
        return referral;
    },
    /**
     * Walk up the referral chain from a given address, returning ancestors up to MAX_LEVELS.
     * Returns array of { address, level } where level 1 = direct referrer.
     */
    async getReferralChain(address) {
        const chain = [];
        let currentAddress = address;
        for (let level = 1; level <= MAX_LEVELS; level++) {
            const referral = await prismaAny.referral.findUnique({
                where: { refereeAddress: currentAddress },
            });
            if (!referral)
                break;
            chain.push({
                address: referral.referrerAddress,
                level,
            });
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
            const commission = await prismaAny.affiliateCommission.create({
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
        // Earnings by level
        const earningsByLevel = await prismaAny.affiliateCommission.groupBy({
            by: ['level', 'feeToken'],
            where: { beneficiaryAddr: address },
            _sum: { commissionAmount: true },
            _count: true,
        });
        // Total unpaid
        const unpaid = await prismaAny.affiliateCommission.aggregate({
            where: { beneficiaryAddr: address, isPaid: false },
            _sum: { commissionAmount: true },
            _count: true,
        });
        // Total paid
        const paid = await prismaAny.affiliateCommission.aggregate({
            where: { beneficiaryAddr: address, isPaid: true },
            _sum: { commissionAmount: true },
            _count: true,
        });
        // Direct referral count
        const directReferrals = await prismaAny.referral.count({
            where: { referrerAddress: address },
        });
        // Get referral code
        const referralCode = await this.getOrCreateReferralCode(address);
        return {
            referralCode,
            directReferrals,
            earningsByLevel: earningsByLevel.map((e) => ({
                level: e.level,
                token: e.feeToken,
                totalEarned: parseFloat(e._sum.commissionAmount?.toString() || '0'),
                tradeCount: e._count,
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
     * Referral tree: get downstream referees for an address
     */
    async getReferralTree(address, maxDepth = 3) {
        const tree = await this._buildTree(address, 1, maxDepth);
        return tree;
    },
    async _buildTree(address, currentDepth, maxDepth) {
        if (currentDepth > maxDepth)
            return [];
        const directs = await prismaAny.referral.findMany({
            where: { referrerAddress: address },
            select: { refereeAddress: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        const nodes = [];
        for (const ref of directs) {
            const subCount = await prismaAny.referral.count({
                where: { referrerAddress: ref.refereeAddress },
            });
            const earnings = await prismaAny.affiliateCommission.aggregate({
                where: { sourceAddr: ref.refereeAddress },
                _sum: { commissionAmount: true },
            });
            nodes.push({
                address: ref.refereeAddress,
                joinedAt: ref.createdAt,
                level: currentDepth,
                subReferrals: subCount,
                totalFeeGenerated: parseFloat(earnings._sum.commissionAmount?.toString() || '0'),
                children: currentDepth < maxDepth
                    ? await this._buildTree(ref.refereeAddress, currentDepth + 1, maxDepth)
                    : [],
            });
        }
        return nodes;
    },
    /**
     * Payout history: list completed batches for an address
     */
    async getPayoutHistory(address, limit = 20) {
        const commissions = await prismaAny.affiliateCommission.findMany({
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
        const batch = await prismaAny.affiliatePayoutBatch.create({
            data: {
                periodStart,
                periodEnd,
                status: 'PROCESSING',
            },
        });
        try {
            const unpaid = await prismaAny.affiliateCommission.findMany({
                where: { isPaid: false, createdAt: { lte: periodEnd } },
            });
            if (unpaid.length === 0) {
                await prismaAny.affiliatePayoutBatch.update({
                    where: { id: batch.id },
                    data: { status: 'COMPLETED', processedAt: now, totalPaid: new library_1.Decimal('0') },
                });
                return { batchId: batch.id, processed: 0, totalPaid: 0 };
            }
            let totalPaid = new library_1.Decimal('0');
            for (const commission of unpaid) {
                await prismaAny.affiliateCommission.update({
                    where: { id: commission.id },
                    data: { isPaid: true, batchId: batch.id },
                });
                totalPaid = totalPaid.plus(commission.commissionAmount);
            }
            await prismaAny.affiliatePayoutBatch.update({
                where: { id: batch.id },
                data: { status: 'COMPLETED', processedAt: now, totalPaid },
            });
            return { batchId: batch.id, processed: unpaid.length, totalPaid: parseFloat(totalPaid.toString()) };
        }
        catch (error) {
            await prismaAny.affiliatePayoutBatch.update({
                where: { id: batch.id },
                data: { status: 'FAILED' },
            });
            throw error;
        }
    },
};
//# sourceMappingURL=affiliateService.js.map