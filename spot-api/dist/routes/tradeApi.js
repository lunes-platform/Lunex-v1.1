"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const agentAuth_1 = require("../middleware/agentAuth");
const orderService_1 = require("../services/orderService");
const copytradeService_1 = require("../services/copytradeService");
const botSandbox_1 = require("../services/botSandbox");
const executionLayerService_1 = require("../services/executionLayerService");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
// All routes require agent API key authentication
router.use((0, agentAuth_1.agentAuth)(['TRADE_SPOT']));
// Security layers: rate limiting → anomaly detection → key rotation warnings
router.use((0, botSandbox_1.botRateLimiter)());
router.use((0, botSandbox_1.botAnomalyGuard)());
router.use((0, botSandbox_1.keyRotationWarning)());
// ─── Validation ─────────────────────────────────────────────────
const SwapSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL']),
    amount: zod_1.z.string().min(1),
    maxSlippageBps: zod_1.z.coerce.number().int().min(1).max(500).optional().default(100),
});
const LimitOrderSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL']),
    price: zod_1.z.string().min(1),
    amount: zod_1.z.string().min(1),
    timeInForce: zod_1.z.enum(['GTC', 'IOC', 'FOK']).optional().default('GTC'),
    stopPrice: zod_1.z.string().optional(),
});
const CancelOrderSchema = zod_1.z.object({
    orderId: zod_1.z.string().uuid(),
});
// ─── Helpers ────────────────────────────────────────────────────
async function validateTradeLimits(agent, amount) {
    const amountNum = parseFloat(amount);
    if (amountNum > agent.maxPositionSize) {
        throw new Error(`Amount ${amountNum} exceeds max position size ${agent.maxPositionSize} for your staking tier (${agent.stakingTier})`);
    }
    // Check daily trade count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTrades = await db_1.default.agent.findUnique({
        where: { id: agent.id },
        select: { totalTrades: true },
    });
    // Lifetime trade count as a rough daily limit proxy (sliding window on hold)
    const APPROX_DAYS_PER_YEAR = 365;
    if ((todayTrades?.totalTrades ?? 0) > agent.dailyTradeLimit * APPROX_DAYS_PER_YEAR) {
        throw new Error(`Daily trade limit (${agent.dailyTradeLimit}) exceeded for your staking tier (${agent.stakingTier})`);
    }
}
async function recordAgentTrade(agentId, volume) {
    await db_1.default.agent.update({
        where: { id: agentId },
        data: {
            totalTrades: { increment: 1 },
            totalVolume: { increment: volume },
            lastActiveAt: new Date(),
        },
    });
}
async function emitCopyTradeSignalIfLeader(agentId, trade) {
    const agent = await db_1.default.agent.findUnique({
        where: { id: agentId },
        include: { leader: { include: { vault: true } } },
    });
    if (!agent?.leader?.vault || agent.leader.vault.status !== 'ACTIVE')
        return null;
    try {
        const signal = await copytradeService_1.copytradeService.createSignal(agent.leader.id, {
            pairSymbol: trade.pairSymbol,
            side: trade.side,
            source: 'API',
            amountIn: trade.amount,
            amountOutMin: '0',
            executionPrice: trade.executionPrice?.toString(),
            maxSlippageBps: agent.leader.vault.maxSlippageBps,
        });
        return signal;
    }
    catch {
        // Copy trade signal is best-effort — don't block the main trade
        return null;
    }
}
// ─── Routes ─────────────────────────────────────────────────────
/**
 * POST /api/v1/trade/swap
 * Execute a market swap — immediate execution at best available price
 */
