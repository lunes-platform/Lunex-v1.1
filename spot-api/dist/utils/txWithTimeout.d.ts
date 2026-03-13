/**
 * Wraps a signAndSend Promise with a configurable timeout.
 * If the transaction is not confirmed within the deadline, rejects with a timeout error.
 */
export declare class TxTimeoutError extends Error {
    constructor(label: string, timeoutMs: number);
}
export declare function withTxTimeout<T>(label: string, promise: Promise<T>, timeoutMs?: number): Promise<T>;
//# sourceMappingURL=txWithTimeout.d.ts.map