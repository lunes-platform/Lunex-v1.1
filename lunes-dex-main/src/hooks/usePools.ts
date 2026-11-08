/**
 * usePools Hook
 * Fetches real liquidity pool data from deployed ink! contracts via factory discovery.
 * Queries factory.allPairsLength() + factory.allPairs(i) to get only real deployed pairs.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSDK } from '../context/SDKContext'
import { contractService } from '../services/contractService'
import { CONTRACTS, TOKENS } from '../config/contracts'

export interface Pool {
  id: string
  pairAddress: string
  token0: {
    address: string
    symbol: string
    name: string
    decimals: number
    icon: string
  }
  token1: {
    address: string
    symbol: string
    name: string
    decimals: number
    icon: string
  }
  reserve0: string
  reserve1: string
  totalSupply: string
  fee: string
  liquidity: number // USD value
  volume24h: number
  fees24h: number
  apr: number
  userLiquidity?: string
}

/** A wallet's LP position in one pool (raw LP balance + derived share). */
export interface PoolPosition {
  pairAddress: string
  lpBalance: string // raw LP token units
  share: number // % of the pool's LP supply
  valueUsd: number // share × TVL (0 when the pool has no USD price)
}

export interface KnownToken {
  address: string
  symbol: string
  name: string
  decimals: number
  icon: string
}

type TokenMeta = Omit<KnownToken, 'address'>

const tokenMeta = (address: string, meta: TokenMeta): [string, TokenMeta] => [
  address,
  meta
]

const TOKEN_META_ENTRIES: Array<[string, TokenMeta]> = [
  tokenMeta(TOKENS.WLUNES, {
    symbol: 'WLUNES',
    name: 'Wrapped Lunes',
    decimals: 8,
    icon: '/img/lunes.svg'
  }),
  tokenMeta(TOKENS.LUSDT, {
    symbol: 'LUSDT',
    name: 'Lunes USD',
    decimals: 6,
    icon: '/img/lusdt.svg'
  }),
  tokenMeta(TOKENS.LBTC, {
    symbol: 'LBTC',
    name: 'Lunes BTC',
    decimals: 8,
    icon: '/img/lbtc.svg'
  }),
  tokenMeta(TOKENS.LETH, {
    symbol: 'LETH',
    name: 'Lunes ETH',
    decimals: 8,
    icon: '/img/leth.svg'
  }),
  tokenMeta(TOKENS.GMC, {
    symbol: 'GMC',
    name: 'GameCoin',
    decimals: 8,
    icon: '/img/gmc.svg'
  }),
  tokenMeta(TOKENS.LUP, {
    symbol: 'LUP',
    name: 'Lunex Protocol',
    decimals: 8,
    icon: '/img/lup.svg'
  })
].filter(([address]) => address)

const TOKEN_META = Object.fromEntries(TOKEN_META_ENTRIES)

/** Tokens that can be paired in a pool (factory-listed, with metadata). */
export const LIQUIDITY_TOKENS: KnownToken[] = Object.entries(TOKEN_META).map(
  ([address, meta]) => ({ address, ...meta })
)

// LUSDT address for TVL calculation (the USD quote token)
const LUSDT_ADDRESS = TOKENS.LUSDT.toLowerCase()
const LUSDT_DECIMALS = 6

const SPOT_API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// Fetch the spot-api pair list once per refresh (24h volume source)
async function fetchSpotPairs(): Promise<any[]> {
  try {
    const res = await fetch(`${SPOT_API}/api/v1/pairs`)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : (data.pairs ?? [])
  } catch {
    return []
  }
}

// 24h volume for a pair symbol from the spot-api pair list
function volume24hFor(pairs: any[], sym0: string, sym1: string): number {
  try {
    const candidates = [`${sym0}/${sym1}`, `${sym1}/${sym0}`]
    const pair = pairs.find(
      (p: any) =>
        candidates.includes(p.symbol) ||
        candidates.includes(`${String(p.baseAsset)}/${String(p.quoteAsset)}`)
    )
    return Number(pair?.volume24h ?? pair?.quoteVolume24h ?? 0)
  } catch {
    return 0
  }
}

