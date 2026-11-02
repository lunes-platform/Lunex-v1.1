import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import { AnimatedNumber } from '../../components/ui/AnimatedNumber'
import {
  Badge,
  Button,
  C,
  Card,
  Col,
  Empty,
  H1,
  H2,
  Muted,
  Page,
  Row,
  SkeletonLine,
  Sub,
  TabPanel,
  Tabs,
  grotesk,
  short,
  tabular
} from '../../components/ui/kit'
import rewardsApi, {
  RewardLeaderRankingEntry,
  RewardTraderRankingEntry
} from '../../services/rewardsService'
import { requestWalletConnect } from 'pages/header/modals/wallets'
import { useReadSession } from '../../hooks/useReadSession'

// ─── Tiers ───────────────────────────────────────────────────────
// Display mirror of the tier ladder (thresholds in staked LUNES). The
// multiplier itself is applied by the staking / rewards contracts.

type TierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

const TIERS: {
  name: TierName
  min: number
  max: number | null
  mult: number
}[] = [
  { name: 'Bronze', min: 0, max: 10_000, mult: 1 },
  { name: 'Silver', min: 10_000, max: 50_000, mult: 1.5 },
  { name: 'Gold', min: 50_000, max: 200_000, mult: 2 },
  { name: 'Platinum', min: 200_000, max: null, mult: 3 }
]

const DECIMALS = 8

const fmt = (n: number, max = 2) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: max
  })

const fmtK = (n: number) =>
  n >= 1_000_000
    ? `${fmt(n / 1_000_000, 2)}M`
    : n >= 1_000
      ? `${fmt(n / 1_000, 1)}K`
      : fmt(n)

const rawToNumber = (raw: string | undefined | null) => {
  if (!raw) return 0
  try {
    const v = BigInt(raw)
    const d = BigInt(10 ** DECIMALS)
    return Number(v / d) + Number(v % d) / 10 ** DECIMALS
  } catch {
    return Number(raw) / 10 ** DECIMALS || 0
  }
}

type RewardsData = {
  staked: number
  stakingPending: number
  stakingPendingRaw: string
  tradingPending: number
  leaderPending: number
  traderPending: number
}

type LbTab = 'traders' | 'leaders'

// ─── Styles ──────────────────────────────────────────────────────

const Split = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

const TierCard = styled(Card)`
  flex: 1.4 1 360px;
  gap: 14px;
`

const ClaimCol = styled.div`
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const TierTitle = styled.span`
  ${grotesk};
  font-size: 26px;
  font-weight: 600;
  white-space: nowrap;
  @media (max-width: 759px) {
    font-size: 22px;
  }
`

const Progress = styled.div`
  height: 8px;
  border-radius: 999px;
  background: ${C.bg};
  overflow: hidden;
  > div {
    height: 100%;
    background: ${C.primary};
    border-radius: 999px;
    transition: width 600ms cubic-bezier(0, 0, 0.2, 1);
  }
`

const TierGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  @media (max-width: 479px) {
    grid-template-columns: repeat(2, 1fr);
  }
`

const TierCell = styled.div<{ $active: boolean }>`
  padding: 10px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$active ? C.primary : C.border)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.12)' : 'transparent')};
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  b {
    ${grotesk};
    font-weight: 600;
    font-size: 14px;
  }
  span {
    font-size: 12px;
    font-weight: 600;
    color: ${C.primaryText};
  }
  small {
    font-size: 11px;
    color: ${C.muted};
    ${tabular};
  }
`

const ClaimCard = styled(Card)`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px;
`

const ClaimValue = styled.span`
  ${grotesk};
  ${tabular};
  font-size: 22px;
  font-weight: 600;
  color: ${C.success};
`

const ListBox = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
`

const LbRow = styled.div<{ $me?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  font-size: 14px;
  background: ${p => (p.$me ? 'rgba(108,56,255,0.1)' : 'transparent')};
  & + & {
    border-top: 1px solid ${C.border};
  }
  @media (max-width: 759px) {
    gap: 10px;
    padding: 12px;
  }
`

