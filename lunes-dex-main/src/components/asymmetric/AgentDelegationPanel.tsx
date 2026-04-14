import React, { useState } from 'react'
import styled from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import agentService from '../../services/agentService'
import { contractService } from '../../services/contractService'
import { asymmetricContractService } from '../../services/asymmetricContractService'
import {
  buildAgentCreateApiKeySignMessage,
  buildAgentRegisterSignMessage,
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'
import { Button } from '../../components/bases'
import { web3Accounts } from '@polkadot/extension-dapp'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'

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
  background: ${({ active, theme }) =>
    active ? theme.colors.primary[500] : theme.colors.themeColors[400]};
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

const TextInput = styled.input`
  width: 100%;
  border-radius: 12px;
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  background: ${({ theme }) => theme.colors.themeColors[700]};
  color: ${({ theme }) => theme.colors.themeColors[100]};
  padding: 12px 14px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px;
  outline: none;

  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[300]};
  }

  &:focus {
    border-color: ${({ theme }) => theme.colors.primary[500]};
  }
`

const SuccessMsg = styled.div`
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.3);
  color: #34d399;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  margin-top: 12px;
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
  &:hover {
    background: rgba(52, 211, 153, 0.2);
  }
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
  signMessage: (message: string) => Promise<string>
): Promise<{ key: string; agentId: string }> {
  const signedLookup = createSignedActionMetadata()
  const lookupSignature = await signMessage(
    buildWalletActionMessage({
      action: 'agents.by-wallet',
      address: walletAddress,
      nonce: signedLookup.nonce,
      timestamp: signedLookup.timestamp
    })
  )
  let agent = await agentService.getAgentByWallet(walletAddress, {
    nonce: signedLookup.nonce,
    timestamp: signedLookup.timestamp,
    signature: lookupSignature
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

  return {
    key: apiKey.key,
    agentId: agent.id
  }
}

// ─── Component ────────────────────────────────────────────────────

const AgentDelegationPanel: React.FC<Props> = ({
  onClose,
  strategyId,
  pairAddress
}) => {
  const { walletAddress, isConnected, signMessage } = useSDK()

  const [guardrails, setGuardrails] = useState<Guardrails>({
    gammaMin: 1,
    gammaMax: 3,
    canChangeCapacity: false
  })

  const [isLoading, setIsLoading] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [strategyIdInput, setStrategyIdInput] = useState(strategyId ?? '')
  const [pairAddressInput, setPairAddressInput] = useState(pairAddress ?? '')

  const getAccount = async (): Promise<InjectedAccountWithMeta | null> => {
    if (!walletAddress) return null
    const accounts = await web3Accounts()
    return accounts.find(account => account.address === walletAddress) ?? null
  }

  const handleGenerate = async () => {
    if (!isConnected || !walletAddress) {
      setError('Connect your wallet first')
      return
    }

    if (!pairAddressInput.trim() || !strategyIdInput.trim()) {
      setError(
        'Provide both the strategy ID and pair address to complete delegated on-chain enforcement'
      )
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { key } = await createApiKey(walletAddress, signMessage)
      setApiKey(key)

      const delegationContext =
        await agentService.getAsymmetricDelegationContext(key)
      const account = await getAccount()
      if (!account) {
        throw new Error('Could not find wallet account to sign set_manager')
      }

      let api = contractService.getApi()
      if (!api) {
        await contractService.connect('testnet')
        api = contractService.getApi()
      }
      if (!api) {
        throw new Error('Could not connect to Lunes blockchain')
      }

      asymmetricContractService.setApi(api)
      const txHash = await asymmetricContractService.setManager(
        pairAddressInput.trim(),
        delegationContext.relayerAddress,
        guardrails,
        account
      )

      await agentService.linkAsymmetricStrategy(key, {
        strategyId: strategyIdInput.trim(),
        pairAddress: pairAddressInput.trim()
      })

      setSuccess(`Delegation enforced on-chain. Manager tx: ${txHash}`)
    } catch (err: any) {
      setError(err.message || 'Failed to complete delegated manager setup')
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
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Modal>
        <ModalHeader>
          <Title>Delegate to AI Agent</Title>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </ModalHeader>

        <Description>
          Generate a restricted API Key that allows an AI agent (OpenClaw,
          Phidata, etc.) to adjust curve parameters on your behalf. The agent{' '}
          <strong>cannot withdraw funds</strong> — only reshape the liquidity
          curve. This flow also applies <strong>`set_manager` on-chain</strong>{' '}
          so contract guardrails match the API scope.
        </Description>

        <Section>
          <SectionLabel>Strategy Context</SectionLabel>
          <Description>
            Use the registered backend strategy ID and the deployed
            `AsymmetricPair` contract address so the API key, backend record and
            on-chain manager all point to the same strategy.
          </Description>
          <TextInput
            value={strategyIdInput}
            onChange={e => setStrategyIdInput(e.target.value)}
            placeholder="Strategy ID"
          />
          <div style={{ height: 10 }} />
          <TextInput
            value={pairAddressInput}
            onChange={e => setPairAddressInput(e.target.value)}
            placeholder="AsymmetricPair contract address"
          />
        </Section>

        <Section>
          <SectionLabel>Guardrails — γ (Curvature) Limits</SectionLabel>

          <SliderRow>
            <SliderLabel>Minimum γ allowed</SliderLabel>
            <Slider
              type="range"
              min={1}
              max={5}
              value={guardrails.gammaMin}
              onChange={e =>
                setGuardrails(g => ({
                  ...g,
                  gammaMin: Math.min(Number(e.target.value), g.gammaMax)
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
              onChange={e =>
                setGuardrails(g => ({
                  ...g,
                  gammaMax: Math.max(Number(e.target.value), g.gammaMin)
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
                setGuardrails(g => ({
                  ...g,
                  canChangeCapacity: !g.canChangeCapacity
                }))
              }
            />
          </ToggleRow>
        </Section>

        {!apiKey ? (
          <Button
            onClick={handleGenerate}
            disabled={isLoading || !isConnected}
            loading={isLoading}
          >
            {!isConnected
              ? 'Connect Wallet First'
              : 'Delegate Manager & Generate API Key'}
          </Button>
        ) : (
          <ApiKeyBox>
            <ApiKeyLabel>
              API Key Generated — Copy and store it securely
            </ApiKeyLabel>
            <ApiKeyValue>{apiKey}</ApiKeyValue>
            <CopyButton onClick={handleCopy}>
              {copied ? '✓ Copied!' : 'Copy Key'}
            </CopyButton>
          </ApiKeyBox>
        )}

        {success && <SuccessMsg>{success}</SuccessMsg>}
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Modal>
    </Overlay>
  )
}

export default AgentDelegationPanel
