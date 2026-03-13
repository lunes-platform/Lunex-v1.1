import { randomBytes, createHash } from 'crypto'
import prisma from '../db'
import type { AgentType, AgentApiKeyPermission, Prisma, Agent, Leader } from '@prisma/client'

// ─── Staking Tiers ──────────────────────────────────────────────

interface StakingTier {
    minStake: number
    dailyTradeLimit: number
    maxPositionSize: number
    maxOpenOrders: number
}

const STAKING_TIERS: StakingTier[] = [
    { minStake: 0, dailyTradeLimit: 10, maxPositionSize: 100, maxOpenOrders: 5 },
    { minStake: 100, dailyTradeLimit: 100, maxPositionSize: 1_000, maxOpenOrders: 20 },
    { minStake: 1_000, dailyTradeLimit: 500, maxPositionSize: 10_000, maxOpenOrders: 50 },
    { minStake: 10_000, dailyTradeLimit: 2_000, maxPositionSize: 100_000, maxOpenOrders: 200 },
]

function resolveTier(stakedAmount: number): { tier: number; limits: StakingTier } {
    let tier = 0
    for (let i = STAKING_TIERS.length - 1; i >= 0; i--) {
        if (stakedAmount >= STAKING_TIERS[i].minStake) {
            tier = i
            break
        }
    }
    return { tier, limits: STAKING_TIERS[tier] }
}

// ─── API Key Helpers ────────────────────────────────────────────

function generateApiKey(): { raw: string; prefix: string; hash: string } {
    const raw = `lnx_${randomBytes(32).toString('hex')}`
    const prefix = raw.slice(0, 8)
    const hash = createHash('sha256').update(raw).digest('hex')
    return { raw, prefix, hash }
}

function hashApiKey(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
}

// ─── Service ────────────────────────────────────────────────────

