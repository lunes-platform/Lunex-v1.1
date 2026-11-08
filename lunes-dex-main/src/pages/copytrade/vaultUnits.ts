import { NATIVE_DECIMALS } from '../../utils/nativeToken'

/**
 * Convert a LUNES amount (decimal string) into integer plancks for the
 * CopyVault contract (native LUNES, 8 decimals). Truncates extra decimals and
 * throws on anything that is not a positive plain decimal — a fund-moving call
 * must never silently become a zero or wrongly-scaled transfer.
 */
export function lunesToPlancks(units: string): string {
  const value = units.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('Enter a valid LUNES amount')
  }
  const [intPart, fracPart = ''] = value.split('.')
  const frac = fracPart.padEnd(NATIVE_DECIMALS, '0').slice(0, NATIVE_DECIMALS)
  const plancks = BigInt(intPart) * 10n ** BigInt(NATIVE_DECIMALS) + BigInt(frac)
  if (plancks <= 0n) throw new Error('Amount must be greater than zero')
  return plancks.toString()
}
