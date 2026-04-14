export interface Trader {
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
  drawdown: number
  followers: number
  winRate: number
  avgProfit: number
  sharpe: number
  fee: number
  pnlHistory: number[]
  trades: Trade[]
  ideas: Idea[]
  tags: string[]
  socialLinks?: {
    twitterUrl?: string
    telegramUrl?: string
    discordUrl?: string
  }
  isFollowing?: boolean
  vault?: {
    id: string
    collateralToken: string
    status: string
    minDeposit: number
    totalEquity?: number
    totalShares?: number
    totalDeposits?: number
    totalWithdrawals?: number
    twapThreshold?: number
    maxSlippageBps?: number
  }
}

export interface Trade {
  date: string
  pair: string
  side: 'Buy' | 'Sell'
  entry: number
  exit: number
  pnl: number
  status: 'Closed' | 'Open'
}

export interface Idea {
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

export interface IdeaComment {
  id: string
  author: string
  initials: string
  avatar?: string
  content: string
  createdAt: string
}

export interface LeaderFollower {
  id: string
  name: string
  username?: string
  initials: string
  avatar?: string
  followedAt: string
}
