import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode
} from 'react'
import {
  spotApi,
  spotWs,
  SpotPair,
  SpotTicker,
  SpotOrder,
  SpotTrade,
  OrderbookSnapshot,
  CreateOrderParams,
  SignedActionAuth
} from '../services/spotService'
import {
  buildSpotCancelSignMessage,
  buildSpotOrderSignMessage,
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../utils/signing'
import { useSDK } from './SDKContext'

// ─── Types ───

export interface SpotContextState {
  // Connection
  isConnected: boolean
  walletAddress: string | null

  // Data
  pairs: SpotPair[]
  selectedPair: string
  ticker: SpotTicker | null
  orderbook: OrderbookSnapshot | null
  recentTrades: SpotTrade[]
  userOrders: SpotOrder[]
  userTrades: SpotTrade[]

  // Loading states
  isLoading: boolean
  error: string | null

  // Actions
  setSelectedPair: (symbol: string) => void
  setWalletAddress: (address: string | null) => void
  createOrder: (
    params: Omit<CreateOrderParams, 'makerAddress' | 'nonce' | 'signature'> & {
      signMessage: (message: string) => Promise<string>
    }
  ) => Promise<boolean>
  cancelOrder: (
    orderId: string,
    signMessage: (message: string) => Promise<string>
  ) => Promise<boolean>
  refreshOrders: () => Promise<void>
  refreshTrades: () => Promise<void>
}

const SpotContext = createContext<SpotContextState | null>(null)

// ─── Provider ───

interface SpotProviderProps {
  children: ReactNode
}

export const SpotProvider: React.FC<SpotProviderProps> = ({ children }) => {
  const { walletAddress: sdkWalletAddress, signMessage } = useSDK()
  const [isConnected, setIsConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [pairs, setPairs] = useState<SpotPair[]>([])
  const [selectedPair, setSelectedPairState] = useState('WLUNES/LUSDT')
  const [ticker, setTicker] = useState<SpotTicker | null>(null)
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot | null>(null)
  const [recentTrades, setRecentTrades] = useState<SpotTrade[]>([])
  const [userOrders, setUserOrders] = useState<SpotOrder[]>([])
  const [userTrades, setUserTrades] = useState<SpotTrade[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nonceCounter = useRef(Date.now())
  const prevPairRef = useRef(selectedPair)

  const signReadAction = useCallback(
    async (
      action: string,
      address: string,
      fields?: Record<string, string | number>
    ): Promise<SignedActionAuth> => {
      const metadata = createSignedActionMetadata()
      const signature = await signMessage(
        buildWalletActionMessage({
          action,
          address,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields
        })
      )

      return { ...metadata, signature }
    },
    [signMessage]
  )

  useEffect(() => {
    setWalletAddress(sdkWalletAddress)
  }, [sdkWalletAddress])

  // ─── Load pairs on mount ───
  useEffect(() => {
    const loadPairs = async () => {
      try {
        const p = await spotApi.getPairs()
        setPairs(p)
        setIsConnected(true)
      } catch {
        console.warn('[Spot] API not available, using offline mode')
        setIsConnected(false)
      }
    }
    loadPairs()
  }, [])

  // ─── Connect WebSocket ───
  useEffect(() => {
    spotWs.connect()
    return () => {
      spotWs.disconnect()
    }
  }, [])

  // ─── Subscribe to pair channels ───
  useEffect(() => {
    const obChannel = `orderbook:${selectedPair}`
    const trChannel = `trades:${selectedPair}`
    const tkChannel = `ticker:${selectedPair}`

    const handleOrderbook = (data: OrderbookSnapshot) => {
      setOrderbook(data)
    }

    const handleTrade = (data: SpotTrade) => {
      setRecentTrades(prev => [data, ...prev.slice(0, 49)])
    }

    const handleTicker = (data: SpotTicker) => {
      setTicker(data)
    }

    spotWs.subscribe(obChannel, handleOrderbook)
    spotWs.subscribe(trChannel, handleTrade)
    spotWs.subscribe(tkChannel, handleTicker)

    // Unsubscribe from previous pair
    if (prevPairRef.current !== selectedPair) {
      const prevOb = `orderbook:${prevPairRef.current}`
      const prevTr = `trades:${prevPairRef.current}`
      const prevTk = `ticker:${prevPairRef.current}`
      spotWs.unsubscribe(prevOb, handleOrderbook)
      spotWs.unsubscribe(prevTr, handleTrade)
      spotWs.unsubscribe(prevTk, handleTicker)
      prevPairRef.current = selectedPair
    }

    return () => {
      spotWs.unsubscribe(obChannel, handleOrderbook)
      spotWs.unsubscribe(trChannel, handleTrade)
      spotWs.unsubscribe(tkChannel, handleTicker)
    }
  }, [selectedPair])

  // ─── Fetch initial data when pair changes ───
  useEffect(() => {
    const fetchPairData = async () => {
      if (!isConnected) return

      try {
        const [tickerData, obData, tradesData] = await Promise.all([
          spotApi.getTicker(selectedPair).catch(() => null),
          spotApi.getOrderbook(selectedPair).catch(() => null),
          spotApi
            .getRecentTrades(selectedPair, 50)
            .catch(() => ({ trades: [] }))
        ])

        if (tickerData) setTicker(tickerData)
        if (obData) setOrderbook(obData)
        setRecentTrades(tradesData.trades)
      } catch (err) {
        console.error('[Spot] Error fetching pair data:', err)
      }
    }

    fetchPairData()
  }, [selectedPair, isConnected])

  // ─── Fetch user data when wallet changes ───
  useEffect(() => {
    if (!walletAddress || !isConnected) {
      setUserOrders([])
      setUserTrades([])
      return
    }

    const fetchUserData = async () => {
      try {
        const [ordersAuth, tradesAuth] = await Promise.all([
          signReadAction('orders.list', walletAddress, {
            limit: 50,
            offset: 0
          }),
          signReadAction('trades.list', walletAddress, { limit: 50, offset: 0 })
        ])

        const [ordersRes, tradesRes] = await Promise.all([
          spotApi
            .getUserOrders(walletAddress, ordersAuth, undefined, 50)
            .catch(() => ({ orders: [] })),
          spotApi
            .getUserTrades(walletAddress, tradesAuth, 50)
            .catch(() => ({ trades: [] }))
        ])
        setUserOrders(ordersRes.orders)
        setUserTrades(tradesRes.trades)
      } catch {
        // ignore
      }
    }

    fetchUserData()

    // Subscribe to user-specific channel
    const userChannel = `user:${walletAddress}`
    const handleUserUpdate = () => {
      fetchUserData()
    }
    spotWs.subscribe(userChannel, handleUserUpdate)

    return () => {
      spotWs.unsubscribe(userChannel, handleUserUpdate)
    }
  }, [walletAddress, isConnected, signReadAction])

  // ─── Actions ───

  const setSelectedPair = useCallback((symbol: string) => {
    setSelectedPairState(symbol)
    setOrderbook(null)
    setRecentTrades([])
    setTicker(null)
  }, [])

  const generateNonce = useCallback(() => {
    nonceCounter.current += 1
    return `${Date.now()}${String(nonceCounter.current % 1000).padStart(3, '0')}`
  }, [])

  const createOrder = useCallback(
    async (
      params: Omit<
        CreateOrderParams,
        'makerAddress' | 'nonce' | 'signature'
      > & {
        signMessage: (message: string) => Promise<string>
      }
    ): Promise<boolean> => {
      if (!walletAddress) {
        setError('Connect your wallet first')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        const nonce = generateNonce()
        const timestamp = Date.now()
        const messageToSign = buildSpotOrderSignMessage({
          pairSymbol: params.pairSymbol,
          side: params.side,
          type: params.type,
          price: params.price,
          stopPrice: params.stopPrice,
          amount: params.amount,
          nonce,
          timestamp
        })
        const signature = await params.signMessage(messageToSign)

        await spotApi.createOrder({
          pairSymbol: params.pairSymbol,
          side: params.side,
          type: params.type,
          price: params.price,
          stopPrice: params.stopPrice,
          amount: params.amount,
          timeInForce: params.timeInForce,
          nonce,
          timestamp,
          signature,
          makerAddress: walletAddress
        })

        // Refresh user orders
        const ordersAuth = await signReadAction('orders.list', walletAddress, {
          limit: 50,
          offset: 0
        })
        const ordersRes = await spotApi.getUserOrders(walletAddress, ordersAuth)
        setUserOrders(ordersRes.orders)

        return true
      } catch (err: unknown) {
        setError((err as Error).message || 'Failed to create order')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [walletAddress, generateNonce, signReadAction]
  )

  const cancelOrder = useCallback(
    async (
      orderId: string,
      signMessage: (message: string) => Promise<string>
    ): Promise<boolean> => {
      if (!walletAddress) {
        setError('Connect your wallet first')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        const messageToSign = buildSpotCancelSignMessage(orderId)
        const signature = await signMessage(messageToSign)

        await spotApi.cancelOrder(orderId, walletAddress, signature)

        // Refresh user orders
        const ordersAuth = await signReadAction('orders.list', walletAddress, {
          limit: 50,
          offset: 0
        })
        const ordersRes = await spotApi.getUserOrders(walletAddress, ordersAuth)
        setUserOrders(ordersRes.orders)

        return true
      } catch (err: unknown) {
        setError((err as Error).message || 'Failed to cancel order')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [walletAddress, signReadAction]
  )

  const refreshOrders = useCallback(async () => {
    if (!walletAddress || !isConnected) return
    try {
      const auth = await signReadAction('orders.list', walletAddress, {
        limit: 50,
        offset: 0
      })
      const res = await spotApi.getUserOrders(walletAddress, auth)
      setUserOrders(res.orders)
    } catch {
      // ignore
    }
  }, [walletAddress, isConnected, signReadAction])

  const refreshTrades = useCallback(async () => {
    if (!walletAddress || !isConnected) return
    try {
      const auth = await signReadAction('trades.list', walletAddress, {
        limit: 50,
        offset: 0
      })
      const res = await spotApi.getUserTrades(walletAddress, auth)
      setUserTrades(res.trades)
    } catch {
      // ignore
    }
  }, [walletAddress, isConnected, signReadAction])

  const value: SpotContextState = {
    isConnected,
    walletAddress,
    pairs,
    selectedPair,
    ticker,
    orderbook,
    recentTrades,
    userOrders,
    userTrades,
    isLoading,
    error,
    setSelectedPair,
    setWalletAddress,
    createOrder,
    cancelOrder,
    refreshOrders,
    refreshTrades
  }

  return <SpotContext.Provider value={value}>{children}</SpotContext.Provider>
}

// ─── Hook ───

export const useSpot = (): SpotContextState => {
  const context = useContext(SpotContext)
  if (!context) {
    throw new Error('useSpot must be used within a SpotProvider')
  }
  return context
}
