/**
 * Wraps a signAndSend Promise with a configurable timeout.
 * If the transaction is not confirmed within the deadline, rejects with a timeout error.
 *
 * A timeout does NOT mean the extrinsic failed: once broadcast it stays valid
 * in the pool until its mortal era expires and may still be included. Callers
 * that move funds must treat a post-broadcast timeout as ambiguous and
 * reconcile against the chain instead of re-submitting (BE-07).
 */

export const DEFAULT_TX_TIMEOUT_MS = 60_000;

export class TxTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`Transaction "${label}" timed out after ${timeoutMs}ms`);
    this.name = 'TxTimeoutError';
  }
}

export function withTxTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = DEFAULT_TX_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TxTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
