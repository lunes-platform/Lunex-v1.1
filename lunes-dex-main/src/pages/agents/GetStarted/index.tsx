import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { keyframes } from 'styled-components'

// ─── Animations ──────────────────────────────────────────────────
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
`
// ─── Layout ───────────────────────────────────────────────────────
const Page = styled.div`
  min-height: 100vh;
  background: #131313;
  padding: 90px 24px 72px;
  animation: ${fadeUp} 0.5s ease;
`
const Container = styled.div`
  max-width: 1080px;
  margin: 0 auto;
`

// ─── Hero ─────────────────────────────────────────────────────────
const Hero = styled.div`
  text-align: center;
  margin-bottom: 56px;
`
const SuperLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: 20px;
  background: rgba(108, 56, 255, 0.14);
  border: 1px solid rgba(108, 56, 255, 0.3);
  color: #ad87ff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 20px;
`
const HeroTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(32px, 5vw, 54px);
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 16px;
  letter-spacing: -1.5px;
  line-height: 1.1;
  span {
    background: linear-gradient(135deg, #6c38ff 0%, #ad87ff 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`
const HeroSub = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 17px;
  color: #8a8a8e;
  max-width: 600px;
  margin: 0 auto 28px;
  line-height: 1.7;
`
const HeroCTA = styled.button`
  padding: 14px 36px;
  border-radius: 12px;
  border: none;
  background: #6c38ff;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    opacity: 0.88;
    transform: translateY(-1px);
  }
`

// ─── Section ──────────────────────────────────────────────────────
const SectionTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: #6c38ff;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 0 0 8px;
`
const SectionHeading = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 32px;
`

// ─── Agent Type Cards ─────────────────────────────────────────────
const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 64px;
`
const AgentCard = styled.div<{ active?: boolean; accentColor: string }>`
  background: #1e1e1e;
  border: 1px solid
    ${({ active, accentColor }) => (active ? accentColor + '66' : '#2A2A2C')};
  border-radius: 18px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
  &:hover {
    border-color: ${({ accentColor }) => accentColor + '88'};
    transform: translateY(-3px);
    background: #222;
  }
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: ${({ accentColor }) => accentColor};
    opacity: ${({ active }) => (active ? 1 : 0)};
    transition: opacity 0.2s;
  }
  &:hover::before {
    opacity: 0.6;
  }
`
const CardIcon = styled.div<{ bg: string }>`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: ${({ bg }) => bg};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 14px;
`
const CardName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
`
const CardType = styled.div<{ color: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  font-weight: 700;
  color: ${({ color }) => color};
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 10px;
`
const CardDesc = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8a8a8e;
  line-height: 1.6;
`
const CardBadge = styled.div<{ color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  padding: 3px 8px;
  border-radius: 20px;
  background: ${({ color }) => color + '18'};
  border: 1px solid ${({ color }) => color + '33'};
  color: ${({ color }) => color};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
`

// ─── Stepper ──────────────────────────────────────────────────────
const StepperWrap = styled.div`
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  border-radius: 24px;
  padding: 40px;
  margin-bottom: 56px;
`
const StepperTrack = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0;
  position: relative;
  margin-bottom: 40px;

  @media (max-width: 700px) {
    flex-direction: column;
    gap: 24px;
  }
`
const StepConnector = styled.div<{ done: boolean }>`
  flex: 1;
  height: 2px;
  margin-top: 20px;
  background: ${({ done }) => (done ? '#6C38FF' : '#2A2A2C')};
  transition: background 0.4s;

  @media (max-width: 700px) {
    display: none;
  }
`
const Step = styled.div<{ active: boolean; done: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
  cursor: pointer;
  gap: 10px;
  min-width: 100px;
  text-align: center;
  transition: opacity 0.2s;
  opacity: ${({ active, done }) => (active || done ? 1 : 0.45)};
  &:hover {
    opacity: 1;
  }
`
const StepCircle = styled.div<{ active: boolean; done: boolean }>`
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 2px solid
    ${({ active, done }) => (done ? '#6C38FF' : active ? '#6C38FF' : '#2A2A2C')};
  background: ${({ active, done }) =>
    done ? '#6C38FF' : active ? 'rgba(108,56,255,0.12)' : '#1E1E1E'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: ${({ active, done }) => (active || done ? '#FFF' : '#555')};
  transition: all 0.3s;
`
const StepLabel = styled.div<{ active: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: ${({ active }) => (active ? 700 : 500)};
  color: ${({ active }) => (active ? '#FFFFFF' : '#8A8A8E')};
  max-width: 88px;
`

const StepContent = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: flex-start;
`
const StepNum = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #6c38ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
`
const StepTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
`
const StepDesc = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8a8a8e;
  line-height: 1.6;
  margin-bottom: 12px;
`
const StepCode = styled.pre`
  background: #111;
  border: 1px solid #2a2a2c;
  border-radius: 10px;
  padding: 12px 16px;
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  color: #ad87ff;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 8px 0 0;
`
const StepBtn = styled.button<{ primary?: boolean }>`
  margin-top: 12px;
  padding: 10px 22px;
  border-radius: 10px;
  border: ${({ primary }) => (primary ? 'none' : '1px solid #2A2A2C')};
  background: ${({ primary }) => (primary ? '#6C38FF' : 'transparent')};
  color: ${({ primary }) => (primary ? '#FFF' : '#8A8A8E')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: ${({ primary }) =>
      primary ? '#7D4DFF' : 'rgba(255,255,255,0.04)'};
    color: ${({ primary }) => (primary ? '#FFF' : '#CCC')};
  }
`

// ─── Data ─────────────────────────────────────────────────────────
const AGENT_TYPES = [
  {
    type: 'HUMAN',
    icon: 'H',
    name: 'Human Trader',
    desc: 'A real person controlling their own wallet and strategies directly through the Lunex interface. Best for manual, discretionary trading.',
    accent: '#26D07C',
    bg: 'rgba(38,208,124,0.12)',
    badge: 'Manual Control'
  },
  {
    type: 'AI_AGENT',
    icon: 'AI',
    name: 'AI Agent',
    desc: 'A language model or ML system (Phidata, LangChain, AutoGPT) that trades autonomously using signals and patterns. Requires API Key.',
    accent: '#6C38FF',
    bg: 'rgba(108,56,255,0.12)',
    badge: 'Fully Autonomous'
  },
  {
    type: 'OPENCLAW_BOT',
    icon: 'OC',
    name: 'OpenClaw Bot',
    desc: 'Pre-configured integration with the OpenClaw framework. Optimized for high-frequency signals and on-chain copy-vault execution.',
    accent: '#FE923F',
    bg: 'rgba(254,146,63,0.12)',
    badge: 'OpenClaw Native'
  },
  {
    type: 'ALGO_BOT',
    icon: 'AB',
    name: 'Algo Bot',
    desc: 'Quantitative algorithmic strategy running rule-based logic. Ideal for momentum, arbitrage, and market-making bots built in Python or JS.',
    accent: '#4DACFF',
    bg: 'rgba(77,172,255,0.12)',
    badge: 'Quantitative'
  }
]

const STEPS = [
  {
    label: 'Register Agent',
    title: 'Register your Agent',
    desc: 'Sign a transaction from your connected wallet to create an Agent identity on Lunex. Choose your Agent type (Human, AI, OpenClaw, or Algo Bot) and optionally link to a Leader profile for Social Trade visibility.',
    code: `POST /api/v1/agents/register\n{\n  "walletAddress": "5xHW...Fb8",\n  "agentType": "AI_AGENT",\n  "framework": "LangChain"\n}`,
    cta: 'Go to Agent Dashboard',
    ctaPath: '/agent'
  },
  {
    label: 'Generate API Key',
    title: 'Generate a Restricted API Key',
    desc: 'From the Agent Dashboard, create an API key with only the permissions your bot needs (TRADE_SPOT, COPYTRADE_SIGNAL, etc). Keys expire in 90 days by default — max 5 active keys per agent.',
    code: `POST /api/v1/agents/{id}/api-keys\n{\n  "permissions": ["TRADE_SPOT"],\n  "expiresInDays": 90\n}\n// Returns: lnx_a1b2c3... (save it immediately!)`,
    cta: 'View Agent Dashboard',
    ctaPath: '/agent'
  },
  {
    label: 'Connect Bot',
    title: 'Connect your Bot or Strategy',
    desc: "Use your API key to authenticate your trading bot. Pass the key as an HTTP header on every request. Your bot's trading limits are determined by how much LUNES you stake (Tier 0–3).",
    code: `curl -X POST https://api.lunex.io/api/v1/orders \\
  -H "X-API-Key: lnx_a1b2c3..." \\
  -H "Content-Type: application/json" \\
  -d '{"pairSymbol":"LUNES/USDT","side":"BUY"}'`,
    cta: 'Read API Docs',
    ctaPath: '/docs'
  },
  {
    label: 'Publish Strategy',
    title: 'Publish to the Marketplace',
    desc: 'Register a named strategy under your agent and set it as public. Followers can then allocate capital to your strategy via CopyVault contracts. Earn performance fees on profits.',
    code: `POST /api/v1/strategies/register\n{\n  "name": "LUNES Momentum Alpha",\n  "strategyType": "MOMENTUM",\n  "riskLevel": "MEDIUM",\n  "isPublic": true\n}`,
    cta: 'Browse Strategies',
    ctaPath: '/strategies'
  }
]

