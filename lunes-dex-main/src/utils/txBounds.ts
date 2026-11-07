/**
 * Hard bounds for user-controlled transaction parameters. Mirrors the SDK
 * (sdk/src/utils.ts) so a corrupted or extreme UI value can never turn into
 * an unlimited-slippage or far-future transaction.
 */

export const DEFAULT_SLIPPAGE_PERCENT = 0.5
export const MAX_SLIPPAGE_PERCENT = 50
export const DEFAULT_DEADLINE_MINUTES = 20
export const MIN_DEADLINE_MINUTES = 1
export const MAX_DEADLINE_MINUTES = 180

const bound = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback

/** Minimum raw amount out after slippage; '0' only for an unparseable amount. */
export function minAmountAfterSlippage(
  amount: string,
  slippagePercent: number
): string {
  const pct = bound(
    slippagePercent,
    0,
    MAX_SLIPPAGE_PERCENT,
    DEFAULT_SLIPPAGE_PERCENT
  )
  try {
    const keepBps = BigInt(Math.floor((100 - pct) * 100))
    return ((BigInt(amount) * keepBps) / BigInt(10000)).toString()
  } catch {
    return '0'
  }
}

/** Unix deadline in seconds; contractService multiplies by 1000 for the chain. */
export function deadlineFromNow(minutes: number): number {
  const m = bound(
    minutes,
    MIN_DEADLINE_MINUTES,
    MAX_DEADLINE_MINUTES,
    DEFAULT_DEADLINE_MINUTES
  )
  return Math.floor(Date.now() / 1000) + m * 60
}
