import React, { useState, useEffect } from 'react'
import styled from 'styled-components'
import * as B from '../../components/bases'
import { useSDK } from '../../context/SDKContext'

// Tier types matching the contract
type TradingTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

interface TierInfo {
  name: TradingTier
  minVolume: number
  maxVolume: number | null
  rewardMultiplier: number
  color: string
  icon: string
}

interface UserRewardsData {
  tier: TradingTier
  totalVolume: string
  monthlyVolume: string
  dailyVolume: string
  pendingRewards: string
  claimedRewards: string
  tradeCount: number
  nextTierProgress: number
}

// Tier configuration
const TIERS: TierInfo[] = [
  { name: 'Bronze', minVolume: 0, maxVolume: 10000, rewardMultiplier: 1, color: '#CD7F32', icon: '🥉' },
  { name: 'Silver', minVolume: 10000, maxVolume: 50000, rewardMultiplier: 1.5, color: '#C0C0C0', icon: '🥈' },
  { name: 'Gold', minVolume: 50000, maxVolume: 200000, rewardMultiplier: 2, color: '#FFD700', icon: '🥇' },
  { name: 'Platinum', minVolume: 200000, maxVolume: null, rewardMultiplier: 3, color: '#E5E4E2', icon: '💎' }
]



const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding: 80px 24px 48px;
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #00ff88, #00d4ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const PageSubtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8A8A8E;
  margin: 0;
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`

const Title = styled.h2`
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  margin: 0;
`

const TierBadge = styled.div<{ $tierColor: string }>`
  background: ${props => props.$tierColor}15;
  border: 1px solid ${props => props.$tierColor};
  border-radius: 20px;
  padding: 8px 16px;
  color: ${props => props.$tierColor};
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
`

const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.05);
`

const StatLabel = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  margin-bottom: 12px;
`

const StatValue = styled.div`
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
`

const StatSubValue = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  margin-top: 8px;
`

const RewardsSection = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 32px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-top: 24px;
`

const RewardsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`

const RewardsTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 500;
`

const MultiplierBadge = styled.div`
  color: #00ff88;
  font-size: 14px;
  font-weight: 600;
`

const PendingAmount = styled.div`
  color: #00ff88;
  font-size: 36px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 8px;
`

const ClaimedInfo = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  text-align: center;
  margin-bottom: 20px;
`

const ProgressSection = styled.div`
  margin-top: 24px;
`

const ProgressHeader = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
`

const ProgressLabel = styled.span`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
`

const ProgressBar = styled.div`
  background: #1a1a2e;
  border-radius: 10px;
  height: 10px;
  overflow: hidden;
`

const ProgressFill = styled.div<{ $progress: number }>`
  background: linear-gradient(90deg, #FFD700, #FFA500);
  height: 100%;
  width: ${props => Math.min(props.$progress, 100)}%;
  border-radius: 10px;
  transition: width 0.5s ease;
`

const TiersSection = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 32px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-top: 24px;
`

const TiersTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 20px;
  text-align: center;
`

const TiersList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const TierItem = styled.div<{ $active: boolean; $tierColor: string }>`
  display: grid;
  grid-template-columns: 100px 1fr 60px;
  align-items: center;
  padding: 16px 20px;
  border-radius: 12px;
  background: ${props => props.$active ? `${props.$tierColor}10` : 'rgba(255, 255, 255, 0.02)'};
  border: 1px solid ${props => props.$active ? props.$tierColor : 'rgba(255, 255, 255, 0.05)'};
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    border-color: ${props => props.$active ? props.$tierColor : 'rgba(255, 255, 255, 0.1)'};
  }
`

const TierName = styled.div<{ $tierColor: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${props => props.$tierColor};
  font-weight: 600;
  font-size: 14px;
`

const TierVolume = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  text-align: center;
`

const TierMultiplier = styled.div<{ $color: string }>`
  color: ${props => props.$color};
  font-weight: 700;
  font-size: 16px;
  text-align: right;
