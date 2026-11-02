import React, { useMemo } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import { calcFeeBreakdown, spotApi, SpotOrder } from 'services/spotService'
import { buildSpotCancelSignMessage } from '../../../utils/signing'
import { C, tabular } from 'components/ui/kit'
import {
  Fade,
  HistoryTab,
  T,
  TEmpty,
  UnderlineTabs,
  fmtAmt,
  fmtPx,
  fmtTime,
  useTerminal
} from '../terminal'

const COLS: Record<HistoryTab, string> = {
  open: '1fr .8fr .6fr 1fr .9fr .6fr .7fr 1fr .8fr',
  history: '1fr .8fr .6fr 1fr .9fr .7fr 1fr',
  trades: '1fr .6fr 1fr .9fr .9fr 1fr'
}
const HEAD: Record<HistoryTab, string[]> = {
  open: [
    'Pair',
    'Type',
    'Side',
    'Price',
    'Qty',
    'Filled',
    'Status',
    'Time',
    ''
  ],
  history: ['Pair', 'Type', 'Side', 'Price', 'Qty', 'Status', 'Time'],
  trades: ['Pair', 'Side', 'Price', 'Qty', 'Fee', 'Time']
}

const OPEN = ['OPEN', 'PARTIAL', 'PENDING_TRIGGER']

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`

const Inner = styled.div`
  min-width: 760px;
`

const Grid = styled.div<{ $cols: string; $head?: boolean }>`
  display: grid;
  grid-template-columns: ${p => p.$cols};
  gap: 8px;
  align-items: center;
  padding: ${p => (p.$head ? '8px 14px' : '7px 14px')};
  font-size: ${p => (p.$head ? 11 : 12)}px;
  color: ${p => (p.$head ? C.muted : C.text)};
  ${tabular};
  ${p =>
    p.$head
      ? `position: sticky; top: 0; z-index: 1; background: ${T.panel};`
      : `border-top: 1px solid ${C.surface};`}
  > span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const CancelBtn = styled.button`
  justify-self: start;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${T.downText};
  font-size: 11px;
  font-weight: 600;
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${T.down};
  }
`

const FeeCell = styled.span`
  cursor: help;
  text-decoration: underline dotted ${C.borderStrong};
  text-underline-offset: 3px;
`

const sideCell = (side: string) => {
  const buy = side.toUpperCase() === 'BUY'
  return (
    <span style={{ color: buy ? T.up : T.down, fontWeight: 600 }}>
      {buy ? 'Buy' : 'Sell'}
    </span>
  )
}

const typeLabel = (t: string) =>
  ({
    LIMIT: 'Limit',
    MARKET: 'Market',
    STOP: 'Stop',
    STOP_LIMIT: 'Stop-Limit'
  })[t] ?? t

const statusLabel = (s: string) =>
  ({
    OPEN: 'Open',
    PARTIAL: 'Partial',
    PENDING_TRIGGER: 'Armed',
    FILLED: 'Filled',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired'
  })[s] ?? s

const statusColor = (s: string) =>
  s === 'PENDING_TRIGGER'
    ? C.warning
    : s === 'FILLED'
      ? T.upText
      : s === 'CANCELLED' || s === 'EXPIRED'
        ? C.muted
        : C.primaryText2

const priceLabel = (o: SpotOrder) => {
  const p = parseFloat(o.price)
  const sp = o.stopPrice ? parseFloat(o.stopPrice) : 0
  if (o.type === 'STOP') return sp ? `trig. ${fmtPx(sp)}` : 'Market'
  if (o.type === 'MARKET') return p > 0 ? fmtPx(p) : 'Market'
  return fmtPx(p)
}

