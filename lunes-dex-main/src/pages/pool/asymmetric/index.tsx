import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import {
  C,
  Page,
  H1,
  Sub,
  Button,
  LinkButton,
  Badge,
  Notice,
  SkeletonLine,
  grotesk,
  tabular
} from '../../../components/ui/kit'
import CurveChart, {
  CurveSide,
  GAMMA_LABELS
} from '../../../components/asymmetric/CurveChart'
import StrategyCards, {
  PRESETS,
  Preset,
  PresetId
} from '../../../components/asymmetric/StrategyCards'
import {
  ApiKeyDialog,
  DEFAULT_GUARDRAILS,
  DelegationCard,
  Guardrails,
  enforceDelegation,
  useAiAgents
} from '../../../components/asymmetric/AgentDelegationPanel'
import { useSDK } from '../../../context/SDKContext'
import { useTx } from '../../../context/TxContext'
import { useAsymmetricDeploy } from '../../../hooks/useAsymmetricDeploy'
import { usePools } from '../../../hooks/usePools'
import {
  AsymmetricClient,
  RebalanceLog,
  StrategyStatus
} from '../../../sdk/AsymmetricClient'
import {
  ReadSessionRequiredError,
  requireReadAuth
} from '../../../services/sessionService'
import { useReadSession } from '../../../hooks/useReadSession'
import { ReadSessionPrompt } from '../../../components/session/ReadSessionPrompt'
import { openWalletModal } from '../../header/modals/wallets'
import { fmt, usd } from '../format'

// ─── Config ───────────────────────────────────────────────────────

const BASE_TOKEN = process.env.REACT_APP_TOKEN_WLUNES || ''
const QUOTE_TOKEN = process.env.REACT_APP_TOKEN_LUSDT || ''
const PAIR_LABEL = 'WLUNES/LUSDT'

const ASYMMETRIC_API_BASE = (() => {
  const base =
    process.env.REACT_APP_SPOT_API_URL || process.env.REACT_APP_API_URL
  if (!base) return '/api/v1/asymmetric'
  return `${base.replace(/\/$/, '')}/api/v1/asymmetric`
})()

const DEFAULT = PRESETS[0]

// ─── Styled ───────────────────────────────────────────────────────

const Back = styled(LinkButton)`
  align-self: flex-start;
  color: ${C.muted};
  font-size: 14px;
  font-weight: 500;
  padding: 4px 0;
  &:hover {
    color: #fff;
  }
`

const Split = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

const Controls = styled.div`
  flex: 1 1 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Card = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.surface};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`

const CardTitle = styled.span<{ $color?: string }>`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
  color: ${p => p.$color ?? '#fff'};
`

const Ctl = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  > div:first-child {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    span:first-child {
      color: ${C.muted};
    }
    span:last-child {
      font-weight: 600;
      ${tabular};
    }
  }
  input[type='range'] {
    width: 100%;
    accent-color: ${C.primary};
  }
`

const GammaBtn = styled.button<{ $on: boolean }>`
  flex: 1;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: ${p => (p.$on ? C.primary : C.field)};
  color: #fff;
  font-size: 12px;
  font-weight: 600;
`

const SumRow = styled.div<{ $first: boolean }>`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-top: ${p => (p.$first ? 'none' : `1px solid ${C.border}`)};
  font-size: 13px;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    ${tabular};
  }
`

const StatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 8px;
`

const Cell = styled.div`
  padding: 10px 12px;
  border-radius: 12px;
  background: ${C.bg};
  border: 1px solid ${C.border};
  min-width: 0;
  small {
    display: block;
    font-size: 11px;
    color: ${C.muted};
    margin-bottom: 4px;
  }
  span {
    font-size: 13px;
    font-weight: 600;
    word-break: break-all;
    ${tabular};
  }
`

const Select = styled.select`
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  background: ${C.bg};
  color: #fff;
  font-size: 13px;
  min-width: 0;
  flex: 1;
`

const Log = styled.div`
  padding: 10px 12px;
  border-radius: 12px;
  background: ${C.bg};
  border: 1px solid ${C.border};
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  b {
    font-size: 13px;
  }
  code {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 11px;
    color: ${C.muted};
    word-break: break-word;
  }
`

