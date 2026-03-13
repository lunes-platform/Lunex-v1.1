import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import strategyService, { Strategy } from '../../services/strategyService'
import CreateStrategyModal from '../strategies/CreateStrategyModal'

// ─── Styled ──────────────────────────────────────────────────────

const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding: 84px 24px 64px;
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const Header = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #6C38FF, #AD87FF);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const Subtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8A8A8E;
  margin: 0;
  max-width: 560px;
  margin: 0 auto;
  line-height: 1.6;
`

const ApiKeySection = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 18px;
  padding: 22px 24px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`

const ApiKeyLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #8A8A8E;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
`

const ApiKeyInput = styled.input`
  flex: 1;
  min-width: 220px;
  background: #141414;
  border: 1px solid #2A2A2C;
  border-radius: 10px;
  padding: 10px 14px;
  color: #CCCCCC;
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  outline: none;
  color-scheme: dark;
  -webkit-appearance: none;
  &:focus { border-color: #7461FF; }
  &::placeholder { color: #555; }
  &:-webkit-autofill,
  &:-webkit-autofill:hover,
  &:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0 30px #141414 inset !important;
    -webkit-text-fill-color: #CCCCCC !important;
    border-color: #2A2A2C;
    transition: background-color 5000s ease-in-out 0s;
  }
`

const LoadBtn = styled.button`
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid #7461FF;
  background: rgba(116,97,255,0.1);
  color: #9983FF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover { background: rgba(116,97,255,0.2); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`

const TabRow = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 1px solid #2A2A2C;
  padding-bottom: 2px;
`

const Tab = styled.button<{ active?: boolean }>`
  background: none;
  border: none;
  border-bottom: 2px solid ${({ active }) => active ? '#7461FF' : 'transparent'};
  color: ${({ active }) => active ? '#FFFFFF' : '#8A8A8E'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: ${({ active }) => active ? 600 : 400};
  padding: 8px 16px 10px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: -1px;
  &:hover { color: #CCCCCC; }
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`

const SectionTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #8A8A8E;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`

const CreateBtn = styled.button`
  padding: 9px 18px;
  border-radius: 10px;
  border: 1px solid rgba(116,97,255,0.4);
  background: rgba(116,97,255,0.1);
  color: #9983FF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: rgba(116,97,255,0.2); }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`

const Card = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover { border-color: #3A3A3E; }
`

const CardName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #FFFFFF;
  margin-bottom: 8px;
`

const ChipRow = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
`

const Chip = styled.span<{ color?: string }>`
  padding: 2px 9px;
  border-radius: 20px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${({ color }) => color ?? '#8A8A8E'};
  background: ${({ color }) => color ? color + '18' : 'rgba(255,255,255,0.06)'};
  border: 1px solid ${({ color }) => color ? color + '33' : '#2A2A2C'};
`

const StatsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: #2A2A2C;
  border: 1px solid #2A2A2C;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
`

const Stat = styled.div`
  background: #1E1E1E;
  padding: 10px;
  text-align: center;
`

const StatVal = styled.div<{ positive?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: ${({ positive }) =>
    positive === undefined ? '#FFFFFF' : positive ? '#26D07C' : '#FF4D4D'};
`

const StatLbl = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  color: #8A8A8E;
  margin-top: 2px;
`

const ManageRow = styled.div`
  display: flex;
  gap: 8px;
`

const ManageBtn = styled.button<{ danger?: boolean }>`
  flex: 1;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid ${({ danger }) => danger ? 'rgba(255,77,77,0.3)' : '#2A2A2C'};
  background: ${({ danger }) => danger ? 'rgba(255,77,77,0.06)' : 'transparent'};
  color: ${({ danger }) => danger ? '#FF6B6B' : '#8A8A8E'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${({ danger }) => danger ? '#FF4D4D' : '#555'};
    color: ${({ danger }) => danger ? '#FF4D4D' : '#CCCCCC'};
  }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`

const EmptyState = styled.div`
  grid-column: 1 / -1;
  text-align: center;
  padding: 64px 24px;
  font-family: 'Space Grotesk', sans-serif;
  color: #8A8A8E;
  font-size: 14px;
`

const ErrorBanner = styled.div`
  background: rgba(255, 77, 77, 0.1);
  border: 1px solid rgba(255, 77, 77, 0.3);
  border-radius: 10px;
  padding: 10px 14px;
  color: #FF6B6B;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  margin-bottom: 20px;
`

const Skeleton = styled.div`
  background: linear-gradient(90deg, #232323 25%, #2a2a2a 50%, #232323 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 16px;
  height: 180px;
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`

// ─── Onboarding Empty State ────────────────────────────────────
const OnboardingHub = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 0;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`
const OnboardCard = styled.div<{ accent?: string }>`
  background: #1E1E1E;
  border: 1px solid ${({ accent }) => accent ? accent + '30' : '#2A2A2C'};
  border-radius: 20px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.2s;
  &:hover { border-color: ${({ accent }) => accent ? accent + '60' : '#3A3A3E'}; }
`
const OnboardCardIcon = styled.div<{ bg: string }>`
  width: 48px; height: 48px;
  border-radius: 14px;
  background: ${({ bg }) => bg};
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
`
const OnboardCardTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #FFF;
`
const OnboardCardDesc = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8A8A8E;
  line-height: 1.6;
  flex: 1;
`
const OnboardPrimaryBtn = styled.button`
  padding: 12px 0;
  border-radius: 12px;
  border: none;
  background: #6C38FF;
  color: #FFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  &:hover { opacity: 0.88; }
`
const OnboardSecondaryBtn = styled.button`
  padding: 12px 0;
  border-radius: 12px;
  border: 1px solid #2A2A2C;
  background: transparent;
  color: #8A8A8E;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: #7461FF; color: #AD87FF; }
`
const CodeSnippet = styled.pre`
  background: #111;
  border: 1px solid #2A2A2C;
  border-radius: 10px;
  padding: 12px 14px;
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: #AD87FF;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 4px 0 0;
  line-height: 1.5;
`
const ConnectTip = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(38,208,124,0.06);
  border: 1px solid rgba(38,208,124,0.15);
  border-radius: 10px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #26D07C;
  line-height: 1.5;
`

const RISK_COLORS: Record<string, string> = {
  LOW: '#26D07C', MEDIUM: '#FE923F', HIGH: '#FF6B6B', AGGRESSIVE: '#FF4D4D',
}
const TYPE_COLORS: Record<string, string> = {
  COPYTRADE: '#26D07C', MARKET_MAKER: '#FE923F', ARBITRAGE: '#7461FF',
  MOMENTUM: '#4DACFF', HEDGE: '#B0B0B0', CUSTOM: '#8A8A8E',
}

function fmtRoi(v: number) {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}

// ─── Execution Log Table ─────────────────────────────────────────

const Table = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  overflow: hidden;
`

const THead = styled.div`
  display: grid;
  grid-template-columns: 100px 80px 90px 110px 110px 90px 1fr;
  padding: 10px 16px;
  border-bottom: 1px solid #2A2A2C;
  background: #1A1A1A;
`

const TRow = styled.div`
  display: grid;
  grid-template-columns: 100px 80px 90px 110px 110px 90px 1fr;
  padding: 10px 16px;
  border-bottom: 1px solid #1A1A1A;
  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255,255,255,0.02); }
`

const TH = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`

const TD = styled.div<{ color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: ${({ color }) => color ?? '#CCCCCC'};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
`

const StatusPill = styled.span<{ status: string }>`
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  text-transform: uppercase;
  background: ${({ status }) =>
    status === 'EXECUTED' ? 'rgba(38,208,124,0.12)' :
    status === 'REJECTED' ? 'rgba(255,77,77,0.12)' :
    status === 'PENDING'  ? 'rgba(254,146,63,0.12)' :
    'rgba(255,255,255,0.06)'};
  color: ${({ status }) =>
    status === 'EXECUTED' ? '#26D07C' :
    status === 'REJECTED' ? '#FF4D4D' :
    status === 'PENDING'  ? '#FE923F' :
    '#8A8A8E'};
`

interface ExecLog {
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

interface ExecutionLogTabProps {
  apiKey: string
  agentId: string | null
}

const ExecutionLogTab: React.FC<ExecutionLogTabProps> = ({ apiKey, agentId }) => {
  const [logs, setLogs]         = useState<ExecLog[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    if (!apiKey || !agentId) return
    setLoading(true)
    setError(null)
    try {
      const qs = statusFilter ? `?status=${statusFilter}&limit=50` : '?limit=50'
      const res = await fetch(
        `${process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'}/api/v1/execution/history${qs}`,
        { headers: { 'X-API-Key': apiKey } },
      )
      if (!res.ok) throw new Error('Failed to load execution history')
      const data = await res.json()
      setLogs(data.logs ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiKey, agentId, statusFilter])

  useEffect(() => { load() }, [load])

  if (!agentId) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px', fontFamily: 'Space Grotesk', color: '#8A8A8E', fontSize: 14 }}>
        Enter your Agent API key above to view execution history.
      </div>
    )
  }

  return (
    <div>
      <SectionHeader>
        <SectionTitle>Execution Log</SectionTitle>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              background: '#141414', border: '1px solid #2A2A2C', borderRadius: 8,
              padding: '6px 10px', color: '#CCCCCC', fontFamily: 'Space Grotesk',
              fontSize: 12, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Statuses</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
          </select>
          <LoadBtn onClick={load} disabled={loading} style={{ padding: '6px 14px', fontSize: 12 }}>
            {loading ? '…' : 'Refresh'}
          </LoadBtn>
        </div>
      </SectionHeader>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <Skeleton style={{ height: 240 }} />
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', fontFamily: 'Space Grotesk', color: '#8A8A8E', fontSize: 14 }}>
          No execution logs found.
        </div>
      ) : (
        <Table>
          <THead>
            <TH>Pair</TH>
            <TH>Side</TH>
            <TH>Type</TH>
            <TH>Amount</TH>
            <TH>Price</TH>
            <TH>Status</TH>
            <TH>Reason / Time</TH>
          </THead>
          {logs.map((log) => (
            <TRow key={log.id}>
              <TD>{log.pairSymbol}</TD>
              <TD color={log.side === 'BUY' ? '#26D07C' : '#FF6B6B'}>{log.side}</TD>
              <TD color="#8A8A8E">{log.orderType}</TD>
              <TD>{Number(log.requestedAmount).toFixed(4)}</TD>
              <TD>{log.price ? Number(log.price).toFixed(6) : '—'}</TD>
              <TD><StatusPill status={log.status}>{log.status}</StatusPill></TD>
              <TD color="#555">
                {log.rejectionReason
                  ? <span title={log.rejectionReason} style={{ color: '#FF6B6B' }}>{log.rejectionReason.slice(0, 32)}{log.rejectionReason.length > 32 ? '…' : ''}</span>
                  : new Date(log.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                }
              </TD>
            </TRow>
          ))}
        </Table>
      )}
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────

interface DailySummary {
  totalAttempts: number
  executed: number
  rejected: number
  successRate: number
  totalVolume: number
}

const SummaryBar = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: #2A2A2C;
  border: 1px solid #2A2A2C;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 24px;
`

const SummaryCell = styled.div`
  background: #1E1E1E;
  padding: 14px 16px;
  text-align: center;
`

const SumVal = styled.div<{ color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: ${({ color }) => color ?? '#FFFFFF'};
`

const SumLbl = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 3px;
`

const AgentDashboard: React.FC = () => {
  const navigate = useNavigate()
  const [apiKey, setApiKey]         = useState('')
  const [agentId, setAgentId]       = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [tab, setTab]               = useState<'strategies' | 'executions'>('strategies')
  const [showCreate, setShowCreate] = useState(false)
  const [pauseLoading, setPauseLoading] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>('ALL')
  const [summary, setSummary]       = useState<DailySummary | null>(null)

  const filteredStrategies = useMemo(
    () => strategies.filter((s) => statusFilter === 'ALL' || s.status === statusFilter),
    [strategies, statusFilter],
  )

  const loadAgentStrategies = useCallback(async (key: string) => {
    setLoading(true)
    setError(null)
    const base = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'
    try {
      const profile = await fetch(`${base}/api/v1/agents/me`, {
        headers: { 'X-API-Key': key },
      })
      if (!profile.ok) throw new Error('Invalid API key or agent not found')
      const { agent } = await profile.json()
      setAgentId(agent.id)
      const [{ strategies: list }, summaryRes] = await Promise.all([
        strategyService.listStrategies({ agentId: agent.id }, key),
        fetch(`${base}/api/v1/execution/daily-summary`, { headers: { 'X-API-Key': key } })
          .then((r) => r.ok ? r.json() : null).catch(() => null),
      ])
      setStrategies(list)
      if (summaryRes?.summary) setSummary(summaryRes.summary)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLoad = () => {
    if (apiKey.trim()) loadAgentStrategies(apiKey.trim())
  }

  const handleTogglePause = async (s: Strategy) => {
    if (!agentId) return
    setPauseLoading((prev) => new Set(prev).add(s.id))
    try {
      const newStatus = s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
      const res = await fetch(
        `${process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'}/api/v1/strategies/${s.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ status: newStatus }),
        },
      )
      if (!res.ok) throw new Error('Failed to update strategy')
      setStrategies((prev) => prev.map((x) => x.id === s.id ? { ...x, status: newStatus } : x))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPauseLoading((prev) => { const n = new Set(prev); n.delete(s.id); return n })
    }
  }

  return (
    <Page>
      {showCreate && (
        <CreateStrategyModal
          onClose={() => setShowCreate(false)}
          onCreated={(s) => setStrategies((prev) => [s, ...prev])}
          initialApiKey={apiKey}
        />
      )}

      <Container>
        <Header>
          <Title>
            <span>Agent Dashboard</span>
          </Title>
          <Subtitle>
            Manage your AI trading strategies, execution history, and risk parameters.
          </Subtitle>
        </Header>

        {/* ─── API Key Entry ─────────────────────────── */}
        <ApiKeySection>
          <div style={{ flex: '0 0 auto' }}>
            <ApiKeyLabel>Agent API Key</ApiKeyLabel>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: 12, color: '#555' }}>Enter your key to load your strategies</div>
          </div>
          <ApiKeyInput
            type="password"
            placeholder="lnx_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
          />
          <LoadBtn onClick={handleLoad} disabled={loading || !apiKey.trim()}>
            {loading ? 'Loading…' : 'Load Agent'}
          </LoadBtn>
          {agentId && (
            <div style={{ fontFamily: 'Space Grotesk', fontSize: 12, color: '#26D07C' }}>
              ✓ Agent loaded
            </div>
          )}
        </ApiKeySection>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {/* ─── Today's Execution Summary ─────────────── */}
        {summary && (
          <SummaryBar>
            <SummaryCell>
              <SumVal>{summary.totalAttempts}</SumVal>
              <SumLbl>Attempts Today</SumLbl>
            </SummaryCell>
            <SummaryCell>
              <SumVal color="#26D07C">{summary.executed}</SumVal>
              <SumLbl>Executed</SumLbl>
            </SummaryCell>
            <SummaryCell>
              <SumVal color={summary.rejected > 0 ? '#FF6B6B' : '#8A8A8E'}>{summary.rejected}</SumVal>
              <SumLbl>Rejected</SumLbl>
            </SummaryCell>
            <SummaryCell>
              <SumVal color={summary.successRate >= 0.9 ? '#26D07C' : summary.successRate >= 0.7 ? '#FE923F' : '#FF4D4D'}>
                {(summary.successRate * 100).toFixed(0)}%
              </SumVal>
              <SumLbl>Success Rate</SumLbl>
            </SummaryCell>
            <SummaryCell>
              <SumVal>${Number(summary.totalVolume).toLocaleString('en-US', { maximumFractionDigits: 0 })}</SumVal>
              <SumLbl>Volume Today</SumLbl>
            </SummaryCell>
          </SummaryBar>
        )}

        {/* ─── Tabs ──────────────────────────────────── */}
        <TabRow>
          <Tab active={tab === 'strategies'} onClick={() => setTab('strategies')}>
            My Strategies ({strategies.length})
          </Tab>
          <Tab active={tab === 'executions'} onClick={() => setTab('executions')}>
            Execution Log
          </Tab>
        </TabRow>

        {/* ─── My Strategies ─────────────────────────── */}
        {tab === 'strategies' && (
          <>
            <SectionHeader>
              <SectionTitle>Registered Strategies</SectionTitle>
              <CreateBtn onClick={() => setShowCreate(true)}>+ New Strategy</CreateBtn>
            </SectionHeader>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                    fontFamily: 'Space Grotesk, sans-serif', cursor: 'pointer',
                    border: `1px solid ${statusFilter === s ? '#7461FF' : '#2A2A2C'}`,
                    background: statusFilter === s ? 'rgba(116,97,255,0.12)' : 'transparent',
                    color: statusFilter === s ? '#7461FF' : '#8A8A8E',
                    transition: 'all 0.15s',
                  }}
                >{s}</button>
              ))}
            </div>

            {loading ? (
              <Grid>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)}</Grid>
            ) : (
              <Grid>
                {filteredStrategies.length === 0 ? (
                  !agentId ? (
                    // ─ Not yet loaded: show onboarding hub
                    <OnboardingHub style={{ gridColumn: '1 / -1' }}>
                      <OnboardCard accent="#6C38FF">
                        <OnboardCardIcon bg="rgba(108,56,255,0.12)">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6C38FF" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="3"/><path d="M7 21v-1a5 5 0 0 1 10 0v1"/></svg>
                        </OnboardCardIcon>
                        <OnboardCardTitle>New to Agents?</OnboardCardTitle>
                        <OnboardCardDesc>
                          Agents are trading entities on Lunex. Connect a human wallet, AI model, OpenClaw bot, or algo strategy — and earn from followers.
                        </OnboardCardDesc>
                        <OnboardPrimaryBtn onClick={() => navigate('/agents/get-started')}>Get Started Guide &#8594;</OnboardPrimaryBtn>
                      </OnboardCard>

                      <OnboardCard accent="#4DACFF">
                        <OnboardCardIcon bg="rgba(77,172,255,0.12)">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4DACFF" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                        </OnboardCardIcon>
                        <OnboardCardTitle>Already have a key?</OnboardCardTitle>
                        <OnboardCardDesc>
                          Paste your <code style={{ color:'#AD87FF', fontFamily:'Space Mono' }}>lnx_...</code> API key above to load your registered strategies and execution history.
                        </OnboardCardDesc>
                        <ConnectTip>
                          <span>API keys start with <strong>lnx_</strong> and are generated from the Agent API Key section once you register.</span>
                        </ConnectTip>
                        <CodeSnippet>{`curl -X GET /api/v1/agents/me \\
  -H "X-API-Key: lnx_..."`}</CodeSnippet>
                      </OnboardCard>
                    </OnboardingHub>
                  ) : (
                    // ─ Loaded but no strategies
                    <EmptyState style={{ gridColumn: '1 / -1' }}>
                      No strategies registered yet.
                      <br />
                      <button
                        onClick={() => setShowCreate(true)}
                        style={{ marginTop: 14, padding: '10px 24px', borderRadius: 10, border: 'none', background: '#6C38FF', color: '#FFF', fontFamily: 'Space Grotesk', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >+ Create First Strategy</button>
                    </EmptyState>
                  )
                ) : filteredStrategies.map((s) => (
                  <Card key={s.id} onClick={() => navigate(`/strategies/${s.id}`)}>
                    <CardName>{s.name}</CardName>
                    <ChipRow>
                      <Chip color={TYPE_COLORS[s.strategyType]}>{s.strategyType.replace('_', ' ')}</Chip>
                      <Chip color={RISK_COLORS[s.riskLevel]}>{s.riskLevel}</Chip>
                      <Chip color={s.status === 'ACTIVE' ? '#26D07C' : s.status === 'PAUSED' ? '#FE923F' : '#8A8A8E'}>
                        {s.status}
                      </Chip>
                    </ChipRow>

                    <StatsRow>
                      <Stat>
                        <StatVal positive={s.roi30d >= 0}>{fmtRoi(s.roi30d)}</StatVal>
                        <StatLbl>30d ROI</StatLbl>
                      </Stat>
                      <Stat>
                        <StatVal>{s.followersCount.toLocaleString()}</StatVal>
                        <StatLbl>Followers</StatLbl>
                      </Stat>
                      <Stat>
                        <StatVal>{s.totalTrades.toLocaleString()}</StatVal>
                        <StatLbl>Trades</StatLbl>
                      </Stat>
                    </StatsRow>

                    <ManageRow onClick={(e) => e.stopPropagation()}>
                      <ManageBtn
                        disabled={pauseLoading.has(s.id) || !agentId}
                        onClick={() => handleTogglePause(s)}
                        danger={s.status === 'ACTIVE'}
                      >
                        {pauseLoading.has(s.id)
                          ? '…'
                          : s.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                      </ManageBtn>
                      <ManageBtn onClick={() => navigate(`/strategies/${s.id}`)}>
                        View
                      </ManageBtn>
                    </ManageRow>
                  </Card>
                ))}
              </Grid>
            )}
          </>
        )}

        {/* ─── Execution Log ─────────────────────────── */}
        {tab === 'executions' && (
          <ExecutionLogTab apiKey={apiKey} agentId={agentId} />
        )}
      </Container>
    </Page>
  )
}

export default AgentDashboard
