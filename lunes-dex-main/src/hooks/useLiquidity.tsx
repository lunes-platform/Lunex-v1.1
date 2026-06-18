import { useState, useEffect, useCallback } from 'react'
import { useSDK, parseBlockchainError } from '../context/SDKContext'
import { humanPrice } from '../utils/reserveUtils'
import { LP_TOKEN_DECIMALS } from '../config/contracts'
import { isLunes, toRoutingAddress } from '../utils/nativeToken'

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  icon?: string
}

interface PoolInfo {
  pairAddress: string
  reserve0: string
  reserve1: string
  totalSupply: string
  token0Price: string
  token1Price: string
  poolShare: string
  lpBalance: string
}

interface UseLiquidityReturn {
  // Estado
  tokenA: Token | null
  tokenB: Token | null
  amountA: string
  amountB: string
  poolInfo: PoolInfo | null
  isLoading: boolean
  error: string | null
  slippage: number

  // Ações
  setTokenA: (token: Token | null) => void
  setTokenB: (token: Token | null) => void
  setAmountA: (amount: string) => void
  setAmountB: (amount: string) => void
  setSlippage: (slippage: number) => void
  addLiquidity: () => Promise<boolean>
  removeLiquidity: (lpAmount: string, receiveNative?: boolean) => Promise<boolean>
  refreshPoolInfo: () => Promise<void>
}

