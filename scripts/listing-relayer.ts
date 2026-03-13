#!/usr/bin/env ts-node
/**
 * listing-relayer.ts
 *
 * Listens for on-chain TokenListed and LiquidityLocked events emitted by the
 * ListingManager and LiquidityLock contracts, then calls the spot-api to
 * activate or update the corresponding database records.
 *
 * Usage:
 *   npx ts-node scripts/listing-relayer.ts
 *
 * Required env vars (reads from spot-api/.env automatically):
 *   LISTING_MANAGER_CONTRACT_ADDRESS
 *   LIQUIDITY_LOCK_CONTRACT_ADDRESS
 *   LUNES_WS_URL                       (default: ws://127.0.0.1:9944)
 *   SPOT_API_URL                       (default: http://localhost:4000)
 */

import { ApiPromise, WsProvider } from '@polkadot/api'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// ── Load env ──────────────────────────────────────────────────────

const envPath = path.resolve(__dirname, '../spot-api/.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
  console.log(`[relayer] Loaded env from ${envPath}`)
} else {
  dotenv.config()
}

const WS_URL          = process.env.LUNES_WS_URL                       || 'ws://127.0.0.1:9944'
const API_BASE        = process.env.SPOT_API_URL                        || 'http://localhost:4000'
const MANAGER_ADDR    = process.env.LISTING_MANAGER_CONTRACT_ADDRESS    || ''
const LOCK_ADDR       = process.env.LIQUIDITY_LOCK_CONTRACT_ADDRESS     || ''

// ── Types ─────────────────────────────────────────────────────────

interface TokenListedEvent {
  listingId:   number
  owner:       string
  tokenAddress: string
  pairAddress:  string
  tier:         number
  lockId:       number
}

interface LiquidityLockedEvent {
  lockId:          number
  owner:           string
  pairAddress:     string
  lpAmount:        string
  unlockTimestamp: string
  tier:            number
}

// ── Logger ────────────────────────────────────────────────────────

function log(msg: string)  { console.log(`[relayer] ${msg}`) }
function warn(msg: string) { console.warn(`[relayer] ⚠ ${msg}`) }
function err(msg: string)  { console.error(`[relayer] ❌ ${msg}`) }

// ── API calls ─────────────────────────────────────────────────────

async function activateListing(listingId: string, onChainId: number) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/listing/${listingId}/activate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ onChainListingId: onChainId }),
    })
    const data = await res.json()
    if (!res.ok) {
      err(`Failed to activate listing ${listingId}: ${data.error}`)
      return false
    }
    log(`✅ Listing ${listingId} activated (on-chain ID: ${onChainId})`)
    return true
  } catch (e) {
    err(`Network error activating listing ${listingId}: ${e}`)
    return false
  }
}

