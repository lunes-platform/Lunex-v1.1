/**
 * Governance Routes — server-side mirror of on-chain votes (UX only)
 *
 * The staking contract is the source of truth and allows exactly ONE vote
 * per (proposal, wallet) (`AlreadyVoted`). This layer mirrors that rule:
 * any existing record for (proposalId, walletAddress) means "already voted"
 * (no time-based cooldown), and stores the vote's txHash when provided.
 *
 * POST /api/v1/governance/vote/check     — check if wallet can vote
 * POST /api/v1/governance/vote/record    — record a completed vote
 */
import { NextFunction, Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db';
import {
  getSignedAuthInput,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';

const router = Router();

/** Substrate extrinsic hash: 0x + 32 bytes hex. */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const SignedActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const VoteCheckSchema = SignedActionSchema.extend({
  walletAddress: z.string().min(8).max(128),
  proposalId: z.coerce.number().int().positive(),
});

const VoteRecordSchema = SignedActionSchema.extend({
  walletAddress: z.string().min(8).max(128),
  proposalId: z.coerce.number().int().positive(),
  voteType: z.enum(['YES', 'NO']),
  txHash: z.string().regex(TX_HASH_RE, 'txHash must be 0x + 64 hex chars').optional(),
});

/**
 * POST /api/v1/governance/vote/check
 *
 * Returns whether a wallet can vote on a given proposal right now.
 * If not, includes timeUntilNextVote in ms.
 */
router.post(
  '/vote/check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = readAuthSchema(req, VoteCheckSchema).safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { walletAddress, proposalId } = parsed.data;
      const auth = await verifyWalletReadAccess(req, {
        action: 'governance.vote.check',
        address: walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { proposalId },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const last = await prisma.governanceVote.findFirst({
        where: { walletAddress, proposalId },
        orderBy: { votedAt: 'desc' },
      });

      if (!last) {
        return res.json({
          canVote: true,
          alreadyVoted: false,
          lastVotedAt: null,
          timeUntilNextVote: 0,
        });
      }

      // One vote per proposal (contract rule) — no cooldown to wait out.
      // `timeUntilNextVote` kept for response-shape compatibility.
      return res.json({
        canVote: false,
        alreadyVoted: true,
        lastVotedAt: last.votedAt.toISOString(),
        lastVoteType: last.voteType,
        txHash: last.txHash ?? null,
        timeUntilNextVote: 0,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/governance/vote/record
 *
 * Records a completed on-chain vote.
 * Called by the frontend AFTER the transaction is confirmed.
 *
 * Note: The source of truth is the smart contract (one vote per proposal).
 * This record is UX history only; `txHash` (0x + 64 hex) is optional.
 */
router.post(
  '/vote/record',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = VoteRecordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { walletAddress, proposalId, voteType, txHash } = parsed.data;
      const auth = await verifyWalletActionSignature({
        action: 'governance.vote.record',
        address: walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          proposalId,
          voteType,
          txHash,
        },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      // Any existing record (YES or NO, any age) = already voted.
      const last = await prisma.governanceVote.findFirst({
        where: { walletAddress, proposalId },
        orderBy: { votedAt: 'desc' },
      });

      if (last) {
        return res.status(409).json({
          error: 'Vote already recorded for this proposal',
          code: 'ALREADY_VOTED',
        });
      }

      const vote = await prisma.governanceVote.create({
        data: {
          walletAddress,
          proposalId,
          voteType,
          txHash: txHash ?? null,
        },
      });

      return res.status(201).json({ vote });
    } catch (err: unknown) {
      // P2002 = Prisma unique constraint — concurrent duplicate vote
      if ((err as { code?: string }).code === 'P2002') {
        return res.status(409).json({
          error: 'Vote already recorded for this proposal',
          code: 'ALREADY_VOTED',
        });
      }
      next(err);
    }
  },
);

/**
 * GET /api/v1/governance/vote/history?walletAddress=
 *
 * Returns the vote history for a wallet (UI "already voted" display).
 */
router.get(
  '/vote/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = readAuthSchema(
        req,
        SignedActionSchema.extend({
          walletAddress: z.string().min(8).max(128),
        }),
      ).safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
      });

      if (!parsed.success) {
        return res.status(400).json({ error: 'walletAddress required' });
      }

      const auth = await verifyWalletReadAccess(req, {
        action: 'governance.vote.history',
        address: parsed.data.walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const votes = await prisma.governanceVote.findMany({
        where: { walletAddress: parsed.data.walletAddress },
        orderBy: { votedAt: 'desc' },
        take: 100,
      });

      return res.json({ votes });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
