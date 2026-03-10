import prisma from '../db'
import type { Request, Response, NextFunction } from 'express'
import { log } from '../utils/logger'

// ─── Types ──────────────────────────────────────────────────────

interface RateBucket {
    count: number
    windowStart: number
}

interface AnomalyFlag {
    agentId: string
    type: 'WASH_TRADE' | 'CIRCULAR_TRADE' | 'SELF_REFERRAL' | 'VELOCITY_SPIKE' | 'PATTERN_REPETITION' | 'COORDINATED_WASH' | 'ORDERBOOK_SPOOFING'
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    description: string
    timestamp: Date
    metadata: Record<string, unknown>
}

// ─── Config ─────────────────────────────────────────────────────

const RATE_LIMITS_PER_TIER: Record<number, { maxPerHour: number; maxPerMinute: number }> = {
    0: { maxPerHour: 10, maxPerMinute: 3 },
    1: { maxPerHour: 100, maxPerMinute: 15 },
    2: { maxPerHour: 500, maxPerMinute: 60 },
    3: { maxPerHour: 2000, maxPerMinute: 200 },
}

const KEY_MAX_AGE_DAYS = 90
const WASH_TRADE_WINDOW_MS = 5 * 60 * 1000
const COORDINATED_WASH_WINDOW_MS = 10 * 60 * 1000
const VELOCITY_SPIKE_THRESHOLD = 3.0
const MAX_ANOMALY_SCORE_BEFORE_SLASH = 100
const SPOOFING_ORDER_SIZE_MULTIPLIER = 5  // order must be 5x avg to count as large
const SPOOFING_CANCEL_WINDOW_MS = 2 * 60 * 1000  // cancel within 2 min of placement
const SPOOFING_CANCEL_COUNT_THRESHOLD = 3  // 3+ large-cancel events triggers flag

// ─── In-Memory Rate Limiter (Sliding Window) ────────────────────

const hourBuckets = new Map<string, RateBucket>()
const minuteBuckets = new Map<string, RateBucket>()
const anomalyScores = new Map<string, number>()

// ─── Cross-Agent Coordinated Wash Registry ──────────────────────
// key: `${pairSymbol}:${normalizedAmount}` → list of {agentId, side, timestamp}
interface CrossAgentTradeEntry { agentId: string; side: string; timestamp: number }
const crossAgentRegistry = new Map<string, CrossAgentTradeEntry[]>()

// ─── Orderbook Spoofing Tracker ─────────────────────────────────
interface PendingLargeOrder { orderId: string; amount: number; placedAt: number }
const pendingLargeOrders = new Map<string, PendingLargeOrder[]>()  // key: agentId
const largeOrderCancelCounts = new Map<string, number>()            // key: agentId

function getRateBucket(buckets: Map<string, RateBucket>, key: string, windowMs: number): RateBucket {
    const now = Date.now()
    const existing = buckets.get(key)

    if (!existing || now - existing.windowStart > windowMs) {
        const bucket = { count: 0, windowStart: now }
        buckets.set(key, bucket)
        return bucket
    }

    return existing
}

function checkRateLimit(agentId: string, tier: number): { allowed: boolean; retryAfterMs?: number } {
    const limits = RATE_LIMITS_PER_TIER[tier] || RATE_LIMITS_PER_TIER[0]

    // Check minute window
    const minuteKey = `min:${agentId}`
    const minuteBucket = getRateBucket(minuteBuckets, minuteKey, 60_000)
    if (minuteBucket.count >= limits.maxPerMinute) {
        const retryAfter = 60_000 - (Date.now() - minuteBucket.windowStart)
        return { allowed: false, retryAfterMs: Math.max(retryAfter, 1000) }
    }

    // Check hour window
    const hourKey = `hr:${agentId}`
    const hourBucket = getRateBucket(hourBuckets, hourKey, 3_600_000)
    if (hourBucket.count >= limits.maxPerHour) {
        const retryAfter = 3_600_000 - (Date.now() - hourBucket.windowStart)
        return { allowed: false, retryAfterMs: Math.max(retryAfter, 1000) }
    }

    minuteBucket.count++
    hourBucket.count++
    return { allowed: true }
}

