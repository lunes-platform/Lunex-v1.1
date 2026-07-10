/**
 * Single source of truth for the Spot API base URL.
 * Every service previously defined its own copy of this constant
 * (API_BASE, MARGIN_API_URL, REWARDS_API_URL, SOCIAL_API_URL, ...)
 * — all resolving to the exact same value.
 */
export const SPOT_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'
