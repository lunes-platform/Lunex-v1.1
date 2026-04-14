// Core SDK types and interfaces

export interface LunexConfig {
  baseURL: string;
  timeout?: number;
  wsURL?: string;
  apiKey?: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  requestId: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  requestId: string;
}

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

export interface Pair {
  address: string;
  token0: Token;
  token1: Token;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  price0: string;
  price1: string;
  volume24h: string;
  volume7d: string;
  fees24h: string;
  tvl: string;
  apr?: string;
  createdAt: string;
}

export interface Quote {
  amountIn: string;
  amountOut: string;
  path: string[];
  priceImpact: string;
  minimumReceived: string;
  fee: string;
  route: RouteStep[];
}

export interface RouteStep {
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
}

export interface TransactionResult {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  status: string;
}

export interface LiquidityParams {
  tokenA: string;
  tokenB: string;
  amountADesired: string;
  amountBDesired: string;
  amountAMin: string;
  amountBMin: string;
  to: string;
  deadline: number;
  gasLimit?: string;
}

export interface RemoveLiquidityParams {
  tokenA: string;
  tokenB: string;
  liquidity: string;
  amountAMin: string;
  amountBMin: string;
  to: string;
  deadline: number;
  gasLimit?: string;
}

export interface SwapExactInParams {
  amountIn: string;
  amountOutMin: string;
  path: string[];
  to: string;
  deadline: number;
  gasLimit?: string;
}

export interface SwapExactOutParams {
  amountOut: string;
  amountInMax: string;
  path: string[];
  to: string;
  deadline: number;
  gasLimit?: string;
}

export type TradingTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
export type StakingTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface StakePosition {
  amount: string;
  startTime: number;
  duration: number;
  endTime: number;
  tier: StakingTier;
  pendingRewards: string;
  claimedRewards: string;
  votingPower: string;
  active: boolean;
  earlyAdopterTier?: string;
  governanceParticipation: number;
}

export interface Proposal {
  id: number;
  name: string;
  description: string;
  tokenAddress: string;
  proposer: string;
  votesFor: string;
  votesAgainst: string;
  votingDeadline: number;
  executed: boolean;
  active: boolean;
  fee: string;
  feeRefunded: boolean;
  createdAt: string;
}

export interface TradingPosition {
  totalVolume: string;
  monthlyVolume: string;
  dailyVolume: string;
  tier: TradingTier;
  multiplier: string;
  pendingRewards: string;
  claimedRewards: string;
  tradeCount: number;
  lastTrade: string;
  nextTierRequirement?: string;
  nextTierMultiplier?: string;
}

export interface FactoryStats {
  totalPairs: number;
  totalVolume24h: string;
  totalVolume7d: string;
  totalLiquidity: string;
  totalFees24h: string;
  feeTo: string;
  feeToSetter: string;
}

export interface StakingStats {
  totalStaked: string;
  totalRewardsDistributed: string;
  activeStakers: number;
  averageAPR: string;
  tierDistribution: Record<StakingTier, number>;
}

export interface RewardsStats {
  rewardsPool: string;
  activeTraders: number;
  totalDistributed: string;
  averageAPR: string;
  tierDistribution: Record<TradingTier, number>;
}

export interface RewardsPoolInfo {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  totalFeesCollected: number;
  rewardPool: number;
  leaderPool: number;
  traderPool: number;
  stakerPool: number;
  treasuryPool: number;
  lpPool: number;
  nextDistribution: string;
  distributedAt: string | null;
  relayerBalance: number | null;
  payoutEnabled: boolean;
  stakerClaimMode: 'on-chain';
  split: {
    rewardPoolPct: number;
    leaderPoolPct: number;
    traderPoolPct: number;
    stakerPoolPct: number;
    splitTotalPct: number;
    splitValid: boolean;
  };
}

export interface RewardHistoryEntry {
  id: string;
  amount: number;
  type: 'LEADER' | 'TRADER';
  rank: number | null;
  claimed: boolean;
  claimedAt: string | null;
  txHash: string | null;
  payoutStatus: string;
  weekStart: string;
  weekEnd: string;
  createdAt: string;
}

