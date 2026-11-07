import React, { useEffect, useMemo, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { C, grotesk, tabular } from 'components/ui/kit'
import AnimatedNumber from 'components/ui/AnimatedNumber'
import { flashGreen, flashRed } from '../../../styles/motion'
import {
  Fade,
  Segmented,
  T,
  TEmpty,
  fmtAmt,
  fmtPx,
  fmtTime,
  nf,
  pxDec,
  splitPair,
  useTerminal
} from '../terminal'

type Level = { price: number; amount: number; total: number }
type View = 'book' | 'trades'
type Flash = 'up' | 'down'

const FLASH_MS = 900
const ROWS = 24
const GRID = '1.1fr 1fr 1fr'

const flashCss = (f?: Flash) =>
  f
    ? css`
        animation: ${f === 'up' ? flashGreen : flashRed} ${FLASH_MS}ms ease;
      `
    : ''

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid ${T.line};
  flex-shrink: 0;
`

const Prec = styled.select`
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid ${C.borderStrong};
  background: ${T.input};
  color: ${C.body};
  font-size: 11px;
  ${tabular};
  outline: none;
  option {
    background: ${C.surface};
  }
`

const Cols = styled.div`
  display: grid;
  grid-template-columns: ${GRID};
  padding: 6px 12px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${C.muted};
  flex-shrink: 0;
  span:nth-child(n + 2) {
    text-align: right;
  }
`

const Side = styled.div<{ $asks?: boolean }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: ${p => (p.$asks ? 'flex-end' : 'flex-start')};
`

const LevelRow = styled.button<{ $flash?: Flash }>`
  position: relative;
  display: grid;
  grid-template-columns: ${GRID};
  align-items: center;
  height: 21px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: ${C.text};
  font-size: 12px;
  text-align: left;
  width: 100%;
  flex-shrink: 0;
  ${tabular};
  ${p => flashCss(p.$flash)};
  &:hover {
    background: ${T.rowHover};
  }
  > span {
    position: relative;
  }
  > span:nth-child(3) {
    text-align: right;
    color: ${C.body};
  }
  > span:nth-child(4) {
    text-align: right;
    color: ${C.muted};
  }
`

const Depth = styled.i<{ $ask: boolean }>`
  position: absolute !important;
  right: 0;
  top: 1px;
  bottom: 1px;
  background: ${p =>
    p.$ask ? 'rgba(255,40,76,0.12)' : 'rgba(38,208,124,0.12)'};
  transition: width 300ms ease;
  pointer-events: none;
`

const Px = styled.span<{ $ask: boolean }>`
  color: ${p => (p.$ask ? T.down : T.up)};
  font-weight: 600;
`

const Mid = styled.div<{ $up: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 12px;
  border-top: 1px solid ${T.line};
  border-bottom: 1px solid ${T.line};
  flex-shrink: 0;
  b {
    ${grotesk};
    ${tabular};
    font-size: 16px;
    font-weight: 600;
    color: ${p => (p.$up ? T.up : T.down)};
  }
  span {
    font-size: 11px;
    color: ${C.muted};
    ${tabular};
  }
`

const TradesList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`

const TradeRow = styled.div<{ $flash?: Flash }>`
  display: grid;
  grid-template-columns: ${GRID};
  height: 21px;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  ${tabular};
  ${p => flashCss(p.$flash)};
  span:nth-child(2) {
    text-align: right;
    color: ${C.body};
  }
  span:nth-child(3) {
    text-align: right;
    color: ${C.muted};
  }
`

/** Group levels into price buckets: bids round down, asks round up. */
function group(levels: Level[], step: number, ask: boolean): Level[] {
  const map = new Map<string, Level>()
  const dec = Math.max(0, Math.round(-Math.log10(step)))
  for (const l of levels) {
    const k = ask
      ? Math.ceil(l.price / step - 1e-9) * step
      : Math.floor(l.price / step + 1e-9) * step
    const key = k.toFixed(dec)
    const cur = map.get(key)
    if (cur) cur.amount += l.amount
    else map.set(key, { price: Number(key), amount: l.amount, total: 0 })
  }
  const out = Array.from(map.values()).sort((a, b) =>
    ask ? a.price - b.price : b.price - a.price
  )
  // cumulative depth from the spread outwards
  let cum = 0
  for (const l of out) {
    cum += l.amount
    l.total = cum
  }
  return out
}

const clean = (l?: Level[]): Level[] =>
  (l || [])
    .filter(Boolean)
    .map(x => ({
      price: Number(x.price),
      amount: Number(x.amount),
      total: 0
    }))
    .filter(x => x.price > 0 && x.amount > 0)

/**
 * Order book + recent trades. Clicking a level sends its price to the
 * order form. Changed levels and new trades flash green / red for 900ms.
 */
const OrderBook: React.FC = () => {
  const { orderbook, recentTrades, ticker, selectedPair } = useSpot()
  const { pickPrice } = useTerminal()
  const [view, setView] = useState<View>('book')
  const [prec, setPrec] = useState(0)
  const [, quote] = splitPair(selectedPair)

  useEffect(() => setPrec(0), [selectedPair])

  const ref =
    ticker?.lastPrice ||
    orderbook?.bestBid ||
    orderbook?.bestAsk ||
    orderbook?.bids?.[0]?.price ||
    0
  const dp = pxDec(Number(ref))
  const step = Math.pow(10, -(dp - prec))
  const shownDec = Math.max(0, dp - prec)

  const asks = useMemo(
    () => group(clean(orderbook?.asks), step, true).slice(0, ROWS),
    [orderbook, step]
  )
  const bids = useMemo(
    () => group(clean(orderbook?.bids), step, false).slice(0, ROWS),
    [orderbook, step]
  )
  const maxTotal = Math.max(
    asks[asks.length - 1]?.total || 0,
    bids[bids.length - 1]?.total || 0,
    1e-12
  )

  // ── live ticks: diff levels against the previous snapshot ──
  const prevRef = useRef<Map<string, number>>(new Map())
  const [flashes, setFlashes] = useState<
    Record<string, { f: Flash; n: number }>
  >({})
  useEffect(() => {
    const next = new Map<string, number>()
    const changed: Record<string, Flash> = {}
    const prev = prevRef.current
    const scan = (side: 'a' | 'b', list: Level[]) =>
      list.forEach(l => {
        const key = `${side}:${l.price}`
        next.set(key, l.amount)
        const before = prev.get(key)
        if (prev.size && before !== l.amount) {
          changed[key] =
            before === undefined || l.amount > before
              ? side === 'b'
                ? 'up'
                : 'down'
              : side === 'b'
                ? 'down'
                : 'up'
        }
      })
    scan('a', asks)
    scan('b', bids)
    prevRef.current = next
    const keys = Object.keys(changed)
    if (!keys.length) return
    setFlashes(f => {
      const out = { ...f }
      keys.forEach(k => (out[k] = { f: changed[k], n: (f[k]?.n ?? 0) + 1 }))
      return out
    })
    const t = setTimeout(
      () =>
        setFlashes(f => {
          const out = { ...f }
          keys.forEach(k => delete out[k])
          return out
        }),
      FLASH_MS
    )
    return () => clearTimeout(t)
  }, [asks, bids])

  useEffect(() => {
    prevRef.current = new Map()
    setFlashes({})
  }, [selectedPair, prec])

  // new trades flash (only ids that appear after the first snapshot)
  const seenTrades = useRef<Set<string> | null>(null)
  const [freshTrades, setFreshTrades] = useState<Set<string>>(new Set())
  useEffect(() => {
    const ids = recentTrades.map(t => t.id)
    if (!seenTrades.current || ids.length === 0) {
      seenTrades.current = new Set(ids)
      return
    }
    const fresh = ids.filter(id => !seenTrades.current?.has(id))
    ids.forEach(id => seenTrades.current?.add(id))
    // a burst means a snapshot (REST reload), not live ticks
    if (!fresh.length || fresh.length > 5) return
    setFreshTrades(new Set(fresh))
    const t = setTimeout(() => setFreshTrades(new Set()), FLASH_MS)
    return () => clearTimeout(t)
  }, [recentTrades])
  useEffect(() => {
    seenTrades.current = null
  }, [selectedPair])

  const price = ticker?.lastPrice ?? 0
  const up = (ticker?.change24h ?? 0) >= 0
  const bestAsk = asks[0]?.price ?? 0
  const bestBid = bids[0]?.price ?? 0
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0
  const spreadRef = price || (bestAsk + bestBid) / 2

  const renderLevel = (l: Level, ask: boolean) => {
    const key = `${ask ? 'a' : 'b'}:${l.price}`
    const fl = flashes[key]
    return (
      <LevelRow
        key={`${key}:${fl?.n ?? 0}`}
        $flash={fl?.f}
        title="Use this price"
        onClick={() => pickPrice(l.price)}
      >
        <Depth $ask={ask} style={{ width: `${(l.total / maxTotal) * 100}%` }} />
        <Px $ask={ask}>{nf(l.price, shownDec)}</Px>
        <span>{fmtAmt(l.amount)}</span>
        <span>{fmtAmt(l.total)}</span>
      </LevelRow>
    )
  }

  const precOpts = [0, 1, 2].map(k => ({
    v: k,
    label: Math.pow(10, -(dp - k)).toFixed(Math.max(0, dp - k))
  }))

  return (
    <>
      <Head>
        <Segmented
          ariaLabel="Book view"
          items={[
            ['book', 'Book'],
            ['trades', 'Trades']
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'book' && (
          <Prec
            value={prec}
            onChange={e => setPrec(Number(e.target.value))}
            aria-label="Price grouping"
          >
            {precOpts.map(o => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </Prec>
        )}
      </Head>

      {view === 'book' ? (
        <Fade key="book" style={{ flex: 1 }}>
          <Cols>
            <span>Price ({quote})</span>
            <span>Size</span>
            <span>Total</span>
          </Cols>
          {asks.length === 0 && bids.length === 0 ? (
            <TEmpty style={{ flex: 1 }}>No orders in the book yet</TEmpty>
          ) : (
            <>
              <Side $asks>
                {[...asks].reverse().map(l => renderLevel(l, true))}
              </Side>
              <Mid $up={up}>
                <b>
                  {price > 0 ? (
                    <AnimatedNumber text={fmtPx(price)} noFlash />
                  ) : (
                    '—'
                  )}
                </b>
                <span>
                  Spread{' '}
                  {spread > 0
                    ? `${nf(spread, shownDec)} (${((spread / spreadRef) * 100).toFixed(2)}%)`
                    : '—'}
                </span>
              </Mid>
              <Side>{bids.map(l => renderLevel(l, false))}</Side>
            </>
          )}
        </Fade>
      ) : (
        <Fade key="trades" style={{ flex: 1 }}>
          <Cols>
            <span>Price</span>
            <span>Amount</span>
            <span>Time</span>
          </Cols>
          <TradesList>
            {recentTrades.length === 0 ? (
              <TEmpty>No trades yet</TEmpty>
            ) : (
              recentTrades.slice(0, 50).map(t => {
                const buy = t.side.toUpperCase() === 'BUY'
                const p = parseFloat(t.price)
                return (
                  <TradeRow
                    key={t.id}
                    $flash={
                      freshTrades.has(t.id) ? (buy ? 'up' : 'down') : undefined
                    }
                  >
                    <span
                      style={{ color: buy ? T.up : T.down, fontWeight: 600 }}
                    >
                      {fmtPx(p, pxDec(p))}
                    </span>
                    <span>{fmtAmt(parseFloat(t.amount))}</span>
                    <span>{fmtTime(t.createdAt)}</span>
                  </TradeRow>
                )
              })
            )}
          </TradesList>
        </Fade>
      )}
    </>
  )
}

export default OrderBook
