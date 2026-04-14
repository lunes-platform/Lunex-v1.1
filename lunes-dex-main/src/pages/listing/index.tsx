import React, { useState, useEffect, useRef, useCallback } from 'react'
import styled from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'

const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// ── Tier config (mirrors backend TIER_CONFIG) ─────────────────────

const TIERS = [
  {
    key: 'BASIC',
    tierNumber: 1,
    label: 'Basic',
    listingFee: 1_000,
    minLunesLiq: 10_000,
    lockDays: 90,
    badge: null as string | null,
    description: 'Entry-level listing. Token visible in search.',
    color: '#6c38fe',
    staking: 200,
    treasury: 500,
    rewards: 300
  },
  {
    key: 'VERIFIED',
    tierNumber: 2,
    label: 'Verified',
    listingFee: 5_000,
    minLunesLiq: 25_000,
    lockDays: 120,
    badge: 'verified',
    description: 'Verified badge, trending section, DEX highlight.',
    color: '#00bfff',
    staking: 1_000,
    treasury: 2_500,
    rewards: 1_500
  },
  {
    key: 'FEATURED',
    tierNumber: 3,
    label: 'Featured',
    listingFee: 20_000,
    minLunesLiq: 50_000,
    lockDays: 180,
    badge: 'featured',
    description: 'Home highlight, reward campaigns, maximum exposure.',
    color: '#ffd700',
    staking: 4_000,
    treasury: 10_000,
    rewards: 6_000
  }
] as const

type TierKey = 'BASIC' | 'VERIFIED' | 'FEATURED'

// ── Form type ─────────────────────────────────────────────────────

interface ListingForm {
  tokenName: string
  tokenSymbol: string
  tokenAddress: string
  tokenDecimals: string
  lunesLiquidity: string
  tokenLiquidity: string
  website: string
  twitter: string
  telegram: string
  description: string
}

const initialForm: ListingForm = {
  tokenName: '',
  tokenSymbol: '',
  tokenAddress: '',
  tokenDecimals: '18',
  lunesLiquidity: '',
  tokenLiquidity: '',
  website: '',
  twitter: '',
  telegram: '',
  description: ''
}

// ── Styled components ─────────────────────────────────────────────

const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 80px 24px 48px;
`

const PageContainer = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const ContentBox = styled.div`
  max-width: 700px;
  margin: 0 auto;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #6c38ff, #ad87ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const Subtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8a8a8e;
  margin: 0;
  max-width: 560px;
  margin: 0 auto;
  line-height: 1.6;
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
    props.$completed
      ? '#00ff88'
      : props.$active
        ? 'linear-gradient(135deg, #6c38fe, #9d4edd)'
        : props.theme.colors.themeColors[400]};
  color: ${props => (props.$completed ? '#000' : '#fff')};
  transition: all 0.3s;
`

const StepLine = styled.div<{ $completed: boolean }>`
  width: 40px;
  height: 2px;
  background: ${props =>
    props.$completed ? '#00ff88' : props.theme.colors.themeColors[400]};
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
  grid-column: ${props => (props.$fullWidth ? 'span 2' : 'span 1')};

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
  border: 2px solid ${props => (props.$selected ? props.$color : 'transparent')};
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
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${props => props.$color};
    opacity: ${props => (props.$selected ? 1 : 0.4)};
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

  &:last-child {
    border-bottom: none;
  }
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

  &:last-child {
    border-bottom: none;
  }
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
  margin-top: 16px;

  & > button {
    flex: 1;
  }
`

const PrimaryBtn = styled.button<{ disabled?: boolean }>`
  height: 48px;
  padding: 0 32px;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  color: #fff;
  background: ${props => (props.disabled ? '#2a2a2c' : '#6c38fe')};
  opacity: ${props => (props.disabled ? 0.5 : 1)};
  pointer-events: ${props => (props.disabled ? 'none' : 'auto')};

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    opacity: 0.9;
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }
`

const SecondaryBtn = styled.button`
  height: 48px;
  padding: 0 32px;
  border: 1px solid #333;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  color: #ccc;
  background: transparent;

  &:hover {
    border-color: #6c38fe;
    color: #fff;
    background: rgba(108, 56, 254, 0.1);
  }
