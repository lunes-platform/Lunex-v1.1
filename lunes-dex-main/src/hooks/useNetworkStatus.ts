/**
 * useNetworkStatus — drives the SystemBanner from RPC health.
 *
 * - testnet:     REACT_APP_NETWORK=testnet (informational).
 * - maintenance: REACT_APP_MAINTENANCE=true.
 * - degraded:    RPC disconnected, or the last two blocks took > 2x the
 *                expected 6s block time.
 * - wrong:       the RPC genesis hash does not match REACT_APP_GENESIS_HASH
 *                (only checked when that variable is set).
 * Can be forced for QA with ?network=degraded|wrong|maintenance|testnet|ok.
 */
import { useEffect, useState } from 'react'
import contractService from '../services/contractService'
import { NETWORK } from '../config/contracts'

export type NetworkStatus =
  'ok' | 'degraded' | 'wrong' | 'maintenance' | 'testnet'

const BLOCK_MS = 6000
const env = (k: string): string | undefined =>
  (import.meta.env as Record<string, string | undefined>)[k]

const forced = (): NetworkStatus | null => {
  try {
    const v = new URLSearchParams(window.location.search).get('network')
    return v &&
      ['ok', 'degraded', 'wrong', 'maintenance', 'testnet'].includes(v)
      ? (v as NetworkStatus)
      : null
  } catch {
    return null
  }
}

export const useNetworkStatus = () => {
  const [health, setHealth] = useState<'ok' | 'degraded' | 'wrong'>('ok')
  const [force] = useState(forced)

  useEffect(() => {
    let unsub: (() => void) | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let last = 0
    let slowCount = 0
    let cancelled = false

    const attach = async () => {
      const api = contractService.getApi()
      if (!api) return false
      try {
        const genesis = env('REACT_APP_GENESIS_HASH')
        if (genesis && api.genesisHash.toHex() !== genesis) {
          setHealth('wrong')
          return true
        }
        unsub = (await api.rpc.chain.subscribeNewHeads(() => {
          const now = Date.now()
          if (last) {
            slowCount = now - last > BLOCK_MS * 2 ? slowCount + 1 : 0
            setHealth(slowCount >= 2 ? 'degraded' : 'ok')
          }
          last = now
        })) as unknown as () => void
      } catch {
        /* subscription unsupported — rely on polling */
      }
      return true
    }

    const start = async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        if (await attach()) break
        await new Promise(r => setTimeout(r, 1500))
      }
      poll = setInterval(() => {
        const connected = contractService.getIsConnected()
        if (!connected) setHealth('degraded')
        else if (last && Date.now() - last > BLOCK_MS * 4) setHealth('degraded')
      }, 10000)
    }
    start()

    return () => {
      cancelled = true
      unsub?.()
      if (poll) clearInterval(poll)
    }
  }, [])

  let status: NetworkStatus = health
  if (status === 'ok' && env('REACT_APP_MAINTENANCE') === 'true')
    status = 'maintenance'
  if (status === 'ok' && NETWORK.name === 'testnet') status = 'testnet'
  if (force) status = force

  const switchNetwork = async () => {
    // Substrate extensions don't expose a network switch API; reconnect the
    // RPC and re-check. Users on another chain must switch in the extension.
    try {
      await contractService.connect(NETWORK.name)
      setHealth('ok')
    } catch {
      /* keep banner */
    }
  }

  return { status, switchNetwork }
}
