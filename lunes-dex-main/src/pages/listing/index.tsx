import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ImagePlus, X } from 'lucide-react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import { AnimatedNumber } from '../../components/ui/AnimatedNumber'
import {
  Button,
  C,
  Card,
  Col,
  EASE_OUT,
  H1,
  Input,
  Label,
  Muted,
  Notice,
  Page,
  Row,
  StatCard,
  StatLabel,
  StatValue,
  Sub,
  TabPanel,
  Textarea,
  grotesk,
  tabular
} from '../../components/ui/kit'
import { drawStroke, pop, successRing } from '../../styles/motion'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'

const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// ── Tier config (display mirror of backend TIER_CONFIG / listing_manager) ──

type TierKey = 'BASIC' | 'VERIFIED' | 'FEATURED'

const TIERS: {
  key: TierKey
  n: number
  label: string
  fee: number
  min: number
  lock: number
  desc: string
  staking: number
  treasury: number
  rewards: number
}[] = [
  {
    key: 'BASIC',
    n: 1,
    label: 'Basic',
    fee: 1_000,
    min: 10_000,
    lock: 90,
    desc: 'Entry-level listing. Token visible in search.',
    staking: 200,
    treasury: 500,
    rewards: 300
  },
  {
    key: 'VERIFIED',
    n: 2,
    label: 'Verified',
    fee: 5_000,
    min: 25_000,
    lock: 120,
    desc: 'Verified badge, trending section, DEX highlight.',
    staking: 1_000,
    treasury: 2_500,
    rewards: 1_500
  },
  {
    key: 'FEATURED',
    n: 3,
    label: 'Featured',
    fee: 20_000,
    min: 50_000,
    lock: 180,
    desc: 'Home highlight, reward campaigns, maximum exposure.',
    staking: 4_000,
    treasury: 10_000,
    rewards: 6_000
  }
]

const STEPS = ['Select tier', 'Liquidity', 'Details', 'Review']

type ListingForm = {
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

const MAX_LOGO_SIZE = 200 * 1024
const ACCEPTED_TYPES = ['image/svg+xml', 'image/png', 'image/webp']

const fmt = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })

type Done = {
  sym: string
  tier: string
  lunes: number
  lock: number
  id: string | null
}

// ── Styles ───────────────────────────────────────────────────────

const StepBar = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
`

const StepItem = styled.div<{ $on: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  > div {
    height: 4px;
    border-radius: 999px;
    background: ${p => (p.$on ? C.primary : C.border)};
    transition: background 300ms ${EASE_OUT};
  }
  > span {
    font-size: 12px;
    font-weight: 600;
    color: ${p => (p.$on ? '#fff' : C.muted)};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 479px) {
    > span b {
      display: none;
    }
  }
`

const TierGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  gap: 10px;
`

const TierBtn = styled.button<{ $on: boolean }>`
  text-align: left;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid ${p => (p.$on ? C.primary : C.border)};
  background: ${p => (p.$on ? 'rgba(108,56,255,0.12)' : C.surface)};
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition:
    border-color 150ms ease,
    background 150ms ease;
  &:hover {
    border-color: ${p => (p.$on ? C.primary : C.borderStrong)};
  }
`

const TierKicker = styled.span`
  font-size: 11px;
  font-weight: 700;
  color: ${C.primaryText};
`

const TierName = styled.span`
  ${grotesk};
  font-size: 20px;
  font-weight: 600;
`

const TierDesc = styled.span`
  font-size: 13px;
  color: ${C.secondary};
  line-height: 1.5;
  min-height: 40px;
`

const TierFacts = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  padding-top: 6px;
  border-top: 1px solid ${C.border};
  ${tabular};
  > span {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  > span > span:first-child {
    color: ${C.muted};
  }
  > span > span:last-child {
    font-weight: 600;
  }
`

const RowsCard = styled(Card)`
  padding: 16px;
  gap: 2px;
`

const RowsTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 6px;
`

const KvRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: 13px;
  ${tabular};
  & + & {
    border-top: 1px solid ${C.border};
  }
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    overflow-wrap: anywhere;
  }
`

const FormGrid = styled(Card)`
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
`

const FieldWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`

const FieldInput = styled(Input)<{ $error?: boolean }>`
  ${p =>
    p.$error &&
    css`
      border-color: rgba(255, 93, 105, 0.6);
    `}
