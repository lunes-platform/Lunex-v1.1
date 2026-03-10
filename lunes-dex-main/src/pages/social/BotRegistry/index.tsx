import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useSDK } from '../../../context/SDKContext'
import agentService, { AgentProfile, AgentApiKey } from '../../../services/agentService'
import {
    buildAgentCreateApiKeySignMessage,
    buildAgentRegisterSignMessage,
    createSignedActionMetadata,
} from '../../../utils/signing'

// ── Icons ──

const BotIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="14" r="1.5" /><circle cx="15" cy="14" r="1.5" /><path d="M12 2v4" /><path d="M8 8V6" /><path d="M16 8V6" /></svg>
const KeyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
const ShieldIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
const ActivityIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
const CopyIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>

// ── Styled Components ──

const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding: 80px 24px 48px;
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const Header = styled.div`
  margin-bottom: 32px;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 32px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 12px;
`

const Subtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8A8A8E;
  margin: 0;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
`

const Card = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  padding: 24px;
  transition: all 0.25s ease;

  &:hover {
    border-color: #3A3A3C;
    transform: translateY(-2px);
  }
`

const BotCardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
`

const BotAvatar = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6C38FF 0%, #3C1CB7 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`

const BotInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const BotName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const BotMeta = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8A8A8E;
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
`

const TierBadge = styled.span<{ tier: number }>`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  background: ${({ tier }) => {
        if (tier >= 3) return '#FFD700'
        if (tier >= 2) return '#C0C0C0'
        if (tier >= 1) return '#CD7F32'
        return '#2A2A2C'
    }};
  color: ${({ tier }) => (tier >= 1 ? '#000' : '#8A8A8E')};
`

const TypeBadge = styled.span`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  background: #6C38FF22;
  color: #6C38FF;
`

const MetricsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 16px 0;
`

const Metric = styled.div`
  text-align: center;
`

const MetricValue = styled.div<{ positive?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: ${({ positive }) => positive === undefined ? '#FFFFFF' : positive ? '#26D07C' : '#FF284C'};
`

const MetricLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  color: #47474A;
  margin-top: 2px;
`

const Strategy = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8A8A8E;
  background: #1A1A1A;
  padding: 8px 12px;
  border-radius: 8px;
  margin-top: 12px;
  line-height: 1.4;
  max-height: 48px;
  overflow: hidden;
`

const Section = styled.div`
  margin-bottom: 32px;
`

const SectionTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const RegisterCard = styled(Card)`
  border: 2px dashed #2A2A2C;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 200px;
  cursor: pointer;
  text-align: center;

  &:hover {
    border-color: #6C38FF;
    background: #6C38FF08;
  }
`

const RegisterLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #FFFFFF;
`

const RegisterSubLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8A8A8E;
`

const FormOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: #00000099;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`

const FormCard = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  padding: 32px;
  width: 100%;
  max-width: 480px;
`

const FormTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 24px;
`

const FormGroup = styled.div`
  margin-bottom: 16px;
`

const FormLabel = styled.label`
  display: block;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8A8A8E;
  margin-bottom: 6px;
`

const FormInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  background: #1A1A1A;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: #6C38FF;
  }
`

const FormSelect = styled.select`
  width: 100%;
  padding: 10px 14px;
  background: #1A1A1A;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;

  option {
    background: #1A1A1A;
  }
`

const FormTextarea = styled.textarea`
  width: 100%;
  padding: 10px 14px;
  background: #1A1A1A;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;
  resize: vertical;
  min-height: 60px;
  box-sizing: border-box;

  &:focus {
    border-color: #6C38FF;
  }
`

const FormActions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
`

const PrimaryBtn = styled.button`
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: none;
  background: #6C38FF;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #5228DB;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const SecondaryBtn = styled.button`
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #2A2A2C;
  background: transparent;
  color: #8A8A8E;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #8A8A8E;
    color: #FFFFFF;
  }
`

const ApiKeyItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #1A1A1A;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  margin-bottom: 8px;
`

const ApiKeyLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #FFFFFF;
  font-weight: 600;
`

const ApiKeyMeta = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #47474A;
  margin-top: 2px;
`

const RevokeBtn = styled.button`
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid #FF284C33;
  background: transparent;
  color: #FF284C;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: #FF284C22;
  }
`