async function findListingByTokenAddress(tokenAddress: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/listing/token/${tokenAddress}`)
    if (res.status === 404) return null
    const data = await res.json()
    return data.id ?? null
  } catch {
    return null
  }
}

async function withdrawLockRecord(lockId: string, ownerAddress: string, txHash: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/listing/lock/${lockId}/withdraw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ownerAddress, txHash }),
    })
    const data = await res.json()
    if (!res.ok) {
      warn(`Failed to mark lock ${lockId} withdrawn: ${data.error}`)
      return false
    }
    log(`✅ Lock ${lockId} marked as withdrawn`)
    return true
  } catch (e) {
    err(`Network error withdrawing lock ${lockId}: ${e}`)
    return false
  }
}

// ── Event decoders ────────────────────────────────────────────────

function decodeTokenListedEvent(data: any[]): TokenListedEvent | null {
  try {
    return {
      listingId:    Number(data[0]),
      owner:        String(data[1]),
      tokenAddress: String(data[2]),
      pairAddress:  String(data[3]),
      tier:         Number(data[4]),
      lockId:       Number(data[5]),
    }
  } catch {
    return null
  }
}

function decodeLiquidityLockedEvent(data: any[]): LiquidityLockedEvent | null {
  try {
    return {
      lockId:          Number(data[0]),
      owner:           String(data[1]),
      pairAddress:     String(data[2]),
      lpAmount:        String(data[3]),
      unlockTimestamp: String(data[4]),
      tier:            Number(data[5]),
    }
  } catch {
    return null
  }
}

function decodeLiquidityUnlockedEvent(data: any[]): { lockId: number; owner: string; lpAmount: string } | null {
  try {
    return {
      lockId:   Number(data[0]),
      owner:    String(data[1]),
      lpAmount: String(data[2]),
    }
  } catch {
    return null
  }
}

// ── Reconnect with exponential backoff ───────────────────────────

async function connectWithRetry(wsUrl: string, maxRetries = 10): Promise<ApiPromise> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`Connecting to ${wsUrl} (attempt ${attempt})…`)
      const provider = new WsProvider(wsUrl)
      const api = await ApiPromise.create({ provider })
      await api.isReady
      log('Connected ✅')
      return api
    } catch (e) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000)
      warn(`Connection failed: ${e}. Retrying in ${delay / 1000}s…`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error(`Failed to connect to ${wsUrl} after ${maxRetries} attempts`)
}

// ── Main event loop ───────────────────────────────────────────────

async function main() {
  if (!MANAGER_ADDR) {
    err('LISTING_MANAGER_CONTRACT_ADDRESS is not set. Run deploy-listing-contracts.ts first.')
    process.exit(1)
  }
  if (!LOCK_ADDR) {
    err('LIQUIDITY_LOCK_CONTRACT_ADDRESS is not set. Run deploy-listing-contracts.ts first.')
    process.exit(1)
  }

  log(`Listing Manager : ${MANAGER_ADDR}`)
  log(`Liquidity Lock  : ${LOCK_ADDR}`)
  log(`API endpoint    : ${API_BASE}`)

  // Verify API is reachable
  try {
    const health = await fetch(`${API_BASE}/health`)
    const data   = await health.json()
    log(`API health: ${data.status} | DB: ${data.db} | Redis: ${data.redis}`)
  } catch {
    warn('Could not reach spot-api /health — will retry events anyway')
  }

  let api = await connectWithRetry(WS_URL)

  log('Subscribing to contracts.ContractEmitted events…')

  // Track processed events to avoid duplicates after reconnects
  const processed = new Set<string>()

  let unsub: (() => void) | null = null

  async function subscribe() {
    unsub = await api.query.system.events((events: any[]) => {
      for (const record of events) {
        const { event } = record

        if (event.section !== 'contracts' || event.method !== 'ContractEmitted') {
          continue
        }

        const [contractAddr, eventData] = event.data as any[]
        const addr = contractAddr.toString()

        // Deduplicate by block hash + event index
        const dedupKey = `${event.hash?.toString() ?? ''}:${addr}:${eventData.toString().slice(0, 32)}`
        if (processed.has(dedupKey)) continue
        processed.add(dedupKey)

        const rawData = eventData.toJSON ? eventData.toJSON() : []

        if (addr === MANAGER_ADDR) {
          handleManagerEvent(rawData)
        } else if (addr === LOCK_ADDR) {
          handleLockEvent(rawData)
        }
      }
    }) as unknown as () => void
  }

  function handleManagerEvent(rawData: any) {
    // The event identifier is encoded in the first topic byte of the data.
    // For simplicity we attempt to decode all known event shapes.

    // Try TokenListed
    const listed = decodeTokenListedEvent(Array.isArray(rawData) ? rawData : [])
    if (listed && listed.tokenAddress) {
      log(`📋 TokenListed event — token: ${listed.tokenAddress}, tier: ${listed.tier}, on-chain ID: ${listed.listingId}`)

      // Find the DB listing by token address and activate it
      findListingByTokenAddress(listed.tokenAddress).then((dbId) => {
        if (!dbId) {
          warn(`No DB listing found for token ${listed.tokenAddress}`)
          return
        }
        activateListing(dbId, listed.listingId)
      }).catch((e) => {
        err(`Error looking up listing for ${listed.tokenAddress}: ${e}`)
      })
    }

    // Try FeeDistributed
    if (Array.isArray(rawData) && rawData.length >= 4 && !listed?.tokenAddress) {
      log(`💸 FeeDistributed — listing ${rawData[0]}: burn=${rawData[1]}, treasury=${rawData[2]}, rewards=${rawData[3]}`)
    }
  }

  function handleLockEvent(rawData: any) {
    const arr = Array.isArray(rawData) ? rawData : []

    // LiquidityLocked has 6 fields
    if (arr.length >= 6) {
      const locked = decodeLiquidityLockedEvent(arr)
      if (locked) {
        log(`🔒 LiquidityLocked — lock ${locked.lockId}, owner: ${locked.owner}, tier: ${locked.tier}, unlock: ${locked.unlockTimestamp}`)
        return
      }
    }

    // LiquidityUnlocked has 3 fields
    if (arr.length === 3) {
      const unlocked = decodeLiquidityUnlockedEvent(arr)
      if (unlocked) {
        log(`🔓 LiquidityUnlocked — lock ${unlocked.lockId}, owner: ${unlocked.owner}, amount: ${unlocked.lpAmount}`)
        withdrawLockRecord(String(unlocked.lockId), unlocked.owner, 'on-chain')
      }
    }
  }

  await subscribe()
  log('Listening for listing events… (Ctrl+C to stop)')

  // ── Handle disconnections ────────────────────────────────────────
  api.on('disconnected', async () => {
    warn('Node disconnected — reconnecting…')
    if (unsub) { try { unsub() } catch {} }

    await new Promise(r => setTimeout(r, 3_000))
    try {
      api = await connectWithRetry(WS_URL)
      await subscribe()
      log('Resubscribed after reconnect')
    } catch (e) {
      err(`Failed to reconnect: ${e}`)
      process.exit(1)
    }
  })

  // Keep process alive
  process.on('SIGINT',  () => { if (unsub) unsub(); api.disconnect(); process.exit(0) })
  process.on('SIGTERM', () => { if (unsub) unsub(); api.disconnect(); process.exit(0) })
}

main().catch((e) => {
  err(String(e))
  process.exit(1)
})
