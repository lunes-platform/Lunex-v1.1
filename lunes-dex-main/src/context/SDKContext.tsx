import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
  useCallback,
  useMemo
} from 'react'
import { contractService } from '../services/contractService'
import type { PairInfo } from '../services/contractService'
import type { GovernanceProposal, ListingStats } from '../utils/staking'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { CONTRACTS, NETWORK as NET_CONFIG } from '../config/contracts'
import { normalizeReservesForPath } from '../utils/reserveUtils'
import { classifyTrade } from '../utils/nativeToken'

import { clearReadSession, ensureReadSession } from '../services/sessionService'
import {
  getActiveWallet,
  getWalletAccount,
  setActiveWallet
} from '../wallet/activeWallet'
import { createExtensionAdapter } from '../wallet/extensionAdapter'
import {
  genesisHashOverride,
  isWalletConnectConfigured
} from '../wallet/config'
import type { WalletAdapter, WalletKind } from '../wallet/types'
import { deadlineFromNow, minAmountAfterSlippage } from '../utils/txBounds'

/** Minimal token shape needed to classify a trade (native vs wrapped). */
type TradeToken = { acronym?: string; address?: string; isNative?: boolean }

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
  // Optional display tokens; when present the swap is classified into a native
  // swap / wrap / unwrap and routed to the matching Router/WNative call.
  fromToken?: TradeToken
  toToken?: TradeToken
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
  // When the user adds native LUNES, which side it is. The opposite side is the
  // PSP22 token leg; the native amount rides as the call value (add_liquidity_native).
  nativeSide?: 'A' | 'B'
}

interface RemoveLiquidityParams {
  tokenA: string
  tokenB: string
  liquidity: string
  amountAMin: string
  amountBMin: string
  to: string
  deadline: number
  // When set, that side is withdrawn as native LUNES (remove_liquidity_native).
  // Undefined keeps the default behaviour: both sides out as PSP22 (WLUNES).
  receiveNativeSide?: 'A' | 'B'
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
  /** Kind of the connected wallet (extension or WalletConnect). */
  walletKind: WalletKind | null

  // Funções de Wallet
  connectWallet: (walletSource?: string) => Promise<void>
  /** Pair a phone wallet over WalletConnect; `onUri` gets the QR payload. */
  connectWalletConnect: (onUri: (uri: string) => void) => Promise<void>
  /** Abort a pending WalletConnect pairing. */
  cancelWalletConnect: () => void
  disconnectWallet: () => void
  signMessage: (message: string) => Promise<string>
  /** Last error set by any SDK call (sync, unlike `error`). Used by TxContext
   *  to tell a wallet rejection apart from a failure when a call returns false. */
  getLastError: () => string | null

  // Funções de Swap
  getQuote: (
    amountIn: string,
    path: string[],
    decimalsIn?: number,
    decimalsOut?: number
  ) => Promise<Quote | null>
  executeSwap: (params: SwapParams) => Promise<boolean>

  // Funções de Liquidez
  addLiquidity: (params: LiquidityParams) => Promise<boolean>
  removeLiquidity: (params: RemoveLiquidityParams) => Promise<boolean>
  getPairInfo: (tokenA: string, tokenB: string) => Promise<PairInfo | null>
  getPairToken0: (pairAddress: string) => Promise<string | null>

  // Funções de Staking
  /** Stake native LUNES: `amount` in planck (8 dec), lock `durationMs`. */
  stake: (amount: string, durationMs: number) => Promise<boolean>
  /** Unstake the whole position (contract takes no amount). */
  unstake: () => Promise<boolean>
  claimStakingRewards: () => Promise<boolean>
  claimRewards: () => Promise<boolean>
  getStakingUserInfo: (
    accountAddress: string
  ) => ReturnType<typeof contractService.getStakingUserInfo>

  // Funções de Governança
  getProposal: (proposalId: number) => Promise<GovernanceProposal | null>
  voteOnProposal: (proposalId: number, approve: boolean) => Promise<boolean>
  createProposal: (
    name: string,
    description: string,
    tokenAddress: string
  ) => Promise<string | null>
  getVotingPower: (accountAddress: string) => Promise<string>
  getListingStats: () => Promise<ListingStats | null>
  /** Live proposal fee in planck (get_current_proposal_fee). */
  getProposalFee: () => Promise<string>