const CopyButton = styled.button`
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: #8A8A8E;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;

  &:hover {
    color: #FFFFFF;
  }
`

const NewKeyDisplay = styled.div`
  background: #0D0D0D;
  border: 1px solid #26D07C33;
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 16px;
  word-break: break-all;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #26D07C;
  display: flex;
  align-items: center;
  gap: 8px;
`

const Toast = styled.div`
  position: fixed;
  bottom: 32px;
  right: 32px;
  background: #26D07C;
  color: #1A1A1A;
  padding: 12px 24px;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  z-index: 200;
  animation: slideIn 0.25s ease;

  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`

const EmptyState = styled.div`
  text-align: center;
  padding: 60px 0;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
`

// ── Helpers ──

const tierNames: Record<number, string> = { 0: 'Free', 1: 'Bronze', 2: 'Silver', 3: 'Gold' }
const typeLabels: Record<string, string> = {
    AI_AGENT: 'AI Agent',
    OPENCLAW_BOT: 'OpenClaw',
    ALGO_BOT: 'Algo Bot',
    HUMAN: 'Human',
}

const formatRoi = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const formatNumber = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)

// ── Component ──

const BotRegistry: React.FC = () => {
    const { walletAddress, signMessage } = useSDK()
    const [agents, setAgents] = useState<AgentProfile[]>([])
    const [myAgent, setMyAgent] = useState<AgentProfile | null>(null)
    const [apiKeys, setApiKeys] = useState<AgentApiKey[]>([])
    const [showRegister, setShowRegister] = useState(false)
    const [registerForm, setRegisterForm] = useState({ agentType: 'AI_AGENT', framework: '', strategy: '' })
    const [registering, setRegistering] = useState(false)
    const [newKey, setNewKey] = useState('')
    const [toast, setToast] = useState('')
    const [isLoading, setIsLoading] = useState(true)

    const showToast = (msg: string) => {
        setToast(msg)
        setTimeout(() => setToast(''), 3000)
    }

    useEffect(() => {
        const load = async () => {
            setIsLoading(true)
            try {
                const bots = await agentService.getAgents({ sortBy: 'roi', limit: 50 })
                setAgents(bots)
            } catch {
                // silent
            } finally {
                setIsLoading(false)
            }
        }
        void load()
    }, [])

    useEffect(() => {
        if (!walletAddress) {
            setMyAgent(null)
            return
        }
        const check = async () => {
            const agent = await agentService.getAgentByWallet(walletAddress)
            setMyAgent(agent)
        }
        void check()
    }, [walletAddress])

    const handleRegister = async () => {
        if (!walletAddress) return
        setRegistering(true)
        try {
            const signedRegistration = createSignedActionMetadata()
            const registerSignature = await signMessage(buildAgentRegisterSignMessage({
                address: walletAddress,
                agentType: registerForm.agentType as 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT' | 'HUMAN',
                framework: registerForm.framework || undefined,
                strategyDescription: registerForm.strategy || undefined,
                nonce: signedRegistration.nonce,
                timestamp: signedRegistration.timestamp,
            }))

            const result = await agentService.registerAgent({
                walletAddress,
                agentType: registerForm.agentType,
                framework: registerForm.framework || undefined,
                strategyDescription: registerForm.strategy || undefined,
                nonce: signedRegistration.nonce,
                timestamp: signedRegistration.timestamp,
                signature: registerSignature,
            })
            setMyAgent(result)

            const signedBootstrap = createSignedActionMetadata()
            const bootstrapSignature = await signMessage(buildAgentCreateApiKeySignMessage({
                address: walletAddress,
                agentId: result.id,
                label: 'default',
                permissions: ['TRADE_SPOT', 'TRADE_MARGIN', 'COPYTRADE_SIGNAL', 'READ_ONLY'],
                expiresInDays: 90,
                nonce: signedBootstrap.nonce,
                timestamp: signedBootstrap.timestamp,
            }))

            const bootstrapKey = await agentService.createBootstrapApiKey({
                agentId: result.id,
                walletAddress,
                label: 'default',
                permissions: ['TRADE_SPOT', 'TRADE_MARGIN', 'COPYTRADE_SIGNAL', 'READ_ONLY'],
                expiresInDays: 90,
                nonce: signedBootstrap.nonce,
                timestamp: signedBootstrap.timestamp,
                signature: bootstrapSignature,
            })

            setNewKey(bootstrapKey.key)
            setShowRegister(false)
            showToast('Agent registered successfully!')
            const bots = await agentService.getAgents({ sortBy: 'roi', limit: 50 })
            setAgents(bots)
        } catch (err: any) {
            showToast(`Error: ${String(err.message)}`)
        } finally {
            setRegistering(false)
        }
    }

    const handleCopyKey = (key: string) => {
        void navigator.clipboard.writeText(key)
        showToast('API key copied!')
    }

    return (
        <Page>
            <Container>
                <Header>
                    <Title><BotIcon /> AI Bot Registry</Title>
                    <Subtitle>
                        Register your AI agent, manage API keys, and track bot performance across the network.
                    </Subtitle>
                </Header>

                {/* My Agent Section */}
                {walletAddress && (
                    <Section>
                        <SectionTitle><ShieldIcon /> My Agent</SectionTitle>
                        {myAgent ? (
                            <Card>
                                <BotCardHeader>
                                    <BotAvatar><BotIcon /></BotAvatar>
                                    <BotInfo>
                                        <BotName>{myAgent.leader?.name || `Agent ${myAgent.id.slice(0, 8)}`}</BotName>
                                        <BotMeta>
                                            <TypeBadge>{typeLabels[myAgent.agentType] || myAgent.agentType}</TypeBadge>
                                            <TierBadge tier={myAgent.stakingTier}>Tier {myAgent.stakingTier} — {tierNames[myAgent.stakingTier]}</TierBadge>
                                            {myAgent.framework && <span>⚙️ {myAgent.framework}</span>}
                                        </BotMeta>
                                    </BotInfo>
                                </BotCardHeader>

                                <MetricsRow>
                                    <Metric>
                                        <MetricValue positive={myAgent.roi >= 0}>{formatRoi(myAgent.roi)}</MetricValue>
                                        <MetricLabel>ROI</MetricLabel>
                                    </Metric>
                                    <Metric>
                                        <MetricValue>{myAgent.sharpe?.toFixed(2) || '—'}</MetricValue>
                                        <MetricLabel>Sharpe</MetricLabel>
                                    </Metric>
                                    <Metric>
                                        <MetricValue>{formatNumber(myAgent.totalTrades)}</MetricValue>
                                        <MetricLabel>Trades</MetricLabel>
                                    </Metric>
                                    <Metric>
                                        <MetricValue>{formatNumber(myAgent.totalVolume)}</MetricValue>
                                        <MetricLabel>Volume</MetricLabel>
                                    </Metric>
                                </MetricsRow>

                                {/* API Keys Management */}
                                <SectionTitle style={{ fontSize: 16, marginTop: 20 }}><KeyIcon /> API Keys</SectionTitle>
                                {apiKeys.map((key) => (
                                    <ApiKeyItem key={key.id}>
                                        <div>
                                            <ApiKeyLabel>{key.label}</ApiKeyLabel>
                                            <ApiKeyMeta>
                                                {key.permissions.join(', ')} · Expires {new Date(key.expiresAt).toLocaleDateString()}
                                            </ApiKeyMeta>
                                        </div>
                                        <RevokeBtn onClick={() => {
                                            // Revoke would need stored API key — simplified for now
                                            showToast('Use CLI or SDK to revoke keys')
                                        }}>
                                            Revoke
                                        </RevokeBtn>
                                    </ApiKeyItem>
                                ))}

                                {newKey && (
                                    <NewKeyDisplay>
                                        <span style={{ flex: 1 }}>{newKey}</span>
                                        <CopyButton onClick={() => handleCopyKey(newKey)}>
                                            <CopyIcon /> Copy
                                        </CopyButton>
                                    </NewKeyDisplay>
                                )}
                            </Card>
                        ) : (
                            <RegisterCard onClick={() => setShowRegister(true)}>
                                <BotAvatar><BotIcon /></BotAvatar>
                                <RegisterLabel>Register Your Agent</RegisterLabel>
                                <RegisterSubLabel>Connect your bot or AI agent to start trading via API</RegisterSubLabel>
                            </RegisterCard>
                        )}
                    </Section>
                )}

                {/* Bot Leaderboard */}
                <Section>
                    <SectionTitle><ActivityIcon /> Active Bots ({agents.length})</SectionTitle>
                    {isLoading ? (
                        <EmptyState>Loading agents...</EmptyState>
                    ) : agents.length === 0 ? (
                        <EmptyState>No AI agents registered yet. Be the first!</EmptyState>
                    ) : (
                        <Grid>
                            {agents.map((agent) => (
                                <Card key={agent.id}>
                                    <BotCardHeader>
                                        <BotAvatar><BotIcon /></BotAvatar>
                                        <BotInfo>
                                            <BotName>{agent.leader?.name || `Agent ${agent.id.slice(0, 8)}`}</BotName>
                                            <BotMeta>
                                                <TypeBadge>{typeLabels[agent.agentType] || agent.agentType}</TypeBadge>
                                                <TierBadge tier={agent.stakingTier}>{tierNames[agent.stakingTier]}</TierBadge>
                                                {agent.framework && <span>⚙️ {agent.framework}</span>}
                                            </BotMeta>
                                        </BotInfo>
                                    </BotCardHeader>

                                    <MetricsRow>
                                        <Metric>
                                            <MetricValue positive={agent.roi >= 0}>{formatRoi(agent.roi)}</MetricValue>
                                            <MetricLabel>ROI</MetricLabel>
                                        </Metric>
                                        <Metric>
                                            <MetricValue>{agent.sharpe?.toFixed(2) || '—'}</MetricValue>
                                            <MetricLabel>Sharpe</MetricLabel>
                                        </Metric>
                                        <Metric>
                                            <MetricValue>{formatNumber(agent.totalTrades)}</MetricValue>
                                            <MetricLabel>Trades</MetricLabel>
                                        </Metric>
                                        <Metric>
                                            <MetricValue>{agent.maxDrawdown?.toFixed(1)}%</MetricValue>
                                            <MetricLabel>Max DD</MetricLabel>
                                        </Metric>
                                    </MetricsRow>

                                    {agent.strategyDescription && (
                                        <Strategy>{agent.strategyDescription}</Strategy>
                                    )}
                                </Card>
                            ))}
                        </Grid>
                    )}
                </Section>

                {/* Registration Modal */}
                {showRegister && (
                    <FormOverlay onClick={() => setShowRegister(false)}>
                        <FormCard onClick={(e) => e.stopPropagation()}>
                            <FormTitle>Register AI Agent</FormTitle>

                            <FormGroup>
                                <FormLabel>Agent Type</FormLabel>
                                <FormSelect
                                    value={registerForm.agentType}
                                    onChange={(e) => setRegisterForm(prev => ({ ...prev, agentType: e.target.value }))}
                                >
                                    <option value="AI_AGENT">AI Agent</option>
                                    <option value="OPENCLAW_BOT">OpenClaw Bot</option>
                                    <option value="ALGO_BOT">Algo Bot</option>
                                </FormSelect>
                            </FormGroup>

                            <FormGroup>
                                <FormLabel>Framework (optional)</FormLabel>
                                <FormInput
                                    placeholder="e.g. OpenClaw, AutoGPT, Custom"
                                    value={registerForm.framework}
                                    onChange={(e) => setRegisterForm(prev => ({ ...prev, framework: e.target.value }))}
                                />
                            </FormGroup>

                            <FormGroup>
                                <FormLabel>Strategy Description (optional)</FormLabel>
                                <FormTextarea
                                    placeholder="Describe your bot's trading strategy..."
                                    value={registerForm.strategy}
                                    onChange={(e) => setRegisterForm(prev => ({ ...prev, strategy: e.target.value }))}
                                />
                            </FormGroup>

                            <FormActions>
                                <SecondaryBtn onClick={() => setShowRegister(false)}>Cancel</SecondaryBtn>
                                <PrimaryBtn onClick={handleRegister} disabled={registering}>
                                    {registering ? 'Registering...' : 'Register Agent'}
                                </PrimaryBtn>
                            </FormActions>
                        </FormCard>
                    </FormOverlay>
                )}

                {toast && <Toast>{toast}</Toast>}
            </Container>
        </Page>
    )
}

export default BotRegistry
