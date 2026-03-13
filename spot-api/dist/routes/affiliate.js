"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const affiliateService_1 = require("../services/affiliateService");
const db_1 = __importDefault(require("../db"));
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const RegisterReferralSchema = zod_1.z.object({
    refereeAddress: zod_1.z.string().min(3),
    referralCode: zod_1.z.string().min(4).max(16),
});
const AddressQuerySchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
});
router.post('/register', async (req, res, next) => {
    try {
        const parsed = RegisterReferralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const referral = await affiliateService_1.affiliateService.registerReferral(parsed.data.refereeAddress, parsed.data.referralCode);
        res.status(201).json({ referral });
    }
    catch (err) {
        next(err);
    }
});
router.get('/code', async (req, res, next) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success)
            return res.status(400).json({ error: 'address required' });
        const code = await affiliateService_1.affiliateService.getOrCreateReferralCode(parsed.data.address);
        res.json({ code, link: `https://lunex.io/?ref=${code}` });
    }
    catch (err) {
        next(err);
    }
});
router.get('/dashboard', async (req, res, next) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success)
            return res.status(400).json({ error: 'address required' });
        const dashboard = await affiliateService_1.affiliateService.getDashboard(parsed.data.address);
        res.json({ dashboard });
    }
    catch (err) {
        next(err);
    }
});
router.get('/tree', async (req, res, next) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success)
            return res.status(400).json({ error: 'address required' });
        const depth = Math.min(parseInt(req.query.depth) || 3, 5);
        const tree = await affiliateService_1.affiliateService.getReferralTree(parsed.data.address, depth);
        res.json({ tree });
    }
    catch (err) {
        next(err);
    }
});
router.get('/payouts', async (req, res, next) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success)
            return res.status(400).json({ error: 'address required' });
        const limit = req.pagination?.limit ?? Math.min(parseInt(req.query.limit) || 20, 100);
        const payouts = await affiliateService_1.affiliateService.getPayoutHistory(parsed.data.address, limit);
        res.json({ payouts });
    }
    catch (err) {
        next(err);
    }
});
router.post('/payout/process', async (_req, res, next) => {
    try {
        const result = await affiliateService_1.affiliateService.processPayoutBatch();
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// Global affiliate program stats (admin panel)
router.get('/stats', async (_req, res, next) => {
    try {
        const [totalCommissions, unpaidCommissions, totalReferrals, levelBreakdown, commissionsBySource] = await Promise.all([
            db_1.default.affiliateCommission.aggregate({
                _sum: { commissionAmount: true },
                _count: { id: true },
            }),
            db_1.default.affiliateCommission.aggregate({
                where: { isPaid: false },
                _sum: { commissionAmount: true },
                _count: { id: true },
            }),
            db_1.default.referral.count(),
            db_1.default.referral.groupBy({
                by: ['level'],
                _count: { id: true },
            }),
            db_1.default.affiliateCommission.groupBy({
                by: ['sourceType'],
                _sum: { commissionAmount: true },
                _count: { id: true },
            }),
        ]);
        res.json({
            stats: {
                totalCommissions: parseFloat(totalCommissions._sum.commissionAmount?.toString() || '0'),
                totalTransactions: totalCommissions._count.id,
                unpaidCommissions: parseFloat(unpaidCommissions._sum.commissionAmount?.toString() || '0'),
                unpaidCount: unpaidCommissions._count.id,
                totalReferrals,
                levelBreakdown: levelBreakdown.map(l => ({ level: l.level, count: l._count.id })),
                bySource: commissionsBySource.map(s => ({
                    sourceType: s.sourceType,
                    total: parseFloat(s._sum.commissionAmount?.toString() || '0'),
                    count: s._count.id,
                })),
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// Top affiliates by total commission earned (admin panel)
router.get('/top', async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const [topAffiliates, referralCounts] = await Promise.all([
            db_1.default.affiliateCommission.groupBy({
                by: ['beneficiaryAddr'],
                _sum: { commissionAmount: true },
                _count: { id: true },
                orderBy: { _sum: { commissionAmount: 'desc' } },
                take: limit,
            }),
            db_1.default.referral.groupBy({
                by: ['referrerAddress'],
                _count: { id: true },
            }),
        ]);
        const referralMap = Object.fromEntries(referralCounts.map(r => [r.referrerAddress, r._count.id]));
        res.json({
            top: topAffiliates.map((aff, i) => ({
                rank: i + 1,
                address: aff.beneficiaryAddr,
                totalCommission: parseFloat(aff._sum.commissionAmount?.toString() || '0'),
                transactions: aff._count.id,
                referrals: referralMap[aff.beneficiaryAddr] ?? 0,
            })),
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=affiliate.js.map