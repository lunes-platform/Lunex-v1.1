import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../db'
import { asymmetricService } from '../services/asymmetricService'

const router = Router()

// ─── Helper ─────────────────────────────────────────────────────

function send(res: Response, data: unknown, status = 200) {
    return res.status(status).json(data)
}

function handleAsync(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next)
}

// ─── Routes ─────────────────────────────────────────────────────

/**
 * GET /api/v1/asymmetric/strategies
 * List all strategies for a wallet address.
 * Query: ?address=<wallet>
 */
router.get(
    '/strategies',
    handleAsync(async (req, res) => {
        const { address } = req.query as { address?: string }
        if (!address) return send(res, { error: 'address query param is required' }, 400)

        const strategies = await asymmetricService.listUserStrategies(address)
        return send(res, strategies)
    }),
)

/**
 * POST /api/v1/asymmetric/strategies
 * Create a new asymmetric strategy.
 */
router.post(
    '/strategies',
    handleAsync(async (req, res) => {
        const {
            userAddress,
            pairAddress,
            agentId,
            isAutoRebalance,
            buyK,
            buyGamma,
            buyMaxCapacity,
            buyFeeTargetBps,
            sellGamma,
            sellMaxCapacity,
            sellFeeTargetBps,
            sellProfitTargetBps,
            leverageL,
            allocationC,
        } = req.body

        if (!userAddress || !pairAddress || !buyK || !buyGamma || !buyMaxCapacity || !sellGamma || !sellMaxCapacity) {
            return send(res, { error: 'Missing required fields' }, 400)
        }

        const strategy = await asymmetricService.createStrategy({
            userAddress,
            pairAddress,
            agentId,
            isAutoRebalance,
            buyK,
            buyGamma: Number(buyGamma),
            buyMaxCapacity,
            buyFeeTargetBps: buyFeeTargetBps !== undefined ? Number(buyFeeTargetBps) : undefined,
            sellGamma: Number(sellGamma),
            sellMaxCapacity,
            sellFeeTargetBps: sellFeeTargetBps !== undefined ? Number(sellFeeTargetBps) : undefined,
            sellProfitTargetBps: sellProfitTargetBps !== undefined ? Number(sellProfitTargetBps) : undefined,
            leverageL,
            allocationC: allocationC !== undefined ? Number(allocationC) : undefined,
        })

        return send(res, strategy, 201)
    }),
)

/**
 * GET /api/v1/asymmetric/strategies/:id
 * Get detailed status of a single strategy.
 */
router.get(
    '/strategies/:id',
    handleAsync(async (req, res) => {
        const strategy = await asymmetricService.getStrategy(req.params.id)
        return send(res, strategy)
    }),
)

/**
 * PATCH /api/v1/asymmetric/strategies/:id/auto
 * Toggle auto-rebalance on/off for a strategy.
 * Body: { address: string, enable: boolean }
 */
router.patch(
    '/strategies/:id/auto',
    handleAsync(async (req, res) => {
        const { address, enable } = req.body
        if (!address || enable === undefined) return send(res, { error: 'address and enable are required' }, 400)

        const strategy = await asymmetricService.toggleAutoRebalance(req.params.id, address, Boolean(enable))
        return send(res, strategy)
    }),
)

/**
 * PATCH /api/v1/asymmetric/strategies/:id/curve
 * Update curve parameters (manual or via AI agent with MANAGE_ASYMMETRIC permission).
 * Body: { address, isBuySide, newGamma?, newMaxCapacity?, newFeeTargetBps? }
 */
router.patch(
    '/strategies/:id/curve',
    handleAsync(async (req, res) => {
        const { address, isBuySide, newGamma, newMaxCapacity, newFeeTargetBps } = req.body
        if (!address || isBuySide === undefined) {
            return send(res, { error: 'address and isBuySide are required' }, 400)
        }

        const strategy = await asymmetricService.updateCurveParams(req.params.id, address, {
            isBuySide: Boolean(isBuySide),
            newGamma: newGamma !== undefined ? Number(newGamma) : undefined,
            newMaxCapacity: newMaxCapacity !== undefined ? String(newMaxCapacity) : undefined,
            newFeeTargetBps: newFeeTargetBps !== undefined ? Number(newFeeTargetBps) : undefined,
        })

        return send(res, strategy)
    }),
)

/**
 * GET /api/v1/asymmetric/strategies/:id/logs
 * Get rebalance execution logs for a strategy.
 */
router.get(
    '/strategies/:id/logs',
    handleAsync(async (req, res) => {
        const limit = Math.min(Number(req.query.limit ?? 50), 200)
        const logs = await asymmetricService.getRebalanceLogs(req.params.id, limit)
        return send(res, logs)
    }),
)

