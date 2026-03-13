import React, { useState } from 'react'
import styled from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import agentService from '../../services/agentService'
import {
    buildAgentCreateApiKeySignMessage,
    buildAgentRegisterSignMessage,
    createSignedActionMetadata,
} from '../../utils/signing'
import { Button } from '../../components/bases'

// ─── Types ────────────────────────────────────────────────────────

interface Guardrails {
    gammaMin: number
    gammaMax: number
    canChangeCapacity: boolean
}

interface Props {
    strategyId?: string
    pairAddress?: string
    onClose: () => void
}

// ─── Styled ───────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
`

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 20px;
  padding: 28px;
  width: 100%;
  max-width: 480px;
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  position: relative;
`

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`

const Title = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0;
`

const CloseBtn = styled.button`
  ${({ theme }) => `
    width: 40px;
    height: 40px;
    font-size: 20px;
    cursor: pointer;
    color: ${theme.colors.themeColors[100]};
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 8px;
    right: 8px;
    transition: transform 0.3s ease-in-out, color 0.2s ease;
    transform: rotate(0deg);
    &:hover {
      color: ${theme.colors.themeColors[800]};
      transition: transform 0.3s ease-in-out, color 0.2s ease;
      transform: rotate(-180deg);
    }
  `}
`

const Section = styled.div`
  margin-bottom: 20px;
`

const SectionLabel = styled.span`
  display: block;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`

const Description = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  line-height: 1.6;
  margin: 0 0 20px;
`

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
`

const SliderLabel = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  min-width: 130px;
`

const Slider = styled.input`
  flex: 1;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.themeColors[400]};
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.primary[500]};
    cursor: pointer;
    box-shadow: 0 0 0 3px rgba(108, 56, 255, 0.25);
  }
`

const SliderValue = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  min-width: 20px;
  text-align: right;
`

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
`

const ToggleLabel = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const Toggle = styled.button<{ active: boolean }>`
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  cursor: pointer;
  background: ${({ active, theme }) => (active ? theme.colors.primary[500] : theme.colors.themeColors[400])};
  position: relative;
  transition: background 0.2s;

  &::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.themeColors[100]};
    top: 3px;
    left: ${({ active }) => (active ? '21px' : '3px')};
    transition: left 0.2s;
  }
`



const ApiKeyBox = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[700]};
  border: 1px solid rgba(52, 211, 153, 0.3);
  border-radius: 12px;
  padding: 14px;
  margin-top: 16px;
`

const ApiKeyLabel = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #34d399;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const ApiKeyValue = styled.code`
  display: block;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  word-break: break-all;
  line-height: 1.6;
`

const CopyButton = styled.button`
  margin-top: 10px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
  color: #34d399;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: rgba(52, 211, 153, 0.2); }
