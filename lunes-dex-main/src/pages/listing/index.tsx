import React, { useState, useEffect } from 'react'
import styled from 'styled-components'
import PageLayout from '../../components/layout'
import { useSDK } from '../../context/SDKContext'
import * as B from '../../components/bases'

const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// ── Tier config (mirrors backend TIER_CONFIG) ─────────────────────

const TIERS = [
  {
    key:          'BASIC',
    tierNumber:   1,
    label:        'Basic',
    listingFee:   1_000,
    minLunesLiq:  2_000,
    lockDays:     90,
    badge:        null as string | null,
    description:  'Entry-level listing. Token visible in search.',
    color:        '#6c38fe',
    burn:         500,
    treasury:     300,
    rewards:      200,
  },
  {
    key:          'VERIFIED',
    tierNumber:   2,
    label:        'Verified',
    listingFee:   5_000,
    minLunesLiq:  10_000,
    lockDays:     120,
    badge:        'verified',
    description:  'Verified badge, trending section, DEX highlight.',
    color:        '#00bfff',
    burn:         2_500,
    treasury:     1_500,
    rewards:      1_000,
  },
  {
    key:          'FEATURED',
    tierNumber:   3,
    label:        'Featured',
    listingFee:   20_000,
    minLunesLiq:  50_000,
    lockDays:     180,
    badge:        'featured',
    description:  'Home highlight, reward campaigns, maximum exposure.',
    color:        '#ffd700',
    burn:         10_000,
    treasury:     6_000,
    rewards:      4_000,
  },
] as const

type TierKey = 'BASIC' | 'VERIFIED' | 'FEATURED'

// ── Form type ─────────────────────────────────────────────────────

interface ListingForm {
  tokenName:      string
  tokenSymbol:    string
  tokenAddress:   string
  tokenDecimals:  string
  pairAddress:    string
  lpTokenAddress: string
  lpAmount:       string
  lunesLiquidity: string
  tokenLiquidity: string
  website:        string
  twitter:        string
  telegram:       string
  description:    string
}

const initialForm: ListingForm = {
  tokenName:      '',
  tokenSymbol:    '',
  tokenAddress:   '',
  tokenDecimals:  '18',
  pairAddress:    '',
  lpTokenAddress: '',
  lpAmount:       '',
  lunesLiquidity: '',
  tokenLiquidity: '',
  website:        '',
  twitter:        '',
  telegram:       '',
  description:    '',
}



// ── Styled components ─────────────────────────────────────────────

const Header = styled.div`
  text-align: center;
  margin-bottom: 24px;
`

const Title = styled.h1`
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 8px 0;
`

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  margin: 0;
  line-height: 1.5;
`

const StepsIndicator = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
`

const Step = styled.div<{ $active: boolean; $completed: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  background: ${props =>
    props.$completed ? '#00ff88' :
    props.$active ? 'linear-gradient(135deg, #6c38fe, #9d4edd)' :
    props.theme.colors.themeColors[400]};
  color: ${props => props.$completed ? '#000' : '#fff'};
  transition: all 0.3s;
`

const StepLine = styled.div<{ $completed: boolean }>`
  width: 40px;
  height: 2px;
  background: ${props => props.$completed ? '#00ff88' : props.theme.colors.themeColors[400]};
`

const StepLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin-top: 4px;
  text-align: center;
`

const StepWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
`

const FormSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const SectionTitle = styled.h3`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
`

const SectionSubtitle = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  margin: 0 0 16px 0;
`

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`

const FormGroup = styled.div<{ $fullWidth?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  grid-column: ${props => props.$fullWidth ? 'span 2' : 'span 1'};

  @media (max-width: 600px) {
    grid-column: span 1;
  }
`

const Label = styled.label`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  font-weight: 500;
`

const Input = styled.input`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px 14px;
  color: #fff;
  font-size: 14px;
  transition: border 0.2s;
  width: 100%;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #6c38fe;
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[200]};
  }
`

const TextArea = styled.textarea`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px 14px;
  color: #fff;
  font-size: 14px;
  min-height: 90px;
  resize: vertical;
  transition: border 0.2s;
  width: 100%;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #6c38fe;
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[200]};
  }
`

// ── Tier cards ────────────────────────────────────────────────────

const TiersGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`

const TierCard = styled.div<{ $selected: boolean; $color: string }>`
  border: 2px solid ${props => props.$selected ? props.$color : 'transparent'};
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 14px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;

  &:hover {
    border-color: ${props => props.$color}80;
    transform: translateY(-2px);
  }

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: ${props => props.$color};
    opacity: ${props => props.$selected ? 1 : 0.4};
  }
