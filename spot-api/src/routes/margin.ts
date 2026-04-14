import { NextFunction, Router, Request, Response } from 'express';
import { marginService } from '../services/marginService';
import {
  MarginCollateralSchema,
  MarginPriceHealthQuerySchema,
  MarginPriceHealthResetSchema,
  MarginOpenPositionSchema,
  MarginClosePositionSchema,
  MarginLiquidatePositionSchema,
} from '../utils/validation';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import { requireAdmin } from '../middleware/adminGuard';
import { z } from 'zod';

const router = Router();

const MarginOverviewReadSchema = z.object({
  address: z.string().min(8).max(128),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

// ─── Read ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = MarginOverviewReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const auth = await verifyWalletReadSignature({
      action: 'margin.overview',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
    });
    if (!auth.ok) return res.status(401).json({ error: auth.error });
    const overview = await marginService.getOverview(parsed.data.address);
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/price-health',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginPriceHealthQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const status = marginService.getPriceHealth(parsed.data.pairSymbol);
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/price-health/reset',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginPriceHealthResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const status = marginService.resetPriceHealthMonitor(
        parsed.data.pairSymbol,
      );
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Collateral (signed) ─────────────────────────────────────────

router.post(
  '/collateral/deposit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginCollateralSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'margin.collateral.deposit',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { token: parsed.data.token, amount: parsed.data.amount },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await marginService.depositCollateral({
        address: parsed.data.address,
        token: parsed.data.token,
        amount: parsed.data.amount,
        signature: parsed.data.signature,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/collateral/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginCollateralSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'margin.collateral.withdraw',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { token: parsed.data.token, amount: parsed.data.amount },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await marginService.withdrawCollateral({
        address: parsed.data.address,
        token: parsed.data.token,
        amount: parsed.data.amount,
        signature: parsed.data.signature,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Positions (signed) ──────────────────────────────────────────

router.post(
  '/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginOpenPositionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'margin.position.open',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          pairSymbol: parsed.data.pairSymbol,
          side: parsed.data.side,
          collateralAmount: parsed.data.collateralAmount,
          leverage: parsed.data.leverage,
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await marginService.openPosition({
        address: parsed.data.address,
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        collateralAmount: parsed.data.collateralAmount,
        leverage: parsed.data.leverage,
        signature: parsed.data.signature,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/positions/:id/close',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginClosePositionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'margin.position.close',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { positionId: req.params.id },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const overview = await marginService.closePosition(
        req.params.id,
        parsed.data.address,
      );
      res.json(overview);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/positions/:id/liquidate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = MarginLiquidatePositionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'margin.position.liquidate',
        address: parsed.data.liquidatorAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { positionId: req.params.id },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const overview = await marginService.liquidatePosition(
        req.params.id,
        parsed.data.liquidatorAddress,
      );
      res.json(overview);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
