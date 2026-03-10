import { config } from '../config'

// ─────────────────────────────────────────────────────────────────
//  SubQuery GraphQL Client
//
//  Consumido pelo socialIndexerService como fonte primária de dados
//  on-chain quando SUBQUERY_ENDPOINT está configurado.
//
//  Arquitetura:
//    Lunes Blockchain → SubQuery Node → PostgreSQL → GraphQL API
//                                                          ↓
//                                           subqueryClient.ts (este arquivo)
//                                                          ↓
//                                         socialIndexerService.ts
//                                                          ↓
//                                        socialAnalyticsService.ts
//                                                          ↓
//                                              LeaderAnalyticsSnapshot
// ─────────────────────────────────────────────────────────────────

export interface SubquerySwapEvent {
  id: string
  blockNumber: string
  timestamp: string
  extrinsicHash: string | null
  trader: string
  pairSymbol: string | null
  amountIn: string
  amountOut: string
  tokenIn: string | null
  tokenOut: string | null
}

export interface SubqueryVaultEvent {
  id: string
  blockNumber: string
  timestamp: string
  extrinsicHash: string | null
  kind: 'DEPOSIT' | 'WITHDRAW' | 'TRADE_EXECUTED' | 'CIRCUIT_BREAKER'
  actor: string
  leader: string | null
  amountIn: string | null
  amountOut: string | null
  equityAfter: string | null
  drawdownBps: string | null
  pairSymbol: string | null
}

export interface SubqueryTradeEvent {
  id: string
  blockNumber: string
  timestamp: string
  extrinsicHash: string | null
  kind: 'OPEN' | 'CLOSE'
  trader: string
  pairSymbol: string | null
  side: string | null
  realizedPnl: string | null
  size: string | null
}

export interface SubqueryWalletSummary {
  id: string
  address: string
  totalSwapCount: number
  totalSwapVolumeIn: string
  totalSwapVolumeOut: string
  totalVaultDeposited: string
  totalVaultWithdrawn: string
  totalTradeCount: number
  totalRealizedPnl: string
  winningTrades: number
  losingTrades: number
  lastActivityAt: string
  firstActivityAt: string
}

export interface SubqueryPairStats {
  id: string
  pairSymbol: string
  swapCount: string
  volumeToken0: string
  volumeToken1: string
  lastSwapAt: string | null
}

export interface SubqueryDailyStats {
  id: string
  date: string
  swapCount: string
  swapVolumeUsd: string
  uniqueTraders: number
  liquidityEvents: string
  vaultDeposits: string
  vaultWithdrawals: string
}

export interface SubqueryIndexerMeta {
  lastProcessedHeight: number
  lastProcessedTimestamp: string
  targetHeight: number
  chain: string
  genesisHash: string
  indexerHealthy: boolean
  indexerNodeVersion: string
  queryNodeVersion: string
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const endpoint = config.subquery.endpoint
  if (!endpoint) throw new Error('SUBQUERY_ENDPOINT not configured')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`SubQuery GraphQL request failed: ${response.status} ${response.statusText}`)
  }

  const body = await response.json() as { data?: T; errors?: Array<{ message: string }> }

  if (body.errors?.length) {
    throw new Error(`SubQuery GraphQL errors: ${body.errors.map((e) => e.message).join(', ')}`)
  }

  return body.data as T
}

