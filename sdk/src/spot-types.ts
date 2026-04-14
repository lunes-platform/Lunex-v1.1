export type NumericValue = string | number;
export type SpotOrderSide = 'BUY' | 'SELL';
export type SpotOrderType = 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
export type SpotOrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
export type SpotTimeInForce = 'GTC' | 'IOC' | 'FOK';
export type TradeSettlementStatus =
  | 'PENDING'
  | 'SETTLING'
  | 'SETTLED'
  | 'FAILED'
  | 'SKIPPED';
export type CopytradeActivityType = 'DEPOSIT' | 'WITHDRAWAL' | 'SIGNAL';

export interface MarginPriceHealthSummary {
  trackedPairs: number;
  healthyPairs: number;
  unhealthyPairs: number;
  hasActiveAlerts: boolean;
  blockedPairs: number;
  operationalBlockAfterFailures: number;
}

export interface MarginPriceHealthPairState {
  pairSymbol: string;
  status: 'HEALTHY' | 'UNHEALTHY';
  isOperationallyBlocked: boolean;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  lastResolvedSource: 'LAST_TRADE' | 'BOOK_MID' | null;
  lastResolvedObservedAt: string | null;
  lastResolvedAgeMs: number | null;
  lastResolvedPrice: number | null;
}

export interface MarginPriceHealthSnapshot {
  generatedAt: string;
  summary: MarginPriceHealthSummary;
  pairs: MarginPriceHealthPairState[];
}

export interface SpotApiHealth {
  status: string;
  timestamp: string;
  marginPriceHealth: MarginPriceHealthSummary;
}

export interface SpotPair {
  id: string;
  symbol: string;
  baseToken: string;
  quoteToken: string;
  baseName: string;
  quoteName: string;
  baseDecimals: number;
  quoteDecimals: number;
  isNativeBase: boolean;
  isNativeQuote: boolean;
  isActive: boolean;
  makerFeeBps: number;
  takerFeeBps: number;
  createdAt: string;
}

export interface SpotTicker {
  symbol: string;
  lastPrice: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  change24h: number;
  tradeCount: number;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
}

export interface OrderbookLevel {
  price: number;
  amount: number;
  total: number;
}

export interface SpotOrderbookSnapshot {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
}

export interface SpotTrade {
  id: string;
  pairId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerAddress: string;
  takerAddress: string;
  side: string;
  price: NumericValue;
  amount: NumericValue;
  quoteAmount: NumericValue;
  makerFee: NumericValue;
  takerFee: NumericValue;
  settlementStatus: TradeSettlementStatus;
  settlementAttempts: number;
  settlementPayload?: Record<string, unknown> | null;
  settlementError?: string | null;
  lastSettlementAttemptAt?: string | null;
  nextSettlementRetryAt?: string | null;
  txHash?: string | null;
  settledAt?: string | null;
  createdAt: string;
  pair?: {
    symbol: string;
  };
}

export interface SpotCandle {
  id: string;
  pairId: string;
  timeframe: string;
  openTime: string;
  open: NumericValue;
  high: NumericValue;
  low: NumericValue;
  close: NumericValue;
  volume: NumericValue;
  quoteVolume: NumericValue;
  tradeCount: number;
}

export interface SpotOrder {
  id: string;
  pairId: string;
  makerAddress: string;
  side: string;
  type: string;
  price: NumericValue;
  stopPrice?: NumericValue | null;
  amount: NumericValue;
  filledAmount: NumericValue;
  remainingAmount: NumericValue;
  status: string;
  signature: string;
  nonce: string;
  orderHash: string;
  timeInForce: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  pair?: {
    symbol: string;
  };
}

export interface CreateSpotOrderInput {
  pairSymbol: string;
  side: SpotOrderSide;
  type: SpotOrderType;
  amount: string;
  nonce: string;
  timestamp: number;
  signature: string;
  makerAddress: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: SpotTimeInForce;
  expiresAt?: string;
}

export interface CancelSpotOrderInput {
  makerAddress: string;
  signature: string;
}

export interface PrepareSignedSpotOrderInput {
  pairSymbol: string;
  side: SpotOrderSide;
  type: SpotOrderType;
  amount: string;
  makerAddress: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: SpotTimeInForce;
  expiresAt?: string;
  nonce?: string;
  timestamp?: number;
  signMessage: (message: string) => Promise<string>;
}

export interface PrepareSignedCancelOrderInput {
  orderId: string;
  makerAddress: string;
  signMessage: (message: string) => Promise<string>;
}

