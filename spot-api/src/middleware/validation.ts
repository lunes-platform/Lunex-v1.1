import { Request, Response, NextFunction } from 'express'

/**
 * Sanitize string inputs to prevent injection attacks
 */
export function sanitizeInput(value: string): string {
  return value
    .replace(/[<>]/g, '') // Remove HTML tags
    .trim()
    .slice(0, 1000) // Max length
}

/**
 * Validate that a pair symbol follows the expected format (e.g. LUNES/USDT)
 */
export function isValidPairSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(symbol)
}

/**
 * Validate that an amount string is a valid positive number
 */
export function isValidAmount(amount: string): boolean {
  const num = parseFloat(amount)
  return !isNaN(num) && num > 0 && isFinite(num)
}

/**
 * Middleware to validate pair symbol in route params
 */
export function validatePairSymbol(req: Request, res: Response, next: NextFunction) {
  const { symbol } = req.params
  if (!symbol || !isValidPairSymbol(symbol)) {
    return res.status(400).json({ error: 'Invalid pair symbol format. Expected: BASE/QUOTE (e.g. LUNES/USDT)' })
  }
  next()
}

/**
 * Middleware to reject requests with suspiciously large bodies
 */
export function maxBodySize(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10)
    if (contentLength > maxBytes) {
      return res.status(413).json({ error: 'Request body too large' })
    }
    next()
  }
}
