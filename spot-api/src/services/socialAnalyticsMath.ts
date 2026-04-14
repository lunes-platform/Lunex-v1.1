export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    return toFiniteNumber((value as { toString(): string }).toString());
  }

  return 0;
}

export function roundMetric(value: number, decimals = 8): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimals));
}

export function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function calculateRoi(
  initialEquity: number,
  currentEquity: number,
): number {
  if (initialEquity <= 0) return 0;
  return roundMetric(((currentEquity - initialEquity) / initialEquity) * 100);
}

export function calculateWinRate(
  winningTrades: number,
  totalTrades: number,
): number {
  if (totalTrades <= 0) return 0;
  return roundMetric((winningTrades / totalTrades) * 100);
}

export function calculateAverageProfit(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return roundMetric(sumNumbers(pnls) / pnls.length);
}

export function calculateSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;

  const mean = sumNumbers(returns) / returns.length;
  const variance =
    sumNumbers(returns.map((value) => (value - mean) ** 2)) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  return roundMetric((mean / stdDev) * Math.sqrt(returns.length), 6);
}

export function calculateMaxDrawdown(points: EquityPoint[]): number {
  if (points.length === 0) return 0;

  let peak = points[0].equity;
  let worstDrawdown = 0;

  for (const point of points) {
    if (point.equity > peak) {
      peak = point.equity;
      continue;
    }

    if (peak <= 0) continue;

    const drawdown = ((peak - point.equity) / peak) * 100;
    if (drawdown > worstDrawdown) {
      worstDrawdown = drawdown;
    }
  }

  return roundMetric(worstDrawdown);
}

export function buildPnlHistory(points: EquityPoint[], limit = 30): number[] {
  if (points.length === 0) return [];

  const recentPoints = points.slice(-limit);
  const baseline = recentPoints[0].equity > 0 ? recentPoints[0].equity : 1;

  return recentPoints.map((point) =>
    roundMetric(((point.equity - baseline) / baseline) * 100, 4),
  );
}

export function getWindowRoi(
  points: EquityPoint[],
  days: number,
  referenceTime = Date.now(),
): number {
  if (points.length === 0) return 0;

  const cutoff = referenceTime - days * 24 * 60 * 60 * 1000;
  const endPoint = points[points.length - 1];
  const previousPoint =
    [...points].reverse().find((point) => point.timestamp < cutoff) ??
    points[0];

  return calculateRoi(previousPoint.equity, endPoint.equity);
}

export function getSequentialReturns(points: EquityPoint[]): number[] {
  if (points.length < 2) return [];

  const returns: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.equity <= 0) continue;
    returns.push((current.equity - previous.equity) / previous.equity);
  }

  return returns;
}