export const agentService = {
    async registerAgent(input: {
        walletAddress: string
        agentType: AgentType
        framework?: string
        strategyDescription?: string
        linkLeaderId?: string
    }) {
        const existing = await prisma.agent.findUnique({
            where: { walletAddress: input.walletAddress },
        })
        if (existing) {
            throw new Error('Agent already registered with this wallet address')
        }

        const agent = await prisma.agent.create({
            data: {
                walletAddress: input.walletAddress,
                agentType: input.agentType,
                framework: input.framework || null,
                strategyDescription: input.strategyDescription || null,
                leaderId: input.linkLeaderId || null,
            },
            include: { leader: true },
        })

        return formatAgent(agent)
    },

    async createApiKey(agentId: string, input: {
        label?: string
        permissions: AgentApiKeyPermission[]
        expiresInDays?: number
    }) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId } })
        if (!agent) throw new Error('Agent not found')
        if (agent.isBanned) throw new Error('Agent is banned')

        const activeKeys = await prisma.agentApiKey.count({
            where: { agentId, revokedAt: null, expiresAt: { gt: new Date() } },
        })
        if (activeKeys >= 5) {
            throw new Error('Maximum 5 active API keys per agent')
        }

        const { raw, prefix, hash } = generateApiKey()
        const expiresInDays = input.expiresInDays ?? 90
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

        const apiKey = await prisma.agentApiKey.create({
            data: {
                agentId,
                label: input.label ?? 'default',
                keyPrefix: prefix,
                keyHash: hash,
                permissions: input.permissions,
                expiresAt,
            },
        })

        return {
            id: apiKey.id,
            key: raw,
            prefix,
            label: apiKey.label,
            permissions: apiKey.permissions,
            expiresAt: apiKey.expiresAt.toISOString(),
        }
    },

    async revokeApiKey(agentId: string, keyId: string) {
        const key = await prisma.agentApiKey.findFirst({
            where: { id: keyId, agentId, revokedAt: null },
        })
        if (!key) throw new Error('API key not found or already revoked')

        await prisma.agentApiKey.update({
            where: { id: keyId },
            data: { revokedAt: new Date() },
        })
    },

    async verifyApiKey(rawKey: string) {
        const hash = hashApiKey(rawKey)
        const key = await prisma.agentApiKey.findUnique({
            where: { keyHash: hash },
            include: { agent: true },
        })

        if (!key) return null
        if (key.revokedAt) return null
        if (key.expiresAt < new Date()) return null
        if (!key.agent.isActive || key.agent.isBanned) return null

        await prisma.agentApiKey.update({
            where: { id: key.id },
            data: { lastUsedAt: new Date() },
        })

        return {
            agent: key.agent,
            permissions: key.permissions,
            keyId: key.id,
        }
    },

    async getAgentProfile(agentId: string) {
        const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            include: { leader: true, stakes: { where: { status: 'STAKED' } } },
        })
        if (!agent) throw new Error('Agent not found')
        return formatAgent(agent)
    },

    async getAgentByWallet(walletAddress: string) {
        const agent = await prisma.agent.findUnique({
            where: { walletAddress },
            include: { leader: true, stakes: { where: { status: 'STAKED' } } },
        })
        if (!agent) return null
        return formatAgent(agent)
    },

    async listAgents(filters: {
        agentType?: AgentType
        isActive?: boolean
        sortBy?: 'totalTrades' | 'totalVolume' | 'stakedAmount' | 'createdAt'
        limit?: number
        offset?: number
    }) {
        const where: Prisma.AgentWhereInput = {}
        if (filters.agentType) where.agentType = filters.agentType
        if (filters.isActive !== undefined) where.isActive = filters.isActive
        where.isBanned = false

        const orderBy: Prisma.AgentOrderByWithRelationInput =
            filters.sortBy === 'totalTrades' ? { totalTrades: 'desc' }
                : filters.sortBy === 'totalVolume' ? { totalVolume: 'desc' }
                    : filters.sortBy === 'stakedAmount' ? { stakedAmount: 'desc' }
                        : { createdAt: 'desc' }

        const [agents, total] = await Promise.all([
            prisma.agent.findMany({
                where,
                orderBy,
                take: filters.limit ?? 20,
                skip: filters.offset ?? 0,
                include: { leader: true },
            }),
            prisma.agent.count({ where }),
        ])

        return {
            agents: agents.map(formatAgent),
            total,
        }
    },

    async recordStake(agentId: string, input: {
        amount: number
        token?: string
        txHash: string   // required — must be a real on-chain tx hash
    }) {
        if (!input.txHash || input.txHash.trim() === '') {
            throw new Error('txHash is required to record a stake — on-chain proof must be provided')
        }
        if (input.amount <= 0) {
            throw new Error('Stake amount must be positive')
        }

        const agent = await prisma.agent.findUnique({ where: { id: agentId } })
        if (!agent) throw new Error('Agent not found')

        // Reject duplicate txHash — prevents the same tx from being submitted twice
        const duplicate = await prisma.agentStake.findFirst({ where: { txHash: input.txHash } })
        if (duplicate) {
            throw new Error('Duplicate txHash — this transaction has already been recorded')
        }

        // Create stake in PENDING_VERIFICATION — tier upgrade only happens after verifyStake()
        const stake = await prisma.agentStake.create({
            data: {
                agentId,
                amount: input.amount,
                token: input.token ?? 'LUNES',
                txHash: input.txHash,
                status: 'PENDING_VERIFICATION',
            },
        })

        // Do NOT credit tier yet — tier is upgraded only by verifyStake() after on-chain check
        return {
            stakeId: stake.id,
            status: 'PENDING_VERIFICATION',
            message: 'Stake submitted. Tier upgrade pending on-chain verification.',
        }
    },

    /**
     * Confirm a stake after on-chain verification succeeds (called by admin/relayer).
     * Only THEN does the agent's tier upgrade take effect.
     */
    async verifyStake(stakeId: string) {
        const stake = await prisma.agentStake.findUnique({
            where: { id: stakeId },
            include: { agent: true },
        })
        if (!stake) throw new Error('Stake not found')
        if (stake.status !== 'PENDING_VERIFICATION') {
            throw new Error(`Stake is already in status ${stake.status}`)
        }

        const newTotal = parseFloat(stake.agent.stakedAmount.toString()) + parseFloat(stake.amount.toString())
        const { tier, limits } = resolveTier(newTotal)

        await prisma.$transaction([
            prisma.agentStake.update({
                where: { id: stakeId },
                data: { status: 'STAKED' },
            }),
            prisma.agent.update({
                where: { id: stake.agentId },
                data: {
                    stakedAmount: newTotal,
                    stakingTier: tier,
                    dailyTradeLimit: limits.dailyTradeLimit,
                    maxPositionSize: limits.maxPositionSize,
                    maxOpenOrders: limits.maxOpenOrders,
                },
            }),
        ])

        return { stakeId, newStakedAmount: newTotal, tier, limits }
    },

    async slashAgent(agentId: string, reason: string) {
        const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            include: { stakes: { where: { status: 'STAKED' } } },
        })
        if (!agent) throw new Error('Agent not found')

        await prisma.$transaction([
            ...agent.stakes.map((stake) =>
                prisma.agentStake.update({
                    where: { id: stake.id },
                    data: { status: 'SLASHED', slashedAt: new Date(), slashReason: reason },
                }),
            ),
            prisma.agent.update({
                where: { id: agentId },
                data: {
                    stakedAmount: 0,
                    stakingTier: 0,
                    dailyTradeLimit: STAKING_TIERS[0].dailyTradeLimit,
                    maxPositionSize: STAKING_TIERS[0].maxPositionSize,
                    maxOpenOrders: STAKING_TIERS[0].maxOpenOrders,
                    isBanned: true,
                    banReason: reason,
                },
            }),
        ])
    },

    async getApiKeys(agentId: string) {
        const keys = await prisma.agentApiKey.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
        })
        return keys.map((k) => ({
            id: k.id,
            label: k.label,
            prefix: k.keyPrefix,
            permissions: k.permissions,
            expiresAt: k.expiresAt.toISOString(),
            revokedAt: k.revokedAt?.toISOString() || null,
            lastUsedAt: k.lastUsedAt?.toISOString() || null,
            createdAt: k.createdAt.toISOString(),
            isActive: !k.revokedAt && k.expiresAt > new Date(),
        }))
    },

    STAKING_TIERS,
}

