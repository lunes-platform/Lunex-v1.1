import type {
  Idea,
  IdeaComment,
  LeaderFollower,
  Trader
} from '../pages/social/types'

const SOCIAL_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

let signedActionNonceCounter = 0

interface LeaderApiResponse {
  id: string
  name: string
  username: string
  address: string
  avatar: string
  isAI: boolean
  isVerified: boolean
  bio: string
  memberSince: string
  roi30d: number
  roi90d: number
  aum: string
  aumRaw: number
  drawdown: number
  followers: number
  winRate: number
  avgProfit: number
  sharpe: number
  fee: number
  socialLinks?: {
    twitterUrl?: string
    telegramUrl?: string
    discordUrl?: string
  }
  pnlHistory: number[]
  tags: string[]
  isFollowing?: boolean
  vault?: {
    id: string
    collateralToken: string
    status: string
    minDeposit: number
    totalEquity: number
    totalShares: number
    totalDeposits: number
    totalWithdrawals: number
    twapThreshold: number
    maxSlippageBps: number
  } | null
  trades?: Array<{
    date: string
    pair: string
    side: 'Buy' | 'Sell'
    entry: number
    exit: number
    pnl: number
    status: 'Closed' | 'Open'
  }>
  ideas?: IdeaApiResponse[]
}

interface IdeaApiResponse {
  id: string
  title: string
  description: string
  pair: string
  direction: 'Bullish' | 'Bearish'
  likes: number
  comments: number
  date: string
  tags: string[]
  leader?: {
    id: string
    name: string
    username: string
    isAI: boolean
  }
}

interface IdeaCommentApiResponse {
  id: string
  author: string
  initials: string
  avatar?: string
  content: string
  createdAt: string
}

interface LeaderFollowerApiResponse {
  id: string
  name: string
  username?: string
  initials: string
  avatar?: string
  followedAt: string
}

export interface SocialStats {
  totalAum: number
  activeTraders: number
  aiAgents: number
  totalFollowers: number
  totalIdeas: number
  totalVaultEquity: number
}

export interface PipelineStatus {
  enabled: boolean
  prismaReady: boolean
  indexedEvents: number
  snapshots: number
  latestIndexedEvent: {
    blockNumber: number
    timestamp: string
  } | null
  wsEndpoint?: string
  chainName?: string
}

export interface SocialIdeaFeedItem extends Idea {
  leader?: {
    id: string
    name: string
    username: string
    isAI: boolean
  }
}

interface LeadersQueryParams {
  tab?: 'all' | 'traders' | 'bots'
  search?: string
  sortBy?: 'roi30d' | 'followers' | 'winRate' | 'sharpe'
  limit?: number
}

interface DepositToVaultInput {
  amount: string
  followerAddress: string
  token: string
  nonce: string
  timestamp: number
  signature: string
}

export interface UpsertLeaderProfileInput {
  address: string
  name: string
  username: string
  bio: string
  avatar?: string
  fee: number
  twitterUrl?: string
  telegramUrl?: string
  discordUrl?: string
  nonce: string
  timestamp: number
  signature: string
}

interface WithdrawFromVaultInput {
  followerAddress: string
  shares: string
  nonce: string
  timestamp: number
  signature: string
}

interface SignedAddressActionInput {
  address: string
  nonce: string
  timestamp: number
  signature: string
}

interface SignedCommentActionInput extends SignedAddressActionInput {
  content: string
}

interface ApiKeyChallengeInput {
  leaderAddress: string
}

interface RotateApiKeyInput extends ApiKeyChallengeInput {
  challengeId: string
  signature: string
}

export interface CopytradePosition {
  id: string
  followerAddress: string
  shareBalance: number
  currentValue: number
  netDeposited: number
  totalWithdrawn: number
  highWaterMarkValue: number
  feePaid: number
  realizedPnl: number
  vault: {
    id: string
    name: string
    collateralToken: string
    leaderId: string
    leaderName: string
    leaderUsername: string
  }
}

export interface CopytradeDepositResult {
  depositId: string
  sharesMinted: number
  amount: number
  positionId: string
  txHash: string | null
  executionMode: 'db-journal' | 'on-chain-confirmed'
}

export interface CopytradeWithdrawResult {
  withdrawalId: string
  grossAmount: number
  feeAmount: number
  netAmount: number
  profitAmount: number
  remainingShares: number
  collateralToken?: string
  followerAddress?: string
  txHash: string | null
  executionMode: 'db-journal' | 'on-chain-confirmed'
}

