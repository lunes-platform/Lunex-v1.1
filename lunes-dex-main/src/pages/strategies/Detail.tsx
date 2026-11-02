/**
 * Strategy detail (prototype STRATEGY DETAIL): performance, risk metrics,
 * manager and on-chain vault.
 *
 * Real data: `strategyService.getStrategy`, `getPerformanceHistory`,
 * `getFollowedStrategies`, `followStrategy` / `unfollowStrategy`.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'
import { Copy, ExternalLink } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  Badge,
  Button,
  C,
  Card,
  Col,
  Empty,
  H1,
  LinkButton,
  Page,
  Row,
  SkeletonLine,
  Spinner,
  StatCard,
  StatLabel,
  StatValue,
  Tabs,
  grotesk,
  short,
  tabular
} from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { useToast } from 'components/feedback/ToastProvider'
import strategyService, {
  Strategy,
  StrategyPerformancePoint
} from '../../services/strategyService'
import { useSDK } from '../../context/SDKContext'
import {
  BackLink,
  RISK_STYLE,
  RiskTag,
  TYPE_LABEL,
  TypeLabel,
  errMsg,
  fmtCount,
  fmtPct,
  fmtUsd,
  roiColor
} from './shared'
import { requestWalletConnect } from 'pages/header/modals/wallets'

type DayRange = '7' | '30' | '90'
type Metric = 'equity' | 'roi'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ─── Styled ──────────────────────────────────────────────────────

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  @media (max-width: 759px) {
    > button {
      width: 100%;
    }
  }
`

const Lead = styled.p`
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: ${C.body};
  max-width: 720px;
`

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
  @media (max-width: 759px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const Stat = styled(StatCard)`
  padding: 14px 16px;
  border-radius: 14px;
  ${StatValue} {
    font-size: clamp(17px, 2.2vw, 22px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const CardTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
`

const Panels = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 12px;
`

const ListCard = styled(Card)`
  padding: 16px;
  gap: 2px;
  ${CardTitle} {
    margin-bottom: 6px;
  }
`

const Line = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  font-size: 13px;
  & + & {
    border-top: 1px solid ${C.border};
  }
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    ${tabular};
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Mono = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

const CopyBtn = styled.button`
  border: none;
  background: none;
  padding: 2px;
  color: ${C.muted};
  display: inline-flex;
  &:hover {
    color: ${C.text};
  }
`

const ChartHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
`

const ChartEmpty = styled.div`
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${C.muted};
  font-size: 14px;
`

const TipBox = styled.div`
  background: ${C.surface};
  border: 1px solid ${C.borderStrong};
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  ${tabular};
  display: flex;
  flex-direction: column;
  gap: 2px;
`

type TipProps = {
  active?: boolean
  payload?: Array<{ payload: StrategyPerformancePoint }>
}

const ChartTip: React.FC<TipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <TipBox>
      <span style={{ color: C.muted }}>{fmtDate(p.date)}</span>
      <span style={{ color: roiColor(p.roi) }}>ROI {fmtPct(p.roi, 2)}</span>
      <span>Equity {fmtUsd(p.equity)}</span>
      <span style={{ color: C.muted }}>Trades {p.trades}</span>
    </TipBox>
  )
}

// ─── Component ───────────────────────────────────────────────────

const StrategyDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { walletAddress, signMessage } = useSDK()
  const { toast } = useToast()

  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [history, setHistory] = useState<StrategyPerformancePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<DayRange>('30')
  const [metric, setMetric] = useState<Metric>('equity')
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [s, h] = await Promise.all([
        strategyService.getStrategy(id),
        strategyService.getPerformanceHistory(id, 30)
      ])
      setStrategy(s)
      setHistory(h)
      setRange('30')
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to load strategy'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!id || !walletAddress) {
      setFollowing(false)
      return
    }
    strategyService
      .getFollowedStrategies(walletAddress, signMessage)
      .then(list => setFollowing(list.some(s => s.id === id)))
      .catch(() => {})
  }, [id, walletAddress, signMessage])

  const changeRange = async (d: DayRange) => {
    if (!id) return
    setRange(d)
    try {
      setHistory(await strategyService.getPerformanceHistory(id, Number(d)))
    } catch {
      // keep the previous chart data on a transient failure
    }
  }

  const toggleFollow = async () => {
    if (!strategy) return
    if (!walletAddress) {
      requestWalletConnect().catch((e: unknown) =>
        toast('error', 'Could not connect wallet', errMsg(e, ''))
      )
      return
    }
    const was = following
    setBusy(true)
    try {
      if (was) {
        await strategyService.unfollowStrategy(
          strategy.id,
          walletAddress,
          signMessage
        )
      } else {
        await strategyService.followStrategy(
          strategy.id,
          walletAddress,
          signMessage
        )
      }
      setFollowing(!was)
      setStrategy(s =>
        s
          ? {
              ...s,
              followersCount: Math.max(0, s.followersCount + (was ? -1 : 1))
            }
          : s
      )
      toast(
        was ? 'info' : 'success',
        was ? 'Unfollowed' : 'Following strategy',
        strategy.name
      )
    } catch (e: unknown) {
      const msg = errMsg(e, 'Please try again.')
      if (/cancel|reject|denied/i.test(msg)) {
        toast('warning', 'Request rejected', 'Nothing was signed.')
      } else {
        toast('error', was ? 'Could not unfollow' : 'Could not follow', msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() =>
        toast('success', 'Copied to clipboard', undefined, { silent: true })
      )
      .catch(() =>
        toast('error', 'Could not copy', undefined, { silent: true })
      )
  }

  const back = (
    <BackLink
      label="Strategy marketplace"
      onClick={() => navigate('/strategies')}
    />
  )

  if (loading) {
    return (
      <Page $max={1000} aria-busy="true">
        {back}
        <Col $gap={10}>
          <SkeletonLine $w="160px" $h={14} />
          <SkeletonLine $w="320px" $h={34} />
          <SkeletonLine $w="140px" $h={14} />
        </Col>
        <SkeletonLine $h={18} $w="70%" />
        <Stats>
          {[0, 1, 2, 3].map(i => (
            <SkeletonLine key={i} $h={72} />
          ))}
        </Stats>
        <SkeletonLine $h={260} />
      </Page>
    )
  }

  if (error || !strategy) {
    return (
      <Page $max={1000}>
        {back}
        <Empty role="alert">
          <h3>Strategy not available</h3>
          <span>{error ?? 'This strategy could not be found.'}</span>
          <Row $gap={8} $justify="center">
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
            <Button size="sm" onClick={() => navigate('/strategies')}>
              Browse strategies
            </Button>
          </Row>
        </Empty>
      </Page>
    )
  }

  const s = strategy
  const risk = RISK_STYLE[s.riskLevel] ?? RISK_STYLE.MEDIUM
  const latest = history.length ? history[history.length - 1].roi : s.roi30d
  const lineColor = latest >= 0 ? C.success : C.criticalText
  const chartData = history.map(p => ({
    ...p,
    v: metric === 'roi' ? p.roi * 100 : p.equity
  }))
  const isAi =
    s.leader?.isAi || (!!s.agent?.agentType && s.agent.agentType !== 'HUMAN')
  const managerName = s.leader
    ? s.leader.name || `@${s.leader.username}`
    : s.agent
      ? short(s.agent.walletAddress)
      : '—'

  return (
    <Page $max={1000}>
      {back}

      <Head>
        <Col $gap={6}>
          <Row $gap={8} $wrap>
            <TypeLabel>
              {TYPE_LABEL[s.strategyType] ?? s.strategyType}
            </TypeLabel>
            <RiskTag $risk={s.riskLevel}>{risk.label}</RiskTag>
            {s.status !== 'ACTIVE' && (
              <Badge $tone={s.status === 'PAUSED' ? 'warning' : 'neutral'}>
                {s.status === 'PAUSED' ? 'Paused' : 'Archived'}
              </Badge>
            )}
            {s.leader?.isVerified && <Badge $tone="success">Verified</Badge>}
          </Row>
          <H1>{s.name}</H1>
          <span style={{ fontSize: 14, color: C.muted }}>
            by {managerName}
            {isAi ? ' · AI agent' : ''}
          </span>
        </Col>
        <Button
          size="lg"
          variant={following ? 'secondary' : 'primary'}
          style={{ height: 46, fontSize: 15 }}
          disabled={busy}
          aria-pressed={following}
          onClick={toggleFollow}
        >
          {busy ? (
            <Spinner $size={16} />
          ) : following ? (
            'Following — unfollow'
          ) : (
            'Follow strategy'
          )}
        </Button>
      </Head>

      {s.description && <Lead>{s.description}</Lead>}

      <Stats>
        <Stat>
          <StatLabel>ROI 30d</StatLabel>
          <StatValue style={{ color: roiColor(s.roi30d) }}>
            <AnimatedNumber text={fmtPct(s.roi30d)} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Win rate</StatLabel>
          <StatValue>
            <AnimatedNumber text={fmtPct(s.winRate, 0, false)} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Followers</StatLabel>
          <StatValue>
            <AnimatedNumber text={fmtCount(s.followersCount)} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Vault AUM</StatLabel>
          <StatValue>
            <AnimatedNumber text={fmtUsd(s.vaultEquity)} />
          </StatValue>
        </Stat>
      </Stats>

      <Card $pad={16} style={{ gap: 12 }}>
        <ChartHead>
          <CardTitle>Performance</CardTitle>
          <Row $gap={8} $wrap>
            <Tabs
              items={[
                { value: 'equity', label: 'Equity' },
                { value: 'roi', label: 'Daily ROI' }
              ]}
              value={metric}
              onChange={setMetric}
              ariaLabel="Chart metric"
            />
            <Tabs
              items={[
                { value: '7', label: '7D' },
                { value: '30', label: '30D' },
                { value: '90', label: '90D' }
              ]}
              value={range}
              onChange={changeRange}
              ariaLabel="Chart range"
            />
          </Row>
        </ChartHead>
        {chartData.length === 0 ? (
          <ChartEmpty>No performance data yet</ChartEmpty>
        ) : (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="stratPerf" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={lineColor}
                      stopOpacity={0.22}
                    />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fill: C.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  width={52}
                  tick={{ fill: C.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    metric === 'roi' ? `${v.toFixed(1)}%` : fmtUsd(v)
                  }
                />
                <Tooltip
                  content={<ChartTip />}
                  cursor={{ stroke: C.borderStrong }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#stratPerf)"
                  dot={false}
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Panels>
        <ListCard>
          <CardTitle>Risk metrics</CardTitle>
          <Line>
            <span>Max drawdown</span>
            <span style={{ color: C.warning }}>
              −{(s.maxDrawdown * 100).toFixed(1)}%
            </span>
          </Line>
          <Line>
            <span>Sharpe ratio</span>
            <span>{s.sharpeRatio.toFixed(2)}</span>
          </Line>
          <Line>
            <span>ROI 7d</span>
            <span style={{ color: roiColor(s.roi7d) }}>
              {fmtPct(s.roi7d, 2)}
            </span>
          </Line>
          <Line>
            <span>ROI 24h</span>
            <span style={{ color: roiColor(s.roi1d) }}>
              {fmtPct(s.roi1d, 2)}
            </span>
          </Line>
          <Line>
            <span>Total trades</span>
            <span>{s.totalTrades.toLocaleString('en-US')}</span>
          </Line>
        </ListCard>

        <ListCard>
          <CardTitle>Strategy manager</CardTitle>
          <Line>
            <span>Manager</span>
            <span>{managerName}</span>
          </Line>
          <Line>
            <span>Type</span>
            <span>{isAi ? 'AI agent' : 'Human trader'}</span>
          </Line>
          {s.agent?.framework && (
            <Line>
              <span>Framework</span>
              <span>{s.agent.framework}</span>
            </Line>
          )}
          {s.agent && (
            <Line>
              <span>Reputation</span>
              <span>{Number(s.agent.reputationScore).toFixed(0)}/100</span>
            </Line>
          )}
          <Line>
            <span>Live since</span>
            <span>
              {new Date(s.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric'
              })}
            </span>
          </Line>
          {s.leader && (
            <LinkButton
              style={{ marginTop: 8, alignSelf: 'flex-start' }}
              onClick={() => navigate(`/social/profile/${s.leader!.id}`)}
            >
              View profile <ExternalLink size={13} />
            </LinkButton>
          )}
        </ListCard>

        <ListCard>
          <CardTitle>On-chain vault</CardTitle>
          <Line>
            <span>Vault contract</span>
            {s.vaultAddress ? (
              <Mono title={s.vaultAddress}>
                {short(s.vaultAddress)}
                <CopyBtn
                  aria-label="Copy vault address"
                  onClick={() => copy(s.vaultAddress!)}
                >
                  <Copy size={13} />
                </CopyBtn>
              </Mono>
            ) : (
              <span style={{ color: C.muted }}>Not linked yet</span>
            )}
          </Line>
          <Line>
            <span>TVL</span>
            <span>{fmtUsd(s.vaultEquity)}</span>
          </Line>
          <Line>
            <span>Total volume</span>
            <span>{fmtUsd(s.totalVolume)}</span>
          </Line>
          <Line>
            <span>Performance synced</span>
            <span>
              {s.performanceSyncedAt
                ? new Date(s.performanceSyncedAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : '—'}
            </span>
          </Line>
        </ListCard>
      </Panels>
    </Page>
  )
}

export default StrategyDetail
