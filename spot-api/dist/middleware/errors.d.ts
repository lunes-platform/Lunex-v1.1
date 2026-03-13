/**
 * Standardized API error handling.
 *
 * Usage:
 *   throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pair symbol')
 *   throw ApiError.notFound('Order not found')
 *   throw ApiError.unauthorized('Invalid signature')
 */
export declare class ApiError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>);
    static badRequest(message: string, details?: Record<string, unknown>): ApiError;
    static unauthorized(message?: string): ApiError;
    static forbidden(message?: string): ApiError;
    static notFound(message?: string): ApiError;
    static conflict(message: string): ApiError;
    static rateLimited(retryAfterMs?: number): ApiError;
    static internal(message?: string): ApiError;
    /** Express-compatible JSON response */
    toJSON(): {
        details?: Record<string, unknown> | undefined;
        error: string;
        code: string;
    };
}
/**
 * Express error handler middleware.
 * Place after all routes: app.use(errorHandler())
 */
import { Request, Response, NextFunction } from 'express';
export declare function errorHandler(): (err: Error, _req: Request, res: Response, _next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=errors.d.ts.map