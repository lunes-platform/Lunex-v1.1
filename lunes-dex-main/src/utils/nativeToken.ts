/**
 * Single source of truth for native LUNES <-> wrapped WLUNES logic.
 *
 * LUNES is the network's native coin (what the user holds and selects);
 * WLUNES is the PSP22 wrapper the AMM actually trades. They are 1:1, both
 * 8 decimals. Every "is this native?" / "what address does the Router need?"
 * decision lives here so the UI never scatters `if symbol === 'WLUNES'`
 * conditionals. Pure and unit-tested.
 */

import type { Token } from '../pages/home/modals/chooseToken/tokenRegistry'

/** Placeholder address for the native coin. Never a valid base58 AccountId, so
 *  it must be mapped to the WLUNES routing address before any chain call. */
export const NATIVE_SENTINEL = 'native'

/** LUNES and WLUNES share 8 decimals — no scaling differences. */
export const NATIVE_DECIMALS = 8

/** Gas buffer left untouched when the user taps "Max" on a native amount, so
 *  the transaction can still pay its fees. */
export const GAS_RESERVE_LUNES = 0.1

/** Display token for the native coin. Selected/seen by the user; mapped to the
 *  WLUNES routing address (pools remain WLUNES/X) before contract calls. */
export const LUNES_TOKEN: Token = {
  id: -1,
  icon: '/img/lunes-green.svg',
  acronym: 'LUNES',
  token: 'Lunes',
  tokenPrice: 'Unavailable',
  address: NATIVE_SENTINEL,
  decimals: NATIVE_DECIMALS,
  isNative: true,
}

type TokenLike = {
  acronym?: string
  address?: string
  isNative?: boolean
}

type TokenInput = string | TokenLike | null | undefined

/** Resolve the on-chain WLUNES (wrapped native) contract address from env at
 *  call-time, mirroring config/contracts.ts. */
export const wlunesAddress = (): string =>
  process.env.REACT_APP_TOKEN_WLUNES ||
  process.env.REACT_APP_WNATIVE_CONTRACT ||
  ''

/** True for the native LUNES coin (by isNative flag, sentinel address, or
 *  LUNES symbol). False for WLUNES and every other token. */
export const isLunes = (input: TokenInput): boolean => {
  if (!input) return false
  if (typeof input === 'string') {
    return input === NATIVE_SENTINEL || input.toUpperCase() === 'LUNES'
  }
  if (input.isNative === true) return true
  if (input.address === NATIVE_SENTINEL) return true
  return !!input.acronym && input.acronym.toUpperCase() === 'LUNES'
}

/** True for the wrapped WLUNES token (by symbol or wnative contract address).
 *  Never true for the native coin. */
export const isWlunes = (input: TokenInput): boolean => {
  if (!input) return false
  const waddr = wlunesAddress()
  if (typeof input === 'string') {
    if (input.toUpperCase() === 'WLUNES') return true
    return !!waddr && input === waddr
  }
  if (isLunes(input)) return false
  if (input.acronym && input.acronym.toUpperCase() === 'WLUNES') return true
  return !!input.address && !!waddr && input.address === waddr
}

/** Address the Router/Factory needs: WLUNES for the native coin, otherwise the
 *  token's own address. Pools are WLUNES/X even when LUNES is displayed. */
export const toRoutingAddress = (input: TokenInput): string => {
  if (isLunes(input)) return wlunesAddress()
  if (typeof input === 'string') return input
  return input?.address || ''
}

export type SwapMethod =
  | 'swapExactNativeForTokens'
  | 'swapExactTokensForNative'
  | 'swapExactTokensForTokens'

export type TradeClassification =
  | { kind: 'swap'; method: SwapMethod; needsApprove: boolean }
  | { kind: 'wrap'; needsApprove: false }
  | { kind: 'unwrap'; needsApprove: false }

/** Classify a (from, to) pair into the action the UI must take and the Router
 *  call/approval it implies. LUNES<->WLUNES is a 1:1 wrap/unwrap, not a swap. */
export const classifyTrade = (
  from: TokenInput,
  to: TokenInput,
): TradeClassification => {
  const fromLunes = isLunes(from)
  const toLunes = isLunes(to)

  if (fromLunes && isWlunes(to)) return { kind: 'wrap', needsApprove: false }
  if (isWlunes(from) && toLunes) return { kind: 'unwrap', needsApprove: false }

  if (fromLunes) {
    return {
      kind: 'swap',
      method: 'swapExactNativeForTokens',
      needsApprove: false,
    }
  }
  if (toLunes) {
    return {
      kind: 'swap',
      method: 'swapExactTokensForNative',
      needsApprove: true,
    }
  }
  return {
    kind: 'swap',
    method: 'swapExactTokensForTokens',
    needsApprove: true,
  }
}

/** Spendable native balance after reserving a gas buffer; clamped at 0 so a
 *  balance below the reserve never produces a negative "Max". */
export const maxNativeSpendable = (balance: number): number => {
  const spendable = balance - GAS_RESERVE_LUNES
  return spendable > 0 ? spendable : 0
}