`

const Hint = styled.span<{ $error?: boolean }>`
  font-size: 12px;
  color: ${p => (p.$error ? C.criticalText : C.muted)};
`

const DropZone = styled.div<{ $has: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px dashed ${p => (p.$has ? C.primary : C.borderStrong)};
  background: ${C.bg};
  cursor: pointer;
  &:hover,
  &:focus-visible {
    border-color: ${C.primary};
  }
  img {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }
`

const SuccessIcon = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${C.success};
  color: #0d0d0d;
  display: flex;
  align-items: center;
  justify-content: center;
  animation:
    ${pop} 450ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
    ${successRing} 1.2s ease-out 300ms 2;
  path {
    stroke-dasharray: 24;
    animation: ${drawStroke} 400ms ease 250ms both;
  }
`

const DoneGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  width: 100%;
`

const Nav = styled.div`
  display: flex;
  gap: 8px;
  > button:first-child:not(:last-child) {
    flex: 1;
  }
  > button:last-child {
    flex: 2;
  }
`

// ── Field helper ─────────────────────────────────────────────────

const Field: React.FC<{
  label: string
  name: keyof ListingForm
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  error?: boolean
  hint?: React.ReactNode
}> = ({
  label,
  name,
  value,
  onChange,
  placeholder,
  inputMode,
  error,
  hint
}) => (
  <FieldWrap>
    <Label htmlFor={`lst-${name}`}>{label}</Label>
    <FieldInput
      id={`lst-${name}`}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete="off"
      aria-invalid={error || undefined}
      $error={error}
    />
    {hint && <Hint $error={error}>{hint}</Hint>}
  </FieldWrap>
)

// ── Component ────────────────────────────────────────────────────

