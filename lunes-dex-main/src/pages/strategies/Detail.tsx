import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import strategyService, {
  Strategy,
  StrategyPerformancePoint
} from '../../services/strategyService'
import { useSDK } from '../../context/SDKContext'

// ─── Styled ──────────────────────────────────────────────────────

const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 84px 24px 64px;
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const BackBtn = styled.button`
  background: none;
  border: none;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  &:hover {
    color: #ffffff;
  }
`

const TopGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: flex-start;
  margin-bottom: 28px;
  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`

const Name = styled.h1`
  margin: 0 0 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 34px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.2;
`

const ChipRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
`

const Chip = styled.span<{ color?: string; bg?: string }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ color }) => color ?? '#8A8A8E'};
  background: ${({ bg }) => bg ?? 'rgba(255,255,255,0.06)'};
  border: 1px solid ${({ color }) => (color ? color + '33' : '#2A2A2C')};
`

const Description = styled.p`
  margin: 0;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  max-width: 600px;
`

const ROIPanel = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 20px;
  padding: 24px 28px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
`

const ROILabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8a8a8e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`

const ROIValue = styled.div<{ positive: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 700;
  color: ${({ positive }) => (positive ? '#26D07C' : '#FF4D4D')};
  line-height: 1;
`

const ROISub = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  width: 100%;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  overflow: hidden;
  margin-top: 4px;
`

const ROISubItem = styled.div`
  padding: 8px 10px;
  border-right: 1px solid #2a2a2c;
  text-align: center;
  &:last-child {
    border-right: none;
  }
`

const ROISubValue = styled.div<{ positive?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: ${({ positive }) =>
    positive === undefined ? '#FFFFFF' : positive ? '#26D07C' : '#FF4D4D'};
`

const ROISubLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  color: #8a8a8e;
  margin-top: 2px;
