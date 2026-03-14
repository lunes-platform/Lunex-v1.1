import { useState, useEffect, useCallback } from 'react'
import { useSDK, parseBlockchainError } from '../context/SDKContext'

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  icon?: string
}

interface SwapQuote {
  amountOut: string
  amountOutFormatted: string
  priceImpact: string
  minimumReceived: string
  executionPrice: string
  route: string[]
}

interface UseSwapReturn {
  // Estado
  tokenIn: Token | null
  tokenOut: Token | null
  amountIn: string
  amountOut: string
  quote: SwapQuote | null
  isLoading: boolean
  error: string | null
  slippage: number

  // Ações
  setTokenIn: (token: Token | null) => void
  setTokenOut: (token: Token | null) => void
  setAmountIn: (amount: string) => void
  setSlippage: (slippage: number) => void
  switchTokens: () => void
  executeSwap: () => Promise<boolean>
  refreshQuote: () => Promise<void>
}

const useSwap = (): UseSwapReturn => {
  const sdk = useSDK()
  
  // Estado local
  const [tokenIn, setTokenIn] = useState<Token | null>(null)
  const [tokenOut, setTokenOut] = useState<Token | null>(null)
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slippage, setSlippage] = useState(0.5) // 0.5% default

  // Buscar quote quando mudar os parâmetros
  const refreshQuote = useCallback(async () => {
    if (!tokenIn || !tokenOut || !amountIn || amountIn === '0') {
      setQuote(null)
      setAmountOut('')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Converter amount para wei
      const amountInWei = sdk.parseAmount(amountIn, tokenIn.decimals)
      
      // Obter quote do SDK
      const quoteResult = await sdk.getQuote(amountInWei, [tokenIn.address, tokenOut.address])
      
      if (quoteResult) {
        const amountOutFormatted = sdk.formatAmount(quoteResult.amountOut, tokenOut.decimals)
        
        setQuote({
          ...quoteResult,
          amountOutFormatted
        })
        setAmountOut(amountOutFormatted)
      } else {
        setError('Could not get quote')
      }
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error fetching quote:', err)
    } finally {
      setIsLoading(false)
    }
  }, [tokenIn, tokenOut, amountIn, sdk])

  // Atualizar quote quando mudar parâmetros
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      refreshQuote()
    }, 500) // Debounce de 500ms

    return () => clearTimeout(debounceTimer)
  }, [amountIn, tokenIn, tokenOut])

  // Trocar tokens
  const switchTokens = useCallback(() => {
    const tempToken = tokenIn
    const tempAmount = amountIn

    setTokenIn(tokenOut)
    setTokenOut(tempToken)
    setAmountIn(amountOut)
    setAmountOut(tempAmount)
  }, [tokenIn, tokenOut, amountIn, amountOut])

  // Executar swap
  const executeSwap = useCallback(async (): Promise<boolean> => {
    if (!tokenIn || !tokenOut || !amountIn || !quote) {
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
      const amountInWei = sdk.parseAmount(amountIn, tokenIn.decimals)
      const amountOutMinWei = sdk.calculateMinAmount(quote.amountOut, slippage)
      const deadline = sdk.calculateDeadline(20) // 20 minutos

      const result = await sdk.executeSwap({
        amountIn: amountInWei,
        amountOutMin: amountOutMinWei,
        path: [tokenIn.address, tokenOut.address],
        to: sdk.walletAddress,
        deadline
      })

      if (result) {
        // Limpar campos após sucesso
        setAmountIn('')
        setAmountOut('')
        setQuote(null)
      }

      return result
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error executing swap:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [tokenIn, tokenOut, amountIn, quote, slippage, sdk])

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    quote,
    isLoading: isLoading || sdk.isLoading,
    error: error || sdk.error,
    slippage,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    setSlippage,
    switchTokens,
    executeSwap,
    refreshQuote
  }
}

export default useSwap
