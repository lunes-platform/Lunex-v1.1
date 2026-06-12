/**
 * Public error types exposed by the Lunex SDK.
 */

/**
 * Thrown when an SDK method maps to functionality that is NOT exposed by
 * the spot-api REST surface — typically operations that are on-chain
 * smart-contract interactions (factory, router, staking, wnative, pair).
 *
 * Historically these methods called REST endpoints that never existed on
 * spot-api, so consumers received an opaque HTTP 404. The methods are kept
 * for signature compatibility but now fail fast with a clear explanation.
 */
export class EndpointNotAvailableError extends Error {
  /** Stable machine-readable code. */
  readonly code = 'ENDPOINT_NOT_AVAILABLE';

  /** SDK operation that was attempted (e.g. `staking.stake`). */
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(
      `[LunexSDK] "${operation}" is not available through the Lunex REST API: ${reason}`,
    );
    this.name = 'EndpointNotAvailableError';
    this.operation = operation;
  }
}