router.post('/swap', async (req, res, next) => {
    try {
        const parsed = SwapSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const agent = req.agent;
        await validateTradeLimits(agent, parsed.data.amount);
        // ── Execution Layer: validate + log ────────────────────────
        const strategyId = typeof req.body.strategyId === 'string' ? req.body.strategyId : undefined;
        const { logId, validation } = await executionLayerService_1.executionLayerService.validateAndLog({
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
        // ──────────────────────────────────────────────────────────
        const nonce = `agent_${agent.id}_${Date.now()}`;
        const order = await orderService_1.orderService.createOrder({
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
        // Update execution log with order id
        if (order?.id) {
            await executionLayerService_1.executionLayerService.updateExecutionStatus(logId, {
                status: 'EXECUTED',
                orderId: order.id,
            }).catch(() => null);
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
            copyTradeSignal: signal ? { signalId: signal.signalId, slices: signal.slices.length } : null,
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/v1/trade/limit
 * Place a limit order on the orderbook
 */
router.post('/limit', async (req, res, next) => {
    try {
        const parsed = LimitOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const agent = req.agent;
        await validateTradeLimits(agent, parsed.data.amount);
        // ── Execution Layer: validate + log ────────────────────────
        const strategyId = typeof req.body.strategyId === 'string' ? req.body.strategyId : undefined;
        const orderType = parsed.data.stopPrice ? 'STOP_LIMIT' : 'LIMIT';
        const { logId, validation } = await executionLayerService_1.executionLayerService.validateAndLog({
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
        // ──────────────────────────────────────────────────────────
        const nonce = `agent_${agent.id}_${Date.now()}`;
        const order = await orderService_1.orderService.createOrder({
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
            (0, botSandbox_1.recordLargeOrderPlaced)(agent.id, order.id, parseFloat(parsed.data.amount), recentAvg);
            // Update execution log with order id
            await executionLayerService_1.executionLayerService.updateExecutionStatus(logId, {
                status: 'EXECUTED',
                orderId: order.id,
                executionPrice: parsed.data.price,
            }).catch(() => null);
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
            copyTradeSignal: signal ? { signalId: signal.signalId, slices: signal.slices.length } : null,
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/v1/trade/orders/:id
 * Cancel an open order
 */
router.delete('/orders/:id', async (req, res, next) => {
    try {
        const agent = req.agent;
        const order = await orderService_1.orderService.cancelOrder(req.params.id, agent.walletAddress);
        const spoofFlag = (0, botSandbox_1.recordOrderCancelled)(agent.id, req.params.id);
        if (spoofFlag) {
            const totalScore = (await Promise.resolve().then(() => __importStar(require('../services/botSandbox')))).botSandbox.getAnomalyScore(agent.id);
            logger_1.log.warn({ agentId: agent.id, flag: spoofFlag.description, totalScore }, '[BotSandbox] Spoofing detected');
        }
        res.json({ order, source: 'API', agentId: agent.id });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/v1/trade/orders
 * Get agent's open orders
 */
router.get('/orders', async (req, res, next) => {
    try {
        const agent = req.agent;
        const { status } = req.query;
        const orders = await orderService_1.orderService.getUserOrders(agent.walletAddress, typeof status === 'string' ? status : undefined, 50, 0);
        res.json({ orders, agentId: agent.id });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/v1/trade/portfolio
 * Get agent's portfolio summary (balances, open positions, PnL)
 */
router.get('/portfolio', async (req, res, next) => {
    try {
        const agent = req.agent;
        const [balances, openOrders, recentTrades] = await Promise.all([
            db_1.default.userBalance.findMany({ where: { address: agent.walletAddress } }),
            db_1.default.order.count({ where: { makerAddress: agent.walletAddress, status: { in: ['OPEN', 'PARTIAL'] } } }),
            db_1.default.trade.findMany({
                where: {
                    OR: [
                        { makerAddress: agent.walletAddress },
                        { takerAddress: agent.walletAddress },
                    ],
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
        res.json({
            agentId: agent.id,
            walletAddress: agent.walletAddress,
            stakingTier: agent.stakingTier,
            balances: balances.map((b) => ({
                token: b.token,
                available: parseFloat(b.available.toString()),
                locked: parseFloat(b.locked.toString()),
            })),
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
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=tradeApi.js.map