// ─── Formatters ─────────────────────────────────────────────────

type AgentWithRelations = Agent & {
    leader?: Leader | null
    stakes?: { id: string }[]
}

function formatAgent(agent: AgentWithRelations) {
    const { tier, limits } = resolveTier(parseFloat(agent.stakedAmount?.toString() ?? '0'))
    return {
        id: agent.id,
        walletAddress: agent.walletAddress,
        agentType: agent.agentType,
        framework: agent.framework,
        strategyDescription: agent.strategyDescription,
        isActive: agent.isActive,
        isBanned: agent.isBanned,
        stakingTier: tier,
        stakedAmount: parseFloat(agent.stakedAmount?.toString() ?? '0'),
        tradingLimits: {
            dailyTradeLimit: limits.dailyTradeLimit,
            maxPositionSize: limits.maxPositionSize,
            maxOpenOrders: limits.maxOpenOrders,
        },
        totalTrades: agent.totalTrades,
        totalVolume: parseFloat(agent.totalVolume?.toString() ?? '0'),
        lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
        leader: agent.leader
            ? {
                id: agent.leader.id,
                name: agent.leader.name,
                username: agent.leader.username,
                avatar: agent.leader.avatar,
                roi30d: parseFloat(agent.leader.roi30d?.toString() ?? '0'),
                followers: agent.leader.followersCount,
            }
            : null,
    }
}
