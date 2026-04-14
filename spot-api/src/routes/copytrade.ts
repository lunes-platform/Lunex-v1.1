import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { copytradeService } from '../services/copytradeService';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import {
  CopyTradeApiKeyChallengeSchema,
  CopyTradeApiKeySchema,
  CopyTradeSignalSchema,
  CopyTradeSignalWalletConfirmationSchema,
  CopyVaultDepositSchema,
  CopyVaultWithdrawSchema,
  PaginationSchema,
} from '../utils/validation';

const router = Router();

const SignedReadSchema = z.object({
  address: z.string().min(8).max(128),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

// ─── Read endpoints ───────────────────────────────────────────────

router.get(
  '/leaders/:leaderId/api-key/challenge',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyTradeApiKeyChallengeSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const result = await copytradeService.createApiKeyChallenge(
        req.params.leaderId,
        parsed.data,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/vaults',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const vaults = await copytradeService.listVaults();
      res.json({ vaults });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/vaults/:leaderId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vault = await copytradeService.getVaultByLeader(
        req.params.leaderId,
      );
      res.json({ vault });
    } catch (err: any) {
      if (err.message === 'Vault not found') {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  },
);

router.get(
  '/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedReadSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadSignature({
        action: 'copytrade.positions',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const positions = await copytradeService.getUserPositions(
        parsed.data.address,
      );
      res.json({ positions });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/activity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedReadSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadSignature({
        action: 'copytrade.activity',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { limit: parsed.data.limit ?? 50 },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const activity = await copytradeService.getActivity(
        parsed.data.address,
        parsed.data.limit ?? 50,
      );
      res.json({ activity });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/vaults/:leaderId/executions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 50;
      const executions = await copytradeService.getVaultExecutions(
        req.params.leaderId,
        limit,
      );
      res.json({ executions });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/vaults/:leaderId/signals/pending-wallet',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.header('x-api-key');
      if (!apiKey)
        return res.status(401).json({
          error: 'x-api-key header required for pending wallet signals',
        });
      await copytradeService.validateLeaderApiKey(req.params.leaderId, apiKey);

      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 50;
      const result = await copytradeService.listPendingWalletContinuations(
        req.params.leaderId,
        limit,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Mutations (signed) ──────────────────────────────────────────

router.post(
  '/leaders/:leaderId/api-key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyTradeApiKeySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const result = await copytradeService.createOrRotateApiKey(
        req.params.leaderId,
        parsed.data,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vaults/:leaderId/deposit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyVaultDepositSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'copytrade.deposit',
        address: parsed.data.followerAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          leaderId: req.params.leaderId,
          token: parsed.data.token,
          amount: parsed.data.amount,
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await copytradeService.depositToVault(
        req.params.leaderId,
        parsed.data,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vaults/:leaderId/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyVaultWithdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'copytrade.withdraw',
        address: parsed.data.followerAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { leaderId: req.params.leaderId, shares: parsed.data.shares },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await copytradeService.withdrawFromVault(
        req.params.leaderId,
        parsed.data,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vaults/:leaderId/signals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyTradeSignalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      if (parsed.data.source === 'API') {
        const apiKey = req.header('x-api-key');
        if (!apiKey)
          return res
            .status(401)
            .json({ error: 'x-api-key header required for API signals' });
        await copytradeService.validateLeaderApiKey(
          req.params.leaderId,
          apiKey,
        );
      } else {
        if (
          !parsed.data.leaderAddress ||
          !parsed.data.signature ||
          !parsed.data.nonce ||
          !parsed.data.timestamp
        ) {
          return res.status(401).json({
            error:
              'WEB3 signals require leaderAddress, nonce, timestamp, and signature',
          });
        }
        const hasExplicitSignalMode = typeof req.body?.signalMode === 'string';
        const auth = await verifyWalletActionSignature({
          action: 'copytrade.web3-signal',
          address: parsed.data.leaderAddress,
          nonce: parsed.data.nonce,
          timestamp: parsed.data.timestamp,
          signature: parsed.data.signature,
          fields: {
            leaderId: req.params.leaderId,
            pairSymbol: parsed.data.pairSymbol,
            side: parsed.data.side,
            positionEffect: parsed.data.positionEffect,
            ...(hasExplicitSignalMode
              ? { signalMode: parsed.data.signalMode }
              : {}),
            source: parsed.data.source,
            strategyTag: parsed.data.strategyTag || '',
            amountIn: parsed.data.amountIn,
            amountOutMin: parsed.data.amountOutMin,
            route: parsed.data.route || [],
            maxSlippageBps: parsed.data.maxSlippageBps,
            executionPrice: parsed.data.executionPrice || '',
          },
        });
        if (!auth.ok) {
          const hasExplicitPositionEffect =
            typeof req.body?.positionEffect === 'string';

          if (!hasExplicitPositionEffect && !hasExplicitSignalMode) {
            const legacyAuth = await verifyWalletActionSignature({
              action: 'copytrade.web3-signal',
              address: parsed.data.leaderAddress,
              nonce: parsed.data.nonce,
              timestamp: parsed.data.timestamp,
              signature: parsed.data.signature,
              fields: {
                leaderId: req.params.leaderId,
                pairSymbol: parsed.data.pairSymbol,
                side: parsed.data.side,
                source: parsed.data.source,
                strategyTag: parsed.data.strategyTag || '',
                amountIn: parsed.data.amountIn,
                amountOutMin: parsed.data.amountOutMin,
                route: parsed.data.route || [],
                maxSlippageBps: parsed.data.maxSlippageBps,
                executionPrice: parsed.data.executionPrice || '',
                realizedPnlPct: parsed.data.realizedPnlPct || '',
              },
            });
            if (!legacyAuth.ok)
              return res.status(401).json({ error: auth.error });
          } else {
            return res.status(401).json({ error: auth.error });
          }
        }
      }

      const result = await copytradeService.createSignal(
        req.params.leaderId,
        parsed.data,
      );
      res.status(201).json(result);
    } catch (err: any) {
      if (
        err?.message === 'No matching open leader trade to close' ||
        String(err?.message || '').startsWith('Signal notional ') ||
        String(err?.message || '').includes('below amountOutMin')
      ) {
        return res.status(409).json({ error: err.message });
      }
      next(err);
    }
  },
);

router.post(
  '/vaults/:leaderId/signals/:signalId/wallet-confirmation',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CopyTradeSignalWalletConfirmationSchema.safeParse(
        req.body,
      );
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const auth = await verifyWalletActionSignature({
        action: 'copytrade.confirm-wallet-signal',
        address: parsed.data.leaderAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          leaderId: req.params.leaderId,
          signalId: req.params.signalId,
          txHash: parsed.data.txHash,
          amountOut: parsed.data.amountOut || '',
          executionPrice: parsed.data.executionPrice || '',
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await copytradeService.confirmWalletSignalContinuation(
        req.params.leaderId,
        req.params.signalId,
        parsed.data,
      );
      res.json(result);
    } catch (err: any) {
      if (
        err?.message === 'Signal not found for leader vault' ||
        err?.message === 'Wallet continuation not found for signal'
      ) {
        return res.status(404).json({ error: err.message });
      }
      if (err?.message === 'No matching open leader trade to close') {
        return res.status(409).json({ error: err.message });
      }
      if (String(err?.message || '').includes('below signal amountOutMin')) {
        return res.status(409).json({ error: err.message });
      }
      next(err);
    }
  },
);

export default router;
