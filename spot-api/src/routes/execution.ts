import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { executionLayerService } from '../services/executionLayerService'
import { agentAuth } from '../middleware/agentAuth'

const router = Router()

// ─── Schemas ─────────────────────────────────────────────────────

const OrderSideValues  = ['BUY', 'SELL'] as const
const OrderTypeValues  = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'] as const
const StatusValues     = ['PENDING', 'EXECUTED', 'REJECTED', 'FAILED'] as const

const ValidateSchema = z.object({
    strategyId:    z.string().uuid().optional(),
    pairSymbol:    z.string().min(1),
    side:          z.enum(OrderSideValues),
    orderType:     z.enum(OrderTypeValues),
    amount:        z.string().min(1),
    price:         z.string().optional(),
    maxSlippageBps: z.coerce.number().int().min(1).max(500).optional(),
})

const LogSchema = ValidateSchema.extend({
    orderId:          z.string().uuid().optional(),
    executedAmount:   z.string().optional(),
    executionPrice:   z.string().optional(),
    slippageBps:      z.coerce.number().int().optional(),
    status:           z.enum(StatusValues),
    rejectionReason:  z.string().optional(),
    source:           z.string().optional(),
})

const HistoryQuerySchema = z.object({
    strategyId: z.string().uuid().optional(),
    status:     z.enum(StatusValues).optional(),
    pairSymbol: z.string().optional(),
    since:      z.string().optional(), // ISO date
    limit:      z.coerce.number().int().min(1).max(200).optional(),
    offset:     z.coerce.number().int().min(0).optional(),
})

// ─── Routes (all require agent auth) ─────────────────────────────

router.use(agentAuth(['TRADE_SPOT']))

// POST /execution/validate — check if a trade is allowed (dry-run, no log)
router.post('/validate', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = ValidateSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }

        const result = await executionLayerService.validateTrade({
            agentId: req.agent!.id,
            ...parsed.data,
        })

        res.json(result)
    } catch (err) { next(err) }
})

// POST /execution/validate-and-log — validate + write PENDING/REJECTED log
router.post('/validate-and-log', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = ValidateSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }

        const { logId, validation } = await executionLayerService.validateAndLog({
            agentId: req.agent!.id,
            ...parsed.data,
        })

        const statusCode = validation.allowed ? 200 : 422
        res.status(statusCode).json({ logId, ...validation })
    } catch (err) { next(err) }
})

// POST /execution/log — manually record an execution (used after trade resolves)
router.post('/log', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = LogSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }

        const entry = await executionLayerService.logExecution({
            agentId: req.agent!.id,
            ...parsed.data,
        })

        res.status(201).json({ entry })
    } catch (err) { next(err) }
})

// PATCH /execution/:logId/status — update an execution log status after fill
router.patch('/:logId/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status, orderId, executedAmount, executionPrice, slippageBps } = req.body
        if (!status || !StatusValues.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${StatusValues.join(', ')}` })
        }

        const entry = await executionLayerService.updateExecutionStatus(req.params.logId, {
            status,
            orderId,
            executedAmount,
            executionPrice,
            slippageBps,
        })

        res.json({ entry })
    } catch (err) { next(err) }
})

// GET /execution/history — execution history for the authenticated agent
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = HistoryQuerySchema.safeParse(req.query)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }

        const { strategyId, status, pairSymbol, since, limit = 50, offset = 0 } = parsed.data

        // If strategyId provided, use strategy-scoped history
        if (strategyId) {
            const result = await executionLayerService.getStrategyExecutionHistory(strategyId, {
                status: status as any,
                since: since ? new Date(since) : undefined,
                limit,
                offset,
            })
            return res.json(result)
        }

        const result = await executionLayerService.getAgentExecutionHistory(req.agent!.id, {
            status: status as any,
            pairSymbol,
            since: since ? new Date(since) : undefined,
            limit,
            offset,
        })

        res.json(result)
    } catch (err) { next(err) }
})

// GET /execution/daily-summary — today's execution summary for the agent
router.get('/daily-summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dateParam = typeof req.query.date === 'string' ? new Date(req.query.date) : undefined
        const summary = await executionLayerService.getDailySummary(req.agent!.id, dateParam)
        res.json(summary)
    } catch (err) { next(err) }
})

// GET /execution/risk-params — explain current risk parameters for the agent
router.get('/risk-params', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const agent = req.agent!
        const strategyId = typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined

        const params: Record<string, unknown> = {
            agentTier:       agent.stakingTier,
            dailyTradeLimit: agent.dailyTradeLimit,
            maxPositionSize: agent.maxPositionSize,
            maxOpenOrders:   agent.maxOpenOrders,
            globalSlippageCap: 500,
        }

        if (strategyId) {
            const strategy = await (await import('../db')).default.strategy.findUnique({
                where: { id: strategyId },
                select: { riskLevel: true, vaultEquity: true, status: true },
            })
            if (strategy) {
                params.strategy = {
                    riskLevel:           strategy.riskLevel,
                    status:              strategy.status,
                    vaultEquity:         strategy.vaultEquity,
                    slippageCap:         { LOW: 50, MEDIUM: 150, HIGH: 300, AGGRESSIVE: 500 }[strategy.riskLevel],
                    maxTradeSizePct:     { LOW: 5, MEDIUM: 10, HIGH: 20, AGGRESSIVE: 40 }[strategy.riskLevel],
                }
            }
        }

        res.json({ riskParams: params })
    } catch (err) { next(err) }
})

export default router
