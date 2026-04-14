import React, { useState, useEffect, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'

const SPOT_API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

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
interface AffiliatePayoutRow {
  id: string
  level: number
  token: string
  amount: number
  sourceType: string
  paidAt: string
  batchId: string | null
}

// ─── Animations ───

const fadeIn = keyframes`from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); }`
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:.6}`

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
  margin-bottom: 40px;
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
  margin: 0;
  max-width: 520px;
  margin: 0 auto;
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

// ─── Tabs ───

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 14px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 24px;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 11px 16px;
  border: none;
  border-radius: 10px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: ${p => (p.$active ? '700' : '500')};
  cursor: pointer;
  transition: all 0.2s;
  background: ${p => (p.$active ? 'rgba(108,56,255,0.15)' : 'transparent')};
  color: ${p => (p.$active ? '#9B6FFF' : 'rgba(255,255,255,0.5)')};
  &:hover {
    background: ${p =>
      p.$active ? 'rgba(108,56,255,0.15)' : 'rgba(255,255,255,0.04)'};
    color: ${p => (p.$active ? '#9B6FFF' : '#fff')};
  }
`

// ─── Cards ───

const Card = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 16px;
`

// ─── Share / Referral Link ───

const ShareCard = styled(Card)`
  text-align: center;
  padding: 28px 24px;
`

const ReferralCodeLabel = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
`

const ReferralCode = styled.div`
  color: #6c38ff;
  font-size: 32px;
  font-weight: 800;
  font-family: 'Space Grotesk', monospace;
  letter-spacing: 6px;
  margin-bottom: 16px;
`

const LinkBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 16px;
`

const LinkText = styled.span`
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
`

const CopyBtn = styled.button<{ $copied?: boolean }>`
  background: ${p =>
    p.$copied ? 'rgba(0,192,118,0.15)' : 'rgba(108,56,255,0.15)'};
  border: 1px solid
    ${p => (p.$copied ? 'rgba(0,192,118,0.3)' : 'rgba(108,56,255,0.3)')};
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  color: ${p => (p.$copied ? '#00C076' : '#6C38FF')};
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  &:hover {
    opacity: 0.85;
  }
`

const SocialRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
`

const SocialBtn = styled.a`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.15);
  }
`

// ─── Stats ───

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
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
  font-size: 24px;
  font-weight: 800;
`

// ─── Commission Levels ───

const LevelRow = styled.div<{ $active: boolean }>`
  display: grid;
  grid-template-columns: 40px 1fr 80px 100px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 6px;
  background: ${p => (p.$active ? 'rgba(108,56,255,0.06)' : 'transparent')};
  border: 1px solid
    ${p => (p.$active ? 'rgba(108,56,255,0.15)' : 'rgba(255,255,255,0.04)')};
  transition: all 0.15s;
`

const LevelBadge = styled.div<{ $level: number }>`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  font-family: 'Space Grotesk', sans-serif;
  background: ${({ $level }) => {
    const colors = ['#6C38FF', '#9B6FFF', '#00C076', '#FF9500', '#FF6B6B']
    return `${colors[$level - 1] || colors[0]}18`
  }};
  color: ${({ $level }) => {
    const colors = ['#6C38FF', '#9B6FFF', '#00C076', '#FF9500', '#FF6B6B']
    return colors[$level - 1] || colors[0]
  }};
`

const LevelLabel = styled.div`
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  padding-left: 12px;
`

const LevelSub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  padding-left: 12px;
`

const LevelRate = styled.div`
  color: #6c38ff;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  font-family: 'Space Grotesk', sans-serif;
`

const LevelEarned = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  text-align: right;
  font-family: 'Space Grotesk', sans-serif;
`

// ─── Tree ───

const TreeNodeRow = styled.div<{ $depth: number }>`
  padding: 12px 16px;
  padding-left: ${p => 16 + p.$depth * 24}px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  &:last-child {
    border-bottom: none;
  }
  transition: background 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.02);
  }
`

const TreeAddress = styled.div`
  color: #fff;
  font-size: 13px;
  font-family: monospace;
  font-weight: 500;
`

const TreeMeta = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  font-family: 'Inter', sans-serif;
`

// ─── Payouts ───

const PayoutRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 100px 80px 80px 120px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 13px;
  &:last-child {
    border-bottom: none;
  }
