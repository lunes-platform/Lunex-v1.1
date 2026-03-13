"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rewardDistributionService_1 = require("../services/rewardDistributionService");
const rewardScheduler_1 = require("../services/rewardScheduler");
const auth_1 = require("../middleware/auth");
const adminGuard_1 = require("../middleware/adminGuard");
const router = (0, express_1.Router)();
// ─── Public ──────────────────────────────────────────────────────────────
/** Current week reward pool info + countdown to next distribution. */
router.get('/pool', async (_req, res, next) => {
    try {
        const pool = await rewardDistributionService_1.rewardDistributionService.getRewardPool();
        res.json({ pool });
    }
    catch (err) {
        next(err);
    }
});
/** User's pending (unclaimed) rewards. */
router.get('/pending', async (req, res, next) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address query parameter required' });
        }
        const pending = await rewardDistributionService_1.rewardDistributionService.getPendingRewards(address);
        res.json({ pending });
    }
    catch (err) {
        next(err);
    }
});
/** User's reward history (claimed + unclaimed). */
router.get('/history', async (req, res, next) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address query parameter required' });
        }
        const limit = parseInt(req.query.limit || '50', 10);
        const history = await rewardDistributionService_1.rewardDistributionService.getRewardHistory(address, limit);
        res.json({ history });
    }
    catch (err) {
        next(err);
    }
});
/** Past distributed weeks stats. */
router.get('/weeks', async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit || '10', 10);
        const weeks = await rewardDistributionService_1.rewardDistributionService.getDistributedWeeks(limit);
        res.json({ weeks });
    }
    catch (err) {
        next(err);
    }
});
// ─── Authenticated ──────────────────────────────────────────────────────
/** Claim all pending rewards — requires wallet signature. */
router.post('/claim', async (req, res, next) => {
    try {
        const { address, nonce, timestamp, signature } = req.body;
        if (!address || !nonce || !timestamp || !signature) {
            return res.status(400).json({ error: 'Missing required fields: address, nonce, timestamp, signature' });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'rewards.claim',
            address,
            nonce,
            timestamp,
            signature,
            fields: {},
        });
        if (!auth.ok) {
            return res.status(401).json({ error: auth.error });
        }
        const result = await rewardDistributionService_1.rewardDistributionService.claimRewards(address);
        res.json({ result });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin ──────────────────────────────────────────────────────────────
/** Force distribution (admin only — for testing). */
router.post('/distribute', adminGuard_1.requireAdmin, async (_req, res, next) => {
    try {
        const result = await rewardScheduler_1.rewardScheduler.forceDistribute();
        res.json({ result });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=rewards.js.map