export interface SocialStats {
  totalAum: number;
  activeTraders: number;
  aiAgents: number;
  totalFollowers: number;
  totalIdeas: number;
  totalVaultEquity: number;
}

export interface SocialLeaderVault {
  id: string;
  collateralToken: string;
  status: string;
  minDeposit: number;
  totalEquity: number;
  totalShares: number;
  totalDeposits: number;
  totalWithdrawals: number;
  twapThreshold: number;
  maxSlippageBps: number;
}

export interface SocialLeaderTrade {
  date: string;
  pair: string;
  side: 'Buy' | 'Sell';
  entry: number;
  exit: number;
  pnl: number;
  status: 'Closed' | 'Open';
}

export interface SocialIdeaLeader {
  id: string;
  name: string;
  username: string;
  isAI: boolean;
}

export interface SocialIdea {
  id: string;
  title: string;
  description: string;
  pair: string;
  direction: 'Bullish' | 'Bearish';
  likes: number;
  comments: number;
  date: string;
  tags: string[];
  leader?: SocialIdeaLeader;
}

export interface SocialLeader {
  id: string;
  rank?: number;
  name: string;
  username: string;
  address: string;
  avatar: string;
  isAI: boolean;
  isVerified: boolean;
  bio: string;
  memberSince: string;
  roi30d: number;
  roi90d: number;
  aum: string;
  drawdown: number;
  followers: number;
  winRate: number;
  avgProfit: number;
  sharpe: number;
  fee: number;
  pnlHistory: number[];
  tags: string[];
  isFollowing?: boolean;
  vault?: SocialLeaderVault | null;
  trades?: SocialLeaderTrade[];
  ideas?: SocialIdea[];
}

export interface SocialFollowResult {
  followed: boolean;
  alreadyFollowing: boolean;
}

export interface WalletActionSignaturePayload {
  nonce: string;
  timestamp: number;
  signature: string;
}

export interface SocialSignedAddressActionInput extends WalletActionSignaturePayload {
  address: string;
}

export interface SocialSignedCommentInput extends SocialSignedAddressActionInput {
  content: string;
}

export interface SocialSignedProfileInput extends WalletActionSignaturePayload {
  address: string;
  name: string;
  username: string;
  bio: string;
  avatar?: string;
  fee: number;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
}

export interface SocialIdeaLikeResult {
  liked: boolean;
  alreadyLiked: boolean;
  likes: number;
}

export interface SocialIdeaComment {
  id: string;
  address: string;
  content: string;
  createdAt: string;
}

export interface CopytradeVaultLeader {
  id: string;
  name: string;
  username: string;
  isAI?: boolean;
  isVerified?: boolean;
  fee?: number;
  followers?: number;
  aum?: number;
  address?: string;
  performanceFee?: number;
}

export interface CopytradeVaultSummary {
  id: string;
  leaderId: string;
  name: string;
  collateralToken: string;
  status: string;
  totalEquity: number;
  totalShares: number;
  totalDeposits: number;
  totalWithdrawals: number;
  minDeposit: number;
  twapThreshold: number;
  maxSlippageBps: number;
  leader: CopytradeVaultLeader;
}

export interface CopytradeVaultPositionSummary {
  id: string;
  followerAddress: string;
  shareBalance: number;
  estimatedValue: number;
  netDeposited: number;
  totalWithdrawn: number;
  highWaterMarkValue: number;
  feePaid: number;
  realizedPnl: number;
}

export interface CopytradeVaultDetails extends CopytradeVaultSummary {
  leader: CopytradeVaultLeader;
  positions: CopytradeVaultPositionSummary[];
}

export interface CopytradeFollowerVaultInfo {
  id: string;
  name: string;
  collateralToken: string;
  leaderId: string;
  leaderName: string;
  leaderUsername: string;
}

export interface CopytradePosition {
  id: string;
  followerAddress: string;
  shareBalance: number;
  currentValue: number;
  netDeposited: number;
  totalWithdrawn: number;
  highWaterMarkValue: number;
  feePaid: number;
  realizedPnl: number;
  vault: CopytradeFollowerVaultInfo;
}

export interface CopytradeDepositResult {
  depositId: string;
  sharesMinted: number;
  amount: number;
  positionId: string;
  txHash: string | null;
  executionMode: 'db-journal' | 'on-chain-confirmed';
}

export interface CopytradeSignedDepositInput extends WalletActionSignaturePayload {
  followerAddress: string;
  token: string;
  amount: string;
}

