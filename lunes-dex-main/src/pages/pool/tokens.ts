/**
 * Token list for the add-liquidity selector. Native LUNES is offered on top
 * of the factory-listed PSP22 tokens; useLiquidity routes it through WLUNES
 * (`toRoutingAddress`) and the Router's `add_liquidity_native` (LUNES sent as
 * the call value), so pools stay WLUNES/X on-chain.
 */
import type { KnownToken } from '../../hooks/usePools'
import {
  NATIVE_DECIMALS,
  NATIVE_SENTINEL,
  isWlunes,
  toRoutingAddress
} from '../../utils/nativeToken'

export type PoolToken = KnownToken & { isNative?: boolean }

export const NATIVE_POOL_TOKEN: PoolToken = {
  address: NATIVE_SENTINEL,
  symbol: 'LUNES',
  name: 'Lunes',
  decimals: NATIVE_DECIMALS,
  icon: '/img/lunes-green.svg',
  isNative: true
}

/** Native LUNES first — only when WLUNES (its routing target) is listed. */
export const buildPoolTokens = (known: KnownToken[]): PoolToken[] =>
  known.some(t => isWlunes(t.address) || t.symbol === 'WLUNES')
    ? [NATIVE_POOL_TOKEN, ...known]
    : [...known]

/** Two selections that resolve to the same on-chain token (e.g. LUNES and
 *  WLUNES) cannot form a pair. */
export const sameRoutedToken = (
  a: { address: string; symbol: string; isNative?: boolean } | null | undefined,
  b: { address: string; symbol: string; isNative?: boolean } | null | undefined
): boolean => {
  if (!a || !b) return false
  const ra = toRoutingAddress({ ...a, acronym: a.symbol })
  const rb = toRoutingAddress({ ...b, acronym: b.symbol })
  return !!ra && ra === rb
}
