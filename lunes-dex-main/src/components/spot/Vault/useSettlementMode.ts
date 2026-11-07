import { useEffect, useState } from 'react'
import { spotApi } from 'services/spotService'
import type { SettlementMode } from './vaultMath'

let cached: Promise<SettlementMode> | null = null

/** Test hook: forget the cached settlement mode. */
export function resetSettlementModeCache(): void {
  cached = null
}

/**
 * Whether spot-api settles trades on the spot_settlement vault, and which
 * contract. `null` while loading or when the API is unreachable — callers
 * must treat unknown as "not settled" and keep vault actions disabled.
 */
export function useSettlementMode(): SettlementMode | null {
  const [mode, setMode] = useState<SettlementMode | null>(null)
  useEffect(() => {
    let alive = true
    if (!cached) {
      cached = spotApi.getSettlementMode().then(m => ({
        settlementEnabled: m.settlementEnabled === true,
        contractAddress: m.contractAddress || null
      }))
      // Do not cache a failure: the next mount retries.
      cached.catch(() => {
        cached = null
      })
    }
    cached
      .then(m => alive && setMode(m))
      .catch(() => alive && setMode(null))
    return () => {
      alive = false
    }
  }, [])
  return mode
}