`

const PayoutHeader = styled(PayoutRow)`
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`

// ─── General ───

const SectionTitle = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  margin-bottom: 16px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 32px 16px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  line-height: 1.6;
`

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Inter', sans-serif;
`

const LoadingDot = styled.span`
  animation: ${pulse} 1.2s infinite;
  color: rgba(255, 255, 255, 0.4);
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

// ─── Component ───

type TabType = 'overview' | 'tree' | 'payouts'

const Affiliates: React.FC = () => {
  const sdk = useSDK()
  const [tab, setTab] = useState<TabType>('overview')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [payouts, setPayouts] = useState<AffiliatePayoutRow[]>([])
  const [referralCode, setReferralCode] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const address = sdk.walletAddress || ''

  const signAffiliateRead = useCallback(
    async (action: string, fields?: Record<string, string | number>) => {
      if (!address) {
        throw new Error('Wallet address required')
      }

      const metadata = createSignedActionMetadata()
      const signature = await sdk.signMessage(
        buildWalletActionMessage({
          action,
          address,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields
        })
      )

      return new URLSearchParams({
        address,
        nonce: metadata.nonce,
        timestamp: String(metadata.timestamp),
        signature,
        ...Object.fromEntries(
          Object.entries(fields ?? {}).map(([key, value]) => [
            key,
            String(value)
          ])
        )
      }).toString()
    },
    [address, sdk]
  )

  const fetchDashboard = useCallback(async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const query = await signAffiliateRead('affiliate.dashboard')
      const res = await fetch(`${SPOT_API}/api/v1/affiliate/dashboard?${query}`)
      const data = await res.json()
      if (data.dashboard) {
        setDashboard(data.dashboard)
        if (data.dashboard.referralCode)
          setReferralCode(data.dashboard.referralCode)
      }
    } catch (err) {
      console.error('Failed to fetch affiliate dashboard:', err)
    } finally {
      setIsLoading(false)
    }
  }, [address, signAffiliateRead])

  const fetchTree = useCallback(async () => {
    if (!address) return
    try {
      const query = await signAffiliateRead('affiliate.tree', { depth: 3 })
      const res = await fetch(`${SPOT_API}/api/v1/affiliate/tree?${query}`)
      const data = await res.json()
      setTree(data.tree || [])
    } catch (err) {
      console.error('Failed to fetch referral tree:', err)
    }
  }, [address, signAffiliateRead])

  const fetchPayouts = useCallback(async () => {
    if (!address) return
    try {
      const query = await signAffiliateRead('affiliate.payouts', { limit: 20 })
      const res = await fetch(`${SPOT_API}/api/v1/affiliate/payouts?${query}`)
      const data = await res.json()
      setPayouts(data.payouts || [])
    } catch (err) {
      console.error('Failed to fetch payouts:', err)
    }
  }, [address, signAffiliateRead])

  // Generate referral code client-side (same SHA-256 logic as backend) + try API
  const generateLocalCode = useCallback(async (addr: string) => {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(addr)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      return hashHex.substring(0, 8).toUpperCase()
    } catch {
      return addr.slice(2, 10).toUpperCase()
    }
  }, [])

  useEffect(() => {
    if (!sdk.isConnected || !address) return

    // Generate a local referral code immediately
    generateLocalCode(address).then(code => {
      setReferralCode(prev => prev || code)
    })

    // Try fetching the code from the API (overrides local if available)
    signAffiliateRead('affiliate.code')
      .then(query => fetch(`${SPOT_API}/api/v1/affiliate/code?${query}`))
      .then(r => r.json())
      .then(data => {
        if (data.code) setReferralCode(data.code)
      })
      .catch(() => {})

    fetchDashboard()
    fetchTree()
    fetchPayouts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk.isConnected, address])

  const referralLink = referralCode
    ? `${window.location.origin}/?ref=${referralCode}`
    : ''

  const shareMessage = referralCode
    ? `Trade on Lunex DEX and earn together! Join via my referral link: ${referralLink}`
    : ''

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareMessage
  )}`
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    referralLink
  )}&text=${encodeURIComponent('Join Lunex DEX with my referral!')}`

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const truncAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString()
  const fmtAmt = (n: number) =>
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })

  const levelLabels = [
    'Direct Referral',
    '2nd Level',
    '3rd Level',
    '4th Level',
    '5th Level'
  ]
  const levelDescs = [
    "You earn from your direct referrals' trades",
    "Earn from your referrals' referrals",
    'Third-degree network commissions',
    'Fourth-degree network commissions',
    'Maximum depth commissions'
  ]

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node, i) => (
      <React.Fragment key={`${node.address}-${i}`}>
        <TreeNodeRow $depth={depth}>
          <TreeAddress>{truncAddr(node.address)}</TreeAddress>
          <TreeMeta>
            <span>Joined {fmtDate(node.joinedAt)}</span>
            <span>{node.subReferrals} sub-referrals</span>
            <span
              style={{
                color: node.totalFeeGenerated > 0 ? '#6C38FF' : undefined
              }}
            >
              ${fmtAmt(node.totalFeeGenerated)} generated
            </span>
          </TreeMeta>
        </TreeNodeRow>
        {node.children.length > 0 && renderTreeNodes(node.children, depth + 1)}
      </React.Fragment>
    ))

  return (
    <Page>
      <Container>
        <HeroBanner>
          <PageTitle>
            Affiliate <span>Program</span>
          </PageTitle>
          <PageSubtitle>
            Refer traders and earn commissions on every trade they make — up to
            5 levels deep with rates from 4% down to 0.5%.
          </PageSubtitle>
        </HeroBanner>

        {/* How It Works — always visible */}
        <HowItWorks>
          <StepCard>
            <StepNumber>1</StepNumber>
            <StepTitle>Connect Wallet</StepTitle>
            <StepDesc>
              Connect your wallet to generate your unique referral code and
              tracking link.
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>2</StepNumber>
            <StepTitle>Share Your Link</StepTitle>
            <StepDesc>
              Share your referral link on Twitter, Telegram, or anywhere. When
              someone signs up through your link, they're linked to you.
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>3</StepNumber>
            <StepTitle>Earn Commissions</StepTitle>
            <StepDesc>
              Earn 4% on direct referrals, plus up to 4 additional levels.
              Payouts are processed every 7 days.
            </StepDesc>
          </StepCard>
        </HowItWorks>

        {/* Commission Tiers — always visible */}
        <Card>
          <SectionTitle>Commission Tiers</SectionTitle>
          {(
            dashboard?.levels || [
              { level: 1, ratePct: 4, rateBps: 400 },
              { level: 2, ratePct: 2, rateBps: 200 },
              { level: 3, ratePct: 1.5, rateBps: 150 },
              { level: 4, ratePct: 1, rateBps: 100 },
              { level: 5, ratePct: 0.5, rateBps: 50 }
            ]
          ).map(level => {
            const earned = dashboard
              ? dashboard.earningsByLevel
                  .filter(e => e.level === level.level)
                  .reduce((sum, e) => sum + e.totalEarned, 0)
              : 0
            const trades = dashboard
              ? dashboard.earningsByLevel
                  .filter(e => e.level === level.level)
                  .reduce((sum, e) => sum + e.tradeCount, 0)
              : 0

            return (
              <LevelRow key={level.level} $active={earned > 0}>
                <LevelBadge $level={level.level}>{level.level}</LevelBadge>
                <div>
                  <LevelLabel>{levelLabels[level.level - 1]}</LevelLabel>
                  <LevelSub>{levelDescs[level.level - 1]}</LevelSub>
                </div>
                <LevelRate>{level.ratePct}%</LevelRate>
                <LevelEarned>
                  ${fmtAmt(earned)}
                  {trades > 0 && (
                    <div
                      style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}
                    >
                      {trades} trades
                    </div>
                  )}
                </LevelEarned>
              </LevelRow>
            )
          })}
        </Card>

        {!sdk.isConnected ? (
          <ConnectPrompt>
            <p>
              Connect your wallet to access your affiliate dashboard and
              generate your unique referral link.
            </p>
            <ConnectButton onClick={() => sdk.connectWallet()}>
              Connect Wallet
            </ConnectButton>
          </ConnectPrompt>
        ) : isLoading && !referralCode ? (
          <ConnectPrompt>
            <LoadingDot>Loading affiliate data...</LoadingDot>
          </ConnectPrompt>
        ) : (
          <>
            {/* Referral Link — always visible when connected */}
            {referralCode && (
              <ShareCard>
                <ReferralCodeLabel>Your Referral Code</ReferralCodeLabel>
                <ReferralCode>{referralCode}</ReferralCode>

                <LinkBox>
                  <LinkText>{referralLink}</LinkText>
                  <CopyBtn $copied={copied} onClick={handleCopy}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </CopyBtn>
                </LinkBox>

                <SocialRow>
                  <SocialBtn
                    href={twitterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    Share on Twitter
                  </SocialBtn>
                  <SocialBtn
                    href={telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                    Share on Telegram
                  </SocialBtn>
                </SocialRow>
              </ShareCard>
            )}

            {/* Dashboard data — optional, shown if API responds */}
            {dashboard && (
              <>
                <TabBar>
                  <Tab
                    $active={tab === 'overview'}
                    onClick={() => setTab('overview')}
                  >
                    Overview
                  </Tab>
                  <Tab $active={tab === 'tree'} onClick={() => setTab('tree')}>
                    Referrals
                  </Tab>
                  <Tab
                    $active={tab === 'payouts'}
                    onClick={() => setTab('payouts')}
                  >
                    Payouts
                  </Tab>
                </TabBar>

                {tab === 'overview' && (
                  <>
                    {/* Stats Grid */}
                    <StatsGrid>
                      <StatCard>
                        <StatLabel>Direct Referrals</StatLabel>
                        <StatValue>{dashboard.directReferrals}</StatValue>
                      </StatCard>
                      <StatCard>
                        <StatLabel>Unpaid Earnings</StatLabel>
                        <StatValue $color="#6C38FF">
                          ${fmtAmt(dashboard.totalUnpaid)}
                        </StatValue>
                      </StatCard>
                      <StatCard>
                        <StatLabel>Total Paid</StatLabel>
                        <StatValue>${fmtAmt(dashboard.totalPaid)}</StatValue>
                      </StatCard>
                      <StatCard>
                        <StatLabel>Total Commissions</StatLabel>
                        <StatValue>
                          {dashboard.unpaidCount + dashboard.paidCount}
                        </StatValue>
                      </StatCard>
                    </StatsGrid>
                  </>
                )}

                {tab === 'tree' && (
                  <Card>
                    <SectionTitle>Referral Network</SectionTitle>
                    {tree.length > 0 ? (
                      renderTreeNodes(tree)
                    ) : (
                      <EmptyState>
                        No referrals yet. Share your link to start building your
                        network!
                      </EmptyState>
                    )}
                  </Card>
                )}

                {tab === 'payouts' && (
                  <Card>
                    <SectionTitle>Payout History</SectionTitle>
                    {payouts.length > 0 ? (
                      <>
                        <PayoutHeader>
                          <span>Token</span>
                          <span>Amount</span>
                          <span>Level</span>
                          <span>Source</span>
                          <span>Date</span>
                        </PayoutHeader>
                        {payouts.map(p => (
                          <PayoutRow key={p.id}>
                            <span
                              style={{
                                color: '#fff',
                                fontWeight: 600,
                                fontFamily: 'Space Grotesk'
                              }}
                            >
                              {p.token}
                            </span>
                            <span style={{ color: '#6C38FF', fontWeight: 600 }}>
                              ${fmtAmt(p.amount)}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                              L{p.level}
                            </span>
                            <span
                              style={{
                                color: 'rgba(255,255,255,0.4)',
                                fontSize: 11
                              }}
                            >
                              {p.sourceType}
                            </span>
                            <span
                              style={{
                                color: 'rgba(255,255,255,0.4)',
                                fontSize: 12
                              }}
                            >
                              {fmtDate(p.paidAt)}
                            </span>
                          </PayoutRow>
                        ))}
                      </>
                    ) : (
                      <EmptyState>
                        Payouts are processed every 7 days automatically.
                        {dashboard.totalUnpaid > 0 && (
                          <>
                            <br />
                            You have{' '}
                            <strong style={{ color: '#6C38FF' }}>
                              ${fmtAmt(dashboard.totalUnpaid)}
                            </strong>{' '}
                            pending.
                          </>
                        )}
                      </EmptyState>
                    )}
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* No dashboard but also no referral code — true offline state */}
        {sdk.isConnected && !referralCode && !isLoading && (
          <ConnectPrompt>
            Unable to generate referral code — make sure the spot-api is
            running.
          </ConnectPrompt>
        )}
      </Container>
    </Page>
  )
}

export default Affiliates
