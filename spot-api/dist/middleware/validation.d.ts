import { Request, Response, NextFunction } from 'express';
/**
 * Sanitize string inputs to prevent injection attacks
 */
export declare function sanitizeInput(value: string): string;
/**
 * Validate that a pair symbol follows the expected format (e.g. LUNES/USDT)
 */
export declare function isValidPairSymbol(symbol: string): boolean;
/**
 * Validate that an amount string is a valid positive number
 */
export declare function isValidAmount(amount: string): boolean;
/**
 * Middleware to validate pair symbol in route params
 */
export declare function validatePairSymbol(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
/**
 * Middleware to reject requests with suspiciously large bodies
 */
export declare function maxBodySize(maxBytes: number): (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=validation.d.ts.map