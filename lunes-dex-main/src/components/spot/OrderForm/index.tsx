import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import { spotApi } from 'services/spotService'
import { buildSpotOrderSignMessage } from '../../../utils/signing'
import { Button, C, Notice } from 'components/ui/kit'
import {
  Fade,
  SideBtn,
  SideSwitch,
  T,
  TField,
  TInput,
  TKV,
  TLabel,
  UnderlineTabs,
  cleanNum,
  fmtAmt,
  fmtPx,
  nf,
  pxDec,
  splitPair,
  useTerminal
} from '../terminal'
import ConfirmOrderModal, { OrderKind, PendingOrder } from './ConfirmOrderModal'
import MarginTab from './MarginTab'
import { useSpotBalances } from './useSpotBalances'
import { requestWalletConnect } from 'pages/header/modals/wallets'

// Display fallbacks only — the pair's makerFeeBps / takerFeeBps from
// spot-api win when present; the backend computes the real fee.
const DEFAULT_MAKER_FEE = 0.001
const DEFAULT_TAKER_FEE = 0.0025

type Tab = 'limit' | 'market' | 'stop' | 'stop-limit' | 'margin'
type Side = 'buy' | 'sell'

const TABS: Array<[Tab, string]> = [
  ['limit', 'Limit'],
  ['market', 'Market'],
  ['stop', 'Stop'],
  ['stop-limit', 'Stop-Limit'],
  ['margin', 'Margin']
]

const KIND: Record<Exclude<Tab, 'margin'>, OrderKind> = {
  limit: 'Limit',
  market: 'Market',
  stop: 'Stop',
  'stop-limit': 'Stop-Limit'
}

const API_TYPE: Record<OrderKind, 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT'> =
  {
    Limit: 'LIMIT',
    Market: 'MARKET',
    Stop: 'STOP',
    'Stop-Limit': 'STOP_LIMIT'
  }

// Same nonce shape as SpotContext.createOrder (ms timestamp + 3-digit counter)
let nonceCounter = Date.now()
const nextNonce = () => {
  nonceCounter += 1
  return `${Date.now()}${String(nonceCounter % 1000).padStart(3, '0')}`
}

/** Strip trailing zeros of a decimal string. */
const numStr = (v: number, d: number) =>
  v.toFixed(d).replace(/\.?0+$/, '') || '0'

const Body = styled.div`
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const FieldCol = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Pcts = styled.div`
  display: flex;
  gap: 6px;
`

const Pct = styled.button`
  flex: 1;
  height: 28px;
  border-radius: 8px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${C.text};
  font-size: 12px;
  font-weight: 600;
  transition: border-color 150ms ease;
  &:hover:not(:disabled) {
    border-color: ${C.primary};
  }
  &:disabled {
    color: ${C.muted};
    border-color: ${T.line};
    cursor: not-allowed;
  }
`

const Summary = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 2px;
`

const Cta = styled(Button)<{ $tone: 'buy' | 'sell' | 'primary' }>`
  ${p =>
    p.$tone === 'buy'
      ? `background:${T.up};color:${T.bg};&:hover:not(:disabled){background:#1BB277;}`
      : p.$tone === 'sell'
        ? `background:${T.sell};color:#fff;&:hover:not(:disabled){background:#DB1D4E;}`
        : ''}
