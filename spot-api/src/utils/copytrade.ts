import crypto from 'crypto';

export interface PerformanceFeeResult {
  profitAmount: number;
  feeAmount: number;
  highWaterMarkConsumed: number;
  remainingHighWaterMark: number;
}

export type CopytradePositionEffectInput = 'AUTO' | 'OPEN' | 'CLOSE';
export type CopytradeResolvedPositionEffect = 'OPEN' | 'CLOSE';

export function toNumber(
  value: string | number | { toString(): string },
): number {
  const num = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(num)) {
    throw new Error('Invalid numeric value');
  }
  return num;
}

export function calculateSharesToMint(
  depositAmount: string | number,
  totalShares: string | number,
  totalEquity: string | number,
): number {
  const amount = toNumber(depositAmount);
  const shares = toNumber(totalShares);
  const equity = toNumber(totalEquity);

  if (amount <= 0) throw new Error('Deposit amount must be positive');
  if (shares <= 0 || equity <= 0) return amount;

  return amount * (shares / equity);
}

export function calculateGrossWithdrawal(
  sharesToBurn: string | number,
  totalShares: string | number,
  totalEquity: string | number,
): number {
  const shares = toNumber(sharesToBurn);
  const supply = toNumber(totalShares);
  const equity = toNumber(totalEquity);

  if (shares <= 0) throw new Error('Shares to burn must be positive');
  if (supply <= 0 || equity < 0) throw new Error('Vault has no liquidity');
  if (shares > supply)
    throw new Error('Cannot burn more shares than vault supply');

  return shares * (equity / supply);
}

export function calculatePerformanceFeeOnWithdrawal(params: {
  grossAmount: string | number;
  sharesToBurn: string | number;
  shareBalanceBefore: string | number;
  highWaterMarkValue: string | number;
  performanceFeeBps: number;
}): PerformanceFeeResult {
  const grossAmount = toNumber(params.grossAmount);
  const sharesToBurn = toNumber(params.sharesToBurn);
  const shareBalanceBefore = toNumber(params.shareBalanceBefore);
  const highWaterMarkValue = toNumber(params.highWaterMarkValue);

  if (shareBalanceBefore <= 0) throw new Error('Position has no shares');
  if (sharesToBurn <= 0 || sharesToBurn > shareBalanceBefore) {
    throw new Error('Invalid shares to burn');
  }

  const proportion = sharesToBurn / shareBalanceBefore;
  const highWaterMarkConsumed = highWaterMarkValue * proportion;
  const profitAmount = Math.max(grossAmount - highWaterMarkConsumed, 0);
  const feeAmount = profitAmount * (params.performanceFeeBps / 10_000);
  const remainingHighWaterMark = Math.max(
    highWaterMarkValue - highWaterMarkConsumed,
    0,
  );

  return {
    profitAmount,
    feeAmount,
    highWaterMarkConsumed,
    remainingHighWaterMark,
  };
}

export function calculatePositionValue(
  shareBalance: string | number,
  totalShares: string | number,
  totalEquity: string | number,
): number {
  const balance = toNumber(shareBalance);
  const supply = toNumber(totalShares);
  const equity = toNumber(totalEquity);

  if (balance <= 0 || supply <= 0 || equity <= 0) return 0;
  return balance * (equity / supply);
}

export function planTwapSlices(
  totalAmount: string | number,
  threshold: string | number,
): number[] {
  const amount = toNumber(totalAmount);
  const limit = toNumber(threshold);

  if (amount <= 0) throw new Error('Amount must be positive');
  if (limit <= 0) throw new Error('TWAP threshold must be positive');
  if (amount <= limit) return [amount];

  const sliceCount = Math.ceil(amount / limit);
  const baseSlice = amount / sliceCount;

  return Array.from({ length: sliceCount }, (_unused, index) => {
    const isLast = index === sliceCount - 1;
    if (!isLast) return Number(baseSlice.toFixed(18));

    const executedSoFar = baseSlice * (sliceCount - 1);
    return Number((amount - executedSoFar).toFixed(18));
  });
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function abbreviateAum(value: string | number): string {
  const num = toNumber(value);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

export function formatMemberSince(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function deriveAmountOut(params: {
  pairSymbol: string;
  side: 'BUY' | 'SELL';
  amountIn: number;
  executionPrice: number;
}): number {
  const { side, amountIn, executionPrice } = params;
  if (executionPrice <= 0) return 0;
  return side === 'BUY' ? amountIn / executionPrice : amountIn * executionPrice;
}

export function resolveCopytradePositionEffect(
  requestedEffect: CopytradePositionEffectInput | undefined,
  hasMatchingOpenTrade: boolean,
): CopytradeResolvedPositionEffect {
  if (requestedEffect === 'OPEN') return 'OPEN';
  if (requestedEffect === 'CLOSE') {
    if (!hasMatchingOpenTrade) {
      throw new Error('No matching open leader trade to close');
    }
    return 'CLOSE';
  }

  return hasMatchingOpenTrade ? 'CLOSE' : 'OPEN';
}

export function calculateLeaderTradePnlPct(params: {
  openingSide: 'BUY' | 'SELL';
  entryPrice: string | number | { toString(): string };
  exitPrice: string | number | { toString(): string };
}): number {
  const entry = toNumber(params.entryPrice);
  const exit = toNumber(params.exitPrice);

  if (entry <= 0 || exit <= 0) return 0;

  const pnlPct =
    params.openingSide === 'BUY'
      ? ((exit - entry) / entry) * 100
      : ((entry - exit) / entry) * 100;

  return Math.max(-100, Math.min(100, pnlPct));
}
