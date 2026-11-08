/**
 * Spot API Service — REST + WebSocket client for the Lunex Spot Orderbook backend.
 */
import { signedAuthHeaders } from '../utils/signing'
import { SPOT_API_URL } from '../config/api'

import {
  handleReadAuthError,
  readAuthHeaders,
  type ReadAuth
} from './sessionService'

/**
 * WS endpoint: REACT_APP_SPOT_WS_URL when set; otherwise derived from the
 * Spot API URL — the dev API on :4000 serves WS on :4001 (spot-api wsPort),
 * any other host goes through the reverse proxy's `/ws` route
 * (docker/nginx.*.conf). Never a hardcoded localhost for a remote API.
 */
export function resolveSpotWsUrl(
  explicit: string | undefined,
  apiUrl: string
): string {
  const set = explicit?.trim()
  if (set) return set
  let url: URL
  try {
    url = new URL(apiUrl)
  } catch {
    // relative API base (same-origin deployment) → same-origin /ws
    url = new URL(apiUrl, window.location.origin)
  }
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (url.port === '4000') return `${protocol}//${url.hostname}:4001`
  return `${protocol}//${url.host}/ws`
}

// Vite only replaces process.env.REACT_APP_* when defined at build time.
const readEnvWsUrl = (): string | undefined => {
  try {
    return process.env.REACT_APP_SPOT_WS_URL
  } catch {
    return undefined
  }
}

const SPOT_WS_URL = resolveSpotWsUrl(readEnvWsUrl(), SPOT_API_URL)

// ─── Types ───

// ─── Fee Split Model ───
// Total fee collected on each trade is split between 4 beneficiaries.
// Maker fee (limit orders): 0.1% → 50% Team | 30% Stakers | 20% Affiliates
// Taker fee (market/stop):  0.25% → 40% Team | 30% Stakers | 20% Affiliates | 10% Treasury

export const SPOT_FEE_SPLIT = {
  maker: {
    team: 0.5,
    stakers: 0.3,
    affiliates: 0.2,
    treasury: 0.0
  },
  taker: {
    team: 0.4,
    stakers: 0.3,
    affiliates: 0.2,
    treasury: 0.1
  }
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
    treasury: fee * split.treasury
  }
}

export interface SpotPair {
  id: string
  symbol: string
  baseName: string
  quoteName: string
  baseToken: string
  quoteToken: string
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

export interface SignedActionAuth {
  nonce: string
  timestamp: number
  signature: string
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
  timestamp: number
  signature: string
  makerAddress: string
  expiresAt?: string
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
  /** Read-session token binding this socket to a wallet (user:<addr>). */
  private authToken: string | null = null
  private authedAddress: string | null = null

  /**
   * Bind (or unbind with null) the socket to a wallet using the 8h read
   * session. Private `user:<address>` channels are only (re)subscribed after
   * the server confirms with `authenticated`.
   */
  authenticate(token: string | null) {
    if (token === this.authToken) return
    this.authToken = token
    this.authedAddress = null
    if (token) this.send({ action: 'auth', token })
  }

  private isUserChannel(channel: string) {
    return channel.startsWith('user:')
  }

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
        if (process.env.NODE_ENV !== 'production')
          console.log('[SpotWS] Connected')
        this.reconnectAttempts = 0
        this.authedAddress = null
        if (this.authToken) this.send({ action: 'auth', token: this.authToken })
        // Re-subscribe to public channels; user channels wait for auth
        Array.from(this.subscriptions)
          .filter(channel => !this.isUserChannel(channel))
          .forEach(channel => {
            this.send({ action: 'subscribe', channel })
          })
      }

