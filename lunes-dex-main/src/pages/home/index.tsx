/**
 * Swap — README "Swap" + prototype SWAP / TOKEN MODAL / REVIEW MODAL.
 *
 * Real data: token selection + amount in AppContext (useSelectOptions),
 * router quotes and execution via useSwap → useSDK, on-chain balances, spot
 * ticker prices (display only). Fund movement goes through useTx().run.
 * Query params `?from=SYM&to=SYM` (symbol or address) prefill the pair.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  SlidersHorizontal
} from 'lucide-react'
import { Button, Page } from 'components/ui/kit'
import {
  TOKENS,
  Token,
  TokenImg,
  TokenSelectModal,
  fmtAmount,
  fmtUsd,
  useTokenBalances,
  useTokenPrices
} from 'components/TokenSelect'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import useSelectOptions from 'hooks/useSelectOptions'
import useSwap from 'hooks/useSwap'
import * as S from './styles'
import * as M from './modals'
import {
  FEE_SPLIT_TEXT,
  IMPACT_BLOCK,
  IMPACT_RISK,
  IMPACT_WARN,
  SLIPPAGE_RISK,
  buildDetailRows
} from './details'

const SLIP_KEY = 'lunex-swap-slippage'
const DEADLINE_KEY = 'lunex-swap-deadline'

const readNum = (key: string, fallback: number) => {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

const writeNum = (key: string, v: number) => {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    /* storage unavailable */
  }
}

const findToken = (q: string | null) => {
  if (!q) return null
  const k = q.trim().toLowerCase()
  const sym = k === 'lunes' ? 'wlunes' : k
  return (
    TOKENS.find(
      t => t.acronym.toLowerCase() === sym || (!!t.address && t.address === q)
    ) ?? null
  )
}

/** Keep digits and one dot, cap decimals to the token's precision. */
const cleanAmount = (raw: string, decimals: number) => {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const i = v.indexOf('.')
  if (i >= 0) {
    v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '')
    v = v.slice(0, i + 1 + decimals)
  }
  if (v.startsWith('.')) v = '0' + v
  return v.replace(/^0+(?=\d)/, '')
}

type Side = 'from' | 'to'

