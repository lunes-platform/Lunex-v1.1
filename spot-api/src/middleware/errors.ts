/**
 * Standardized API error handling.
 *
 * Usage:
 *   throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pair symbol')
 *   throw ApiError.notFound('Order not found')
 *   throw ApiError.unauthorized('Invalid signature')
 */

export class ApiError extends Error {
    public readonly statusCode: number
    public readonly code: string
    public readonly details?: Record<string, unknown>

    constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
        super(message)
        this.statusCode = statusCode
        this.code = code
        this.details = details
        Object.setPrototypeOf(this, ApiError.prototype)
    }

    static badRequest(message: string, details?: Record<string, unknown>) {
        return new ApiError(400, 'BAD_REQUEST', message, details)
    }

    static unauthorized(message = 'Unauthorized') {
        return new ApiError(401, 'UNAUTHORIZED', message)
    }

    static forbidden(message = 'Forbidden') {
        return new ApiError(403, 'FORBIDDEN', message)
    }

    static notFound(message = 'Resource not found') {
        return new ApiError(404, 'NOT_FOUND', message)
    }

    static conflict(message: string) {
        return new ApiError(409, 'CONFLICT', message)
    }

    static rateLimited(retryAfterMs?: number) {
        return new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterMs })
    }

    static internal(message = 'Internal server error') {
        return new ApiError(500, 'INTERNAL_ERROR', message)
    }

    /** Express-compatible JSON response */
    toJSON() {
        return {
            error: this.message,
            code: this.code,
            ...(this.details ? { details: this.details } : {}),
        }
    }
}

/**
 * Express error handler middleware.
 * Place after all routes: app.use(errorHandler())
 */
import { Request, Response, NextFunction } from 'express'
import { config } from '../config'
import { log } from '../utils/logger'

export function errorHandler() {
    return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof ApiError) {
            return res.status(err.statusCode).json(err.toJSON())
        }

        // CORS errors
        if (err.message?.includes('CORS')) {
            return res.status(403).json({ error: err.message, code: 'CORS_ERROR' })
        }

        // Fallback — hide details in production
        const message = config.isProd ? 'Internal server error' : err.message
        log.error({ err }, 'Unhandled server error')

        res.status(500).json({
            error: message,
            code: 'INTERNAL_ERROR',
        })
    }
}
