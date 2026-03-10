import type { Request, Response, NextFunction } from 'express'
import { agentService } from '../services/agentService'
import type { AgentApiKeyPermission } from '@prisma/client'

// Extend Express Request to include agent context
declare global {
    namespace Express {
        interface Request {
            agent?: {
                id: string
                walletAddress: string
                agentType: string
                permissions: AgentApiKeyPermission[]
                keyId: string
                stakingTier: number
                dailyTradeLimit: number
                maxPositionSize: number
                maxOpenOrders: number
            }
        }
    }
}

/**
 * Middleware that verifies API key from X-API-Key header.
 * Attaches agent context to req.agent if valid.
 */
export function agentAuth(requiredPermissions?: AgentApiKeyPermission[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const apiKey = req.headers['x-api-key'] as string | undefined

        if (!apiKey) {
            return res.status(401).json({ error: 'Missing X-API-Key header' })
        }

        try {
            const result = await agentService.verifyApiKey(apiKey)

            if (!result) {
                return res.status(401).json({ error: 'Invalid or expired API key' })
            }

            // Check required permissions
            if (requiredPermissions?.length) {
                const hasAll = requiredPermissions.every((p) => result.permissions.includes(p))
                if (!hasAll) {
                    return res.status(403).json({
                        error: 'Insufficient permissions',
                        required: requiredPermissions,
                        granted: result.permissions,
                    })
                }
            }

            req.agent = {
                id: result.agent.id,
                walletAddress: result.agent.walletAddress,
                agentType: result.agent.agentType,
                permissions: result.permissions,
                keyId: result.keyId,
                stakingTier: result.agent.stakingTier,
                dailyTradeLimit: result.agent.dailyTradeLimit,
                maxPositionSize: parseFloat(result.agent.maxPositionSize.toString()),
                maxOpenOrders: result.agent.maxOpenOrders,
            }

            next()
        } catch (err) {
            return res.status(500).json({ error: 'Authentication failed' })
        }
    }
}

/**
 * Optional agent auth — does not reject if no API key is present.
 * Useful for routes that support both wallet and API key auth.
 */
export function optionalAgentAuth() {
    return async (req: Request, _res: Response, next: NextFunction) => {
        const apiKey = req.headers['x-api-key'] as string | undefined
        if (!apiKey) return next()

        try {
            const result = await agentService.verifyApiKey(apiKey)
            if (result) {
                req.agent = {
                    id: result.agent.id,
                    walletAddress: result.agent.walletAddress,
                    agentType: result.agent.agentType,
                    permissions: result.permissions,
                    keyId: result.keyId,
                    stakingTier: result.agent.stakingTier,
                    dailyTradeLimit: result.agent.dailyTradeLimit,
                    maxPositionSize: parseFloat(result.agent.maxPositionSize.toString()),
                    maxOpenOrders: result.agent.maxOpenOrders,
                }
            }
        } catch {
            // Silently continue without agent context
        }

        next()
    }
}