`

const ErrorMsg = styled.div`
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 12px;
`

// ─── API ──────────────────────────────────────────────────────────

async function createApiKey(
    walletAddress: string,
    signMessage: (message: string) => Promise<string>,
): Promise<string> {
    let agent = await agentService.getAgentByWallet(walletAddress)

    if (!agent) {
        const signedRegistration = createSignedActionMetadata()
        const registrationSignature = await signMessage(buildAgentRegisterSignMessage({
            address: walletAddress,
            agentType: 'AI_AGENT',
            framework: 'Asymmetric Agent Delegation',
            strategyDescription: 'Scoped agent for asymmetric curve parameter management',
            nonce: signedRegistration.nonce,
            timestamp: signedRegistration.timestamp,
        }))

        agent = await agentService.registerAgent({
            walletAddress,
            agentType: 'AI_AGENT',
            framework: 'Asymmetric Agent Delegation',
            strategyDescription: 'Scoped agent for asymmetric curve parameter management',
            nonce: signedRegistration.nonce,
            timestamp: signedRegistration.timestamp,
            signature: registrationSignature,
        })
    }

    const signedBootstrap = createSignedActionMetadata()
    const bootstrapSignature = await signMessage(buildAgentCreateApiKeySignMessage({
        address: walletAddress,
        agentId: agent.id,
        label: 'asymmetric-manager',
        permissions: ['MANAGE_ASYMMETRIC', 'READ_ONLY'],
        expiresInDays: 90,
        nonce: signedBootstrap.nonce,
        timestamp: signedBootstrap.timestamp,
    }))

    const apiKey = await agentService.createBootstrapApiKey({
        agentId: agent.id,
        walletAddress,
        label: 'asymmetric-manager',
        permissions: ['MANAGE_ASYMMETRIC', 'READ_ONLY'],
        expiresInDays: 90,
        nonce: signedBootstrap.nonce,
        timestamp: signedBootstrap.timestamp,
        signature: bootstrapSignature,
    })

    return apiKey.key
}

// ─── Component ────────────────────────────────────────────────────

const AgentDelegationPanel: React.FC<Props> = ({ onClose }) => {
    const { walletAddress, isConnected, signMessage } = useSDK()

    const [guardrails, setGuardrails] = useState<Guardrails>({
        gammaMin: 1,
        gammaMax: 3,
        canChangeCapacity: false,
    })

    const [isLoading, setIsLoading] = useState(false)
    const [apiKey, setApiKey] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleGenerate = async () => {
        if (!isConnected || !walletAddress) {
            setError('Connect your wallet first')
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            const key = await createApiKey(walletAddress, signMessage)
            setApiKey(key)
        } catch (err: any) {
            setError(err.message || 'Failed to generate API key')
        } finally {
            setIsLoading(false)
        }
    }

    const handleCopy = () => {
        if (!apiKey) return
        navigator.clipboard.writeText(apiKey).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    return (
        <Overlay onClick={(e) => e.target === e.currentTarget && onClose()}>
            <Modal>
                <ModalHeader>
                    <Title>Delegate to AI Agent</Title>
                    <CloseBtn onClick={onClose}>✕</CloseBtn>
                </ModalHeader>

                <Description>
                    Generate a restricted API Key that allows an AI agent (OpenClaw, Phidata, etc.)
                    to adjust curve parameters on your behalf. The agent{' '}
                    <strong>cannot withdraw funds</strong> — only reshape the liquidity curve.
                </Description>

                <Section>
                    <SectionLabel>Guardrails — γ (Curvature) Limits</SectionLabel>

                    <SliderRow>
                        <SliderLabel>Minimum γ allowed</SliderLabel>
                        <Slider
                            type="range"
                            min={1}
                            max={5}
                            value={guardrails.gammaMin}
                            onChange={(e) =>
                                setGuardrails((g) => ({
                                    ...g,
                                    gammaMin: Math.min(Number(e.target.value), g.gammaMax),
                                }))
                            }
                        />
                        <SliderValue>{guardrails.gammaMin}</SliderValue>
                    </SliderRow>

                    <SliderRow>
                        <SliderLabel>Maximum γ allowed</SliderLabel>
                        <Slider
                            type="range"
                            min={1}
                            max={5}
                            value={guardrails.gammaMax}
                            onChange={(e) =>
                                setGuardrails((g) => ({
                                    ...g,
                                    gammaMax: Math.max(Number(e.target.value), g.gammaMin),
                                }))
                            }
                        />
                        <SliderValue>{guardrails.gammaMax}</SliderValue>
                    </SliderRow>

                    <ToggleRow>
                        <ToggleLabel>Allow agent to change Max Capacity</ToggleLabel>
                        <Toggle
                            active={guardrails.canChangeCapacity}
                            onClick={() =>
                                setGuardrails((g) => ({
                                    ...g,
                                    canChangeCapacity: !g.canChangeCapacity,
                                }))
                            }
                        />
                    </ToggleRow>
                </Section>

                {!apiKey ? (
                    <Button onClick={handleGenerate} disabled={isLoading || !isConnected} loading={isLoading}>
                        {!isConnected
                            ? 'Connect Wallet First'
                            : 'Generate Restricted API Key'}
                    </Button>
                ) : (
                    <ApiKeyBox>
                        <ApiKeyLabel>API Key Generated — Copy and store it securely</ApiKeyLabel>
                        <ApiKeyValue>{apiKey}</ApiKeyValue>
                        <CopyButton onClick={handleCopy}>
                            {copied ? '✓ Copied!' : 'Copy Key'}
                        </CopyButton>
                    </ApiKeyBox>
                )}

                {error && <ErrorMsg>{error}</ErrorMsg>}
            </Modal>
        </Overlay>
    )
}

export default AgentDelegationPanel