`

const OrderForm: React.FC = () => {
  const { selectedPair, pairs, ticker, orderbook, refreshOrders } = useSpot()
  const { walletAddress, signMessage } = useSDK()
  const tx = useTx()
  const { picked, setHistoryTab } = useTerminal()

  const [tab, setTab] = useState<Tab>('limit')
  const [side, setSide] = useState<Side>('buy')
  const [price, setPrice] = useState('')
  const [stop, setStop] = useState('')
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState<PendingOrder | null>(null)

  const [base, quote] = splitPair(selectedPair)
  const pair = useMemo(
    () => pairs.find(p => p.symbol === selectedPair),
    [pairs, selectedPair]
  )
  const balances = useSpotBalances(walletAddress, selectedPair, pair)

  // Reset on pair change; prefill the limit price with the live price.
  const prefill = useRef(true)
  useEffect(() => {
    setPrice('')
    setStop('')
    setAmount('')
    prefill.current = true
  }, [selectedPair])
  const last = ticker?.symbol === selectedPair ? ticker.lastPrice : 0
  useEffect(() => {
    if (prefill.current && last > 0) {
      prefill.current = false
      setPrice(numStr(last, pxDec(last)))
    }
  }, [last])

  // Book row click → price
  useEffect(() => {
    if (!picked) return
    const v = numStr(picked.price, pxDec(picked.price))
    prefill.current = false
    if (tab === 'stop') setStop(v)
    else {
      setPrice(v)
      if (tab === 'market' || tab === 'margin') setTab('limit')
    }
    // only react to a new pick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  const isBuy = side === 'buy'
  const isStopT = tab === 'stop' || tab === 'stop-limit'
  const isMaker = tab === 'limit' || tab === 'stop-limit'
  const feeRate = isMaker
    ? pair
      ? pair.makerFeeBps / 10000
      : DEFAULT_MAKER_FEE
    : pair
      ? pair.takerFeeBps / 10000
      : DEFAULT_TAKER_FEE

  const bestAsk = orderbook?.bestAsk ?? orderbook?.asks?.[0]?.price ?? 0
  const bestBid = orderbook?.bestBid ?? orderbook?.bids?.[0]?.price ?? 0
  const lp = parseFloat(price) || 0
  const stp = parseFloat(stop) || 0
  const amt = parseFloat(amount) || 0
  const marketPx = (isBuy ? bestAsk : bestBid) || last
  const execP = tab === 'market' ? marketPx : tab === 'stop' ? stp : lp
  const total = execP * amt
  const fee = total * feeRate
  const dp = pxDec(execP || last)
  const availQ = balances.quote
  const availB = balances.base
  const connected = !!walletAddress

  const setPct = (p: number) => {
    const px = execP || last
    const q = isBuy
      ? px > 0 && availQ
        ? availQ / (px * (1 + feeRate))
        : 0
      : (availB ?? 0)
    const v = (q * p) / 100
    setAmount(v >= 100 ? String(Math.floor(v)) : numStr(v, 6))
  }

  const cta = useMemo((): {
    label: string
    ok: boolean
    tone: 'buy' | 'sell' | 'primary'
    on?: () => void
  } => {
    if (!connected)
      return {
        label: 'Connect wallet',
        ok: true,
        tone: 'primary',
        on: () => void requestWalletConnect()
      }
    if (isStopT && stp <= 0)
      return { label: 'Enter a stop price', ok: false, tone: 'primary' }
    if ((tab === 'limit' || tab === 'stop-limit') && lp <= 0)
      return { label: 'Enter a price', ok: false, tone: 'primary' }
    if (amt <= 0)
      return { label: 'Enter an amount', ok: false, tone: 'primary' }
    if (tab === 'market' && marketPx <= 0)
      return { label: 'No liquidity in the book', ok: false, tone: 'primary' }
    if (
      isBuy
        ? availQ !== null && total + fee > availQ
        : availB !== null && amt > availB
    )
      return {
        label: `Insufficient ${isBuy ? quote : base}`,
        ok: false,
        tone: 'primary'
      }
    const kind = KIND[tab as Exclude<Tab, 'margin'>]
    return {
      label: `${isStopT ? 'Stop ' : ''}${isBuy ? 'Buy' : 'Sell'} ${base}`,
      ok: true,
      tone: isBuy ? 'buy' : 'sell',
      on: () =>
        setPending({
          pair: selectedPair,
          base,
          quote,
          type: kind,
          side,
          price: execP,
          stop: isStopT ? stp : null,
          amount: amt,
          total,
          fee,
          feeRate,
          isMaker,
          dp
        })
    }
  }, [
    connected,
    isStopT,
    stp,
    tab,
    lp,
    amt,
    marketPx,
    isBuy,
    availQ,
    availB,
    total,
    fee,
    quote,
    base,
    selectedPair,
    side,
    execP,
    feeRate,
    isMaker,
    dp
  ])

  const submit = useCallback(
    (o: PendingOrder) => {
      setPending(null)
      if (!walletAddress) return
      const type = API_TYPE[o.type]
      const filled = o.type === 'Market'
      const orderPrice =
        type === 'LIMIT' || type === 'STOP_LIMIT' ? String(o.price) : undefined
      const orderStop =
        type === 'STOP' || type === 'STOP_LIMIT' ? String(o.stop) : undefined
      const nonce = nextNonce()
      const timestamp = Date.now()
      let signature = ''

      tx.run({
        type: 'spot',
        title: filled
          ? 'Executing market order'
          : o.stop
            ? 'Arming stop order'
            : 'Placing order',
        summary: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${fmtAmt(o.amount)} ${o.base} · ${o.pair}`,
        actTitle: `Spot ${o.type.toLowerCase()} ${o.side} ${fmtAmt(o.amount)} ${o.base}`,
        successTitle: filled
          ? 'Market order sent'
          : o.stop
            ? 'Stop order armed'
            : 'Order placed',
        errorText: 'The orderbook did not accept the order.',
        steps: [
          {
            label: 'Sign order in your wallet',
            wallet: true,
            run: async () => {
              signature = await signMessage(
                buildSpotOrderSignMessage({
                  pairSymbol: o.pair,
                  side: o.side === 'buy' ? 'BUY' : 'SELL',
                  type,
                  price: orderPrice,
                  stopPrice: orderStop,
                  amount: String(o.amount),
                  nonce,
                  timestamp
                })
              )
            }
          },
          {
            label: filled ? 'Matching on orderbook' : 'Posting to orderbook',
            run: async () => {
              await spotApi.createOrder({
                pairSymbol: o.pair,
                side: o.side === 'buy' ? 'BUY' : 'SELL',
                type,
                price: orderPrice,
                stopPrice: orderStop,
                amount: String(o.amount),
                nonce,
                timestamp,
                signature,
                makerAddress: walletAddress
              })
            }
          }
        ],
        onSuccess: () => {
          setAmount('')
          setHistoryTab(filled ? 'trades' : 'open')
          balances.refresh()
          void refreshOrders()
        }
      })
    },
    [walletAddress, tx, signMessage, setHistoryTab, balances, refreshOrders]
  )

  return (
    <>
      <UnderlineTabs
        ariaLabel="Order type"
        items={TABS}
        value={tab}
        onChange={setTab}
        spread
      />

      {tab === 'margin' ? (
        <Fade key="margin">
          <MarginTab />
        </Fade>
      ) : (
        <Fade key="spot">
          <Body>
            <SideSwitch role="tablist" aria-label="Side">
              <SideBtn
                role="tab"
                aria-selected={isBuy}
                $on={isBuy}
                $side="buy"
                onClick={() => setSide('buy')}
              >
                Buy
              </SideBtn>
              <SideBtn
                role="tab"
                aria-selected={!isBuy}
                $on={!isBuy}
                $side="sell"
                onClick={() => setSide('sell')}
              >
                Sell
              </SideBtn>
            </SideSwitch>

            {isStopT && (
              <Notice
                $tone="primary"
                style={{ fontSize: 12, padding: '10px 12px' }}
              >
                {tab === 'stop'
                  ? 'When the market reaches the Stop Price, a market order is placed.'
                  : 'When the Stop Price is reached, a limit order at the Limit Price is placed.'}
              </Notice>
            )}

            {isStopT && (
              <FieldCol>
                <TLabel>Stop price ({quote})</TLabel>
                <TField>
                  <TInput
                    value={stop}
                    onChange={e => setStop(cleanNum(e.target.value))}
                    placeholder="0"
                    aria-label="Stop price"
                  />
                  <span>{quote}</span>
                </TField>
              </FieldCol>
            )}

            {(tab === 'limit' || tab === 'stop-limit') && (
              <FieldCol>
                <TLabel>
                  {tab === 'stop-limit' ? 'Limit price' : 'Price'} ({quote})
                </TLabel>
                <TField>
                  <TInput
                    value={price}
                    onChange={e => {
                      prefill.current = false
                      setPrice(cleanNum(e.target.value))
                    }}
                    placeholder="0"
                    aria-label="Limit price"
                  />
                  <span>{quote}</span>
                </TField>
              </FieldCol>
            )}

            {tab === 'market' && (
              <FieldCol as="div">
                <TLabel>Price</TLabel>
                <TField $readOnly>
                  Best market price · ≈ {fmtPx(marketPx)}
                </TField>
              </FieldCol>
            )}

            <FieldCol>
              <TLabel>Amount ({base})</TLabel>
              <TField>
                <TInput
                  value={amount}
                  onChange={e => setAmount(cleanNum(e.target.value))}
                  placeholder="0"
                  aria-label="Amount"
                />
                <span>{base}</span>
              </TField>
            </FieldCol>

            <Pcts>
              {[25, 50, 75, 100].map(p => (
                <Pct key={p} disabled={!connected} onClick={() => setPct(p)}>
                  {p === 100 ? 'Max' : `${p}%`}
                </Pct>
              ))}
            </Pcts>

            <Summary>
              <TKV>
                <span>Available</span>
                <span>
                  {!connected
                    ? '—'
                    : isBuy
                      ? availQ === null
                        ? '…'
                        : `${fmtAmt(availQ)} ${quote}`
                      : availB === null
                        ? '…'
                        : `${fmtAmt(availB)} ${base}`}
                </span>
              </TKV>
              <TKV>
                <span>Total</span>
                <span>
                  {amt > 0 && execP > 0 ? `${nf(total, 2)} ${quote}` : '—'}
                </span>
              </TKV>
              <TKV>
                <span>
                  Fee ({isMaker ? 'maker' : 'taker'}{' '}
                  {(feeRate * 100).toFixed(2)}%)
                </span>
                <span>
                  {amt > 0 && execP > 0 ? `≈ ${fmtAmt(fee)} ${quote}` : '—'}
                </span>
              </TKV>
            </Summary>

            <Cta
              size="lg"
              block
              $tone={cta.ok ? cta.tone : 'primary'}
              disabled={!cta.ok}
              onClick={cta.on}
            >
              {cta.label}
            </Cta>
          </Body>
        </Fade>
      )}

      <ConfirmOrderModal
        order={pending}
        onClose={() => setPending(null)}
        onConfirm={submit}
      />
    </>
  )
}

export default OrderForm