// ─── Anomaly Detection ──────────────────────────────────────────

const recentTrades = new Map<string, Array<{ pairSymbol: string; side: string; amount: string; timestamp: number }>>()

function recordTradeForAnalysis(agentId: string, trade: { pairSymbol: string; side: string; amount: string }) {
    const trades = recentTrades.get(agentId) || []
    const now = Date.now()

    // Keep only recent trades
    const filtered = trades.filter((t) => now - t.timestamp < WASH_TRADE_WINDOW_MS)
    filtered.push({ ...trade, timestamp: now })
    recentTrades.set(agentId, filtered)
}

// ─── Cross-Agent Coordinated Wash Detection ─────────────────────

function recordCrossAgentTrade(agentId: string, trade: { pairSymbol: string; side: string; amount: string }) {
    const key = `${trade.pairSymbol}:${trade.amount}`
    const now = Date.now()
    const entries = (crossAgentRegistry.get(key) || []).filter((e) => now - e.timestamp < COORDINATED_WASH_WINDOW_MS)
    entries.push({ agentId, side: trade.side, timestamp: now })
    crossAgentRegistry.set(key, entries)
}

function detectCoordinatedWash(agentId: string, trade: { pairSymbol: string; side: string; amount: string }): AnomalyFlag | null {
    const key = `${trade.pairSymbol}:${trade.amount}`
    const now = Date.now()
    const entries = (crossAgentRegistry.get(key) || []).filter((e) => now - e.timestamp < COORDINATED_WASH_WINDOW_MS)

    const oppositeSide = trade.side === 'BUY' ? 'SELL' : 'BUY'
    const counterpart = entries.find((e) => e.agentId !== agentId && e.side === oppositeSide)

    if (!counterpart) return null

    return {
        agentId,
        type: 'COORDINATED_WASH',
        severity: 'CRITICAL',
        description: `Cross-agent coordinated wash trade detected: agent ${agentId} ${trade.side} ${trade.amount} ${trade.pairSymbol} mirrors agent ${counterpart.agentId} ${oppositeSide} within ${COORDINATED_WASH_WINDOW_MS / 1000}s`,
        timestamp: new Date(),
        metadata: { counterpartAgentId: counterpart.agentId, counterpartTimestamp: counterpart.timestamp },
    }
}

// ─── Orderbook Spoofing Tracking ────────────────────────────────

export function recordLargeOrderPlaced(agentId: string, orderId: string, amount: number, recentAvgAmount: number) {
    if (amount < recentAvgAmount * SPOOFING_ORDER_SIZE_MULTIPLIER) return
    const orders = pendingLargeOrders.get(agentId) || []
    orders.push({ orderId, amount, placedAt: Date.now() })
    pendingLargeOrders.set(agentId, orders)
}

export function recordOrderCancelled(agentId: string, orderId: string): AnomalyFlag | null {
    const now = Date.now()
    const orders = pendingLargeOrders.get(agentId) || []
    const idx = orders.findIndex((o) => o.orderId === orderId && now - o.placedAt < SPOOFING_CANCEL_WINDOW_MS)
    if (idx === -1) return null

    orders.splice(idx, 1)
    pendingLargeOrders.set(agentId, orders)

    const count = (largeOrderCancelCounts.get(agentId) || 0) + 1
    largeOrderCancelCounts.set(agentId, count)

    if (count >= SPOOFING_CANCEL_COUNT_THRESHOLD) {
        return {
            agentId,
            type: 'ORDERBOOK_SPOOFING',
            severity: 'HIGH',
            description: `Orderbook spoofing pattern: ${count} large orders cancelled without fill within ${SPOOFING_CANCEL_WINDOW_MS / 1000}s of placement`,
            timestamp: new Date(),
            metadata: { cancelCount: count, orderId },
        }
    }
    return null
}

