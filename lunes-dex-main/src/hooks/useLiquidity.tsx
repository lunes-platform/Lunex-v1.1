import { useState, useEffect, useCallback, useRef } from 'react'
import { getWalletAccount } from '../wallet/activeWallet'
import { useSDK, parseBlockchainError } from '../context/SDKContext'
import { contractService } from '../services/contractService'
import { CONTRACTS } from '../config/contracts'
import { isLunes, toRoutingAddress } from '../utils/nativeToken'

export interface LiquidityToken {
  address: string
  symbol: string
  name: string
  decimals: number
  icon?: string
  isNative?: boolean
}

export interface PoolInfo {
  pairAddress: string
  /** Raw reserves in the pair's own token0/token1 order. */
  reserve0: string
  reserve1: string
  /** Raw reserves oriented to the selected tokenA / tokenB. */
  reserveA: string
  reserveB: string
  totalSupply: string
  /** 1 tokenA = `rate` tokenB (decimals-adjusted). */
  rate: number
  token0Price: string
  token1Price: string
  poolShare: string
  lpBalance: string
}

/** LP tokens carry no decimals on-chain; the UI displays them with 8. */
export const LP_DECIMALS = 8

interface UseLiquidityReturn {
  tokenA: LiquidityToken | null
  tokenB: LiquidityToken | null
  amountA: string
  amountB: string
  poolInfo: PoolInfo | null
  /** true once the pair was looked up and no pool exists. */
  isNewPool: boolean
  isLoading: boolean
  error: string | null
  slippage: number

  setTokenA: (token: LiquidityToken | null) => void
  setTokenB: (token: LiquidityToken | null) => void
  setAmountA: (amount: string) => void
  setAmountB: (amount: string) => void
  setSlippage: (slippage: number) => void
  /** Tokens whose router allowance is below the amount being deposited. */
  getMissingApprovals: () => Promise<LiquidityToken[]>
  /** Whether the LP token needs a router approval before withdrawing. */
  needsLpApproval: (lpAmount: string) => Promise<boolean>
  /** Approve the router to spend `amountWei` of `tokenAddress`. */
  approve: (
    tokenAddress: string,
    amountWei: string,
    label: string
  ) => Promise<boolean>
  /** Throws with a readable message when the deposit fails. */
  addLiquidity: () => Promise<boolean>
  /** Throws with a readable message when the withdrawal fails. */
  removeLiquidity: (lpAmount: string) => Promise<boolean>
  refreshPoolInfo: () => Promise<void>
}

const toBig = (v: string | null | undefined) => {
  try {
    return BigInt(v || '0')
  } catch {
    return BigInt(0)
  }
}