export interface CopytradeActivityItem {
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'SIGNAL'
  createdAt: string
  leaderId: string
  leaderName: string
  followerAddress?: string
  amount?: number
  token?: string
  grossAmount?: number
  feeAmount?: number
  netAmount?: number
  pairSymbol?: string
  side?: 'BUY' | 'SELL'
  amountIn?: number
  executionPrice?: number
  slices?: number
}

export interface CopytradeExecution {
  id: string
  pairSymbol: string
  side: 'BUY' | 'SELL'
  sliceIndex: number
  totalSlices: number
  amountIn: number
  amountOut: number
  executionPrice: number
  slippageBps: number
  status: string
  strategyTag?: string
  createdAt: string
}

export interface ApiKeyChallenge {
  challengeId: string
  message: string
  expiresAt: string
}

export interface LeaderApiKeyResult {
  apiKey: string
  allowApiTrading: boolean
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SOCIAL_API_URL}${path}`, {
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
    } else {
      const text = await response.text()
      throw new Error(
        `API error: ${response.status} ${response.statusText} - ${text.slice(0, 100)}`
      )
    }
  }

  if (isJson) {
    const data = await response.json()
    return data as T
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {} as T
}

function normalizeSignedValue(
  value: string | number | boolean | Array<string | number> | undefined | null
) {
  if (Array.isArray(value)) {
    return value.join(',')
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return value == null ? '' : String(value)
}

export function createSignedActionMetadata() {
  signedActionNonceCounter = (signedActionNonceCounter + 1) % 1000
  return {
    nonce: `${Date.now()}${signedActionNonceCounter.toString().padStart(3, '0')}`,
    timestamp: Date.now()
  }
}

export function buildWalletActionMessage(input: {
  action: string
  address: string
  nonce: string
  timestamp: number | string
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >
}) {
  const lines = [`lunex-auth:${input.action}`, `address:${input.address}`]

  const orderedFields = Object.entries(input.fields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${normalizeSignedValue(value)}`)
  }

  lines.push(`nonce:${input.nonce}`)
  lines.push(`timestamp:${normalizeSignedValue(input.timestamp)}`)
  return lines.join('\n')
}

export function buildFollowLeaderMessage(input: {
  leaderId: string
  address: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'social.follow-leader',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId
    }
  })
}

export function buildUnfollowLeaderMessage(input: {
  leaderId: string
  address: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'social.unfollow-leader',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId
    }
  })
}

export function buildLikeIdeaMessage(input: {
  ideaId: string
  address: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'social.like-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      ideaId: input.ideaId
    }
  })
}

export function buildUnlikeIdeaMessage(input: {
  ideaId: string
  address: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'social.unlike-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      ideaId: input.ideaId
    }
  })
}

export function buildCommentIdeaMessage(input: {
  ideaId: string
  address: string
  content: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'social.comment-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      ideaId: input.ideaId,
      content: input.content
    }
  })
}

export function buildUpsertLeaderProfileMessage(
  input: UpsertLeaderProfileInput
) {
  return buildWalletActionMessage({
    action: 'social.upsert-profile',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      name: input.name,
      username: input.username,
      bio: input.bio,
      avatar: input.avatar || '',
      fee: input.fee,
      twitterUrl: input.twitterUrl || '',
      telegramUrl: input.telegramUrl || '',
      discordUrl: input.discordUrl || ''
    }
  })
}

export function buildCopytradeDepositMessage(input: {
  leaderId: string
  followerAddress: string
  token: string
  amount: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'copytrade.deposit',
    address: input.followerAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      token: input.token,
      amount: input.amount
    }
  })
}

export function buildCopytradeWithdrawMessage(input: {
  leaderId: string
  followerAddress: string
  shares: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'copytrade.withdraw',
    address: input.followerAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      shares: input.shares
    }
  })
}

function mapIdea(idea: IdeaApiResponse): SocialIdeaFeedItem {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    pair: idea.pair,
    direction: idea.direction,
    likes: idea.likes,
    comments: idea.comments,
    date: idea.date,
    tags: idea.tags,
    leader: idea.leader
  }
}

function mapIdeaComment(comment: IdeaCommentApiResponse): IdeaComment {
  return {
    id: comment.id,
    author: comment.author,
    initials: comment.initials,
    avatar: comment.avatar,
    content: comment.content,
    createdAt: comment.createdAt
  }
}

function mapLeaderFollower(
  follower: LeaderFollowerApiResponse
): LeaderFollower {
  return {
    id: follower.id,
    name: follower.name,
    username: follower.username,
    initials: follower.initials,
    avatar: follower.avatar,
    followedAt: follower.followedAt
  }
}

