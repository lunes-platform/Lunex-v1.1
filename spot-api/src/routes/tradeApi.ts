import { NextFunction, Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { agentAuth } from '../middleware/agentAuth';
import { orderService } from '../services/orderService';
import { copytradeService } from '../services/copytradeService';
import {
  botRateLimiter,
  botAnomalyGuard,
  keyRotationWarning,
  recordLargeOrderPlaced,
  recordOrderCancelled,
} from '../services/botSandbox';
import { executionLayerService } from '../services/executionLayerService';
import { settlementService } from '../services/settlementService';
import prisma from '../db';
import { Decimal } from '@prisma/client/runtime/library';
import { log } from '../utils/logger';
import { accountAddressFilter, isSameAccount } from '../utils/validation';

const router = Router();

// All routes require agent API key authentication
router.use(agentAuth(['TRADE_SPOT']));

// Security layers: rate limiting → anomaly detection → key rotation warnings
router.use(botRateLimiter());
router.use(botAnomalyGuard());
router.use(keyRotationWarning());

// ─── Validation ─────────────────────────────────────────────────

const SwapSchema = z.object({
  pairSymbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  amount: z.string().min(1),
  maxSlippageBps: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(100),
});

const LimitOrderSchema = z.object({
  pairSymbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().min(1),
  amount: z.string().min(1),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional().default('GTC'),
  stopPrice: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────

async function validateTradeLimits(
  agent: NonNullable<Request['agent']>,
  amount: string,
) {
  const amountNum = parseFloat(amount);

  if (amountNum > agent.maxPositionSize) {
    throw new Error(
      `Amount ${amountNum} exceeds max position size ${agent.maxPositionSize} for your staking tier (${agent.stakingTier})`,
    );
  }

  const todayTrades = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { totalTrades: true },
  });

  // Lifetime trade count as a rough daily limit proxy (sliding window on hold)
  const APPROX_DAYS_PER_YEAR = 365;
  if (
    (todayTrades?.totalTrades ?? 0) >
    agent.dailyTradeLimit * APPROX_DAYS_PER_YEAR
  ) {
    throw new Error(
      `Daily trade limit (${agent.dailyTradeLimit}) exceeded for your staking tier (${agent.stakingTier})`,
    );
  }
}

async function recordAgentTrade(agentId: string, volume: number) {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      totalTrades: { increment: 1 },
      totalVolume: { increment: volume },
      lastActiveAt: new Date(),
    },
  });
}

async function emitCopyTradeSignalIfLeader(
  agentId: string,
  trade: {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    amount: string;
    executionPrice?: number;
  },
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { leader: { include: { vault: true } } },
  });

  if (!agent?.leader?.vault || agent.leader.vault.status !== 'ACTIVE')
    return null;

  // Defense in depth: an agent may only signal for its OWN leader. A link to
  // a leader whose address is not the agent's wallet never emits signals.
  if (!isSameAccount(agent.leader.address, agent.walletAddress)) return null;

  const amountValue = Number.parseFloat(trade.amount);
  const amountOutMin =
    Number.isFinite(amountValue) && amountValue > 0
      ? Math.max(amountValue * 0.000001, 0.000000001).toString()
      : '0.000000001';

  try {
    const signal = await copytradeService.createSignal(agent.leader.id, {
      pairSymbol: trade.pairSymbol,
      side: trade.side,
      positionEffect: 'AUTO',
      signalMode: 'JOURNAL',
      source: 'API',
      amountIn: trade.amount,
      amountOutMin,
      executionPrice: trade.executionPrice?.toString(),
      maxSlippageBps: agent.leader.vault.maxSlippageBps,
    });
    return signal;
  } catch {
    // Copy trade signal is best-effort — don't block the main trade
    return null;
  }
}

// ─── Routes ─────────────────────────────────────────────────────

/**
 * POST /api/v1/trade/swap
 * Execute a market swap — immediate execution at best available price
 */