`

const TierBadge = styled.div<{ $color: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  background: ${props => props.$color}20;
  color: ${props => props.$color};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  text-transform: uppercase;
`

const TierName = styled.div`
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
`

const TierDesc = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  line-height: 1.4;
  margin-bottom: 12px;
`

const TierStats = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const TierStat = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[100]};

  span:last-child {
    color: #fff;
    font-weight: 500;
  }
`

const SelectedCheck = styled.div<{ $color: string }>`
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${props => props.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #000;
  font-weight: 700;
`

// ── Fee distribution ──────────────────────────────────────────────

const FeeBox = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 12px;
  padding: 16px;
`

const FeeTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const FeeRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[300]};

  &:last-child { border-bottom: none; }
`

const FeeValue = styled.span<{ $color?: string }>`
  color: ${props => props.$color || '#fff'};
  font-weight: 500;
`

// ── Lock info ─────────────────────────────────────────────────────

const LockBox = styled.div`
  background: linear-gradient(135deg, #6c38fe15, #9d4edd15);
  border: 1px solid #6c38fe40;
  border-radius: 12px;
  padding: 16px;
`

const LockTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const LockRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  padding: 5px 0;

  span:last-child {
    color: #fff;
    font-weight: 500;
  }
`

// ── Summary + misc ────────────────────────────────────────────────

const Summary = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 12px;
  padding: 20px;
`

const SummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 9px 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[300]};

  &:last-child { border-bottom: none; }
`

const SummaryValue = styled.span`
  color: #fff;
  font-weight: 500;
`

const TotalCost = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[300]};
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
`

const TotalLabel = styled.span`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
`

const TotalValue = styled.span`
  color: #00ff88;
  font-weight: 700;
  font-size: 18px;
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 4px;
`

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const SuccessBox = styled.div`
  text-align: center;
  padding: 40px 20px;
`

const SuccessIcon = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #00ff8820;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
  font-size: 40px;
`

const SuccessTitle = styled.h2`
  color: #00ff88;
  font-size: 22px;
  margin: 0 0 12px 0;
`

const SuccessText = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 20px 0;
`

const ListingIdBox = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 8px;
  padding: 10px 18px;
  display: inline-block;
  color: #fff;
  font-family: monospace;
  font-size: 13px;
  margin-bottom: 20px;
`

const LockSummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`

const LockSummaryCard = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 10px;
  padding: 12px;
  text-align: center;
`

const LockSummaryLabel = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 11px;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const LockSummaryValue = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
`

const ErrorMsg = styled.div`
  background: #ff4d4d20;
  border: 1px solid #ff4d4d40;
  border-radius: 8px;
  padding: 10px 14px;
  color: #ff6b6b;
  font-size: 13px;
`

// ── Component ─────────────────────────────────────────────────────

