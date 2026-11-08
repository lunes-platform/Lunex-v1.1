import { useCallback, useEffect, useState } from 'react'
import { spotApi, SpotBalance, SpotPair } from 'services/spotService'
import { subscribeVaultChanged } from '../Vault/vaultEvents'
import {
  getReadSessionToken,
  subscribeReadSession
} from 'services/sessionService'

/** Vault key spot-api uses for the native coin (LUNES). WLUNES keeps its own
 *  PSP22 address — native and wrapped are different vault balances. */
export const NATIVE_VAULT_TOKEN = '0x' + '00'.repeat(32)

/**
 * Spendable Spot balances for the selected pair (base / quote): the
 * `available` amount in the settlement vault (total − locked by resting
 * orders), which is what can back an order — not the wallet balance.
 *
 * Read via the 8h read session, so it never prompts the wallet. `null` =
 * unknown (no session yet, pair metadata missing, or API unavailable); the
 * form then leaves the balance check to spot-api.
 *
 * `baseRow` / `quoteRow` carry total / locked / available for the vault
 * panel. Re-fetches whenever a vault action or order notifies
 * `notifyVaultChanged()`.
 */
export function useSpotBalances(
  wallet: string | null,
  _symbol: string,
  pair?: SpotPair
) {
  const [base, setBase] = useState<number | null>(null)
  const [quote, setQuote] = useState<number | null>(null)
  const [baseRow, setBaseRow] = useState<SpotBalance | null>(null)
  const [quoteRow, setQuoteRow] = useState<SpotBalance | null>(null)
  const [session, setSession] = useState<string | null>(() =>
    getReadSessionToken(wallet)
  )
  const [n, setN] = useState(0)
  const refresh = useCallback(() => setN(x => x + 1), [])
  useEffect(() => subscribeVaultChanged(refresh), [refresh])

  useEffect(() => {
    const sync = () => setSession(getReadSessionToken(wallet))
    sync()
    return subscribeReadSession(sync)
  }, [wallet])

  useEffect(() => {
    setBase(null)
    setQuote(null)
    setBaseRow(null)
    setQuoteRow(null)
    if (!wallet || !session || !pair) return
    let alive = true

    spotApi
      .getBalances(wallet, { sessionToken: session })
      .then(({ balances }) => {
        if (!alive) return
        const rowFor = (token: string, native: boolean): SpotBalance => {
          const key = native ? NATIVE_VAULT_TOKEN : token
          return (
            balances.find(b => b.token === key) ?? {
              token: key,
              total: '0',
              locked: '0',
              available: '0'
            }
          )
        }
        const b = rowFor(pair.baseToken, pair.isNativeBase)
        const q = rowFor(pair.quoteToken, pair.isNativeQuote)
        setBaseRow(b)
        setQuoteRow(q)
        setBase(Math.max(0, Number(b.available || '0')))
        setQuote(Math.max(0, Number(q.available || '0')))
      })
      .catch(() => {
        if (!alive) return
        setBase(null)
        setQuote(null)
        setBaseRow(null)
        setQuoteRow(null)
      })

    return () => {
      alive = false
    }
  }, [wallet, session, pair, n])

  return { base, quote, baseRow, quoteRow, refresh }
}