// ─── Page ─────────────────────────────────────────────────────────

type SideKey = 'buy' | 'sell'

const AsymmetricPool: React.FC = () => {
  const navigate = useNavigate()
  const tx = useTx()
  const { isConnected, walletAddress, signMessage } = useSDK()
  const { createDeployment } = useAsymmetricDeploy()
  const { prices } = usePools()
  const agents = useAiAgents()
  const client = useMemo(() => new AsymmetricClient(ASYMMETRIC_API_BASE), [])

  const [preset, setPreset] = useState<PresetId | null>(DEFAULT.id)
  const [buy, setBuy] = useState<CurveSide>({ ...DEFAULT.buy })
  const [sell, setSell] = useState<CurveSide>({ ...DEFAULT.sell })
  const [delegate, setDelegate] = useState(false)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [guardrails, setGuardrails] = useState<Guardrails>(DEFAULT_GUARDRAILS)
  const [apiKey, setApiKey] = useState<string | null>(null)

  // Your strategies (backend + on-chain status)
  const [strategies, setStrategies] = useState<StrategyStatus[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<StrategyStatus | null>(null)
  const [logs, setLogs] = useState<RebalanceLog[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentId && agents.length) setAgentId(agents[0].id)
  }, [agents, agentId])

  const activePreset: Preset | undefined = PRESETS.find(p => p.id === preset)
  const feeBps = activePreset?.feeBps ?? 30
  const agentName = agents.find(a => a.id === agentId)?.name ?? 'AI agent'
  const capital = buy.x0 + sell.x0

  const setSide = (side: SideKey, patch: Partial<CurveSide>) => {
    setPreset(null)
    if (side === 'buy') setBuy(c => ({ ...c, ...patch }))
    else setSell(c => ({ ...c, ...patch }))
  }

  const pickPreset = (p: Preset) => {
    setPreset(p.id)
    setBuy({ ...p.buy })
    setSell({ ...p.sell })
  }

  // ── Private reads of the wallet's strategies (read session) ───
  // No wallet prompt: without a session the panel shows "Sign in".
  const { hasSession } = useReadSession()
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const loadStrategies = useCallback(
    async (prefer?: string | null) => {
      if (!walletAddress) return
      setListLoading(true)
      setStatusError(null)
      try {
        const auth = requireReadAuth(walletAddress)
        setNeedsSignIn(false)
        const list = await client.listStrategies(walletAddress, auth)
        setStrategies(list)
        const next =
          (prefer && list.find(s => s.id === prefer)?.id) ||
          (list.some(s => s.id === selectedId) ? selectedId : list[0]?.id) ||
          ''
        setSelectedId(next)
      } catch (err: unknown) {
        if (err instanceof ReadSessionRequiredError) {
          setNeedsSignIn(true)
          return
        }
        setStatusError(
          err instanceof Error ? err.message : 'Failed to list strategies'
        )
      } finally {
        setListLoading(false)
      }
    },
    [walletAddress, client, selectedId]
  )

  const loadDetails = useCallback(
    async (id: string) => {
      if (!walletAddress || !id) return
      setStatusLoading(true)
      setStatusError(null)
      try {
        const auth = requireReadAuth(walletAddress)
        const [s, l] = await Promise.all([
          client.getStrategyStatus(id, walletAddress, auth),
          client.getRebalanceLogs(id, walletAddress, auth, 10)
        ])
        setStatus(s)
        setLogs(l)
      } catch (err: unknown) {
        if (err instanceof ReadSessionRequiredError) {
          setNeedsSignIn(true)
          return
        }
        setStatusError(
          err instanceof Error ? err.message : 'Failed to load strategy status'
        )
      } finally {
        setStatusLoading(false)
      }
    },
    [walletAddress, client]
  )

  useEffect(() => {
    if (selectedId && strategies) void loadDetails(selectedId)
    else setStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    setStrategies(null)
    setSelectedId('')
    setStatus(null)
  }, [walletAddress])

  // ── Deploy (4-step tx) ────────────────────────────────────────
  const deploy = () => {
    if (!walletAddress) return
    const b = { ...buy }
    const s = { ...sell }
    const d = delegate
    const rails = { ...guardrails }
    const dep = createDeployment({
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      buyGamma: b.g,
      buyMaxCapacity: String(b.x0),
      buyFeeBps: feeBps,
      sellGamma: s.g,
      sellMaxCapacity: String(s.x0),
      sellFeeBps: feeBps,
      initialBuyK: String(b.k),
      // Deploy exactly the k shown in the preview (halving was removed in 628d44b).
      initialSellK: String(s.k),
      pairSymbol: 'WLUNES-LUSDT',
      autoRebalance: true,
      profitTargetBps: activePreset?.profitTargetBps ?? 300
    })
    let key: string | null = null

    tx.run({
      type: 'liquidity',
      title: 'Deploying strategy',
      summary: `${PAIR_LABEL} · buy γ${b.g} / sell γ${s.g}`,
      actTitle: `Deploy asymmetric · ${PAIR_LABEL}`,
      successTitle: 'Strategy deployed',
      steps: [
        {
          label: 'Sign contract deployment',
          wallet: true,
          run: () => dep.instantiate()
        },
        {
          label: 'Seed buy & sell curves',
          wallet: true,
          run: () => dep.seed()
        },
        {
          label: 'Sign strategy registration' + (d ? ' + delegation' : ''),
          wallet: true,
          run: async ({ advance }) => {
            const r = await dep.register()
            if (d) {
              if (!r.strategyId || !r.contractAddress) {
                throw new Error('Strategy registered without an ID')
              }
              const res = await enforceDelegation({
                walletAddress,
                signMessage,
                strategyId: r.strategyId,
                pairAddress: r.contractAddress,
                guardrails: rails
              })
              key = res.apiKey
            }
            advance()
            return r.txHash ?? undefined
          }
        },
        { label: 'Waiting for block confirmation' }
      ],
      onSuccess: () => {
        if (key) setApiKey(key)
        const id = dep.result().strategyId
        if (strategies) void loadStrategies(id)
      }
    })
  }

  // Delegate an already-deployed strategy
  const delegateExisting = (s: StrategyStatus) => {
    if (!walletAddress) return
    const rails = { ...guardrails }
    let key: string | null = null
    tx.run({
      type: 'liquidity',
      title: 'Delegating strategy',
      summary: `${agentName} · γ${rails.gammaMin}–γ${rails.gammaMax}`,
      actTitle: `Delegate strategy · ${PAIR_LABEL}`,
      successTitle: 'Delegation enforced on-chain',
      steps: [
        {
          label: 'Sign agent key + set manager',
          wallet: true,
          run: async () => {
            const res = await enforceDelegation({
              walletAddress,
              signMessage,
              strategyId: s.id,
              pairAddress: s.pairAddress,
              guardrails: rails
            })
            key = res.apiKey
            return res.txHash
          }
        },
        { label: 'Waiting for block confirmation' }
      ],
      onSuccess: () => {
        if (key) setApiKey(key)
        void loadDetails(s.id)
      }
    })
  }

  const ctl = (side: SideKey, c: CurveSide) => (
    <Card key={side}>
      <CardTitle $color={side === 'buy' ? C.successText : C.criticalText2}>
        {side === 'buy' ? 'Buy curve' : 'Sell curve'}
      </CardTitle>
      <Ctl>
        <div>
          <span>Base liquidity (k)</span>
          <span>{fmt(c.k)} LUSDT</span>
        </div>
        <input
          type="range"
          min={100}
          max={5000}
          step={100}
          value={c.k}
          onChange={e => setSide(side, { k: +e.target.value })}
          aria-label={`${side} base liquidity`}
        />
      </Ctl>
      <Ctl>
        <div>
          <span>Max capacity</span>
          <span>{fmt(c.x0)} LUSDT</span>
        </div>
        <input
          type="range"
          min={1000}
          max={50000}
          step={1000}
          value={c.x0}
          onChange={e => setSide(side, { x0: +e.target.value })}
          aria-label={`${side} max capacity`}
        />
      </Ctl>
      <Ctl>
        <span style={{ fontSize: 13, color: C.muted }}>
          Curvature · {GAMMA_LABELS[c.g]}
        </span>
        <div style={{ display: 'flex', gap: 4 }} role="radiogroup">
          {[1, 2, 3, 4, 5].map(g => (
            <GammaBtn
              key={g}
              role="radio"
              aria-checked={c.g === g}
              aria-label={`γ${g} ${GAMMA_LABELS[g]}`}
              $on={c.g === g}
              onClick={() => setSide(side, { g })}
            >
              γ{g}
            </GammaBtn>
          ))}
        </div>
      </Ctl>
    </Card>
  )

  const summary: [string, string, string?][] = [
    ['Pair', 'WLUNES / LUSDT'],
    [
      'Buy curve',
      `k ${fmt(buy.k)} · cap ${fmt(buy.x0)} · γ${buy.g} ${GAMMA_LABELS[buy.g]}`,
      C.successText
    ],
    [
      'Sell curve',
      `k ${fmt(sell.k)} · cap ${fmt(sell.x0)} · γ${sell.g} ${GAMMA_LABELS[sell.g]}`,
      C.criticalText2
    ],
    ['Fee target', (feeBps / 100).toFixed(2) + '%'],
    ['Capital range', usd(capital)],
    [
      'Management',
      delegate
        ? `Delegated to ${agentName} · γ${guardrails.gammaMin}–γ${guardrails.gammaMax}`
        : 'Manual'
    ]
  ]

  let cta: { label: string; ok: boolean; on?: () => void }
  if (!isConnected || !walletAddress)
    cta = { label: 'Connect wallet', ok: true, on: openWalletModal }
  else if (!BASE_TOKEN || !QUOTE_TOKEN)
    cta = { label: 'Pair tokens not configured', ok: false }
  else if (delegate && !agentId) cta = { label: 'Pick an AI agent', ok: false }
  else cta = { label: 'Deploy asymmetric strategy', ok: true, on: deploy }

  const live = status?.liveState
  const cfg = status?.persistedConfig || status
  const deleg = status?.delegation || {
    agentManaged: status?.agentManaged ?? false,
    delegatedToRelayer: live?.delegatedToRelayer ?? false,
    managerAddress: live?.managerAddress ?? null,
    relayerAddress: live?.relayerAddress ?? null
  }

  return (
    <Page $max={1080} style={{ gap: 16 }}>
      <Back onClick={() => navigate('/pool')}>
        <ArrowLeft size={16} strokeWidth={2} />
        Liquidity
      </Back>
      <div>
        <H1>Asymmetric liquidity · Pro mode</H1>
        <Sub style={{ fontSize: 15 }}>
          Deploy separate buy and sell curves inside the ranges you choose.
          Managed by you or delegated to an AI agent.
        </Sub>
      </div>

      <StrategyCards selected={preset} onSelect={pickPreset} />

      <Split>
        <CurveChart
          buy={buy}
          sell={sell}
          pairLabel={PAIR_LABEL}
          price={prices.WLUNES}
        />
        <Controls>
          {ctl('buy', buy)}
          {ctl('sell', sell)}
        </Controls>
      </Split>

      <DelegationCard
        enabled={delegate}
        onToggle={() => setDelegate(v => !v)}
        agents={agents}
        agentId={agentId}
        onAgent={setAgentId}
        guardrails={guardrails}
        onGuardrails={setGuardrails}
      />

      <Card style={{ gap: 2 }}>
        <CardTitle style={{ marginBottom: 6 }}>Deployment summary</CardTitle>
        {summary.map(([k, v, color], i) => (
          <SumRow key={k} $first={i === 0}>
            <span>{k}</span>
            <span style={{ color: color ?? '#fff' }}>{v}</span>
          </SumRow>
        ))}
      </Card>

      <Button
        size="xl"
        block
        disabled={!cta.ok}
        onClick={cta.on}
        style={{ height: 52 }}
      >
        {cta.label}
      </Button>

      {/* ── Your strategies (persisted config + live on-chain state) ── */}
      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <CardTitle>Your strategies</CardTitle>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Persisted config, live curve state and audit logs. Loading asks
              for a signature.
            </div>
          </div>
          {isConnected && walletAddress && (
            <Button
              variant="secondary"
              size="sm"
              disabled={listLoading}
              onClick={() => void loadStrategies()}
            >
              <RefreshCw size={14} />
              {strategies ? 'Refresh' : 'Load strategies'}
            </Button>
          )}
        </div>

        {!isConnected || !walletAddress ? (
          <span style={{ fontSize: 13, color: C.muted }}>
            Connect your wallet to see your deployed strategies.
          </span>
        ) : listLoading ? (
          <SkeletonLine $h={40} />
        ) : needsSignIn && !hasSession ? (
          <ReadSessionPrompt
            compact
            message="Sign in to see your deployed strategies"
            onSignedIn={() => void loadStrategies()}
          />
        ) : statusError ? (
          <Notice $tone="critical">{statusError}</Notice>
        ) : strategies && strategies.length === 0 ? (
          <span style={{ fontSize: 13, color: C.muted }}>
            No registered asymmetric strategy for this wallet yet.
          </span>
        ) : strategies && strategies.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                aria-label="Strategy"
              >
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </Select>
              <Badge
                $tone={
                  statusLoading
                    ? 'neutral'
                    : live?.available
                      ? 'success'
                      : 'warning'
                }
              >
                {statusLoading
                  ? 'Loading…'
                  : live?.available
                    ? 'Live'
                    : `Live unavailable${live?.reason ? ` (${live.reason})` : ''}`}
              </Badge>
            </div>
            {status && (
              <>
                <StatusGrid>
                  {(
                    [
                      ['Status', cfg?.status],
                      [
                        'Auto rebalance',
                        cfg?.isAutoRebalance ? 'Enabled' : 'Disabled'
                      ],
                      ['Pending amount', cfg?.pendingRebalanceAmount || '0'],
                      ['Retry count', String(cfg?.retryCount ?? 0)],
                      ['Agent managed', deleg.agentManaged ? 'Yes' : 'No'],
                      [
                        'Delegated to relayer',
                        deleg.delegatedToRelayer ? 'Yes' : 'No'
                      ],
                      ['Manager', deleg.managerAddress || 'Not configured'],
                      ['Relayer', deleg.relayerAddress || 'Unavailable'],
                      [
                        'Live buy capacity',
                        live?.buyCurve
                          ? `${live.buyCurve.currentVolume.toFixed(2)} / ${live.buyCurve.maxCapacity.toFixed(2)}`
                          : 'Unavailable'
                      ],
                      [
                        'Live sell capacity',
                        live?.sellCurve
                          ? `${live.sellCurve.currentVolume.toFixed(2)} / ${live.sellCurve.maxCapacity.toFixed(2)}`
                          : 'Unavailable'
                      ]
                    ] as [string, string | undefined][]
                  ).map(([k, v]) => (
                    <Cell key={k}>
                      <small>{k}</small>
                      <span>{v ?? '—'}</span>
                    </Cell>
                  ))}
                </StatusGrid>
                {!deleg.delegatedToRelayer && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => delegateExisting(status)}
                    >
                      Delegate with current guardrails
                    </Button>
                  </div>
                )}
                <CardTitle style={{ fontSize: 14 }}>
                  Recent audit logs
                </CardTitle>
                {logs.length === 0 ? (
                  <span style={{ fontSize: 13, color: C.muted }}>
                    No logs yet for this strategy.
                  </span>
                ) : (
                  logs.map(l => (
                    <Log key={l.id}>
                      <b>
                        {l.trigger} · {l.status} · {l.side}
                      </b>
                      <code>
                        acquired={l.acquiredAmount} newCapacity={l.newCapacity}{' '}
                        tx={l.txHash || 'n/a'} at {l.createdAt}
                      </code>
                    </Log>
                  ))
                )}
              </>
            )}
          </>
        ) : null}
      </Card>

      <ApiKeyDialog apiKey={apiKey} onClose={() => setApiKey(null)} />
    </Page>
  )
}

export default AsymmetricPool
