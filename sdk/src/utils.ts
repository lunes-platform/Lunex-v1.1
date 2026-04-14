/**
 * Utility functions for the Lunex SDK
 */

/**
 * Calculate deadline timestamp
 * @param minutesFromNow - Minutes from now
 * @returns Unix timestamp
 */
export function calculateDeadline(minutesFromNow: number): number {
  return Math.floor(Date.now() / 1000) + minutesFromNow * 60;
}

/**
 * Format amount from wei to human-readable
 * @param amount - Amount in wei
 * @param decimals - Token decimals
 * @returns Formatted string
 */
export function formatAmount(amount: string, decimals: number): string {
  const value = BigInt(amount) / BigInt(10 ** decimals);
  return value.toString();
}

/**
 * Parse amount from human-readable to wei
 * @param amount - Human-readable amount
 * @param decimals - Token decimals
 * @returns Amount in wei
 */
export function parseAmount(amount: string, decimals: number): string {
  // Handle decimal input
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFraction;
  return BigInt(combined).toString();
}

/**
 * Format address for display
 * @param address - Full address
 * @param startChars - Characters to show at start
 * @param endChars - Characters to show at end
 * @returns Shortened address
 */
export function formatAddress(
  address: string,
  startChars: number = 6,
  endChars: number = 4,
): string {
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Calculate percentage
 * @param part - Part value
 * @param total - Total value
 * @param decimals - Decimal places
 * @returns Percentage string
 */
export function calculatePercentage(
  part: string,
  total: string,
  decimals: number = 2,
): string {
  if (total === '0') return '0';
  const percentage = (Number(part) / Number(total)) * 100;
  return percentage.toFixed(decimals);
}

/**
 * Add two BigInt amounts
 * @param a - First amount
 * @param b - Second amount
 * @returns Sum as string
 */
export function addAmounts(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

/**
 * Subtract two BigInt amounts
 * @param a - First amount
 * @param b - Second amount
 * @returns Difference as string
 */
export function subtractAmounts(a: string, b: string): string {
  const result = BigInt(a) - BigInt(b);
  return result < BigInt(0) ? '0' : result.toString();
}

/**
 * Multiply BigInt amount by number
 * @param amount - Amount
 * @param multiplier - Multiplier
 * @returns Product as string
 */
export function multiplyAmount(amount: string, multiplier: number): string {
  const result =
    (BigInt(amount) * BigInt(Math.floor(multiplier * 10000))) / BigInt(10000);
  return result.toString();
}

/**
 * Check if amount is zero
 * @param amount - Amount to check
 * @returns True if zero
 */
export function isZero(amount: string): boolean {
  return BigInt(amount) === BigInt(0);
}

/**
 * Compare two amounts
 * @param a - First amount
 * @param b - Second amount
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

/**
 * Format large numbers with K, M, B suffixes
 * @param value - Numeric value
 * @returns Formatted string
 */
export function formatLargeNumber(value: string | number): string {
  const num = Number(value);

  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}B`;
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }

  return num.toFixed(2);
}

/**
 * Sleep for specified milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param retries - Number of retries
 * @param delay - Initial delay in ms
 * @returns Result of function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(delay * Math.pow(2, i));
    }
  }
  throw new Error('Retry failed');
}

/**
 * Debounce function
 * @param fn - Function to debounce
 * @param delay - Delay in ms
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ============================================
// DECIMAL NORMALIZATION UTILITIES
// ============================================

/**
 * Decimal error types
 */
export enum DecimalError {
  OVERFLOW = 'OVERFLOW',
  PRECISION_LOSS = 'PRECISION_LOSS',
  INVALID_DECIMALS = 'INVALID_DECIMALS',
  DIVISION_BY_ZERO = 'DIVISION_BY_ZERO',
}

/**
 * Result type for decimal operations
 */
export type DecimalResult<T> =
  | { success: true; value: T }
  | { success: false; error: DecimalError };

/**
 * Token info with decimals
 */
export interface TokenDecimals {
  symbol: string;
  decimals: number;
  address: string;
}

/**
 * Convert amount between different decimal representations
 * STRICT: Returns error if precision would be lost
 *
 * @param amount - Amount in source decimals
 * @param fromDecimals - Source decimal places (0-18)
 * @param toDecimals - Target decimal places (0-18)
 * @returns Converted amount or error
 *
 * @example
 * // USDT (6 dec) -> LUNES (8 dec)
 * convertDecimals('100000000', 6, 8) // Ok: '10000000000'
 *
 * // LUNES (8 dec) -> USDT (6 dec) with precision loss
 * convertDecimals('10000000001', 8, 6) // Err: PRECISION_LOSS
 */
export function convertDecimals(
  amount: string,
  fromDecimals: number,
  toDecimals: number,
): DecimalResult<string> {
  if (
    fromDecimals < 0 ||
    fromDecimals > 18 ||
    toDecimals < 0 ||
    toDecimals > 18
  ) {
    return { success: false, error: DecimalError.INVALID_DECIMALS };
  }

  const amountBig = BigInt(amount);

  if (fromDecimals < toDecimals) {
    // Increasing decimals: multiply
    const diff = toDecimals - fromDecimals;
    const multiplier = BigInt(10 ** diff);
    const result = amountBig * multiplier;
    return { success: true, value: result.toString() };
  } else if (fromDecimals > toDecimals) {
    // Decreasing decimals: divide (may lose precision)
    const diff = fromDecimals - toDecimals;
    const divisor = BigInt(10 ** diff);
    const remainder = amountBig % divisor;

    if (remainder !== BigInt(0)) {
      return { success: false, error: DecimalError.PRECISION_LOSS };
    }

    return { success: true, value: (amountBig / divisor).toString() };
  }

  return { success: true, value: amount };
}

/**
 * Convert with rounding (for display only, NOT for transfers)
 *
 * @param amount - Amount to convert
 * @param fromDecimals - Source decimals
 * @param toDecimals - Target decimals
 * @param roundUp - Round up if true, down if false
 * @returns Rounded amount
 */
export function convertDecimalsRounded(
  amount: string,
  fromDecimals: number,
  toDecimals: number,
  roundUp: boolean = false,
): string {
  if (fromDecimals <= toDecimals) {
    const diff = toDecimals - fromDecimals;
    return (BigInt(amount) * BigInt(10 ** diff)).toString();
  }

  const diff = fromDecimals - toDecimals;
  const divisor = BigInt(10 ** diff);
  const base = BigInt(amount) / divisor;
  const remainder = BigInt(amount) % divisor;

  if (roundUp && remainder > BigInt(0)) {
    return (base + BigInt(1)).toString();
  }
  return base.toString();
}

/**
 * Normalize two amounts to the same decimal (uses the higher one)
 *
 * @param amountA - First amount
 * @param decimalsA - First token's decimals
 * @param amountB - Second amount
 * @param decimalsB - Second token's decimals
 * @returns Normalized amounts and target decimals
 *
 * @example
 * // LUNES (8 dec) + USDT (6 dec) -> both in 8 dec
 * normalizeAmounts('10000000000', 8, '50000000', 6)
 * // { amountA: '10000000000', amountB: '5000000000', targetDecimals: 8 }
 */
export function normalizeAmounts(
  amountA: string,
  decimalsA: number,
  amountB: string,
  decimalsB: number,
): { amountA: string; amountB: string; targetDecimals: number } {
  const targetDecimals = Math.max(decimalsA, decimalsB);

  const normalizedA = convertDecimals(amountA, decimalsA, targetDecimals);
  const normalizedB = convertDecimals(amountB, decimalsB, targetDecimals);

  if (!normalizedA.success || !normalizedB.success) {
    throw new Error('Failed to normalize amounts');
  }

  return {
    amountA: normalizedA.value,
    amountB: normalizedB.value,
    targetDecimals,
  };
}

/**
 * Format amount for human-readable display with proper decimals
 *
 * @param amount - Amount in smallest unit
 * @param decimals - Token decimals
 * @param maxDisplayDecimals - Max decimals to show (default: all)
 * @returns Formatted string like "123.456789"
 */
export function formatAmountWithDecimals(
  amount: string,
  decimals: number,
  maxDisplayDecimals?: number,
): string {
  if (decimals === 0) {
    return amount;
  }

  const amountBig = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amountBig / divisor;
  const decimalPart = amountBig % divisor;

  let decimalStr = decimalPart.toString().padStart(decimals, '0');

  if (maxDisplayDecimals !== undefined && maxDisplayDecimals < decimals) {
    decimalStr = decimalStr.slice(0, maxDisplayDecimals);
  }

  // Trim trailing zeros for cleaner display
  decimalStr = decimalStr.replace(/0+$/, '') || '0';

  if (decimalStr === '0') {
    return integerPart.toString();
  }

  return `${integerPart}.${decimalStr}`;
}

/**
 * Parse user input to amount in smallest unit
 *
 * @param input - User input like "123.456789"
 * @param decimals - Token decimals
 * @returns Amount in smallest unit or error
 */
export function parseAmountWithValidation(
  input: string,
  decimals: number,
): DecimalResult<string> {
  const parts = input.split('.');

  if (parts.length > 2) {
    return { success: false, error: DecimalError.INVALID_DECIMALS };
  }

  const [wholePart, decimalPart = ''] = parts;

  if (decimalPart.length > decimals) {
    return { success: false, error: DecimalError.PRECISION_LOSS };
  }

  const paddedDecimal = decimalPart.padEnd(decimals, '0');
  const combined = wholePart + paddedDecimal;

  try {
    const result = BigInt(combined);
    return { success: true, value: result.toString() };
  } catch {
    return { success: false, error: DecimalError.INVALID_DECIMALS };
  }
}

/**
 * Validate if a swap is safe considering decimals
 *
 * @param amountIn - Input amount
 * @param amountOut - Output amount
 * @param decimalsIn - Input token decimals
 * @param decimalsOut - Output token decimals
 * @returns Validation result with details
 */
export function validateSwapDecimals(
  amountIn: string,
  amountOut: string,
  decimalsIn: number,
  decimalsOut: number,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for zero output with non-zero input
  if (BigInt(amountOut) === BigInt(0) && BigInt(amountIn) > BigInt(0)) {
    return {
      valid: false,
      warnings: ['Output amount is zero - funds would be lost'],
    };
  }

  // Warn about large decimal differences
  const decimalDiff = Math.abs(decimalsIn - decimalsOut);
  if (decimalDiff >= 10) {
    warnings.push(
      `Large decimal difference (${decimalDiff}) - verify amounts carefully`,
    );
  }

  // Warn about low decimal output tokens
  if (decimalsOut <= 2) {
    warnings.push(
      `Output token has low decimals (${decimalsOut}) - small amounts may be truncated`,
    );
  }

  return { valid: true, warnings };
}

/**
 * Common token decimals lookup
 */
export const COMMON_DECIMALS: Record<string, number> = {
  // Lunes ecosystem
  LUNES: 8,
  WLUNES: 8,

  // Stablecoins
  USDT: 6,
  USDC: 6,
  DAI: 18,
  BUSD: 18,

  // Major cryptos
  BTC: 8,
  WBTC: 8,
  ETH: 18,
  WETH: 18,

  // Others
  SOL: 9,
  WSOL: 9,
  MATIC: 18,
  BNB: 18,
};

/**
 * Get decimals for a known token symbol
 * @param symbol - Token symbol
 * @returns Decimals or undefined if unknown
 */
export function getTokenDecimals(symbol: string): number | undefined {
  return COMMON_DECIMALS[symbol.toUpperCase()];
}