export const Listing: React.FC = () => {
  const sdk = useSDK()
  const [currentStep, setCurrentStep] = useState(1)
  const [selectedTier, setSelectedTier] = useState<TierKey>('BASIC')
  const [form, setForm] = useState<ListingForm>(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [listingId, setListingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ totalActiveLocks: number; totalLockedLunes: string } | null>(null)

  const tier = TIERS.find(t => t.key === selectedTier)!
  const unlockDate = new Date(Date.now() + tier.lockDays * 24 * 60 * 60 * 1000)
  const totalCost = tier.listingFee + tier.minLunesLiq

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/listing/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => null)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const validateStep = (step: number): boolean => {
    if (step === 1) return true // tier selection always valid
    if (step === 2) return !!(form.tokenName && form.tokenSymbol && form.tokenAddress && form.lunesLiquidity && form.tokenLiquidity && form.lpTokenAddress && form.lpAmount)
    if (step === 3) return !!(form.description)
    return true
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const payload = {
        ownerAddress:   sdk.selectedAccount?.address ?? '',
        tokenAddress:   form.tokenAddress,
        tokenName:      form.tokenName,
        tokenSymbol:    form.tokenSymbol,
        tokenDecimals:  parseInt(form.tokenDecimals) || 18,
        tier:           selectedTier,
        pairAddress:    form.pairAddress || undefined,
        lpTokenAddress: form.lpTokenAddress,
        lpAmount:       form.lpAmount,
        lunesLiquidity: form.lunesLiquidity,
        tokenLiquidity: form.tokenLiquidity,
      }

      const res = await fetch(`${API_BASE}/api/v1/listing`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Listing failed')

      setListingId(data.listing.id)
      setIsSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setIsSuccess(false)
    setCurrentStep(1)
    setForm(initialForm)
    setSelectedTier('BASIC')
    setListingId(null)
    setError(null)
  }

  // ── Step 1: Select Tier ───────────────────────────────────────

  const renderStep1 = () => (
    <FormSection>
      <div>
        <SectionTitle>Select Listing Tier</SectionTitle>
        <SectionSubtitle>Each tier requires locked LUNES liquidity. Higher tiers give more visibility.</SectionSubtitle>
      </div>

      <TiersGrid>
        {TIERS.map(t => (
          <TierCard
            key={t.key}
            $selected={selectedTier === t.key}
            $color={t.color}
            onClick={() => setSelectedTier(t.key as TierKey)}
          >
            {selectedTier === t.key && <SelectedCheck $color={t.color}>✓</SelectedCheck>}
            <TierBadge $color={t.color}>Tier {t.tierNumber}</TierBadge>
            <TierName>{t.label}</TierName>
            <TierDesc>{t.description}</TierDesc>
            <TierStats>
              <TierStat><span>Listing Fee</span><span>{t.listingFee.toLocaleString()} LUNES</span></TierStat>
              <TierStat><span>Min Liquidity</span><span>{t.minLunesLiq.toLocaleString()} LUNES</span></TierStat>
              <TierStat><span>Lock Period</span><span>{t.lockDays} days</span></TierStat>
            </TierStats>
          </TierCard>
        ))}
      </TiersGrid>

      <FeeBox>
        <FeeTitle>🔥 Fee Distribution — {tier.label} Tier</FeeTitle>
        <FeeRow>
          <span>Listing Fee</span>
          <FeeValue>{tier.listingFee.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
        <FeeRow>
          <span>🔥 Burn (50%)</span>
          <FeeValue $color="#ff6b6b">{tier.burn.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
        <FeeRow>
          <span>🏦 Treasury (30%)</span>
          <FeeValue $color="#ffd700">{tier.treasury.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
        <FeeRow>
          <span>🎁 Rewards Pool (20%)</span>
          <FeeValue $color="#00ff88">{tier.rewards.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
      </FeeBox>

      <LockBox>
        <LockTitle>🔒 Liquidity Lock</LockTitle>
        <LockRow><span>Minimum LUNES to lock</span><span>{tier.minLunesLiq.toLocaleString()} LUNES</span></LockRow>
        <LockRow><span>Lock duration</span><span>{tier.lockDays} days</span></LockRow>
        <LockRow><span>Estimated unlock date</span><span>{unlockDate.toLocaleDateString()}</span></LockRow>
        <LockRow><span>Pool type</span><span>TOKEN / LUNES</span></LockRow>
      </LockBox>

      {stats && (
        <FeeBox>
          <FeeTitle>📊 Protocol Listing Stats</FeeTitle>
          <FeeRow>
            <span>Active Locked Liquidity Pools</span>
            <FeeValue $color="#00ff88">{stats.totalActiveLocks}</FeeValue>
          </FeeRow>
          <FeeRow>
            <span>Total LUNES Locked</span>
            <FeeValue $color="#00bfff">{parseFloat(stats.totalLockedLunes).toLocaleString()} LUNES</FeeValue>
          </FeeRow>
        </FeeBox>
      )}
    </FormSection>
  )

  // ── Step 2: Token & Liquidity ─────────────────────────────────

  const renderStep2 = () => (
    <FormSection>
      <div>
        <SectionTitle>Token & Liquidity Information</SectionTitle>
        <SectionSubtitle>Provide your token details and the liquidity you will lock.</SectionSubtitle>
      </div>

      <FormGrid>
        <FormGroup>
          <Label>Token Name *</Label>
          <Input name="tokenName" value={form.tokenName} onChange={handleInputChange} placeholder="e.g. GameCoin" />
        </FormGroup>
        <FormGroup>
          <Label>Token Symbol *</Label>
          <Input name="tokenSymbol" value={form.tokenSymbol} onChange={handleInputChange} placeholder="e.g. GMC" />
        </FormGroup>
        <FormGroup $fullWidth>
          <Label>Token Contract Address *</Label>
          <Input name="tokenAddress" value={form.tokenAddress} onChange={handleInputChange} placeholder="5H1MJ5..." />
        </FormGroup>
        <FormGroup>
          <Label>Token Decimals</Label>
          <Input name="tokenDecimals" value={form.tokenDecimals} onChange={handleInputChange} type="number" placeholder="18" />
        </FormGroup>
        <FormGroup>
          <Label>Pair Address (after pool creation)</Label>
          <Input name="pairAddress" value={form.pairAddress} onChange={handleInputChange} placeholder="5F3sa2..." />
        </FormGroup>
        <FormGroup $fullWidth>
          <Label>LP Token Address *</Label>
          <Input name="lpTokenAddress" value={form.lpTokenAddress} onChange={handleInputChange} placeholder="LP token contract address" />
        </FormGroup>
      </FormGrid>

      <FeeBox>
        <FeeTitle>💧 Liquidity to Lock</FeeTitle>
        <FormGrid>
          <FormGroup>
            <Label>LUNES Amount * (min {tier.minLunesLiq.toLocaleString()})</Label>
            <Input
              name="lunesLiquidity"
              value={form.lunesLiquidity}
              onChange={handleInputChange}
              type="number"
              placeholder={`${tier.minLunesLiq}`}
            />
          </FormGroup>
          <FormGroup>
            <Label>Token Amount *</Label>
            <Input name="tokenLiquidity" value={form.tokenLiquidity} onChange={handleInputChange} type="number" placeholder="e.g. 1000000" />
          </FormGroup>
          <FormGroup $fullWidth>
            <Label>LP Tokens Received *</Label>
            <Input name="lpAmount" value={form.lpAmount} onChange={handleInputChange} type="number" placeholder="LP tokens after adding liquidity" />
          </FormGroup>
        </FormGrid>

        {form.lunesLiquidity && parseFloat(form.lunesLiquidity) < tier.minLunesLiq && (
          <ErrorMsg style={{ marginTop: 10 }}>
            ⚠ Minimum {tier.minLunesLiq.toLocaleString()} LUNES required for {tier.label} tier.
            You entered {parseFloat(form.lunesLiquidity).toLocaleString()} LUNES.
          </ErrorMsg>
        )}
      </FeeBox>
    </FormSection>
  )

  // ── Step 3: Project Details ───────────────────────────────────

  const renderStep3 = () => (
    <FormSection>
      <div>
        <SectionTitle>Project Details</SectionTitle>
        <SectionSubtitle>Help the community understand your project.</SectionSubtitle>
      </div>
      <FormGrid>
        <FormGroup $fullWidth>
          <Label>Description *</Label>
          <TextArea
            name="description"
            value={form.description}
            onChange={handleInputChange}
            placeholder="Describe your project, its use case, and why it should be listed on Lunex..."
          />
        </FormGroup>
        <FormGroup>
          <Label>Website</Label>
          <Input name="website" value={form.website} onChange={handleInputChange} placeholder="https://mytoken.io" />
        </FormGroup>
        <FormGroup>
          <Label>Twitter</Label>
          <Input name="twitter" value={form.twitter} onChange={handleInputChange} placeholder="@mytoken" />
        </FormGroup>
        <FormGroup>
          <Label>Telegram</Label>
          <Input name="telegram" value={form.telegram} onChange={handleInputChange} placeholder="t.me/mytoken" />
        </FormGroup>
      </FormGrid>
    </FormSection>
  )

  // ── Step 4: Review ────────────────────────────────────────────

  const renderStep4 = () => (
    <FormSection>
      <div>
        <SectionTitle>Review & Submit</SectionTitle>
        <SectionSubtitle>Confirm your listing details before submitting.</SectionSubtitle>
      </div>

      <Summary>
        <SummaryRow><span>Token</span><SummaryValue>{form.tokenName} ({form.tokenSymbol})</SummaryValue></SummaryRow>
        <SummaryRow>
          <span>Contract</span>
          <SummaryValue>{form.tokenAddress ? `${form.tokenAddress.slice(0, 8)}…${form.tokenAddress.slice(-6)}` : '-'}</SummaryValue>
        </SummaryRow>
        <SummaryRow><span>Tier</span><SummaryValue style={{ color: tier.color }}>{tier.label} (Tier {tier.tierNumber})</SummaryValue></SummaryRow>
        <SummaryRow><span>Lock Duration</span><SummaryValue>{tier.lockDays} days</SummaryValue></SummaryRow>
        <SummaryRow><span>Unlock Date</span><SummaryValue>{unlockDate.toLocaleDateString()}</SummaryValue></SummaryRow>
        <SummaryRow><span>LUNES to Lock</span><SummaryValue>{parseFloat(form.lunesLiquidity || '0').toLocaleString()} LUNES</SummaryValue></SummaryRow>
        <SummaryRow><span>Token to Lock</span><SummaryValue>{parseFloat(form.tokenLiquidity || '0').toLocaleString()} {form.tokenSymbol}</SummaryValue></SummaryRow>
      </Summary>

      <TotalCost>
        <TotalLabel>Total LUNES Required</TotalLabel>
        <TotalValue>{totalCost.toLocaleString()} LUNES</TotalValue>
      </TotalCost>

      <FeeBox>
        <FeeTitle>🔥 Fee Distribution</FeeTitle>
        <FeeRow><span>Listing Fee</span><FeeValue>{tier.listingFee.toLocaleString()} LUNES</FeeValue></FeeRow>
        <FeeRow><span>🔥 Burn (50%)</span><FeeValue $color="#ff6b6b">{tier.burn.toLocaleString()} LUNES</FeeValue></FeeRow>
        <FeeRow><span>🏦 Treasury (30%)</span><FeeValue $color="#ffd700">{tier.treasury.toLocaleString()} LUNES</FeeValue></FeeRow>
        <FeeRow><span>🎁 Rewards (20%)</span><FeeValue $color="#00ff88">{tier.rewards.toLocaleString()} LUNES</FeeValue></FeeRow>
      </FeeBox>

      <LockBox>
        <LockTitle>🔒 What Happens After Submit</LockTitle>
        <LockRow><span>1. Listing fee transferred</span><span>{tier.listingFee.toLocaleString()} LUNES</span></LockRow>
        <LockRow><span>2. TOKEN/LUNES pool created</span><span>✓</span></LockRow>
        <LockRow><span>3. LP tokens locked until</span><span>{unlockDate.toLocaleDateString()}</span></LockRow>
        <LockRow><span>4. Token becomes visible on DEX</span><span>✓</span></LockRow>
      </LockBox>

      {error && <ErrorMsg>{error}</ErrorMsg>}
    </FormSection>
  )

  const STEPS = ['Select Tier', 'Liquidity', 'Details', 'Review']

  // ── Success screen ────────────────────────────────────────────

  if (isSuccess) {
    return (
      <PageLayout maxWidth="600px">
        <SuccessBox>
          <SuccessIcon>🔒</SuccessIcon>
          <SuccessTitle>Token Listed!</SuccessTitle>
          <SuccessText>
            <strong>{form.tokenName} ({form.tokenSymbol})</strong> has been submitted for listing on Lunex DEX.<br /><br />
            Your liquidity of <strong>{parseFloat(form.lunesLiquidity).toLocaleString()} LUNES</strong> is now locked
            until <strong>{unlockDate.toLocaleDateString()}</strong> ({tier.lockDays} days).
            This protects users from rug pulls.
          </SuccessText>

          {listingId && <ListingIdBox>Listing ID: {listingId}</ListingIdBox>}

          <LockSummaryGrid>
            <LockSummaryCard>
              <LockSummaryLabel>Tier</LockSummaryLabel>
              <LockSummaryValue style={{ color: tier.color }}>{tier.label}</LockSummaryValue>
            </LockSummaryCard>
            <LockSummaryCard>
              <LockSummaryLabel>Locked Until</LockSummaryLabel>
              <LockSummaryValue>{unlockDate.toLocaleDateString()}</LockSummaryValue>
            </LockSummaryCard>
            <LockSummaryCard>
              <LockSummaryLabel>LUNES Locked</LockSummaryLabel>
              <LockSummaryValue>{parseFloat(form.lunesLiquidity).toLocaleString()}</LockSummaryValue>
            </LockSummaryCard>
          </LockSummaryGrid>

          <ButtonGroup style={{ justifyContent: 'center', marginTop: 24 }}>
            <B.Button status="secondary" onClick={handleReset}>List Another Token</B.Button>
          </ButtonGroup>
        </SuccessBox>
      </PageLayout>
    )
  }

  return (
    <PageLayout maxWidth="700px">
      <Header>
        <Title>List Your Token</Title>
        <Subtitle>
          Secure listing with locked liquidity. Prevent rug pulls and build trust with LUNES holders.
        </Subtitle>
      </Header>

      {!sdk.isConnected ? (
        <ConnectPrompt>
          <p>Connect your wallet to list a token on Lunex DEX</p>
          <B.Button onClick={sdk.connectWallet} margin="20px auto 0" width="auto" padding="16px 40px">
            Connect Wallet
          </B.Button>
        </ConnectPrompt>
      ) : (
        <>
          <StepsIndicator>
            {STEPS.map((label, i) => {
              const stepNum = i + 1
              const isActive    = currentStep === stepNum
              const isCompleted = currentStep > stepNum
              return (
                <React.Fragment key={stepNum}>
                  <StepWrapper>
                    <Step $active={isActive} $completed={isCompleted}>
                      {isCompleted ? '✓' : stepNum}
                    </Step>
                    <StepLabel>{label}</StepLabel>
                  </StepWrapper>
                  {i < STEPS.length - 1 && <StepLine $completed={isCompleted} />}
                </React.Fragment>
              )
            })}
          </StepsIndicator>

          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}

          <ButtonGroup>
            {currentStep > 1 && (
              <B.Button status="secondary" onClick={() => setCurrentStep(s => s - 1)}>Back</B.Button>
            )}
            {currentStep < 4 ? (
              <B.Button
                onClick={() => setCurrentStep(s => s + 1)}
                disabled={!validateStep(currentStep)}
              >
                Continue
              </B.Button>
            ) : (
              <B.Button onClick={handleSubmit} disabled={isSubmitting || !validateStep(2)}>
                {isSubmitting ? 'Submitting...' : `Submit Listing (${tier.listingFee.toLocaleString()} LUNES Fee)`}
              </B.Button>
            )}
          </ButtonGroup>
        </>
      )}
    </PageLayout>
  )
}

export default Listing
