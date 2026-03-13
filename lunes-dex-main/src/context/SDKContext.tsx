import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from 'react'
import { contractService } from '../services/contractService'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { CONTRACTS, NETWORK as NET_CONFIG } from '../config/contracts'

// SDK Types
interface LunexConfig {
  baseURL: string
  wsURL?: string
}

interface Quote {
  amountOut: string
  priceImpact: string
  route: string[]
  minimumReceived: string
  executionPrice: string
}

interface SwapParams {
  amountIn: string
  amountOutMin: string
  path: string[]
  to: string
  deadline: number
}

interface LiquidityParams {
  tokenA: string
  tokenB: string
  amountADesired: string
  amountBDesired: string
  amountAMin: string
  amountBMin: string
  to: string
  deadline: number
}

interface RemoveLiquidityParams {
  tokenA: string
  tokenB: string
  liquidity: string
  amountAMin: string
  amountBMin: string
  to: string
  deadline: number
}

interface PairInfo {
  address: string
  token0: string
  token1: string
  reserve0: string
  reserve1: string
  totalSupply: string
}

interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals: number
  totalSupply: string
}

// SDK Context State
interface SDKContextState {
  // Estado
  isConnected: boolean
  isLoading: boolean
  error: string | null
  walletAddress: string | null
  balance: string

  // Funções de Wallet
  connectWallet: (walletSource?: string) => Promise<void>
  disconnectWallet: () => void
  signMessage: (message: string) => Promise<string>

  // Funções de Swap
  getQuote: (amountIn: string, path: string[]) => Promise<Quote | null>
  executeSwap: (params: SwapParams) => Promise<boolean>

  // Funções de Liquidez
  addLiquidity: (params: LiquidityParams) => Promise<boolean>
  removeLiquidity: (params: RemoveLiquidityParams) => Promise<boolean>
  getPairInfo: (tokenA: string, tokenB: string) => Promise<PairInfo | null>

  // Funções de Staking
  stake: (amount: string) => Promise<boolean>
  unstake: (amount: string) => Promise<boolean>
  claimRewards: () => Promise<boolean>
  getStakingUserInfo: (accountAddress: string) => Promise<{ totalStaked: string; userStaked: string; pendingRewards: string; apr: string; lockPeriod: number } | null>

  // Funções de Governança
  getProposal: (proposalId: number) => Promise<{ id: number; name: string; description: string; tokenAddress: string; proposer: string; votesYes: number; votesNo: number; votingDeadline: number; executed: boolean; active: boolean; fee: string } | null>
  voteOnProposal: (proposalId: number, approve: boolean) => Promise<boolean>
  createProposal: (name: string, description: string, tokenAddress: string) => Promise<string | null>
  getVotingPower: (accountAddress: string) => Promise<string>
  getListingStats: () => Promise<{ totalProposals: number; approvedProposals: number } | null>

  // Funções de Token
  getTokenInfo: (address: string) => Promise<TokenInfo | null>
  getTokenBalance: (token: string, account: string) => Promise<string>

  // Utilitários
  formatAmount: (amount: string, decimals: number) => string
  parseAmount: (amount: string, decimals: number) => string
  calculateDeadline: (minutes: number) => number
  calculateMinAmount: (amount: string, slippagePercent: number) => string
}

const SDKContext = createContext<SDKContextState | null>(null)

// Contract addresses — single source of truth: config/contracts.ts
const CONTRACT_ADDRESSES = {
  factory: CONTRACTS.FACTORY,
  router: CONTRACTS.ROUTER,
  wnative: CONTRACTS.WNATIVE,
  staking: CONTRACTS.STAKING,
  rewards: CONTRACTS.REWARDS,
}

// Network from centralized config
const NETWORK = NET_CONFIG.name

// Provider Component
interface SDKProviderProps {
  children: ReactNode
}

