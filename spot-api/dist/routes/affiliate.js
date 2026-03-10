"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const affiliateService_1 = require("../services/affiliateService");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const RegisterReferralSchema = zod_1.z.object({
    refereeAddress: zod_1.z.string().min(3),
    referralCode: zod_1.z.string().min(4).max(16),
});
const AddressQuerySchema = zod_1.z.object({
    address: zod_1.z.string().min(3),
});
// POST /api/v1/affiliate/register — Register a referral
router.post('/register', async (req, res) => {
    try {
        const parsed = RegisterReferralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const referral = await affiliateService_1.affiliateService.registerReferral(parsed.data.refereeAddress, parsed.data.referralCode);
        res.status(201).json({ referral });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// GET /api/v1/affiliate/code?address= — Get or generate referral code
router.get('/code', async (req, res) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'address required' });
        }
        const code = await affiliateService_1.affiliateService.getOrCreateReferralCode(parsed.data.address);
        res.json({ code, link: `https://lunex.io/?ref=${code}` });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/affiliate/dashboard?address= — Dashboard with earnings
router.get('/dashboard', async (req, res) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'address required' });
        }
        const dashboard = await affiliateService_1.affiliateService.getDashboard(parsed.data.address);
        res.json({ dashboard });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/affiliate/tree?address= — Referral tree
router.get('/tree', async (req, res) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'address required' });
        }
        const depth = parseInt(req.query.depth) || 3;
        const tree = await affiliateService_1.affiliateService.getReferralTree(parsed.data.address, Math.min(depth, 5));
        res.json({ tree });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/affiliate/payouts?address= — Payout history
router.get('/payouts', async (req, res) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'address required' });
        }
        const limit = parseInt(req.query.limit) || 20;
        const payouts = await affiliateService_1.affiliateService.getPayoutHistory(parsed.data.address, limit);
        res.json({ payouts });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/affiliate/payout/process — Trigger payout batch (admin)
router.post('/payout/process', async (_req, res) => {
    try {
        const result = await affiliateService_1.affiliateService.processPayoutBatch();
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=affiliate.js.map