function detectAnomalies(agentId: string, trade: { pairSymbol: string; side: string; amount: string }): AnomalyFlag[] {
    const flags: AnomalyFlag[] = []
    const trades = recentTrades.get(agentId) || []
    const now = Date.now()

    // 1. Single-agent Wash Trading: Buy + Sell same pair/amount within window
    const matchingSide = trade.side === 'BUY' ? 'SELL' : 'BUY'
    const washMatch = trades.find(
        (t) =>
            t.pairSymbol === trade.pairSymbol &&
            t.side === matchingSide &&
            t.amount === trade.amount &&
            now - t.timestamp < WASH_TRADE_WINDOW_MS,
    )

    if (washMatch) {
        flags.push({
            agentId,
            type: 'WASH_TRADE',
            severity: 'HIGH',
            description: `Potential wash trade: ${trade.side} ${trade.amount} ${trade.pairSymbol} matches opposite ${matchingSide} within ${WASH_TRADE_WINDOW_MS / 1000}s`,
            timestamp: new Date(),
            metadata: { matchedTradeTimestamp: washMatch.timestamp },
        })
    }

    // 2. Cross-agent coordinated wash trading
    const coordinated = detectCoordinatedWash(agentId, trade)
    if (coordinated) flags.push(coordinated)

    // 3. Pattern Repetition: Identical trades >5 times in window
    const identicalCount = trades.filter(
        (t) => t.pairSymbol === trade.pairSymbol && t.side === trade.side && t.amount === trade.amount,
    ).length

    if (identicalCount >= 5) {
        flags.push({
            agentId,
            type: 'PATTERN_REPETITION',
            severity: 'MEDIUM',
            description: `Repeated identical trade ${identicalCount} times: ${trade.side} ${trade.amount} ${trade.pairSymbol}`,
            timestamp: new Date(),
            metadata: { repeatCount: identicalCount },
        })
    }

    // 4. Velocity Spike: Sudden burst of trades
    const recentMinute = trades.filter((t) => now - t.timestamp < 60_000)
    const previousMinute = trades.filter((t) => now - t.timestamp >= 60_000 && now - t.timestamp < 120_000)

    if (previousMinute.length > 0 && recentMinute.length / previousMinute.length > VELOCITY_SPIKE_THRESHOLD) {
        flags.push({
            agentId,
            type: 'VELOCITY_SPIKE',
            severity: 'LOW',
            description: `Trade velocity spiked ${(recentMinute.length / previousMinute.length).toFixed(1)}x (${recentMinute.length} vs ${previousMinute.length} trades/min)`,
            timestamp: new Date(),
            metadata: { currentRate: recentMinute.length, previousRate: previousMinute.length },
        })
    }

    return flags
}

function accumulateAnomalyScore(agentId: string, flags: AnomalyFlag[]): number {
    const severityWeights = { LOW: 1, MEDIUM: 5, HIGH: 20, CRITICAL: 50 }
    const increment = flags.reduce((sum, f) => sum + (severityWeights[f.severity] || 0), 0)
    const current = (anomalyScores.get(agentId) || 0) + increment
    anomalyScores.set(agentId, current)
    return current
}

// ─── API Key Rotation Enforcement ───────────────────────────────

