import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../utils/signing'

const REWARDS_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

export interface TradingRewardEntry {
  id: string
  amount: number
  type: 'LEADER' | 'TRADER'
  rank: number | null
  txHash: string | null
  payoutStatus: string
  weekStart: string
  weekEnd: string
  createdAt: string
}

export interface PendingTradingRewardsSummary {
  total: number
  leaderRewards: number
  traderRewards: number
  stakerRewards: number
  stakerClaimMode: 'on-chain'
  entries: TradingRewardEntry[]
}

export interface TradingRewardClaimResult {
  claimed: boolean
  message?: string
  totalAmount?: number
  rewardsClaimed?: number
  claimedAt?: string
}

export interface RewardLeaderRankingEntry {
  id: string
  address: string
  name: string
  username: string
  isAI: boolean
  avatar: string
  roi30d: number
  winRate: number
  sharpe: number
  followers: number
  aum: string
  aumRaw: number
  score: number
  tags: string[]
  rank: number
}

export interface RewardTraderRankingEntry {
  address: string
  volume: number
  tradeCount: number
  rank: number
}

export interface RewardRankingsResponse {
  window: {
    mode: 'current' | 'previous'
    weekStart: string
    weekEnd: string
  }
  leaders: RewardLeaderRankingEntry[]
  traders: RewardTraderRankingEntry[]
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${REWARDS_API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    },
    ...options
  })

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')

  if (!response.ok) {
    if (isJson) {
      const data = await response.json()
      throw new Error(data.error || 'API error')
    }

    const text = await response.text()
    throw new Error(
      `API error: ${response.status} ${response.statusText} - ${text.slice(0, 100)}`
    )
  }

  if (isJson) {
    return (await response.json()) as T
  }

  return {} as T
}

function toQueryString(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      params.set(key, String(value))
    }
  }

  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

async function signRewardsAction(
  action: string,
  address: string,
  signMessage: (message: string) => Promise<string>,
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >
) {
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

  return {
    nonce: metadata.nonce,
    timestamp: metadata.timestamp,
    signature
  }
}

const rewardsApi = {
  async getPendingRewards(
    address: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<PendingTradingRewardsSummary> {
    const auth = await signRewardsAction(
      'rewards.pending',
      address,
      signMessage
    )
    const query = toQueryString({
      address,
      nonce: auth.nonce,
      timestamp: auth.timestamp,
      signature: auth.signature
    })
    const data = await fetchApi<{ pending: PendingTradingRewardsSummary }>(
      `/api/v1/rewards/pending${query}`
    )

    return data.pending
  },

  async claimTradingRewards(
    address: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<TradingRewardClaimResult> {
    const auth = await signRewardsAction('rewards.claim', address, signMessage)
    const data = await fetchApi<{ result: TradingRewardClaimResult }>(
      '/api/v1/rewards/claim',
      {
        method: 'POST',
        body: JSON.stringify({
          address,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature: auth.signature
        })
      }
    )

    return data.result
  },

  async getRankings(input?: {
    limit?: number
    segment?: 'all' | 'traders' | 'bots'
    week?: 'current' | 'previous'
  }): Promise<RewardRankingsResponse> {
    const query = toQueryString({
      limit: input?.limit,
      segment: input?.segment,
      week: input?.week
    })
    const data = await fetchApi<{ rankings: RewardRankingsResponse }>(
      `/api/v1/rewards/rankings${query}`
    )

    return data.rankings
  }
}

export default rewardsApi
