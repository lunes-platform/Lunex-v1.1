/**
 * Agent dashboard (prototype AGENT).
 *
 * Real data (all authenticated by the agent API key, kept in memory only):
 * - `GET /api/v1/agents/me`                → agent profile
 * - `strategyService.listStrategies`       → the agent's strategies
 * - `GET /api/v1/execution/daily-summary`  → 24h stats
 * - `GET /api/v1/execution/history`        → terminal execution log
 * - `PATCH /api/v1/strategies/:id`         → pause / resume
 * Strategy registration goes through the shared CreateStrategyModal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Bot, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  C,
  Card,
  Col,
  H1,
  H2,
  IconButton,
  Page,
  Row,
  SkeletonLine,
  Spinner,
  Sub,
  grotesk,
  short,
  tabular
} from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { useToast } from 'components/feedback/ToastProvider'
import strategyService, { Strategy } from '../../services/strategyService'
import type { AgentProfile } from '../../services/agentService'
import { useSDK } from '../../context/SDKContext'
import CreateStrategyModal from '../strategies/CreateStrategyModal'
import {
  FilterPill,
  RISK_STYLE,
  RiskTag,
  TYPE_LABEL,
  errMsg,
  fmtCount,
  fmtPct,
  fmtUsd,
  roiColor
} from '../strategies/shared'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'
const LOG_POLL_MS = 15000

const AGENT_TYPE_LABEL: Record<string, string> = {
  HUMAN: 'Human trader',
  AI_AGENT: 'AI agent',
  OPENCLAW_BOT: 'OpenClaw bot',
  ALGO_BOT: 'Algo bot'
}

type DailySummary = {
  totalAttempts: number
  executed: number
  rejected: number
  successRate: number
  totalVolume: number
}

type ExecLog = {
  id: string
  pairSymbol: string
  side: string
  orderType: string
  requestedAmount: number
  price?: number
  status: string
  rejectionReason?: string
  createdAt: string
}

type LogFilter = '' | 'EXECUTED' | 'REJECTED' | 'PENDING' | 'FAILED'
type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

const LOG_FILTERS: { value: LogFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'EXECUTED', label: 'Executed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' }
]

const LOG_COLOR: Record<string, string> = {
  EXECUTED: C.successText,
  REJECTED: C.criticalText,
  FAILED: C.criticalText,
  PENDING: C.warning
}

const keyHeaders = (key: string) => ({ 'X-API-Key': key })

// ─── Styled ──────────────────────────────────────────────────────

const Lead = styled(Sub)`
  font-size: 15px;
  margin: 0;
  text-wrap: pretty;
`

const Dashed = styled.div`
  padding: 48px 24px;
  border-radius: 16px;
  border: 1px dashed ${C.borderStrong};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  h2 {
    ${grotesk};
    font-size: 18px;
    font-weight: 600;
  }
  p {
    margin: 0;
    font-size: 14px;
    color: ${C.muted};
    max-width: 380px;
    line-height: 1.5;
  }
`

const Top = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: stretch;
`

const StatusCard = styled(Card)`
  flex: 1 1 340px;
  padding: 18px;
  gap: 16px;
`

const AgentIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: ${C.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
`

const AgentName = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StatusChip = styled.span<{ $color: string; $bg: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: ${p => p.$bg};
  color: ${p => p.$color};
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${p => p.$color};
  }
`

const Mini = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  > div {
    padding: 12px;
    border-radius: 12px;
    background: ${C.bg};
    min-width: 0;
  }
  span {
    display: block;
    font-size: 11px;
    color: ${C.muted};
    margin-bottom: 4px;
  }
  strong {
    display: block;
    ${grotesk};
    ${tabular};
    font-size: 18px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 759px) {
    strong {
      font-size: 16px;
    }
  }
`

const Limits = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  > div > span:first-child {
    color: ${C.muted};
  }
  > div > span:last-child {
    font-weight: 500;
    ${tabular};
  }
`

const Terminal = styled.div`
  flex: 1.3 1 380px;
  min-width: 0;
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.terminal};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  @media (max-width: 759px) {
    padding: 14px;
  }
`

const LogList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 300px;
  min-height: 160px;
  overflow-y: auto;
  ${tabular};
  > div {
    display: flex;
    gap: 10px;
  }
  > div > span:first-child {
    color: #6d6d6d;
    flex-shrink: 0;
  }
  > div > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
`

const LiveDot = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: ${C.muted};
  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${C.success};
  }
`

const LogPill = styled(FilterPill)`
  height: 26px;
  padding: 0 10px;
  font-size: 11px;
  background: ${p => (p.$active ? C.terminalInput : 'transparent')};
`

const TermTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
`

const Pane = styled(Card)`
  padding: 18px;
  gap: 10px;
`

const PaneTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 16px;
`

const PaneText = styled.span`
  font-size: 13px;
  line-height: 1.55;
  color: ${C.secondary};
  flex: 1;
`

const Bottom = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 12px;
`

const KeyInput = styled.input`
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  background: ${C.bg};
  color: #fff;
  font-size: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  &:focus {
    border-color: ${C.primary};
    outline: none;
  }
`

const StratRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(0, 0.7fr)) auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  & + & {
    border-top: 1px solid ${C.border};
  }
  @media (max-width: 759px) {
    grid-template-columns: 1fr 1fr;
    > :first-child,
    > :last-child {
      grid-column: 1 / -1;
    }
  }
`

const Num = styled.span`
  ${grotesk};
  ${tabular};
  font-weight: 600;
  font-size: 14px;
`

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour12: false })

const logMessage = (l: ExecLog) => {
  const amt = Number(l.requestedAmount).toLocaleString('en-US', {
    maximumFractionDigits: 4
  })
  const price = l.price ? ` @ ${Number(l.price).toFixed(6)}` : ''
  const base = `${l.status} ${l.side} ${l.orderType} ${amt} ${l.pairSymbol}${price}`
  return l.rejectionReason ? `${base} — ${l.rejectionReason}` : base
}

// ─── Component ───────────────────────────────────────────────────

const AgentDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress } = useSDK()
  const { toast } = useToast()

  const [keyInput, setKeyInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [agent, setAgent] = useState<AgentProfile | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loadingAgent, setLoadingAgent] = useState(false)
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [showCreate, setShowCreate] = useState(false)

  const [logs, setLogs] = useState<ExecLog[]>([])
  const [logFilter, setLogFilter] = useState<LogFilter>('')
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // ─── Load agent by API key ────────────────────────────────────

  const loadAgent = useCallback(
    async (key: string) => {
      setLoadingAgent(true)
      try {
        const res = await fetch(`${API}/api/v1/agents/me`, {
          headers: keyHeaders(key)
        })
        if (!res.ok) throw new Error('Invalid API key or agent not found')
        const { agent: a } = await res.json()
        const [{ strategies: list }, sum] = await Promise.all([
          strategyService.listStrategies({ agentId: a.id }, key),
          fetch(`${API}/api/v1/execution/daily-summary`, {
            headers: keyHeaders(key)
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        ])
        setAgent({
          ...a,
          stakingTier: Number(a.stakingTier ?? 0),
          totalTrades: Number(a.totalTrades ?? 0),
          totalVolume: Number(a.totalVolume ?? 0),
          roi: Number(a.roi ?? a.roi30d ?? 0)
        } as AgentProfile)
        setApiKey(key)
        setStrategies(list)
        setSummary(sum?.summary ?? null)
        setKeyInput('')
        toast('success', 'Key registered', 'Agent loaded from your API key.')
      } catch (e: unknown) {
        toast('error', 'Could not load agent', errMsg(e, 'Check the key.'))
      } finally {
        setLoadingAgent(false)
      }
    },
    [toast]
  )

  const registerKey = () => {
    const k = keyInput.trim()
    if (!k) {
      toast(
        'error',
        'Enter an API key',
        'Paste the key from your agent dashboard.'
      )
      return
    }
    loadAgent(k)
  }

  const forgetKey = () => {
    setApiKey('')
    setAgent(null)
    setStrategies([])
    setSummary(null)
    setLogs([])
  }

  // ─── Execution log ────────────────────────────────────────────

  const loadLogs = useCallback(
    async (quiet = false) => {
      if (!apiKey) return
      if (!quiet) setLogLoading(true)
      try {
        const qs = logFilter ? `?status=${logFilter}&limit=50` : '?limit=50'
        const res = await fetch(`${API}/api/v1/execution/history${qs}`, {
          headers: keyHeaders(apiKey)
        })
        if (!res.ok) throw new Error('Failed to load execution history')
        const data = await res.json()
        setLogs(data.logs ?? [])
        setLogError(null)
      } catch (e: unknown) {
        setLogError(errMsg(e, 'Failed to load execution history'))
      } finally {
        if (!quiet) setLogLoading(false)
      }
    },
    [apiKey, logFilter]
  )

  useEffect(() => {
    if (!apiKey) return
    loadLogs()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadLogs(true)
    }, LOG_POLL_MS)
    return () => clearInterval(t)
  }, [apiKey, loadLogs])

  // ─── Pause / resume ───────────────────────────────────────────

  const patchStatus = async (s: Strategy, status: 'ACTIVE' | 'PAUSED') => {
    const res = await fetch(`${API}/api/v1/strategies/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...keyHeaders(apiKey) },
      body: JSON.stringify({ status })
    })
    if (!res.ok) throw new Error(`Failed to update ${s.name}`)
    setStrategies(prev => prev.map(x => (x.id === s.id ? { ...x, status } : x)))
  }

  const withToggling = async (ids: string[], fn: () => Promise<void>) => {
    setToggling(prev => new Set([...prev, ...ids]))
    try {
      await fn()
    } finally {
      setToggling(prev => {
        const n = new Set(prev)
        ids.forEach(id => n.delete(id))
        return n
      })
    }
  }

  const toggleStrategy = (s: Strategy) => {
    const next = s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    return withToggling([s.id], async () => {
      try {
        await patchStatus(s, next)
        toast(
          next === 'ACTIVE' ? 'success' : 'info',
          next === 'ACTIVE' ? 'Strategy resumed' : 'Strategy paused',
          s.name
        )
      } catch (e: unknown) {
        toast('error', 'Could not update strategy', errMsg(e, ''))
      }
    })
  }

  const running = strategies.some(s => s.status === 'ACTIVE')
  const pausable = strategies.filter(s =>
    running ? s.status === 'ACTIVE' : s.status === 'PAUSED'
  )

  const agentName = agent
    ? agent.leader?.name || agent.framework || short(agent.walletAddress)
    : ''
  const agentSub = agent
    ? [
        AGENT_TYPE_LABEL[agent.agentType] ?? agent.agentType,
        agent.framework,
        short(agent.walletAddress)
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const toggleAgent = () => {
    if (!pausable.length) return
    const next = running ? 'PAUSED' : 'ACTIVE'
    return withToggling(
      pausable.map(s => s.id),
      async () => {
        const results = await Promise.allSettled(
          pausable.map(s => patchStatus(s, next))
        )
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed) {
          toast(
            'error',
            running
              ? 'Some strategies were not paused'
              : 'Some strategies were not resumed',
            `${failed} of ${pausable.length} failed — try again.`
          )
        } else {
          toast(
            running ? 'info' : 'success',
            running ? 'Agent paused' : 'Agent resumed',
            agentName
          )
        }
      }
    )
  }

  const filteredStrategies = useMemo(
    () =>
      strategies.filter(
        s => statusFilter === 'ALL' || s.status === statusFilter
      ),
    [strategies, statusFilter]
  )

  const connect = () =>
    requestWalletConnect().catch((e: unknown) =>
      toast('error', 'Could not connect wallet', errMsg(e, ''))
    )

  const anyToggling = pausable.some(s => toggling.has(s.id))
  const chip = !strategies.length
    ? { label: 'No strategies', color: C.secondary, bg: C.field }
    : running
      ? { label: 'Running', color: C.successText, bg: 'rgba(38,208,124,0.14)' }
      : { label: 'Paused', color: C.warning, bg: 'rgba(254,146,63,0.14)' }

  const stats = summary
    ? [
        { label: 'Executed 24h', text: fmtCount(summary.executed) },
        {
          label: 'Success rate',
          text: `${(summary.successRate * 100).toFixed(0)}%`,
          color:
            summary.successRate >= 0.9
              ? C.success
              : summary.successRate >= 0.7
                ? C.warning
                : C.criticalText
        },
        { label: 'Volume 24h', text: fmtUsd(Number(summary.totalVolume)) }
      ]
    : agent
      ? [
          { label: 'Total trades', text: fmtCount(agent.totalTrades) },
          { label: 'ROI', text: fmtPct(agent.roi), color: roiColor(agent.roi) },
          { label: 'Volume', text: fmtUsd(Number(agent.totalVolume)) }
        ]
      : []

  return (
    <Page $max={1080}>
      <CreateStrategyModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={s => setStrategies(prev => [s, ...prev])}
        initialApiKey={apiKey}
      />

      <Col $gap={6}>
        <H1>AI agents</H1>
        <Lead>
          Connect a trading bot through the Lunex MCP SDK, set its limits, and
          let it execute on your behalf. You can pause it at any time.
        </Lead>
      </Col>

      {!agent && !walletAddress && (
        <Dashed>
          <h2>Connect to manage your agents</h2>
          <p>
            Agents trade from your wallet with the limits you sign. Nothing runs
            without your approval.
          </p>
          <Button size="lg" style={{ height: 44 }} onClick={connect}>
            Connect wallet
          </Button>
        </Dashed>
      )}

      {loadingAgent && !agent && (
        <Top aria-busy="true">
          <StatusCard>
            <SkeletonLine $w="60%" $h={20} />
            <SkeletonLine $h={64} />
            <SkeletonLine $h={60} />
          </StatusCard>
          <Terminal>
            <SkeletonLine $h={200} />
          </Terminal>
        </Top>
      )}

      {agent && (
        <>
          <Top>
            <StatusCard>
              <Row $gap={12}>
                <AgentIcon>
                  <Bot size={22} strokeWidth={1.75} />
                </AgentIcon>
                <Col $gap={2} style={{ flex: 1 }}>
                  <AgentName>{agentName}</AgentName>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {agentSub}
                  </span>
                </Col>
                <StatusChip $color={chip.color} $bg={chip.bg}>
                  {chip.label}
                </StatusChip>
              </Row>

              <Mini>
                {stats.map(k => (
                  <div key={k.label}>
                    <span>{k.label}</span>
                    <strong style={{ color: k.color }}>
                      <AnimatedNumber text={k.text} />
                    </strong>
                  </div>
                ))}
              </Mini>

              <Limits>
                <div>
                  <span>Staking tier</span>
                  <span>Tier {agent.stakingTier}</span>
                </div>
                <div>
                  <span>Active strategies</span>
                  <span>
                    {strategies.filter(s => s.status === 'ACTIVE').length} of{' '}
                    {strategies.length}
                  </span>
                </div>
                <div>
                  <span>Rejected orders (24h)</span>
                  <span
                    style={{
                      color:
                        summary && summary.rejected > 0
                          ? C.criticalText
                          : undefined
                    }}
                  >
                    {summary ? summary.rejected : '—'}
                  </span>
                </div>
                <div>
                  <span>Last active</span>
                  <span>
                    {agent.lastActiveAt
                      ? new Date(agent.lastActiveAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '—'}
                  </span>
                </div>
              </Limits>

              <Row $gap={8}>
                <Button
                  variant="secondary"
                  style={{ flex: 1, height: 44, borderRadius: 12 }}
                  disabled={!pausable.length || anyToggling}
                  onClick={toggleAgent}
                >
                  {anyToggling ? (
                    <Spinner $size={14} />
                  ) : running ? (
                    'Pause agent'
                  ) : (
                    'Resume agent'
                  )}
                </Button>
                <Button
                  variant="secondary"
                  style={{ flex: 1, height: 44, borderRadius: 12 }}
                  onClick={() =>
                    toast(
                      'info',
                      'Limits follow your staking tier',
                      'Stake more LUNES to raise your agent’s trading limits.',
                      { action: { label: 'Open staking', route: '/staking' } }
                    )
                  }
                >
                  Edit limits
                </Button>
              </Row>
            </StatusCard>

            <Terminal>
              <Row $justify="space-between">
                <TermTitle>Execution log</TermTitle>
                <Row $gap={8}>
                  <LiveDot data-motion="pulse">live</LiveDot>
                  <IconButton
                    $size={30}
                    aria-label="Refresh execution log"
                    onClick={() => loadLogs()}
                    disabled={logLoading}
                    style={{ borderRadius: 8, borderColor: C.border }}
                  >
                    {logLoading ? (
                      <Spinner $size={12} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </IconButton>
                </Row>
              </Row>
              <Row $gap={6} style={{ overflowX: 'auto' }}>
                {LOG_FILTERS.map(f => (
                  <LogPill
                    key={f.value || 'all'}
                    $active={logFilter === f.value}
                    aria-pressed={logFilter === f.value}
                    onClick={() => setLogFilter(f.value)}
                  >
                    {f.label}
                  </LogPill>
                ))}
              </Row>
              <LogList role="log" aria-live="polite" aria-label="Execution log">
                {logError ? (
                  <div>
                    <span>--:--:--</span>
                    <span style={{ color: C.criticalText }}>{logError}</span>
                  </div>
                ) : logs.length === 0 && !logLoading ? (
                  <div>
                    <span>{fmtTime(new Date().toISOString())}</span>
                    <span style={{ color: C.muted }}>
                      No executions yet. Waiting for the agent…
                    </span>
                  </div>
                ) : (
                  logs.map(l => (
                    <div key={l.id}>
                      <span>{fmtTime(l.createdAt)}</span>
                      <span
                        style={{ color: LOG_COLOR[l.status] ?? C.secondary }}
                      >
                        {logMessage(l)}
                      </span>
                    </div>
                  ))
                )}
              </LogList>
            </Terminal>
          </Top>

          <Col $gap={12}>
            <Row $justify="space-between" $wrap $gap={10}>
              <H2>Your strategies ({strategies.length})</H2>
              <Row $gap={6} $wrap>
                {(
                  ['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as StatusFilter[]
                ).map(f => (
                  <FilterPill
                    key={f}
                    $active={statusFilter === f}
                    aria-pressed={statusFilter === f}
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'ALL' ? 'All' : f[0] + f.slice(1).toLowerCase()}
                  </FilterPill>
                ))}
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  Register strategy
                </Button>
              </Row>
            </Row>
            <Card $pad={0} style={{ gap: 0 }}>
              {filteredStrategies.length === 0 ? (
                <div
                  style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: C.muted,
                    fontSize: 14
                  }}
                >
                  {strategies.length
                    ? 'No strategies with this status.'
                    : 'No strategies registered yet. Register one to publish it on the marketplace.'}
                </div>
              ) : (
                filteredStrategies.map(s => (
                  <StratRow key={s.id}>
                    <Col $gap={4}>
                      <Row $gap={8} $wrap>
                        <span
                          className="num"
                          style={{ fontWeight: 600, fontSize: 15 }}
                        >
                          {s.name}
                        </span>
                        <Badge
                          $tone={
                            s.status === 'ACTIVE'
                              ? 'success'
                              : s.status === 'PAUSED'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {s.status[0] + s.status.slice(1).toLowerCase()}
                        </Badge>
                      </Row>
                      <Row $gap={8}>
                        <span style={{ fontSize: 12, color: C.primaryText }}>
                          {TYPE_LABEL[s.strategyType] ?? s.strategyType}
                        </span>
                        <RiskTag $risk={s.riskLevel}>
                          {(RISK_STYLE[s.riskLevel] ?? RISK_STYLE.MEDIUM).label}
                        </RiskTag>
                      </Row>
                    </Col>
                    <Col $gap={2}>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        ROI 30d
                      </span>
                      <Num style={{ color: roiColor(s.roi30d) }}>
                        {fmtPct(s.roi30d)}
                      </Num>
                    </Col>
                    <Col $gap={2}>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        Followers
                      </span>
                      <Num>{fmtCount(s.followersCount)}</Num>
                    </Col>
                    <Row $gap={8}>
                      {s.status !== 'ARCHIVED' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={toggling.has(s.id)}
                          onClick={() => toggleStrategy(s)}
                          style={{ flex: 1 }}
                        >
                          {toggling.has(s.id) ? (
                            <Spinner $size={12} />
                          ) : s.status === 'ACTIVE' ? (
                            'Pause'
                          ) : (
                            'Resume'
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/strategies/${s.id}`)}
                        style={{ flex: 1 }}
                      >
                        View
                      </Button>
                    </Row>
                  </StratRow>
                ))
              )}
            </Card>
          </Col>
        </>
      )}

      <Bottom>
        <Pane>
          <PaneTitle>New to agents?</PaneTitle>
          <PaneText>
            Pair your bot with Lunex via the MCP SDK. One-time setup, fully
            on-chain. Define the pair, cadence and risk limits, then sign once.
          </PaneText>
          <Button
            style={{ height: 42, borderRadius: 12 }}
            onClick={() => navigate('/agents/get-started')}
          >
            Get started guide
          </Button>
        </Pane>
        <Pane>
          <PaneTitle>
            {agent ? 'Connected API key' : 'Already have a key?'}
          </PaneTitle>
          {agent ? (
            <>
              <PaneText>
                Agent <span className="num">{short(agent.id, 8, 4)}</span> is
                loaded. The key stays in this tab only and is cleared on reload.
              </PaneText>
              <Button
                variant="secondary"
                style={{ height: 42, borderRadius: 12 }}
                onClick={forgetKey}
              >
                Use another key
              </Button>
            </>
          ) : (
            <>
              <Row $gap={8}>
                <KeyInput
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && registerKey()}
                  placeholder="lnx_live_…"
                  aria-label="API key"
                  autoComplete="off"
                />
                <Button
                  variant="secondary"
                  style={{ height: 42, borderRadius: 12 }}
                  disabled={loadingAgent}
                  onClick={registerKey}
                >
                  {loadingAgent ? <Spinner $size={14} /> : 'Register'}
                </Button>
              </Row>
              <span style={{ fontSize: 12, color: C.muted }}>
                Keys can only trade within the limits you sign. They can never
                withdraw.
              </span>
            </>
          )}
        </Pane>
      </Bottom>
    </Page>
  )
}

export default AgentDashboard
