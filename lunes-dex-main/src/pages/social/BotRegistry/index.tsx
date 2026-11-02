import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Copy, KeyRound } from 'lucide-react'
import {
  Badge,
  Button,
  C,
  Card,
  H1,
  Input,
  Notice,
  Page,
  SkeletonLine,
  Sub,
  Textarea,
  grotesk,
  tabular
} from 'components/ui/kit'
import { useSDK } from '../../../context/SDKContext'
import { useTx } from '../../../context/TxContext'
import { useToast } from '../../../components/feedback/ToastProvider'
import agentService, { AgentProfile } from '../../../services/agentService'
import {
  buildAgentCreateApiKeySignMessage,
  buildAgentRegisterSignMessage,
  createSignedActionMetadata
} from '../../../utils/signing'
import { BackToSocial, DashedEmpty, fmtPct, initials } from '../shared'
import { getReadSessionToken } from '../../../services/sessionService'
import { useReadSession } from '../../../hooks/useReadSession'
import { requestWalletConnect } from 'pages/header/modals/wallets'

type AgentType = 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT'
type Perm = 'TRADE_SPOT' | 'TRADE_MARGIN' | 'COPYTRADE_SIGNAL' | 'READ_ONLY'

const TYPES: [AgentType, string][] = [
  ['AI_AGENT', 'AI Agent'],
  ['OPENCLAW_BOT', 'OpenClaw Bot'],
  ['ALGO_BOT', 'Algo Bot']
]

const PERMS: Perm[] = [
  'TRADE_SPOT',
  'TRADE_MARGIN',
  'COPYTRADE_SIGNAL',
  'READ_ONLY'
]

const typeLabel: Record<string, string> = {
  AI_AGENT: 'AI Agent',
  OPENCLAW_BOT: 'OpenClaw Bot',
  ALGO_BOT: 'Algo Bot',
  HUMAN: 'Human'
}

const tierName: Record<number, string> = {
  0: 'Free',
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold'
}

const Layout = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
`

const ListCol = styled.div`
  flex: 1.5 1 380px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`

const List = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
  > * + * {
    border-top: 1px solid ${C.border};
  }
`

const BotRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 14px 16px;
`

const BotIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: ${C.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
`

const BotName = styled.div`
  flex: 1 1 160px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  > span:first-child {
    ${grotesk};
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  > span:last-child {
    font-size: 12px;
    color: ${C.muted};
  }
`

const Mono = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: ${C.primaryText2};
  ${tabular};
`

const FormCard = styled(Card)`
  flex: 1 1 300px;
  padding: 18px;
  gap: 12px;
`

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: ${C.muted};
`

const ChipGroup = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const Pill = styled.button<{ $on: boolean }>`
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => (p.$on ? C.primary : C.borderStrong)};
  background: ${p => (p.$on ? 'rgba(108,56,255,0.16)' : 'transparent')};
  color: ${p => (p.$on ? C.primaryText2 : C.secondary)};
  font-size: 13px;
  font-weight: 600;
  &:hover {
    color: #fff;
  }
`

const KeyBox = styled.pre`
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: ${C.terminal};
  border: 1px solid ${C.border};
  color: ${C.primaryText2};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
`

const agentName = (a: AgentProfile) =>
  a.leader?.name || `Agent ${a.id.slice(0, 8)}`

const AgentRow: React.FC<{ a: AgentProfile; mine?: boolean }> = ({
  a,
  mine
}) => (
  <BotRow>
    <BotIcon aria-hidden="true">{initials(agentName(a)) || 'AI'}</BotIcon>
    <BotName>
      <span>
        {agentName(a)}
        {mine ? ' · you' : ''}
      </span>
      <span>
        {typeLabel[a.agentType] ?? a.agentType} · {a.framework || 'Custom'} ·{' '}
        {tierName[a.stakingTier] ?? `Tier ${a.stakingTier}`}
      </span>
    </BotName>
    <Mono>
      ROI {fmtPct(a.roi)} · Sharpe {a.sharpe ? a.sharpe.toFixed(2) : '—'} ·{' '}
      {a.totalTrades.toLocaleString()} trades
    </Mono>
    <Badge $tone={a.isActive ? 'success' : 'warning'}>
      {a.isActive ? 'Active' : 'Paused'}
    </Badge>
  </BotRow>
)

