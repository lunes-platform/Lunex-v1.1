"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeOrderHash = computeOrderHash;
exports.decimalToNumber = decimalToNumber;
exports.getCandleOpenTime = getCandleOpenTime;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate a deterministic order hash from order parameters
 */
function computeOrderHash(params) {
    const payload = [
        params.makerAddress,
        params.pairSymbol,
        params.side,
        params.type,
        params.price,
        params.stopPrice || '0',
        params.amount,
        params.nonce,
        params.timeInForce || 'GTC',
        params.expiresAt || '0',
    ].join(':');
    return '0x' + crypto_1.default.createHash('sha256').update(payload).digest('hex');
}
/**
 * Format a Decimal to a number for orderbook operations
 */
function decimalToNumber(val) {
    if (typeof val === 'number')
        return val;
    return parseFloat(val.toString());
}
/**
 * Get the candle open time for a given timestamp and timeframe
 */
function getCandleOpenTime(timestamp, timeframe) {
    const ms = timestamp.getTime();
    let interval;
    switch (timeframe) {
        case '1m':
            interval = 60000;
            break;
        case '5m':
            interval = 300000;
            break;
        case '15m':
            interval = 900000;
            break;
        case '1h':
            interval = 3600000;
            break;
        case '4h':
            interval = 14400000;
            break;
        case '1d':
            interval = 86400000;
            break;
        case '1w':
            interval = 604800000;
            break;
        default:
            interval = 3600000;
    }
    return new Date(Math.floor(ms / interval) * interval);
}
//# sourceMappingURL=helpers.js.map