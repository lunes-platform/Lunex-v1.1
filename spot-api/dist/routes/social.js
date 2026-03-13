"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const socialService_1 = require("../services/socialService");
const socialAnalyticsService_1 = require("../services/socialAnalyticsService");
const auth_1 = require("../middleware/auth");
const adminGuard_1 = require("../middleware/adminGuard");
const db_1 = __importDefault(require("../db"));
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
// ─── Analytics ──────────────────────────────────────────────────
router.get('/analytics/status', async (_req, res, next) => {
    try {
        const analytics = await socialAnalyticsService_1.socialAnalyticsService.getPipelineStatus();
        res.json({ analytics });
    }
    catch (err) {
        next(err);
    }
});
router.post('/analytics/recompute', adminGuard_1.requireAdmin, async (_req, res, next) => {
    try {
        const result = await socialAnalyticsService_1.socialAnalyticsService.recomputeLeaderSnapshots();
        res.json({ result });
    }
    catch (err) {
        next(err);
    }
});
router.post('/analytics/resync-followers', adminGuard_1.requireAdmin, async (_req, res, next) => {
    try {
        const leaders = await db_1.default.leader.findMany({ select: { id: true } });
        let updated = 0;
        for (const leader of leaders) {
            const count = await db_1.default.leaderFollow.count({ where: { leaderId: leader.id } });
            await db_1.default.leader.update({ where: { id: leader.id }, data: { followersCount: count } });
            updated++;
        }
        res.json({ updated, message: 'followersCount resynced from LeaderFollow table' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Stats & Leaders ─────────────────────────────────────────────
router.get('/stats', async (_req, res, next) => {
    try {
        const stats = await socialService_1.socialService.getStats();
        res.json({ stats });
    }
    catch (err) {
        next(err);
    }
});
router.get('/leaders', async (req, res, next) => {
    try {
        const parsed = validation_1.SocialLeadersQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const leaders = await socialService_1.socialService.listLeaders(parsed.data);
        res.json({ leaders });
    }
    catch (err) {
        next(err);
    }
});
router.get('/leaderboard', async (req, res, next) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 10;
        const leaderboard = await socialService_1.socialService.getLeaderboard(limit);
        res.json({ leaderboard });
    }
    catch (err) {
        next(err);
    }
});
router.get('/following', async (req, res, next) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const leaders = await socialService_1.socialService.getFollowedLeaders(address);
        res.json({ leaders });
    }
    catch (err) {
        next(err);
    }
});
router.get('/leaders/by-address', async (req, res, next) => {
    try {
        const parsed = validation_1.LeaderProfileByAddressSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const leader = await socialService_1.socialService.getLeaderProfileByAddress(parsed.data.address, parsed.data.viewerAddress);
        res.json({ leader });
    }
    catch (err) {
        next(err);
    }
});
router.get('/leaders/:leaderId', async (req, res, next) => {
    try {
        const viewerAddress = typeof req.query.viewerAddress === 'string' ? req.query.viewerAddress : undefined;
        const leader = await socialService_1.socialService.getLeaderProfile(req.params.leaderId, viewerAddress);
        res.json({ leader });
    }
    catch (err) {
        next(err);
    }
});
router.get('/leaders/:leaderId/followers', async (req, res, next) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 20;
        const followers = await socialService_1.socialService.getLeaderFollowers(req.params.leaderId, limit);
        res.json({ followers });
    }
    catch (err) {
        next(err);
    }
});
// ─── Ideas ───────────────────────────────────────────────────────
router.get('/ideas', async (req, res, next) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const ideas = await socialService_1.socialService.listIdeas(limit);
        res.json({ ideas });
    }
    catch (err) {
        next(err);
    }
});
router.get('/ideas/:ideaId/comments', async (req, res, next) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const comments = await socialService_1.socialService.getIdeaComments(req.params.ideaId, limit);
        res.json({ comments });
    }
    catch (err) {
        next(err);
    }
});
router.post('/ideas/:ideaId/like', async (req, res, next) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.like-idea',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { ideaId: req.params.ideaId },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.likeIdea(req.params.ideaId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/ideas/:ideaId/like', async (req, res, next) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.unlike-idea',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { ideaId: req.params.ideaId },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.unlikeIdea(req.params.ideaId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/ideas/:ideaId/comments', async (req, res, next) => {
    try {
        const parsed = validation_1.CreateIdeaCommentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.comment-idea',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { ideaId: req.params.ideaId, content: parsed.data.content },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const comment = await socialService_1.socialService.commentOnIdea(req.params.ideaId, parsed.data.address, parsed.data.content);
        res.status(201).json({ comment });
    }
    catch (err) {
        next(err);
    }
});
// ─── Leader Profiles & Social Actions ────────────────────────────
router.post('/leaders/profile', async (req, res, next) => {
    try {
        const parsed = validation_1.UpsertLeaderProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.upsert-profile',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: {
                name: parsed.data.name,
                username: parsed.data.username,
                bio: parsed.data.bio,
                avatar: parsed.data.avatar || '',
                fee: parsed.data.fee,
                twitterUrl: parsed.data.twitterUrl || '',
                telegramUrl: parsed.data.telegramUrl || '',
                discordUrl: parsed.data.discordUrl || '',
            },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const leader = await socialService_1.socialService.upsertLeaderProfile(parsed.data);
        res.status(201).json({ leader });
    }
    catch (err) {
        next(err);
    }
});
router.post('/leaders/:leaderId/follow', async (req, res, next) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.follow-leader',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.followLeader(req.params.leaderId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/leaders/:leaderId/follow', async (req, res, next) => {
    try {
        const parsed = validation_1.FollowLeaderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.unfollow-leader',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.unfollowLeader(req.params.leaderId, parsed.data.address);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ─── Vaults ──────────────────────────────────────────────────────
router.post('/vaults/:leaderId/deposit', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyVaultDepositSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'copytrade.deposit',
            address: parsed.data.followerAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId, token: parsed.data.token, amount: parsed.data.amount },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.depositToVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/vaults/:leaderId/withdraw', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyVaultWithdrawSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'copytrade.withdraw',
            address: parsed.data.followerAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId, shares: parsed.data.shares },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await socialService_1.socialService.withdrawFromVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=social.js.map