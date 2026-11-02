/**
 * AI-agent delegation for asymmetric strategies.
 *
 * - `DelegationCard`: toggle + AI agent chips + guardrails (γ range, capacity).
 * - `enforceDelegation()`: real flow — registers/looks up the wallet's agent,
 *   creates a scoped API key (MANAGE_ASYMMETRIC), applies `set_manager`
 *   on-chain with the guardrails and links the strategy in the backend.
 *   Run it inside a `useTx().run` step.
 * - `ApiKeyDialog`: shows the generated key once, with copy.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Check, Copy } from 'lucide-react'
import { web3Accounts } from '@polkadot/extension-dapp'
import agentService from '../../services/agentService'
import { ensureReadSession } from '../../services/sessionService'
import { contractService } from '../../services/contractService'
import { asymmetricContractService } from '../../services/asymmetricContractService'
import {
  buildAgentCreateApiKeySignMessage,
  buildAgentRegisterSignMessage,
  createSignedActionMetadata
} from '../../utils/signing'
import { C, Button, Notice, grotesk } from '../ui/kit'
import Dialog from '../ui/Dialog'

// ─── Types ────────────────────────────────────────────────────────

export interface Guardrails {
  gammaMin: number
  gammaMax: number
  canChangeCapacity: boolean
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  gammaMin: 1,
  gammaMax: 3,
  canChangeCapacity: false
}

export type AgentChip = { id: string; name: string }

// PLACEHOLDER: no backend yet — shown only when the agent directory is empty
// or unreachable. The chosen agent is informational; the on-chain manager is
// always the Lunex relayer scoped by the API key.
const FALLBACK_AGENTS: AgentChip[] = [
  { id: 'orion-grid', name: 'Orion Grid' },
  { id: 'delta-neutral', name: 'Delta Neutral' },
  { id: 'sigma-scalper', name: 'Sigma Scalper' }
]

// ─── Real delegation flow ─────────────────────────────────────────

async function createApiKey(
  walletAddress: string,
  signMessage: (message: string) => Promise<string>
): Promise<{ key: string; agentId: string }> {
  // Lookup is a private read: reuse (or create, once) the read session.
  const sessionToken = await ensureReadSession(walletAddress, signMessage)
  let agent = await agentService.getAgentByWallet(walletAddress, {
    sessionToken
  })

  if (!agent) {
    const signedRegistration = createSignedActionMetadata()
    const registrationSignature = await signMessage(
      buildAgentRegisterSignMessage({
        address: walletAddress,
        agentType: 'AI_AGENT',
        framework: 'Asymmetric Agent Delegation',
        strategyDescription:
          'Scoped agent for asymmetric curve parameter management',
        nonce: signedRegistration.nonce,
        timestamp: signedRegistration.timestamp
      })
    )

    agent = await agentService.registerAgent({
      walletAddress,
      agentType: 'AI_AGENT',
      framework: 'Asymmetric Agent Delegation',
      strategyDescription:
        'Scoped agent for asymmetric curve parameter management',
      nonce: signedRegistration.nonce,
      timestamp: signedRegistration.timestamp,
      signature: registrationSignature
    })
  }

  const signedBootstrap = createSignedActionMetadata()
  const bootstrapSignature = await signMessage(
    buildAgentCreateApiKeySignMessage({
      address: walletAddress,
      agentId: agent.id,
      label: 'asymmetric-manager',
      permissions: ['MANAGE_ASYMMETRIC', 'READ_ONLY'],
      expiresInDays: 90,
      nonce: signedBootstrap.nonce,
      timestamp: signedBootstrap.timestamp
    })
  )

  const apiKey = await agentService.createBootstrapApiKey({
    agentId: agent.id,
    walletAddress,
    label: 'asymmetric-manager',
    permissions: ['MANAGE_ASYMMETRIC', 'READ_ONLY'],
    expiresInDays: 90,
    nonce: signedBootstrap.nonce,
    timestamp: signedBootstrap.timestamp,
    signature: bootstrapSignature
  })

  return { key: apiKey.key, agentId: agent.id }
}

export async function enforceDelegation(opts: {
  walletAddress: string
  signMessage: (message: string) => Promise<string>
  strategyId: string
  pairAddress: string
  guardrails: Guardrails
}): Promise<{ apiKey: string; txHash: string }> {
  const { walletAddress, signMessage, strategyId, pairAddress, guardrails } =
    opts
  if (!strategyId || !pairAddress) {
    throw new Error('Strategy ID and pair address are required to delegate')
  }

  const { key } = await createApiKey(walletAddress, signMessage)
  const delegationContext =
    await agentService.getAsymmetricDelegationContext(key)

  const accounts = await web3Accounts()
  const account = accounts.find(a => a.address === walletAddress)
  if (!account) {
    throw new Error('Could not find wallet account to sign set_manager')
  }

  let api = contractService.getApi()
  if (!api) {
    await contractService.connect('testnet')
    api = contractService.getApi()
  }
  if (!api) throw new Error('Could not connect to Lunes blockchain')

  asymmetricContractService.setApi(api)
  const txHash = await asymmetricContractService.setManager(
    pairAddress,
    delegationContext.relayerAddress,
    guardrails,
    account
  )

  await agentService.linkAsymmetricStrategy(key, { strategyId, pairAddress })
  return { apiKey: key, txHash }
}

/** AI agents from the agent directory (falls back to a placeholder list). */
export function useAiAgents(): AgentChip[] {
  const [agents, setAgents] = useState<AgentChip[]>(FALLBACK_AGENTS)
  useEffect(() => {
    let alive = true
    agentService
      .getAgents({ agentType: 'AI_AGENT', limit: 6 })
      .then(list => {
        if (!alive || list.length === 0) return
        setAgents(
          list.map(a => ({
            id: a.id,
            name:
              a.leader?.name ||
              a.framework ||
              `${a.walletAddress.slice(0, 6)}…${a.walletAddress.slice(-4)}`
          }))
        )
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return agents
}

// ─── UI ───────────────────────────────────────────────────────────

const Card = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.surface};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  b {
    ${grotesk};
    display: block;
    font-weight: 600;
    font-size: 15px;
  }
  small {
    display: block;
    font-size: 12px;
    color: ${C.muted};
    margin-top: 2px;
    line-height: 1.5;
  }
`

export const Toggle = styled.button<{ $on: boolean }>`
  width: 46px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 999px;
  border: none;
  background: ${p => (p.$on ? C.primary : C.borderStrong)};
  position: relative;
  transition: background-color 150ms ease;
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${p => (p.$on ? '23px' : '3px')};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: left 150ms ease;
  }
`

const ChipBtn = styled.button<{ $on: boolean }>`
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => (p.$on ? C.primary : C.borderStrong)};
  background: ${p => (p.$on ? 'rgba(108,56,255,0.16)' : 'transparent')};
  color: ${p => (p.$on ? C.primaryText2 : C.secondary)};
  font-size: 13px;
  font-weight: 600;
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

const Line = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  > span {
    font-size: 13px;
    color: ${C.muted};
  }
`

type CardProps = {
  enabled: boolean
  onToggle: () => void
  agents: AgentChip[]
  agentId: string | null
  onAgent: (id: string) => void
  guardrails: Guardrails
  onGuardrails: (g: Guardrails) => void
}

export const DelegationCard: React.FC<CardProps> = ({
  enabled,
  onToggle,
  agents,
  agentId,
  onAgent,
  guardrails,
  onGuardrails
}) => (
  <Card>
    <Head>
      <div>
        <b>Delegate to an AI agent</b>
        <small>
          The agent can shift your curve parameters within your limits. It can
          never withdraw.
        </small>
      </div>
      <Toggle
        $on={enabled}
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle delegation"
      />
    </Head>
    {enabled && (
      <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {agents.map(a => (
            <ChipBtn
              key={a.id}
              $on={agentId === a.id}
              aria-pressed={agentId === a.id}
              onClick={() => onAgent(a.id)}
            >
              {a.name}
            </ChipBtn>
          ))}
        </div>
        <Line>
          <span>
            Allowed curvature · γ{guardrails.gammaMin} to γ{guardrails.gammaMax}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3, 4, 5].map(g => {
              const on = g >= guardrails.gammaMin && g <= guardrails.gammaMax
              return (
                <GammaBtn
                  key={g}
                  $on={on}
                  aria-pressed={on}
                  onClick={() => {
                    // click below/at min → new min; above → new max
                    if (g <= guardrails.gammaMin)
                      onGuardrails({ ...guardrails, gammaMin: g })
                    else if (g >= guardrails.gammaMax)
                      onGuardrails({ ...guardrails, gammaMax: g })
                    else onGuardrails({ ...guardrails, gammaMax: g })
                  }}
                >
                  γ{g}
                </GammaBtn>
              )
            })}
          </div>
        </Line>
        <Head>
          <small style={{ margin: 0, color: C.secondary, fontSize: 13 }}>
            Allow the agent to change max capacity
          </small>
          <Toggle
            $on={guardrails.canChangeCapacity}
            role="switch"
            aria-checked={guardrails.canChangeCapacity}
            aria-label="Allow capacity changes"
            onClick={() =>
              onGuardrails({
                ...guardrails,
                canChangeCapacity: !guardrails.canChangeCapacity
              })
            }
          />
        </Head>
      </>
    )}
  </Card>
)

const KeyBox = styled.code`
  display: block;
  padding: 12px 14px;
  border-radius: 12px;
  background: ${C.bg};
  border: 1px solid ${C.border};
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  word-break: break-all;
  color: ${C.primaryText2};
`

export const ApiKeyDialog: React.FC<{
  apiKey: string | null
  onClose: () => void
}> = ({ apiKey, onClose }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!apiKey) return
    navigator.clipboard
      .writeText(apiKey)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }
  return (
    <Dialog
      open={!!apiKey}
      onClose={onClose}
      title="Agent API key"
      description="Give this key to your AI agent. It can only reshape your curves within the guardrails — never withdraw."
      width={460}
    >
      <Notice $tone="warning">
        This key is shown once. Copy it and store it securely.
      </Notice>
      <KeyBox>{apiKey}</KeyBox>
      <Button size="lg" block onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? 'Copied' : 'Copy key'}
      </Button>
    </Dialog>
  )
}