// ─── Component ────────────────────────────────────────────────────
const AgentGetStarted: React.FC = () => {
  const navigate = useNavigate()
  const [activeStep, setActiveStep] = useState(0)
  const step = STEPS[activeStep]

  return (
    <Page>
      <Container>
        {/* Hero */}
        <Hero>
          <SuperLabel>Agent Onboarding</SuperLabel>
          <HeroTitle>
            Your Bot, Your <span>Strategy</span>,<br />
            Your Edge.
          </HeroTitle>
          <HeroSub>
            Agents are autonomous trading entities on Lunex. Connect a human
            wallet, an AI model, an OpenClaw bot, or a custom algo — and publish
            strategies to the marketplace in minutes.
          </HeroSub>
          <HeroCTA onClick={() => navigate('/agent')}>
            Get Started — Create Agent
          </HeroCTA>
        </Hero>

        {/* Agent Type Cards */}
        <SectionTitle>Choose your Agent Type</SectionTitle>
        <SectionHeading>What kind of trader are you?</SectionHeading>
        <CardGrid>
          {AGENT_TYPES.map(a => (
            <AgentCard key={a.type} accentColor={a.accent}>
              <CardIcon bg={a.bg}>{a.icon}</CardIcon>
              <CardName>{a.name}</CardName>
              <CardType color={a.accent}>{a.type}</CardType>
              <CardDesc>{a.desc}</CardDesc>
              <CardBadge color={a.accent}>{a.badge}</CardBadge>
            </AgentCard>
          ))}
        </CardGrid>

        {/* 4-Step Stepper */}
        <SectionTitle>Getting Started</SectionTitle>
        <SectionHeading>4 steps to go live</SectionHeading>
        <StepperWrap>
          <StepperTrack>
            {STEPS.map((s, i) => (
              <React.Fragment key={i}>
                <Step
                  active={activeStep === i}
                  done={activeStep > i}
                  onClick={() => setActiveStep(i)}
                >
                  <StepCircle active={activeStep === i} done={activeStep > i}>
                    {activeStep > i ? '✓' : i + 1}
                  </StepCircle>
                  <StepLabel active={activeStep === i}>{s.label}</StepLabel>
                </Step>
                {i < STEPS.length - 1 && (
                  <StepConnector done={activeStep > i} />
                )}
              </React.Fragment>
            ))}
          </StepperTrack>

          <StepContent>
            <StepNum>{activeStep + 1}</StepNum>
            <div>
              <StepTitle>{step.title}</StepTitle>
              <StepDesc>{step.desc}</StepDesc>
              <StepCode>{step.code}</StepCode>
              <div style={{ display: 'flex', gap: 10 }}>
                <StepBtn primary onClick={() => navigate(step.ctaPath)}>
                  {step.cta}
                </StepBtn>
                {activeStep < STEPS.length - 1 && (
                  <StepBtn onClick={() => setActiveStep(activeStep + 1)}>
                    Next Step →
                  </StepBtn>
                )}
                {activeStep > 0 && (
                  <StepBtn onClick={() => setActiveStep(activeStep - 1)}>
                    ← Back
                  </StepBtn>
                )}
              </div>
            </div>
          </StepContent>
        </StepperWrap>
      </Container>
    </Page>
  )
}

export default AgentGetStarted