export const SDKProvider: React.FC<SDKProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState('0')
  const [currentAccount, setCurrentAccount] = useState<InjectedAccountWithMeta | null>(null)

  // Initialize blockchain connection
  useEffect(() => {
    const initBlockchain = async () => {
      try {
        const connected = await contractService.connect(NETWORK)
        if (connected) {
          contractService.setContracts(CONTRACT_ADDRESSES)
          if (process.env.NODE_ENV !== 'production') console.log('Connected to Lunes blockchain')
        }
      } catch (err) {
        console.error('Failed to connect to blockchain:', err)
      }
    }
    initBlockchain()

    return () => {
      contractService.disconnect()
    }
  }, [])

  // Restore last-used wallet address for display only
  // DO NOT set isConnected=true here: we cannot verify wallet access
  // without re-invoking the polkadot extension. User must reconnect.
  useEffect(() => {
    const savedAddress = localStorage.getItem('lunex_last_wallet_address')
    if (savedAddress) {
      // Just hint the UI — the signer is NOT restored
      // isConnected remains false until user explicitly re-connects
      console.info('[SDK] Last wallet:', savedAddress, '— reconnect to resume')
    }
  }, [])

  // Poll for native balance updates
  useEffect(() => {
    if (!walletAddress || !isConnected) return

    const updateBalance = async () => {
      try {
        const nativeBalance = await contractService.getNativeBalance(walletAddress)
        setBalance(nativeBalance)
      } catch (e) {
        console.error("Error polling balance:", e)
      }
    }

    updateBalance()
    const interval = setInterval(updateBalance, 10000) // 10s poll
    return () => clearInterval(interval)
  }, [walletAddress, isConnected])

  // Connect Wallet (Polkadot.js / SubWallet / Talisman Extension)
  const connectWallet = async (walletSource?: string): Promise<void> => {
    setIsLoading(true)
    setError(null)

    try {
      // Discover all Substrate wallet extensions
      const { web3Enable, web3Accounts } = await import('@polkadot/extension-dapp')

      const extensions = await web3Enable('Lunex DEX')

      if (extensions.length === 0) {
        const walletName = walletSource === 'subwallet-js' ? 'SubWallet'
          : walletSource === 'talisman' ? 'Talisman'
          : 'a Polkadot-compatible wallet (Lunes Wallet, SubWallet, or Talisman)'
        throw new Error(`No wallet extension detected. Please install ${walletName}.`)
      }

      const allAccounts = await web3Accounts()

      if (allAccounts.length === 0) {
        throw new Error('No accounts found. Create an account in your wallet extension.')
      }

      // Filter accounts by the selected wallet source, if provided
      let accounts = allAccounts
      if (walletSource) {
        accounts = allAccounts.filter(acc => acc.meta.source === walletSource)
        if (accounts.length === 0) {
          // Fallback: show all accounts if selected wallet has none
          const walletName = walletSource === 'subwallet-js' ? 'SubWallet'
            : walletSource === 'talisman' ? 'Talisman'
            : 'Lunes Wallet'
          throw new Error(`No accounts found in ${walletName}. Please create or import an account.`)
        }
      }

      // Use first available account from the selected wallet
      const account = accounts[0]
      setCurrentAccount(account)
      setWalletAddress(account.address)
      setIsConnected(true)
      localStorage.setItem('lunex_last_wallet_address', account.address)
      localStorage.setItem('lunex_last_wallet_source', account.meta.source || '')

      // Fetch real native balance from blockchain
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }

      const nativeBalance = await contractService.getNativeBalance(account.address)
      setBalance(nativeBalance)

    } catch (err: unknown) {
      setError((err as Error).message || 'Error connecting wallet')
      console.error('Error connecting wallet:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Desconectar Wallet
  const disconnectWallet = useCallback((): void => {
    setWalletAddress(null)
    setCurrentAccount(null)
    setIsConnected(false)
    setBalance('0')
    localStorage.removeItem('lunex_last_wallet_address')
  }, [])

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!walletAddress) {
      throw new Error('Connect your wallet first')
    }

    const { web3Accounts, web3FromSource } = await import('@polkadot/extension-dapp')
    const account = currentAccount || (await web3Accounts()).find((item) => item.address === walletAddress) || null

    if (!account) {
      throw new Error('Reconnect your wallet to enable signing')
    }

    if (!currentAccount) {
      setCurrentAccount(account)
    }

    const injector = await web3FromSource(account.meta.source)
    const signRaw = injector?.signer?.signRaw

    if (!signRaw) {
      throw new Error('Signer not available in the connected wallet')
    }

    const { signature } = await signRaw({
      address: walletAddress,
      data: message,
      type: 'bytes'
    })

    return signature
  }, [currentAccount, walletAddress])

  // Obter Quote para Swap
  const getQuote = useCallback(async (amountIn: string, path: string[]): Promise<Quote | null> => {
    setIsLoading(true)
    setError(null)

    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }

      // Fetch amounts and reserves in parallel
      const [amounts, pairInfo] = await Promise.all([
        contractService.getAmountsOut(amountIn, path),
        contractService.getPairInfo(path[0], path[1]),
      ])

      if (!amounts || amounts.length < 2) {
        throw new Error('Insufficient liquidity for this trade')
      }

      const amountOut = amounts[amounts.length - 1]
      const executionPrice = (Number(amountOut) / Number(amountIn)).toFixed(6)

      // Real price impact = 1 - (amountOut/amountIn) / (reserve_out/reserve_in)
      // For Uniswap V2 with 0.3% fee:
      // price_impact ≈ amountIn / (reserve_in + amountIn)  [simplified]
      let priceImpact = '0'
      if (pairInfo) {
        const reserveIn = BigInt(pairInfo.reserve0)
        const reserveOut = BigInt(pairInfo.reserve1)
        const aIn = BigInt(amountIn)
        const aOut = BigInt(amountOut)

        const ZERO = BigInt(0)
        if (reserveIn > ZERO && reserveOut > ZERO && aIn > ZERO && aOut > ZERO) {
          // impact = 1 - (aOut * reserveIn) / (aIn * reserveOut)   [in basis points *10000]
          const BPS = BigInt(10000)
          const midPriceNum = aOut * reserveIn * BPS
          const midPriceDen = aIn * reserveOut
          const impactBps = midPriceDen > midPriceNum
            ? (midPriceDen - midPriceNum) * BPS / midPriceDen
            : ZERO
          priceImpact = (Number(impactBps) / 100).toFixed(2) // e.g. "0.30"
        }
      } else {
        // Fallback: fee only (0.30%)
        priceImpact = '0.30'
      }

      // Minimum received with 0.5% slippage buffer
      const minimumReceived = (BigInt(amountOut) * BigInt(995) / BigInt(1000)).toString()

      return {
        amountOut,
        executionPrice,
        priceImpact,
        minimumReceived,
        route: path
      }

    } catch (err: unknown) {
      setError((err as Error).message || 'Error getting quote')
      console.error('Error getting quote:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Executar Swap
  const executeSwap = useCallback(async (params: SwapParams): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      // 1. Check Allowance
      const tokenIn = params.path[0]
      const routerAddress = CONTRACT_ADDRESSES.router

      const allowance = await contractService.getAllowance(tokenIn, walletAddress, routerAddress)
      const amountInBN = BigInt(params.amountIn)
      const allowanceBN = BigInt(allowance)

      if (allowanceBN < amountInBN) {
        if (process.env.NODE_ENV !== 'production') console.log('Insufficient allowance. Approving...')
        const approved = await contractService.approveToken(
          tokenIn,
          routerAddress,
          params.amountIn, // Approve exact amount or infinite? Using exact for safety
          currentAccount
        )
        if (!approved) throw new Error("Token approval failed")
      }

      // 2. Execute Swap
      const txHash = await contractService.swapExactTokensForTokens(
        params.amountIn,
        params.amountOutMin,
        params.path,
        params.to,
        params.deadline,
        currentAccount
      )

      if (process.env.NODE_ENV !== 'production') console.log('Swap executed! Tx Hash:', txHash)

      // 3. Refresh Balance
      const newBalance = await contractService.getNativeBalance(walletAddress)
      setBalance(newBalance)

      return true

    } catch (err: unknown) {
      setError((err as Error).message || 'Error executing swap')
      console.error('Error executing swap:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, currentAccount])

  // Adicionar Liquidez
  const addLiquidity = useCallback(async (params: LiquidityParams): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const routerAddress = CONTRACT_ADDRESSES.router

      // 1. Check/Approve Token A
      const allowanceA = await contractService.getAllowance(params.tokenA, walletAddress, routerAddress)
      if (BigInt(allowanceA) < BigInt(params.amountADesired)) {
        await contractService.approveToken(params.tokenA, routerAddress, params.amountADesired, currentAccount)
      }

      // 2. Check/Approve Token B
      const allowanceB = await contractService.getAllowance(params.tokenB, walletAddress, routerAddress)
      if (BigInt(allowanceB) < BigInt(params.amountBDesired)) {
        await contractService.approveToken(params.tokenB, routerAddress, params.amountBDesired, currentAccount)
      }

      // 3. Execute Add Liquidity
      const txHash = await contractService.addLiquidity(
        params.tokenA,
        params.tokenB,
        params.amountADesired,
        params.amountBDesired,
        params.amountAMin,
        params.amountBMin,
        params.to,
        params.deadline,
        currentAccount
      )

      if (process.env.NODE_ENV !== 'production') console.log('Liquidity added! Tx Hash:', txHash)
      return true

    } catch (err: unknown) {
      setError((err as Error).message || 'Error adding liquidity')
      console.error('Error adding liquidity:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, currentAccount])

  // Remover Liquidez
  const removeLiquidity = useCallback(async (params: RemoveLiquidityParams): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      // 1. Get Pair Address (LP Token)
      const pairAddress = await contractService.getPair(params.tokenA, params.tokenB)
      if (!pairAddress) throw new Error("Pair not found")

      // 2. Approve Router to spend LP Tokens
      const routerAddress = CONTRACT_ADDRESSES.router
      const allowance = await contractService.getAllowance(pairAddress, walletAddress, routerAddress)

      if (BigInt(allowance) < BigInt(params.liquidity)) {
        await contractService.approveToken(pairAddress, routerAddress, params.liquidity, currentAccount)
      }

      // 3. Execute Remove
      const txHash = await contractService.removeLiquidity(
        params.tokenA,
        params.tokenB,
        params.liquidity,
        params.amountAMin,
        params.amountBMin,
        params.to,
        params.deadline,
        currentAccount
      )

      if (process.env.NODE_ENV !== 'production') console.log('Liquidity removed! Tx Hash:', txHash)
      return true

    } catch (err: unknown) {
      setError((err as Error).message || 'Error removing liquidity')
      console.error('Error removing liquidity:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, currentAccount])

  // ========================================
  // Staking Methods
  // ========================================

  const stake = async (amount: string): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }

      const txHash = await contractService.stake(amount, currentAccount)
      if (process.env.NODE_ENV !== 'production') console.log('Staked! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError((err as Error).message || 'Error staking LP tokens')
      console.error('Error staking:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const unstake = async (amount: string): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }

      const txHash = await contractService.unstake(amount, currentAccount)
      if (process.env.NODE_ENV !== 'production') console.log('Unstaked! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError((err as Error).message || 'Error unstaking LP tokens')
      console.error('Error unstaking:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const claimRewards = async (): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }

      const txHash = await contractService.claimRewards(currentAccount)
      if (process.env.NODE_ENV !== 'production') console.log('Rewards Claimed! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError((err as Error).message || 'Error claiming rewards')
      console.error('Error claiming rewards:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const getStakingUserInfo = async (accountAddress: string) => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getStakingUserInfo(accountAddress)
    } catch (err) {
      console.error('Error getting staking user info:', err)
      return null
    }
  }

  // ── Governance / Listing Methods ──────────────────────────────────────────

  const getProposal = async (proposalId: number) => {
    try {
      if (!contractService.getIsConnected()) await contractService.connect(NETWORK)
      return await contractService.getProposal(proposalId)
    } catch (err) {
      console.error('Error getting proposal:', err)
      return null
    }
  }

  const voteOnProposal = async (proposalId: number, approve: boolean): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }
    setIsLoading(true)
    setError(null)
    try {
      if (!contractService.getIsConnected()) await contractService.connect(NETWORK)
      const txHash = await contractService.vote(proposalId, approve, currentAccount)
      if (process.env.NODE_ENV !== 'production') console.log('Vote submitted! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError((err as Error).message || 'Error voting')
      console.error('Error voting:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const createProposal = async (name: string, description: string, tokenAddress: string): Promise<string | null> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return null
    }
    setIsLoading(true)
    setError(null)
    try {
      if (!contractService.getIsConnected()) await contractService.connect(NETWORK)
      const txHash = await contractService.createProposal(name, description, tokenAddress, currentAccount)
      if (process.env.NODE_ENV !== 'production') console.log('Proposal created! Tx Hash:', txHash)
      return txHash
    } catch (err: unknown) {
      setError((err as Error).message || 'Error creating proposal')
      console.error('Error creating proposal:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  const getVotingPower = async (accountAddress: string): Promise<string> => {
    try {
      if (!contractService.getIsConnected()) await contractService.connect(NETWORK)
      return await contractService.getVotingPower(accountAddress)
    } catch (err) {
      console.error('Error getting voting power:', err)
      return '0'
    }
  }

  const getListingStats = async () => {
    try {
      if (!contractService.getIsConnected()) await contractService.connect(NETWORK)
      return await contractService.getListingStats()
    } catch (err) {
      console.error('Error getting listing stats:', err)
      return null
    }
  }

  // Obter Info do Par
  const getPairInfo = async (tokenA: string, tokenB: string): Promise<PairInfo | null> => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getPairInfo(tokenA, tokenB)
    } catch (err) {
      console.error('Error getting pair info:', err)
      return null
    }
  }

  // Obter Info do Token
  const getTokenInfo = async (address: string): Promise<TokenInfo | null> => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getTokenInfo(address)
    } catch (err) {
      console.error('Error getting token info:', err)
      return null
    }
  }

  // Obter Balance do Token
  const getTokenBalance = async (token: string, account: string): Promise<string> => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getTokenBalance(token, account)
    } catch (err) {
      console.error('Error getting balance:', err)
      return '0'
    }
  }

  // Utilitários
  const formatAmount = (amount: string, decimals: number): string => {
    if (!amount) return '0'
    try {
      const value = BigInt(amount)
      const divisor = BigInt(10 ** decimals)
      const integerPart = value / divisor
      const fractionalPart = value % divisor

      if (fractionalPart === BigInt(0)) {
        return integerPart.toString()
      }

      const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
      const trimmedFractional = fractionalStr.replace(/0+$/, '')

      return `${integerPart}.${trimmedFractional}`
    } catch (e) {
      console.error("Format error", e)
      return "0"
    }
  }

  const parseAmount = (amount: string, decimals: number): string => {
    if (!amount) return '0'
    try {
      const [integerPart, fractionalPart = ''] = amount.split('.')
      const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals)
      const combined = integerPart + paddedFractional
      // Remove leading zeros just in case
      return BigInt(combined).toString()
    } catch (e) {
      console.error("Parse error", e)
      return "0"
    }
  }

  // Returns deadline in seconds; contractService multiplies by 1000 to get ms for the chain
  const calculateDeadline = (minutes: number): number => {
    return Math.floor(Date.now() / 1000) + minutes * 60
  }

  const calculateMinAmount = (amount: string, slippagePercent: number): string => {
    try {
      const amountBigInt = BigInt(amount)
      const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 100))
      return (amountBigInt * slippageMultiplier / BigInt(10000)).toString()
    } catch (e) {
      return "0"
    }
  }

  const value: SDKContextState = useMemo(() => ({
    isConnected,
    isLoading,
    error,
    walletAddress,
    balance,
    connectWallet,
    disconnectWallet,
    signMessage,
    getQuote,
    executeSwap,
    addLiquidity,
    removeLiquidity,
    getPairInfo,
    stake,
    unstake,
    claimRewards,
    getStakingUserInfo,
    getProposal,
    voteOnProposal,
    createProposal,
    getVotingPower,
    getListingStats,
    getTokenInfo,
    getTokenBalance,
    formatAmount,
    parseAmount,
    calculateDeadline,
    calculateMinAmount,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isConnected, isLoading, error, walletAddress, balance, signMessage])

  return (
    <SDKContext.Provider value={value}>
      {children}
    </SDKContext.Provider>
  )
}

// Hook para usar o SDK
export const useSDK = (): SDKContextState => {
  const context = useContext(SDKContext)

  if (!context) {
    throw new Error('useSDK deve ser usado dentro de um SDKProvider')
  }

  return context
}

export default SDKContext
