/**
 * usePools Hook
 * Fetches real liquidity pool data from deployed ink! contracts via factory discovery.
 * Queries factory.allPairsLength() + factory.allPairs(i) to get only real deployed pairs.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSDK } from '../context/SDKContext'
import { contractService } from '../services/contractService'

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

// Known token metadata keyed by SS58 address
const TOKEN_META: Record<
  string,
  { symbol: string; name: string; decimals: number; icon: string }
> = {
  [process.env.REACT_APP_TOKEN_WLUNES ||
  '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo']: {
    symbol: 'WLUNES',
    name: 'Wrapped Lunes',
    decimals: 8,
    icon: '/img/lunes.svg'
  },
  [process.env.REACT_APP_TOKEN_LUSDT ||
  '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf']: {
    symbol: 'LUSDT',
    name: 'Lunes USD',
    decimals: 6,
    icon: '/img/lusdt.png'
  },
  [process.env.REACT_APP_TOKEN_LBTC ||
  '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg']: {
    symbol: 'LBTC',
    name: 'Lunes BTC',
    decimals: 8,
    icon: '/img/lbtc.svg'
  },
  [process.env.REACT_APP_TOKEN_LETH ||
  '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS']: {
    symbol: 'LETH',
    name: 'Lunes ETH',
    decimals: 8,
    icon: '/img/leth.svg'
  },
  [process.env.REACT_APP_TOKEN_GMC ||
  '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ']: {
    symbol: 'GMC',
    name: 'GameCoin',
    decimals: 8,
    icon: '/img/gmc.svg'
  },
  [process.env.REACT_APP_TOKEN_LUP ||
  '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3']: {
    symbol: 'LUP',
    name: 'Lunex Protocol',
    decimals: 8,
    icon: '/img/up.svg'
  }
}

/** Tokens that can be paired in a pool (factory-listed, with metadata). */
export const LIQUIDITY_TOKENS: KnownToken[] = Object.entries(TOKEN_META).map(
  ([address, meta]) => ({ address, ...meta })
)

// LUSDT address for TVL calculation (the USD quote token)
const LUSDT_ADDRESS = (
  process.env.REACT_APP_TOKEN_LUSDT ||
  '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'
).toLowerCase()
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

function resolveTokenMeta(address: string) {
  const key = Object.keys(TOKEN_META).find(
    k => k.toLowerCase() === address.toLowerCase()
  )
  return key
    ? TOKEN_META[key]
    : {
        symbol: address.slice(0, 6) + '…',
        name: 'Unknown Token',
        decimals: 8,
        icon: ''
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
      const factoryAddr =
        process.env.REACT_APP_FACTORY_CONTRACT ||
        '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2'
      const routerAddr =
        process.env.REACT_APP_ROUTER_CONTRACT ||
        '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B'
      const wnativeAddr =
        process.env.REACT_APP_WNATIVE_CONTRACT ||
        '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'
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

          const tok0Meta = resolveTokenMeta(token0Addr)
          const tok1Meta = resolveTokenMeta(token1Addr)

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