  // Funções de Token
  getTokenInfo: (address: string) => Promise<TokenInfo | null>
  getTokenBalance: (token: string, account: string) => Promise<string>
  getNativeBalance: (account: string) => Promise<string>

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
  rewards: CONTRACTS.REWARDS
}

// Network from centralized config
const NETWORK = NET_CONFIG.name

// Utilitários de Tratamento de Erro Substrate
const parseBlockchainError = (err: unknown): string => {
  if (!err) return 'Unknown error occurred'
  const message = err instanceof Error ? err.message : String(err)

  // Polkadot.js extension cancellations
  if (message.includes('Cancelled') || message.includes('Rejected')) {
    return 'Transaction was cancelled by the user'
  }

  // RPC Drops
  if (message.includes('disconnected') || message.includes('WebSocket')) {
    return 'RPC Connection disconnected. Please try again'
  }

  // Raw JSON from Substrate (ex: {"module":{"index":24,"error":"0x19000000"}})
  try {
    // Tenta achar JSON no meio da string do erro
    const jsonMatch = message.match(/({.*})/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1])
      if (parsed.module) {
        return `Blockchain execution reverted (Module ${parsed.module.index}, Error Info: ${parsed.module.error})`
      }
      if (parsed.arithmetic) {
        return 'Arithmetic or Underflow Error (Check slippage or balances)'
      }
    }
  } catch {
    // ignore parse errors
  }

  // Slippage / Balance heuristics
  if (message.includes('balances.InsufficientBalance'))
    return 'Insufficient LUNES balance for transaction fees'
  if (message.includes('contracts.OutOfGas'))
    return 'Out of Gas error. Transaction reverted.'

  // Return formatted or slice the huge string
  return message.length > 100 ? `${message.slice(0, 100)}...` : message
}

export { parseBlockchainError }

// Provider Component
interface SDKProviderProps {
  children: ReactNode
}

