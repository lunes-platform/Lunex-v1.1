/**
 * useNetworkStatus — drives the SystemBanner from RPC health.
 *
 * - testnet:     REACT_APP_NETWORK=testnet (informational).
 * - maintenance: REACT_APP_MAINTENANCE=true.
 * - degraded:    RPC disconnected, or the last two blocks took > 2x the
 *                expected 6s block time.
 * - wrong:       the connected node's genesis hash / chain name does not
 *                match REACT_APP_LUNES_GENESIS_HASH (alias REACT_APP_GENESIS_HASH)
 *                / REACT_APP_CHAIN_NAME (each is
 *                only checked when set).
 * Can be forced for QA with ?network=degraded|wrong|maintenance|testnet|ok.
 *
 * Env is read with explicit `process.env.REACT_APP_*` accesses: Vite only
 * replaces those (vite.config `define`); the previous dynamic
 * `import.meta.env[key]` read was always undefined, so the genesis and
 * maintenance checks never ran.
 */
import { useEffect, useState } from 'react'
import contractService from '../services/contractService'
import { NETWORK } from '../config/contracts'

export type NetworkStatus =
  'ok' | 'degraded' | 'wrong' | 'maintenance' | 'testnet'

const BLOCK_MS = 6000

export type NetworkExpectations = {
  genesisHash?: string
  chainName?: string
  maintenance: boolean
}

export const readNetworkEnv = (): NetworkExpectations => ({
  // REACT_APP_LUNES_GENESIS_HASH is the same value the signing code binds
  // messages to; REACT_APP_GENESIS_HASH is kept as a legacy alias.
  genesisHash:
    (
      process.env.REACT_APP_LUNES_GENESIS_HASH ||
      process.env.REACT_APP_GENESIS_HASH ||
      ''
    ).trim() || undefined,
  chainName: (process.env.REACT_APP_CHAIN_NAME || '').trim() || undefined,
  maintenance: process.env.REACT_APP_MAINTENANCE === 'true'
})

/** Pure check: does the connected node match the expected network? */
export const isWrongNetwork = (
  actual: { genesisHash?: string; chainName?: string },
  expected: Pick<NetworkExpectations, 'genesisHash' | 'chainName'>
): boolean => {
  if (
    expected.genesisHash &&
    actual.genesisHash &&
    actual.genesisHash.toLowerCase() !== expected.genesisHash.toLowerCase()
  )
    return true
  if (
    expected.chainName &&
    actual.chainName &&
    actual.chainName.trim().toLowerCase() !==
      expected.chainName.trim().toLowerCase()
  )
    return true
  return false
}

/** Final banner state from health + env (pure, testable). */
export const resolveNetworkStatus = (
  health: 'ok' | 'degraded' | 'wrong',
  opts: { maintenance: boolean; network: string; forced?: NetworkStatus | null }
): NetworkStatus => {
  if (opts.forced) return opts.forced
  if (health !== 'ok') return health
  if (opts.maintenance) return 'maintenance'
  if (opts.network !== 'mainnet') return 'testnet'
  return 'ok'
}

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
    const healthRef = { wrong: false }

    const attach = async () => {
      const api = contractService.getApi()
      if (!api) return false
      try {
        const expected = readNetworkEnv()
        if (expected.genesisHash || expected.chainName) {
          const chainName = expected.chainName
            ? String(await api.rpc.system.chain())
            : undefined
          if (
            isWrongNetwork(
              { genesisHash: api.genesisHash.toHex(), chainName },
              expected
            )
          ) {
            healthRef.wrong = true
            setHealth('wrong')
            return true
          }
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
      // The RPC may connect late (wallet flow, slow node): keep waiting.
      while (!cancelled) {
        if (await attach()) break
        await new Promise(r => setTimeout(r, 1500))
      }
      if (cancelled) return
      poll = setInterval(() => {
        if (healthRef.wrong) return
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

  const status = resolveNetworkStatus(health, {
    maintenance: readNetworkEnv().maintenance,
    network: NETWORK.name,
    forced: force
  })

  const switchNetwork = async () => {
    // Substrate extensions don't expose a network switch API; reconnect the
    // RPC and re-check. Users on another chain must switch in the extension.
    try {
      await contractService.connect(NETWORK.name)
      const api = contractService.getApi()
      const expected = readNetworkEnv()
      if (api && (expected.genesisHash || expected.chainName)) {
        const chainName = expected.chainName
          ? String(await api.rpc.system.chain())
          : undefined
        const wrong = isWrongNetwork(
          { genesisHash: api.genesisHash.toHex(), chainName },
          expected
        )
        setHealth(wrong ? 'wrong' : 'ok')
      } else {
        setHealth('ok')
      }
    } catch {
      /* keep banner */
    }
  }

  return { status, switchNetwork }
}
