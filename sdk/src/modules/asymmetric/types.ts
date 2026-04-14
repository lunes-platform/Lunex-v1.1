// ─── Asymmetric Liquidity V2 Types ─────────────────────────────

/**
 * Parameters that define one side (buy or sell) of an asymmetric curve.
 * All amounts are strings to avoid floating-point precision issues (plancks × 10^8).
 */
export interface CurveParameters {
  /** Base liquidity (k), in plancks scaled by 10^8 */
  k: string;
  /** Borrowed leverage amount (links to MarginAccount) */
  leverageL: string;
  /** Fraction of leverage allocated to this curve (0–1) */
  allocationC: number;
  /** Maximum volume this curve operates on, in plancks */
  maxCapacityX0: string;
  /** Curvature exponent γ (integer 1–5). 1 = linear, 5 = highly exponential */
  gamma: number;
  /** Fee target in basis points (e.g. 30 = 0.30%) */
  feeTargetBps: number;
}

/**
 * Full configuration for creating a new asymmetric strategy.
 */
export interface AsymmetricStrategyConfig {
  /** Address of the AsymmetricPair ink! 4.x contract */
  pairAddress: string;
  /** Whether the backend Sentinel Worker should auto-rebalance this strategy */
  isAutoRebalance: boolean;
  /** Buy-side parametric curve */
  buyCurve: CurveParameters;
  /** Sell-side parametric curve */
  sellCurve: CurveParameters;
  /** Profit threshold in bps that triggers rebalance from buy to sell (e.g. 500 = 5%) */
  profitTargetBps: number;
}

/**
 * Operational state of a strategy as returned by the backend Sentinel.
 */
export type StrategyHealthState =
  | 'ACTIVE'
  | 'COOLING_DOWN'
  | 'SUSPENDED_ERROR'
  | 'PAUSED';

export interface StrategyCurveStatus {
  gamma: number;
  maxCapacity: string;
  feeTargetBps: number;
  baseLiquidity?: string;
  profitTargetBps?: number;
}

export interface StrategyPersistedConfig {
  strategyId: string;
  userAddress: string;
  pairAddress: string;
  agentId: string | null;
  status: StrategyHealthState;
  isAutoRebalance: boolean;
  pendingRebalanceAmount: string;
  lastRebalancedAt: string | Date | null;
  retryCount: number;
  lastError: string | null;
  buyCurve: StrategyCurveStatus;
  sellCurve: StrategyCurveStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface StrategyLiveCurveState {
  k: number;
  gamma: number;
  maxCapacity: number;
  feeBps: number;
  currentVolume: number;
}

export interface StrategyLiveState {
  available: boolean;
  reason: string | null;
  source: 'on-chain' | 'unavailable';
  checkedAt: string;
  managerAddress: string | null;
  relayerAddress: string | null;
  delegatedToRelayer: boolean;
  buyCurve: StrategyLiveCurveState | null;
  sellCurve: StrategyLiveCurveState | null;
}

export interface StrategyDelegationStatus {
  agentManaged: boolean;
  agentId: string | null;
  walletAddress: string;
  requiredScope: 'MANAGE_ASYMMETRIC';
  managerAddress: string | null;
  relayerAddress: string | null;
  delegatedToRelayer: boolean;
  checkedAt: string;
}

/**
 * Current status and health metrics of a deployed asymmetric strategy.
 */
export interface StrategyStatus {
  id: string;
  userAddress: string;
  pairAddress: string;
  agentId: string | null;
  status: StrategyHealthState;
  isAutoRebalance: boolean;
  /** Amount accumulated by the Sentinel while cooling down (plancks string) */
  pendingRebalanceAmount: string;
  lastRebalancedAt: string | Date | null;
  buyCurve: StrategyCurveStatus;
  sellCurve: StrategyCurveStatus;
  retryCount: number;
  lastError: string | null;
  /** Is this strategy managed by an external AI agent (vs backend Sentinel)? */
  agentManaged: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;

  // Backward-compatible aliases
  isActive?: boolean;
  healthState?: StrategyHealthState;

  // Additive canonical status fields
  persistedConfig?: StrategyPersistedConfig;
  liveState?: StrategyLiveState;
  delegation?: StrategyDelegationStatus;
}

/**
 * Input for updating curve parameters via agent or manual call.
 * Cannot move funds — only reshapes the parametric curve.
 */
export interface UpdateCurveInput {
  strategyId: string;
  pairAddress: string;
  /** true = update buy curve, false = update sell curve */
  isBuySide: boolean;
  /** New curvature (1–5) */
  newGamma?: number;
  /** New maximum capacity (plancks string) */
  newMaxCapacityX0?: string;
  /** New fee in basis points */
  newFeeTargetBps?: number;
}
