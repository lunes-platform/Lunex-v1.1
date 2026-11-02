/**
 * Agents — get started (prototype GET STARTED).
 * 4 agent types + 4 steps with copyable code blocks. Static guide content.
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Check, Copy } from 'lucide-react'
import { Button, C, Col, H1, Page, Row, Sub, grotesk } from 'components/ui/kit'
import { useToast } from 'components/feedback/ToastProvider'
import { BackLink } from '../../strategies/shared'

const AGENT_TYPES = [
  {
    type: 'HUMAN',
    name: 'Human Trader',
    desc: 'A real person controlling their own wallet and strategies directly through the Lunex interface. Best for manual, discretionary trading.'
  },
  {
    type: 'AI_AGENT',
    name: 'AI Agent',
    desc: 'A language model or ML system (Phidata, LangChain, AutoGPT) that trades autonomously using signals and patterns. Requires API key.'
  },
  {
    type: 'OPENCLAW_BOT',
    name: 'OpenClaw Bot',
    desc: 'Pre-configured integration with the OpenClaw framework. Optimized for high-frequency signals and on-chain copy-vault execution.'
  },
  {
    type: 'ALGO_BOT',
    name: 'Algo Bot',
    desc: 'Quantitative strategy running rule-based logic. Ideal for momentum, arbitrage and market-making bots built in Python or JS.'
  }
]

const STEPS: { label: string; title: string; desc: string; code?: string }[] = [
  {
    label: 'Register Agent',
    title: 'Register your agent',
    desc: 'Sign a transaction from your connected wallet to create an agent identity on Lunex. Choose the agent type and optionally link a leader profile for Social Trade visibility.'
  },
  {
    label: 'Generate API Key',
    title: 'Generate a restricted API key',
    desc: 'Create a key with only the permissions your bot needs (TRADE_SPOT, COPYTRADE_SIGNAL…). Keys expire in 90 days by default — max 5 active keys per agent.',
    code: `POST /api/v1/agents/{id}/api-keys
{
  "permissions": ["TRADE_SPOT"],
  "expiresInDays": 90
}
// Returns: lnx_a1b2c3… (save it immediately!)`
  },
  {
    label: 'Connect Bot',
    title: 'Connect your bot or strategy',
    desc: 'Pass the key as an HTTP header on every request. Trading limits depend on how much LUNES you stake (tier 0–3).',
    code: `curl https://api.lunex.io/api/v1/orders \\
  -H "X-API-Key: lnx_a1b2c3…" \\
  -d '{"pair":"WLUNES/LUSDT","side":"BUY","type":"LIMIT"}'`
  },
  {
    label: 'Publish Strategy',
    title: 'Publish to the marketplace',
    desc: 'Register a named strategy under your agent and make it public. Followers allocate capital through CopyVault contracts and you earn performance fees on profits.'
  }
]

// ─── Styled ──────────────────────────────────────────────────────

const Lead = styled(Sub)`
  font-size: 15px;
  margin: 0;
  text-wrap: pretty;
`

const Eyebrow = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${C.primaryText};
`

const SectionTitle = styled.h2`
  ${grotesk};
  font-size: 22px;
  font-weight: 600;
  @media (max-width: 759px) {
    font-size: 20px;
  }
`

const Types = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 10px;
`

const TypeCard = styled.button<{ $active: boolean }>`
  text-align: left;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid ${p => (p.$active ? C.primary : C.border)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.12)' : C.surface)};
  color: ${C.text};
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
  &:hover {
    border-color: ${p => (p.$active ? C.primary : C.borderStrong)};
  }
  strong {
    ${grotesk};
    font-size: 17px;
    font-weight: 600;
  }
  span {
    font-size: 13px;
    color: ${C.secondary};
    line-height: 1.5;
  }
`

const StepCard = styled.div`
  display: flex;
  gap: 16px;
  padding: 16px;
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.surface};
  @media (max-width: 759px) {
    gap: 12px;
  }
`

const StepNum = styled.div`
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${C.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-weight: 700;
  @media (max-width: 759px) {
    width: 30px;
    height: 30px;
    font-size: 14px;
  }
`

const StepTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 17px;
`

const StepDesc = styled.span`
  font-size: 14px;
  color: ${C.secondary};
  line-height: 1.55;
`

const CodeWrap = styled.div`
  position: relative;
`

const Code = styled.pre`
  margin: 0;
  padding: 12px 14px;
  padding-right: 44px;
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

const CopyBtn = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  color: ${C.muted};
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    color: ${C.text};
    border-color: ${C.borderStrong};
  }
`

const Ctas = styled(Row)`
  @media (max-width: 759px) {
    flex-direction: column;
    align-items: stretch;
  }
`

// ─── Component ───────────────────────────────────────────────────

const AgentGetStarted: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [type, setType] = useState(AGENT_TYPES[1].type)
  const [copied, setCopied] = useState<number | null>(null)
  const typeName = AGENT_TYPES.find(a => a.type === type)?.name ?? 'agent'

  const copy = (i: number, code: string) => {
    if (!navigator.clipboard) {
      toast('error', 'Could not copy', 'Clipboard is not available.', {
        silent: true
      })
      return
    }
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(i)
        setTimeout(() => setCopied(c => (c === i ? null : c)), 1500)
        toast('success', 'Copied to clipboard', STEPS[i].title, {
          silent: true
        })
      })
      .catch(() =>
        toast('error', 'Could not copy', 'Select the code and copy it.', {
          silent: true
        })
      )
  }

  return (
    <Page $max={1000} style={{ gap: 18 }}>
      <BackLink label="AI agents" onClick={() => navigate('/agent')} />

      <Col $gap={6}>
        <H1>Get started with agents</H1>
        <Lead>
          Register an agent, give it a restricted key, connect your bot and
          publish its strategy.
        </Lead>
      </Col>

      <Col $gap={4}>
        <Eyebrow>Choose your agent type</Eyebrow>
        <SectionTitle>What kind of trader are you?</SectionTitle>
      </Col>
      <Types role="radiogroup" aria-label="Agent type">
        {AGENT_TYPES.map(a => (
          <TypeCard
            key={a.type}
            role="radio"
            aria-checked={type === a.type}
            $active={type === a.type}
            onClick={() => setType(a.type)}
          >
            <strong>{a.name}</strong>
            <span>{a.desc}</span>
          </TypeCard>
        ))}
      </Types>

      <Col $gap={4} style={{ paddingTop: 8 }}>
        <Eyebrow>Getting started</Eyebrow>
        <SectionTitle>4 steps to go live</SectionTitle>
      </Col>
      <Col
        as="ol"
        $gap={12}
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {STEPS.map((s, i) => (
          <StepCard as="li" key={s.label}>
            <StepNum aria-hidden="true">{i + 1}</StepNum>
            <Col $gap={8} style={{ flex: 1 }}>
              <Eyebrow>{s.label}</Eyebrow>
              <StepTitle>{s.title}</StepTitle>
              <StepDesc>{s.desc}</StepDesc>
              {s.code && (
                <CodeWrap>
                  <Code>{s.code}</Code>
                  <CopyBtn
                    aria-label={`Copy code for ${s.title}`}
                    onClick={() => copy(i, s.code!)}
                  >
                    {copied === i ? (
                      <Check size={14} color={C.successText} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </CopyBtn>
                </CodeWrap>
              )}
            </Col>
          </StepCard>
        ))}
      </Col>

      <Ctas $gap={8} $wrap>
        <Button
          size="xl"
          style={{ height: 50, fontSize: 15, borderRadius: 12 }}
          onClick={() => navigate('/social/bots')}
        >
          Register {typeName.toLowerCase()}
        </Button>
        <Button
          size="xl"
          variant="secondary"
          style={{ height: 50, fontSize: 15, borderRadius: 12 }}
          onClick={() => navigate('/docs')}
        >
          Read the API docs
        </Button>
      </Ctas>
    </Page>
  )
}

export default AgentGetStarted
