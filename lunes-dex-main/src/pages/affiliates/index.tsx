import React, { useState, useEffect, useCallback } from 'react'
import styled from 'styled-components'
import * as B from '../../components/bases'
import { useSDK } from '../../context/SDKContext'

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3002'

interface LevelInfo {
  level: number
  ratePct: number
  rateBps: number
}

interface EarningByLevel {
  level: number
  token: string
  totalEarned: number
  tradeCount: number
}

interface DashboardData {
  referralCode: string
  directReferrals: number
  earningsByLevel: EarningByLevel[]
  totalUnpaid: number
  unpaidCount: number
  totalPaid: number
  paidCount: number
  levels: LevelInfo[]
}

interface TreeNode {
  address: string
  joinedAt: string
  level: number
  subReferrals: number
  totalFeeGenerated: number
  children: TreeNode[]
}

// ─── Styled Components ───

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

const TabBar = styled.div`
  display: flex;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 24px;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 12px 16px;
  border: none;
  border-radius: 12px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: ${props => props.$active ? '700' : '500'};
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${props => props.$active ? '#00ff88' : 'transparent'};
  color: ${props => props.$active ? '#1A1A1A' : props.theme.colors.themeColors[100]};

  &:hover {
    background: ${props => props.$active ? '#00ff88' : 'rgba(255,255,255,0.05)'};
    color: ${props => props.$active ? '#1A1A1A' : '#fff'};
  }
`

const Card = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 16px;
`

const ShareSection = styled(Card)`
  text-align: center;
`

const ReferralCode = styled.div`
  color: #00ff88;
  font-size: 28px;
  font-weight: 700;
  font-family: 'Space Grotesk', monospace;
  letter-spacing: 4px;
  margin: 12px 0;
`

const ReferralLink = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 16px 20px;
  color: #aaa;
  font-size: 14px;
  word-break: break-all;
  margin: 16px 0;
`

