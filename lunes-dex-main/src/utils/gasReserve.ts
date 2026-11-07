/**
 * Native LUNES left untouched when the user taps "MAX" on a native amount
 * (swap from LUNES, staking, add-liquidity with LUNES), so the account keeps
 * its existential deposit and can still pay the transaction fee + storage
 * deposit. Planck-exact (8 decimals) — no float math.
 *
 * Configurable (in LUNES) via:
 *   REACT_APP_NATIVE_EXISTENTIAL_DEPOSIT_LUNES  (default 0.01)
 *   REACT_APP_NATIVE_FEE_BUFFER_LUNES           (default 1)
 */

import { readEnv } from './env'

const DECIMALS = 8

export const DEFAULT_EXISTENTIAL_DEPOSIT_LUNES = '0.01'
export const DEFAULT_FEE_BUFFER_LUNES = '1'

/** "1.5" → 150_000_000n. Truncates past 8 decimals; null when invalid. */
export const parseLunesToPlanck = (lunes: string): bigint | null => {
  const v = (lunes || '').trim()
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(v)) return null
  const [int, frac = ''] = v.split('.')
  return BigInt((int || '0') + frac.padEnd(DECIMALS, '0').slice(0, DECIMALS))
}

const envLunes = (value: string, fallback: string): bigint =>
  parseLunesToPlanck(value) ?? (parseLunesToPlanck(fallback) as bigint)

/** Existential deposit + fee buffer, in planck. */
export const nativeGasReservePlanck = (): bigint =>
  envLunes(
    readEnv(() => process.env.REACT_APP_NATIVE_EXISTENTIAL_DEPOSIT_LUNES),
    DEFAULT_EXISTENTIAL_DEPOSIT_LUNES
  ) +
  envLunes(
    readEnv(() => process.env.REACT_APP_NATIVE_FEE_BUFFER_LUNES),
    DEFAULT_FEE_BUFFER_LUNES
  )

/** Raw native balance (planck string) minus the reserve, clamped at 0. */
export const maxSpendableNative = (
  balancePlanck: string,
  reserve: bigint = nativeGasReservePlanck()
): string => {
  try {
    const bal = BigInt(balancePlanck || '0')
    return bal > reserve ? (bal - reserve).toString() : '0'
  } catch {
    return '0'
  }
}

/** `num/den` of a balance for the 50% / MAX buttons. For native LUNES the
 *  result is capped at the spendable amount (balance − reserve). */
export const balanceFraction = (
  balanceRaw: string,
  num: bigint,
  den: bigint,
  isNative: boolean,
  reserve: bigint = nativeGasReservePlanck()
): string => {
  try {
    const part = (BigInt(balanceRaw || '0') * num) / den
    if (!isNative) return part.toString()
    const spendable = BigInt(maxSpendableNative(balanceRaw, reserve))
    return (part < spendable ? part : spendable).toString()
  } catch {
    return '0'
  }
}
