import React, { useState, useEffect, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import { useToast } from '../../components/feedback/ToastProvider'
import rewardsApi from '../../services/rewardsService'

type TradingTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

interface TierInfo {
  name: TradingTier
  minVolume: number
  maxVolume: number | null
  rewardMultiplier: number
  color: string
  desc: string
}

interface UserRewardsData {
  tier: TradingTier
  totalStaked: string
  userStaked: string
  stakingPendingRewards: string
  tradingPendingRewards: number
  leaderPendingRewards: number
  traderPendingRewards: number
  tradingRewardEntries: number
  apr: string
  lockPeriod: number
  nextTierProgress: number
}

interface LeaderEntry {
  id: string
  name: string
  username: string
  address: string
  isAI: boolean
  avatar: string
  roi30d: number
  winRate: number
  sharpe: number
  followers: number
  aum: string
  aumRaw: number
  score: number
  rank?: number
  tags: string[]
}

interface TopTraderEntry {
  address: string
  volume: number
  tradeCount: number
  rank?: number
}

const TIERS: TierInfo[] = [
  {
    name: 'Bronze',
    minVolume: 0,
    maxVolume: 10000,
    rewardMultiplier: 1,
    color: '#CD7F32',
    desc: 'Starting tier for all stakers'
  },
  {
    name: 'Silver',
    minVolume: 10000,
    maxVolume: 50000,
    rewardMultiplier: 1.5,
    color: '#A0AEC0',
    desc: '1.5x reward multiplier'
  },
  {
    name: 'Gold',
    minVolume: 50000,
    maxVolume: 200000,
    rewardMultiplier: 2,
    color: '#ECC94B',
    desc: '2x reward multiplier'
  },
  {
    name: 'Platinum',
    minVolume: 200000,
    maxVolume: null,
    rewardMultiplier: 3,
    color: '#9B6FFF',
    desc: 'Maximum 3x multiplier'
  }
]

// ─── SVG Tier Icons ───

const TierIcon: React.FC<{ tier: TradingTier; size?: number }> = ({
  tier,
  size = 20
}) => {
  const s = size
  switch (tier) {
    case 'Bronze':
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 15l-2 5l6-3l6 3l-2-5" transform="translate(-4, 0)" />
          <circle cx="12" cy="10" r="6" />
        </svg>
      )
    case 'Silver':
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )
    case 'Gold':
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4l3 12h14l3-12-5.5 7L12 4l-4.5 7L2 4z" />
          <path d="M5 16l-1 4h16l-1-4" />
        </svg>
      )
    case 'Platinum':
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      )
  }
}

// ─── Animations ───

const fadeIn = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`
const shimmer = keyframes`0%{background-position:-200% 0}100%{background-position:200% 0}`

// ─── Styled Components ───

const Page = styled.div`
  min-height: 100vh;
  background: #0d0d0d;
  padding: 80px 24px 48px;
