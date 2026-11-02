import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ImagePlus, X } from 'lucide-react'
import { decodeAddress } from '@polkadot/util-crypto'
import { u8aEq } from '@polkadot/util'
import { useSDK } from '../../context/SDKContext'
import { useTx, shortHash } from '../../context/TxContext'
import type { TxStep } from '../../context/TxContext'
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
import { requestWalletConnect } from 'pages/header/modals/wallets'
import { TOKENS } from '../../config/contracts'
import contractService from '../../services/contractService'
import {
  LISTING_FEE_TOKEN,
  LISTING_MANAGER_ADDRESS,
  type ListingTierNumber,
  type OnChainTierConfig,
  approveForListing,
  isListingContractConfigured,
  listToken,
  readAllowance,
  readIsPaused,
  readTierConfig,
  readTokenListing
} from '../../services/listingContractService'

const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// ── Tiers ────────────────────────────────────────────────────────
// Labels only. Fee, minimum liquidity and lock period come from the
// ListingManager `tier_config` (source of truth), falling back to the
// spot-api tier config for display when the contract is not reachable.

type TierKey = 'BASIC' | 'VERIFIED' | 'FEATURED'

const TIERS: {
  key: TierKey
  n: ListingTierNumber
  label: string
  desc: string
}[] = [
  {
    key: 'BASIC',
    n: 1,
    label: 'Basic',
    desc: 'Entry-level listing. Token visible in search.'
  },
  {
    key: 'VERIFIED',
    n: 2,
    label: 'Verified',
    desc: 'Verified badge, trending section, DEX highlight.'
  },
  {
    key: 'FEATURED',
    n: 3,
    label: 'Featured',
    desc: 'Home highlight, reward campaigns, maximum exposure.'
  }
]

// Fee split applied on-chain by list_token (basis points, display only)
const SPLIT = { staking: 2_000, treasury: 5_000, rewards: 3_000 }

/** Display numbers for a tier (whole LUNES / days). */
type TierView = { fee: number; min: number; lock: number }

type ApiTier = {
  tierNumber: number
  listingFee: number
  minLunesLiq: number
  lockDays: number
}

const STEPS = ['Select tier', 'Liquidity', 'Details', 'Review']

const CONTRACT_MISSING =
  'On-chain listing opens soon — the listing contract is not deployed on this network yet.'

type ListingForm = {
  tokenName: string
  tokenSymbol: string
  tokenAddress: string
  tokenDecimals: string
  website: string
  twitter: string
  telegram: string
  description: string
}

const initialForm: ListingForm = {
  tokenName: '',
  tokenSymbol: '',
  tokenAddress: '',
  tokenDecimals: '',
  website: '',
  twitter: '',
  telegram: '',
  description: ''
}

/** The connected wallet's LP position in the TOKEN/WLUNES pool. */
type LpHolding = {
  pair: string
  lp: bigint
  lunesRaw: bigint
  tokenRaw: bigint
}
type LpPosition =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'nopair' }
  | { status: 'error' }
  | ({ status: 'nolp' } & LpHolding)
  | ({ status: 'ok' } & LpHolding)

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

/** Raw base units → exact decimal string (no float rounding). */
const toDecimalString = (raw: bigint, decimals: number) => {
  const base = BigInt(10) ** BigInt(decimals)
  const whole = raw / base
  const frac = (raw % base).toString().padStart(decimals, '0')
  const trimmed = frac.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole.toString()
}
const toNum = (raw: bigint, decimals: number) =>
  Number(toDecimalString(raw, decimals))

const looksLikeAddress = (a: string) => {
  try {
    return decodeAddress(a.trim()).length === 32
  } catch {
    return false
  }
}
const sameAddress = (a: string, b: string) => {
  try {
    return u8aEq(decodeAddress(a), decodeAddress(b))
  } catch {
    return false
  }
}