/** Open orders (with Cancel), order history and trade history. */
const OrderHistory: React.FC = () => {
  const {
    userOrders,
    userTrades,
    isConnected,
    walletAddress,
    selectedPair,
    refreshOrders
  } = useSpot()
  const { signMessage } = useSDK()
  const tx = useTx()
  const { historyTab: tab, setHistoryTab } = useTerminal()

  const open = useMemo(
    () => userOrders.filter(o => OPEN.includes(o.status)),
    [userOrders]
  )
  const past = useMemo(
    () => userOrders.filter(o => !OPEN.includes(o.status)),
    [userOrders]
  )

  const cancel = (o: SpotOrder) => {
    if (!walletAddress) return
    const pair = o.pair?.symbol || selectedPair
    let signature = ''
    tx.run({
      type: 'spot',
      title: 'Cancelling order',
      summary: `${pair} · ${typeLabel(o.type)} ${o.side.toLowerCase()} ${fmtAmt(parseFloat(o.remainingAmount || o.amount))}`,
      actTitle: `Cancel ${typeLabel(o.type).toLowerCase()} ${o.side.toLowerCase()} · ${pair}`,
      successTitle: 'Order cancelled',
      steps: [
        {
          label: 'Sign cancel in your wallet',
          wallet: true,
          run: async () => {
            signature = await signMessage(buildSpotCancelSignMessage(o.id))
          }
        },
        {
          label: 'Removing from orderbook',
          run: async () => {
            await spotApi.cancelOrder(o.id, walletAddress, signature)
          }
        }
      ],
      onSuccess: () => void refreshOrders()
    })
  }

  const rows: React.ReactNode[] =
    tab === 'open'
      ? open.map(o => {
          const amt = parseFloat(o.amount) || 0
          const filled = parseFloat(o.filledAmount) || 0
          return (
            <Grid key={o.id} $cols={COLS.open}>
              <span style={{ fontWeight: 600 }}>
                {o.pair?.symbol || selectedPair}
              </span>
              <span>{typeLabel(o.type)}</span>
              {sideCell(o.side)}
              <span>{priceLabel(o)}</span>
              <span>{fmtAmt(amt)}</span>
              <span style={{ color: C.muted }}>
                {amt > 0 ? `${Math.round((filled / amt) * 100)}%` : '0%'}
              </span>
              <span style={{ color: statusColor(o.status) }}>
                {statusLabel(o.status)}
              </span>
              <span style={{ color: C.muted }}>{fmtTime(o.createdAt)}</span>
              <CancelBtn
                onClick={() => cancel(o)}
                aria-label={`Cancel ${typeLabel(o.type)} ${o.side.toLowerCase()} order`}
              >
                Cancel
              </CancelBtn>
            </Grid>
          )
        })
      : tab === 'history'
        ? past.map(o => (
            <Grid key={o.id} $cols={COLS.history}>
              <span style={{ fontWeight: 600 }}>
                {o.pair?.symbol || selectedPair}
              </span>
              <span>{typeLabel(o.type)}</span>
              {sideCell(o.side)}
              <span>{priceLabel(o)}</span>
              <span>{fmtAmt(parseFloat(o.amount) || 0)}</span>
              <span style={{ color: statusColor(o.status) }}>
                {statusLabel(o.status)}
              </span>
              <span style={{ color: C.muted }}>{fmtTime(o.createdAt)}</span>
            </Grid>
          ))
        : userTrades.map(t => {
            const isMaker = t.makerAddress === walletAddress
            const fee = parseFloat(isMaker ? t.makerFee : t.takerFee) || 0
            const b = calcFeeBreakdown(fee, isMaker)
            const split = `${isMaker ? 'Maker' : 'Taker'} fee split — Team ${fmtAmt(b.team)} · Stakers ${fmtAmt(b.stakers)} · Affiliates ${fmtAmt(b.affiliates)}${b.treasury > 0 ? ` · Treasury ${fmtAmt(b.treasury)}` : ''}`
            const side = isMaker
              ? t.side.toUpperCase() === 'BUY'
                ? 'SELL'
                : 'BUY'
              : t.side
            return (
              <Grid key={t.id} $cols={COLS.trades}>
                <span style={{ fontWeight: 600 }}>
                  {t.pair?.symbol || selectedPair}
                </span>
                {sideCell(side)}
                <span>{fmtPx(parseFloat(t.price))}</span>
                <span>{fmtAmt(parseFloat(t.amount) || 0)}</span>
                <FeeCell title={split}>{fmtAmt(fee)}</FeeCell>
                <span style={{ color: C.muted }}>{fmtTime(t.createdAt)}</span>
              </Grid>
            )
          })

  const emptyText = !isConnected
    ? 'API offline — backend unavailable.'
    : !walletAddress
      ? 'Connect your wallet to see your orders.'
      : 'Nothing here yet.'

  return (
    <>
      <UnderlineTabs
        ariaLabel="Orders"
        height={38}
        items={[
          ['open', `Open orders (${walletAddress ? open.length : 0})`],
          ['history', 'Order history'],
          ['trades', 'Trade history']
        ]}
        value={tab}
        onChange={setHistoryTab}
      />
      <Fade key={tab} style={{ flex: 1 }}>
        <Scroll>
          <Inner>
            <Grid $cols={COLS[tab]} $head>
              {HEAD[tab].map((h, i) => (
                <span key={i}>{h}</span>
              ))}
            </Grid>
            {rows.length ? rows : <TEmpty>{emptyText}</TEmpty>}
          </Inner>
        </Scroll>
      </Fade>
    </>
  )
}

export default OrderHistory