`

const Container = styled.div`
  max-width: 960px;
  margin: 0 auto;
  animation: ${fadeIn} 0.3s ease;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 32px;
  padding: 32px 0 16px;
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 12px;
  letter-spacing: -1px;
  span {
    background: linear-gradient(135deg, #6c38ff, #9b6fff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const PageSubtitle = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0 auto;
  max-width: 520px;
  line-height: 1.6;
`

// ─── How It Works ───

const HowItWorks = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 32px;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`

const StepCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 24px 20px;
  text-align: center;
  transition: all 0.2s;
  &:hover {
    border-color: rgba(108, 56, 255, 0.2);
    background: rgba(108, 56, 255, 0.04);
  }
`

const StepNumber = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(108, 56, 255, 0.12);
  color: #6c38ff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
`

const StepTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
`

const StepDesc = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.5;
`

// ─── Stats ───

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
`

const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 20px;
`

const StatLabel = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`

const StatValue = styled.div<{ $color?: string }>`
  color: ${p => p.$color || '#fff'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
  font-weight: 800;
`

const StatSub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
  font-family: 'Inter', sans-serif;
`

// ─── Cards ───

const Card = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 16px;
`

const SectionTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  margin-bottom: 16px;
`

const RewardAmount = styled.div<{ $color?: string }>`
  color: ${p => p.$color || '#6C38FF'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 36px;
  font-weight: 800;
  text-align: center;
  margin-bottom: 4px;
`

const RewardSub = styled.div`
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 20px;
  font-family: 'Inter', sans-serif;
`

const ClaimButton = styled.button<{ $disabled?: boolean }>`
  width: 100%;
  padding: 16px;
  border: none;
  border-radius: 12px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: ${p => (p.$disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.15s;
  background: ${p =>
    p.$disabled
      ? 'rgba(255,255,255,0.05)'
      : 'linear-gradient(135deg, #6C38FF, #5A2EE0)'};
  color: ${p => (p.$disabled ? 'rgba(255,255,255,0.3)' : '#fff')};
  &:hover {
    opacity: ${p => (p.$disabled ? 1 : 0.9)};
  }
`

const ClaimGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`

const ClaimCard = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 20px;
`

const ClaimCardTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  text-align: center;
  margin-bottom: 12px;
`

const ClaimBreakdown = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
`

const ClaimBreakdownItem = styled.div`
  flex: 1;
  text-align: center;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 10px 12px;
`

const ClaimBreakdownLabel = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Inter', sans-serif;
  margin-bottom: 4px;
`

const ClaimBreakdownValue = styled.div`
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
`

// ─── Progress ───

const ProgressSection = styled.div`
  margin-top: 20px;
`

const ProgressBar = styled.div`
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  height: 8px;
  overflow: hidden;
`

const ProgressFill = styled.div<{ $progress: number; $color: string }>`
  background: linear-gradient(90deg, ${p => p.$color}, ${p => p.$color}aa);
  height: 100%;
  width: ${p => Math.min(p.$progress, 100)}%;
  border-radius: 8px;
  transition: width 0.5s ease;
`

const ProgressMeta = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Inter', sans-serif;
`

// ─── Tier Rows ───

const TierRow = styled.div<{ $active: boolean; $color: string }>`
  display: grid;
  grid-template-columns: 44px 1fr 100px 60px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 12px;
  margin-bottom: 6px;
  background: ${p => (p.$active ? `${p.$color}0a` : 'transparent')};
  border: 1px solid
    ${p => (p.$active ? `${p.$color}30` : 'rgba(255,255,255,0.04)')};
  transition: all 0.15s;
  ${p => p.$active && `box-shadow: 0 0 20px ${p.$color}10;`}
`

const TierIconWrap = styled.div<{ $color: string }>`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: ${p => p.$color}15;
  color: ${p => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
`

const TierInfo2 = styled.div`
  padding-left: 12px;
`

const TierName = styled.div<{ $color: string }>`
  color: ${p => p.$color};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
`

const TierVolume = styled.div`
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  font-family: 'Inter', sans-serif;
  margin-top: 2px;
`

const TierMultiplier = styled.div<{ $active: boolean; $color: string }>`
  color: ${p => (p.$active ? '#6C38FF' : p.$color)};
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-align: right;
`

const ActiveBadge = styled.div`
  background: rgba(108, 56, 255, 0.12);
  color: #6c38ff;
  font-size: 10px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  padding: 3px 8px;
  border-radius: 6px;
  text-align: center;
  letter-spacing: 0.5px;
`

// ─── Leaderboard ───

const LeaderboardTabs = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 3px;
`

const LBTab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  background: ${p => (p.$active ? 'rgba(108,56,255,0.15)' : 'transparent')};
  color: ${p => (p.$active ? '#6C38FF' : 'rgba(255,255,255,0.4)')};
  &:hover {
    color: ${p => (p.$active ? '#6C38FF' : 'rgba(255,255,255,0.6)')};
  }
`

const LeaderRow = styled.div`
  display: grid;
  grid-template-columns: 28px 40px 1fr 80px 80px 60px;
  align-items: center;
  padding: 12px 8px;
  border-radius: 10px;
  margin-bottom: 4px;
  transition: background 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  @media (max-width: 768px) {
    grid-template-columns: 28px 40px 1fr 70px 70px;
  }
`

const LeaderRank = styled.div<{ $top3: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: ${p => (p.$top3 ? '#6C38FF' : 'rgba(255,255,255,0.3)')};
  text-align: center;
`

const LeaderAvatar = styled.div<{ $isAI: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: ${p =>
    p.$isAI ? 'rgba(0,192,118,0.12)' : 'rgba(108,56,255,0.12)'};
  color: ${p => (p.$isAI ? '#00C076' : '#6C38FF')};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 700;
  overflow: hidden;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 10px;
  }
`

const LeaderNameBlock = styled.div`
  padding-left: 8px;
  overflow: hidden;
`

const LeaderName = styled.div`
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const LeaderMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
`

const LeaderTag = styled.span<{ $ai?: boolean }>`
  font-size: 9px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  padding: 1px 5px;
  border-radius: 4px;
  background: ${p => (p.$ai ? 'rgba(0,192,118,0.12)' : 'rgba(108,56,255,0.1)')};
  color: ${p => (p.$ai ? '#00C076' : '#6C38FF')};
  letter-spacing: 0.3px;
`

const LeaderStat = styled.div<{ $positive?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  color: ${p => (p.$positive ? '#00C076' : 'rgba(255,255,255,0.6)')};
`

const LeaderStatLabel = styled.div`
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  text-align: right;
  margin-top: 1px;
  font-family: 'Inter', sans-serif;
`

const LeaderHeader = styled.div`
  display: grid;
  grid-template-columns: 28px 40px 1fr 80px 80px 60px;
  padding: 0 8px 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  @media (max-width: 768px) {
    grid-template-columns: 28px 40px 1fr 70px 70px;
  }
`

const HeaderLabel = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Inter', sans-serif;
  text-align: right;
  &:first-child,
  &:nth-child(2),
  &:nth-child(3) {
    text-align: left;
  }
`

const EmptyLB = styled.div`
  text-align: center;
  padding: 32px 16px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  font-family: 'Inter', sans-serif;
`

// ─── General ───

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Inter', sans-serif;
`

const ConnectButton = styled.button`
  background: linear-gradient(135deg, #6c38ff, #5a2ee0);
  border: none;
  border-radius: 12px;
  padding: 14px 32px;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 16px;
  transition: opacity 0.15s;
  &:hover {
    opacity: 0.9;
  }
`

const LoadingBar = styled.div`
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, #6c38ff, transparent);
  background-size: 200% auto;
  animation: ${shimmer} 1.5s infinite;
  margin: 20px 0;
`

const TierBadgeHeader = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${p => p.$color}12;
  border: 1px solid ${p => p.$color}30;
  border-radius: 10px;
  padding: 8px 14px;
  color: ${p => p.$color};
  font-weight: 700;
  font-size: 13px;
  font-family: 'Space Grotesk', sans-serif;
`

const HeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const SectionDivider = styled.div`
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(108, 56, 255, 0.2),
    transparent
  );
  margin: 32px 0;
`

// ─── Component ───

export const Rewards: React.FC = () => {
  const sdk = useSDK()
  const toast = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isStakingClaiming, setIsStakingClaiming] = useState(false)
  const [isTradingClaiming, setIsTradingClaiming] = useState(false)
  const [rewardsData, setRewardsData] = useState<UserRewardsData | null>(null)

  // Leaderboard state
  const [lbTab, setLbTab] = useState<'all' | 'traders' | 'bots'>('all')
  const [leaders, setLeaders] = useState<LeaderEntry[]>([])
  const [lbLoading, setLbLoading] = useState(false)

  // Top Traders state
  const [topTraders, setTopTraders] = useState<TopTraderEntry[]>([])
  const [topTradersLoading, setTopTradersLoading] = useState(false)

  // ─── Staking Data ───

  const loadRewardsData = useCallback(async () => {
    if (!sdk.isConnected || !sdk.walletAddress) return

    setIsLoading(true)
    try {
      const [stakingResult, tradingResult] = await Promise.allSettled([
        sdk.getStakingUserInfo(sdk.walletAddress),
        rewardsApi.getPendingRewards(sdk.walletAddress, sdk.signMessage)
      ])

      const stakingInfo =
        stakingResult.status === 'fulfilled' ? stakingResult.value : null
      const tradingRewards =
        tradingResult.status === 'fulfilled' ? tradingResult.value : null

      if (!stakingInfo && !tradingRewards) {
        setRewardsData(null)
        return
      }

      const userStakedNum = stakingInfo
        ? parseFloat(stakingInfo.userStaked) / 1e8
        : 0

      let tier: TradingTier = 'Bronze'
      if (userStakedNum >= 200000) tier = 'Platinum'
      else if (userStakedNum >= 50000) tier = 'Gold'
      else if (userStakedNum >= 10000) tier = 'Silver'

      const currentTierIndex = TIERS.findIndex(t => t.name === tier)
      const nextTier = TIERS[currentTierIndex + 1]
      let nextTierProgress = 100
      if (nextTier) {
        nextTierProgress = Math.round(
          ((userStakedNum - TIERS[currentTierIndex].minVolume) /
            (nextTier.minVolume - TIERS[currentTierIndex].minVolume)) *
            100
        )
      }

      setRewardsData({
        tier,
        totalStaked: stakingInfo?.totalStaked || '0',
        userStaked: stakingInfo?.userStaked || '0',
        stakingPendingRewards: stakingInfo?.pendingRewards || '0',
        tradingPendingRewards: tradingRewards?.total || 0,
        leaderPendingRewards: tradingRewards?.leaderRewards || 0,
        traderPendingRewards: tradingRewards?.traderRewards || 0,
        tradingRewardEntries: tradingRewards?.entries.length || 0,
        apr: stakingInfo?.apr || '0',
        lockPeriod: stakingInfo?.lockPeriod || 0,
        nextTierProgress: Math.min(nextTierProgress, 100)
      })
    } catch (error) {
      console.error('Error loading rewards data:', error)
      setRewardsData(null)
    } finally {
      setIsLoading(false)
    }
  }, [sdk])

  useEffect(() => {
    loadRewardsData()
  }, [loadRewardsData])

  // ─── Leaderboard Data ───

  const fetchRewardRankings = useCallback(
    async (tab: 'all' | 'traders' | 'bots') => {
      setLbLoading(true)
      setTopTradersLoading(true)
      try {
        const rankings = await rewardsApi.getRankings({
          limit: 10,
          segment: tab,
          week: 'current'
        })
        setLeaders(Array.isArray(rankings.leaders) ? rankings.leaders : [])
        setTopTraders(Array.isArray(rankings.traders) ? rankings.traders : [])
      } catch {
        setLeaders([])
        setTopTraders([])
      } finally {
        setLbLoading(false)
        setTopTradersLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchRewardRankings(lbTab)
  }, [lbTab, fetchRewardRankings])

  // ─── Claim ───

  const handleClaimStakingRewards = async () => {
    if (
      !rewardsData ||
      rewardsData.stakingPendingRewards === '0' ||
      !sdk.walletAddress
    )
      return

    setIsStakingClaiming(true)
    try {
      toast.info('Submitting staking reward claim on-chain...')
      const success = await sdk.claimStakingRewards()
      if (success) {
        toast.success('Staking reward claim submitted')
        await loadRewardsData()
      } else {
        toast.error(sdk.error || 'Unable to claim staking rewards')
      }
    } catch {
      toast.error('Unable to claim staking rewards')
    } finally {
      setIsStakingClaiming(false)
    }
  }

  const handleClaimTradingRewards = async () => {
    if (
      !rewardsData ||
      rewardsData.tradingPendingRewards <= 0 ||
      !sdk.walletAddress
    )
      return

    setIsTradingClaiming(true)
    try {
      toast.info('Requesting wallet signature for trading rewards...')
      const result = await rewardsApi.claimTradingRewards(
        sdk.walletAddress,
        sdk.signMessage
      )
      if (result.claimed) {
        toast.success(
          `Claimed ${fmtDisplayAmount(
            result.totalAmount ?? rewardsData.tradingPendingRewards
          )} LUNES of leader/trader rewards`
        )
      } else {
        toast.info(result.message || 'No trading rewards to claim')
      }
      await loadRewardsData()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to claim trading rewards'
      )
    } finally {
      setIsTradingClaiming(false)
    }
  }

  // ─── Helpers ───

  const getCurrentTier = (): TierInfo => {
    if (!rewardsData) return TIERS[0]
    return TIERS.find(t => t.name === rewardsData.tier) || TIERS[0]
  }

  const getNextTier = (): TierInfo | null => {
    const idx = TIERS.findIndex(t => t.name === rewardsData?.tier)
    if (idx === -1 || idx === TIERS.length - 1) return null
    return TIERS[idx + 1]
  }

  const fmtBalance = (balance: string, decimals = 8): string => {
    const value = BigInt(balance)
    const divisor = BigInt(10 ** decimals)
    const integerPart = value / divisor
    const fractionalPart = value % divisor
    const fracStr = fractionalPart
      .toString()
      .padStart(decimals, '0')
      .substring(0, 2)
    return `${integerPart.toLocaleString('en-US')}.${fracStr}`
  }

  const fmtDisplayAmount = (amount: number): string => {
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: amount > 0 && amount < 1 ? 2 : 0,
      maximumFractionDigits: 2
    })
  }

  const fmtTierVolume = (min: number, max: number | null): string => {
    const f = (n: number) => n.toLocaleString('en-US')
    if (max === null) return `${f(min)}+ LUNES`
    return `${f(min)} - ${f(max)} LUNES`
  }

  const getInitials = (name: string): string => {
    const parts = name
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    if (parts.length === 0) return 'NA'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return parts
      .slice(0, 2)
      .map(p => p[0])
      .join('')
      .toUpperCase()
  }

  const shortenAddress = (addr: string): string => {
    if (!addr || addr.length < 12) return addr || ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const fmtVolume = (vol: number): string => {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`
    return vol.toFixed(2)
  }

  const currentTier = getCurrentTier()
  const nextTier = getNextTier()

  // ─── Render Leaderboard Row ───

  const renderLeaderRow = (leader: LeaderEntry, index: number) => {
    const rank = leader.rank || index + 1
    const isTop3 = rank <= 3
    const roiPositive = leader.roi30d > 0

    return (
      <LeaderRow key={leader.id}>
        <LeaderRank $top3={isTop3}>
          {isTop3 ? ['#1', '#2', '#3'][rank - 1] : `#${rank}`}
        </LeaderRank>
        <LeaderAvatar $isAI={leader.isAI}>
          {leader.avatar ? (
            <img src={leader.avatar} alt={leader.name} />
          ) : (
            getInitials(leader.name)
          )}
        </LeaderAvatar>
        <LeaderNameBlock>
          <LeaderName>{leader.name}</LeaderName>
          <LeaderMeta>
            <LeaderTag $ai={leader.isAI}>
              {leader.isAI ? 'BOT' : 'HUMAN'}
            </LeaderTag>
            {leader.tags.slice(0, 1).map(tag => (
              <LeaderTag key={tag}>{tag}</LeaderTag>
            ))}
          </LeaderMeta>
        </LeaderNameBlock>
        <div>
          <LeaderStat $positive={roiPositive}>
            {roiPositive ? '+' : ''}
            {leader.roi30d.toFixed(1)}%
          </LeaderStat>
          <LeaderStatLabel>ROI 30d</LeaderStatLabel>
        </div>
        <div>
          <LeaderStat>{leader.winRate.toFixed(0)}%</LeaderStat>
          <LeaderStatLabel>Win Rate</LeaderStatLabel>
        </div>
        <div>
          <LeaderStat>{leader.aum}</LeaderStat>
          <LeaderStatLabel>AUM</LeaderStatLabel>
        </div>
      </LeaderRow>
    )
  }

  return (
    <Page>
      <Container>
        <HeroBanner>
          <PageTitle>
            Trading <span>Rewards</span>
          </PageTitle>
          <PageSubtitle>
            Track both on-chain staking rewards and signed leader/trader
            distributions. Each reward stream now follows its own canonical
            claim path.
          </PageSubtitle>
        </HeroBanner>

        {/* How It Works — always visible */}
        <HowItWorks>
          <StepCard>
            <StepNumber>1</StepNumber>
            <StepTitle>Stake LUNES</StepTitle>
            <StepDesc>
              Stake your LUNES tokens in the staking pool to earn on-chain
              staker rewards and climb tier levels.
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>2</StepNumber>
            <StepTitle>Earn by Role</StepTitle>
            <StepDesc>
              Stakers accrue rewards on-chain, while leaders and traders accrue
              signed DB-backed rewards from the weekly engine.
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>3</StepNumber>
            <StepTitle>Claim by Path</StepTitle>
            <StepDesc>
              Claim staking rewards on-chain and leader/trader rewards through a
              signed wallet action against the rewards API.
            </StepDesc>
          </StepCard>
        </HowItWorks>

        {/* ─── Leaderboard Section ─── */}
        <Card>
          <SectionTitle>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6C38FF"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ verticalAlign: 'middle', marginRight: 8 }}
            >
              <path d="M8 21h8M12 17v4M6 12h12l-3-9H9l-3 9z" />
            </svg>
            Top Copytrade Leaders
          </SectionTitle>

          <LeaderboardTabs>
            <LBTab $active={lbTab === 'all'} onClick={() => setLbTab('all')}>
              All (Sharpe)
            </LBTab>
            <LBTab
              $active={lbTab === 'traders'}
              onClick={() => setLbTab('traders')}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ verticalAlign: 'middle', marginRight: 4 }}
              >
                <circle cx="12" cy="8" r="5" />
                <path d="M20 21a8 8 0 1 0-16 0" />
              </svg>
              Human Traders
            </LBTab>
            <LBTab $active={lbTab === 'bots'} onClick={() => setLbTab('bots')}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ verticalAlign: 'middle', marginRight: 4 }}
              >
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="3" />
                <line x1="12" y1="8" x2="12" y2="11" />
              </svg>
              AI Bots
            </LBTab>
          </LeaderboardTabs>

          {lbLoading ? (
            <LoadingBar />
          ) : leaders.length > 0 ? (
            <>
              <LeaderHeader>
                <HeaderLabel>#</HeaderLabel>
                <HeaderLabel></HeaderLabel>
                <HeaderLabel>Name</HeaderLabel>
                <HeaderLabel>ROI 30d</HeaderLabel>
                <HeaderLabel>Win Rate</HeaderLabel>
                <HeaderLabel>AUM</HeaderLabel>
              </LeaderHeader>
              {leaders.map((leader, i) => renderLeaderRow(leader, i))}
            </>
          ) : (
            <EmptyLB>
              No{' '}
              {lbTab === 'bots'
                ? 'AI bot'
                : lbTab === 'traders'
                  ? 'human trader'
                  : ''}{' '}
              leaders found. Become a leader on the Social Trade page!
            </EmptyLB>
          )}
        </Card>

        {/* ─── Top Spot Traders ─── */}
        <Card>
          <SectionTitle>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00C076"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ verticalAlign: 'middle', marginRight: 8 }}
            >
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
            Top Spot Traders
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: 'rgba(255,255,255,0.3)',
                marginLeft: 8,
                fontFamily: 'Inter'
              }}
            >
              by volume
            </span>
          </SectionTitle>

          {topTradersLoading ? (
            <LoadingBar />
          ) : topTraders.length > 0 ? (
            <>
              <LeaderHeader>
                <HeaderLabel>#</HeaderLabel>
                <HeaderLabel></HeaderLabel>
                <HeaderLabel>Address</HeaderLabel>
                <HeaderLabel>Volume</HeaderLabel>
                <HeaderLabel>Trades</HeaderLabel>
                <HeaderLabel>Share</HeaderLabel>
              </LeaderHeader>
              {topTraders.map((trader, i) => {
                const rank = i + 1
                const isTop3 = rank <= 3
                const totalVolume = topTraders.reduce((s, t) => s + t.volume, 0)
                const share =
                  totalVolume > 0
                    ? ((trader.volume / totalVolume) * 100).toFixed(1)
                    : '0'
                return (
                  <LeaderRow key={trader.address}>
                    <LeaderRank $top3={isTop3}>
                      {isTop3 ? ['#1', '#2', '#3'][rank - 1] : `#${rank}`}
                    </LeaderRank>
                    <LeaderAvatar $isAI={false}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                        <polyline points="16 7 22 7 22 13" />
                      </svg>
                    </LeaderAvatar>
                    <LeaderNameBlock>
                      <LeaderName>{shortenAddress(trader.address)}</LeaderName>
                      <LeaderMeta>
                        <LeaderTag>SPOT</LeaderTag>
                      </LeaderMeta>
                    </LeaderNameBlock>
                    <div>
                      <LeaderStat $positive>
                        {fmtVolume(trader.volume)}
                      </LeaderStat>
                      <LeaderStatLabel>LUNES</LeaderStatLabel>
                    </div>
                    <div>
                      <LeaderStat>{trader.tradeCount}</LeaderStat>
                      <LeaderStatLabel>trades</LeaderStatLabel>
                    </div>
                    <div>
                      <LeaderStat>{share}%</LeaderStat>
                      <LeaderStatLabel>share</LeaderStatLabel>
                    </div>
                  </LeaderRow>
                )
              })}
            </>
          ) : (
            <EmptyLB>
              No trading activity found yet. Start trading to earn volume
              rewards!
            </EmptyLB>
          )}
        </Card>

        {/* ─── Staking Section ─── */}
        <SectionDivider />

        {!sdk.isConnected ? (
          <ConnectPrompt>
            <p>
              Connect your wallet to view your staking rewards and claim
              earnings.
            </p>
            <ConnectButton onClick={() => sdk.connectWallet()}>
              Connect Wallet
            </ConnectButton>
          </ConnectPrompt>
        ) : isLoading ? (
          <ConnectPrompt>
            <p>Loading staking and trading reward data...</p>
            <LoadingBar />
          </ConnectPrompt>
        ) : rewardsData ? (
          <>
            <HeaderRow>
              <SectionTitle style={{ margin: 0 }}>Your Dashboard</SectionTitle>
              <TierBadgeHeader $color={currentTier.color}>
                <TierIcon tier={currentTier.name} size={16} />
                {currentTier.name} Tier
              </TierBadgeHeader>
            </HeaderRow>

            <StatsGrid>
              <StatCard>
                <StatLabel>Your Staked</StatLabel>
                <StatValue>{fmtBalance(rewardsData.userStaked)}</StatValue>
                <StatSub>LUNES</StatSub>
              </StatCard>
              <StatCard>
                <StatLabel>Staking Rewards</StatLabel>
                <StatValue $color="#6C38FF">
                  {fmtBalance(rewardsData.stakingPendingRewards)}
                </StatValue>
                <StatSub>on-chain claim</StatSub>
              </StatCard>
              <StatCard>
                <StatLabel>Trading Rewards</StatLabel>
                <StatValue $color="#00C076">
                  {fmtDisplayAmount(rewardsData.tradingPendingRewards)}
                </StatValue>
                <StatSub>signed API claim</StatSub>
              </StatCard>
              <StatCard>
                <StatLabel>APR</StatLabel>
                <StatValue $color="#00C076">{rewardsData.apr}%</StatValue>
                <StatSub>{currentTier.rewardMultiplier}x multiplier</StatSub>
              </StatCard>
              <StatCard>
                <StatLabel>Lock Period</StatLabel>
                <StatValue>{rewardsData.lockPeriod}</StatValue>
                <StatSub>days</StatSub>
              </StatCard>
            </StatsGrid>

            {/* Claim Rewards */}
            <Card>
              <SectionTitle>Claim Rewards</SectionTitle>
              <ClaimGrid>
                <ClaimCard>
                  <ClaimCardTitle>Staking Rewards</ClaimCardTitle>
                  <RewardAmount $color="#6C38FF">
                    {fmtBalance(rewardsData.stakingPendingRewards)} LUNES
                  </RewardAmount>
                  <RewardSub>
                    Claimed directly on-chain. Pool total:{' '}
                    {fmtBalance(rewardsData.totalStaked)} LUNES staked.
                  </RewardSub>
                  <ClaimButton
                    $disabled={
                      isStakingClaiming ||
                      rewardsData.stakingPendingRewards === '0'
                    }
                    onClick={handleClaimStakingRewards}
                  >
                    {isStakingClaiming
                      ? 'Claiming Staking Rewards...'
                      : rewardsData.stakingPendingRewards === '0'
                        ? 'No Staking Rewards'
                        : 'Claim Staking Rewards'}
                  </ClaimButton>
                </ClaimCard>

                <ClaimCard>
                  <ClaimCardTitle>Leader / Trader Rewards</ClaimCardTitle>
                  <RewardAmount $color="#00C076">
                    {fmtDisplayAmount(rewardsData.tradingPendingRewards)} LUNES
                  </RewardAmount>
                  <RewardSub>
                    Signed wallet claim for weekly DB-backed trading rewards.{' '}
                    {rewardsData.tradingRewardEntries} entries pending.
                  </RewardSub>
                  <ClaimBreakdown>
                    <ClaimBreakdownItem>
                      <ClaimBreakdownLabel>Leader</ClaimBreakdownLabel>
                      <ClaimBreakdownValue>
                        {fmtDisplayAmount(rewardsData.leaderPendingRewards)}{' '}
                        LUNES
                      </ClaimBreakdownValue>
                    </ClaimBreakdownItem>
                    <ClaimBreakdownItem>
                      <ClaimBreakdownLabel>Trader</ClaimBreakdownLabel>
                      <ClaimBreakdownValue>
                        {fmtDisplayAmount(rewardsData.traderPendingRewards)}{' '}
                        LUNES
                      </ClaimBreakdownValue>
                    </ClaimBreakdownItem>
                  </ClaimBreakdown>
                  <ClaimButton
                    $disabled={
                      isTradingClaiming ||
                      rewardsData.tradingPendingRewards <= 0
                    }
                    onClick={handleClaimTradingRewards}
                  >
                    {isTradingClaiming
                      ? 'Claiming Trading Rewards...'
                      : rewardsData.tradingPendingRewards <= 0
                        ? 'No Trading Rewards'
                        : 'Claim Leader / Trader Rewards'}
                  </ClaimButton>
                </ClaimCard>
              </ClaimGrid>

              {nextTier && (
                <ProgressSection>
                  <ProgressMeta>
                    <span>Progress to {nextTier.name}</span>
                    <span>{rewardsData.nextTierProgress}%</span>
                  </ProgressMeta>
                  <ProgressBar>
                    <ProgressFill
                      $progress={rewardsData.nextTierProgress}
                      $color={nextTier.color}
                    />
                  </ProgressBar>
                </ProgressSection>
              )}
            </Card>

            {/* Tiers */}
            <Card>
              <SectionTitle>Staking Tiers</SectionTitle>
              {TIERS.map(tier => {
                const isActive = tier.name === rewardsData.tier
                return (
                  <TierRow
                    key={tier.name}
                    $active={isActive}
                    $color={tier.color}
                  >
                    <TierIconWrap $color={tier.color}>
                      <TierIcon tier={tier.name} size={18} />
                    </TierIconWrap>
                    <TierInfo2>
                      <TierName $color={tier.color}>{tier.name}</TierName>
                      <TierVolume>
                        {fmtTierVolume(tier.minVolume, tier.maxVolume)}
                      </TierVolume>
                    </TierInfo2>
                    <div style={{ textAlign: 'center' }}>
                      {isActive ? (
                        <ActiveBadge>CURRENT</ActiveBadge>
                      ) : (
                        <TierVolume>{tier.desc}</TierVolume>
                      )}
                    </div>
                    <TierMultiplier $active={isActive} $color={tier.color}>
                      {tier.rewardMultiplier}x
                    </TierMultiplier>
                  </TierRow>
                )
              })}
            </Card>
          </>
        ) : (
          <>
            <Card>
              <SectionTitle>Staking Tiers</SectionTitle>
              {TIERS.map(tier => (
                <TierRow key={tier.name} $active={false} $color={tier.color}>
                  <TierIconWrap $color={tier.color}>
                    <TierIcon tier={tier.name} size={18} />
                  </TierIconWrap>
                  <TierInfo2>
                    <TierName $color={tier.color}>{tier.name}</TierName>
                    <TierVolume>
                      {fmtTierVolume(tier.minVolume, tier.maxVolume)}
                    </TierVolume>
                  </TierInfo2>
                  <div style={{ textAlign: 'center' }}>
                    <TierVolume>{tier.desc}</TierVolume>
                  </div>
                  <TierMultiplier $active={false} $color={tier.color}>
                    {tier.rewardMultiplier}x
                  </TierMultiplier>
                </TierRow>
              ))}
            </Card>
            <ConnectPrompt>
              <p>
                No reward data available yet — stake LUNES or earn trading
                rewards to populate this dashboard.
              </p>
            </ConnectPrompt>
          </>
        )}
      </Container>
    </Page>
  )
}

export default Rewards
