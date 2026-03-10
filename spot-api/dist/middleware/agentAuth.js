"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentAuth = agentAuth;
exports.optionalAgentAuth = optionalAgentAuth;
const agentService_1 = require("../services/agentService");
/**
 * Middleware that verifies API key from X-API-Key header.
 * Attaches agent context to req.agent if valid.
 */
function agentAuth(requiredPermissions) {
    return async (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(401).json({ error: 'Missing X-API-Key header' });
        }
        try {
            const result = await agentService_1.agentService.verifyApiKey(apiKey);
            if (!result) {
                return res.status(401).json({ error: 'Invalid or expired API key' });
            }
            // Check required permissions
            if (requiredPermissions?.length) {
                const hasAll = requiredPermissions.every((p) => result.permissions.includes(p));
                if (!hasAll) {
                    return res.status(403).json({
                        error: 'Insufficient permissions',
                        required: requiredPermissions,
                        granted: result.permissions,
                    });
                }
            }
            req.agent = {
                id: result.agent.id,
                walletAddress: result.agent.walletAddress,
                agentType: result.agent.agentType,
                permissions: result.permissions,
                keyId: result.keyId,
                stakingTier: result.agent.stakingTier,
                dailyTradeLimit: result.agent.dailyTradeLimit,
                maxPositionSize: parseFloat(result.agent.maxPositionSize.toString()),
                maxOpenOrders: result.agent.maxOpenOrders,
            };
            next();
        }
        catch (err) {
            return res.status(500).json({ error: 'Authentication failed' });
        }
    };
}
/**
 * Optional agent auth — does not reject if no API key is present.
 * Useful for routes that support both wallet and API key auth.
 */
function optionalAgentAuth() {
    return async (req, _res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey)
            return next();
        try {
            const result = await agentService_1.agentService.verifyApiKey(apiKey);
            if (result) {
                req.agent = {
                    id: result.agent.id,
                    walletAddress: result.agent.walletAddress,
                    agentType: result.agent.agentType,
                    permissions: result.permissions,
                    keyId: result.keyId,
                    stakingTier: result.agent.stakingTier,
                    dailyTradeLimit: result.agent.dailyTradeLimit,
                    maxPositionSize: parseFloat(result.agent.maxPositionSize.toString()),
                    maxOpenOrders: result.agent.maxOpenOrders,
                };
            }
        }
        catch {
            // Silently continue without agent context
        }
        next();
    };
}
//# sourceMappingURL=agentAuth.js.map