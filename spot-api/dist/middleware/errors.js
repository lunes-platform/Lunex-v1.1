"use strict";
/**
 * Standardized API error handling.
 *
 * Usage:
 *   throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pair symbol')
 *   throw ApiError.notFound('Order not found')
 *   throw ApiError.unauthorized('Invalid signature')
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.errorHandler = errorHandler;
class ApiError extends Error {
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Object.setPrototypeOf(this, ApiError.prototype);
    }
    static badRequest(message, details) {
        return new ApiError(400, 'BAD_REQUEST', message, details);
    }
    static unauthorized(message = 'Unauthorized') {
        return new ApiError(401, 'UNAUTHORIZED', message);
    }
    static forbidden(message = 'Forbidden') {
        return new ApiError(403, 'FORBIDDEN', message);
    }
    static notFound(message = 'Resource not found') {
        return new ApiError(404, 'NOT_FOUND', message);
    }
    static conflict(message) {
        return new ApiError(409, 'CONFLICT', message);
    }
    static rateLimited(retryAfterMs) {
        return new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterMs });
    }
    static internal(message = 'Internal server error') {
        return new ApiError(500, 'INTERNAL_ERROR', message);
    }
    /** Express-compatible JSON response */
    toJSON() {
        return {
            error: this.message,
            code: this.code,
            ...(this.details ? { details: this.details } : {}),
        };
    }
}
exports.ApiError = ApiError;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
function errorHandler() {
    return (err, _req, res, _next) => {
        if (err instanceof ApiError) {
            return res.status(err.statusCode).json(err.toJSON());
        }
        // CORS errors
        if (err.message?.includes('CORS')) {
            return res.status(403).json({ error: err.message, code: 'CORS_ERROR' });
        }
        // Fallback — hide details in production
        const message = config_1.config.isProd ? 'Internal server error' : err.message;
        logger_1.log.error({ err }, 'Unhandled server error');
        res.status(500).json({
            error: message,
            code: 'INTERNAL_ERROR',
        });
    };
}
//# sourceMappingURL=errors.js.map