async function resolveTokenMeta(address: string): Promise<TokenMeta> {
  const key = Object.keys(TOKEN_META).find(
    k => k.toLowerCase() === address.toLowerCase()
  )
  const metadata = await contractService.getTokenInfo(address)
  if (!metadata) throw new Error('Token metadata unavailable')
  const registered = key ? TOKEN_META[key] : undefined
  return {
    symbol: registered?.symbol ?? metadata.symbol,
    name: registered?.name ?? metadata.name,
    decimals: metadata.decimals,
    icon: registered?.icon ?? ''
  }
}

export const usePools = () => {
  const sdk = useSDK()
  const [pools, setPools] = useState<Pool[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, PoolPosition>>({})
  const [positionsLoading, setPositionsLoading] = useState(false)

  const fetchPools = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Connect to blockchain if needed
      if (!contractService.getIsConnected()) {
        const network = (process.env.REACT_APP_NETWORK || 'testnet') as
          'testnet' | 'mainnet'
        const ok = await contractService.connect(network)
        if (!ok) throw new Error('Cannot connect to blockchain')
      }

      // Initialise factory so allPairs* methods work
      const factoryAddr = CONTRACTS.FACTORY
      const routerAddr = CONTRACTS.ROUTER
      const wnativeAddr = CONTRACTS.WNATIVE
      if (!factoryAddr || !routerAddr || !wnativeAddr) {
        setPools([])
        return
      }
      contractService.setContracts({
        factory: factoryAddr,
        router: routerAddr,
        wnative: wnativeAddr
      })

      // Step 1 — query factory for number of deployed pairs
      const length = await contractService.allPairsLength()

      if (length === 0) {
        setPools([])
        return
      }

      const spotPairs = await fetchSpotPairs()

      // Step 2 — get all pair addresses
      const pairAddresses = await Promise.all(
        Array.from(
          { length },
          async (_, i) => await contractService.allPairs(i)
        )
      )
      const validAddresses = pairAddresses.filter(
        (a): a is string => a !== null
      )
      const metadata = new Map<string, Promise<TokenMeta>>()
      const tokenInfo = (address: string) => {
        if (!metadata.has(address))
          metadata.set(address, resolveTokenMeta(address))
        return metadata.get(address)!
      }

      // Step 3 — fetch on-chain data for each pair
      const results = await Promise.allSettled(
        validAddresses.map(async (pairAddress, idx) => {
          const [reserves, token0Addr, token1Addr, totalSupplyRaw] =
            await Promise.all([
              contractService.getReserves(pairAddress),
              contractService.getPairToken0(pairAddress),
              contractService.getPairToken1(pairAddress),
              contractService.getPairTotalSupply(pairAddress)
            ])

          if (!reserves || !token0Addr || !token1Addr) {
            return null
          }

          if (reserves.reserve0 === '0' && reserves.reserve1 === '0') {
            return null
          }

          const [tok0Meta, tok1Meta] = await Promise.all([
            tokenInfo(token0Addr),
            tokenInfo(token1Addr)
          ])

          // TVL = 2 × LUSDT reserve (AMM: equal value on both sides)
          const token0IsLusdt = token0Addr.toLowerCase() === LUSDT_ADDRESS
          const token1IsLusdt = token1Addr.toLowerCase() === LUSDT_ADDRESS

          let tvl = 0
          if (token0IsLusdt) {
            tvl = 2 * (Number(reserves.reserve0) / Math.pow(10, LUSDT_DECIMALS))
          } else if (token1IsLusdt) {
            tvl = 2 * (Number(reserves.reserve1) / Math.pow(10, LUSDT_DECIMALS))
          }
          // If neither token is LUSDT, TVL remains 0 (no USD price available)

          const volume24h = volume24hFor(
            spotPairs,
            tok0Meta.symbol,
            tok1Meta.symbol
          )
          // LPs earn 0.3% of the 0.5% swap fee (0.1% protocol, 0.1% stakers)
          const fees24h = volume24h * 0.003
          const apr = tvl > 0 ? ((fees24h * 365) / tvl) * 100 : 0

          const pool: Pool = {
            id: String(idx + 1),
            pairAddress,
            token0: { address: token0Addr, ...tok0Meta },
            token1: { address: token1Addr, ...tok1Meta },
            reserve0: reserves.reserve0,
            reserve1: reserves.reserve1,
            totalSupply: totalSupplyRaw,
            fee: '0.5%',
            liquidity: tvl,
            volume24h,
            fees24h,
            apr
          }
          return pool
        })
      )

      const fetched = results
        .filter(
          (r): r is PromiseFulfilledResult<Pool | null> =>
            r.status === 'fulfilled'
        )
        .map(r => r.value)
        .filter((p): p is Pool => p !== null)

      setPools(fetched)
      if (results.some(result => result.status === 'rejected')) {
        setError('Some pool data is unavailable. Please refresh.')
      }
    } catch (err) {
      console.error('[usePools] Error:', err)
      setError((err as Error).message)
      setPools([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const getUserLiquidity = useCallback(
    async (pairAddress: string): Promise<string> => {
      if (!sdk.walletAddress) return '0'
      try {
        return await contractService.getTokenBalance(
          pairAddress,
          sdk.walletAddress
        )
      } catch {
        return '0'
      }
    },
    [sdk.walletAddress]
  )

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  // LP positions of the connected wallet (LP token balance per pair)
  const wallet = sdk.walletAddress
  const fetchPositions = useCallback(async () => {
    if (!wallet || pools.length === 0) {
      setPositions({})
      return
    }
    setPositionsLoading(true)
    try {
      const entries = await Promise.all(
        pools.map(async pool => {
          const lp = await contractService
            .getTokenBalance(pool.pairAddress, wallet)
            .catch(() => '0')
          let lpBig = BigInt(0)
          try {
            lpBig = BigInt(lp || '0')
          } catch {
            lpBig = BigInt(0)
          }
          if (lpBig <= BigInt(0)) return null
          const supply = BigInt(pool.totalSupply || '0')
          const share =
            supply > BigInt(0)
              ? Number((lpBig * BigInt(1_000_000)) / supply) / 10_000
              : 0
          const pos: PoolPosition = {
            pairAddress: pool.pairAddress,
            lpBalance: lpBig.toString(),
            share,
            valueUsd: (pool.liquidity * share) / 100
          }
          return pos
        })
      )
      const map: Record<string, PoolPosition> = {}
      entries.forEach(p => {
        if (p) map[p.pairAddress] = p
      })
      setPositions(map)
    } finally {
      setPositionsLoading(false)
    }
  }, [wallet, pools])

  useEffect(() => {
    fetchPositions()
  }, [fetchPositions])

  // USD price per token symbol, derived from pools quoted in LUSDT
  const prices = useMemo(() => {
    const out: Record<string, number> = { LUSDT: 1 }
    pools.forEach(p => {
      const r0 = Number(p.reserve0) / Math.pow(10, p.token0.decimals)
      const r1 = Number(p.reserve1) / Math.pow(10, p.token1.decimals)
      if (!(r0 > 0 && r1 > 0)) return
      if (p.token1.symbol === 'LUSDT') out[p.token0.symbol] = r1 / r0
      else if (p.token0.symbol === 'LUSDT') out[p.token1.symbol] = r0 / r1
    })
    return out
  }, [pools])

  return {
    pools,
    isLoading,
    error,
    refreshPools: fetchPools,
    getUserLiquidity,
    positions,
    positionsLoading,
    refreshPositions: fetchPositions,
    prices
  }
}

export default usePools