function mapTrader(leader: LeaderApiResponse): Trader {
  return {
    id: leader.id,
    name: leader.name,
    username: leader.username,
    address: leader.address,
    avatar: leader.avatar,
    isAI: leader.isAI,
    isVerified: leader.isVerified,
    bio: leader.bio,
    memberSince: leader.memberSince,
    roi30d: leader.roi30d,
    roi90d: leader.roi90d,
    aum: leader.aum,
    drawdown: leader.drawdown,
    followers: leader.followers,
    winRate: leader.winRate,
    avgProfit: leader.avgProfit,
    sharpe: leader.sharpe,
    fee: leader.fee,
    socialLinks: leader.socialLinks,
    pnlHistory: leader.pnlHistory,
    trades: leader.trades ?? [],
    ideas: (leader.ideas ?? []).map(mapIdea),
    tags: leader.tags,
    isFollowing: leader.isFollowing ?? false,
    vault: leader.vault
      ? {
          id: leader.vault.id,
          collateralToken: leader.vault.collateralToken,
          status: leader.vault.status,
          minDeposit: leader.vault.minDeposit,
          totalEquity: leader.vault.totalEquity,
          totalShares: leader.vault.totalShares,
          totalDeposits: leader.vault.totalDeposits,
          totalWithdrawals: leader.vault.totalWithdrawals,
          twapThreshold: leader.vault.twapThreshold,
          maxSlippageBps: leader.vault.maxSlippageBps
        }
      : undefined
  }
}

function toQueryString(
  params: Record<string, string | number | undefined>
): string {
  const search = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  })

  const query = search.toString()
  return query ? `?${query}` : ''
}

