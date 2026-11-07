import { useCallback, useEffect, useState } from 'react'
import { contractService } from 'services/contractService'
import { spotApi, SpotPair } from 'services/spotService'

const LUSDT_ADDRESS =
  process.env.REACT_APP_TOKEN_LUSDT ||
  '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'
const NATIVE = ['LUNES', 'WLUNES']

type Side = { token?: string; native: boolean; decimals: number }

/**
 * Wallet balances for the selected pair (base / quote), read on-chain.
 * Token addresses come from spot-api market info; LUNES-based legs use the
 * native balance (same behaviour as before the redesign). `null` = unknown.
 */
export function useSpotBalances(
  wallet: string | null,
  symbol: string,
  pair?: SpotPair
) {
  const [base, setBase] = useState<number | null>(null)
  const [quote, setQuote] = useState<number | null>(null)
  const [n, setN] = useState(0)
  const refresh = useCallback(() => setN(x => x + 1), [])

  useEffect(() => {
    setBase(null)
    setQuote(null)
    if (!wallet) return
    let alive = true
    const [b, q] = symbol.split('/')

    const read = async (s: Side): Promise<number | null> => {
      try {
        const raw = s.native
          ? await contractService.getNativeBalance(wallet)
          : s.token
            ? await contractService.getTokenBalance(s.token, wallet)
            : null
        return raw === null ? null : Number(raw) / Math.pow(10, s.decimals)
      } catch {
        return null
      }
    }

    ;(async () => {
      let baseToken: string | undefined
      let quoteToken: string | undefined
      try {
        const info = await spotApi.getMarketInfo(symbol)
        baseToken = info?.pair?.baseToken
        quoteToken = info?.pair?.quoteToken
      } catch {
        // market info unavailable — fall back to known addresses
      }
      if (!quoteToken && q === 'LUSDT') quoteToken = LUSDT_ADDRESS
      const [bv, qv] = await Promise.all([
        read({
          token: baseToken,
          native: !!pair?.isNativeBase || NATIVE.includes(b),
          decimals: pair?.baseDecimals ?? 8
        }),
        read({
          token: quoteToken,
          native: !!pair?.isNativeQuote || q === 'LUNES',
          decimals: pair?.quoteDecimals ?? (q === 'LUSDT' ? 6 : 8)
        })
      ])
      if (!alive) return
      setBase(bv)
      setQuote(qv)
    })()

    return () => {
      alive = false
    }
  }, [wallet, symbol, pair, n])

  return { base, quote, refresh }
}
