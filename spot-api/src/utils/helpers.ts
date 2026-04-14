import crypto from 'crypto';

/**
 * Generate a deterministic order hash from order parameters
 */
export function computeOrderHash(params: {
  makerAddress: string;
  pairSymbol: string;
  side: string;
  type: string;
  price: string;
  stopPrice?: string | null;
  amount: string;
  nonce: string;
  timeInForce?: string | null;
  expiresAt?: string | null;
}): string {
  const payload = [
    params.makerAddress,
    params.pairSymbol,
    params.side,
    params.type,
    params.price,
    params.stopPrice || '0',
    params.amount,
    params.nonce,
    params.timeInForce || 'GTC',
    params.expiresAt || '0',
  ].join(':');
  return '0x' + crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Format a Decimal to a number for orderbook operations
 */
export function decimalToNumber(val: any): number {
  if (typeof val === 'number') return val;
  return parseFloat(val.toString());
}

/**
 * Get the candle open time for a given timestamp and timeframe
 */
export function getCandleOpenTime(timestamp: Date, timeframe: string): Date {
  const ms = timestamp.getTime();
  let interval: number;

  switch (timeframe) {
    case '1m':
      interval = 60_000;
      break;
    case '5m':
      interval = 300_000;
      break;
    case '15m':
      interval = 900_000;
      break;
    case '1h':
      interval = 3_600_000;
      break;
    case '4h':
      interval = 14_400_000;
      break;
    case '1d':
      interval = 86_400_000;
      break;
    case '1w':
      interval = 604_800_000;
      break;
    default:
      interval = 3_600_000;
  }

  return new Date(Math.floor(ms / interval) * interval);
}
