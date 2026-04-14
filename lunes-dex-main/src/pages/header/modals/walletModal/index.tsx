import React, { useEffect, useState, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSDK } from '../../../../context/SDKContext'
import tokens from '../../../home/modals/chooseToken/mock'

// ──────────────────── Animations ────────────────────

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`

// ──────────────────── Layout ────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.15s ease;
`

const Modal = styled.div`
  background: #111115;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  width: 420px;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ${slideUp} 0.22s ease;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
`

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 0;
  flex-shrink: 0;
`

const AddressRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const AvatarCircle = styled.div`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6c38ff 0%, #00c076 100%);
  flex-shrink: 0;
`

const AddressBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const AddressText = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.2px;
`

const CopyBtn = styled.button`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
  text-align: left;

  &:hover {
    color: #6c38ff;
  }
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const DisconnectBtn = styled.button`
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 75, 85, 0.3);
  background: rgba(255, 75, 85, 0.06);
  color: #ff4b55;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 75, 85, 0.14);
    border-color: rgba(255, 75, 85, 0.6);
  }
`

const CloseBtn = styled.button`
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`

// ──────────────────── Tabs ────────────────────

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 14px 20px 0;
  flex-shrink: 0;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 8px 4px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ $active }) =>
    $active ? 'rgba(108, 56, 255, 0.2)' : 'transparent'};
  color: ${({ $active }) => ($active ? '#ffffff' : 'rgba(255,255,255,0.4)')};
  border: 1px solid
    ${({ $active }) => ($active ? 'rgba(108, 56, 255, 0.4)' : 'transparent')};

  &:hover {
    background: rgba(108, 56, 255, 0.12);
    color: rgba(255, 255, 255, 0.8);
  }
`

// ──────────────────── Content ────────────────────

const ScrollBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 20px;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }
`

const LoadingState = styled.div`
  text-align: center;
  padding: 32px 0;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 28px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  line-height: 1.6;
`

// ──────────────────── Balances Tab ────────────────────

const TokenRow = styled.div<{ $zero?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 10px;
  opacity: ${({ $zero }) => ($zero ? 0.45 : 1)};
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`

const TokenIcon = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
`

const TokenInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const TokenSymbol = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
`

const TokenName = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 1px;
`

const TokenBalance = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
`

// ──────────────────── Section ────────────────────

const Section = styled.div`
  margin-bottom: 16px;
`

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
`

const Card = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 14px 16px;
`

const CardRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;

  &:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
`

const CardLabel = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
`

const CardValue = styled.span<{ $green?: boolean; $yellow?: boolean }>`
  font-size: 13px;
  font-weight: 600;
  color: ${({ $green, $yellow }) =>
    $green ? '#00C076' : $yellow ? '#F7B731' : 'rgba(255,255,255,0.85)'};
`

const ActionBtn = styled.button<{ $variant?: 'green' | 'purple' | 'outline' }>`
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid;

  ${({ $variant }) => {
    if ($variant === 'green')
      return `
      background: rgba(0,192,118,0.12);
      border-color: rgba(0,192,118,0.35);
      color: #00C076;
      &:hover { background: rgba(0,192,118,0.2); }
    `
    if ($variant === 'outline')
      return `
      background: transparent;
      border-color: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.6);
      &:hover { background: rgba(255,255,255,0.05); color: #fff; }
    `
    return `
      background: rgba(108,56,255,0.15);
      border-color: rgba(108,56,255,0.4);
      color: #a78bfa;
      &:hover { background: rgba(108,56,255,0.25); }
    `
  }}
`

const BtnRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 12px;
`

const ReferralCodeBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(108, 56, 255, 0.08);
  border: 1px solid rgba(108, 56, 255, 0.2);
  border-radius: 10px;
  margin-bottom: 12px;
`

const ReferralCode = styled.span`
  flex: 1;
  font-size: 15px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 1.5px;
`

const PoolPair = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
`

const PoolIcons = styled.div`
  display: flex;
  align-items: center;

  img {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid #111115;
  }

  img:last-child {
    margin-left: -8px;
  }
`

const PoolName = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
`

const Badge = styled.span<{ $color?: string }>`
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  background: ${({ $color }) =>
    $color ? `${$color}22` : 'rgba(108,56,255,0.15)'};
  color: ${({ $color }) => $color ?? '#a78bfa'};
  border: 1px solid
    ${({ $color }) => ($color ? `${$color}44` : 'rgba(108,56,255,0.3)')};
`

// ──────────────────── Helpers ────────────────────

const SPOT_API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

function fmt(n: number, dec = 4): string {
  if (n === 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: dec })
}