const BotRegistry: React.FC = () => {
  const { walletAddress, signMessage } = useSDK()
  const readSession = useReadSession()
  const tx = useTx()
  const { toast } = useToast()
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [myAgent, setMyAgent] = useState<AgentProfile | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<AgentType>('AI_AGENT')
  const [framework, setFramework] = useState('')
  const [strategy, setStrategy] = useState('')
  const [perms, setPerms] = useState<Record<Perm, boolean>>({
    TRADE_SPOT: true,
    TRADE_MARGIN: false,
    COPYTRADE_SIGNAL: false,
    READ_ONLY: false
  })
  const [newKey, setNewKey] = useState<{
    key: string
    label: string
    perms: string[]
  } | null>(null)
  const [connecting, setConnecting] = useState(false)

  const loadAgents = async () => {
    try {
      setAgents(await agentService.getAgents({ sortBy: 'roi', limit: 50 }))
      setLoadError('')
    } catch (err: unknown) {
      setLoadError(
        err instanceof Error
          ? `${err.message}. Could not load agents.`
          : 'Agents API unavailable.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAgents()
  }, [])

  // The by-wallet lookup is a private read served by the read session
  // (never prompts the wallet on load).
  useEffect(() => {
    const token = getReadSessionToken(walletAddress)
    if (!walletAddress || !token) {
      setMyAgent(null)
      return
    }
    let alive = true
    agentService
      .getAgentByWallet(walletAddress, { sessionToken: token })
      .then(a => alive && setMyAgent(a))
      .catch(() => alive && setMyAgent(null))
    return () => {
      alive = false
    }
  }, [walletAddress, readSession.hasSession])

  const permsOn = PERMS.filter(p => perms[p])

  let cta: { label: string; ok: boolean; on?: () => void }
  if (!walletAddress) {
    cta = {
      label: connecting ? 'Connecting…' : 'Connect wallet',
      ok: !connecting,
      on: () => {
        setConnecting(true)
        requestWalletConnect()
          .catch((err: unknown) =>
            toast(
              'error',
              'Wallet not connected',
              err instanceof Error ? err.message : undefined
            )
          )
          .finally(() => setConnecting(false))
      }
    }
  } else if (!readSession.hasSession) {
    cta = {
      label: readSession.signingIn ? 'Signing in…' : 'Sign in to Lunex',
      ok: !readSession.signingIn,
      on: () => void readSession.signIn()
    }
  } else if (myAgent) {
    cta = { label: 'This wallet already has an agent', ok: false }
  } else if (!name.trim()) {
    cta = { label: 'Enter an agent name', ok: false }
  } else if (!permsOn.length) {
    cta = { label: 'Pick at least one permission', ok: false }
  } else {
    cta = {
      label: 'Register agent',
      ok: true,
      on: () => register(walletAddress)
    }
  }

  function register(address: string) {
    const label = name.trim()
    const permissions = [...permsOn]
    const fw = framework.trim() || undefined
    const desc = strategy.trim() || undefined
    let regAuth = createSignedActionMetadata()
    let regSig = ''
    let keyAuth = createSignedActionMetadata()
    let keySig = ''
    let agent: AgentProfile | null = null
    let issued = ''
    tx.run({
      type: 'social',
      title: 'Registering agent',
      summary: `${label} · ${TYPES.find(t => t[0] === type)?.[1] ?? type}`,
      actTitle: `Register agent ${label}`,
      successTitle: 'Agent registered',
      steps: [
        {
          label: 'Sign agent identity in your wallet',
          wallet: true,
          run: async () => {
            regAuth = createSignedActionMetadata()
            regSig = await signMessage(
              buildAgentRegisterSignMessage({
                address,
                agentType: type,
                framework: fw,
                strategyDescription: desc,
                nonce: regAuth.nonce,
                timestamp: regAuth.timestamp
              })
            )
            return true
          }
        },
        {
          label: 'Waiting for registration',
          run: async () => {
            agent = await agentService.registerAgent({
              walletAddress: address,
              agentType: type,
              framework: fw,
              strategyDescription: desc,
              nonce: regAuth.nonce,
              timestamp: regAuth.timestamp,
              signature: regSig
            })
            return true
          }
        },
        {
          label: 'Sign API key permissions',
          wallet: true,
          run: async () => {
            const a = agent as AgentProfile | null
            if (!a) return false
            keyAuth = createSignedActionMetadata()
            keySig = await signMessage(
              buildAgentCreateApiKeySignMessage({
                address,
                agentId: a.id,
                label,
                permissions,
                expiresInDays: 90,
                nonce: keyAuth.nonce,
                timestamp: keyAuth.timestamp
              })
            )
            return true
          }
        },
        {
          label: 'Issuing API key',
          run: async () => {
            const a = agent as AgentProfile | null
            if (!a) return false
            const res = await agentService.createBootstrapApiKey({
              agentId: a.id,
              walletAddress: address,
              label,
              permissions,
              expiresInDays: 90,
              nonce: keyAuth.nonce,
              timestamp: keyAuth.timestamp,
              signature: keySig
            })
            issued = res.key
            return true
          }
        }
      ],
      onSuccess: () => {
        const a = agent as AgentProfile | null
        if (a) setMyAgent(a)
        if (issued) setNewKey({ key: issued, label, perms: permissions })
        setName('')
        setFramework('')
        setStrategy('')
        void loadAgents()
      }
    })
  }

  const copyKey = () => {
    if (!newKey) return
    navigator.clipboard
      .writeText(newKey.key)
      .then(() => toast('success', 'API key copied'))
      .catch(() => toast('error', 'Could not copy the key'))
  }

  const others = myAgent ? agents.filter(a => a.id !== myAgent.id) : agents

  return (
    <Page $max={1080} style={{ gap: 16 }}>
      <BackToSocial />
      <div>
        <H1>Bot registry</H1>
        <Sub style={{ fontSize: 15 }}>
          AI agents and algorithmic bots registered on Lunex, with the
          permissions they hold.
        </Sub>
      </div>

      {loadError && <Notice $tone="warning">{loadError}</Notice>}

      <Layout>
        <ListCol>
          {loading ? (
            <List aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <BotRow key={i}>
                  <SkeletonLine
                    $w="36px"
                    $h={36}
                    style={{ borderRadius: 10 }}
                  />
                  <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                    <SkeletonLine $w="45%" />
                    <SkeletonLine $w="30%" $h={10} />
                  </div>
                </BotRow>
              ))}
            </List>
          ) : !myAgent && others.length === 0 ? (
            <DashedEmpty style={{ padding: '48px 24px' }}>
              No agents registered yet. Be the first.
            </DashedEmpty>
          ) : (
            <List>
              {myAgent && <AgentRow a={myAgent} mine />}
              {others.map(a => (
                <AgentRow key={a.id} a={a} />
              ))}
            </List>
          )}
        </ListCol>

        <FormCard>
          {newKey && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'Space Grotesk',
                  fontWeight: 600
                }}
              >
                <KeyRound size={16} color={C.primaryText} /> Your API key
              </span>
              <KeyBox>{`X-API-Key: ${newKey.key}\nlabel: ${newKey.label}\npermissions: ${newKey.perms.join(', ')}\nexpires: in 90 days`}</KeyBox>
              <Notice $tone="warning">
                Copy it now — it will not be shown again.
              </Notice>
              <Button variant="secondary" onClick={copyKey}>
                <Copy size={14} /> Copy key
              </Button>
            </div>
          )}

          <span
            style={{
              fontFamily: 'Space Grotesk',
              fontWeight: 600,
              fontSize: 16
            }}
          >
            Register AI agent
          </span>
          <FieldLabel>
            Agent name
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-agent-01"
              maxLength={40}
            />
          </FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Type</span>
            <ChipGroup role="radiogroup" aria-label="Agent type">
              {TYPES.map(([k, l]) => (
                <Pill
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={type === k}
                  $on={type === k}
                  onClick={() => setType(k)}
                >
                  {l}
                </Pill>
              ))}
            </ChipGroup>
          </div>
          <FieldLabel>
            Framework
            <Input
              value={framework}
              onChange={e => setFramework(e.target.value)}
              placeholder="LangChain, Phidata…"
            />
          </FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Permissions</span>
            <ChipGroup aria-label="Permissions">
              {PERMS.map(p => (
                <Pill
                  key={p}
                  type="button"
                  aria-pressed={perms[p]}
                  $on={perms[p]}
                  onClick={() => setPerms(x => ({ ...x, [p]: !x[p] }))}
                >
                  {p}
                </Pill>
              ))}
            </ChipGroup>
          </div>
          <FieldLabel>
            Strategy (optional)
            <Textarea
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              placeholder="What does your agent trade, and how?"
              rows={3}
              style={{ minHeight: 72 }}
            />
          </FieldLabel>
          <Button
            size="lg"
            block
            disabled={!cta.ok}
            onClick={cta.on}
            style={{ borderRadius: 14, fontSize: 16 }}
          >
            {cta.label}
          </Button>
        </FormCard>
      </Layout>
    </Page>
  )
}

export default BotRegistry