const useLiquidity = (): UseLiquidityReturn => {
  const sdk = useSDK()

  const [tokenA, setTokenA] = useState<LiquidityToken | null>(null)
  const [tokenB, setTokenB] = useState<LiquidityToken | null>(null)
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null)
  const [isNewPool, setIsNewPool] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slippage, setSlippage] = useState(0.5) // 0.5% default

  // The SDK swallows its errors into state; keep the latest for messages.
  const sdkErrorRef = useRef<string | null>(sdk.error)
  sdkErrorRef.current = sdk.error
  const reqId = useRef(0)

  const sdkFailure = async (fallback: string): Promise<never> => {
    // let the SDK's setError commit before reading it
    await new Promise(r => setTimeout(r, 0))
    throw new Error(sdkErrorRef.current || fallback)
  }

  const refreshPoolInfo = useCallback(async () => {
    const id = ++reqId.current
    if (!tokenA || !tokenB || tokenA.address === tokenB.address) {
      setPoolInfo(null)
      setIsNewPool(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Pools trade WLUNES/X — route the native sentinel to the WLUNES address
      // so pair lookups (and price math) hit the real on-chain pair.
      const routedA = toRoutingAddress(tokenA)
      const routedB = toRoutingAddress(tokenB)
      const pairInfo = await sdk.getPairInfo(routedA, routedB)
      if (id !== reqId.current) return

      if (pairInfo) {
        // getPairInfo echoes the caller's order as token0; the pair stores
        // reserves in its own canonical order, so ask the pair (BUG-01).
        const pairToken0 =
          (await sdk.getPairToken0(pairInfo.address)) ?? routedA
        if (id !== reqId.current) return
        const aIsToken0 = pairToken0.toLowerCase() === routedA.toLowerCase()
        const reserveA = aIsToken0 ? pairInfo.reserve0 : pairInfo.reserve1
        const reserveB = aIsToken0 ? pairInfo.reserve1 : pairInfo.reserve0
        const rA = toBig(reserveA)
        const rB = toBig(reserveB)
        const totalSupply = toBig(pairInfo.totalSupply)

        let lpBalance = '0'
        let poolShare = '0'
        if (sdk.walletAddress) {
          lpBalance = await sdk.getTokenBalance(
            pairInfo.address,
            sdk.walletAddress
          )
          if (id !== reqId.current) return
          if (totalSupply > BigInt(0)) {
            const share = (toBig(lpBalance) * BigInt(10000)) / totalSupply
            poolShare = (Number(share) / 100).toFixed(2)
          }
        }

        const humanA = Number(rA) / Math.pow(10, tokenA.decimals)
        const humanB = Number(rB) / Math.pow(10, tokenB.decimals)
        const rate = humanA > 0 ? humanB / humanA : 0

        setPoolInfo({
          pairAddress: pairInfo.address,
          reserve0: pairInfo.reserve0,
          reserve1: pairInfo.reserve1,
          reserveA,
          reserveB,
          totalSupply: pairInfo.totalSupply,
          rate,
          token0Price: rate ? String(rate) : '0',
          token1Price: rate ? String(1 / rate) : '0',
          poolShare,
          lpBalance
        })
        setIsNewPool(rA === BigInt(0) && rB === BigInt(0))
      } else {
        setPoolInfo(null)
        setIsNewPool(true)
      }
    } catch (err: unknown) {
      if (id !== reqId.current) return
      setError(parseBlockchainError(err))
      console.error('Error fetching pool info:', err)
    } finally {
      if (id === reqId.current) setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA, tokenB, sdk.walletAddress])

  useEffect(() => {
    refreshPoolInfo()
  }, [refreshPoolInfo])

  // Paired amount follows the pool price (read-only while a pool exists)
  useEffect(() => {
    if (!poolInfo || !tokenA || !tokenB) return
    const rA = toBig(poolInfo.reserveA)
    const rB = toBig(poolInfo.reserveB)
    if (rA <= BigInt(0) || rB <= BigInt(0)) return
    if (!amountA || !(parseFloat(amountA) > 0)) {
      setAmountB('')
      return
    }
    const amountAWei = toBig(sdk.parseAmount(amountA, tokenA.decimals))
    const amountBWei = (amountAWei * rB) / rA
    setAmountB(sdk.formatAmount(amountBWei.toString(), tokenB.decimals))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountA, poolInfo, tokenA, tokenB])

  const findAccount = useCallback(async () => {
    if (!sdk.walletAddress) throw new Error('Connect your wallet')
    const account = getWalletAccount(sdk.walletAddress)
    if (!account) throw new Error('Could not find the wallet account')
    return account
  }, [sdk.walletAddress])

  const getMissingApprovals = useCallback(async (): Promise<
    LiquidityToken[]
  > => {
    if (!tokenA || !tokenB || !sdk.walletAddress) return []
    const wallet = sdk.walletAddress
    const pairs: [LiquidityToken, string][] = [
      [tokenA, sdk.parseAmount(amountA, tokenA.decimals)],
      [tokenB, sdk.parseAmount(amountB, tokenB.decimals)]
    ]
    try {
      const res = await Promise.all(
        pairs.map(async ([t, want]) => {
          if (isLunes(t)) return null
          const allowance = await contractService.getAllowance(
            t.address,
            wallet,
            CONTRACTS.ROUTER
          )
          return toBig(allowance) < toBig(want) ? t : null
        })
      )
      return res.filter((t): t is LiquidityToken => t !== null)
    } catch {
      // allowance unknown — the SDK still approves inside addLiquidity
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA, tokenB, amountA, amountB, sdk.walletAddress])

  const needsLpApproval = useCallback(
    async (lpAmount: string): Promise<boolean> => {
      if (!poolInfo || !sdk.walletAddress) return false
      try {
        const allowance = await contractService.getAllowance(
          poolInfo.pairAddress,
          sdk.walletAddress,
          CONTRACTS.ROUTER
        )
        return toBig(allowance) < toBig(lpAmount)
      } catch {
        return false
      }
    },
    [poolInfo, sdk.walletAddress]
  )

  const approve = useCallback(
    async (tokenAddress: string, amountWei: string, label: string) => {
      const account = await findAccount()
      const ok = await contractService.approveToken(
        tokenAddress,
        CONTRACTS.ROUTER,
        amountWei,
        account
      )
      if (!ok) throw new Error(`${label} approval was not signed or failed`)
      return true
    },
    [findAccount]
  )

  const addLiquidity = useCallback(async (): Promise<boolean> => {
    if (!tokenA || !tokenB || !amountA || !amountB) {
      throw new Error('Fill in both amounts')
    }
    if (!sdk.walletAddress) throw new Error('Connect your wallet')

    setIsLoading(true)
    setError(null)
    try {
      const amountAWei = sdk.parseAmount(amountA, tokenA.decimals)
      const amountBWei = sdk.parseAmount(amountB, tokenB.decimals)
      const amountAMin = sdk.calculateMinAmount(amountAWei, slippage)
      const amountBMin = sdk.calculateMinAmount(amountBWei, slippage)
      const deadline = sdk.calculateDeadline(20)

      // Flag the native side so the SDK uses add_liquidity_native (native
      // amount attached as value) on the WLUNES pair.
      const nativeSide = isLunes(tokenA)
        ? 'A'
        : isLunes(tokenB)
          ? 'B'
          : undefined

      const ok = await sdk.addLiquidity({
        tokenA: toRoutingAddress(tokenA),
        tokenB: toRoutingAddress(tokenB),
        nativeSide,
        amountADesired: amountAWei,
        amountBDesired: amountBWei,
        amountAMin,
        amountBMin,
        to: sdk.walletAddress,
        deadline
      })
      if (!ok) return await sdkFailure('Liquidity was not added')

      setAmountA('')
      setAmountB('')
      await refreshPoolInfo()
      return true
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      throw err
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA, tokenB, amountA, amountB, slippage, sdk, refreshPoolInfo])

  const removeLiquidity = useCallback(
    async (lpAmount: string): Promise<boolean> => {
      if (!tokenA || !tokenB || !lpAmount || !poolInfo) {
        throw new Error('Pick a position to withdraw from')
      }
      if (!sdk.walletAddress) throw new Error('Connect your wallet')

      setIsLoading(true)
      setError(null)
      try {
        const deadline = sdk.calculateDeadline(20)
        const lp = toBig(lpAmount)
        const totalSupply = toBig(poolInfo.totalSupply)
        if (totalSupply <= BigInt(0)) throw new Error('Pool has no liquidity')

        const amountAExpected = (lp * toBig(poolInfo.reserveA)) / totalSupply
        const amountBExpected = (lp * toBig(poolInfo.reserveB)) / totalSupply

        const ok = await sdk.removeLiquidity({
          tokenA: toRoutingAddress(tokenA),
          tokenB: toRoutingAddress(tokenB),
          liquidity: lpAmount,
          amountAMin: sdk.calculateMinAmount(
            amountAExpected.toString(),
            slippage
          ),
          amountBMin: sdk.calculateMinAmount(
            amountBExpected.toString(),
            slippage
          ),
          to: sdk.walletAddress,
          deadline
        })
        if (!ok) return await sdkFailure('Liquidity was not removed')

        await refreshPoolInfo()
        return true
      } catch (err: unknown) {
        setError(parseBlockchainError(err))
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokenA, tokenB, poolInfo, slippage, sdk, refreshPoolInfo]
  )

  return {
    tokenA,
    tokenB,
    amountA,
    amountB,
    poolInfo,
    isNewPool,
    isLoading,
    error,
    slippage,
    setTokenA,
    setTokenB,
    setAmountA,
    setAmountB,
    setSlippage,
    getMissingApprovals,
    needsLpApproval,
    approve,
    addLiquidity,
    removeLiquidity,
    refreshPoolInfo
  }
}

export default useLiquidity
