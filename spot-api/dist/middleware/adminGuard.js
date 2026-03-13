"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
/**
 * Shared admin guard middleware.
 *
 * - Constant-time comparison via `crypto.timingSafeEqual` to prevent timing attacks.
 * - Structured security logging for failed attempts.
 * - Used exclusively for internal maintenance endpoints (listing activation,
 *   pair registration, reward triggers, etc.).
 *
 * ⚠️  MUST NEVER be used to bypass Web3 signature verification on trading endpoints.
 */
function requireAdmin(req, res, next) {
    const secret = config_1.config.adminSecret;
    if (!secret) {
        logger_1.log.warn({ ip: req.ip, endpoint: req.originalUrl }, '[SECURITY] Admin auth attempt but ADMIN_SECRET is not configured');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
        logger_1.log.warn({ ip: req.ip, endpoint: req.originalUrl }, '[SECURITY] Admin auth attempt with missing token');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Constant-time comparison to prevent timing-based side-channel attacks
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (tokenBuf.length !== secretBuf.length || !crypto_1.default.timingSafeEqual(tokenBuf, secretBuf)) {
        logger_1.log.warn({ ip: req.ip, endpoint: req.originalUrl }, '[SECURITY] Admin auth failed — invalid token');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
//# sourceMappingURL=adminGuard.js.map