`

const InfoSection = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 12px;
  padding: 24px;
`

const InfoTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  text-align: center;
`

const InfoList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  text-align: center;
  line-height: 1.6;
`

const InfoItem = styled.div``

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`



export const Rewards: React.FC = () => {
  const sdk = useSDK()
  const [isLoading, setIsLoading] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [rewardsData, setRewardsData] = useState<UserRewardsData | null>(null)

  // Load rewards data from on-chain Staking contract
  useEffect(() => {
    const loadRewardsData = async () => {
      if (!sdk.isConnected || !sdk.walletAddress) return

      setIsLoading(true)
      try {
        const stakingInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
        if (!stakingInfo) {
          setRewardsData(null)
          return
        }

        // Determine tier from staked volume
        const userStakedNum = parseFloat(stakingInfo.userStaked) / 1e8
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
              (nextTier.minVolume - TIERS[currentTierIndex].minVolume)) * 100
          )
        }

        setRewardsData({
          tier,
          totalVolume: stakingInfo.totalStaked,
          monthlyVolume: stakingInfo.userStaked,
          dailyVolume: '0',
          pendingRewards: stakingInfo.pendingRewards,
          claimedRewards: '0',
          tradeCount: 0,
          nextTierProgress: Math.min(nextTierProgress, 100),
        })
      } catch (error) {
        console.error('Error loading rewards data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadRewardsData()
  }, [sdk.isConnected, sdk.walletAddress])

  // Get current tier info
  const getCurrentTierInfo = (): TierInfo => {
    if (!rewardsData) return TIERS[0]
    return TIERS.find(t => t.name === rewardsData.tier) || TIERS[0]
  }

  // Get next tier info
  const getNextTierInfo = (): TierInfo | null => {
    const currentIndex = TIERS.findIndex(t => t.name === rewardsData?.tier)
    if (currentIndex === -1 || currentIndex === TIERS.length - 1) return null
    return TIERS[currentIndex + 1]
  }

  // Format balance with thousand separators
  const formatBalance = (balance: string, decimals: number = 8): string => {
    const value = BigInt(balance)
    const divisor = BigInt(10 ** decimals)
    const integerPart = value / divisor

    return integerPart.toLocaleString('en-US').replace(/,/g, '.')
  }

  // Handle claim rewards — on-chain transaction via Staking contract
  const handleClaimRewards = async () => {
    if (!rewardsData || rewardsData.pendingRewards === '0' || !sdk.walletAddress) return

    setIsClaiming(true)
    try {
      const success = await sdk.claimRewards()
      if (success) {
        // Reload data from chain after successful claim
        const stakingInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
        if (stakingInfo) {
          setRewardsData(prev =>
            prev ? { ...prev, pendingRewards: stakingInfo.pendingRewards } : null
          )
        }
        alert('Rewards claimed successfully!')
      }
    } catch (error) {
      console.error('Error claiming rewards:', error)
      alert('Error claiming rewards. Please try again.')
    } finally {
      setIsClaiming(false)
    }
  }



  const currentTier = getCurrentTierInfo()
  const nextTier = getNextTierInfo()

  // Format volume for tiers display
  const formatTierVolume = (min: number, max: number | null): string => {
    const formatNum = (n: number) => n.toLocaleString('en-US').replace(/,/g, '.')
    if (max === null) {
      return `${formatNum(min)}+ LUNES/month`
    }
    return `${formatNum(min)} - ${formatNum(max)} LUNES/month`
  }

  return (
    <Page>
      <Container>
        <HeroBanner>
          <PageTitle>Trading <span>Rewards</span></PageTitle>
          <PageSubtitle>Earn rewards based on your trading volume. The more you trade, the higher your tier.</PageSubtitle>
        </HeroBanner>
        <Header>
          <Title>Your Rewards Dashboard</Title>
          {rewardsData && (
            <TierBadge $tierColor={currentTier.color}>
              {currentTier.icon} {currentTier.name}
            </TierBadge>
          )}
        </Header>

        {!sdk.isConnected ? (
          <ConnectPrompt>
            <p>Connect your wallet to view your trading rewards</p>
            <B.Button onClick={sdk.connectWallet} margin="16px auto 0" width="auto" padding="14px 32px">Connect Wallet</B.Button>
          </ConnectPrompt>
        ) : isLoading ? (
          <ConnectPrompt>Loading rewards data...</ConnectPrompt>
        ) : rewardsData ? (
          <>
            {/* Stats Grid */}
            <StatsGrid>
              <StatCard>
                <StatLabel>Your Staked</StatLabel>
                <StatValue>{formatBalance(rewardsData.monthlyVolume)} LUNES</StatValue>
                <StatSubValue>Pool total: {formatBalance(rewardsData.totalVolume)} LUNES</StatSubValue>
              </StatCard>
              <StatCard>
                <StatLabel>Tier</StatLabel>
                <StatValue style={{ color: currentTier.color }}>{currentTier.icon} {currentTier.name}</StatValue>
                <StatSubValue>{currentTier.rewardMultiplier}x reward multiplier</StatSubValue>
              </StatCard>
            </StatsGrid>

            {/* Pending Rewards */}
            <RewardsSection>
              <RewardsHeader>
                <RewardsTitle>Pending Rewards</RewardsTitle>
                <MultiplierBadge>{currentTier.rewardMultiplier}x multiplier</MultiplierBadge>
              </RewardsHeader>
              <PendingAmount>{formatBalance(rewardsData.pendingRewards)} LUNES</PendingAmount>
              <B.Button onClick={handleClaimRewards} disabled={isClaiming || rewardsData.pendingRewards === '0'} width="100%" padding="18px" style={{ borderRadius: '30px' }}>
                {isClaiming ? 'Claiming...' : 'Claim Rewards'}
              </B.Button>

              {/* Progress to next tier */}
              {nextTier && (
                <ProgressSection>
                  <ProgressHeader>
                    <ProgressLabel>Progress to {nextTier.name}</ProgressLabel>
                    <ProgressLabel>{rewardsData.nextTierProgress}%</ProgressLabel>
                  </ProgressHeader>
                  <ProgressBar>
                    <ProgressFill $progress={rewardsData.nextTierProgress} />
                  </ProgressBar>
                </ProgressSection>
              )}
            </RewardsSection>

            {/* Tiers Overview */}
            <TiersSection>
              <TiersTitle>Trading Tiers</TiersTitle>
              <TiersList>
                {TIERS.map(tier => (
                  <TierItem key={tier.name} $active={tier.name === rewardsData.tier} $tierColor={tier.color}>
                    <TierName $tierColor={tier.color}>
                      {tier.icon} {tier.name}
                    </TierName>
                    <TierVolume>{formatTierVolume(tier.minVolume, tier.maxVolume)}</TierVolume>
                    <TierMultiplier $color={tier.name === rewardsData.tier ? '#00ff88' : tier.color}>
                      {tier.rewardMultiplier}x
                    </TierMultiplier>
                  </TierItem>
                ))}
              </TiersList>
            </TiersSection>

            {/* How it works */}
            <InfoSection>
              <InfoTitle>How it works</InfoTitle>
              <InfoList>
                <InfoItem>Earn rewards for every trade you make on Lunex</InfoItem>
                <InfoItem>Your tier is based on your monthly trading volume</InfoItem>
                <InfoItem>Higher tiers earn bigger reward multipliers</InfoItem>
                <InfoItem>Rewards are distributed every block</InfoItem>
                <InfoItem>Claim your rewards anytime - no minimum!</InfoItem>
              </InfoList>
            </InfoSection>
          </>
        ) : (
          <ConnectPrompt>No rewards data available</ConnectPrompt>
        )}
      </Container>
    </Page>
  )
}

export default Rewards