type Done = {
  sym: string
  tier: string
  lunes: number
  lock: number
  id: string | null
  onChainId: number
  txHash: string | null
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

  // On-chain state (ListingManager is the source of truth)
  const configured = isListingContractConfigured()
  const [chainTiers, setChainTiers] = useState<Record<
    number,
    OnChainTierConfig
  > | null>(null)
  const [apiTiers, setApiTiers] = useState<Record<number, ApiTier> | null>(null)
  const [paused, setPaused] = useState(false)
  const [feeDecimals, setFeeDecimals] = useState<number | null>(null)
  const [feeSymbol, setFeeSymbol] = useState('LUNES')
  const [wlunesDecimals, setWlunesDecimals] = useState<number | null>(null)
  const [feeBalance, setFeeBalance] = useState<bigint | null>(null)
  const [pos, setPos] = useState<LpPosition>({ status: 'idle' })
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preflight, setPreflight] = useState(false)
  /** list_token finalized for this token in this session → never pay twice */
  const paidRef = useRef<{
    token: string
    txHash: string
    onChainId: number
  } | null>(null)

  const tier = TIERS.find(t => t.key === tierKey)!
  const chainCfg = chainTiers?.[tier.n] ?? null

  const viewOf = (n: number): TierView | null => {
    const c = chainTiers?.[n]
    if (c && feeDecimals !== null)
      return {
        fee: toNum(c.listingFee, feeDecimals),
        min: toNum(c.minLunesLiq, wlunesDecimals ?? feeDecimals),
        lock: Math.round(c.lockDurationMs / 86_400_000)
      }
    const a = apiTiers?.[n]
    if (a) return { fee: a.listingFee, min: a.minLunesLiq, lock: a.lockDays }
    return null
  }
  const view = viewOf(tier.n)
  const unlock = view
    ? fmtDate(new Date(Date.now() + view.lock * 86_400_000))
    : '—'
  const feeLabel = (v: TierView | null) =>
    v ? `${fmt(v.fee)} ${feeSymbol}` : '—'

  // ── Loads ──

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/listing/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => null)
    fetch(`${API_BASE}/api/v1/listing/tiers`)
      .then(r => r.json())
      .then((d: { tiers?: ApiTier[] }) => {
        const m: Record<number, ApiTier> = {}
        for (const t of d.tiers ?? []) m[t.tierNumber] = t
        setApiTiers(m)
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    let alive = true
    const s = sdkRef.current
    s.getTokenInfo(TOKENS.WLUNES)
      .then(i => alive && i && setWlunesDecimals(i.decimals))
      .catch(() => null)
    if (!configured) return
    s.getTokenInfo(LISTING_FEE_TOKEN)
      .then(i => {
        if (!alive || !i) return
        setFeeDecimals(i.decimals)
        if (i.symbol && i.symbol !== '???') setFeeSymbol(i.symbol)
      })
      .catch(() => null)
    Promise.all(TIERS.map(t => readTierConfig(t.n)))
      .then(cfgs => {
        if (!alive) return
        const m: Record<number, OnChainTierConfig> = {}
        TIERS.forEach((t, i) => (m[t.n] = cfgs[i]))
        setChainTiers(m)
      })
      .catch(() => null)
    readIsPaused()
      .then(p => alive && setPaused(p))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [configured])

  // Fee token balance of the connected wallet
  const wallet = sdk.walletAddress
  useEffect(() => {
    setFeeBalance(null)
    if (!wallet || !configured) return
    let alive = true
    sdkRef.current
      .getTokenBalance(LISTING_FEE_TOKEN, wallet)
      .then(b => alive && setFeeBalance(BigInt(b || '0')))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [wallet, configured, done])

  // LP position for TOKEN/WLUNES (the amount to lock = full LP balance)
  const tokenAddr = form.tokenAddress.trim()
  const [posTick, setPosTick] = useState(0)
  useEffect(() => {
    if (!wallet || !looksLikeAddress(tokenAddr)) {
      setPos({ status: 'idle' })
      return
    }
    let alive = true
    setPos({ status: 'loading' })
    const t = setTimeout(async () => {
      try {
        const s = sdkRef.current
        const info = await s.getPairInfo(tokenAddr, TOKENS.WLUNES)
        if (!alive) return
        if (!info) return setPos({ status: 'nopair' })
        const [lpStr, token0] = await Promise.all([
          s.getTokenBalance(info.address, wallet),
          contractService.getPairToken0(info.address)
        ])
        if (!alive) return
        const lp = BigInt(lpStr || '0')
        const supply = BigInt(info.totalSupply || '0')
        const r0 = BigInt(info.reserve0 || '0')
        const r1 = BigInt(info.reserve1 || '0')
        const wIs0 = !!token0 && sameAddress(token0, TOKENS.WLUNES)
        const [rw, rt] = wIs0 ? [r0, r1] : [r1, r0]
        const share = (r: bigint) =>
          supply > BigInt(0) ? (r * lp) / supply : BigInt(0)
        const holding: LpHolding = {
          pair: info.address,
          lp,
          lunesRaw: share(rw),
          tokenRaw: share(rt)
        }
        setPos(
          lp > BigInt(0)
            ? { status: 'ok', ...holding }
            : { status: 'nolp', ...holding }
        )
      } catch {
        if (alive) setPos({ status: 'error' })
      }
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [wallet, tokenAddr, posTick])

  // Prefill token metadata from chain
  useEffect(() => {
    if (!looksLikeAddress(tokenAddr)) return
    let alive = true
    sdkRef.current
      .getTokenInfo(tokenAddr)
      .then(i => {
        if (!alive || !i) return
        setForm(prev =>
          prev.tokenAddress.trim() !== tokenAddr
            ? prev
            : {
                ...prev,
                tokenName:
                  prev.tokenName ||
                  (i.name !== 'Unknown' ? i.name : prev.tokenName),
                tokenSymbol:
                  prev.tokenSymbol ||
                  (i.symbol !== '???' ? i.symbol : prev.tokenSymbol),
                tokenDecimals: prev.tokenDecimals || String(i.decimals)
              }
        )
      })
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [tokenAddr])

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

  // ── Derived liquidity numbers ──

  const tokenDecimals = parseInt(form.tokenDecimals, 10)
  const decOk = Number.isInteger(tokenDecimals) && tokenDecimals >= 0
  const lpOk = pos.status === 'ok'
  const lunesRaw = lpOk ? pos.lunesRaw : BigInt(0)
  const tokenRaw = lpOk ? pos.tokenRaw : BigInt(0)
  const lunes = wlunesDecimals !== null ? toNum(lunesRaw, wlunesDecimals) : 0
  const tokens = decOk ? toNum(tokenRaw, tokenDecimals) : 0
  // Minimum check: on-chain raw units when available, API config otherwise
  const meetsMin = chainCfg
    ? lunesRaw >= chainCfg.minLunesLiq
    : view
      ? lunes >= view.min
      : false
  const lowLiq = lpOk && !meetsMin
  const feeShort =
    !!chainCfg && feeBalance !== null && feeBalance < chainCfg.listingFee
  const poolLink = `/pool?a=${encodeURIComponent(tokenAddr)}&b=WLUNES`

  const stepOk =
    step === 1
      ? true
      : step === 2
        ? !!(
            form.tokenName.trim() &&
            form.tokenSymbol.trim() &&
            looksLikeAddress(tokenAddr) &&
            decOk &&
            lpOk &&
            wlunesDecimals !== null &&
            meetsMin
          )
        : step === 3
          ? !!(form.description.trim() && logoFile)
          : true

  // ── Submit: approve fee → approve LP → list_token → register ──

  const submit = async () => {
    const s = sdkRef.current
    const owner = s.walletAddress
    const cfg = chainCfg
    if (!owner || !cfg || pos.status !== 'ok' || wlunesDecimals === null) return
    const t = tier
    const v = view
    const f = { ...form, tokenAddress: tokenAddr }
    const p = pos
    const logo = logoFile
    const lunesStr = toDecimalString(p.lunesRaw, wlunesDecimals)
    const tokenStr = toDecimalString(p.tokenRaw, tokenDecimals)
    setSubmitError(null)

    // Preflight: allowances + whether this token is already listed on-chain
    setPreflight(true)
    let feeAllow: bigint
    let lpAllow: bigint
    try {
      const [fa, la, existing] = await Promise.all([
        readAllowance(LISTING_FEE_TOKEN, owner),
        readAllowance(p.pair, owner),
        readTokenListing(f.tokenAddress)
      ])
      feeAllow = fa
      lpAllow = la
      if (existing) {
        if (!sameAddress(existing.owner, owner))
          throw new Error('This token is already listed on-chain.')
        // Already paid by this wallet (e.g. registration failed earlier)
        if (!paidRef.current || paidRef.current.token !== f.tokenAddress)
          paidRef.current = {
            token: f.tokenAddress,
            txHash: '',
            onChainId: existing.id
          }
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
      return
    } finally {
      setPreflight(false)
    }

    const paid = () =>
      paidRef.current?.token === f.tokenAddress ? paidRef.current : null
    let listingId: string | null = null

    const steps: TxStep[] = []
    if (!paid() && feeAllow < cfg.listingFee)
      steps.push({
        label: `Approve ${feeLabel(v)} listing fee`,
        wallet: true,
        run: async () => {
          if (paid()) return true
          const now = await readAllowance(LISTING_FEE_TOKEN, owner)
          if (now >= cfg.listingFee) return true
          return approveForListing(LISTING_FEE_TOKEN, cfg.listingFee, owner)
        }
      })
    if (!paid() && lpAllow < p.lp)
      steps.push({
        label: 'Approve LP tokens',
        wallet: true,
        run: async () => {
          if (paid()) return true
          const now = await readAllowance(p.pair, owner)
          if (now >= p.lp) return true
          return approveForListing(p.pair, p.lp, owner)
        }
      })
    if (!paid())
      steps.push(
        {
          // list_token collects the fee and records the listing; it does NOT move
          // LP into LiquidityLock today (see contract note), so don't claim a lock.
          label: 'Pay listing fee and record the listing',
          wallet: true,
          run: async ({ advance }) => {
            const prev = paid()
            if (prev) return prev.txHash || true
            const res = await listToken(
              {
                tier: t.n,
                tokenAddress: f.tokenAddress,
                pairAddress: p.pair,
                // On Lunex the LP token is the pair contract itself
                lpToken: p.pair,
                lpAmount: p.lp,
                lunesLiquidity: p.lunesRaw,
                tokenLiquidity: p.tokenRaw
              },
              owner,
              advance
            )
            paidRef.current = {
              token: f.tokenAddress,
              txHash: res.txHash,
              onChainId: res.listing.id
            }
            return res.txHash
          }
        },
        { label: 'Waiting for block confirmation' }
      )
    steps.push({
      label: 'Sign listing registration in your wallet',
      wallet: true,
      run: async () => {
        const chain = paid()
        if (!chain) throw new Error('The on-chain listing was not confirmed.')
        const fail = (msg: string) =>
          new Error(
            `Fee paid on-chain (listing #${chain.onChainId}), but registering it with Lunex failed: ${msg}. Try again — you will not be charged twice.`
          )
        if (!logo) throw fail('token logo is missing')
        const meta = createSignedActionMetadata()
        const signature = await s.signMessage(
          buildWalletActionMessage({
            action: 'listing.create',
            address: owner,
            nonce: meta.nonce,
            timestamp: meta.timestamp,
            fields: {
              tokenAddress: f.tokenAddress,
              tokenName: f.tokenName,
              tokenSymbol: f.tokenSymbol,
              tier: t.key,
              lunesLiquidity: lunesStr,
              tokenLiquidity: tokenStr
            }
          })
        )
        const fd = new FormData()
        fd.append('ownerAddress', owner)
        fd.append('tokenAddress', f.tokenAddress)
        fd.append('tokenName', f.tokenName)
        fd.append('tokenSymbol', f.tokenSymbol)
        fd.append('tokenDecimals', String(tokenDecimals))
        fd.append('tier', t.key)
        fd.append('lunesLiquidity', lunesStr)
        fd.append('tokenLiquidity', tokenStr)
        fd.append('pairAddress', p.pair)
        fd.append('lpTokenAddress', p.pair)
        fd.append('lpAmount', p.lp.toString())
        if (chain.txHash) fd.append('txHash', chain.txHash)
        fd.append('onChainListingId', String(chain.onChainId))
        fd.append('nonce', meta.nonce)
        fd.append('timestamp', String(meta.timestamp))
        fd.append('signature', signature)
        if (f.description) fd.append('description', f.description)
        if (f.website) fd.append('website', f.website)
        fd.append('logo', logo)
        let res: Response
        try {
          res = await fetch(`${API_BASE}/api/v1/listing`, {
            method: 'POST',
            body: fd
          })
        } catch {
          throw fail('network error')
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw fail(data.error || `HTTP ${res.status}`)
        listingId = data.listing?.id ?? null
        return true
      }
    })

    tx.run({
      type: 'other',
      title: 'Listing token',
      summary: `${f.tokenSymbol} · ${t.label} tier · ${feeLabel(v)} fee`,
      actTitle: `List ${f.tokenSymbol} (${t.label})`,
      successTitle: 'Listing fee paid',
      steps,
      onSuccess: () => {
        const chain = paid()
        setDone({
          sym: f.tokenSymbol,
          tier: t.label,
          lunes: toNum(p.lunesRaw, wlunesDecimals),
          lock: Math.round(cfg.lockDurationMs / 86_400_000),
          id: listingId,
          onChainId: chain?.onChainId ?? -1,
          txHash: chain?.txHash || null
        })
      }
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
    setSubmitError(null)
    paidRef.current = null
  }

  // ── CTA ──
  let cta: { label: string; ok: boolean; on?: () => void }
  if (step < 4)
    cta = { label: 'Continue', ok: stepOk, on: () => setStep(step + 1) }
  else if (!configured) cta = { label: CONTRACT_MISSING, ok: false }
  else if (!sdk.isConnected)
    cta = {
      label: 'Connect wallet',
      ok: true,
      on: () => requestWalletConnect()
    }
  else if (paused) cta = { label: 'Listings are paused on-chain', ok: false }
  else if (!chainCfg) cta = { label: 'Reading listing contract…', ok: false }
  else if (!lpOk || !meetsMin)
    cta = { label: 'Go back and fix liquidity', ok: false }
  else if (feeShort)
    cta = { label: `Insufficient ${feeSymbol} for the fee`, ok: false }
  else
    cta = {
      label: preflight
        ? 'Checking approvals…'
        : `Pay ${feeLabel(view)} and lock liquidity`,
      ok: !preflight,
      on: () => void submit()
    }
  if (step === 2 && !stepOk)
    cta.label = lowLiq
      ? `Minimum ${view ? fmt(view.min) : '—'} LUNES in your LP`
      : !wallet
        ? 'Connect wallet to read your LP'
        : pos.status === 'nopair' || pos.status === 'nolp'
          ? 'Add liquidity first'
          : 'Fill in token details'
  if (step === 3 && !stepOk)
    cta.label = !form.description.trim() ? 'Add a description' : 'Upload a logo'
  if (step === 2 && !wallet)
    cta = {
      label: 'Connect wallet to read your LP',
      ok: true,
      on: () => requestWalletConnect()
    }

  const splitOf = (fee: number, bps: number) => (fee * bps) / 10_000

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
            Listing fee paid on-chain
          </span>
          <span
            style={{
              fontSize: 14,
              color: C.secondary,
              maxWidth: 440,
              lineHeight: 1.55
            }}
          >
            {done.sym} is recorded by the listing contract with a {done.lock}
            -day LP lock. It becomes tradable on Lunex once the listing is
            activated.
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
                Pending activation
              </StatValue>
            </StatCard>
            <StatCard style={{ padding: '14px 16px' }}>
              <StatLabel>LUNES in locked LP</StatLabel>
              <StatValue style={{ fontSize: 20 }}>
                <AnimatedNumber value={done.lunes} format={fmt} />
              </StatValue>
            </StatCard>
          </DoneGrid>
          {done.onChainId >= 0 && (
            <Muted $size={12}>
              On-chain listing #{done.onChainId}
              {done.txHash ? ` · tx ${shortHash(done.txHash)}` : ''}
              {done.id ? ` · ID ${done.id}` : ''}
            </Muted>
          )}
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

      {!configured && (
        <Notice $tone="warning" role="status">
          <AlertTriangle size={16} />
          {CONTRACT_MISSING}
        </Notice>
      )}
      {configured && paused && (
        <Notice $tone="warning" role="status">
          <AlertTriangle size={16} />
          Listings are paused on-chain. You can prepare your application, but
          payment is disabled until the contract is unpaused.
        </Notice>
      )}

      <TabPanel key={step}>
        {step === 1 && (
          <>
            <TierGrid role="radiogroup" aria-label="Listing tier">
              {TIERS.map(t => {
                const v = viewOf(t.n)
                return (
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
                        <span>{feeLabel(v)}</span>
                      </span>
                      <span>
                        <span>Min. LUNES locked</span>
                        <span>{v ? `${fmt(v.min)} LUNES` : '—'}</span>
                      </span>
                      <span>
                        <span>Lock period</span>
                        <span>{v ? `${v.lock} days` : '—'}</span>
                      </span>
                    </TierFacts>
                  </TierBtn>
                )
              })}
            </TierGrid>
            <RowsCard>
              <RowsTitle>Fee distribution</RowsTitle>
              <KvRow>
                <span>Listing fee</span>
                <span>{feeLabel(view)}</span>
              </KvRow>
              <KvRow>
                <span>→ Staking rewards (20%)</span>
                <span>
                  {view
                    ? `${fmt(splitOf(view.fee, SPLIT.staking))} ${feeSymbol}`
                    : '—'}
                </span>
              </KvRow>
              <KvRow>
                <span>→ Treasury (50%)</span>
                <span>
                  {view
                    ? `${fmt(splitOf(view.fee, SPLIT.treasury))} ${feeSymbol}`
                    : '—'}
                </span>
              </KvRow>
              <KvRow>
                <span>→ Rewards pool (30%)</span>
                <span>
                  {view
                    ? `${fmt(splitOf(view.fee, SPLIT.rewards))} ${feeSymbol}`
                    : '—'}
                </span>
              </KvRow>
              <KvRow>
                <span>Minimum LUNES in locked LP</span>
                <span>{view ? `${fmt(view.min)} LUNES` : '—'}</span>
              </KvRow>
              <KvRow>
                <span>Lock duration</span>
                <span>{view ? `${view.lock} days` : '—'}</span>
              </KvRow>
              <KvRow>
                <span>Estimated unlock</span>
                <span>{unlock}</span>
              </KvRow>
            </RowsCard>
            {!chainTiers && view && (
              <Muted $size={12}>
                Showing the Lunex API tier config. The listing contract sets the
                final amounts at payment.
              </Muted>
            )}
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
                label="Contract address"
                name="tokenAddress"
                value={form.tokenAddress}
                onChange={onChange}
                placeholder="5F…"
                error={!!tokenAddr && !looksLikeAddress(tokenAddr)}
                hint={
                  tokenAddr && !looksLikeAddress(tokenAddr)
                    ? 'Not a valid address'
                    : undefined
                }
              />
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
                label="Token decimals"
                name="tokenDecimals"
                value={form.tokenDecimals}
                onChange={onChange}
                placeholder="Read from chain"
                inputMode="numeric"
                error={!!form.tokenDecimals && !decOk}
              />
            </FormGrid>

            <RowsCard>
              <RowsTitle>Liquidity to lock</RowsTitle>
              {!wallet ? (
                <Muted $size={13}>
                  Connect your wallet to read your {form.tokenSymbol || 'TOKEN'}
                  /WLUNES LP position.
                </Muted>
              ) : !looksLikeAddress(tokenAddr) ? (
                <Muted $size={13}>
                  Enter the token contract address to find its WLUNES pool.
                </Muted>
              ) : pos.status === 'loading' || pos.status === 'idle' ? (
                <Muted $size={13}>Reading your LP position…</Muted>
              ) : pos.status === 'error' ? (
                <Row $gap={8} $wrap>
                  <Muted $size={13}>Could not read the pool.</Muted>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPosTick(n => n + 1)}
                  >
                    Retry
                  </Button>
                </Row>
              ) : pos.status === 'nopair' || pos.status === 'nolp' ? (
                <Col $gap={8}>
                  <Muted $size={13}>
                    {pos.status === 'nopair'
                      ? `There is no ${form.tokenSymbol || 'TOKEN'}/WLUNES pool yet.`
                      : `You have no LP tokens in the ${form.tokenSymbol || 'TOKEN'}/WLUNES pool.`}{' '}
                    Listing locks your pool liquidity, so add liquidity first.
                  </Muted>
                  <Row $gap={8} $wrap>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(poolLink)}
                    >
                      Add liquidity
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPosTick(n => n + 1)}
                    >
                      Refresh
                    </Button>
                  </Row>
                </Col>
              ) : (
                <>
                  <KvRow>
                    <span>Pool</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {pos.pair}
                    </span>
                  </KvRow>
                  <KvRow>
                    <span>LP tokens to lock (your full balance)</span>
                    <span>{pos.lp.toString()}</span>
                  </KvRow>
                  <KvRow>
                    <span>LUNES in your share</span>
                    <span>{fmt(lunes)} LUNES</span>
                  </KvRow>
                  <KvRow>
                    <span>{form.tokenSymbol || 'Tokens'} in your share</span>
                    <span>{decOk ? fmt(tokens) : '—'}</span>
                  </KvRow>
                </>
              )}
            </RowsCard>
            {lowLiq && view && (
              <Notice $tone="warning" role="alert">
                <AlertTriangle size={16} />
                Minimum {fmt(view.min)} LUNES required for the {tier.label}{' '}
                tier. Your LP holds {fmt(lunes)}.{' '}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(poolLink)}
                >
                  Add liquidity
                </Button>
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
                  {tokenAddr || '—'}
                </span>
              </KvRow>
              <KvRow>
                <span>Tier</span>
                <span style={{ color: C.primaryText2 }}>
                  {tier.label} (Tier {tier.n})
                </span>
              </KvRow>
              <KvRow>
                <span>LP tokens to lock</span>
                <span>{lpOk ? pos.lp.toString() : '—'}</span>
              </KvRow>
              <KvRow>
                <span>LUNES in locked LP</span>
                <span>{fmt(lunes)} LUNES</span>
              </KvRow>
              <KvRow>
                <span>Tokens in locked LP</span>
                <span>
                  {fmt(tokens)} {form.tokenSymbol}
                </span>
              </KvRow>
              <KvRow>
                <span>Lock duration</span>
                <span>{view ? `${view.lock} days` : '—'}</span>
              </KvRow>
              <KvRow>
                <span>Unlock date</span>
                <span>{unlock}</span>
              </KvRow>
              <KvRow>
                <span>Listing fee (paid now)</span>
                <span style={{ fontWeight: 600 }}>{feeLabel(view)}</span>
              </KvRow>
              {feeBalance !== null && feeDecimals !== null && (
                <KvRow>
                  <span>Your {feeSymbol} balance</span>
                  <span
                    style={feeShort ? { color: C.criticalText } : undefined}
                  >
                    {fmt(toNum(feeBalance, feeDecimals))} {feeSymbol}
                  </span>
                </KvRow>
              )}
              {configured && (
                <KvRow>
                  <span>Listing contract</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {LISTING_MANAGER_ADDRESS}
                  </span>
                </KvRow>
              )}
            </RowsCard>
            <RowsCard>
              <RowsTitle>What happens on submit</RowsTitle>
              <KvRow>
                <span>1. Approve the listing fee and LP tokens</span>
                <span>Wallet, if needed</span>
              </KvRow>
              <KvRow>
                <span>2. Fee paid, split 20/50/30, LP lock recorded</span>
                <span>On finalization</span>
              </KvRow>
              <KvRow>
                <span>3. Listing registered with Lunex</span>
                <span>Signed message</span>
              </KvRow>
              <KvRow>
                <span>4. Lock period after activation</span>
                <span>{view ? `${view.lock} days` : '—'}</span>
              </KvRow>
            </RowsCard>
            {feeShort && (
              <Notice $tone="warning" role="alert">
                <AlertTriangle size={16} />
                The listing fee is paid in {feeSymbol}. Wrap or acquire enough{' '}
                {feeSymbol} before submitting.
              </Notice>
            )}
            {submitError && (
              <Notice $tone="critical" role="alert">
                <AlertTriangle size={16} />
                {submitError}
              </Notice>
            )}
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
