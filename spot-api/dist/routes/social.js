"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const socialService_1 = require("../services/socialService");
const socialAnalyticsService_1 = require("../services/socialAnalyticsService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
router.get('/analytics/status', async (_req, res) => {
    try {
        const analytics = await socialAnalyticsService_1.socialAnalyticsService.getPipelineStatus();
        res.json({ analytics });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/analytics/recompute', async (_req, res) => {
    try {
        const result = await socialAnalyticsService_1.socialAnalyticsService.recomputeLeaderSnapshots();
        res.json({ result });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/stats', async (_req, res) => {
    try {
        const stats = await socialService_1.socialService.getStats();
        res.json({ stats });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/leaders', async (req, res) => {
    try {
        const parsed = validation_1.SocialLeadersQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const leaders = await socialService_1.socialService.listLeaders(parsed.data);
        res.json({ leaders });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/leaderboard', async (req, res) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 10;
        const leaderboard = await socialService_1.socialService.getLeaderboard(limit);
        res.json({ leaderboard });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/ideas', async (req, res) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const ideas = await socialService_1.socialService.listIdeas(limit);
        res.json({ ideas });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/ideas/:ideaId/comments', async (req, res) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const comments = await socialService_1.socialService.getIdeaComments(req.params.ideaId, limit);
        res.json({ comments });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/ideas/:ideaId/like', async (req, res) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await socialService_1.socialService.likeIdea(req.params.ideaId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.delete('/ideas/:ideaId/like', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const result = await socialService_1.socialService.unlikeIdea(req.params.ideaId, address);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/ideas/:ideaId/comments', async (req, res) => {
    try {
        const parsed = validation_1.CreateIdeaCommentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const comment = await socialService_1.socialService.commentOnIdea(req.params.ideaId, parsed.data.address, parsed.data.content);
        res.status(201).json({ comment });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.get('/following', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const leaders = await socialService_1.socialService.getFollowedLeaders(address);
        res.json({ leaders });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/leaders/by-address', async (req, res) => {
    try {
        const parsed = validation_1.LeaderProfileByAddressSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const leader = await socialService_1.socialService.getLeaderProfileByAddress(parsed.data.address, parsed.data.viewerAddress);
        res.json({ leader });
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
router.post('/leaders/profile', async (req, res) => {
    try {
        const parsed = validation_1.UpsertLeaderProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const leader = await socialService_1.socialService.upsertLeaderProfile(parsed.data);
        res.status(201).json({ leader });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.get('/leaders/:leaderId', async (req, res) => {
    try {
        const viewerAddress = typeof req.query.viewerAddress === 'string' ? req.query.viewerAddress : undefined;
        const leader = await socialService_1.socialService.getLeaderProfile(req.params.leaderId, viewerAddress);
        res.json({ leader });
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
router.get('/leaders/:leaderId/followers', async (req, res) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 20;
        const followers = await socialService_1.socialService.getLeaderFollowers(req.params.leaderId, limit);
        res.json({ followers });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/leaders/:leaderId/follow', async (req, res) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await socialService_1.socialService.followLeader(req.params.leaderId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.delete('/leaders/:leaderId/follow', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const result = await socialService_1.socialService.unfollowLeader(req.params.leaderId, address);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/vaults/:leaderId/deposit', async (req, res) => {
    try {
        const parsed = validation_1.CopyVaultDepositSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await socialService_1.socialService.depositToVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/vaults/:leaderId/withdraw', async (req, res) => {
    try {
        const parsed = validation_1.CopyVaultWithdrawSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await socialService_1.socialService.withdrawFromVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=social.js.map