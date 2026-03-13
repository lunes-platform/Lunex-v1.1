"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSpotOrderMessage = buildSpotOrderMessage;
exports.isNonceUsed = isNonceUsed;
exports.markNonceUsed = markNonceUsed;
exports.buildSpotCancelMessage = buildSpotCancelMessage;
exports.buildMarginCollateralMessage = buildMarginCollateralMessage;
exports.buildMarginOpenPositionMessage = buildMarginOpenPositionMessage;
exports.buildMarginClosePositionMessage = buildMarginClosePositionMessage;
exports.buildMarginLiquidatePositionMessage = buildMarginLiquidatePositionMessage;
exports.buildWalletActionMessage = buildWalletActionMessage;
exports.verifyAddressSignature = verifyAddressSignature;
exports.verifyWalletActionSignature = verifyWalletActionSignature;
exports.requireSignature = requireSignature;
exports.requireAddress = requireAddress;
const util_crypto_1 = require("@polkadot/util-crypto");
const redis_1 = require("../utils/redis");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const SIGNED_ACTION_TTL_MS = 5 * 60 * 1000;
// ─── Redis-backed nonce store (with in-memory fallback) ──────────
const fallbackNonces = new Map();
function pruneSignedActionNoncesFallback(now) {
    for (const [key, expiresAt] of fallbackNonces.entries()) {
        if (expiresAt <= now)
            fallbackNonces.delete(key);
    }
}
async function isNonceUsed(key) {
    // Always check in-memory fallback first — covers nonces written during a Redis
    // outage. Without this, a nonce stored in the fallback while Redis was down
    // would be invisible once Redis recovers, enabling replay attacks.
    if (fallbackNonces.has(key))
        return true;
    try {
        const result = await (0, redis_1.getRedis)().get(key);
        return result !== null;
    }
    catch {
        return false;
    }
}
async function markNonceUsed(key) {
    try {
        await (0, redis_1.getRedis)().set(key, '1', 'EX', config_1.config.redis.nonceTtlSeconds);
    }
    catch {
        // Redis unavailable — fall back to in-memory
        pruneSignedActionNoncesFallback(Date.now());
        fallbackNonces.set(key, Date.now() + SIGNED_ACTION_TTL_MS);
    }
}
function buildSpotOrderMessage(input) {
    const base = `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${input.price || '0'}:${input.stopPrice || '0'}:${input.amount}:${input.nonce}`;
    return input.timestamp !== undefined ? `${base}:${input.timestamp}` : base;
}
function buildSpotCancelMessage(orderId) {
    return `lunex-cancel:${orderId}`;
}
function buildMarginCollateralMessage(input) {
    return `lunex-margin-collateral:${input.action}:${input.token}:${input.amount}`;
}
function buildMarginOpenPositionMessage(input) {
    return `lunex-margin-open:${input.pairSymbol}:${input.side}:${input.collateralAmount}:${input.leverage}`;
}
function buildMarginClosePositionMessage(positionId) {
    return `lunex-margin-close:${positionId}`;
}
function buildMarginLiquidatePositionMessage(positionId) {
    return `lunex-margin-liquidate:${positionId}`;
}
function normalizeSignedValue(value) {
    if (Array.isArray(value)) {
        return value.join(',');
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return value == null ? '' : String(value);
}
function buildWalletActionMessage(input) {
    const lines = [
        `lunex-auth:${input.action}`,
        `address:${input.address}`,
    ];
    const orderedFields = Object.entries(input.fields ?? {})
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([left], [right]) => left.localeCompare(right));
    for (const [key, value] of orderedFields) {
        lines.push(`${key}:${normalizeSignedValue(value)}`);
    }
    lines.push(`nonce:${input.nonce}`);
    lines.push(`timestamp:${normalizeSignedValue(input.timestamp)}`);
    return lines.join('\n');
}
async function verifyAddressSignature(message, signature, address) {
    await (0, util_crypto_1.cryptoWaitReady)();
    try {
        return (0, util_crypto_1.signatureVerify)(message, signature, address).isValid;
    }
    catch {
        return false;
    }
}
async function verifyWalletActionSignature(input) {
    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        logger_1.log.warn({ address: input.address, action: input.action, reason: 'invalid_timestamp' }, '[SECURITY] Wallet signature rejected');
        return { ok: false, error: 'Invalid timestamp' };
    }
    const now = Date.now();
    if (Math.abs(now - timestamp) > SIGNED_ACTION_TTL_MS) {
        logger_1.log.warn({ address: input.address, action: input.action, reason: 'expired', drift: Math.abs(now - timestamp) }, '[SECURITY] Wallet signature rejected — expired TTL');
        return { ok: false, error: 'Expired signature' };
    }
    const replayKey = `nonce:${input.action}:${input.address}:${input.nonce}`;
    if (await isNonceUsed(replayKey)) {
        logger_1.log.warn({ address: input.address, action: input.action, nonce: input.nonce, reason: 'replay' }, '[SECURITY] Wallet signature rejected — nonce replay detected');
        return { ok: false, error: 'Signature nonce already used' };
    }
    const message = buildWalletActionMessage({
        action: input.action,
        address: input.address,
        nonce: input.nonce,
        timestamp,
        fields: input.fields,
    });
    const isValid = await verifyAddressSignature(message, input.signature, input.address);
    if (!isValid) {
        logger_1.log.warn({ address: input.address, action: input.action, reason: 'invalid_signature' }, '[SECURITY] Wallet signature rejected — sr25519 verification failed');
        return { ok: false, error: 'Invalid signature' };
    }
    await markNonceUsed(replayKey);
    return { ok: true, message };
}
/**
 * Middleware to validate that a request contains a valid signature.
 * In production, this verifies sr25519 signatures against the maker's public key.
 * For now, it checks that signature and makerAddress fields are present.
 */
async function requireSignature(req, res, next) {
    const { signature, makerAddress } = req.body;
    if (!signature || typeof signature !== 'string' || signature.length < 4) {
        return res.status(401).json({ error: 'Missing or invalid signature' });
    }
    if (!makerAddress || typeof makerAddress !== 'string' || makerAddress.length < 4) {
        return res.status(401).json({ error: 'Missing or invalid makerAddress' });
    }
    // Reconstruct the signed message from the request body
    const message = buildSpotOrderMessage({
        pairSymbol: req.body.pairSymbol ?? req.body.symbol ?? '',
        side: req.body.side ?? '',
        type: req.body.type ?? '',
        price: req.body.price,
        stopPrice: req.body.stopPrice,
        amount: req.body.amount ?? '',
        nonce: req.body.nonce ?? '',
    });
    const isValid = await verifyAddressSignature(message, signature, makerAddress);
    if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature — sr25519 verification failed' });
    }
    next();
}
/**
 * Middleware to validate query-based address authentication.
 * Checks that the requesting address is provided.
 */
function requireAddress(req, res, next) {
    const address = req.query.makerAddress || req.query.address;
    if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Address parameter required' });
    }
    next();
}
//# sourceMappingURL=auth.js.map