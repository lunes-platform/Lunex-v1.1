/**
 * Token balances, USD prices and number formatting shared by the swap card and
 * the token selector.
 *
 * - Balances: real on-chain PSP22 balances via `useSDK().getTokenBalance`.
 * - Prices: last price of `<SYM>/LUSDT` spot pairs from spot-api tickers
 *   (LUSDT = $1). Falls back to the static `tokenPrice` string of the token
 *   list when the spot API is unreachable. Display only — never used for any
 *   financial decision (quotes come from the router contract).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSDK } from 'context/SDKContext'
import { spotApi } from 'services/spotService'
import type { Token } from './tokens'

export type TokenBalance = {
  /** Raw integer amount (smallest unit), as returned by the contract. */
  raw: string
  /** Human readable decimal string (no grouping). */
  formatted: string
  /** Same as `formatted`, as a number (display / sorting only). */
  value: number
}

export type BalanceMap = Record<string, TokenBalance>
export type PriceMap = Record<string, number>

const tokenKey = (t: Pick<Token, 'acronym'>) => t.acronym

/** On-chain balances of every token for the connected wallet. */
export const useTokenBalances = (tokens: Token[], enabled = true) => {
  const sdk = useSDK()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk
  const [balances, setBalances] = useState<BalanceMap>({})
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const address = sdk.walletAddress

  useEffect(() => {
    if (!enabled) return
    if (!address) {
      setBalances({})
      return
    }
    let alive = true
    setLoading(true)
    const s = sdkRef.current
    Promise.all(
      tokens.map(async t => {
        if (!t.address) return [tokenKey(t), null] as const
        try {
          const raw = (await s.getTokenBalance(t.address, address)) || '0'
          const formatted = s.formatAmount(raw, t.decimals || 8)
          return [
            tokenKey(t),
            { raw, formatted, value: Number(formatted) || 0 }
          ] as const
        } catch {
          return [tokenKey(t), null] as const
        }
      })
    ).then(entries => {
      if (!alive) return
      const next: BalanceMap = {}
      entries.forEach(([k, v]) => {
        if (v) next[k] = v
      })
      setBalances(next)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // tokens is a static list; refetch on wallet change or refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tick, enabled])

  const refresh = useCallback(() => setTick(t => t + 1), [])
  return { balances, loading, refresh }
}

const parseStaticPrice = (p?: string) => {
  const n = Number(String(p ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

let priceCache: { at: number; prices: PriceMap } | null = null
const PRICE_TTL = 60_000

/** USD prices keyed by token symbol (cached for 60s across components). */
export const useTokenPrices = (tokens: Token[]) => {
  const [prices, setPrices] = useState<PriceMap>(() => {
    const base: PriceMap = {}
    tokens.forEach(t => {
      base[t.acronym] = parseStaticPrice(t.tokenPrice)
    })
    return { ...base, ...(priceCache?.prices ?? {}) }
  })

  useEffect(() => {
    if (priceCache && Date.now() - priceCache.at < PRICE_TTL) return
    let alive = true
    ;(async () => {
      try {
        const pairs = await spotApi.getPairs()
        const wanted = new Set(tokens.map(t => t.acronym))
        const usdPairs = pairs.filter(p => {
          const [base, quote] = p.symbol.split('/')
          const sym = base === 'LUNES' ? 'WLUNES' : base
          return (quote === 'LUSDT' || quote === 'USDT') && wanted.has(sym)
        })
        const tickers = await Promise.all(
          usdPairs.map(p =>
            spotApi
              .getTicker(p.symbol)
              .then(t => [p.symbol, t.lastPrice] as const)
              .catch(() => [p.symbol, 0] as const)
          )
        )
        const live: PriceMap = { LUSDT: 1 }
        tickers.forEach(([symbol, last]) => {
          const base = symbol.split('/')[0]
          const sym = base === 'LUNES' ? 'WLUNES' : base
          if (last > 0 && !live[sym]) live[sym] = last
        })
        priceCache = { at: Date.now(), prices: live }
        if (alive) setPrices(prev => ({ ...prev, ...live }))
      } catch {
        /* spot API unreachable — keep static fallback prices */
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return prices
}

// ─── Formatting ──────────────────────────────────────────────────

/** Token amount: 2 decimals ≥1000, 4 ≥1, else 6 significant digits. */
export const fmtAmount = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1000)
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return Number(n.toPrecision(6)).toLocaleString('en-US', {
    maximumFractionDigits: 10
  })
}

/** USD value. Small values keep significant digits. */
export const fmtUsd = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  if (Math.abs(n) < 0.01) return '<$0.01'
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  )
}

/** Unit price: sub-dollar prices keep 4 significant digits. */
export const fmtPrice = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1) return '$' + Number(n.toPrecision(4))
  return fmtUsd(n)
}
