"use strict";
/**
 * Wraps a signAndSend Promise with a configurable timeout.
 * If the transaction is not confirmed within the deadline, rejects with a timeout error.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TxTimeoutError = void 0;
exports.withTxTimeout = withTxTimeout;
const DEFAULT_TX_TIMEOUT_MS = 60000;
class TxTimeoutError extends Error {
    constructor(label, timeoutMs) {
        super(`Transaction "${label}" timed out after ${timeoutMs}ms`);
        this.name = 'TxTimeoutError';
    }
}
exports.TxTimeoutError = TxTimeoutError;
function withTxTimeout(label, promise, timeoutMs = DEFAULT_TX_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new TxTimeoutError(label, timeoutMs));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== undefined)
            clearTimeout(timer);
    });
}
//# sourceMappingURL=txWithTimeout.js.map