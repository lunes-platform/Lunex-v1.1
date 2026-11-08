import { describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/usePools', () => ({ usePools: () => ({ pools: [], isLoading: false, error: null }) }))
vi.mock('../../services/spotService', () => ({ spotApi: {} }))

import { STAT_DEFS, TOKENS, fmtPrice, fmtStat, NO_DATA } from './data'
import { computeStats, priceTokens } from './useLandingMarket'
import type { SpotTicker } from '../../services/spotService'

const ticker = (symbol: string, lastPrice: number, extra: Partial<SpotTicker> = {}): SpotTicker => ({
  symbol,
  lastPrice,
  high24h: 0,
  low24h: 0,
  volume24h: 0,
  quoteVolume24h: 0,
  change24h: 0,
  tradeCount: lastPrice > 0 ? 3 : 0,
  bestBid: null,
  bestAsk: null,
  spread: null,
  ...extra
})

const pool = (liquidity: number) => ({ liquidity }) as any

describe('landing: no fabricated financial figures (P0-8)', () => {
  it('static data carries no prices, changes, TVL, volume or APR', () => {
    for (const t of TOKENS) {
      expect(Object.keys(t).sort()).toEqual(['icon', 'name', 'sym'])
    }
    for (const s of STAT_DEFS) {
      expect(s).not.toHaveProperty('raw')
      expect(s.label).not.toMatch(/APR/i)
    }
  })

  it('without live sources every figure is "—" (only the protocol fee constant remains)', () => {
    const stats = computeStats(null, null)
    expect(stats).toEqual({ tvl: null, volume24h: null, activePools: null, swapFee: 0.5 })
    expect(priceTokens(TOKENS, []).every(t => t.price === null && t.chg === null)).toBe(true)
    expect(fmtPrice(null)).toBe(NO_DATA)
  })
})

describe('landing: live data', () => {
  it('prices tokens from LUSDT-quoted spot tickers with trades only', () => {
    const live = priceTokens(TOKENS, [
      ticker('LBTC/LUSDT', 65000, { change24h: 1.5 }),
      ticker('LUNES/LUSDT', 0.02, { change24h: -2 }),
      ticker('LETH/LUSDT', 0), // no trades yet
      ticker('GMC/LBTC', 0.001) // not USD-quoted
    ])
    const by = Object.fromEntries(live.map(t => [t.sym, t]))
    expect(by.LBTC).toMatchObject({ price: 65000, chg: 1.5 })
    expect(by.WLUNES).toMatchObject({ price: 0.02, chg: -2 })
    expect(by.LETH.price).toBeNull()
    expect(by.GMC.price).toBeNull()
    expect(by.LUSDT.price).toBeNull()
  })

  it('TVL = sum of LUSDT-paired pool liquidity; volume = sum of USD quote volume', () => {
    const stats = computeStats([pool(1000), pool(0), pool(250.5)], [
      ticker('LBTC/LUSDT', 1, { quoteVolume24h: 400 }),
      ticker('LETH/LUSDT', 1, { quoteVolume24h: 100 }),
      ticker('GMC/LBTC', 1, { quoteVolume24h: 999 })
    ])
    expect(stats.tvl).toBeCloseTo(1250.5)
    expect(stats.volume24h).toBe(500)
    expect(stats.activePools).toBe(3)
  })

  it('pools without any USD reference => TVL unknown, not $0', () => {
    expect(computeStats([pool(0)], []).tvl).toBeNull()
  })

  it('formats live values', () => {
    expect(fmtStat(1250.5, 'usd')).toBe('$1.3K')
    expect(fmtStat(3, 'int')).toBe('3')
  })
})
