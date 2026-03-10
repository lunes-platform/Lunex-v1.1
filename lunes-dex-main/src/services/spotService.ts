/**
 * Spot API Service — REST + WebSocket client for the Lunex Spot Orderbook backend.
 */

const SPOT_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'
const SPOT_WS_URL = process.env.REACT_APP_SPOT_WS_URL || 'ws://localhost:4001'

// ─── Types ───

// ─── Fee Split Model ───
// Total fee collected on each trade is split between 4 beneficiaries.
// Maker fee (limit orders): 0.1% → 50% Team | 30% Stakers | 20% Affiliates
// Taker fee (market/stop):  0.25% → 40% Team | 30% Stakers | 20% Affiliates | 10% Treasury

export const SPOT_FEE_SPLIT = {
  maker: {
    team: 0.50,
    stakers: 0.30,
    affiliates: 0.20,
    treasury: 0.00,
  },
  taker: {
    team: 0.40,
    stakers: 0.30,
    affiliates: 0.20,
    treasury: 0.10,
  },
} as const

export interface FeeBreakdown {
  total: number
  team: number
  stakers: number
  affiliates: number
  treasury: number
}

export function calcFeeBreakdown(fee: number, isMaker: boolean): FeeBreakdown {
  const split = isMaker ? SPOT_FEE_SPLIT.maker : SPOT_FEE_SPLIT.taker
  return {
    total: fee,
    team: fee * split.team,
    stakers: fee * split.stakers,
    affiliates: fee * split.affiliates,
    treasury: fee * split.treasury,
  }
}

export interface SpotPair {
  id: string
  symbol: string
  baseName: string
  quoteName: string
  baseDecimals: number
  quoteDecimals: number
  isNativeBase: boolean
  isNativeQuote: boolean
  makerFeeBps: number
  takerFeeBps: number
}

export interface SpotTicker {
  symbol: string
  lastPrice: number
  high24h: number
  low24h: number
  volume24h: number
  quoteVolume24h: number
  change24h: number
  tradeCount: number
  bestBid: number | null
  bestAsk: number | null
  spread: number | null
}

export interface OrderbookLevel {
  price: number
  amount: number
  total: number
}

export interface OrderbookSnapshot {
  bids: OrderbookLevel[]
  asks: OrderbookLevel[]
  spread: number | null
  bestBid: number | null
  bestAsk: number | null
}

export interface SpotOrder {
  id: string
  pairId: string
  makerAddress: string
  side: string
  type: string
  price: string
  stopPrice?: string | null
  amount: string
  filledAmount: string
  remainingAmount: string
  status: string
  nonce: string
  orderHash: string
  timeInForce: string
  expiresAt?: string | null
  createdAt: string
  pair?: { symbol: string }
}

export interface SpotTrade {
  id: string
  pairId: string
  makerOrderId: string
  takerOrderId: string
  makerAddress: string
  takerAddress: string
  side: string
  price: string
  amount: string
  quoteAmount: string
  makerFee: string
  takerFee: string
  settlementStatus: 'PENDING' | 'SETTLING' | 'SETTLED' | 'FAILED' | 'SKIPPED'
  settlementAttempts: number
  settlementPayload?: Record<string, unknown> | null
  settlementError?: string | null
  lastSettlementAttemptAt?: string | null
  nextSettlementRetryAt?: string | null
  txHash?: string | null
  settledAt?: string | null
  createdAt: string
  pair?: { symbol: string }
}

export interface SpotCandle {
  openTime: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  quoteVolume: string
  tradeCount: number
}

export interface CreateOrderParams {
  pairSymbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT'
  price?: string
  stopPrice?: string
  amount: string
  timeInForce?: 'GTC' | 'IOC' | 'FOK'
  nonce: string
  signature: string
  makerAddress: string
}

// ─── WebSocket Manager ───

type WsCallback = (data: any) => void

