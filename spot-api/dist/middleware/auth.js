"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSpotOrderMessage = buildSpotOrderMessage;
exports.buildSpotCancelMessage = buildSpotCancelMessage;
exports.buildMarginCollateralMessage = buildMarginCollateralMessage;
exports.buildMarginOpenPositionMessage = buildMarginOpenPositionMessage;
exports.buildMarginClosePositionMessage = buildMarginClosePositionMessage;
exports.buildMarginLiquidatePositionMessage = buildMarginLiquidatePositionMessage;
exports.verifyAddressSignature = verifyAddressSignature;
exports.requireSignature = requireSignature;
exports.requireAddress = requireAddress;
const util_crypto_1 = require("@polkadot/util-crypto");
function buildSpotOrderMessage(input) {
    return `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${input.price || '0'}:${input.stopPrice || '0'}:${input.amount}:${input.nonce}`;
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
async function verifyAddressSignature(message, signature, address) {
    await (0, util_crypto_1.cryptoWaitReady)();
    try {
        return (0, util_crypto_1.signatureVerify)(message, signature, address).isValid;
    }
    catch {
        return false;
    }
}
/**
 * Middleware to validate that a request contains a valid signature.
 * In production, this verifies sr25519 signatures against the maker's public key.
 * For now, it checks that signature and makerAddress fields are present.
 */
function requireSignature(req, res, next) {
    const { signature, makerAddress } = req.body;
    if (!signature || typeof signature !== 'string' || signature.length < 4) {
        return res.status(401).json({ error: 'Missing or invalid signature' });
    }
    if (!makerAddress || typeof makerAddress !== 'string' || makerAddress.length < 4) {
        return res.status(401).json({ error: 'Missing or invalid makerAddress' });
    }
    // TODO: In production, verify sr25519 signature using @polkadot/util-crypto
    // const isValid = signatureVerify(message, signature, makerAddress).isValid
    // if (!isValid) return res.status(401).json({ error: 'Invalid signature' })
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