const CopyButton = styled.button`
  background: #00ff88;
  color: #000;
  border: none;
  border-radius: 30px;
  padding: 14px 32px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  width: 100%;
  margin-top: 8px;
  transition: all 0.2s ease;

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.98); }
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

const StatValue = styled.div<{ $color?: string }>`
  color: ${props => props.$color || '#fff'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
`

const LevelsCard = styled(Card)``

const LevelRow = styled.div<{ $active: boolean }>`
  display: grid;
  grid-template-columns: 50px 1fr 80px 80px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 8px;
  background: ${props => props.$active ? 'rgba(0, 255, 136, 0.08)' : 'transparent'};
  border: 1px solid ${props => props.$active ? '#00ff8833' : '#ffffff10'};
`

const LevelBadge = styled.div<{ $level: number }>`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  background: ${({ $level }) => {
    const colors = ['#00ff88', '#00d4ff', '#ff9500', '#ff6b6b', '#c084fc']
    return `${colors[$level - 1] || colors[0]}20`
  }};
  color: ${({ $level }) => {
    const colors = ['#00ff88', '#00d4ff', '#ff9500', '#ff6b6b', '#c084fc']
    return colors[$level - 1] || colors[0]
  }};
`

const LevelLabel = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  padding-left: 12px;
`

const LevelRate = styled.div`
  color: #00ff88;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
`

const LevelEarned = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  text-align: right;
`

const TreeSection = styled(Card)``

const TreeNodeRow = styled.div<{ $depth: number }>`
  padding-left: ${props => props.$depth * 24}px;
  padding: 12px 16px;
  padding-left: ${props => 16 + props.$depth * 24}px;
  border-bottom: 1px solid #ffffff08;

  &:last-child { border-bottom: none; }
`

const TreeNodeAddress = styled.div`
  color: #fff;
  font-size: 13px;
  font-family: monospace;
`

const TreeNodeMeta = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
`

const SectionTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 32px 16px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
`

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

// ─── Component ───

type TabType = 'overview' | 'tree' | 'payouts'

const Affiliates: React.FC = () => {
  const sdk = useSDK()
  const [tab, setTab] = useState<TabType>('overview')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const address = sdk.walletAddress || ''

  const fetchDashboard = useCallback(async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/affiliate/dashboard?address=${address}`)
      const data = await res.json()
      setDashboard(data.dashboard)
    } catch (err) {
      console.error('Failed to fetch affiliate dashboard:', err)
    } finally {
      setIsLoading(false)
    }
  }, [address])

  const fetchTree = useCallback(async () => {
    if (!address) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/affiliate/tree?address=${address}&depth=3`)
      const data = await res.json()
      setTree(data.tree || [])
    } catch (err) {
      console.error('Failed to fetch referral tree:', err)
    }
  }, [address])

  useEffect(() => {
    if (sdk.isConnected) {
      fetchDashboard()
      fetchTree()
    }
  }, [sdk.isConnected, fetchDashboard, fetchTree])

  const copyLink = () => {
    if (!dashboard) return
    const link = `https://lunex.io/?ref=${dashboard.referralCode}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const truncateAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString()
  const formatAmount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const levelLabels = ['Direct', '2nd Level', '3rd Level', '4th Level', '5th Level']

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node, i) => (
      <React.Fragment key={`${node.address}-${i}`}>
        <TreeNodeRow $depth={depth}>
          <TreeNodeAddress>{truncateAddress(node.address)}</TreeNodeAddress>
          <TreeNodeMeta>
            <span>Joined {formatDate(node.joinedAt)}</span>
            <span>{node.subReferrals} sub-referrals</span>
            <span>${formatAmount(node.totalFeeGenerated)} generated</span>
          </TreeNodeMeta>
        </TreeNodeRow>
        {node.children.length > 0 && renderTreeNodes(node.children, depth + 1)}
      </React.Fragment>
    ))
  }

  return (
    <Page>
      <Container>
        <HeroBanner>
          <PageTitle>Affiliate <span>Program</span></PageTitle>
          <PageSubtitle>Refer traders and earn commissions on every trade they make — up to 5 levels deep.</PageSubtitle>
        </HeroBanner>

        {!sdk.isConnected ? (
          <ConnectPrompt>
            <p>Connect your wallet to access your affiliate dashboard</p>
            <B.Button onClick={sdk.connectWallet} margin="16px auto 0" width="auto" padding="14px 32px">Connect Wallet</B.Button>
          </ConnectPrompt>
        ) : isLoading ? (
          <ConnectPrompt>Loading affiliate data...</ConnectPrompt>
        ) : dashboard ? (
          <>
            <TabBar>
              <Tab $active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Tab>
              <Tab $active={tab === 'tree'} onClick={() => setTab('tree')}>Referrals</Tab>
              <Tab $active={tab === 'payouts'} onClick={() => setTab('payouts')}>Payouts</Tab>
            </TabBar>

            {tab === 'overview' && (
              <>
                {/* Share Link */}
                <ShareSection>
                  <SectionTitle>Your Referral Link</SectionTitle>
                  <ReferralCode>{dashboard.referralCode}</ReferralCode>
                  <ReferralLink>https://lunex.io/?ref={dashboard.referralCode}</ReferralLink>
                  <CopyButton onClick={copyLink}>
                    {copied ? '✓ Copied!' : 'Copy Referral Link'}
                  </CopyButton>
                </ShareSection>

                {/* Stats */}
                <StatsGrid>
                  <StatCard>
                    <StatLabel>Direct Referrals</StatLabel>
                    <StatValue>{dashboard.directReferrals}</StatValue>
                  </StatCard>
                  <StatCard>
                    <StatLabel>Unpaid Earnings</StatLabel>
                    <StatValue $color="#00ff88">${formatAmount(dashboard.totalUnpaid)}</StatValue>
                  </StatCard>
                  <StatCard>
                    <StatLabel>Total Paid</StatLabel>
                    <StatValue>${formatAmount(dashboard.totalPaid)}</StatValue>
                  </StatCard>
                  <StatCard>
                    <StatLabel>Commissions</StatLabel>
                    <StatValue>{dashboard.unpaidCount + dashboard.paidCount}</StatValue>
                  </StatCard>
                </StatsGrid>

                {/* Levels */}
                <LevelsCard>
                  <SectionTitle>Commission Levels</SectionTitle>
                  {dashboard.levels.map((level) => {
                    const earned = dashboard.earningsByLevel
                      .filter(e => e.level === level.level)
                      .reduce((sum, e) => sum + e.totalEarned, 0)

                    return (
                      <LevelRow key={level.level} $active={earned > 0}>
                        <LevelBadge $level={level.level}>{level.level}</LevelBadge>
                        <LevelLabel>{levelLabels[level.level - 1]}</LevelLabel>
                        <LevelRate>{level.ratePct}%</LevelRate>
                        <LevelEarned>${formatAmount(earned)}</LevelEarned>
                      </LevelRow>
                    )
                  })}
                </LevelsCard>
              </>
            )}

            {tab === 'tree' && (
              <TreeSection>
                <SectionTitle>Referral Tree</SectionTitle>
                {tree.length > 0 ? (
                  renderTreeNodes(tree)
                ) : (
                  <EmptyState>No referrals yet. Share your link to start earning!</EmptyState>
                )}
              </TreeSection>
            )}

            {tab === 'payouts' && (
              <Card>
                <SectionTitle>Payout History</SectionTitle>
                <EmptyState>
                  Payouts are processed every 7 days.
                  {dashboard.totalUnpaid > 0 && (
                    <><br />You have <strong style={{ color: '#00ff88' }}>${formatAmount(dashboard.totalUnpaid)}</strong> pending.</>
                  )}
                </EmptyState>
              </Card>
            )}
          </>
        ) : (
          <ConnectPrompt>No affiliate data available</ConnectPrompt>
        )}
      </Container>
    </Page>
  )
}

export default Affiliates
