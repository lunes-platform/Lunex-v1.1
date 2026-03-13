"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Governance Routes — Server-side vote cooldown + deduplication
 *
 * The smart contract handles on-chain enforcement.
 * This layer adds API-level cooldown tracking to prevent spam
 * and provides the frontend with last-vote timestamps without
 * trusting localStorage.
 *
 * POST /api/v1/governance/vote/check     — check if wallet can vote
 * POST /api/v1/governance/vote/record    — record a completed vote
 */
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
const VOTE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const VoteCheckSchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(8).max(128),
    proposalId: zod_1.z.coerce.number().int().positive(),
});
const VoteRecordSchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(8).max(128),
    proposalId: zod_1.z.coerce.number().int().positive(),
    voteType: zod_1.z.enum(['YES', 'NO']),
    txHash: zod_1.z.string().max(128).optional(),
});
/**
 * POST /api/v1/governance/vote/check
 *
 * Returns whether a wallet can vote on a given proposal right now.
 * If not, includes timeUntilNextVote in ms.
 */
router.post('/vote/check', async (req, res, next) => {
    try {
        const parsed = VoteCheckSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { walletAddress, proposalId } = parsed.data;
        const last = await db_1.default.governanceVote.findFirst({
            where: { walletAddress, proposalId },
            orderBy: { votedAt: 'desc' },
        });
        if (!last) {
            return res.json({ canVote: true, lastVotedAt: null, timeUntilNextVote: 0 });
        }
        const elapsed = Date.now() - last.votedAt.getTime();
        const timeUntilNextVote = Math.max(0, VOTE_COOLDOWN_MS - elapsed);
        return res.json({
            canVote: timeUntilNextVote === 0,
            lastVotedAt: last.votedAt.toISOString(),
            lastVoteType: last.voteType,
            timeUntilNextVote,
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/v1/governance/vote/record
 *
 * Records a completed on-chain vote.
 * Called by the frontend AFTER the transaction is confirmed.
 *
 * Note: The source of truth is the smart contract.
 * This record is used only for cooldown UX.
 */
router.post('/vote/record', async (req, res, next) => {
    try {
        const parsed = VoteRecordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { walletAddress, proposalId, voteType, txHash } = parsed.data;
        // Verify cooldown server-side
        const last = await db_1.default.governanceVote.findFirst({
            where: { walletAddress, proposalId },
            orderBy: { votedAt: 'desc' },
        });
        if (last) {
            const elapsed = Date.now() - last.votedAt.getTime();
            if (elapsed < VOTE_COOLDOWN_MS) {
                const minutesLeft = Math.ceil((VOTE_COOLDOWN_MS - elapsed) / 60000);
                return res.status(429).json({
                    error: `Vote cooldown active. Try again in ${minutesLeft} min.`,
                    code: 'VOTE_COOLDOWN',
                    timeUntilNextVote: VOTE_COOLDOWN_MS - elapsed,
                });
            }
        }
        const vote = await db_1.default.governanceVote.create({
            data: {
                walletAddress,
                proposalId,
                voteType,
                txHash: txHash ?? null,
            },
        });
        return res.status(201).json({ vote });
    }
    catch (err) {
        // P2002 = Prisma unique constraint — duplicate vote on same proposal
        if (err.code === 'P2002') {
            return res.status(409).json({ error: 'Vote already recorded for this proposal', code: 'DUPLICATE_VOTE' });
        }
        next(err);
    }
});
/**
 * GET /api/v1/governance/vote/history?walletAddress=
 *
 * Returns the vote history for a wallet (for UI cooldown display).
 */
router.get('/vote/history', async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({
            walletAddress: zod_1.z.string().min(8).max(128),
        }).safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'walletAddress required' });
        }
        const votes = await db_1.default.governanceVote.findMany({
            where: { walletAddress: parsed.data.walletAddress },
            orderBy: { votedAt: 'desc' },
            take: 100,
        });
        return res.json({ votes });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=governance.js.map