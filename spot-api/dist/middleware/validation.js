"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeInput = sanitizeInput;
exports.isValidPairSymbol = isValidPairSymbol;
exports.isValidAmount = isValidAmount;
exports.validatePairSymbol = validatePairSymbol;
exports.maxBodySize = maxBodySize;
/**
 * Sanitize string inputs to prevent injection attacks
 */
function sanitizeInput(value) {
    return value
        .replace(/[<>]/g, '') // Remove HTML tags
        .trim()
        .slice(0, 1000); // Max length
}
/**
 * Validate that a pair symbol follows the expected format (e.g. LUNES/USDT)
 */
function isValidPairSymbol(symbol) {
    return /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(symbol);
}
/**
 * Validate that an amount string is a valid positive number
 */
function isValidAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && isFinite(num);
}
/**
 * Middleware to validate pair symbol in route params
 */
function validatePairSymbol(req, res, next) {
    const { symbol } = req.params;
    if (!symbol || !isValidPairSymbol(symbol)) {
        return res.status(400).json({ error: 'Invalid pair symbol format. Expected: BASE/QUOTE (e.g. LUNES/USDT)' });
    }
    next();
}
/**
 * Middleware to reject requests with suspiciously large bodies
 */
function maxBodySize(maxBytes) {
    return (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > maxBytes) {
            return res.status(413).json({ error: 'Request body too large' });
        }
        next();
    };
}
//# sourceMappingURL=validation.js.map