class SpotWebSocket {
  private ws: WebSocket | null = null
  private readonly listeners = new Map<string, Set<WsCallback>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 10
  private readonly subscriptions = new Set<string>()

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    try {
      this.ws = new WebSocket(SPOT_WS_URL)

      this.ws.onopen = () => {
        console.log('[SpotWS] Connected')
        this.reconnectAttempts = 0
        // Re-subscribe to all channels
        Array.from(this.subscriptions).forEach(channel => {
          this.send({ action: 'subscribe', channel })
        })
      }

      this.ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.channel) {
            const callbacks = this.listeners.get(msg.channel)
            if (callbacks) {
              Array.from(callbacks).forEach(cb => {
                cb(msg.data)
              })
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      this.ws.onclose = () => {
        console.log('[SpotWS] Disconnected')
        this.scheduleReconnect()
      }

      this.ws.onerror = () => {
        // onclose will fire after this
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  subscribe(channel: string, callback: WsCallback) {
    this.subscriptions.add(channel)

    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    const callbacks = this.listeners.get(channel)
    if (callbacks) callbacks.add(callback)

    this.send({ action: 'subscribe', channel })
  }

  unsubscribe(channel: string, callback: WsCallback) {
    const callbacks = this.listeners.get(channel)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        this.listeners.delete(channel)
        this.subscriptions.delete(channel)
        this.send({ action: 'unsubscribe', channel })
      }
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}

export const spotWs = new SpotWebSocket()

// ─── REST API Client ───

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${SPOT_API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API error')
  return data
}

export const spotApi = {
  // ─── Pairs ───
  async getPairs(): Promise<SpotPair[]> {
    const data = await fetchApi<{ pairs: SpotPair[] }>('/api/v1/pairs')
    return data.pairs
  },

  async getTicker(symbol: string): Promise<SpotTicker> {
    return await fetchApi<SpotTicker>(
      `/api/v1/pairs/${encodeURIComponent(symbol)}/ticker`
    )
  },

  // ─── Orderbook ───
  async getOrderbook(symbol: string, depth = 25): Promise<OrderbookSnapshot> {
    return await fetchApi<OrderbookSnapshot>(
      `/api/v1/orderbook/${encodeURIComponent(symbol)}?depth=${depth}`
    )
  },

  // ─── Orders ───
  async createOrder(params: CreateOrderParams): Promise<{ order: SpotOrder }> {
    return await fetchApi<{ order: SpotOrder }>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify(params)
    })
  },

  async cancelOrder(
    orderId: string,
    makerAddress: string,
    signature: string
  ): Promise<{ order: SpotOrder }> {
    return await fetchApi<{ order: SpotOrder }>(`/api/v1/orders/${orderId}`, {
      method: 'DELETE',
      body: JSON.stringify({ makerAddress, signature })
    })
  },

  async getUserOrders(
    makerAddress: string,
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<{ orders: SpotOrder[] }> {
    let url = `/api/v1/orders?makerAddress=${encodeURIComponent(
      makerAddress
    )}&limit=${limit}&offset=${offset}`
    if (status) url += `&status=${status}`
    return await fetchApi<{ orders: SpotOrder[] }>(url)
  },

  // ─── Trades ───
  async getRecentTrades(
    symbol: string,
    limit = 50
  ): Promise<{ trades: SpotTrade[] }> {
    return await fetchApi<{ trades: SpotTrade[] }>(
      `/api/v1/trades/${encodeURIComponent(symbol)}?limit=${limit}`
    )
  },

  async getUserTrades(
    address: string,
    limit = 50,
    offset = 0
  ): Promise<{ trades: SpotTrade[] }> {
    return await fetchApi<{ trades: SpotTrade[] }>(
      `/api/v1/trades?address=${encodeURIComponent(
        address
      )}&limit=${limit}&offset=${offset}`
    )
  },

  // ─── Candles ───
  async getCandles(
    symbol: string,
    timeframe = '1h',
    limit = 200
  ): Promise<{ candles: SpotCandle[] }> {
    return await fetchApi<{ candles: SpotCandle[] }>(
      `/api/v1/candles/${encodeURIComponent(
        symbol
      )}?timeframe=${timeframe}&limit=${limit}`
    )
  }
}

export default spotApi
