import React, { useState } from 'react'
import styled from 'styled-components'
import strategyService, {
  StrategyType,
  StrategyRiskLevel
} from '../../services/strategyService'

// ─── Styled ──────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`

const Modal = styled.div`
  background: #1e1e1e;
  border: 1px solid #2a2a2c;
  border-radius: 24px;
  padding: 32px;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #2a2a2c transparent;
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 28px;
`

const Title = styled.h2`
  margin: 0 0 4px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
`

const Subtitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8a8a8e;
`

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: #8a8a8e;
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }
`

const Field = styled.div`
  margin-bottom: 18px;
`

const Label = styled.label`
  display: block;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #8a8a8e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
`

const Input = styled.input`
  width: 100%;
  background: #141414;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 12px 14px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
  &:focus {
    border-color: #7461ff;
  }
  &::placeholder {
    color: #555;
  }
  &:-webkit-autofill,
  &:-webkit-autofill:hover,
  &:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0 1000px #141414 inset;
    -webkit-text-fill-color: #ffffff;
    border-color: #2a2a2c;
    caret-color: #ffffff;
  }
`

const Textarea = styled.textarea`
  width: 100%;
  background: #141414;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 12px 14px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.15s;
  &:focus {
    border-color: #7461ff;
  }
  &::placeholder {
    color: #555;
  }
`

const Select = styled.select`
  width: 100%;
  background: #141414;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 12px 14px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  cursor: pointer;
  appearance: none;
  transition: border-color 0.15s;
  &:focus {
    border-color: #7461ff;
  }
  option {
    background: #1e1e1e;
  }
`

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
`

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #141414;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 12px 14px;
`

const ToggleLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #cccccc;
`

const ToggleHint = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #8a8a8e;
  margin-top: 2px;
`

const Toggle = styled.button<{ active: boolean }>`
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: ${({ active }) => (active ? '#7461FF' : '#2A2A2C')};
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ active }) => (active ? '23px' : '3px')};
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    transition: left 0.2s;
  }
`

const Divider = styled.div`
  height: 1px;
  background: #2a2a2c;
  margin: 20px 0;
`

const ErrorBanner = styled.div`
  background: rgba(255, 77, 77, 0.1);
  border: 1px solid rgba(255, 77, 77, 0.3);
  border-radius: 10px;
  padding: 10px 14px;
  color: #ff6b6b;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  margin-bottom: 16px;
`

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
`

const CancelBtn = styled.button`
  flex: 1;
  padding: 13px;
  border-radius: 12px;
  border: 1px solid #2a2a2c;
  background: transparent;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: #555;
    color: #cccccc;
  }
`

const SubmitBtn = styled.button`
  flex: 2;
  padding: 13px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #7461ff, #5a48e8);
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
  &:hover:not(:disabled) {
    opacity: 0.88;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

// ─── Types ───────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  onCreated: (strategy: any) => void
  initialApiKey?: string
}

interface FormState {
  name: string
  description: string
  strategyType: StrategyType
  riskLevel: StrategyRiskLevel
  vaultAddress: string
  isPublic: boolean
  apiKey: string
}

const STRATEGY_TYPE_LABELS: Record<StrategyType, string> = {
  COPYTRADE: 'CopyTrade',
  MARKET_MAKER: 'Market Maker',
  ARBITRAGE: 'Arbitrage',
  MOMENTUM: 'Momentum',
  HEDGE: 'Hedge',
  CUSTOM: 'Custom'
}

const RISK_LABELS: Record<StrategyRiskLevel, string> = {
  LOW: 'Low Risk — conservative, tight slippage limits',
  MEDIUM: 'Medium Risk — balanced, standard limits',
  HIGH: 'High Risk — aggressive, wider limits',
  AGGRESSIVE: 'Aggressive — maximum position sizes'
}

// ─── Component ───────────────────────────────────────────────────