export const socialApi = {
  async getStats(): Promise<SocialStats> {
    const data = await fetchApi<{ stats: SocialStats }>('/api/v1/social/stats')
    return data.stats
  },

  async getLeaderboard(limit = 10): Promise<Trader[]> {
    const query = toQueryString({ limit })
    const data = await fetchApi<{ leaderboard: LeaderApiResponse[] }>(
      `/api/v1/social/leaderboard${query}`
    )
    return data.leaderboard.map(mapTrader)
  },

  async getPipelineStatus(): Promise<PipelineStatus> {
    return await fetchApi<PipelineStatus>('/api/v1/social/analytics/status')
  },

  async getLeaders(params: LeadersQueryParams = {}): Promise<Trader[]> {
    const query = toQueryString({
      tab: params.tab === 'all' ? undefined : params.tab,
      search: params.search,
      sortBy: params.sortBy ?? 'roi30d',
      limit: params.limit ?? 50
    })

    const data = await fetchApi<{ leaders: LeaderApiResponse[] }>(
      `/api/v1/social/leaders${query}`
    )
    return data.leaders.map(mapTrader)
  },

  async getLeaderProfile(
    leaderId: string,
    viewerAddress?: string,
    signMessage?: (message: string) => Promise<string>
  ): Promise<Trader> {
    let query = toQueryString({ viewerAddress })
    if (viewerAddress && signMessage) {
      const metadata = createSignedActionMetadata()
      const signature = await signMessage(
        buildWalletActionMessage({
          action: 'social.leader-profile',
          address: viewerAddress,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields: { leaderId }
        })
      )
      query = toQueryString({
        viewerAddress,
        nonce: metadata.nonce,
        timestamp: metadata.timestamp,
        signature
      })
    }
    const data = await fetchApi<{ leader: LeaderApiResponse }>(
      `/api/v1/social/leaders/${leaderId}${query}`
    )
    return mapTrader(data.leader)
  },

  async getLeaderProfileByAddress(
    address: string,
    viewerAddress?: string,
    signMessage?: (message: string) => Promise<string>
  ): Promise<Trader> {
    let query = toQueryString({ address, viewerAddress })
    if (viewerAddress && signMessage) {
      const metadata = createSignedActionMetadata()
      const signature = await signMessage(
        buildWalletActionMessage({
          action: 'social.leader-profile-by-address',
          address: viewerAddress,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields: { address }
        })
      )
      query = toQueryString({
        address,
        viewerAddress,
        nonce: metadata.nonce,
        timestamp: metadata.timestamp,
        signature
      })
    }
    const data = await fetchApi<{ leader: LeaderApiResponse }>(
      `/api/v1/social/leaders/by-address${query}`
    )
    return mapTrader(data.leader)
  },

  async upsertLeaderProfile(input: UpsertLeaderProfileInput): Promise<Trader> {
    const data = await fetchApi<{ leader: LeaderApiResponse }>(
      '/api/v1/social/leaders/profile',
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    )
    return mapTrader(data.leader)
  },

  async getIdeas(limit = 50): Promise<SocialIdeaFeedItem[]> {
    const query = toQueryString({ limit })
    const data = await fetchApi<{ ideas: IdeaApiResponse[] }>(
      `/api/v1/social/ideas${query}`
    )
    return data.ideas.map(mapIdea)
  },

  async getIdeaComments(ideaId: string, limit = 50): Promise<IdeaComment[]> {
    const query = toQueryString({ limit })
    const data = await fetchApi<{ comments: IdeaCommentApiResponse[] }>(
      `/api/v1/social/ideas/${ideaId}/comments${query}`
    )
    return data.comments.map(mapIdeaComment)
  },

  async commentOnIdea(
    ideaId: string,
    input: SignedCommentActionInput
  ): Promise<IdeaComment> {
    const data = await fetchApi<{ comment: IdeaCommentApiResponse }>(
      `/api/v1/social/ideas/${ideaId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    )
    return mapIdeaComment(data.comment)
  },

  async likeIdea(
    ideaId: string,
    input: SignedAddressActionInput
  ): Promise<{ liked: boolean; alreadyLiked: boolean; likes?: number }> {
    return await fetchApi(`/api/v1/social/ideas/${ideaId}/like`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },

  async unlikeIdea(
    ideaId: string,
    input: SignedAddressActionInput
  ): Promise<{ liked: boolean; alreadyLiked: boolean; likes?: number }> {
    return await fetchApi(`/api/v1/social/ideas/${ideaId}/like`, {
      method: 'DELETE',
      body: JSON.stringify(input)
    })
  },

  async getLeaderFollowers(
    leaderId: string,
    limit = 20
  ): Promise<LeaderFollower[]> {
    const query = toQueryString({ limit })
    const data = await fetchApi<{ followers: LeaderFollowerApiResponse[] }>(
      `/api/v1/social/leaders/${leaderId}/followers${query}`
    )
    return data.followers.map(mapLeaderFollower)
  },

  async followLeader(
    leaderId: string,
    input: SignedAddressActionInput
  ): Promise<void> {
    await fetchApi(`/api/v1/social/leaders/${leaderId}/follow`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },

  async unfollowLeader(
    leaderId: string,
    input: SignedAddressActionInput
  ): Promise<void> {
    await fetchApi(`/api/v1/social/leaders/${leaderId}/follow`, {
      method: 'DELETE',
      body: JSON.stringify(input)
    })
  },

  async depositToVault(
    leaderId: string,
    input: DepositToVaultInput
  ): Promise<CopytradeDepositResult> {
    return await fetchApi(`/api/v1/copytrade/vaults/${leaderId}/deposit`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },

  async withdrawFromVault(
    leaderId: string,
    input: WithdrawFromVaultInput
  ): Promise<CopytradeWithdrawResult> {
    return await fetchApi(`/api/v1/copytrade/vaults/${leaderId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },

  async getPositions(
    address: string,
    auth: SignedAddressActionInput
  ): Promise<CopytradePosition[]> {
    const query = toQueryString({
      address,
      nonce: auth.nonce,
      timestamp: auth.timestamp,
      signature: auth.signature
    })
    const data = await fetchApi<{ positions: CopytradePosition[] }>(
      `/api/v1/copytrade/positions${query}`
    )
    return data.positions
  },

  async getActivity(
    address: string,
    auth: SignedAddressActionInput,
    limit = 20
  ): Promise<CopytradeActivityItem[]> {
    const query = toQueryString({
      address,
      limit,
      nonce: auth.nonce,
      timestamp: auth.timestamp,
      signature: auth.signature
    })
    const data = await fetchApi<{ activity: CopytradeActivityItem[] }>(
      `/api/v1/copytrade/activity${query}`
    )
    return data.activity
  },

  async getVaultExecutions(
    leaderId: string,
    limit = 20
  ): Promise<CopytradeExecution[]> {
    const query = toQueryString({ limit })
    const data = await fetchApi<{ executions: CopytradeExecution[] }>(
      `/api/v1/copytrade/vaults/${leaderId}/executions${query}`
    )
    return data.executions
  },

  async getApiKeyChallenge(
    leaderId: string,
    input: ApiKeyChallengeInput
  ): Promise<ApiKeyChallenge> {
    const query = toQueryString({ leaderAddress: input.leaderAddress })
    return await fetchApi(
      `/api/v1/copytrade/leaders/${leaderId}/api-key/challenge${query}`
    )
  },

  async rotateLeaderApiKey(
    leaderId: string,
    input: RotateApiKeyInput
  ): Promise<LeaderApiKeyResult> {
    return await fetchApi(`/api/v1/copytrade/leaders/${leaderId}/api-key`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }
}

export default socialApi
