/**
 * Sanitize string inputs to prevent injection attacks
 */
export function sanitizeInput(value: string): string {
  return value
    .replace(/[<>]/g, '') // Remove HTML tags
    .trim()
    .slice(0, 1000); // Max length
}

/**
 * Validate that a pair symbol follows the expected format (e.g. LUNES/USDT)
 */
export function isValidPairSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(symbol);
}

/**
 * Validate that an amount string is a valid positive number
 */
export function isValidAmount(amount: string): boolean {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && isFinite(num);
}