export const Listing: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const navigate = useNavigate()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk

  const [step, setStep] = useState(1)
  const [tierKey, setTierKey] = useState<TierKey>('BASIC')
  const [form, setForm] = useState<ListingForm>(initialForm)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [stats, setStats] = useState<{
    totalActiveLocks: number
    totalLockedLunes: string
  } | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const tier = TIERS.find(t => t.key === tierKey)!
  const lunes = parseFloat(form.lunesLiquidity) || 0
  const tokens = parseFloat(form.tokenLiquidity) || 0
  const unlock = fmtDate(new Date(Date.now() + tier.lock * 86_400_000))
  const lowLiq = form.lunesLiquidity !== '' && lunes < tier.min

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/listing/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => null)
  }, [])

  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview)
    },
    [logoPreview]
  )

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const pickLogo = useCallback((file: File) => {
    setLogoError(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Only SVG, PNG and WebP files are accepted.')
      return
    }
    if (file.size > MAX_LOGO_SIZE) {
      setLogoError(
        `File too large (${(file.size / 1024).toFixed(0)} KB). Max 200 KB.`
      )
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }, [])

  const stepOk =
    step === 1
      ? true
      : step === 2
        ? !!(
            form.tokenName.trim() &&
            form.tokenSymbol.trim() &&
            form.tokenAddress.trim() &&
            lunes >= tier.min &&
            tokens > 0
          )
        : step === 3
          ? !!(form.description.trim() && logoFile)
          : true

  // ── Submit (wraps the real signed listing API call) ──

  const submit = () => {
    const t = tier
    const f = { ...form }
    const l = lunes
    const logo = logoFile
    let listingId: string | null = null
    tx.run({
      type: 'other',
      title: 'Submitting listing',
      summary: `${f.tokenSymbol} · ${t.label} tier`,
      actTitle: `List ${f.tokenSymbol} (${t.label})`,
      successTitle: 'Listing submitted',
      steps: [
        {
          // Honest copy: this step signs an application message (no on-chain
          // fee or lock happens here — those settle on-chain after review).
          label: 'Sign listing application in your wallet',
          wallet: true,
          run: async ({ advance }) => {
            const s = sdkRef.current
            if (!s.walletAddress) throw new Error('Connect your wallet first')
            if (!logo) throw new Error('Token logo is required')
            const meta = createSignedActionMetadata()
            const signature = await s.signMessage(
              buildWalletActionMessage({
                action: 'listing.create',
                address: s.walletAddress,
                nonce: meta.nonce,
                timestamp: meta.timestamp,
                fields: {
                  tokenAddress: f.tokenAddress,
                  tokenName: f.tokenName,
                  tokenSymbol: f.tokenSymbol,
                  tier: t.key,
                  lunesLiquidity: f.lunesLiquidity,
                  tokenLiquidity: f.tokenLiquidity
                }
              })
            )
            advance()
            const fd = new FormData()
            fd.append('ownerAddress', s.walletAddress)
            fd.append('tokenAddress', f.tokenAddress)
            fd.append('tokenName', f.tokenName)
            fd.append('tokenSymbol', f.tokenSymbol)
            fd.append('tokenDecimals', String(parseInt(f.tokenDecimals) || 18))
            fd.append('tier', t.key)
            fd.append('lunesLiquidity', f.lunesLiquidity)
            fd.append('tokenLiquidity', f.tokenLiquidity)
            fd.append('nonce', meta.nonce)
            fd.append('timestamp', String(meta.timestamp))
            fd.append('signature', signature)
            if (f.description) fd.append('description', f.description)
            if (f.website) fd.append('website', f.website)
            fd.append('logo', logo)
            const res = await fetch(`${API_BASE}/api/v1/listing`, {
              method: 'POST',
              body: fd
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || 'Listing failed')
            listingId = data.listing?.id ?? null
            return true
          }
        },
        { label: 'Submitting application for review' }
      ],
      onSuccess: () =>
        setDone({
          sym: f.tokenSymbol,
          tier: t.label,
          lunes: l,
          lock: t.lock,
          id: listingId
        })
    })
  }

  const reset = () => {
    setDone(null)
    setStep(1)
    setForm(initialForm)
    setTierKey('BASIC')
    setLogoFile(null)
    setLogoPreview(null)
    setLogoError(null)
  }

  // ── CTA ──
  let cta: { label: string; ok: boolean; on?: () => void }
  if (step < 4)
    cta = { label: 'Continue', ok: stepOk, on: () => setStep(step + 1) }
  else if (!sdk.isConnected)
    cta = { label: 'Connect wallet', ok: true, on: () => sdk.connectWallet() }
  else
    cta = {
      label: `Submit listing (${fmt(tier.fee)} LUNES fee)`,
      ok: true,
      on: submit
    }
  if (step === 2 && !stepOk)
    cta.label =
      lunes > 0 && lunes < tier.min
        ? `Minimum ${fmt(tier.min)} LUNES`
        : 'Fill in token details'
  if (step === 3 && !stepOk)
    cta.label = !form.description.trim() ? 'Add a description' : 'Upload a logo'

  // ── Render ──

  const header = (
    <>
      <div>
        <H1>List a token</H1>
        <Sub>
          Secure listing with locked liquidity. Prevents rug pulls and builds
          trust from day one.
        </Sub>
      </div>
      <StepBar aria-label={`Step ${done ? 4 : step} of 4`}>
        {STEPS.map((l, i) => (
          <StepItem
            key={l}
            $on={!!done || i + 1 <= step}
            aria-current={i + 1 === step ? 'step' : undefined}
          >
            <div />
            <span>
              {i + 1}
              <b> · {l}</b>
            </span>
          </StepItem>
        ))}
      </StepBar>
    </>
  )

  if (done) {
    return (
      <Page $max={760}>
        {header}
        <Card
          style={{
            padding: 24,
            alignItems: 'center',
            textAlign: 'center',
            gap: 14
          }}
        >
          <SuccessIcon>
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </SuccessIcon>
          <span
            style={{
              fontFamily: 'Space Grotesk',
              fontSize: 22,
              fontWeight: 600
            }}
          >
            Listing application submitted
          </span>
          <span
            style={{
              fontSize: 14,
              color: C.secondary,
              maxWidth: 440,
              lineHeight: 1.55
            }}
          >
            {done.sym} is pending its liquidity proof. It becomes tradable once
            the pool is finalized and the {done.lock}-day lock starts.
          </span>
          <DoneGrid>
            <StatCard style={{ padding: '14px 16px' }}>
              <StatLabel>Tier</StatLabel>
              <StatValue style={{ fontSize: 20, color: C.primaryText2 }}>
                {done.tier}
              </StatValue>
            </StatCard>
            <StatCard style={{ padding: '14px 16px' }}>
              <StatLabel>Status</StatLabel>
              <StatValue style={{ fontSize: 20, color: C.warning }}>
                Pending proof
              </StatValue>
            </StatCard>
            <StatCard style={{ padding: '14px 16px' }}>
              <StatLabel>LUNES locked</StatLabel>
              <StatValue style={{ fontSize: 20 }}>
                <AnimatedNumber value={done.lunes} format={fmt} />
              </StatValue>
            </StatCard>
          </DoneGrid>
          {done.id && <Muted $size={12}>Listing ID · {done.id}</Muted>}
          <Row $gap={8} $wrap $justify="center">
            <Button variant="secondary" size="lg" onClick={reset}>
              Submit another token
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => navigate('/governance')}
            >
              Go to governance
            </Button>
          </Row>
        </Card>
      </Page>
    )
  }

  return (
    <Page $max={760}>
      {header}

      <TabPanel key={step}>
        {step === 1 && (
          <>
            <TierGrid role="radiogroup" aria-label="Listing tier">
              {TIERS.map(t => (
                <TierBtn
                  key={t.key}
                  role="radio"
                  aria-checked={t.key === tierKey}
                  $on={t.key === tierKey}
                  onClick={() => setTierKey(t.key)}
                >
                  <Row $justify="space-between">
                    <TierKicker>TIER {t.n}</TierKicker>
                    {t.key === tierKey && (
                      <Check size={16} color={C.primaryText} />
                    )}
                  </Row>
                  <TierName>{t.label}</TierName>
                  <TierDesc>{t.desc}</TierDesc>
                  <TierFacts>
                    <span>
                      <span>Listing fee</span>
                      <span>{fmt(t.fee)} LUNES</span>
                    </span>
                    <span>
                      <span>Min. LUNES locked</span>
                      <span>{fmt(t.min)} LUNES</span>
                    </span>
                    <span>
                      <span>Lock period</span>
                      <span>{t.lock} days</span>
                    </span>
                  </TierFacts>
                </TierBtn>
              ))}
            </TierGrid>
            <RowsCard>
              <RowsTitle>Fee distribution</RowsTitle>
              <KvRow>
                <span>Listing fee</span>
                <span>{fmt(tier.fee)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>→ Staking rewards (20%)</span>
                <span>{fmt(tier.staking)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>→ Treasury (50%)</span>
                <span>{fmt(tier.treasury)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>→ Rewards pool (30%)</span>
                <span>{fmt(tier.rewards)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>Minimum LUNES to lock</span>
                <span>{fmt(tier.min)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>Lock duration</span>
                <span>{tier.lock} days</span>
              </KvRow>
              <KvRow>
                <span>Estimated unlock</span>
                <span>{unlock}</span>
              </KvRow>
            </RowsCard>
            {stats && (
              <Muted $size={12}>
                {fmt(stats.totalActiveLocks)} pools with locked liquidity ·{' '}
                {fmt(parseFloat(stats.totalLockedLunes) || 0)} LUNES locked
              </Muted>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <FormGrid>
              <Field
                label="Token name"
                name="tokenName"
                value={form.tokenName}
                onChange={onChange}
                placeholder="Lunes Gold"
              />
              <Field
                label="Symbol"
                name="tokenSymbol"
                value={form.tokenSymbol}
                onChange={onChange}
                placeholder="LGLD"
              />
              <Field
                label="Contract address"
                name="tokenAddress"
                value={form.tokenAddress}
                onChange={onChange}
                placeholder="5F…"
              />
              <Field
                label="Token decimals"
                name="tokenDecimals"
                value={form.tokenDecimals}
                onChange={onChange}
                placeholder="18"
                inputMode="numeric"
              />
              <Field
                label="LUNES to lock"
                name="lunesLiquidity"
                value={form.lunesLiquidity}
                onChange={onChange}
                placeholder={String(tier.min)}
                inputMode="decimal"
                error={lowLiq}
                hint={
                  lowLiq
                    ? `Minimum ${fmt(tier.min)} LUNES`
                    : `Min. ${fmt(tier.min)} LUNES for ${tier.label}`
                }
              />
              <Field
                label="Tokens to pair"
                name="tokenLiquidity"
                value={form.tokenLiquidity}
                onChange={onChange}
                placeholder="500000"
                inputMode="decimal"
              />
            </FormGrid>
            {lowLiq && (
              <Notice $tone="warning" role="alert">
                <AlertTriangle size={16} />
                Minimum {fmt(tier.min)} LUNES required for the {tier.label}{' '}
                tier. You entered {fmt(lunes)}.
              </Notice>
            )}
          </>
        )}

        {step === 3 && (
          <Card style={{ padding: 18 }}>
            <FieldWrap>
              <Label>Token logo</Label>
              <DropZone
                $has={!!logoFile}
                role="button"
                tabIndex={0}
                onClick={() => logoInputRef.current?.click()}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    logoInputRef.current?.click()
                  }
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files?.[0]
                  if (file) pickLogo(file)
                }}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Token logo preview" />
                ) : (
                  <ImagePlus size={22} color={C.muted} />
                )}
                <Col $gap={2} style={{ flex: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {logoFile
                      ? logoFile.name
                      : 'Drag & drop or click to upload'}
                  </span>
                  <Muted $size={12}>
                    {logoFile
                      ? `${(logoFile.size / 1024).toFixed(1)} KB`
                      : 'SVG, PNG or WebP · max 200 KB · 256×256 recommended'}
                  </Muted>
                </Col>
                {logoFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove logo"
                    onClick={e => {
                      e.stopPropagation()
                      setLogoFile(null)
                      setLogoPreview(null)
                    }}
                  >
                    <X size={16} />
                  </Button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) pickLogo(file)
                    e.target.value = ''
                  }}
                />
              </DropZone>
              {logoError && <Hint $error>{logoError}</Hint>}
            </FieldWrap>
            <Field
              label="Website"
              name="website"
              value={form.website}
              onChange={onChange}
              placeholder="https://"
            />
            <Field
              label="X / Twitter"
              name="twitter"
              value={form.twitter}
              onChange={onChange}
              placeholder="@project"
            />
            <Field
              label="Telegram"
              name="telegram"
              value={form.telegram}
              onChange={onChange}
              placeholder="t.me/project"
            />
            <FieldWrap>
              <Label htmlFor="lst-description">Project description</Label>
              <Textarea
                id="lst-description"
                name="description"
                rows={3}
                value={form.description}
                onChange={onChange}
                placeholder="What the token does and who it is for"
              />
            </FieldWrap>
          </Card>
        )}

        {step === 4 && (
          <>
            <RowsCard>
              <RowsTitle>Review</RowsTitle>
              <KvRow>
                <span>Token</span>
                <span>
                  {form.tokenName || '—'} ({form.tokenSymbol || '—'})
                </span>
              </KvRow>
              <KvRow>
                <span>Contract</span>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                  {form.tokenAddress || '—'}
                </span>
              </KvRow>
              <KvRow>
                <span>Tier</span>
                <span style={{ color: C.primaryText2 }}>
                  {tier.label} (Tier {tier.n})
                </span>
              </KvRow>
              <KvRow>
                <span>LUNES to lock</span>
                <span>{fmt(lunes)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>Tokens to lock</span>
                <span>
                  {fmt(tokens)} {form.tokenSymbol}
                </span>
              </KvRow>
              <KvRow>
                <span>Lock duration</span>
                <span>{tier.lock} days</span>
              </KvRow>
              <KvRow>
                <span>Unlock date</span>
                <span>{unlock}</span>
              </KvRow>
              <KvRow>
                <span>Listing fee</span>
                <span>{fmt(tier.fee)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>Total LUNES required</span>
                <span style={{ fontWeight: 600 }}>
                  {fmt(tier.fee + lunes)} LUNES
                </span>
              </KvRow>
            </RowsCard>
            <RowsCard>
              <RowsTitle>What happens after submit</RowsTitle>
              <KvRow>
                <span>1. Fee paid and liquidity sent</span>
                <span>On submit</span>
              </KvRow>
              <KvRow>
                <span>2. Pool created with locked liquidity</span>
                <span>Next block</span>
              </KvRow>
              <KvRow>
                <span>3. Community vote</span>
                <span>14 days</span>
              </KvRow>
              <KvRow>
                <span>4. Lock period after activation</span>
                <span>{tier.lock} days</span>
              </KvRow>
            </RowsCard>
          </>
        )}
      </TabPanel>

      <Nav>
        {step > 1 && (
          <Button
            variant="secondary"
            size="xl"
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        )}
        <Button size="xl" block disabled={!cta.ok} onClick={cta.on}>
          {cta.label}
        </Button>
      </Nav>
    </Page>
  )
}

export default Listing
