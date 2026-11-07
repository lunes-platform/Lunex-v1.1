/**
 * Live data for the landing page (replaces the prototype's fictional numbers).
 *
 * - Token prices / 24h change: spot-api `<SYM>/LUSDT` tickers (LUSDT = $1).
 *   No ticker or no trades => `null` => rendered as "—".
 * - TVL / active pools: on-chain pool reserves via `usePools` (TVL is only
 *   counted for LUSDT-paired pools, the only ones with a USD reference).
 * - Spot 24h volume: sum of `quoteVolume24h` of LUSDT-quoted tickers.
 * Nothing is estimated or extrapolated.
 */
import { useEffect, useState } from 'react'
import { usePools, type Pool } from '../../hooks/usePools'
import { spotApi, type SpotTicker } from '../../services/spotService'
import { TOKENS, type Token, SWAP_FEE_PCT, type StatKey } from './data'

export type LiveToken = Token & { price: number | null; chg: number | null }
export type LandingStats = Record<StatKey, number | null>

const USD_QUOTES = new Set(['LUSDT', 'USDT'])
const baseSym = (symbol: string) => {
  const b = symbol.split('/')[0]
  return b === 'LUNES' ? 'WLUNES' : b
}

/** Merge tickers into the token list (pure). */
export const priceTokens = (tokens: Token[], tickers: SpotTicker[]): LiveToken[] => {
  const bySym = new Map<string, SpotTicker>()
  for (const t of tickers) {
    const [, quote] = t.symbol.split('/')
    if (!USD_QUOTES.has(quote)) continue
    const sym = baseSym(t.symbol)
    if (!bySym.has(sym)) bySym.set(sym, t)
  }
  return tokens.map(tok => {
    const t = bySym.get(tok.sym)
    const hasTrades = t && t.lastPrice > 0 && t.tradeCount > 0
    return {
      ...tok,
      price: hasTrades ? t!.lastPrice : null,
      chg: hasTrades ? t!.change24h : null
    }
  })
}

/** Aggregate stats from live sources (pure). `null` = source unavailable. */
export const computeStats = (
  pools: Pool[] | null,
  tickers: SpotTicker[] | null
): LandingStats => {
  const tvl =
    pools && pools.some(p => p.liquidity > 0)
      ? pools.reduce((s, p) => s + (p.liquidity > 0 ? p.liquidity : 0), 0)
      : null
  const usdTickers = (tickers ?? []).filter(t => USD_QUOTES.has(t.symbol.split('/')[1]))
  const volume24h =
    tickers && usdTickers.length > 0
      ? usdTickers.reduce((s, t) => s + (Number(t.quoteVolume24h) || 0), 0)
      : null
  return {
    tvl,
    volume24h,
    activePools: pools ? pools.length : null,
    swapFee: SWAP_FEE_PCT
  }
}

const fetchUsdTickers = async (): Promise<SpotTicker[] | null> => {
  try {
    const pairs = await spotApi.getPairs()
    const usd = pairs.filter(p => USD_QUOTES.has(p.symbol.split('/')[1]))
    const settled = await Promise.allSettled(usd.map(p => spotApi.getTicker(p.symbol)))
    return settled
      .filter((r): r is PromiseFulfilledResult<SpotTicker> => r.status === 'fulfilled')
      .map(r => r.value)
  } catch {
    return null
  }
}

export const useLandingMarket = () => {
  const { pools, isLoading, error } = usePools()
  const [tickers, setTickers] = useState<SpotTicker[] | null>(null)

  useEffect(() => {
    let alive = true
    fetchUsdTickers().then(t => alive && setTickers(t))
    return () => {
      alive = false
    }
  }, [])

  const poolSource = isLoading || (error && pools.length === 0) ? null : pools
  return {
    tokens: priceTokens(TOKENS, tickers ?? []),
    stats: computeStats(poolSource, tickers),
    loading: isLoading || tickers === null
  }
}