const Home = () => {
  const sdk = useSDK()
  const tx = useTx()
  const [params] = useSearchParams()
  const {
    selectedOption1: from,
    selectedOption2: to,
    inputValue1: amount,
    setInputValue1: setAmount,
    selectOptionForFirst,
    selectOptionForSecond
  } = useSelectOptions()

  const [picking, setPicking] = useState<Side | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [slippage, setSlippageState] = useState(() => readNum(SLIP_KEY, 0.5))
  const [deadline, setDeadlineState] = useState(() => readNum(DEADLINE_KEY, 20))
  const [flipDeg, setFlipDeg] = useState(0)
  const [invert, setInvert] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null)

  const setSlippage = (v: number) => {
    setSlippageState(v)
    writeNum(SLIP_KEY, v)
  }
  const setDeadline = (v: number) => {
    setDeadlineState(v)
    writeNum(DEADLINE_KEY, v)
  }

  // ?from=&to= prefill (Pools "Swap" button → /swap?from=X&to=Y)
  const qFrom = params.get('from')
  const qTo = params.get('to')
  useEffect(() => {
    const f = findToken(qFrom)
    const t = findToken(qTo)
    if (f) selectOptionForFirst(f)
    if (t && (!f || t.acronym !== f.acronym)) selectOptionForSecond(t)
    // run when the query changes only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFrom, qTo])

  const connected = !!sdk.walletAddress
  const { balances, refresh: refreshBalances } = useTokenBalances(TOKENS)
  const prices = useTokenPrices(TOKENS)

  const swap = useSwap({
    tokenIn: from,
    tokenOut: to,
    amountIn: amount,
    slippage,
    deadlineMin: deadline
  })
  const { quote, loading } = swap

  const amountNum = Number(amount) || 0
  const fromBal = from ? balances[from.acronym] : undefined
  const toBal = to ? balances[to.acronym] : undefined

  const exceeds = useMemo(() => {
    if (!connected || !from || !fromBal || amountNum <= 0) return false
    try {
      return (
        BigInt(sdk.parseAmount(amount, from.decimals || 8)) >
        BigInt(fromBal.raw || '0')
      )
    } catch {
      return amountNum > fromBal.value
    }
    // sdk helpers are pure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, from, fromBal, amount, amountNum])

  const priceOf = (t: Token | null) => (t ? (prices[t.acronym] ?? 0) : 0)
  const out = amountNum > 0 && quote ? quote.amountOut : 0
  const impact = quote && amountNum > 0 ? quote.priceImpact : 0
  const usdLabel = (v: number, t: Token | null) =>
    v > 0 ? (priceOf(t) > 0 ? '≈ ' + fmtUsd(v * priceOf(t)) : '—') : '$0.00'

  const setFraction = (num: bigint, den: bigint) => {
    if (!from || !fromBal) return
    try {
      const raw = (BigInt(fromBal.raw || '0') * num) / den
      setAmount(sdk.formatAmount(raw.toString(), from.decimals || 8))
    } catch {
      /* ignore */
    }
  }

  const flip = () => {
    if (!from || !to) return
    setFlipDeg(d => d + 180)
    selectOptionForFirst(to)
    selectOptionForSecond(from)
    if (out > 0) {
      const dec = Math.min(6, to.decimals || 8)
      setAmount(String(+out.toFixed(dec)))
    }
  }

  const onPick = (t: Token) => {
    const side = picking
    if (!side) return
    const cur = side === 'from' ? from : to
    const other = side === 'from' ? to : from
    if (other && t.acronym === other.acronym) {
      // picking the other side's token swaps the two sides
      if (cur) {
        selectOptionForFirst(side === 'from' ? t : cur)
        selectOptionForSecond(side === 'from' ? cur : t)
        setFlipDeg(d => d + 180)
      }
      return
    }
    if (side === 'from') selectOptionForFirst(t)
    else selectOptionForSecond(t)
  }

  const rate = quote?.rate ?? 0
  const rateLabel =
    from && to && rate > 0
      ? invert
        ? `1 ${to.acronym} = ${fmtAmount(1 / rate)} ${from.acronym}`
        : `1 ${from.acronym} = ${fmtAmount(rate)} ${to.acronym}`
      : ''

  const rows =
    from && to && quote
      ? buildDetailRows({
          impact,
          minReceived: swap.minReceived,
          slippage,
          fee: swap.feeAmount,
          fromSym: from.acronym,
          toSym: to.acronym,
          route: quote.route
        })
      : []

  const riskText =
    impact > IMPACT_RISK
      ? `I understand this trade has ${impact.toFixed(1)}% price impact and I may receive much less than the market rate.`
      : slippage > SLIPPAGE_RISK
        ? `I understand that a ${slippage}% slippage tolerance can fill at a noticeably worse price.`
        : null

  const openReview = () => {
    if (loading || !quote) return
    setSettingsOpen(false)
    setNeedsApproval(null)
    setReviewOpen(true)
    swap.needsApproval().then(setNeedsApproval)
  }

  const confirm = async () => {
    if (!from || !to || !quote) return
    setReviewOpen(false)
    const approval = needsApproval ?? (await swap.needsApproval())
    const steps = swap.buildSteps(approval)
    if (!steps.length) return
    const txt = `${fmtAmount(amountNum)} ${from.acronym} → ${fmtAmount(out)} ${to.acronym}`
    tx.run({
      type: 'swap',
      title: 'Swapping',
      summary: txt,
      actTitle: `Swap ${txt}`,
      successTitle: 'Swap confirmed',
      errorText: 'The swap did not complete.',
      steps,
      onSuccess: () => {
        setAmount('')
        refreshBalances()
      }
    })
  }

  // CTA sequence: Connect wallet → Select a token → Enter an amount →
  // Insufficient X balance → (quote) → Review swap
  type Cta = {
    label: string
    on?: () => void
    danger?: boolean
  }
  let cta: Cta
  if (!connected)
    cta = { label: 'Connect wallet', on: () => void sdk.connectWallet() }
  else if (!from || !to)
    cta = {
      label: 'Select a token',
      on: () => setPicking(from ? 'to' : 'from')
    }
  else if (amountNum <= 0) cta = { label: 'Enter an amount' }
  else if (exceeds) cta = { label: `Insufficient ${from.acronym} balance` }
  else if (!quote && loading) cta = { label: 'Fetching best price…' }
  else if (!quote)
    cta = { label: swap.error ? 'Quote unavailable' : 'Insufficient liquidity' }
  else if (impact > IMPACT_BLOCK) cta = { label: 'Price impact too high' }
  else
    cta = {
      label: impact > IMPACT_RISK ? 'Review swap · high impact' : 'Review swap',
      on: openReview,
      danger: impact > IMPACT_RISK
    }

  const showDetails = !!quote && amountNum > 0 && !!from && !!to
  const dim = loading && amountNum > 0

  return (
    <Page $max={480} style={{ gap: 12 }}>
      <S.SwapCard>
        <S.CardHead>
          <h1>Swap</h1>
          <S.SettingsBtn
            $open={settingsOpen}
            onClick={() => setSettingsOpen(o => !o)}
            aria-label="Swap settings"
            aria-expanded={settingsOpen}
            aria-controls="swap-settings"
          >
            <SlidersHorizontal size={16} strokeWidth={2} />
            {slippage}%
          </S.SettingsBtn>
        </S.CardHead>

        {settingsOpen && (
          <M.SwapSettings
            slippage={slippage}
            deadline={deadline}
            onSlippage={setSlippage}
            onDeadline={setDeadline}
          />
        )}

        <S.AmountPanel $error={exceeds}>
          <S.PanelTop>
            <S.Label $error={exceeds}>You pay</S.Label>
            {connected && from && (
              <S.BalRow>
                <span>Balance: {fromBal ? fmtAmount(fromBal.value) : '—'}</span>
                <S.MiniBtn
                  onClick={() => setFraction(BigInt(1), BigInt(2))}
                  disabled={!fromBal}
                >
                  50%
                </S.MiniBtn>
                <S.MiniBtn
                  $solid
                  onClick={() => setFraction(BigInt(1), BigInt(1))}
                  disabled={!fromBal}
                >
                  MAX
                </S.MiniBtn>
              </S.BalRow>
            )}
          </S.PanelTop>
          <S.AmountRow>
            <S.AmountInput
              value={amount}
              onChange={e =>
                setAmount(cleanAmount(e.target.value, from?.decimals || 8))
              }
              placeholder="0"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Amount to pay"
              aria-invalid={exceeds}
              data-bare=""
              $error={exceeds}
            />
            <TokenPillBtn token={from} onClick={() => setPicking('from')} />
          </S.AmountRow>
          <S.PanelBottom>
            <span>{usdLabel(amountNum, from)}</span>
            {exceeds && from && fromBal && (
              <S.PayError role="alert">
                Max {fmtAmount(fromBal.value)} {from.acronym}
              </S.PayError>
            )}
          </S.PanelBottom>
        </S.AmountPanel>

        <S.FlipWrap>
          <S.FlipBtn
            $deg={flipDeg}
            onClick={flip}
            disabled={!from || !to}
            aria-label="Switch tokens"
          >
            <ArrowDownUp size={16} strokeWidth={2} />
          </S.FlipBtn>
        </S.FlipWrap>

        <S.ReceivePanel>
          <S.PanelTop>
            <S.Label>
              You receive
              {dim && (
                <S.QuoteSpinner
                  role="status"
                  aria-label="Updating quote"
                  data-motion="pulse"
                />
              )}
            </S.Label>
            {connected && to && (
              <span>Balance: {toBal ? fmtAmount(toBal.value) : '—'}</span>
            )}
          </S.PanelTop>
          <S.AmountRow>
            <S.AmountOut $empty={out <= 0} $dim={dim} aria-live="polite">
              {out > 0 ? fmtAmount(out) : '0'}
            </S.AmountOut>
            <TokenPillBtn token={to} onClick={() => setPicking('to')} />
          </S.AmountRow>
          <S.PanelBottom>
            <span>{usdLabel(out, to)}</span>
          </S.PanelBottom>
        </S.ReceivePanel>

        {showDetails && (
          <S.Details $dim={dim}>
            <S.RateBtn
              onClick={() => setInvert(v => !v)}
              aria-label="Invert rate"
              title="Invert rate"
            >
              <span>{rateLabel}</span>
              <ArrowDownUp size={14} strokeWidth={2} color="#8A8A8E" />
            </S.RateBtn>
            {rows.map(r => (
              <S.DetailLine key={r.label}>
                <span title={r.tip}>{r.label}</span>
                <span style={{ color: r.color ?? '#fff' }}>{r.value}</span>
              </S.DetailLine>
            ))}
          </S.Details>
        )}

        {!quote && !loading && swap.error && amountNum > 0 && (
          <S.QuoteError role="status">{swap.error}</S.QuoteError>
        )}

        {showDetails && impact >= IMPACT_WARN && (
          <S.ImpactWarn role="alert">
            <AlertTriangle size={16} strokeWidth={2} />
            {impact > IMPACT_BLOCK
              ? `Price impact is ${impact.toFixed(1)}%. Pool liquidity is too low for this size — try a smaller amount.`
              : `High price impact (${impact.toFixed(1)}%). You would receive noticeably less than the market rate.`}
          </S.ImpactWarn>
        )}

        <S.Cta>
          <Button
            size="xl"
            block
            variant={cta.danger ? 'danger' : 'primary'}
            disabled={!cta.on}
            onClick={cta.on}
          >
            {cta.label}
          </Button>
        </S.Cta>
      </S.SwapCard>

      <S.Footer>{FEE_SPLIT_TEXT}</S.Footer>

      <TokenSelectModal
        open={picking !== null}
        onClose={() => setPicking(null)}
        onSelect={onPick}
        selected={picking === 'from' ? from : to}
        other={picking === 'from' ? to : from}
        balances={balances}
        prices={prices}
      />

      {from && to && quote && (
        <M.ReviewSwap
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onConfirm={confirm}
          from={from}
          to={to}
          payLabel={`${fmtAmount(amountNum)} ${from.acronym}`}
          receiveLabel={`${fmtAmount(out)} ${to.acronym}`}
          usdIn={usdLabel(amountNum, from)}
          usdOut={usdLabel(out, to)}
          rows={rows}
          minOutLabel={`${fmtAmount(swap.minReceived)} ${to.acronym}`}
          riskText={riskText}
          danger={impact > IMPACT_RISK}
          needsApproval={needsApproval}
        />
      )}
    </Page>
  )
}

const TokenPillBtn: React.FC<{ token: Token | null; onClick: () => void }> = ({
  token,
  onClick
}) => (
  <S.TokenPill
    $empty={!token}
    onClick={onClick}
    aria-label={token ? `Change token, ${token.acronym}` : 'Select a token'}
  >
    {token && <TokenImg token={token} size={28} />}
    {token ? token.acronym : 'Select token'}
    <ChevronDown size={16} strokeWidth={2} color={token ? '#8A8A8E' : '#fff'} />
  </S.TokenPill>
)

export default Home