`

const FollowBtn = styled.button<{ following?: boolean }>`
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid ${({ following }) => (following ? '#2A2A2C' : '#7461FF')};
  background: ${({ following }) =>
    following ? 'transparent' : 'rgba(116,97,255,0.12)'};
  color: ${({ following }) => (following ? '#8A8A8E' : '#7461FF')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-top: 8px;
  &:hover:not(:disabled) {
    background: ${({ following }) =>
      following ? 'rgba(255,77,77,0.08)' : 'rgba(116,97,255,0.22)'};
    border-color: ${({ following }) => (following ? '#FF4D4D' : '#7461FF')};
    color: ${({ following }) => (following ? '#FF4D4D' : '#9983FF')};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

const Section = styled.div`
  margin-bottom: 28px;
`

const SectionTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #8a8a8e;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 14px;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
`

const StatCard = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 14px;
  padding: 16px;
`

const StatValue = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 4px;
`

const StatLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #8a8a8e;
`

const ChartWrap = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 18px;
  padding: 20px 20px 8px;
`

const ChartTabRow = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`

const ChartTab = styled.button<{ active?: boolean }>`
  background: ${({ active }) =>
    active ? 'rgba(116,97,255,0.14)' : 'transparent'};
  border: 1px solid ${({ active }) => (active ? '#7461FF' : '#2A2A2C')};
  border-radius: 8px;
  color: ${({ active }) => (active ? '#7461FF' : '#8A8A8E')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover:not([disabled]) {
    border-color: #7461ff;
    color: #9983ff;
  }
`

const AgentCard = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 18px;
  padding: 20px 24px;
  display: flex;
  gap: 16px;
  align-items: center;
`

const Avatar = styled.div<{ url?: string }>`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: ${({ url }) =>
    url
      ? `url(${url}) center/cover`
      : 'linear-gradient(135deg, #7461FF, #26D07C)'};
  flex-shrink: 0;
`

const AgentInfo = styled.div`
  flex: 1;
`

const AgentName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 4px;
`

const AgentMeta = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8a8a8e;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
`

const Skeleton = styled.div`
  background: linear-gradient(90deg, #232323 25%, #2a2a2a 50%, #232323 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 18px;
  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
`

const ErrorMsg = styled.div`
  text-align: center;
  color: #ff4d4d;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  padding: 64px 24px;
`

// ─── Helpers ─────────────────────────────────────────────────────

const RISK_COLORS: Record<string, { color: string; bg: string }> = {
  LOW: { color: '#26D07C', bg: 'rgba(38,208,124,0.1)' },
  MEDIUM: { color: '#FE923F', bg: 'rgba(254,146,63,0.1)' },
  HIGH: { color: '#FF6B6B', bg: 'rgba(255,107,107,0.1)' },
  AGGRESSIVE: { color: '#FF4D4D', bg: 'rgba(255,77,77,0.1)' }
}

const TYPE_COLORS: Record<string, string> = {
  COPYTRADE: '#26D07C',
  MARKET_MAKER: '#FE923F',
  ARBITRAGE: '#7461FF',
  MOMENTUM: '#4DACFF',
  HEDGE: '#B0B0B0',
  CUSTOM: '#8A8A8E'
}

function fmtRoi(v: number, pct = true): string {
  const sign = v >= 0 ? '+' : ''
  return pct ? `${sign}${(v * 100).toFixed(2)}%` : `${sign}${v.toFixed(4)}`
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

type DayRange = 7 | 30 | 90

// ─── Custom Tooltip ──────────────────────────────────────────────

const TooltipBox = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 10px;
  padding: 10px 14px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
`

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as StrategyPerformancePoint
  return (
    <TooltipBox>
      <div style={{ color: '#8A8A8E', marginBottom: 4 }}>{fmtDate(p.date)}</div>
      <div style={{ color: p.roi >= 0 ? '#26D07C' : '#FF4D4D' }}>
        ROI {fmtRoi(p.roi)}
      </div>
      <div style={{ color: '#CCCCCC' }}>Equity {fmtUSD(p.equity)}</div>
      <div style={{ color: '#8A8A8E' }}>Trades {p.trades}</div>
    </TooltipBox>
  )
}

// ─── Component ───────────────────────────────────────────────────

const StrategyDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { walletAddress, signMessage } = useSDK()

  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [history, setHistory] = useState<StrategyPerformancePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dayRange, setDayRange] = useState<DayRange>(30)
  const [following, setFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [chartMetric, setChartMetric] = useState<'roi' | 'equity'>('equity')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [s, h] = await Promise.all([
        strategyService.getStrategy(id),
        strategyService.getPerformanceHistory(id, dayRange)
      ])
      setStrategy(s)
      setHistory(h)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load strategy')
    } finally {
      setLoading(false)
    }
  }, [id, dayRange])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!id || !walletAddress) return
    strategyService
      .getFollowedStrategies(walletAddress, signMessage)
      .then(followed => setFollowing(followed.some(s => s.id === id)))
      .catch(() => {})
  }, [id, walletAddress, signMessage])

  const reloadHistory = useCallback(
    async (days: DayRange) => {
      if (!id) return
      setDayRange(days)
      try {
        const h = await strategyService.getPerformanceHistory(id, days)
        setHistory(h)
      } catch {
        // Ignore transient history reload failures; keep previous chart data.
      }
    },
    [id]
  )

  const handleFollow = async () => {
    if (!strategy) return
    if (!walletAddress) {
      alert('Connect your wallet to follow strategies.')
      return
    }
    setFollowLoading(true)
    try {
      if (following) {
        await strategyService.unfollowStrategy(
          strategy.id,
          walletAddress,
          signMessage
        )
        setFollowing(false)
        setStrategy(s =>
          s ? { ...s, followersCount: Math.max(0, s.followersCount - 1) } : s
        )
      } else {
        await strategyService.followStrategy(
          strategy.id,
          walletAddress,
          signMessage
        )
        setFollowing(true)
        setStrategy(s =>
          s ? { ...s, followersCount: s.followersCount + 1 } : s
        )
      }
    } catch (e: any) {
      alert(e.message)
    } finally {
      setFollowLoading(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <Container>
          <Skeleton style={{ height: 48, width: 200, marginBottom: 24 }} />
          <Skeleton style={{ height: 320, marginBottom: 20 }} />
          <Skeleton style={{ height: 200 }} />
        </Container>
      </Page>
    )
  }

  if (error || !strategy) {
    return (
      <Page>
        <Container>
          <BackBtn onClick={() => navigate('/strategies')}>
            ← Back to Marketplace
          </BackBtn>
          <ErrorMsg>{error ?? 'Strategy not found'}</ErrorMsg>
        </Container>
      </Page>
    )
  }

  const risk = RISK_COLORS[strategy.riskLevel] ?? RISK_COLORS.MEDIUM
  const typeColor = TYPE_COLORS[strategy.strategyType] ?? '#8A8A8E'

  const chartData = history.map(p => ({
    ...p,
    displayValue: chartMetric === 'roi' ? p.roi * 100 : p.equity,
    positive: p.roi >= 0
  }))

  const latestRoi =
    history.length > 0 ? history[history.length - 1].roi : strategy.roi30d
  const chartColor = latestRoi >= 0 ? '#26D07C' : '#FF4D4D'

  return (
    <Page>
      <Container>
        <BackBtn onClick={() => navigate('/strategies')}>
          ← Back to Marketplace
        </BackBtn>

        {/* ─── Hero ─────────────────────────────────────── */}
        <TopGrid>
          <div>
            <ChipRow>
              <Chip color={typeColor} bg={typeColor + '18'}>
                {strategy.strategyType.replace('_', ' ')}
              </Chip>
              <Chip color={risk.color} bg={risk.bg}>
                {strategy.riskLevel}
              </Chip>
              <Chip
                color={strategy.status === 'ACTIVE' ? '#26D07C' : '#FE923F'}
                bg={
                  strategy.status === 'ACTIVE'
                    ? 'rgba(38,208,124,0.1)'
                    : 'rgba(254,146,63,0.1)'
                }
              >
                {strategy.status}
              </Chip>
              {strategy.leader?.isAi && (
                <Chip color="#7461FF" bg="rgba(116,97,255,0.12)">
                  AI Agent
                </Chip>
              )}
              {strategy.leader?.isVerified && (
                <Chip color="#26D07C" bg="rgba(38,208,124,0.08)">
                  ✓ Verified
                </Chip>
              )}
            </ChipRow>
            <Name>{strategy.name}</Name>
            {strategy.description && (
              <Description>{strategy.description}</Description>
            )}
          </div>

          <ROIPanel>
            <ROILabel>30d ROI</ROILabel>
            <ROIValue positive={strategy.roi30d >= 0}>
              {fmtRoi(strategy.roi30d)}
            </ROIValue>
            <ROISub>
              <ROISubItem>
                <ROISubValue positive={strategy.roi7d >= 0}>
                  {fmtRoi(strategy.roi7d)}
                </ROISubValue>
                <ROISubLabel>7d</ROISubLabel>
              </ROISubItem>
              <ROISubItem>
                <ROISubValue positive={strategy.roi1d >= 0}>
                  {fmtRoi(strategy.roi1d)}
                </ROISubValue>
                <ROISubLabel>1d</ROISubLabel>
              </ROISubItem>
              <ROISubItem>
                <ROISubValue>
                  {strategy.followersCount.toLocaleString()}
                </ROISubValue>
                <ROISubLabel>Followers</ROISubLabel>
              </ROISubItem>
            </ROISub>
            <FollowBtn
              following={following}
              disabled={followLoading}
              onClick={handleFollow}
            >
              {followLoading
                ? '…'
                : following
                  ? 'Following · Unfollow'
                  : 'Follow Strategy'}
            </FollowBtn>
          </ROIPanel>
        </TopGrid>

        {/* ─── Performance Chart ────────────────────────── */}
        <Section>
          <SectionTitle>Performance</SectionTitle>
          <ChartWrap>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12
              }}
            >
              <ChartTabRow>
                <ChartTab
                  active={chartMetric === 'equity'}
                  onClick={() => setChartMetric('equity')}
                >
                  Equity Curve
                </ChartTab>
                <ChartTab
                  active={chartMetric === 'roi'}
                  onClick={() => setChartMetric('roi')}
                >
                  Daily ROI
                </ChartTab>
              </ChartTabRow>
              <ChartTabRow>
                {([7, 30, 90] as DayRange[]).map(d => (
                  <ChartTab
                    key={d}
                    active={dayRange === d}
                    onClick={() => reloadHistory(d)}
                  >
                    {d}D
                  </ChartTab>
                ))}
              </ChartTabRow>
            </div>

            {chartData.length === 0 ? (
              <div
                style={{
                  height: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#8A8A8E',
                  fontFamily: 'Space Grotesk',
                  fontSize: '14px'
                }}
              >
                No performance data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={chartColor}
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor={chartColor}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2C" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{
                      fill: '#8A8A8E',
                      fontSize: 11,
                      fontFamily: 'Space Grotesk'
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{
                      fill: '#8A8A8E',
                      fontSize: 11,
                      fontFamily: 'Space Grotesk'
                    }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      chartMetric === 'roi' ? `${v.toFixed(1)}%` : fmtUSD(v)
                    }
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="displayValue"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#chartGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartWrap>
        </Section>

        {/* ─── Risk Metrics ─────────────────────────────── */}
        <Section>
          <SectionTitle>Risk Metrics</SectionTitle>
          <StatsGrid>
            <StatCard>
              <StatValue>{strategy.sharpeRatio.toFixed(2)}</StatValue>
              <StatLabel>Sharpe Ratio</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ color: '#FF6B6B' }}>
                -{(strategy.maxDrawdown * 100).toFixed(1)}%
              </StatValue>
              <StatLabel>Max Drawdown</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ color: '#26D07C' }}>
                {(strategy.winRate * 100).toFixed(0)}%
              </StatValue>
              <StatLabel>Win Rate</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{strategy.totalTrades.toLocaleString()}</StatValue>
              <StatLabel>Total Trades</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{fmtUSD(strategy.vaultEquity)}</StatValue>
              <StatLabel>Vault AUM</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{fmtUSD(strategy.totalVolume)}</StatValue>
              <StatLabel>Total Volume</StatLabel>
            </StatCard>
          </StatsGrid>
        </Section>

        {/* ─── Agent / Leader ───────────────────────────── */}
        {(strategy.agent || strategy.leader) && (
          <Section>
            <SectionTitle>Strategy Manager</SectionTitle>
            <AgentCard>
              <Avatar url={strategy.leader?.avatar} />
              <AgentInfo>
                <AgentName>
                  {strategy.leader
                    ? `@${strategy.leader.username}`
                    : strategy.agent?.walletAddress.slice(0, 12) + '…'}
                </AgentName>
                <AgentMeta>
                  {strategy.agent?.agentType && (
                    <span>{strategy.agent.agentType.replace('_', ' ')}</span>
                  )}
                  {strategy.agent?.framework && (
                    <span>Framework: {strategy.agent.framework}</span>
                  )}
                  {strategy.agent && (
                    <span style={{ color: '#7461FF' }}>
                      Reputation{' '}
                      {Number(strategy.agent.reputationScore).toFixed(0)}/100
                    </span>
                  )}
                  {strategy.leader?.followersCount !== undefined && (
                    <span>
                      {strategy.leader.followersCount.toLocaleString()}{' '}
                      followers
                    </span>
                  )}
                  {strategy.vaultAddress && (
                    <span title={strategy.vaultAddress}>
                      Vault {strategy.vaultAddress.slice(0, 10)}…
                    </span>
                  )}
                </AgentMeta>
              </AgentInfo>
              {strategy.leader && (
                <div
                  style={{
                    color: '#7461FF',
                    fontFamily: 'Space Grotesk',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                  onClick={() =>
                    navigate(`/social/profile/${strategy.leader!.id}`)
                  }
                >
                  View Profile →
                </div>
              )}
            </AgentCard>
          </Section>
        )}

        {/* ─── Vault info ───────────────────────────────── */}
        {strategy.vaultAddress && (
          <Section>
            <SectionTitle>On-chain Vault</SectionTitle>
            <div
              style={{
                background: '#232323',
                border: '1px solid #2A2A2C',
                borderRadius: 14,
                padding: '16px 20px',
                fontFamily: 'Space Grotesk',
                fontSize: '13px',
                color: '#8A8A8E',
                wordBreak: 'break-all'
              }}
            >
              <span style={{ color: '#CCCCCC' }}>CopyVault Address: </span>
              {strategy.vaultAddress}
            </div>
          </Section>
        )}
      </Container>
    </Page>
  )
}

export default StrategyDetail