async function checkKeyRotation(agentId: string, keyId: string): Promise<{ needsRotation: boolean; daysUntilExpiry: number }> {
    const key = await prisma.agentApiKey.findFirst({
        where: { id: keyId, agentId, revokedAt: null },
    })

    if (!key) return { needsRotation: false, daysUntilExpiry: 0 }

    const now = new Date()
    const daysUntilExpiry = Math.ceil((key.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    const needsRotation = daysUntilExpiry <= 7

    return { needsRotation, daysUntilExpiry }
}

// ─── Middleware ──────────────────────────────────────────────────

export function botRateLimiter() {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.agent) return next()

        const { allowed, retryAfterMs } = checkRateLimit(req.agent.id, req.agent.stakingTier)
        if (!allowed) {
            res.setHeader('Retry-After', Math.ceil((retryAfterMs || 60_000) / 1000))
            return res.status(429).json({
                error: 'Rate limit exceeded',
                stakingTier: req.agent.stakingTier,
                limits: RATE_LIMITS_PER_TIER[req.agent.stakingTier] || RATE_LIMITS_PER_TIER[0],
                retryAfterMs,
                hint: 'Increase your staking tier for higher limits',
            })
        }

        next()
    }
}

export function botAnomalyGuard() {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.agent) return next()
        if (req.method !== 'POST') return next()

        const trade = req.body
        if (!trade?.pairSymbol || !trade?.side || !trade?.amount) return next()

        recordTradeForAnalysis(req.agent.id, trade)
        recordCrossAgentTrade(req.agent.id, trade)
        const flags = detectAnomalies(req.agent.id, trade)

        if (flags.length > 0) {
            const totalScore = accumulateAnomalyScore(req.agent.id, flags)

            // Log anomalies (in production, persist to DB)
            log.warn({ agentId: req.agent.id, flags: flags.map((f) => `${f.type}(${f.severity})`), totalScore }, '[BotSandbox] Anomaly detected')

            // Auto-slash on critical threshold
            if (totalScore >= MAX_ANOMALY_SCORE_BEFORE_SLASH) {
                try {
                    const { agentService } = await import('../services/agentService')
                    await agentService.slashAgent(
                        req.agent.id,
                        `Automated slash: anomaly score ${totalScore} exceeded threshold ${MAX_ANOMALY_SCORE_BEFORE_SLASH}. Flags: ${flags.map((f) => f.type).join(', ')}`,
                    )
                    return res.status(403).json({
                        error: 'Agent has been slashed due to detected anomalous behavior',
                        anomalyScore: totalScore,
                        flags: flags.map((f) => ({ type: f.type, severity: f.severity, description: f.description })),
                    })
                } catch {
                    // Slash failed — still block the trade
                }
            }

            // Block CRITICAL severity immediately
            const hasCritical = flags.some((f) => f.severity === 'CRITICAL')
            if (hasCritical) {
                return res.status(403).json({
                    error: 'Trade rejected: critical anomaly detected',
                    flags: flags.map((f) => ({ type: f.type, severity: f.severity, description: f.description })),
                })
            }

            // Attach warnings for non-critical
            res.setHeader('X-Anomaly-Warnings', JSON.stringify(flags.map((f) => f.type)))
        }

        next()
    }
}

export function keyRotationWarning() {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.agent) return next()

        const { needsRotation, daysUntilExpiry } = await checkKeyRotation(req.agent.id, req.agent.keyId)
        if (needsRotation) {
            res.setHeader('X-Key-Rotation-Warning', `API key expires in ${daysUntilExpiry} days. Please rotate.`)
        }

        next()
    }
}

// ─── Exports ────────────────────────────────────────────────────

export const botSandbox = {
    checkRateLimit,
    detectAnomalies,
    recordTradeForAnalysis,
    recordCrossAgentTrade,
    recordLargeOrderPlaced,
    recordOrderCancelled,
    accumulateAnomalyScore,
    checkKeyRotation,
    getAnomalyScore: (agentId: string) => anomalyScores.get(agentId) || 0,
    resetAnomalyScore: (agentId: string) => anomalyScores.delete(agentId),
    resetSpoofingCount: (agentId: string) => largeOrderCancelCounts.delete(agentId),
    RATE_LIMITS_PER_TIER,
    KEY_MAX_AGE_DAYS,
    MAX_ANOMALY_SCORE_BEFORE_SLASH,
    SPOOFING_CANCEL_COUNT_THRESHOLD,
    COORDINATED_WASH_WINDOW_MS,
}