export const SDKProvider: React.FC<SDKProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)
  const lastErrorRef = useRef<string | null>(null)
  const setError = useCallback((e: string | null) => {
    lastErrorRef.current = e
    setErrorState(e)
  }, [])
  const getLastError = useCallback(() => lastErrorRef.current, [])
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState('0')
  const [currentAccount, setCurrentAccount] =
    useState<InjectedAccountWithMeta | null>(null)
  const [walletKind, setWalletKind] = useState<WalletKind | null>(null)

  // Register contract addresses WITHOUT opening the chain connection.
  // connect() (which dynamically imports @polkadot/api — the heaviest chunk)
  // is deferred until first real use: wallet connect, balance read, getQuote,
  // or any guarded `if (!getIsConnected()) await connect()` call site. This
  // keeps @polkadot/api out of the landing-page waterfall. setContracts only
  // stores the addresses here (no api yet); connect() rebuilds the contract
  // instances from them once the api is ready.
  useEffect(() => {
    contractService.setContracts(CONTRACT_ADDRESSES)

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
      // Just hint the UI — the signer is NOT restored.
      // Avoid logging wallet identifiers to the browser console.
    }
  }, [])

  // Poll for native balance updates
  useEffect(() => {
    if (!walletAddress || !isConnected) return

    const updateBalance = async () => {
      try {
        const nativeBalance =
          await contractService.getNativeBalance(walletAddress)
        setBalance(nativeBalance)
      } catch (e) {
        console.error('Error polling balance:', e)
      }
    }

    updateBalance()
    const interval = setInterval(updateBalance, 10000) // 10s poll
    return () => clearInterval(interval)
  }, [walletAddress, isConnected])

  // Read sessions are per address: drop (and revoke) the previous account's
  // session when the connected account changes.
  const prevAddressRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevAddressRef.current
    if (prev && walletAddress && prev !== walletAddress) {
      void clearReadSession(prev, { revoke: true })
    }
    prevAddressRef.current = walletAddress
  }, [walletAddress])

  /** Genesis hash for the WalletConnect chain id (env override first). */
  const resolveGenesisHash = async (): Promise<string> => {
    const override = genesisHashOverride()
    if (override) return override
    if (!contractService.getIsConnected()) {
      await contractService.connect(NETWORK)
    }
    const api = contractService.getApi()
    if (!api) throw new Error('Could not connect to the Lunes network')
    return api.genesisHash.toHex()
  }

  /**
   * Make `adapter` the app's signer and mark the wallet connected. Every
   * signature from here on goes through the adapter (wallet approval).
   */
  const activateAdapter = async (
    adapter: WalletAdapter,
    source: string
  ): Promise<void> => {
    // Switching wallets: end the previous session (e.g. a WalletConnect
    // pairing) so it cannot keep signing in the background.
    const previous = getActiveWallet()
    if (previous && previous !== adapter) {
      void previous.disconnect().catch(() => undefined)
    }
    setActiveWallet(adapter)
    setCurrentAccount(getWalletAccount(adapter.address))
    setWalletKind(adapter.kind)
    setWalletAddress(adapter.address)
    setIsConnected(true)
    localStorage.setItem('lunex_last_wallet_address', adapter.address)
    localStorage.setItem('lunex_last_wallet_source', source)

    // "Sign in to Lunex": one signature for an 8h READ-ONLY session so
    // private pages never prompt again. Non-blocking; if the user declines,
    // pages show a "Sign in" button instead of prompting on load.
    void ensureReadSession(adapter.address, adapter.signMessage).catch(
      () => undefined
    )
  }

  // The phone wallet ended the session (or it expired): drop the app state.
  const disconnectRef = useRef<() => void>(() => undefined)
  const handleRemoteDisconnect = useCallback(() => {
    disconnectRef.current()
  }, [])

  // Restore a WalletConnect session after reload. UniversalProvider keeps it
  // in storage; we only mark the wallet connected once the session is
  // validated (live, unexpired, grants an account on this chain).
  useEffect(() => {
    let source = ''
    let preferred: string | null = null
    try {
      source = localStorage.getItem('lunex_last_wallet_source') || ''
      preferred = localStorage.getItem('lunex_last_wallet_address')
    } catch {
      return
    }
    if (source !== 'walletconnect' || !isWalletConnectConfigured()) return
    let alive = true
    const restore = async () => {
      try {
        const genesisHash = await resolveGenesisHash()
        const wc = await import('../wallet/walletConnectAdapter')
        const adapter = await wc.restoreWalletConnect({
          genesisHash,
          preferredAddress: preferred,
          handlers: { onRemoteDisconnect: handleRemoteDisconnect }
        })
        if (!adapter || !alive) return
        // The user connected another wallet meanwhile: drop the old pairing.
        if (getActiveWallet()) {
          await adapter.disconnect()
          return
        }
        await activateAdapter(adapter, adapter.kind)
        setBalance(await contractService.getNativeBalance(adapter.address))
      } catch (err: unknown) {
        console.error('Could not restore WalletConnect session:', err)
      }
    }
    void restore()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Connect Wallet (Polkadot.js / SubWallet / Talisman Extension)
  const connectWallet = async (walletSource?: string): Promise<void> => {
    setIsLoading(true)
    setError(null)

    try {
      // Discover all Substrate wallet extensions
      const { web3Enable, web3Accounts } =
        await import('@polkadot/extension-dapp')

      const extensions = await web3Enable('Lunex DEX')

      if (extensions.length === 0) {
        throw new Error('Please install a Polkadot-compatible wallet extension')
      }

      const allAccounts = await web3Accounts()

      if (allAccounts.length === 0) {
        throw new Error(
          'No accounts found. Create an account in your wallet extension'
        )
      }

      // Filter accounts by the selected wallet source, if provided
      let accounts = allAccounts
      if (walletSource) {
        const filtered = allAccounts.filter(
          acc => acc.meta.source === walletSource
        )
        if (filtered.length > 0) {
          accounts = filtered
        }
      }

      // Use first available account from the selected wallet
      const account = accounts[0]
      const adapter = await createExtensionAdapter(
        account,
        account.meta.name || account.meta.source
      )

      // Wait for the RPC before publishing the wallet: pages react to
      // isConnected by reading balances/allowances, which need the api.
      if (!contractService.getIsConnected()) {
        const ready = await contractService.connect(NETWORK)
        if (!ready) throw new Error('Could not connect to the blockchain')
      }

      const nativeBalance = await contractService.getNativeBalance(
        account.address
      )
      setBalance(nativeBalance)
      await activateAdapter(adapter, account.meta.source || '')
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error connecting wallet:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const wcPairingRef = useRef(0)

  // WalletConnect (phone wallets: SubWallet, Talisman, Nova). The SDK is
  // loaded on demand so extension users never download it.
  const connectWalletConnect = async (
    onUri: (uri: string) => void
  ): Promise<void> => {
    const pairing = ++wcPairingRef.current
    setIsLoading(true)
    setError(null)
    try {
      if (!isWalletConnectConfigured()) {
        throw new Error('WalletConnect not configured')
      }
      const genesisHash = await resolveGenesisHash()
      const wc = await import('../wallet/walletConnectAdapter')
      const adapter = await wc.connectWalletConnect({
        genesisHash,
        onUri,
        handlers: { onRemoteDisconnect: handleRemoteDisconnect }
      })
      // The user cancelled while the wallet was approving: never connect.
      if (pairing !== wcPairingRef.current) {
        await adapter.disconnect()
        throw new Error('Connection cancelled')
      }
      await activateAdapter(adapter, adapter.kind)
      setBalance(await contractService.getNativeBalance(adapter.address))
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error connecting WalletConnect:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const cancelWalletConnect = useCallback((): void => {
    wcPairingRef.current++
    void import('../wallet/walletConnectAdapter')
      .then(wc => wc.abortWalletConnect())
      .catch(() => undefined)
  }, [])

  // Desconectar Wallet
  const disconnectWallet = useCallback((): void => {
    const adapter = getActiveWallet()
    setActiveWallet(null)
    void adapter?.disconnect().catch(() => undefined)
    void clearReadSession(null, { revoke: true })
    setWalletAddress(null)
    setCurrentAccount(null)
    setWalletKind(null)
    setIsConnected(false)
    setBalance('0')
    localStorage.removeItem('lunex_last_wallet_address')
  }, [])
  disconnectRef.current = disconnectWallet

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!walletAddress) {
        throw new Error('Connect your wallet first')
      }
      const adapter = getActiveWallet()
      if (!adapter || adapter.address !== walletAddress) {
        throw new Error('Reconnect your wallet to enable signing')
      }
      return adapter.signMessage(message)
    },
    [walletAddress]
  )

  // Obter Quote para Swap
  const getQuote = useCallback(
    async (
      amountIn: string,
      path: string[],
      decimalsIn?: number,
      decimalsOut?: number
    ): Promise<Quote | null> => {
      setIsLoading(true)
      setError(null)

      try {
        if (!contractService.getIsConnected()) {
          await contractService.connect(NETWORK)
        }

        // Fetch amounts and reserves in parallel
        const [amounts, pairInfo] = await Promise.all([
          contractService.getAmountsOut(amountIn, path),
          contractService.getPairInfo(path[0], path[1])
        ])

        if (!amounts || amounts.length < 2) {
          throw new Error('Insufficient liquidity for this trade')
        }

        const amountOut = amounts[amounts.length - 1]
        // Raw amounts carry each token's decimal scale; without adjustment a
        // 8-dec → 6-dec pair displays a price 100× off (10^(8−6)).
        const decimalScale =
          decimalsIn !== undefined && decimalsOut !== undefined
            ? 10 ** (decimalsIn - decimalsOut)
            : 1
        const executionPrice = (
          (Number(amountOut) / Number(amountIn)) *
          decimalScale
        ).toFixed(6)

        // Real price impact = 1 - (amountOut/amountIn) / (reserve_out/reserve_in)
        // For Uniswap V2 with 0.3% fee:
        // price_impact ≈ amountIn / (reserve_in + amountIn)  [simplified]
        let priceImpact = '0'
        if (pairInfo) {
          const pairAddress = await contractService.getPair(path[0], path[1])
          const pairToken0 = pairAddress
            ? ((await contractService.getPairToken0(pairAddress)) ?? path[0])
            : path[0]
          const { reserveIn, reserveOut } = normalizeReservesForPath(
            pairToken0,
            path[0],
            pairInfo.reserve0,
            pairInfo.reserve1
          )
          const aIn = BigInt(amountIn)
          const aOut = BigInt(amountOut)

          const ZERO = BigInt(0)
          if (
            reserveIn > ZERO &&
            reserveOut > ZERO &&
            aIn > ZERO &&
            aOut > ZERO
          ) {
            // impact = 1 - (aOut * reserveIn) / (aIn * reserveOut)   [in basis points *10000]
            const BPS = BigInt(10000)
            const midPriceNum = aOut * reserveIn
            const midPriceDen = aIn * reserveOut
            const impactBps =
              midPriceDen > midPriceNum
                ? ((midPriceDen - midPriceNum) * BPS) / midPriceDen
                : ZERO
            priceImpact = (Number(impactBps) / 100).toFixed(2) // e.g. "0.30"
          }
        } else {
          // Fallback: fee only (0.30%)
          priceImpact = '0.30'
        }

        // Minimum received with 0.5% slippage buffer
        const minimumReceived = (
          (BigInt(amountOut) * BigInt(995)) /
          BigInt(1000)
        ).toString()

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
    },
    []
  )

  // Executar Swap
  const executeSwap = useCallback(
    async (params: SwapParams): Promise<boolean> => {
      if (!walletAddress || !currentAccount) {
        setError('Connect your wallet first')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        // Classify the trade from the display tokens (LUNES vs WLUNES vs other).
        // Each branch's contractService method owns its own approval, so there
        // is no generic pre-approve here (a duplicate approve would waste a
        // nonce and risk a "bad signature" race).
        const trade =
          params.fromToken && params.toToken
            ? classifyTrade(params.fromToken, params.toToken)
            : ({
                kind: 'swap',
                method: 'swapExactTokensForTokens',
                needsApprove: true
              } as const)

        let txHash: string | null = null

        if (trade.kind === 'wrap') {
          // LUNES → WLUNES: 1:1 deposit, no Router, no slippage.
          txHash = await contractService.wrapNative(
            params.amountIn,
            currentAccount
          )
        } else if (trade.kind === 'unwrap') {
          // WLUNES → LUNES: 1:1 withdraw.
          txHash = await contractService.unwrapNative(
            params.amountIn,
            currentAccount
          )
        } else if (trade.method === 'swapExactNativeForTokens') {
          // LUNES → token: native rides as call value, no token approval.
          txHash = await contractService.swapExactNativeForTokens(
            params.amountIn,
            params.amountOutMin,
            params.path,
            params.to,
            params.deadline,
            currentAccount
          )
        } else if (trade.method === 'swapExactTokensForNative') {
          // token → LUNES: contractService approves the input token internally.
          txHash = await contractService.swapExactTokensForNative(
            params.amountIn,
            params.amountOutMin,
            params.path,
            params.to,
            params.deadline,
            currentAccount
          )
        } else {
          // token → token: approves path[0] internally.
          txHash = await contractService.swapExactTokensForTokens(
            params.amountIn,
            params.amountOutMin,
            params.path,
            params.to,
            params.deadline,
            currentAccount
          )
        }

        if (process.env.NODE_ENV !== 'production')
          console.log('Swap executed! Tx Hash:', txHash)

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
    },
    [walletAddress, currentAccount]
  )

  // Adicionar Liquidez
  const addLiquidity = useCallback(
    async (params: LiquidityParams): Promise<boolean> => {
      if (!walletAddress || !currentAccount) {
        setError('Connect your wallet first')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        const routerAddress = CONTRACT_ADDRESSES.router

        // Native add: only the token leg needs approval; the native amount is
        // attached as the call value by addLiquidityNative (which approves the
        // token leg internally).
        if (params.nativeSide) {
          const tokenAddr =
            params.nativeSide === 'A' ? params.tokenB : params.tokenA
          const tokenDesired =
            params.nativeSide === 'A'
              ? params.amountBDesired
              : params.amountADesired
          const tokenMin =
            params.nativeSide === 'A' ? params.amountBMin : params.amountAMin
          const nativeDesired =
            params.nativeSide === 'A'
              ? params.amountADesired
              : params.amountBDesired
          const nativeMin =
            params.nativeSide === 'A' ? params.amountAMin : params.amountBMin

          const txHash = await contractService.addLiquidityNative(
            tokenAddr,
            tokenDesired,
            nativeDesired,
            tokenMin,
            nativeMin,
            params.to,
            params.deadline,
            currentAccount
          )
          if (process.env.NODE_ENV !== 'production')
            console.log('Native liquidity added! Tx Hash:', txHash)
          return true
        }

        // 1. Check/Approve Token A
        const allowanceA = await contractService.getAllowance(
          params.tokenA,
          walletAddress,
          routerAddress
        )
        if (BigInt(allowanceA) < BigInt(params.amountADesired)) {
          await contractService.approveToken(
            params.tokenA,
            routerAddress,
            params.amountADesired,
            currentAccount
          )
        }

        // 2. Check/Approve Token B
        const allowanceB = await contractService.getAllowance(
          params.tokenB,
          walletAddress,
          routerAddress
        )
        if (BigInt(allowanceB) < BigInt(params.amountBDesired)) {
          await contractService.approveToken(
            params.tokenB,
            routerAddress,
            params.amountBDesired,
            currentAccount
          )
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

        if (process.env.NODE_ENV !== 'production')
          console.log('Liquidity added! Tx Hash:', txHash)
        return true
      } catch (err: unknown) {
        setError((err as Error).message || 'Error adding liquidity')
        console.error('Error adding liquidity:', err)
        return false
      } finally {
        setIsLoading(false)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [walletAddress, currentAccount]
  )

  // Remover Liquidez
  const removeLiquidity = useCallback(
    async (params: RemoveLiquidityParams): Promise<boolean> => {
      if (!walletAddress || !currentAccount) {
        setError('Connect your wallet first')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        // 1. Get Pair Address (LP Token)
        const pairAddress = await contractService.getPair(
          params.tokenA,
          params.tokenB
        )
        if (!pairAddress) throw new Error('Pair not found')

        // 2. Approve Router to spend LP Tokens
        const routerAddress = CONTRACT_ADDRESSES.router
        const allowance = await contractService.getAllowance(
          pairAddress,
          walletAddress,
          routerAddress
        )

        if (BigInt(allowance) < BigInt(params.liquidity)) {
          await contractService.approveToken(
            pairAddress,
            routerAddress,
            params.liquidity,
            currentAccount
          )
        }

        // 3. Execute Remove — native variant returns one side as LUNES.
        let txHash: string | null
        if (params.receiveNativeSide) {
          const tokenAddr =
            params.receiveNativeSide === 'A' ? params.tokenB : params.tokenA
          const tokenMin =
            params.receiveNativeSide === 'A'
              ? params.amountBMin
              : params.amountAMin
          const nativeMin =
            params.receiveNativeSide === 'A'
              ? params.amountAMin
              : params.amountBMin
          txHash = await contractService.removeLiquidityNative(
            tokenAddr,
            params.liquidity,
            tokenMin,
            nativeMin,
            params.to,
            params.deadline,
            currentAccount
          )
        } else {
          txHash = await contractService.removeLiquidity(
            params.tokenA,
            params.tokenB,
            params.liquidity,
            params.amountAMin,
            params.amountBMin,
            params.to,
            params.deadline,
            currentAccount
          )
        }

        if (process.env.NODE_ENV !== 'production')
          console.log('Liquidity removed! Tx Hash:', txHash)
        return true
      } catch (err: unknown) {
        setError((err as Error).message || 'Error removing liquidity')
        console.error('Error removing liquidity:', err)
        return false
      } finally {
        setIsLoading(false)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [walletAddress, currentAccount]
  )

  // ========================================
  // Staking Methods
  // ========================================

  const stake = async (amount: string, durationMs: number): Promise<boolean> => {
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

      const txHash = await contractService.stake(
        amount,
        durationMs,
        currentAccount
      )
      if (process.env.NODE_ENV !== 'production')
        console.log('Staked! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error staking:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const unstake = async (): Promise<boolean> => {
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

      const txHash = await contractService.unstake(currentAccount)
      if (process.env.NODE_ENV !== 'production')
        console.log('Unstaked! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error unstaking:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const claimStakingRewards = async (): Promise<boolean> => {
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
      if (process.env.NODE_ENV !== 'production')
        console.log('Rewards Claimed! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError(parseBlockchainError(err))
      console.error('Error claiming rewards:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const claimRewards = claimStakingRewards

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
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      return await contractService.getProposal(proposalId)
    } catch (err) {
      console.error('Error getting proposal:', err)
      return null
    }
  }

  const voteOnProposal = async (
    proposalId: number,
    approve: boolean
  ): Promise<boolean> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return false
    }
    setIsLoading(true)
    setError(null)
    try {
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      const txHash = await contractService.vote(
        proposalId,
        approve,
        currentAccount
      )
      if (process.env.NODE_ENV !== 'production')
        console.log('Vote submitted! Tx Hash:', txHash)
      return true
    } catch (err: unknown) {
      setError((err as Error).message || 'Error voting')
      console.error('Error voting:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const createProposal = async (
    name: string,
    description: string,
    tokenAddress: string
  ): Promise<string | null> => {
    if (!walletAddress || !currentAccount) {
      setError('Connect your wallet first')
      return null
    }
    setIsLoading(true)
    setError(null)
    try {
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      const txHash = await contractService.createProposal(
        name,
        description,
        tokenAddress,
        currentAccount
      )
      if (process.env.NODE_ENV !== 'production')
        console.log('Proposal created! Tx Hash:', txHash)
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
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      return await contractService.getVotingPower(accountAddress)
    } catch (err) {
      console.error('Error getting voting power:', err)
      return '0'
    }
  }

  const getListingStats = async () => {
    try {
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      return await contractService.getListingStats()
    } catch (err) {
      console.error('Error getting listing stats:', err)
      return null
    }
  }

  const getProposalFee = async (): Promise<string> => {
    try {
      if (!contractService.getIsConnected())
        await contractService.connect(NETWORK)
      return await contractService.getProposalFee()
    } catch (err) {
      console.error('Error getting proposal fee:', err)
      return '100000000000'
    }
  }

  // Obter Info do Par
  const getPairInfo = async (
    tokenA: string,
    tokenB: string
  ): Promise<PairInfo | null> => {
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

  // Obter token_0 canônico do par
  const getPairToken0 = async (pairAddress: string): Promise<string | null> => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getPairToken0(pairAddress)
    } catch (err) {
      console.error('Error getting pair token0:', err)
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
  const getTokenBalance = async (
    token: string,
    account: string
  ): Promise<string> => {
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

  // Obter Balance nativo (LUNES) — saldo da conta na chain, em plancks (raw)
  const getNativeBalance = async (account: string): Promise<string> => {
    try {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK)
      }
      return await contractService.getNativeBalance(account)
    } catch (err) {
      console.error('Error getting native balance:', err)
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
      console.error('Format error', e)
      return '0'
    }
  }

  const parseAmount = (amount: string, decimals: number): string => {
    if (!amount) return '0'
    try {
      const [integerPart, fractionalPart = ''] = amount.split('.')
      const paddedFractional = fractionalPart
        .padEnd(decimals, '0')
        .slice(0, decimals)
      const combined = integerPart + paddedFractional
      // Remove leading zeros just in case
      return BigInt(combined).toString()
    } catch (e) {
      console.error('Parse error', e)
      return '0'
    }
  }

  // Bounded (utils/txBounds): deadline in seconds, slippage capped.
  const calculateDeadline = deadlineFromNow
  const calculateMinAmount = minAmountAfterSlippage

  const value: SDKContextState = useMemo(
    () => ({
      isConnected,
      isLoading,
      error,
      walletAddress,
      balance,
      walletKind,
      connectWallet,
      connectWalletConnect,
      cancelWalletConnect,
      disconnectWallet,
      signMessage,
      getLastError,
      getQuote,
      executeSwap,
      addLiquidity,
      removeLiquidity,
      getPairInfo,
      getPairToken0,
      stake,
      unstake,
      claimStakingRewards,
      claimRewards,
      getStakingUserInfo,
      getProposal,
      voteOnProposal,
      createProposal,
      getVotingPower,
      getListingStats,
      getProposalFee,
      getTokenInfo,
      getTokenBalance,
      getNativeBalance,
      formatAmount,
      parseAmount,
      calculateDeadline,
      calculateMinAmount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [
      isConnected,
      isLoading,
      error,
      walletAddress,
      balance,
      walletKind,
      signMessage
    ]
  )

  return <SDKContext.Provider value={value}>{children}</SDKContext.Provider>
}

// Hook para usar o SDK
export const useSDK = (): SDKContextState => {
  const context = useContext(SDKContext)

  if (!context) {
    throw new Error('useSDK deve ser usado dentro de um SDKProvider')
  }

  return context
}
