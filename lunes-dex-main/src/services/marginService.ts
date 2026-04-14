const MARGIN_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

interface SignedReadAuth {
  nonce: string
  timestamp: number
  signature: string
}

export interface MarginAccountOverview {
  id: string
  address: string
  collateralToken: string
  collateralAvailable: number
  collateralLocked: number
  totalRealizedPnl: number
  totalEquity: number
  updatedAt: string
}

export interface MarginMarkPriceMeta {
  source: 'LAST_TRADE' | 'BOOK_MID'
  observedAt: string
  ageMs: number
}

export interface MarginPriceHealthSummary {
  trackedPairs: number
  healthyPairs: number
  unhealthyPairs: number
  hasActiveAlerts: boolean
  blockedPairs: number
  operationalBlockAfterFailures: number
}

export interface MarginPriceHealthPairState {
  pairSymbol: string
  status: 'HEALTHY' | 'UNHEALTHY'
  isOperationallyBlocked: boolean
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
  lastResolvedSource: 'LAST_TRADE' | 'BOOK_MID' | null
  lastResolvedObservedAt: string | null
  lastResolvedAgeMs: number | null
  lastResolvedPrice: number | null
}

export interface MarginPriceHealthSnapshot {
  generatedAt: string
  summary: MarginPriceHealthSummary
  pairs: MarginPriceHealthPairState[]
}

export interface MarginPositionOverview {
  id: string
  pairSymbol: string
  side: 'BUY' | 'SELL'
  status: string
  collateralAmount: number
  leverage: number
  notional: number
  quantity: number
  entryPrice: number
  markPrice: number
  borrowedAmount: number
  maintenanceMargin: number
  liquidationPrice: number
  unrealizedPnl: number
  realizedPnl: number
  equity: number
  healthFactor: number | null
  isLiquidatable: boolean
  markPriceMeta?: MarginMarkPriceMeta
  openedAt: string
  closedAt?: string | null
  updatedAt: string
}

export interface MarginOverview {
  account: MarginAccountOverview
  positions: MarginPositionOverview[]
  risk: {
    openPositions: number
    totalUnrealizedPnl: number
    liquidatablePositions: number
    markPriceHealth: {
      sources: Array<'LAST_TRADE' | 'BOOK_MID'>
      latestObservedAt: string | null
      maxAgeMs: number
      hasStaleMarks: boolean
    } | null
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${MARGIN_API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    },
    ...options
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Margin API error')
  }

  return data
}

export const marginApi = {
  async getOverview(
    address: string,
    auth: SignedReadAuth
  ): Promise<MarginOverview> {
    return await fetchApi<MarginOverview>(
      `/api/v1/margin?address=${encodeURIComponent(address)}&nonce=${encodeURIComponent(auth.nonce)}&timestamp=${auth.timestamp}&signature=${encodeURIComponent(auth.signature)}`
    )
  },

  async getPriceHealth(
    pairSymbol?: string
  ): Promise<MarginPriceHealthSnapshot> {
    const query = pairSymbol
      ? `?pairSymbol=${encodeURIComponent(pairSymbol)}`
      : ''
    return await fetchApi<MarginPriceHealthSnapshot>(
      `/api/v1/margin/price-health${query}`
    )
  },

  async resetPriceHealth(
    pairSymbol?: string
  ): Promise<MarginPriceHealthSnapshot> {
    return await fetchApi<MarginPriceHealthSnapshot>(
      '/api/v1/margin/price-health/reset',
      {
        method: 'POST',
        body: JSON.stringify(pairSymbol ? { pairSymbol } : {})
      }
    )
  },

  async depositCollateral(input: {
    address: string
    token: string
    amount: string
    nonce: string
    timestamp: number
    signature: string
  }): Promise<{ account: MarginAccountOverview }> {
    return await fetchApi<{ account: MarginAccountOverview }>(
      '/api/v1/margin/collateral/deposit',
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    )
  },

  async withdrawCollateral(input: {
    address: string
    token: string
    amount: string
    nonce: string
    timestamp: number
    signature: string
  }): Promise<{ account: MarginAccountOverview }> {
    return await fetchApi<{ account: MarginAccountOverview }>(
      '/api/v1/margin/collateral/withdraw',
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    )
  },

  async openPosition(input: {
    address: string
    pairSymbol: string
    side: 'BUY' | 'SELL'
    collateralAmount: string
    leverage: string
    nonce: string
    timestamp: number
    signature: string
  }): Promise<{ position: MarginPositionOverview; overview: MarginOverview }> {
    return await fetchApi<{
      position: MarginPositionOverview
      overview: MarginOverview
    }>('/api/v1/margin/positions', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },

  async closePosition(input: {
    positionId: string
    address: string
    nonce: string
    timestamp: number
    signature: string
  }): Promise<MarginOverview> {
    return await fetchApi<MarginOverview>(
      `/api/v1/margin/positions/${input.positionId}/close`,
      {
        method: 'POST',
        body: JSON.stringify({
          address: input.address,
          nonce: input.nonce,
          timestamp: input.timestamp,
          signature: input.signature
        })
      }
    )
  },

  async liquidatePosition(input: {
    positionId: string
    liquidatorAddress: string
    nonce: string
    timestamp: number
    signature: string
  }): Promise<MarginOverview> {
    return await fetchApi<MarginOverview>(
      `/api/v1/margin/positions/${input.positionId}/liquidate`,
      {
        method: 'POST',
        body: JSON.stringify({
          liquidatorAddress: input.liquidatorAddress,
          nonce: input.nonce,
          timestamp: input.timestamp,
          signature: input.signature
        })
      }
    )
  }
}