function truncate(addr: string) {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

// ──────────────────── Types ────────────────────

interface TokenBalanceItem {
  acronym: string
  name: string
  icon: string
  balance: string
  rawBalance: number
}

interface StakingInfo {
  userStaked: string
  pendingRewards: string
  apr: string
  lockPeriod: number
}

interface AffiliateInfo {
  code: string
  totalEarnings: number
  directReferrals: number
  totalVolume: number
}

type TabId = 'balances' | 'staking' | 'pools' | 'affiliates'

// ──────────────────── Component ────────────────────

interface Props {
  onClose: () => void
  onDisconnect: () => void
}

const WalletModal: React.FC<Props> = ({ onClose, onDisconnect }) => {
  const sdk = useSDK()
  const [activeTab, setActiveTab] = useState<TabId>('balances')
  const [copied, setCopied] = useState(false)

  // Balances state
  const [balances, setBalances] = useState<TokenBalanceItem[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)

  // Staking state
  const [staking, setStaking] = useState<StakingInfo | null>(null)
  const [stakingLoading, setStakingLoading] = useState(false)
  const [claimLoading, setClaimLoading] = useState(false)

  // Affiliate state
  const [affiliate, setAffiliate] = useState<AffiliateInfo | null>(null)
  const [affiliateLoading, setAffiliateLoading] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)

  const address = sdk.walletAddress || ''
  const nativeBalance = Number(sdk.balance || 0) / 1e8
  const formattedAddress = address ? truncate(address) : '—'

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // ── Load balances ──
  const loadBalances = useCallback(async () => {
    if (!address) return
    setBalancesLoading(true)
    try {
      const results: TokenBalanceItem[] = []
      for (const token of tokens) {
        if (token.isNative) {
          const num = Number(sdk.balance || 0) / Math.pow(10, token.decimals)
          results.push({
            acronym: token.acronym,
            name: token.token,
            icon: token.icon,
            balance: fmt(num),
            rawBalance: num
          })
        } else if (token.address) {
          try {
            const raw = await sdk.getTokenBalance(token.address, address)
            const num = Number(raw) / Math.pow(10, token.decimals)
            results.push({
              acronym: token.acronym,
              name: token.token,
              icon: token.icon,
              balance: fmt(num),
              rawBalance: num
            })
          } catch {
            results.push({
              acronym: token.acronym,
              name: token.token,
              icon: token.icon,
              balance: '0',
              rawBalance: 0
            })
          }
        }
      }
      results.sort((a, b) => b.rawBalance - a.rawBalance)
      setBalances(results)
    } finally {
      setBalancesLoading(false)
    }
  }, [address, sdk])

  // ── Load staking ──
  const loadStaking = useCallback(async () => {
    if (!address) return
    setStakingLoading(true)
    try {
      const info = await sdk.getStakingUserInfo(address)
      if (info)
        setStaking({
          userStaked: info.userStaked,
          pendingRewards: info.pendingRewards,
          apr: info.apr,
          lockPeriod: info.lockPeriod
        })
    } finally {
      setStakingLoading(false)
    }
  }, [address, sdk])

  // ── Load affiliates ──
  const loadAffiliate = useCallback(async () => {
    if (!address) return
    setAffiliateLoading(true)
    try {
      const [codeRes, dashRes] = await Promise.all([
        fetch(`${SPOT_API}/api/v1/affiliates/code?address=${address}`)
          .then(r => r.json())
          .catch(() => null),
        fetch(`${SPOT_API}/api/v1/affiliates/dashboard?address=${address}`)
          .then(r => r.json())
          .catch(() => null)
      ])
      setAffiliate({
        code: codeRes?.code ?? '—',
        totalEarnings: dashRes?.dashboard?.totalEarnings ?? 0,
        directReferrals: dashRes?.dashboard?.directReferrals ?? 0,
        totalVolume: dashRes?.dashboard?.totalVolume ?? 0
      })
    } finally {
      setAffiliateLoading(false)
    }
  }, [address])

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'balances' && balances.length === 0) loadBalances()
    if (activeTab === 'staking' && !staking) loadStaking()
    if (activeTab === 'affiliates' && !affiliate) loadAffiliate()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaimRewards = async () => {
    setClaimLoading(true)
    try {
      await sdk.claimStakingRewards()
      await loadStaking()
    } finally {
      setClaimLoading(false)
    }
  }

  const copyReferralCode = () => {
    if (affiliate?.code && affiliate.code !== '—') {
      navigator.clipboard.writeText(`https://lunex.io/?ref=${affiliate.code}`)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }
  }

  // ──────────── Render tabs ────────────

  const renderBalances = () => {
    if (balancesLoading) return <LoadingState>Loading balances…</LoadingState>
    if (balances.length === 0)
      return <EmptyState>Connect wallet to view balances</EmptyState>
    return (
      <>
        {balances.map(t => (
          <TokenRow key={t.acronym} $zero={t.rawBalance === 0}>
            <TokenIcon
              src={t.icon}
              alt={t.acronym}
              onError={e => {
                ;(e.target as HTMLImageElement).src = '/img/lunes-green.svg'
              }}
            />
            <TokenInfo>
              <TokenSymbol>{t.acronym}</TokenSymbol>
              <TokenName>{t.name}</TokenName>
            </TokenInfo>
            <TokenBalance>{t.balance}</TokenBalance>
          </TokenRow>
        ))}
      </>
    )
  }

  const renderStaking = () => {
    if (stakingLoading)
      return <LoadingState>Loading staking info…</LoadingState>

    const staked = staking ? Number(staking.userStaked) / 1e8 : 0
    const rewards = staking ? Number(staking.pendingRewards) / 1e8 : 0
    const apr = staking ? parseFloat(staking.apr) : 0
    const hasStake = staked > 0

    return (
      <>
        <Section>
          <SectionTitle>Your Position</SectionTitle>
          <Card>
            <CardRow>
              <CardLabel>Staked</CardLabel>
              <CardValue>{fmt(staked)} LUNES</CardValue>
            </CardRow>
            <CardRow>
              <CardLabel>Pending Rewards</CardLabel>
              <CardValue $green>{fmt(rewards)} LUNES</CardValue>
            </CardRow>
            <CardRow>
              <CardLabel>APR</CardLabel>
              <CardValue $yellow>
                {apr > 0 ? `${apr.toFixed(2)}%` : '—'}
              </CardValue>
            </CardRow>
            {staking && staking.lockPeriod > 0 && (
              <CardRow>
                <CardLabel>Lock Period</CardLabel>
                <CardValue>{staking.lockPeriod}d</CardValue>
              </CardRow>
            )}
          </Card>
          <BtnRow>
            {rewards > 0 && (
              <ActionBtn
                $variant="green"
                onClick={handleClaimRewards}
                disabled={claimLoading}
              >
                {claimLoading ? 'Claiming…' : `Claim ${fmt(rewards)} LUNES`}
              </ActionBtn>
            )}
            <ActionBtn
              $variant="outline"
              onClick={() => {
                onClose()
                window.location.href = '/staking'
              }}
            >
              {hasStake ? 'Manage Stake' : 'Start Staking'}
            </ActionBtn>
          </BtnRow>
        </Section>

        {!hasStake && (
          <Card>
            <CardRow>
              <CardLabel>Available to stake</CardLabel>
              <CardValue>{fmt(nativeBalance)} LUNES</CardValue>
            </CardRow>
            <CardRow>
              <CardLabel>Protocol APR</CardLabel>
              <CardValue $yellow>—</CardValue>
            </CardRow>
          </Card>
        )}
      </>
    )
  }

  const renderPools = () => {
    const activePairs = [
      {
        symbol: 'LUNES/LUSDT',
        base: 'LUNES',
        quote: 'LUSDT',
        baseIcon: '/img/lunes-green.svg',
        quoteIcon: '/img/lusdt.svg'
      },
      {
        symbol: 'LBTC/LUSDT',
        base: 'LBTC',
        quote: 'LUSDT',
        baseIcon: '/img/lbtc.svg',
        quoteIcon: '/img/lusdt.svg'
      },
      {
        symbol: 'LETH/LUSDT',
        base: 'LETH',
        quote: 'LUSDT',
        baseIcon: '/img/leth.svg',
        quoteIcon: '/img/lusdt.svg'
      },
      {
        symbol: 'GMC/LUSDT',
        base: 'GMC',
        quote: 'LUSDT',
        baseIcon: '/img/gmc.svg',
        quoteIcon: '/img/lusdt.svg'
      },
      {
        symbol: 'LUP/LUSDT',
        base: 'LUP',
        quote: 'LUSDT',
        baseIcon: '/img/up.svg',
        quoteIcon: '/img/lusdt.svg'
      }
    ]

    return (
      <>
        <Section>
          <SectionTitle>Active Pairs</SectionTitle>
          {activePairs.map(pair => (
            <Card
              key={pair.symbol}
              style={{ marginBottom: 8, cursor: 'pointer' }}
              onClick={() => {
                onClose()
                window.location.href = '/pools'
              }}
            >
              <PoolPair>
                <PoolIcons>
                  <img
                    src={pair.baseIcon}
                    alt={pair.base}
                    onError={e => {
                      ;(e.target as HTMLImageElement).src =
                        '/img/lunes-green.svg'
                    }}
                  />
                  <img
                    src={pair.quoteIcon}
                    alt={pair.quote}
                    onError={e => {
                      ;(e.target as HTMLImageElement).src = '/img/lusdt.svg'
                    }}
                  />
                </PoolIcons>
                <PoolName>{pair.symbol}</PoolName>
                <Badge $color="#00C076">Active</Badge>
              </PoolPair>
              <CardRow>
                <CardLabel>Your LP tokens</CardLabel>
                <CardValue>—</CardValue>
              </CardRow>
            </Card>
          ))}
        </Section>
        <BtnRow>
          <ActionBtn
            $variant="purple"
            onClick={() => {
              onClose()
              window.location.href = '/pools'
            }}
          >
            Add Liquidity
          </ActionBtn>
        </BtnRow>
      </>
    )
  }

  const renderAffiliates = () => {
    if (affiliateLoading)
      return <LoadingState>Loading affiliate data…</LoadingState>

    const code = affiliate?.code ?? '—'
    const earnings = affiliate?.totalEarnings ?? 0
    const referrals = affiliate?.directReferrals ?? 0
    const volume = affiliate?.totalVolume ?? 0

    return (
      <>
        <Section>
          <SectionTitle>Your Referral Link</SectionTitle>
          <ReferralCodeBox>
            <ReferralCode>{code}</ReferralCode>
            <ActionBtn
              $variant="outline"
              onClick={copyReferralCode}
              style={{ padding: '5px 12px', fontSize: '11px' }}
            >
              {codeCopied ? '✓ Copied' : 'Copy Link'}
            </ActionBtn>
          </ReferralCodeBox>
        </Section>

        <Section>
          <SectionTitle>Earnings</SectionTitle>
          <Card>
            <CardRow>
              <CardLabel>Direct Referrals</CardLabel>
              <CardValue>{referrals}</CardValue>
            </CardRow>
            <CardRow>
              <CardLabel>Total Volume</CardLabel>
              <CardValue>${fmt(volume, 2)}</CardValue>
            </CardRow>
            <CardRow>
              <CardLabel>Total Earned</CardLabel>
              <CardValue $green>${fmt(earnings, 4)}</CardValue>
            </CardRow>
          </Card>
        </Section>

        <BtnRow>
          <ActionBtn
            $variant="purple"
            onClick={() => {
              onClose()
              window.location.href = '/affiliates'
            }}
          >
            Full Dashboard
          </ActionBtn>
        </BtnRow>
      </>
    )
  }

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        {/* Header */}
        <ModalHeader>
          <AddressRow>
            <AvatarCircle />
            <AddressBlock>
              <AddressText>{formattedAddress}</AddressText>
              <CopyBtn onClick={copyAddress}>
                {copied ? '✓ Copied' : 'Copy address'}
              </CopyBtn>
            </AddressBlock>
          </AddressRow>
          <HeaderActions>
            <DisconnectBtn
              onClick={() => {
                onDisconnect()
                onClose()
              }}
            >
              Disconnect
            </DisconnectBtn>
            <CloseBtn onClick={onClose}>✕</CloseBtn>
          </HeaderActions>
        </ModalHeader>

        {/* Tabs */}
        <TabBar>
          <Tab
            $active={activeTab === 'balances'}
            onClick={() => setActiveTab('balances')}
          >
            Balances
          </Tab>
          <Tab
            $active={activeTab === 'staking'}
            onClick={() => setActiveTab('staking')}
          >
            Staking
          </Tab>
          <Tab
            $active={activeTab === 'pools'}
            onClick={() => setActiveTab('pools')}
          >
            Pools
          </Tab>
          <Tab
            $active={activeTab === 'affiliates'}
            onClick={() => setActiveTab('affiliates')}
          >
            Affiliates
          </Tab>
        </TabBar>

        {/* Body */}
        <ScrollBody>
          {activeTab === 'balances' && renderBalances()}
          {activeTab === 'staking' && renderStaking()}
          {activeTab === 'pools' && renderPools()}
          {activeTab === 'affiliates' && renderAffiliates()}
        </ScrollBody>
      </Modal>
    </Overlay>
  )
}

export default WalletModal