const useLiquidity = (): UseLiquidityReturn => {
  const sdk = useSDK()

  // Estado local
  const [tokenA, setTokenA] = useState<Token | null>(null)
  const [tokenB, setTokenB] = useState<Token | null>(null)
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slippage, setSlippage] = useState(0.5) // 0.5% default

  // Buscar info do pool
  const refreshPoolInfo = useCallback(async () => {
    if (!tokenA || !tokenB) {
      setPoolInfo(null)
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

      if (pairInfo) {
        // Calcular preços e share
        const reserve0 = BigInt(pairInfo.reserve0)
        const reserve1 = BigInt(pairInfo.reserve1)
        const totalSupply = BigInt(pairInfo.totalSupply)

        let lpBalance = '0'
        let poolShare = '0'

        if (sdk.walletAddress) {
          lpBalance = await sdk.getTokenBalance(
            pairInfo.address,
            sdk.walletAddress
          )

          if (totalSupply > BigInt(0)) {
            const share = (BigInt(lpBalance) * BigInt(10000)) / totalSupply
            poolShare = (Number(share) / 100).toFixed(2)
          }
        }

        // Calcular preços relativos com ajuste de decimais
        let token0Price = '0'
        let token1Price = '0'

        if (reserve0 > BigInt(0) && reserve1 > BigInt(0) && tokenA && tokenB) {
          const pairToken0 =
            (await sdk.getPairToken0(pairInfo.address)) ?? routedA
          const decimals0 =
            pairToken0.toLowerCase() === routedA.toLowerCase()
              ? tokenA.decimals
              : tokenB.decimals
          const decimals1 =
            pairToken0.toLowerCase() === routedA.toLowerCase()
              ? tokenB.decimals
              : tokenA.decimals

          token0Price = humanPrice(
            pairToken0,
            routedA,
            pairInfo.reserve0,
            pairInfo.reserve1,
            decimals0,
            decimals1,
          ).toString()
          token1Price = humanPrice(
            pairToken0,
            routedB,
            pairInfo.reserve0,
            pairInfo.reserve1,
            decimals0,
            decimals1,
          ).toString()
        }

        setPoolInfo({
          pairAddress: pairInfo.address,
          reserve0: pairInfo.reserve0,
          reserve1: pairInfo.reserve1,
          totalSupply: pairInfo.totalSupply,
          token0Price,
          token1Price,
          poolShare,
          lpBalance
        })
      } else {
        // Pool não existe ainda
        setPoolInfo(null)
      }
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error fetching pool info:', err)
    } finally {
      setIsLoading(false)
    }
  }, [tokenA, tokenB, sdk])

  // Atualizar info quando mudar tokens
  useEffect(() => {
    refreshPoolInfo()
  }, [tokenA, tokenB])

  // Calcular amountB baseado em amountA e reserves
  useEffect(() => {
    if (poolInfo && amountA && tokenA && tokenB) {
      const reserve0 = BigInt(poolInfo.reserve0)
      const reserve1 = BigInt(poolInfo.reserve1)

      if (reserve0 > BigInt(0) && reserve1 > BigInt(0)) {
        const amountAWei = BigInt(sdk.parseAmount(amountA, tokenA.decimals))
        const amountBWei = (amountAWei * reserve1) / reserve0
        const amountBFormatted = sdk.formatAmount(
          amountBWei.toString(),
          tokenB.decimals
        )
        setAmountB(amountBFormatted)
      }
    }
  }, [amountA, poolInfo, tokenA, tokenB, sdk])

  // Adicionar liquidez
  const addLiquidity = useCallback(async (): Promise<boolean> => {
    if (!tokenA || !tokenB || !amountA || !amountB) {
      setError('Fill in all fields')
      return false
    }

    if (!sdk.walletAddress) {
      setError('Connect your wallet')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const amountAWei = sdk.parseAmount(amountA, tokenA.decimals)
      const amountBWei = sdk.parseAmount(amountB, tokenB.decimals)
      const amountAMin = sdk.calculateMinAmount(amountAWei, slippage)
      const amountBMin = sdk.calculateMinAmount(amountBWei, slippage)
      const deadline = sdk.calculateDeadline(20)

      // Route the native sentinel to WLUNES and flag which side is native so
      // the SDK uses add_liquidity_native (native amount attached as value).
      const nativeSide = isLunes(tokenA)
        ? 'A'
        : isLunes(tokenB)
          ? 'B'
          : undefined

      const result = await sdk.addLiquidity({
        tokenA: toRoutingAddress(tokenA),
        tokenB: toRoutingAddress(tokenB),
        amountADesired: amountAWei,
        amountBDesired: amountBWei,
        amountAMin,
        amountBMin,
        to: sdk.walletAddress,
        deadline,
        nativeSide
      })

      if (result) {
        // Limpar e atualizar
        setAmountA('')
        setAmountB('')
        await refreshPoolInfo()
      }

      return result
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error adding liquidity:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [tokenA, tokenB, amountA, amountB, slippage, sdk, refreshPoolInfo])

  // Remover liquidez
  const removeLiquidity = useCallback(
    async (lpAmount: string, receiveNative = true): Promise<boolean> => {
      if (!tokenA || !tokenB || !lpAmount || !poolInfo) {
        setError('Invalid parameters')
        return false
      }

      if (!sdk.walletAddress) {
        setError('Connect your wallet')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        const deadline = sdk.calculateDeadline(20)

        // LP token tem 8 casas decimais — escalar o valor humano para raw
        // (antes: BigInt(lpAmount) tratava "2" como 2 raw → queima ~0 → revert
        //  INSUFFICIENT_LIQUIDITY_BURNED no pair).
        const lpAmountRaw = sdk.parseAmount(lpAmount, LP_TOKEN_DECIMALS)
        const lpAmountBigInt = BigInt(lpAmountRaw)
        const totalSupply = BigInt(poolInfo.totalSupply)
        const reserve0 = BigInt(poolInfo.reserve0)
        const reserve1 = BigInt(poolInfo.reserve1)

        const amountAExpected = (lpAmountBigInt * reserve0) / totalSupply
        const amountBExpected = (lpAmountBigInt * reserve1) / totalSupply

        const amountAMin = sdk.calculateMinAmount(
          amountAExpected.toString(),
          slippage
        )
        const amountBMin = sdk.calculateMinAmount(
          amountBExpected.toString(),
          slippage
        )

        // If a side is native LUNES and the user opted to receive native,
        // withdraw that side as LUNES (remove_liquidity_native); otherwise both
        // sides come out as PSP22 (WLUNES).
        const aIsNative = isLunes(tokenA)
        const bIsNative = isLunes(tokenB)
        const receiveNativeSide =
          receiveNative && aIsNative
            ? 'A'
            : receiveNative && bIsNative
              ? 'B'
              : undefined

        const result = await sdk.removeLiquidity({
          tokenA: toRoutingAddress(tokenA),
          tokenB: toRoutingAddress(tokenB),
          liquidity: lpAmountRaw,
          amountAMin,
          amountBMin,
          to: sdk.walletAddress,
          deadline,
          receiveNativeSide
        })

        if (result) {
          await refreshPoolInfo()
        }

        return result
      } catch (err: unknown) {
        setError(parseBlockchainError(err))
        console.error('Error removing liquidity:', err)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [tokenA, tokenB, poolInfo, slippage, sdk, refreshPoolInfo]
  )

  return {
    tokenA,
    tokenB,
    amountA,
    amountB,
    poolInfo,
    isLoading: isLoading || sdk.isLoading,
    error: error || sdk.error,
    slippage,
    setTokenA,
    setTokenB,
    setAmountA,
    setAmountB,
    setSlippage,
    addLiquidity,
    removeLiquidity,
    refreshPoolInfo
  }
}

export default useLiquidity
