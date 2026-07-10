/**
 * Pure helper for converting a decimal unit string into integer plancks.
 *
 * Extracted verbatim from useAsymmetricDeploy.ts so this fund-conversion math
 * can be unit-tested without importing the Polkadot / contract stack. Behaviour
 * is identical to the original inline implementation — no runtime imports.
 */

export const PLANCKS_PER_UNIT = 1_000_000_000_000n // 10^12

/**
 * Convert a human unit string (e.g. "1.5") into its planck integer string.
 *
 * The fractional part is right-padded then TRUNCATED (not rounded) to
 * `decimals` digits. Any parse failure (e.g. non-numeric input) yields '0'.
 *
 * NOTE: `decimals` defaults to 12 to match PLANCKS_PER_UNIT (10^12); every
 * caller in this codebase relies on the default. Passing a different `decimals`
 * without changing PLANCKS_PER_UNIT would mis-scale the result — kept as-is to
 * preserve existing behaviour.
 */
export function toPlancks(units: string, decimals = 12): string {
  try {
    const [intPart, fracPart = ''] = units.split('.')
    const padded = fracPart.padEnd(decimals, '0').slice(0, decimals)
    return (
      BigInt(intPart) * PLANCKS_PER_UNIT +
      BigInt(padded || '0')
    ).toString()
  } catch {
    return '0'
  }
}