router.post(
  '/swap',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SwapSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const agent = req.agent!;
      await validateTradeLimits(agent, parsed.data.amount);

      if (settlementService.isEnabled()) {
        return res.status(409).json({
          error:
            'Agent spot swaps require delegated settlement authorization before on-chain settlement can be used',
          code: 'SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED',
        });
      }

      // ── Execution Layer: validate + log ────────────────────────
      const strategyId =
        typeof req.body.strategyId === 'string'
          ? req.body.strategyId
          : undefined;
      const { logId, validation } = await executionLayerService.validateAndLog({
        agentId: agent.id,
        strategyId,
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        orderType: 'MARKET',
        amount: parsed.data.amount,
        maxSlippageBps: parsed.data.maxSlippageBps,
        source: 'API',
      });

      if (!validation.allowed) {
        return res.status(422).json({
          error: 'Trade rejected by risk controls',
          reason: validation.rejectionReason,
          checks: validation.checks,
        });
      }

      const nonce = `agent_${agent.id}_${Date.now()}`;

      const order = await orderService.createOrder({
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        type: 'MARKET',
        amount: parsed.data.amount,
        makerAddress: agent.walletAddress,
        nonce,
        timestamp: Date.now(),
        signature: `agent:${agent.id}`,
        timeInForce: 'IOC',
      });

      await recordAgentTrade(agent.id, parseFloat(parsed.data.amount));

      if (order?.id) {
        await executionLayerService
          .updateExecutionStatus(logId, {
            agentId: agent.id,
            status: 'EXECUTED',
            orderId: order.id,
          })
          .catch(() => null);
      }

      const signal = await emitCopyTradeSignalIfLeader(agent.id, {
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        amount: parsed.data.amount,
      });

      res.status(201).json({
        order,
        source: 'API',
        agentId: agent.id,
        executionLogId: logId,
        copyTradeSignal: signal
          ? { signalId: signal.signalId, slices: signal.slices.length }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/trade/limit
 * Place a limit order on the orderbook
 */
router.post(
  '/limit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = LimitOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      // Agent orders carry a synthetic `agent:<id>` signature that on-chain
      // settlement always rejects (assertOrderTrustedSource). Accepting them
      // while settlement is on would create trades that can never settle:
      // fake volume/fees and consumed counterparty orders (BE-05). Same gate
      // as /swap; checked before any side effect.
      if (settlementService.isEnabled()) {
        return res.status(409).json({
          error:
            'Agent spot orders require delegated settlement authorization before on-chain settlement can be used',
          code: 'SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED',
        });
      }

      const agent = req.agent!;
      await validateTradeLimits(agent, parsed.data.amount);

      // ── Execution Layer: validate + log ────────────────────────
      const strategyId =
        typeof req.body.strategyId === 'string'
          ? req.body.strategyId
          : undefined;
      const orderType = parsed.data.stopPrice ? 'STOP_LIMIT' : 'LIMIT';
      const { logId, validation } = await executionLayerService.validateAndLog({
        agentId: agent.id,
        strategyId,
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        orderType,
        amount: parsed.data.amount,
        price: parsed.data.price,
        source: 'API',
      });

      if (!validation.allowed) {
        return res.status(422).json({
          error: 'Trade rejected by risk controls',
          reason: validation.rejectionReason,
          checks: validation.checks,
        });
      }

      const nonce = `agent_${agent.id}_${Date.now()}`;

      const order = await orderService.createOrder({
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        type: orderType,
        price: parsed.data.price,
        stopPrice: parsed.data.stopPrice,
        amount: parsed.data.amount,
        makerAddress: agent.walletAddress,
        nonce,
        timestamp: Date.now(),
        signature: `agent:${agent.id}`,
        timeInForce: parsed.data.timeInForce ?? 'GTC',
      });

      await recordAgentTrade(agent.id, parseFloat(parsed.data.amount));

      if (order) {
        const recentAvg = agent.maxPositionSize / 10;
        recordLargeOrderPlaced(
          agent.id,
          order.id,
          parseFloat(parsed.data.amount),
          recentAvg,
        );

        await executionLayerService
          .updateExecutionStatus(logId, {
            agentId: agent.id,
            status: 'EXECUTED',
            orderId: order.id,
            executionPrice: parsed.data.price,
          })
          .catch(() => null);
      }

      const signal = await emitCopyTradeSignalIfLeader(agent.id, {
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        amount: parsed.data.amount,
        executionPrice: parseFloat(parsed.data.price),
      });

      res.status(201).json({
        order,
        source: 'API',
        agentId: agent.id,
        executionLogId: logId,
        copyTradeSignal: signal
          ? { signalId: signal.signalId, slices: signal.slices.length }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/v1/trade/orders/:id
 * Cancel an open order
 */
router.delete(
  '/orders/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = req.agent!;
      const order = await orderService.cancelOrder(
        req.params.id,
        agent.walletAddress,
      );

      const spoofFlag = recordOrderCancelled(agent.id, req.params.id);
      if (spoofFlag) {
        const totalScore = (
          await import('../services/botSandbox')
        ).botSandbox.getAnomalyScore(agent.id);
        log.warn(
          { agentId: agent.id, flag: spoofFlag.description, totalScore },
          '[BotSandbox] Spoofing detected',
        );
      }

      res.json({ order, source: 'API', agentId: agent.id });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/trade/orders
 * Get agent's open orders
 */
router.get(
  '/orders',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = req.agent!;
      const { status } = req.query;
      const orders = await orderService.getUserOrders(
        agent.walletAddress,
        typeof status === 'string' ? status : undefined,
        50,
        0,
      );
      res.json({ orders, agentId: agent.id });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/trade/portfolio
 * Get agent's portfolio summary (balances, open positions, PnL)
 */
router.get(
  '/portfolio',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = req.agent!;
      // M-09: new rows are canonical, legacy rows keep the agent's raw string.
      const account = accountAddressFilter(agent.walletAddress);

      const [balanceRows, openOrders, recentTrades] = await Promise.all([
        prisma.userBalance.findMany({
          where: { address: account },
        }),
        prisma.order.count({
          where: {
            makerAddress: account,
            status: { in: ['OPEN', 'PARTIAL'] },
          },
        }),
        prisma.trade.findMany({
          where: {
            OR: [{ makerAddress: account }, { takerAddress: account }],
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            pairId: true,
            side: true,
            price: true,
            amount: true,
            createdAt: true,
          },
        }),
      ]);

      // One entry per token even when the account has rows in two encodings.
      const byToken = new Map<
        string,
        { available: Decimal; locked: Decimal }
      >();
      for (const row of balanceRows) {
        const entry = byToken.get(row.token);
        byToken.set(row.token, {
          available: (entry?.available ?? new Decimal(0)).plus(
            row.available.toString(),
          ),
          locked: (entry?.locked ?? new Decimal(0)).plus(row.locked.toString()),
        });
      }
      const balances = [...byToken].map(([token, entry]) => ({
        token,
        available: parseFloat(entry.available.toString()),
        locked: parseFloat(entry.locked.toString()),
      }));

      res.json({
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        stakingTier: agent.stakingTier,
        balances,
        openOrders,
        recentTrades: recentTrades.map((t) => ({
          id: t.id,
          pairId: t.pairId,
          side: t.side,
          price: parseFloat(t.price.toString()),
          amount: parseFloat(t.amount.toString()),
          createdAt: t.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