const CreateStrategyModal: React.FC<Props> = ({
  onClose,
  onCreated,
  initialApiKey = ''
}) => {
  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    strategyType: 'MOMENTUM',
    riskLevel: 'MEDIUM',
    vaultAddress: '',
    isPublic: true,
    apiKey: initialApiKey
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set =
    (k: keyof FormState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Strategy name is required')
      return
    }
    if (!form.apiKey.trim()) {
      setError('API Key is required to register a strategy')
      return
    }
    setError(null)
    setLoading(true)

    try {
      const strategy = await strategyService.createStrategy(
        {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          strategyType: form.strategyType,
          riskLevel: form.riskLevel,
          vaultAddress: form.vaultAddress.trim() || undefined,
          isPublic: form.isPublic
        },
        form.apiKey.trim()
      )
      onCreated(strategy)
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to create strategy')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Modal>
        <Header>
          <div>
            <Title>Register Strategy</Title>
            <Subtitle>
              Publish your AI trading strategy to the marketplace
            </Subtitle>
          </div>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </Header>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Field>
          <Label>Strategy Name *</Label>
          <Input
            placeholder="e.g. LUNES Momentum Alpha"
            value={form.name}
            onChange={set('name')}
            maxLength={80}
          />
        </Field>

        <Field>
          <Label>Description</Label>
          <Textarea
            placeholder="Describe your strategy's approach, signals, and risk management…"
            value={form.description}
            onChange={set('description')}
            maxLength={500}
          />
        </Field>

        <TwoCol>
          <Field>
            <Label>Strategy Type</Label>
            <Select value={form.strategyType} onChange={set('strategyType')}>
              {(Object.keys(STRATEGY_TYPE_LABELS) as StrategyType[]).map(t => (
                <option key={t} value={t}>
                  {STRATEGY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>Risk Level</Label>
            <Select value={form.riskLevel} onChange={set('riskLevel')}>
              {(Object.keys(RISK_LABELS) as StrategyRiskLevel[]).map(r => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
        </TwoCol>

        {form.riskLevel && (
          <div
            style={{
              background: 'rgba(116,97,255,0.06)',
              border: '1px solid rgba(116,97,255,0.2)',
              borderRadius: 10,
              padding: '10px 14px',
              marginTop: -8,
              marginBottom: 18,
              fontFamily: 'Space Grotesk',
              fontSize: 12,
              color: '#9983FF'
            }}
          >
            {RISK_LABELS[form.riskLevel]}
          </div>
        )}

        <Field>
          <Label>CopyVault Contract Address (optional)</Label>
          <Input
            placeholder="5… (ink! CopyVault on-chain address)"
            value={form.vaultAddress}
            onChange={set('vaultAddress')}
          />
        </Field>

        <Field>
          <ToggleRow>
            <div>
              <ToggleLabel>Public marketplace listing</ToggleLabel>
              <ToggleHint>
                Allow anyone to view and follow this strategy
              </ToggleHint>
            </div>
            <Toggle
              active={form.isPublic}
              onClick={() => setForm(p => ({ ...p, isPublic: !p.isPublic }))}
            />
          </ToggleRow>
        </Field>

        <Divider />

        <Field>
          <Label>Agent API Key *</Label>
          <Input
            type="password"
            placeholder="lx_…"
            value={form.apiKey}
            onChange={set('apiKey')}
            autoComplete="off"
          />
          <div
            style={{
              fontFamily: 'Space Grotesk',
              fontSize: 11,
              color: '#555',
              marginTop: 6
            }}
          >
            Required to authenticate the agent that owns this strategy.
          </div>
        </Field>

        <Actions>
          <CancelBtn onClick={onClose}>Cancel</CancelBtn>
          <SubmitBtn onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating…' : 'Create Strategy'}
          </SubmitBtn>
        </Actions>
      </Modal>
    </Overlay>
  )
}

export default CreateStrategyModal
