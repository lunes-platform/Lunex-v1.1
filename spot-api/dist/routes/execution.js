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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const executionLayerService_1 = require("../services/executionLayerService");
const agentAuth_1 = require("../middleware/agentAuth");
const router = (0, express_1.Router)();
// ─── Schemas ─────────────────────────────────────────────────────
const OrderSideValues = ['BUY', 'SELL'];
const OrderTypeValues = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'];
const StatusValues = ['PENDING', 'EXECUTED', 'REJECTED', 'FAILED'];
const ValidateSchema = zod_1.z.object({
    strategyId: zod_1.z.string().uuid().optional(),
    pairSymbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(OrderSideValues),
    orderType: zod_1.z.enum(OrderTypeValues),
    amount: zod_1.z.string().min(1),
    price: zod_1.z.string().optional(),
    maxSlippageBps: zod_1.z.coerce.number().int().min(1).max(500).optional(),
});
const LogSchema = ValidateSchema.extend({
    orderId: zod_1.z.string().uuid().optional(),
    executedAmount: zod_1.z.string().optional(),
    executionPrice: zod_1.z.string().optional(),
    slippageBps: zod_1.z.coerce.number().int().optional(),
    status: zod_1.z.enum(StatusValues),
    rejectionReason: zod_1.z.string().optional(),
    source: zod_1.z.string().optional(),
});
const HistoryQuerySchema = zod_1.z.object({
    strategyId: zod_1.z.string().uuid().optional(),
    status: zod_1.z.enum(StatusValues).optional(),
    pairSymbol: zod_1.z.string().optional(),
    since: zod_1.z.string().optional(), // ISO date
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
// ─── Routes (all require agent auth) ─────────────────────────────
router.use((0, agentAuth_1.agentAuth)(['TRADE_SPOT']));
// POST /execution/validate — check if a trade is allowed (dry-run, no log)
router.post('/validate', async (req, res, next) => {
    try {
        const parsed = ValidateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await executionLayerService_1.executionLayerService.validateTrade({
            agentId: req.agent.id,
            ...parsed.data,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /execution/validate-and-log — validate + write PENDING/REJECTED log
router.post('/validate-and-log', async (req, res, next) => {
    try {
        const parsed = ValidateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { logId, validation } = await executionLayerService_1.executionLayerService.validateAndLog({
            agentId: req.agent.id,
            ...parsed.data,
        });
        const statusCode = validation.allowed ? 200 : 422;
        res.status(statusCode).json({ logId, ...validation });
    }
    catch (err) {
        next(err);
    }
});
// POST /execution/log — manually record an execution (used after trade resolves)
router.post('/log', async (req, res, next) => {
    try {
        const parsed = LogSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const entry = await executionLayerService_1.executionLayerService.logExecution({
            agentId: req.agent.id,
            ...parsed.data,
        });
        res.status(201).json({ entry });
    }
    catch (err) {
        next(err);
    }
});
// PATCH /execution/:logId/status — update an execution log status after fill
router.patch('/:logId/status', async (req, res, next) => {
    try {
        const { status, orderId, executedAmount, executionPrice, slippageBps } = req.body;
        if (!status || !StatusValues.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${StatusValues.join(', ')}` });
        }
        const entry = await executionLayerService_1.executionLayerService.updateExecutionStatus(req.params.logId, {
            status,
            orderId,
            executedAmount,
            executionPrice,
            slippageBps,
        });
        res.json({ entry });
    }
    catch (err) {
        next(err);
    }
});
// GET /execution/history — execution history for the authenticated agent
router.get('/history', async (req, res, next) => {
    try {
        const parsed = HistoryQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { strategyId, status, pairSymbol, since, limit = 50, offset = 0 } = parsed.data;
        // If strategyId provided, use strategy-scoped history
        if (strategyId) {
            const result = await executionLayerService_1.executionLayerService.getStrategyExecutionHistory(strategyId, {
                status: status,
                since: since ? new Date(since) : undefined,
                limit,
                offset,
            });
            return res.json(result);
        }
        const result = await executionLayerService_1.executionLayerService.getAgentExecutionHistory(req.agent.id, {
            status: status,
            pairSymbol,
            since: since ? new Date(since) : undefined,
            limit,
            offset,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /execution/daily-summary — today's execution summary for the agent
router.get('/daily-summary', async (req, res, next) => {
    try {
        const dateParam = typeof req.query.date === 'string' ? new Date(req.query.date) : undefined;
        const summary = await executionLayerService_1.executionLayerService.getDailySummary(req.agent.id, dateParam);
        res.json(summary);
    }
    catch (err) {
        next(err);
    }
});
// GET /execution/risk-params — explain current risk parameters for the agent
router.get('/risk-params', async (req, res, next) => {
    try {
        const agent = req.agent;
        const strategyId = typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined;
        const params = {
            agentTier: agent.stakingTier,
            dailyTradeLimit: agent.dailyTradeLimit,
            maxPositionSize: agent.maxPositionSize,
            maxOpenOrders: agent.maxOpenOrders,
            globalSlippageCap: 500,
        };
        if (strategyId) {
            const strategy = await (await Promise.resolve().then(() => __importStar(require('../db')))).default.strategy.findUnique({
                where: { id: strategyId },
                select: { riskLevel: true, vaultEquity: true, status: true },
            });
            if (strategy) {
                params.strategy = {
                    riskLevel: strategy.riskLevel,
                    status: strategy.status,
                    vaultEquity: strategy.vaultEquity,
                    slippageCap: { LOW: 50, MEDIUM: 150, HIGH: 300, AGGRESSIVE: 500 }[strategy.riskLevel],
                    maxTradeSizePct: { LOW: 5, MEDIUM: 10, HIGH: 20, AGGRESSIVE: 40 }[strategy.riskLevel],
                };
            }
        }
        res.json({ riskParams: params });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=execution.js.map