export interface PendingRewardsSummary {
  total: number;
  leaderRewards: number;
  traderRewards: number;
  stakerRewards: number;
  stakerClaimMode: 'on-chain';
  entries: Array<{
    id: string;
    amount: number;
    type: 'LEADER' | 'TRADER';
    rank: number | null;
    txHash: string | null;
    payoutStatus: string;
    weekStart: string;
    weekEnd: string;
    createdAt: string;
  }>;
}

export interface RewardClaimResult {
  claimed: boolean;
  message?: string;
  totalAmount?: number;
  rewardsClaimed?: number;
  claimedAt?: string;
}

export interface DistributedRewardWeek {
  id: string;
  weekStart: string;
  weekEnd: string;
  totalFeesCollected: string | number;
  rewardPoolAmount: string | number;
  leaderPoolAmount: string | number;
  traderPoolAmount: string | number;
  stakerPoolAmount: string | number;
  status: string;
  distributedAt: string | null;
  createdAt: string;
  _count?: {
    rewards: number;
  };
  split: {
    rewardPoolPct: number;
    leaderPoolPct: number;
    traderPoolPct: number;
    stakerPoolPct: number;
    splitTotalPct: number;
    splitValid: boolean;
  };
  observability: {
    dbBackedRewardEntries: number;
    leader: {
      entries: number;
      distributedAmount: number;
      expectedPool: number;
      allocationGap: number;
      claimedEntries: number;
      unclaimedEntries: number;
      payoutStatusCounts: Record<string, number>;
    };
    trader: {
      entries: number;
      distributedAmount: number;
      expectedPool: number;
      allocationGap: number;
      claimedEntries: number;
      unclaimedEntries: number;
      payoutStatusCounts: Record<string, number>;
    };
    staker: {
      amount: number;
      claimMode: 'on-chain';
      fundedOnChain: boolean;
    };
  };
}

export interface RewardLeaderRankingEntry {
  id: string;
  address: string;
  name: string;
  username: string;
  isAI: boolean;
  avatar: string;
  roi30d: number;
  winRate: number;
  sharpe: number;
  followers: number;
  aum: string;
  aumRaw: number;
  score: number;
  tags: string[];
  rank: number;
}

export interface RewardTraderRankingEntry {
  address: string;
  volume: number;
  tradeCount: number;
  rank: number;
}

export interface RewardRankingsResponse {
  window: {
    mode: 'current' | 'previous';
    weekStart: string;
    weekEnd: string;
  };
  leaders: RewardLeaderRankingEntry[];
  traders: RewardTraderRankingEntry[];
}

export interface Candle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  liquidity: string;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  volume: string;
  tier: TradingTier;
  rewards: string;
  trades: number;
}

export interface EpochInfo {
  epochId: number;
  startTime: number;
  endTime: number;
  duration: number;
  totalRewards: string;
  activeTraders: number;
  daysRemaining: number;
}

export interface WNativeInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  nativeBalance: string;
  isHealthy: boolean;
}

// WebSocket Event Types
export interface PairCreatedEvent {
  pairAddress: string;
  token0: string;
  token1: string;
  blockNumber: number;
}

export interface LiquidityAddedEvent {
  pairAddress: string;
  provider: string;
  amountA: string;
  amountB: string;
  liquidity: string;
}

export interface SwapExecutedEvent {
  pairAddress: string;
  sender: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
}

export interface ProposalCreatedEvent {
  proposalId: number;
  proposer: string;
  projectName: string;
  tokenAddress: string;
  votingDeadline: number;
}

export interface VoteCastEvent {
  proposalId: number;
  voter: string;
  votePower: string;
  inFavor: boolean;
}

export interface PriceUpdateEvent {
  pairAddress: string;
  price0: string;
  price1: string;
  timestamp: number;
}

// ============================================
// DECIMAL & TOKEN TYPES FOR FRONTEND
// ============================================

/**
 * Token with full decimal information
 */
