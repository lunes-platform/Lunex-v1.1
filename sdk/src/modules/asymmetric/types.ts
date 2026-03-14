// ─── Asymmetric Liquidity V2 Types ─────────────────────────────

/**
 * Parameters that define one side (buy or sell) of an asymmetric curve.
 * All amounts are strings to avoid floating-point precision issues (plancks × 10^8).
 */
export interface CurveParameters {
    /** Base liquidity (k), in plancks scaled by 10^8 */
    k: string
    /** Borrowed leverage amount (links to MarginAccount) */
    leverageL: string
    /** Fraction of leverage allocated to this curve (0–1) */
    allocationC: number
    /** Maximum volume this curve operates on, in plancks */
    maxCapacityX0: string
    /** Curvature exponent γ (integer 1–5). 1 = linear, 5 = highly exponential */
    gamma: number
    /** Fee target in basis points (e.g. 30 = 0.30%) */
    feeTargetBps: number
}

/**
 * Full configuration for creating a new asymmetric strategy.
 */
export interface AsymmetricStrategyConfig {
    /** Address of the AsymmetricPair ink! 4.x contract */
    pairAddress: string
    /** Whether the backend Sentinel Worker should auto-rebalance this strategy */
    isAutoRebalance: boolean
    /** Buy-side parametric curve */
    buyCurve: CurveParameters
    /** Sell-side parametric curve */
    sellCurve: CurveParameters
    /** Profit threshold in bps that triggers rebalance from buy to sell (e.g. 500 = 5%) */
    profitTargetBps: number
}

/**
 * Operational state of a strategy as returned by the backend Sentinel.
 */
export type StrategyHealthState = 'ACTIVE' | 'COOLING_DOWN' | 'SUSPENDED_ERROR' | 'PAUSED'

/**
 * Current status and health metrics of a deployed asymmetric strategy.
 */
export interface StrategyStatus {
    id: string
    isActive: boolean
    /** Amount accumulated by the Sentinel while cooling down (plancks string) */
    pendingRebalanceAmount: string
    lastRebalancedAt: Date | null
    healthState: StrategyHealthState
    /** Is this strategy managed by an external AI agent (vs backend Sentinel)? */
    agentManaged: boolean
}

/**
 * Input for updating curve parameters via agent or manual call.
 * Cannot move funds — only reshapes the parametric curve.
 */
export interface UpdateCurveInput {
    strategyId: string
    pairAddress: string
    /** true = update buy curve, false = update sell curve */
    isBuySide: boolean
    /** New curvature (1–5) */
    newGamma?: number
    /** New maximum capacity (plancks string) */
    newMaxCapacityX0?: string
    /** New fee in basis points */
    newFeeTargetBps?: number
}