      this.ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'authenticated' && typeof msg.address === 'string') {
            this.authedAddress = msg.address
            Array.from(this.subscriptions)
              .filter(channel => channel === `user:${msg.address}`)
              .forEach(channel => this.send({ action: 'subscribe', channel }))
            return
          }
          // Acks (subscribed/unsubscribed) carry no data — never hand
          // listeners an undefined payload.
          if (
            msg.channel &&
            (msg.type === 'update' || msg.type === 'snapshot')
          ) {
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
        if (process.env.NODE_ENV !== 'production')
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

    if (
      this.isUserChannel(channel) &&
      channel !== `user:${this.authedAddress}`
    ) {
      return // sent once the server confirms the session (see onmessage)
    }
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
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    }
  })
  const data = await res.json()
  if (!res.ok) throw handleReadAuthError(data.error)
  return data
}

export interface SpotBalance {
  token: string
  total: string
  locked: string
  available: string
}

export const spotApi = {
  /** Spot vault balances (private read: read session or signed headers). */
  async getBalances(
    address: string,
    auth: ReadAuth
  ): Promise<{ balances: SpotBalance[]; settlementEnabled?: boolean }> {
    return fetchApi<{ balances: SpotBalance[]; settlementEnabled?: boolean }>(
      `/api/v1/balances?address=${encodeURIComponent(address)}`,
      { headers: readAuthHeaders(auth) }
    )
  },

  /**
   * Public: whether spot-api settles trades on-chain, and against which
   * spot_settlement vault. `settlementEnabled: false` = off-chain matching
   * only (trades end SKIPPED); the UI must say so.
   */
  async getSettlementMode(): Promise<{
    settlementEnabled: boolean
    contractAddress: string | null
  }> {
    return fetchApi('/api/v1/balances/settlement')
  },

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
    auth: SignedActionAuth
  ): Promise<{ order: SpotOrder }> {
    return await fetchApi<{ order: SpotOrder }>(`/api/v1/orders/${orderId}`, {
      method: 'DELETE',
      body: JSON.stringify({ makerAddress, ...auth })
    })
  },

  async getUserOrders(
    makerAddress: string,
    auth: ReadAuth,
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<{ orders: SpotOrder[] }> {
    let url = `/api/v1/orders?makerAddress=${encodeURIComponent(
      makerAddress
    )}&limit=${limit}&offset=${offset}`
    if (status) url += `&status=${encodeURIComponent(status)}`
    return await fetchApi<{ orders: SpotOrder[] }>(url, {
      headers: readAuthHeaders(auth)
    })
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
    auth: ReadAuth,
    limit = 50,
    offset = 0
  ): Promise<{ trades: SpotTrade[] }> {
    return await fetchApi<{ trades: SpotTrade[] }>(
      `/api/v1/trades?address=${encodeURIComponent(
        address
      )}&limit=${limit}&offset=${offset}`,
      { headers: readAuthHeaders(auth) }
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
  },

  // ─── Favorites ───
  async getFavorites(address: string, auth: ReadAuth): Promise<string[]> {
    const data = await fetchApi<{ favorites: string[] }>(
      `/api/v1/user/${encodeURIComponent(address)}/favorites`,
      { headers: readAuthHeaders(auth) }
    )
    return data.favorites
  },

  async addFavorite(
    address: string,
    pairSymbol: string,
    auth: SignedActionAuth
  ): Promise<void> {
    await fetchApi(`/api/v1/user/${encodeURIComponent(address)}/favorites`, {
      method: 'POST',
      body: JSON.stringify({ pairSymbol, ...auth })
    })
  },

  async removeFavorite(
    address: string,
    pairSymbol: string,
    auth: SignedActionAuth
  ): Promise<void> {
    await fetchApi(
      `/api/v1/user/${encodeURIComponent(address)}/favorites/${encodeURIComponent(pairSymbol)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(auth)
      }
    )
  },

  // ─── Market Info ───
  async getMarketInfo(pairSymbol: string): Promise<any> {
    return await fetchApi(
      `/api/v1/markets/${encodeURIComponent(pairSymbol)}/info`
    )
  }
}