export interface TokenWithDecimals extends Token {
  /** Formatted balance for display */
  formattedBalance?: string;
  /** Raw balance in smallest unit */
  rawBalance?: string;
  /** USD price */
  priceUSD?: string;
  /** 24h price change */
  priceChange24h?: string;
  /** Whether this is a wrapped native asset */
  isWrapped?: boolean;
  /** Native asset ID if wrapped */
  nativeAssetId?: string;
}

/**
 * Result of decimal conversion
 */
export interface DecimalConversionResult {
  success: boolean;
  originalAmount: string;
  convertedAmount?: string;
  fromDecimals: number;
  toDecimals: number;
  error?: 'OVERFLOW' | 'PRECISION_LOSS' | 'INVALID_DECIMALS';
  /** Digits that would be lost if forced */
  lostDigits?: string;
}

/**
 * Normalized amounts for pair operations
 */
export interface NormalizedAmounts {
  tokenA: {
    address: string;
    symbol: string;
    originalAmount: string;
    normalizedAmount: string;
    decimals: number;
  };
  tokenB: {
    address: string;
    symbol: string;
    originalAmount: string;
    normalizedAmount: string;
    decimals: number;
  };
  targetDecimals: number;
  exchangeRate: string;
}

/**
 * Swap validation result
 */
export interface SwapValidation {
  valid: boolean;
  warnings: string[];
  tokenIn: {
    decimals: number;
    formattedAmount: string;
  };
  tokenOut: {
    decimals: number;
    formattedAmount: string;
  };
}

/**
 * Formatted amount for display
 */
export interface FormattedAmount {
  raw: string;
  formatted: string;
  fullPrecision: string;
  decimals: number;
  symbol?: string;
}

/**
 * User input parsing result
 */
export interface ParsedAmount {
  success: boolean;
  input: string;
  parsed?: string;
  decimals: number;
  error?: string;
}

/**
 * Pool with full token info including decimals
 */
export interface PoolWithDecimals extends Pair {
  token0Decimals: number;
  token1Decimals: number;
  /** Formatted reserves for display */
  formattedReserve0: string;
  formattedReserve1: string;
  /** Price with proper decimal handling */
  spotPrice: string;
  /** Inverse price */
  inversePrice: string;
}

/**
 * Trade preview with decimal-aware calculations
 */
export interface TradePreview {
  tokenIn: TokenWithDecimals;
  tokenOut: TokenWithDecimals;
  amountIn: FormattedAmount;
  amountOut: FormattedAmount;
  minimumReceived: FormattedAmount;
  priceImpact: string;
  fee: FormattedAmount;
  route: RouteStep[];
  /** Warnings about decimal issues */
  warnings: string[];
  /** Whether trade is safe to execute */
  isSafe: boolean;
}

/**
 * Liquidity preview with decimal-aware calculations
 */
export interface LiquidityPreview {
  tokenA: TokenWithDecimals;
  tokenB: TokenWithDecimals;
  amountA: FormattedAmount;
  amountB: FormattedAmount;
  liquidityMinted: FormattedAmount;
  shareOfPool: string;
  /** Current pool info */
  pool?: PoolWithDecimals;
  /** Warnings about decimal issues */
  warnings: string[];
}

/**
 * User balance with formatting
 */
export interface UserBalance {
  token: TokenWithDecimals;
  balance: string;
  formattedBalance: string;
  valueUSD: string;
}

/**
 * Portfolio summary
 */
export interface PortfolioSummary {
  balances: UserBalance[];
  totalValueUSD: string;
  change24h: string;
  change24hPercent: string;
}

/**
 * Known token decimals registry response
 */
export interface TokenDecimalsRegistry {
  [symbol: string]: number;
}

/**
 * Native asset info (for Lunes blockchain)
 */
export interface NativeAssetInfo {
  assetId: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  /** Wrapper contract address if exists */
  wrapperAddress?: string;
  /** Whether wrapping is available */
  canWrap: boolean;
}

/**
 * Wrap/Unwrap operation params
 */
export interface WrapParams {
  assetId: string;
  amount: string;
  recipient?: string;
}

export interface UnwrapParams {
  wrapperAddress: string;
  amount: string;
  recipient?: string;
}
