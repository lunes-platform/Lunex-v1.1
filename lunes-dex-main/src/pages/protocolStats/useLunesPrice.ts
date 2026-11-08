/**
 * Live LUNES→USD reference for the revenue simulator: last trade of the
 * LUNES/LUSDT (or WLUNES/LUSDT) spot pair. `null` when there is no market or
 * the spot API is unreachable — the simulator then excludes LUNES-denominated
 * fees instead of assuming a price.
 */
import { useEffect, useState } from 'react'
import { spotApi } from '../../services/spotService'

const CANDIDATES = ['LUNES/LUSDT', 'WLUNES/LUSDT']

export const fetchLunesUsd = async (): Promise<number | null> => {
  for (const symbol of CANDIDATES) {
    try {
      const t = await spotApi.getTicker(symbol)
      if (t && t.lastPrice > 0 && t.tradeCount > 0) return t.lastPrice
    } catch {
      /* try next pair */
    }
  }
  return null
}

export const useLunesUsdPrice = () => {
  const [state, setState] = useState<{ price: number | null; loading: boolean }>({
    price: null,
    loading: true
  })
  useEffect(() => {
    let alive = true
    fetchLunesUsd().then(price => alive && setState({ price, loading: false }))
    return () => {
      alive = false
    }
  }, [])
  return state
}