`

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`

const LogoUploadSection = styled.div`
  margin-top: 20px;
`

const DropZone = styled.div<{ $hasFile?: boolean }>`
  border: 2px dashed ${p => (p.$hasFile ? '#6c38fe' : '#333')};
  border-radius: 12px;
  padding: ${p => (p.$hasFile ? '12px' : '28px')};
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: ${p => (p.$hasFile ? 'rgba(108, 56, 254, 0.05)' : 'transparent')};

  &:hover {
    border-color: #6c38fe;
    background: rgba(108, 56, 254, 0.05);
  }
`

const DropZoneIcon = styled.div`
  font-size: 28px;
  margin-bottom: 8px;
`

const DropZoneText = styled.div`
  color: #ccc;
  font-size: 14px;
  font-weight: 500;
`

const DropZoneHint = styled.div`
  color: #666;
  font-size: 12px;
  margin-top: 4px;
`

const LogoPreviewBox = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`

const LogoPreviewImg = styled.img`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  background: #2a2a2c;
  border: 2px solid #6c38fe;
`

const LogoFileName = styled.div`
  color: #eee;
  font-size: 13px;
  font-weight: 500;
`

const LogoFileSize = styled.div`
  color: #888;
  font-size: 11px;
`

const RemoveBtn = styled.button`
  margin-left: auto;
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  &:hover {
    color: #ff4444;
  }
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
  const [stats, setStats] = useState<{
    totalActiveLocks: number
    totalLockedLunes: string
  } | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const tier = TIERS.find(t => t.key === selectedTier)!
  const unlockDate = new Date(Date.now() + tier.lockDays * 24 * 60 * 60 * 1000)
  const totalCost = tier.listingFee + tier.minLunesLiq

  const signListingCreate = useCallback(async () => {
    if (!sdk.walletAddress) {
      throw new Error('Connect your wallet first')
    }

    const metadata = createSignedActionMetadata()
    const signature = await sdk.signMessage(
      buildWalletActionMessage({
        action: 'listing.create',
        address: sdk.walletAddress,
        nonce: metadata.nonce,
        timestamp: metadata.timestamp,
        fields: {
          tokenAddress: form.tokenAddress,
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol,
          tier: selectedTier,
          lunesLiquidity: form.lunesLiquidity,
          tokenLiquidity: form.tokenLiquidity
        }
      })
    )

    return { ...metadata, signature }
  }, [form, sdk, selectedTier])

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/listing/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => null)
  }, [])

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const validateStep = (step: number): boolean => {
    if (step === 1) return true // tier selection always valid
    if (step === 2)
      return !!(
        form.tokenName &&
        form.tokenSymbol &&
        form.tokenAddress &&
        form.lunesLiquidity &&
        form.tokenLiquidity
      )
    if (step === 3) return !!form.description
    return true
  }

  const MAX_LOGO_SIZE = 200 * 1024 // 200 KB
  const ACCEPTED_TYPES = ['image/svg+xml', 'image/png', 'image/webp']

  const validateAndSetLogo = useCallback((file: File) => {
    setLogoError(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Only SVG, PNG and WebP files accepted.')
      return
    }
    if (file.size > MAX_LOGO_SIZE) {
      setLogoError(
        `File too large (${(file.size / 1024).toFixed(0)}KB). Max 200KB.`
      )
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) validateAndSetLogo(file)
    },
    [validateAndSetLogo]
  )

  const handleLogoSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) validateAndSetLogo(file)
    },
    [validateAndSetLogo]
  )

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    if (!sdk.walletAddress) {
      setError('Connect your wallet first')
      setIsSubmitting(false)
      return
    }
    if (!logoFile) {
      setLogoError('Token logo is required')
      setIsSubmitting(false)
      return
    }
    try {
      const auth = await signListingCreate()
      const fd = new FormData()
      fd.append('ownerAddress', sdk.walletAddress)
      fd.append('tokenAddress', form.tokenAddress)
      fd.append('tokenName', form.tokenName)
      fd.append('tokenSymbol', form.tokenSymbol)
      fd.append('tokenDecimals', String(parseInt(form.tokenDecimals) || 18))
      fd.append('tier', selectedTier)
      fd.append('lunesLiquidity', form.lunesLiquidity)
      fd.append('tokenLiquidity', form.tokenLiquidity)
      fd.append('nonce', auth.nonce)
      fd.append('timestamp', String(auth.timestamp))
      fd.append('signature', auth.signature)
      if (form.description) fd.append('description', form.description)
      if (form.website) fd.append('website', form.website)
      if (logoFile) fd.append('logo', logoFile)

      const res = await fetch(`${API_BASE}/api/v1/listing`, {
        method: 'POST',
        body: fd
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
    setLogoFile(null)
    setLogoPreview(null)
    setLogoError(null)
  }

  // ── Step 1: Select Tier ───────────────────────────────────────

  const renderStep1 = () => (
    <FormSection>
      <div>
        <SectionTitle>Select Listing Tier</SectionTitle>
        <SectionSubtitle>
          Each tier requires locked LUNES liquidity. Higher tiers give more
          visibility.
        </SectionSubtitle>
      </div>

      <TiersGrid>
        {TIERS.map(t => (
          <TierCard
            key={t.key}
            $selected={selectedTier === t.key}
            $color={t.color}
            onClick={() => setSelectedTier(t.key as TierKey)}
          >
            {selectedTier === t.key && (
              <SelectedCheck $color={t.color}>✓</SelectedCheck>
            )}
            <TierBadge $color={t.color}>Tier {t.tierNumber}</TierBadge>
            <TierName>{t.label}</TierName>
            <TierDesc>{t.description}</TierDesc>
            <TierStats>
              <TierStat>
                <span>Listing Fee</span>
                <span>{t.listingFee.toLocaleString()} LUNES</span>
              </TierStat>
              <TierStat>
                <span>Min Liquidity</span>
                <span>{t.minLunesLiq.toLocaleString()} LUNES</span>
              </TierStat>
              <TierStat>
                <span>Lock Period</span>
                <span>{t.lockDays} days</span>
              </TierStat>
            </TierStats>
          </TierCard>
        ))}
      </TiersGrid>

      <FeeBox>
        <FeeTitle>Fee Distribution — {tier.label} Tier</FeeTitle>
        <FeeRow>
          <span>Listing Fee</span>
          <FeeValue>{tier.listingFee.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Staking Pool (20%)</span>
          <FeeValue $color="#00bfff">
            {tier.staking.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Team Revenue (50%)</span>
          <FeeValue $color="#ffd700">
            {tier.treasury.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Rewards Pool (30%)</span>
          <FeeValue $color="#00ff88">
            {tier.rewards.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
      </FeeBox>

      <LockBox>
        <LockTitle>Liquidity Lock</LockTitle>
        <LockRow>
          <span>Minimum LUNES to lock</span>
          <span>{tier.minLunesLiq.toLocaleString()} LUNES</span>
        </LockRow>
        <LockRow>
          <span>Lock duration</span>
          <span>{tier.lockDays} days</span>
        </LockRow>
        <LockRow>
          <span>Estimated unlock date</span>
          <span>{unlockDate.toLocaleDateString()}</span>
        </LockRow>
        <LockRow>
          <span>Pool type</span>
          <span>TOKEN / LUNES</span>
        </LockRow>
      </LockBox>

      {stats && (
        <FeeBox>
          <FeeTitle>Protocol Listing Stats</FeeTitle>
          <FeeRow>
            <span>Active Locked Liquidity Pools</span>
            <FeeValue $color="#00ff88">{stats.totalActiveLocks}</FeeValue>
          </FeeRow>
          <FeeRow>
            <span>Total LUNES Locked</span>
            <FeeValue $color="#00bfff">
              {parseFloat(stats.totalLockedLunes).toLocaleString()} LUNES
            </FeeValue>
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
        <SectionSubtitle>
          Provide your token details and the liquidity you will lock.
        </SectionSubtitle>
      </div>

      <FormGrid>
        <FormGroup>
          <Label>Token Name *</Label>
          <Input
            name="tokenName"
            value={form.tokenName}
            onChange={handleInputChange}
            placeholder="e.g. GameCoin"
          />
        </FormGroup>
        <FormGroup>
          <Label>Token Symbol *</Label>
          <Input
            name="tokenSymbol"
            value={form.tokenSymbol}
            onChange={handleInputChange}
            placeholder="e.g. GMC"
          />
        </FormGroup>
        <FormGroup $fullWidth>
          <Label>Token Contract Address *</Label>
          <Input
            name="tokenAddress"
            value={form.tokenAddress}
            onChange={handleInputChange}
            placeholder="5H1MJ5..."
          />
        </FormGroup>
        <FormGroup>
          <Label>Token Decimals</Label>
          <Input
            name="tokenDecimals"
            value={form.tokenDecimals}
            onChange={handleInputChange}
            type="number"
            placeholder="18"
          />
        </FormGroup>
      </FormGrid>

      <FeeBox>
        <FeeTitle>Liquidity to Deposit</FeeTitle>
        <SectionSubtitle style={{ marginTop: 0, marginBottom: 14 }}>
          The system will automatically create the TOKEN/LUNES pool and lock
          liquidity for {tier.lockDays} days.
        </SectionSubtitle>
        <FormGrid>
          <FormGroup>
            <Label>
              LUNES Amount * (min {tier.minLunesLiq.toLocaleString()})
            </Label>
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
            <Input
              name="tokenLiquidity"
              value={form.tokenLiquidity}
              onChange={handleInputChange}
              type="number"
              placeholder="e.g. 1000000"
            />
          </FormGroup>
        </FormGrid>

        {form.lunesLiquidity &&
          parseFloat(form.lunesLiquidity) < tier.minLunesLiq && (
            <ErrorMsg style={{ marginTop: 10 }}>
              ⚠ Minimum {tier.minLunesLiq.toLocaleString()} LUNES required for{' '}
              {tier.label} tier. You entered{' '}
              {parseFloat(form.lunesLiquidity).toLocaleString()} LUNES.
            </ErrorMsg>
          )}
      </FeeBox>

      <LogoUploadSection>
        <Label>
          Token Logo <span style={{ color: '#ff4b55' }}>*</span>
        </Label>
        <DropZone
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => logoInputRef.current?.click()}
          $hasFile={!!logoFile}
        >
          {logoPreview ? (
            <LogoPreviewBox>
              <LogoPreviewImg src={logoPreview} alt="Token logo" />
              <div>
                <LogoFileName>{logoFile?.name}</LogoFileName>
                <LogoFileSize>
                  {((logoFile?.size ?? 0) / 1024).toFixed(1)} KB
                </LogoFileSize>
              </div>
              <RemoveBtn
                onClick={e => {
                  e.stopPropagation()
                  setLogoFile(null)
                  setLogoPreview(null)
                }}
              >
                ✕
              </RemoveBtn>
            </LogoPreviewBox>
          ) : (
            <>
              <DropZoneIcon>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </DropZoneIcon>
              <DropZoneText>Drag & drop or click to upload</DropZoneText>
              <DropZoneHint>
                SVG, PNG or WebP — max 200KB — 256×256 recommended
              </DropZoneHint>
            </>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleLogoSelect}
          />
        </DropZone>
        {logoError && <ErrorMsg>{logoError}</ErrorMsg>}
      </LogoUploadSection>
    </FormSection>
  )

  // ── Step 3: Project Details ───────────────────────────────────

  const renderStep3 = () => (
    <FormSection>
      <div>
        <SectionTitle>Project Details</SectionTitle>
        <SectionSubtitle>
          Help the community understand your project.
        </SectionSubtitle>
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
          <Input
            name="website"
            value={form.website}
            onChange={handleInputChange}
            placeholder="https://mytoken.io"
          />
        </FormGroup>
        <FormGroup>
          <Label>Twitter</Label>
          <Input
            name="twitter"
            value={form.twitter}
            onChange={handleInputChange}
            placeholder="@mytoken"
          />
        </FormGroup>
        <FormGroup>
          <Label>Telegram</Label>
          <Input
            name="telegram"
            value={form.telegram}
            onChange={handleInputChange}
            placeholder="t.me/mytoken"
          />
        </FormGroup>
      </FormGrid>
    </FormSection>
  )

  // ── Step 4: Review ────────────────────────────────────────────

  const renderStep4 = () => (
    <FormSection>
      <div>
        <SectionTitle>Review & Submit</SectionTitle>
        <SectionSubtitle>
          Confirm your listing details before submitting.
        </SectionSubtitle>
      </div>

      <Summary>
        <SummaryRow>
          <span>Token</span>
          <SummaryValue>
            {form.tokenName} ({form.tokenSymbol})
          </SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>Contract</span>
          <SummaryValue>
            {form.tokenAddress
              ? `${form.tokenAddress.slice(0, 8)}…${form.tokenAddress.slice(-6)}`
              : '-'}
          </SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>Tier</span>
          <SummaryValue style={{ color: tier.color }}>
            {tier.label} (Tier {tier.tierNumber})
          </SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>Lock Duration</span>
          <SummaryValue>{tier.lockDays} days</SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>Unlock Date</span>
          <SummaryValue>{unlockDate.toLocaleDateString()}</SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>LUNES to Lock</span>
          <SummaryValue>
            {parseFloat(form.lunesLiquidity || '0').toLocaleString()} LUNES
          </SummaryValue>
        </SummaryRow>
        <SummaryRow>
          <span>Token to Lock</span>
          <SummaryValue>
            {parseFloat(form.tokenLiquidity || '0').toLocaleString()}{' '}
            {form.tokenSymbol}
          </SummaryValue>
        </SummaryRow>
      </Summary>

      <TotalCost>
        <TotalLabel>Total LUNES Required</TotalLabel>
        <TotalValue>{totalCost.toLocaleString()} LUNES</TotalValue>
      </TotalCost>

      <FeeBox>
        <FeeTitle>Fee Distribution</FeeTitle>
        <FeeRow>
          <span>Listing Fee</span>
          <FeeValue>{tier.listingFee.toLocaleString()} LUNES</FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Staking Pool (20%)</span>
          <FeeValue $color="#00bfff">
            {tier.staking.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Team Revenue (50%)</span>
          <FeeValue $color="#ffd700">
            {tier.treasury.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
        <FeeRow>
          <span>Rewards (30%)</span>
          <FeeValue $color="#00ff88">
            {tier.rewards.toLocaleString()} LUNES
          </FeeValue>
        </FeeRow>
      </FeeBox>

      <LockBox>
        <LockTitle>What Happens After Submit</LockTitle>
        <LockRow>
          <span>1. Listing fee deducted</span>
          <span>{tier.listingFee.toLocaleString()} LUNES</span>
        </LockRow>
        <LockRow>
          <span>2. Pool created automatically</span>
          <span>{form.tokenSymbol || 'TOKEN'} / LUNES</span>
        </LockRow>
        <LockRow>
          <span>3. Liquidity deposited</span>
          <span>
            {parseFloat(form.lunesLiquidity || '0').toLocaleString()} LUNES
          </span>
        </LockRow>
        <LockRow>
          <span>4. LP tokens locked until</span>
          <span>{unlockDate.toLocaleDateString()}</span>
        </LockRow>
        <LockRow>
          <span>5. Token visible on DEX</span>
          <span>✓</span>
        </LockRow>
      </LockBox>

      {error && <ErrorMsg>{error}</ErrorMsg>}
    </FormSection>
  )

  const STEPS = ['Select Tier', 'Liquidity', 'Details', 'Review']

  // ── Success screen ────────────────────────────────────────────

  if (isSuccess) {
    return (
      <Page>
        <PageContainer>
          <HeroBanner>
            <Title>
              <span>List Your Token</span>
            </Title>
            <Subtitle>
              Secure listing with locked liquidity. Prevent rug pulls and build
              trust with LUNES holders.
            </Subtitle>
          </HeroBanner>
          <ContentBox>
            <SuccessBox>
              <SuccessIcon>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00ff88"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 12 15 16 10" stroke="#00ff88" />
                </svg>
              </SuccessIcon>
              <SuccessTitle>Token Listed!</SuccessTitle>
              <SuccessText>
                <strong>
                  {form.tokenName} ({form.tokenSymbol})
                </strong>{' '}
                has been submitted for listing on Lunex DEX.
                <br />
                <br />
                Your liquidity of{' '}
                <strong>
                  {parseFloat(form.lunesLiquidity).toLocaleString()} LUNES
                </strong>{' '}
                is now locked until{' '}
                <strong>{unlockDate.toLocaleDateString()}</strong> (
                {tier.lockDays} days). This protects users from rug pulls.
              </SuccessText>

              {listingId && (
                <ListingIdBox>Listing ID: {listingId}</ListingIdBox>
              )}

              <LockSummaryGrid>
                <LockSummaryCard>
                  <LockSummaryLabel>Tier</LockSummaryLabel>
                  <LockSummaryValue style={{ color: tier.color }}>
                    {tier.label}
                  </LockSummaryValue>
                </LockSummaryCard>
                <LockSummaryCard>
                  <LockSummaryLabel>Locked Until</LockSummaryLabel>
                  <LockSummaryValue>
                    {unlockDate.toLocaleDateString()}
                  </LockSummaryValue>
                </LockSummaryCard>
                <LockSummaryCard>
                  <LockSummaryLabel>LUNES Locked</LockSummaryLabel>
                  <LockSummaryValue>
                    {parseFloat(form.lunesLiquidity).toLocaleString()}
                  </LockSummaryValue>
                </LockSummaryCard>
              </LockSummaryGrid>

              <ButtonGroup
                style={{
                  justifyContent: 'center',
                  marginTop: 24,
                  maxWidth: 300,
                  margin: '24px auto 0'
                }}
              >
                <SecondaryBtn onClick={handleReset}>
                  List Another Token
                </SecondaryBtn>
              </ButtonGroup>
            </SuccessBox>
          </ContentBox>
        </PageContainer>
      </Page>
    )
  }

  return (
    <Page>
      <PageContainer>
        <HeroBanner>
          <Title>
            <span>List Your Token</span>
          </Title>
          <Subtitle>
            Secure listing with locked liquidity. Prevent rug pulls and build
            trust with LUNES holders.
          </Subtitle>
        </HeroBanner>
        <ContentBox>
          {!sdk.isConnected ? (
            <ConnectPrompt>
              <p>Connect your wallet to list a token on Lunex DEX</p>
              <PrimaryBtn onClick={() => sdk.connectWallet()}>
                Connect Wallet
              </PrimaryBtn>
            </ConnectPrompt>
          ) : (
            <>
              <StepsIndicator>
                {STEPS.map((label, i) => {
                  const stepNum = i + 1
                  const isActive = currentStep === stepNum
                  const isCompleted = currentStep > stepNum
                  return (
                    <React.Fragment key={stepNum}>
                      <StepWrapper>
                        <Step $active={isActive} $completed={isCompleted}>
                          {isCompleted ? '✓' : stepNum}
                        </Step>
                        <StepLabel>{label}</StepLabel>
                      </StepWrapper>
                      {i < STEPS.length - 1 && (
                        <StepLine $completed={isCompleted} />
                      )}
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
                  <SecondaryBtn onClick={() => setCurrentStep(s => s - 1)}>
                    Back
                  </SecondaryBtn>
                )}
                {currentStep < 4 ? (
                  <PrimaryBtn
                    onClick={() => setCurrentStep(s => s + 1)}
                    disabled={!validateStep(currentStep)}
                  >
                    Continue
                  </PrimaryBtn>
                ) : (
                  <PrimaryBtn
                    onClick={handleSubmit}
                    disabled={isSubmitting || !validateStep(2)}
                  >
                    {isSubmitting
                      ? 'Submitting...'
                      : `Submit Listing (${tier.listingFee.toLocaleString()} LUNES Fee)`}
                  </PrimaryBtn>
                )}
              </ButtonGroup>
            </>
          )}
        </ContentBox>
      </PageContainer>
    </Page>
  )
}

export default Listing