export const subqueryClient = {
  isEnabled(): boolean {
    return Boolean(config.subquery.endpoint)
  },

  // ── Indexer health/metadata ──────────────────────────────────
  async getMeta(): Promise<SubqueryIndexerMeta | null> {
    try {
      const data = await gql<{ _metadata: SubqueryIndexerMeta }>(`
        query {
          _metadata {
            lastProcessedHeight
            lastProcessedTimestamp
            targetHeight
            chain
            genesisHash
            indexerHealthy
            indexerNodeVersion
            queryNodeVersion
          }
        }
      `)
      return data._metadata
    } catch {
      return null
    }
  },

  // ── Swaps by wallet ──────────────────────────────────────────
  async getSwapsByAddress(address: string, limit = 500): Promise<SubquerySwapEvent[]> {
    const data = await gql<{ swapEvents: { nodes: SubquerySwapEvent[] } }>(`
      query GetSwaps($address: String!, $limit: Int!) {
        swapEvents(
          filter: { trader: { equalTo: $address } }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            extrinsicHash
            trader
            pairSymbol
            amountIn
            amountOut
            tokenIn
            tokenOut
          }
        }
      }
    `, { address, limit })
    return data.swapEvents.nodes
  },

  // ── Vault events by leader/depositor ────────────────────────
  async getVaultEventsByAddress(address: string, limit = 500): Promise<SubqueryVaultEvent[]> {
    const data = await gql<{ vaultEvents: { nodes: SubqueryVaultEvent[] } }>(`
      query GetVaultEvents($address: String!, $limit: Int!) {
        vaultEvents(
          filter: {
            or: [
              { actor: { equalTo: $address } }
              { leader: { equalTo: $address } }
            ]
          }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            kind
            actor
            leader
            amountIn
            amountOut
            equityAfter
            drawdownBps
            pairSymbol
          }
        }
      }
    `, { address, limit })
    return data.vaultEvents.nodes
  },

  // ── Trade events by wallet ───────────────────────────────────
  async getTradeEventsByAddress(address: string, limit = 500): Promise<SubqueryTradeEvent[]> {
    const data = await gql<{ tradeEvents: { nodes: SubqueryTradeEvent[] } }>(`
      query GetTrades($address: String!, $limit: Int!) {
        tradeEvents(
          filter: { trader: { equalTo: $address } }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            kind
            trader
            pairSymbol
            side
            realizedPnl
            size
          }
        }
      }
    `, { address, limit })
    return data.tradeEvents.nodes
  },

  // ── All events by wallet (swaps + vault + trades) ────────────
  async getAllEventsByAddress(address: string, limit = 500): Promise<{
    swaps: SubquerySwapEvent[]
    vaultEvents: SubqueryVaultEvent[]
    tradeEvents: SubqueryTradeEvent[]
  }> {
    const [swaps, vaultEvents, tradeEvents] = await Promise.all([
      this.getSwapsByAddress(address, limit),
      this.getVaultEventsByAddress(address, limit),
      this.getTradeEventsByAddress(address, limit),
    ])
    return { swaps, vaultEvents, tradeEvents }
  },

  // ── Wallet summary (aggregated by SubQuery) ──────────────────
  async getWalletSummary(address: string): Promise<SubqueryWalletSummary | null> {
    const data = await gql<{ walletSummary: SubqueryWalletSummary | null }>(`
      query GetWalletSummary($id: String!) {
        walletSummary(id: $id) {
          id
          address
          totalSwapCount
          totalSwapVolumeIn
          totalSwapVolumeOut
          totalVaultDeposited
          totalVaultWithdrawn
          totalTradeCount
          totalRealizedPnl
          winningTrades
          losingTrades
          lastActivityAt
          firstActivityAt
        }
      }
    `, { id: address })
    return data.walletSummary
  },

  // ── Pair stats ───────────────────────────────────────────────
  async getPairStats(pairSymbol: string): Promise<SubqueryPairStats | null> {
    const data = await gql<{ pairStats: SubqueryPairStats | null }>(`
      query GetPairStats($id: String!) {
        pairStats(id: $id) {
          id
          pairSymbol
          swapCount
          volumeToken0
          volumeToken1
          lastSwapAt
        }
      }
    `, { id: pairSymbol })
    return data.pairStats
  },

  // ── Daily stats ──────────────────────────────────────────────
  async getDailyStats(days = 30): Promise<SubqueryDailyStats[]> {
    const data = await gql<{ dailyProtocolStats: { nodes: SubqueryDailyStats[] } }>(`
      query GetDailyStats($limit: Int!) {
        dailyProtocolStats(
          orderBy: DATE_DESC
          first: $limit
        ) {
          nodes {
            id
            date
            swapCount
            swapVolumeUsd
            uniqueTraders
            liquidityEvents
            vaultDeposits
            vaultWithdrawals
          }
        }
      }
    `, { limit: days })
    return data.dailyProtocolStats.nodes
  },

  // ── Latest block indexed ─────────────────────────────────────
  async getLatestIndexedBlock(): Promise<number> {
    const meta = await this.getMeta()
    return meta?.lastProcessedHeight ?? 0
  },
}
