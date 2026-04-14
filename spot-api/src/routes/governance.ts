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
import { NextFunction, Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';

const router = Router();

const VOTE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

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
  txHash: z.string().max(128).optional(),
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
      const parsed = VoteCheckSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { walletAddress, proposalId } = parsed.data;
      const auth = await verifyWalletReadSignature({
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
          lastVotedAt: null,
          timeUntilNextVote: 0,
        });
      }

      const elapsed = Date.now() - last.votedAt.getTime();
      const timeUntilNextVote = Math.max(0, VOTE_COOLDOWN_MS - elapsed);

      return res.json({
        canVote: timeUntilNextVote === 0,
        lastVotedAt: last.votedAt.toISOString(),
        lastVoteType: last.voteType,
        timeUntilNextVote,
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
 * Note: The source of truth is the smart contract.
 * This record is used only for cooldown UX.
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

      // Verify cooldown server-side
      const last = await prisma.governanceVote.findFirst({
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
      // P2002 = Prisma unique constraint — duplicate vote on same proposal
      if ((err as { code?: string }).code === 'P2002') {
        return res.status(409).json({
          error: 'Vote already recorded for this proposal',
          code: 'DUPLICATE_VOTE',
        });
      }
      next(err);
    }
  },
);

/**
 * GET /api/v1/governance/vote/history?walletAddress=
 *
 * Returns the vote history for a wallet (for UI cooldown display).
 */
router.get(
  '/vote/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedActionSchema.extend({
        walletAddress: z.string().min(8).max(128),
      }).safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({ error: 'walletAddress required' });
      }

      const auth = await verifyWalletReadSignature({
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
