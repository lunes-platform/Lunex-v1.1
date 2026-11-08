/**
 * Register strategy modal (prototype REGISTER STRATEGY).
 *
 * Name, type, risk, description and performance fee, plus the agent API key
 * the backend needs to authenticate the owner. Submission runs through the
 * shared tx flow (`useTx().run`) wrapping `strategyService.createStrategy`.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Dialog } from 'components/ui/Dialog'
import {
  Button,
  C,
  Col,
  Input,
  Label,
  Muted,
  Row,
  Textarea,
  grotesk,
  tabular
} from 'components/ui/kit'
import { useTx } from '../../context/TxContext'
import { useSDK } from '../../context/SDKContext'
import { useToast } from 'components/feedback/ToastProvider'
import strategyService, {
  Strategy,
  StrategyRiskLevel,
  StrategyType
} from '../../services/strategyService'
import { ChoiceChip, RISK_STYLE, TYPE_LABEL } from './shared'
import { requestWalletConnect } from 'pages/header/modals/wallets'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (strategy: Strategy) => void
  initialApiKey?: string
}

const TYPES: StrategyType[] = [
  'COPYTRADE',
  'MARKET_MAKER',
  'ARBITRAGE',
  'MOMENTUM',
  'HEDGE',
  'CUSTOM'
]
const RISKS: StrategyRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE']

const FieldLabel = styled(Label)`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-weight: 500;
`

const Range = styled.input`
  width: 100%;
  accent-color: ${C.primary};
  height: 20px;
`

const FeeValue = styled.span`
  ${grotesk};
  ${tabular};
  font-weight: 600;
  color: ${C.text};
`

const Check = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: ${C.secondary};
  cursor: pointer;
  input {
    width: 16px;
    height: 16px;
    accent-color: ${C.primary};
  }
`

const Advanced = styled.details`
  font-size: 13px;
  color: ${C.muted};
  summary {
    cursor: pointer;
    font-weight: 600;
    color: ${C.secondary};
    &:hover {
      color: ${C.text};
    }
  }
  > div {
    margin-top: 10px;
  }
`

const Mono = styled(Input)`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const EMPTY = {
  name: '',
  description: '',
  vaultAddress: '',
  apiKey: ''
}

const CreateStrategyModal: React.FC<Props> = ({
  open,
  onClose,
  onCreated,
  initialApiKey = ''
}) => {
  const { walletAddress } = useSDK()
  const { toast } = useToast()
  const tx = useTx()
  const [form, setForm] = useState({ ...EMPTY, apiKey: initialApiKey })
  const [type, setType] = useState<StrategyType>('COPYTRADE')
  const [risk, setRisk] = useState<StrategyRiskLevel>('MEDIUM')
  // PLACEHOLDER: no backend yet — the strategies API has no performance-fee
  // field, so the slider value is shown but not sent.
  const [fee, setFee] = useState(15)
  const [isPublic, setIsPublic] = useState(true)

  useEffect(() => {
    if (open && initialApiKey) setForm(f => ({ ...f, apiKey: initialApiKey }))
  }, [open, initialApiKey])

  const set =
    (k: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  const name = form.name.trim()
  const apiKey = form.apiKey.trim()

  const submit = () => {
    const params = {
      name,
      description: form.description.trim() || undefined,
      strategyType: type,
      riskLevel: risk,
      vaultAddress: form.vaultAddress.trim() || undefined,
      isPublic
    }
    onClose()
    tx.run({
      type: 'other',
      title: 'Registering strategy',
      summary: name,
      actTitle: `Register strategy ${name}`,
      successTitle: 'Strategy published',
      steps: [
        {
          label: 'Sign strategy registration',
          run: async () => {
            const created = await strategyService.createStrategy(params, apiKey)
            onCreated(created)
            return true
          }
        },
        { label: 'Publishing to the marketplace' }
      ],
      onSuccess: () => {
        setForm({ ...EMPTY, apiKey })
        setFee(15)
      }
    })
  }

  const connect = () =>
    requestWalletConnect().catch((e: unknown) =>
      toast(
        'error',
        'Could not connect wallet',
        e instanceof Error ? e.message : undefined
      )
    )

  let cta: { label: string; onClick?: () => void }
  if (!walletAddress) cta = { label: 'Connect wallet', onClick: connect }
  else if (!name) cta = { label: 'Enter a name' }
  else if (!apiKey) cta = { label: 'Enter your agent API key' }
  else cta = { label: 'Register strategy', onClick: submit }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Register strategy"
      description="Publish a strategy under your agent. Followers deploy it into their own copy vault."
      width={460}
    >
      <FieldLabel>
        Strategy name
        <Input
          value={form.name}
          onChange={set('name')}
          placeholder="My strategy"
          aria-label="Strategy name"
          maxLength={80}
        />
      </FieldLabel>

      <Col $gap={6}>
        <Label as="span">Type</Label>
        <Row $gap={6} $wrap role="radiogroup" aria-label="Strategy type">
          {TYPES.map(t => (
            <ChoiceChip
              key={t}
              role="radio"
              aria-checked={type === t}
              $active={type === t}
              onClick={() => setType(t)}
            >
              {TYPE_LABEL[t]}
            </ChoiceChip>
          ))}
        </Row>
      </Col>

      <Col $gap={6}>
        <Label as="span">Risk level</Label>
        <Row $gap={6} $wrap role="radiogroup" aria-label="Risk level">
          {RISKS.map(r => (
            <ChoiceChip
              key={r}
              role="radio"
              aria-checked={risk === r}
              $active={risk === r}
              onClick={() => setRisk(r)}
            >
              {RISK_STYLE[r].short}
            </ChoiceChip>
          ))}
        </Row>
      </Col>

      <FieldLabel>
        Description
        <Textarea
          value={form.description}
          onChange={set('description')}
          placeholder="How the strategy trades"
          rows={3}
          maxLength={500}
          style={{ minHeight: 84 }}
        />
      </FieldLabel>

      <Col $gap={6}>
        <Row $justify="space-between">
          <Muted>Performance fee</Muted>
          <FeeValue>{fee}%</FeeValue>
        </Row>
        <Range
          type="range"
          min={5}
          max={30}
          step={1}
          value={fee}
          onChange={e => setFee(+e.target.value)}
          aria-label="Performance fee"
        />
      </Col>

      <FieldLabel>
        Agent API key
        <Mono
          type="password"
          value={form.apiKey}
          onChange={set('apiKey')}
          placeholder="lnx_live_…"
          autoComplete="off"
          aria-label="Agent API key"
        />
        <Muted $size={12}>
          Authenticates the agent that owns this strategy.
        </Muted>
      </FieldLabel>

      <Advanced>
        <summary>Advanced</summary>
        <Col $gap={12}>
          <FieldLabel>
            CopyVault contract (optional)
            <Mono
              value={form.vaultAddress}
              onChange={set('vaultAddress')}
              placeholder="5… on-chain CopyVault address"
              aria-label="CopyVault contract address"
            />
          </FieldLabel>
          <Check>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
            />
            List publicly on the marketplace
          </Check>
        </Col>
      </Advanced>

      <Row $gap={8}>
        <Button
          variant="secondary"
          size="xl"
          style={{ flex: 1, fontSize: 14, borderRadius: 12 }}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="xl"
          style={{ flex: 1.5, fontSize: 16, borderRadius: 14 }}
          disabled={!cta.onClick}
          onClick={cta.onClick}
        >
          {cta.label}
        </Button>
      </Row>
    </Dialog>
  )
}

export default CreateStrategyModal