export interface CopytradeWithdrawResult {
  withdrawalId: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  profitAmount: number;
  remainingShares: number;
  collateralToken?: string;
  followerAddress?: string;
  txHash: string | null;
  executionMode: 'db-journal' | 'on-chain-confirmed';
}

export interface CopytradeSignedWithdrawInput extends WalletActionSignaturePayload {
  followerAddress: string;
  shares: string;
}

export interface CopytradeExecution {
  id: string;
  pairSymbol: string;
  side: string;
  positionEffect?: 'OPEN' | 'CLOSE';
  sliceIndex: number;
  totalSlices: number;
  amountIn: number;
  amountOut: number;
  executionPrice: number;
  realizedPnl?: number;
  slippageBps: number | null;
  status: string;
  strategyTag?: string | null;
  createdAt: string;
}

export interface CopytradeActivity {
  type: CopytradeActivityType;
  createdAt: string;
  leaderId: string;
  leaderName: string;
  followerAddress?: string;
  amount?: number;
  token?: string;
  grossAmount?: number;
  feeAmount?: number;
  netAmount?: number;
  pairSymbol?: string;
  side?: string;
  positionEffect?: 'OPEN' | 'CLOSE';
  amountIn?: number;
  executionPrice?: number;
  realizedPnlPct?: number;
  slices?: number;
}

export interface CopytradeApiKeyChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface CopytradeApiKeyResult {
  apiKey: string;
  allowApiTrading: boolean;
}

export interface CreateCopytradeSignalInput {
  leaderId?: string;
  leaderAddress?: string;
  pairSymbol: string;
  side: SpotOrderSide;
  positionEffect?: 'AUTO' | 'OPEN' | 'CLOSE';
  signalMode?: 'AUTO' | 'JOURNAL' | 'EXECUTE_VAULT';
  source?: 'API' | 'WEB3';
  strategyTag?: string;
  amountIn: string;
  amountOutMin: string;
  route?: string[];
  maxSlippageBps?: number;
  executionPrice?: string;
  realizedPnlPct?: string; // deprecated: ignored for execution semantics
  nonce?: string;
  timestamp?: number;
  signature?: string;
}

export interface CopytradeSignalSlice {
  id: string;
  sliceIndex: number;
  totalSlices: number;
  amountIn: number;
  amountOut: number;
  executionPrice: number;
  realizedPnl: number;
}

export interface CopytradeSignalResult {
  signalId: string;
  pairSymbol: string;
  side: string;
  positionEffect: 'OPEN' | 'CLOSE';
  signalModeResolved: 'JOURNAL' | 'EXECUTE_VAULT';
  amountIn: number;
  totalAmountOut: number;
  executionPrice: number;
  realizedPnlPct: number;
  executedVia: 'ORDERBOOK' | 'AMM_V1' | null;
  orderId: string | null;
  isPendingWalletSignature?: boolean;
  walletAssistedContinuation?: {
    executedVia: 'ASYMMETRIC';
    requiresWalletSignature: true;
    contractCallIntent: {
      contractAddress: string;
      method: string;
      side: SpotOrderSide;
      amountIn: number;
      minAmountOut: number;
      makerAddress: string;
      nonce: string;
      agentId: string | null;
    };
    message: string;
  } | null;
  slices: CopytradeSignalSlice[];
}

export interface CopytradeConfirmWalletSignalInput extends WalletActionSignaturePayload {
  leaderAddress: string;
  txHash: string;
  amountOut?: string;
  executionPrice?: string;
}

export interface CopytradeConfirmWalletSignalResult {
  signalId: string;
  signalStatus: string;
  continuationStatus: string;
  txHash: string | null;
  executedVia: 'ASYMMETRIC';
  executionPrice?: number;
  amountOut?: number;
  realizedPnlPct?: number;
  alreadyConfirmed: boolean;
}

export interface CopytradePendingWalletSignal {
  id: string;
  signalId: string;
  leaderId: string | null;
  vaultId: string | null;
  pairSymbol: string | null;
  positionEffect: 'OPEN' | 'CLOSE';
  status: string;
  executedVia: string;
  txHash: string | null;
  contractAddress: string;
  method: string;
  side: SpotOrderSide | null;
  amountIn: number;
  minAmountOut: number;
  makerAddress: string;
  nonce: string;
  agentId: string | null;
  message: string | null;
  requestedAt: string | null;
  confirmedAt: string | null;
  expiresAt: string | null;
}