const Rank = styled.span<{ $top: boolean }>`
  ${grotesk};
  font-weight: 700;
  width: 24px;
  flex-shrink: 0;
  color: ${p => (p.$top ? C.primaryText : C.muted)};
`

const Who = styled.span`
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Metric = styled.span<{ $color?: string; $w?: number }>`
  font-size: 13px;
  font-weight: 600;
  color: ${p => p.$color ?? C.secondary};
  min-width: ${p => p.$w ?? 80}px;
  text-align: right;
  white-space: nowrap;
  ${tabular};
  @media (max-width: 759px) {
    min-width: 0;
  }
`

const HideMobile = styled.span`
  display: contents;
  @media (max-width: 479px) {
    display: none;
  }
`

// ─── Component ───────────────────────────────────────────────────

export const Rewards: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RewardsData | null>(null)

  const [lbTab, setLbTab] = useState<LbTab>('traders')
  const [leaders, setLeaders] = useState<RewardLeaderRankingEntry[]>([])
  const [traders, setTraders] = useState<RewardTraderRankingEntry[]>([])
  const [lbLoading, setLbLoading] = useState(true)

  const address = sdk.walletAddress
  const connected = sdk.isConnected && !!address
  // Trading rewards are a private read served by the one-signature session.
  const session = useReadSession()

  const loadRewards = useCallback(async () => {
    const s = sdkRef.current
    if (!s.isConnected || !s.walletAddress) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const [stakingRes, tradingRes] = await Promise.allSettled([
        s.getStakingUserInfo(s.walletAddress),
        rewardsApi.getPendingRewards(s.walletAddress)
      ])
      const staking =
        stakingRes.status === 'fulfilled' ? stakingRes.value : null
      const trading =
        tradingRes.status === 'fulfilled' ? tradingRes.value : null
      setData({
        staked: rawToNumber(staking?.userStaked),
        stakingPending: rawToNumber(staking?.pendingRewards),
        stakingPendingRaw: staking?.pendingRewards || '0',
        tradingPending: trading?.total || 0,
        leaderPending: trading?.leaderRewards || 0,
        traderPending: trading?.traderRewards || 0
      })
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRewards()
  }, [loadRewards, sdk.isConnected, address, session.hasSession])

  useEffect(() => {
    let alive = true
    setLbLoading(true)
    rewardsApi
      .getRankings({ limit: 10, segment: 'all', week: 'current' })
      .then(r => {
        if (!alive) return
        setLeaders(Array.isArray(r.leaders) ? r.leaders : [])
        setTraders(Array.isArray(r.traders) ? r.traders : [])
      })
      .catch(() => {
        if (!alive) return
        setLeaders([])
        setTraders([])
      })
      .finally(() => alive && setLbLoading(false))
    return () => {
      alive = false
    }
  }, [])

  // ─── Tier (display only) ───
  const staked = data?.staked ?? 0
  const tierIdx = Math.max(
    0,
    TIERS.findIndex(t => staked >= t.min && (t.max === null || staked < t.max))
  )
  const tier = TIERS[tierIdx]
  const next = TIERS[tierIdx + 1]
  const tierPct = next
    ? Math.min(
        100,
        Math.max(0, ((staked - tier.min) / (next.min - tier.min)) * 100)
      )
    : 100
  const tierNext = !connected
    ? 'Connect a wallet to see your tier.'
    : next
      ? `${fmt(next.min - staked)} more LUNES staked to reach ${next.name} (${next.mult}×).`
      : 'Maximum tier reached.'

  // ─── Claims ───
  const claimStaking = () => {
    if (!data || data.stakingPending <= 0) return
    const amount = fmt(data.stakingPending)
    tx.run({
      type: 'staking',
      title: 'Claiming rewards',
      summary: `${amount} LUNES`,
      actTitle: `Claim ${amount} LUNES (staking rewards)`,
      successTitle: 'Rewards claimed',
      errorText: 'The staking reward claim did not complete.',
      steps: [
        {
          label: 'Sign claim in your wallet',
          wallet: true,
          run: () => sdkRef.current.claimStakingRewards()
        },
        { label: 'Waiting for block confirmation' }
      ],
      onSuccess: () => {
        loadRewards()
      }
    })
  }

  const claimTrading = () => {
    if (!data || data.tradingPending <= 0) return
    const amount = fmt(data.tradingPending)
    tx.run({
      type: 'staking',
      title: 'Claiming rewards',
      summary: `${amount} LUNES`,
      actTitle: `Claim ${amount} LUNES (trading rewards)`,
      successTitle: 'Rewards claimed',
      steps: [
        {
          label: 'Sign claim in your wallet',
          wallet: true,
          run: async () => {
            const s = sdkRef.current
            if (!s.walletAddress) throw new Error('Connect your wallet first')
            const res = await rewardsApi.claimTradingRewards(
              s.walletAddress,
              s.signMessage
            )
            if (!res.claimed) {
              throw new Error(res.message || 'No trading rewards to claim')
            }
            return true
          }
        },
        { label: 'Waiting for block confirmation' }
      ],
      onSuccess: () => {
        loadRewards()
      }
    })
  }

  const claimCards = [
    {
      key: 'staking',
      label: 'Staking rewards',
      value: data?.stakingPending ?? 0,
      sub: `Includes your ${tier.mult}× tier boost`,
      onClaim: claimStaking
    },
    {
      key: 'trading',
      label: 'Trading rewards',
      value: data?.tradingPending ?? 0,
      sub: data
        ? `Leader ${fmt(data.leaderPending)} · Trader ${fmt(data.traderPending)}`
        : 'From this week’s volume',
      onClaim: claimTrading,
      needsSession: true
    }
  ]

  // ─── Leaderboard ───
  const me = (address || '').toLowerCase()
  const traderTotal = traders.reduce((s, t) => s + t.volume, 0)

  const renderLeaderboard = () => {
    if (lbLoading) {
      return (
        <ListBox>
          {Array.from({ length: 5 }).map((_, i) => (
            <LbRow key={i}>
              <SkeletonLine $w="24px" />
              <SkeletonLine $w="40%" />
              <SkeletonLine $w="80px" />
            </LbRow>
          ))}
        </ListBox>
      )
    }
    if (lbTab === 'traders') {
      if (!traders.length)
        return (
          <ListBox>
            <Empty>
              No spot volume yet this week. Trade to enter the board.
            </Empty>
          </ListBox>
        )
      return (
        <ListBox>
          {traders.map((t, i) => {
            const rank = t.rank || i + 1
            return (
              <LbRow
                key={t.address}
                $me={!!me && t.address.toLowerCase() === me}
              >
                <Rank $top={rank <= 3}>{rank}</Rank>
                <Who title={t.address}>{short(t.address, 6, 4)}</Who>
                <HideMobile>
                  <Metric $w={70}>{t.tradeCount} trades</Metric>
                </HideMobile>
                <Metric>{fmtK(t.volume)} LUNES</Metric>
                <Metric $color={C.success} $w={60}>
                  {traderTotal > 0
                    ? `${((t.volume / traderTotal) * 100).toFixed(1)}%`
                    : '—'}
                </Metric>
              </LbRow>
            )
          })}
        </ListBox>
      )
    }
    if (!leaders.length)
      return (
        <ListBox>
          <Empty>
            No leaders ranked this week. Become one on Social Trade.
          </Empty>
        </ListBox>
      )
    return (
      <ListBox>
        {leaders.map((l, i) => {
          const rank = l.rank || i + 1
          return (
            <LbRow key={l.id} $me={!!me && l.address?.toLowerCase() === me}>
              <Rank $top={rank <= 3}>{rank}</Rank>
              <Who>
                {l.name}{' '}
                {l.isAI && (
                  <Badge $tone="primary" style={{ height: 20, fontSize: 11 }}>
                    AI
                  </Badge>
                )}
              </Who>
              <HideMobile>
                <Metric $w={70}>{l.aum}</Metric>
              </HideMobile>
              <Metric $color={l.roi30d >= 0 ? C.success : C.criticalText}>
                {l.roi30d >= 0 ? '+' : ''}
                {l.roi30d.toFixed(1)}%
              </Metric>
            </LbRow>
          )
        })}
      </ListBox>
    )
  }

  return (
    <Page $max={1080}>
      <div>
        <H1>Rewards</H1>
        <Sub>
          Your staked LUNES sets your tier, and your tier multiplies the rewards
          you earn from staking and trading.
        </Sub>
      </div>

      <Split>
        <TierCard>
          <Row $justify="space-between" $align="flex-start" $gap={12}>
            <Col $gap={4}>
              <Muted $size={12}>Your tier</Muted>
              {loading ? (
                <SkeletonLine $w="160px" $h={28} />
              ) : (
                <TierTitle>
                  {tier.name} · {tier.mult}×
                </TierTitle>
              )}
            </Col>
            <Col
              $gap={2}
              style={{ alignItems: 'flex-end', textAlign: 'right' }}
            >
              <Muted $size={12}>Staked</Muted>
              <span style={{ fontWeight: 600, fontSize: 14 }} className="num">
                {connected ? (
                  <AnimatedNumber
                    value={staked}
                    format={v => `${fmt(v)} LUNES`}
                  />
                ) : (
                  '—'
                )}
              </span>
            </Col>
          </Row>
          <Progress
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(tierPct)}
            aria-label="Progress to next tier"
          >
            <div style={{ width: `${connected ? tierPct : 0}%` }} />
          </Progress>
          <span style={{ fontSize: 13, color: C.secondary }}>{tierNext}</span>
          <TierGrid>
            {TIERS.map((t, i) => (
              <TierCell key={t.name} $active={connected && i === tierIdx}>
                <b>{t.name}</b>
                <span>{t.mult}×</span>
                <small>
                  {t.max ? `${fmtK(t.min)}–${fmtK(t.max)}` : `${fmtK(t.min)}+`}{' '}
                  LUNES
                </small>
              </TierCell>
            ))}
          </TierGrid>
        </TierCard>

        <ClaimCol>
          {claimCards.map(c => {
            const can = connected && c.value > 0
            return (
              <ClaimCard key={c.key}>
                <Col $gap={2}>
                  <Muted $size={12}>{c.label}</Muted>
                  {loading ? (
                    <SkeletonLine $w="120px" $h={24} />
                  ) : (
                    <ClaimValue>
                      {connected ? (
                        <AnimatedNumber
                          value={c.value}
                          format={v => `${fmt(v)} LUNES`}
                        />
                      ) : (
                        '—'
                      )}
                    </ClaimValue>
                  )}
                  <Muted $size={12}>{c.sub}</Muted>
                </Col>
                {connected && c.needsSession && !session.hasSession ? (
                  <Button
                    variant="secondary"
                    disabled={session.signingIn}
                    onClick={() => void session.signIn()}
                    title="Sign in to view your private data"
                  >
                    Sign in
                  </Button>
                ) : connected ? (
                  <Button
                    variant={can ? 'success' : 'secondary'}
                    disabled={!can}
                    onClick={c.onClaim}
                  >
                    Claim
                  </Button>
                ) : (
                  <Button onClick={() => requestWalletConnect()}>
                    Connect
                  </Button>
                )}
              </ClaimCard>
            )
          })}
        </ClaimCol>
      </Split>

      <Col $gap={10}>
        <Row $justify="space-between" $gap={12} $wrap>
          <H2 style={{ fontSize: 18 }}>Weekly leaderboard</H2>
          <Tabs<LbTab>
            ariaLabel="Leaderboard"
            value={lbTab}
            onChange={setLbTab}
            items={[
              { value: 'traders', label: 'Traders' },
              { value: 'leaders', label: 'Leaders' }
            ]}
          />
        </Row>
        <TabPanel key={lbTab}>{renderLeaderboard()}</TabPanel>
      </Col>
    </Page>
  )
}

export default Rewards