// ─── MCP Agent Tool Endpoints ────────────────────────────────────
//
// These endpoints are the MCP-compatible tools that AI agents
// (OpenClaw bots, ALGO_BOT, etc.) use to manage asymmetric strategies.
//
// Tool name mapping:
//   agent_create_asymmetric_strategy  → POST   /agent/create-strategy
//   agent_update_curve_parameters     → POST   /agent/update-curve
//   agent_get_strategy_status         → GET    /agent/strategy-status/:id

/**
 * POST /api/v1/asymmetric/agent/create-strategy
 * MCP Tool: agent_create_asymmetric_strategy
 *
 * Creates a new asymmetric strategy on behalf of the agent's managed wallet.
 * Requires agentId in body (validated against X-Agent-Key header by upstream middleware).
 */
router.post(
    '/agent/create-strategy',
    handleAsync(async (req, res) => {
        const {
            agentId,
            userAddress,
            pairAddress,
            buyK,
            buyGamma,
            buyMaxCapacity,
            buyFeeTargetBps,
            sellGamma,
            sellMaxCapacity,
            sellFeeTargetBps,
            sellProfitTargetBps,
            leverageL,
            allocationC,
        } = req.body

        if (!agentId || !userAddress || !pairAddress || !buyK || !buyGamma || !buyMaxCapacity || !sellGamma || !sellMaxCapacity) {
            return send(res, {
                error: 'Missing required fields: agentId, userAddress, pairAddress, buyK, buyGamma, buyMaxCapacity, sellGamma, sellMaxCapacity',
            }, 400)
        }

        const strategy = await asymmetricService.createStrategy({
            userAddress,
            pairAddress,
            agentId,
            isAutoRebalance: true, // Agents always auto-rebalance
            buyK,
            buyGamma: Number(buyGamma),
            buyMaxCapacity,
            buyFeeTargetBps: buyFeeTargetBps !== undefined ? Number(buyFeeTargetBps) : undefined,
            sellGamma: Number(sellGamma),
            sellMaxCapacity,
            sellFeeTargetBps: sellFeeTargetBps !== undefined ? Number(sellFeeTargetBps) : undefined,
            sellProfitTargetBps: sellProfitTargetBps !== undefined ? Number(sellProfitTargetBps) : undefined,
            leverageL,
            allocationC: allocationC !== undefined ? Number(allocationC) : undefined,
        })

        return send(res, {
            tool: 'agent_create_asymmetric_strategy',
            success: true,
            strategy,
        }, 201)
    }),
)

/**
 * POST /api/v1/asymmetric/agent/update-curve
 * MCP Tool: agent_update_curve_parameters
 *
 * Updates curve parameters for an existing strategy managed by the agent.
 * Body: { agentId, strategyId, userAddress, isBuySide, newGamma?, newMaxCapacity?, newFeeTargetBps? }
 */
router.post(
    '/agent/update-curve',
    handleAsync(async (req, res) => {
        const { agentId, strategyId, userAddress, isBuySide, newGamma, newMaxCapacity, newFeeTargetBps } = req.body

        if (!agentId || !strategyId || !userAddress || isBuySide === undefined) {
            return send(res, {
                error: 'Missing required fields: agentId, strategyId, userAddress, isBuySide',
            }, 400)
        }

        const strategy = await asymmetricService.updateCurveParams(strategyId, userAddress, {
            isBuySide: Boolean(isBuySide),
            newGamma: newGamma !== undefined ? Number(newGamma) : undefined,
            newMaxCapacity: newMaxCapacity !== undefined ? String(newMaxCapacity) : undefined,
            newFeeTargetBps: newFeeTargetBps !== undefined ? Number(newFeeTargetBps) : undefined,
        })

        return send(res, {
            tool: 'agent_update_curve_parameters',
            success: true,
            strategy,
        })
    }),
)

/**
 * GET /api/v1/asymmetric/agent/strategy-status/:id
 * MCP Tool: agent_get_strategy_status
 *
 * Returns full status of an asymmetric strategy, including curve params,
 * rebalance state, and recent logs. Used for agent decision-making.
 */
router.get(
    '/agent/strategy-status/:id',
    handleAsync(async (req, res) => {
        const strategy = await asymmetricService.getStrategy(req.params.id)
        const logs = await asymmetricService.getRebalanceLogs(req.params.id, 10)

        return send(res, {
            tool: 'agent_get_strategy_status',
            success: true,
            strategy,
            recentLogs: logs,
        })
    }),
)

export default router

