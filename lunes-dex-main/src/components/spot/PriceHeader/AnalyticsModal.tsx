import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { spotApi } from 'services/spotService'
import { Dialog } from 'components/ui/Dialog'
import { C, EASE_OUT } from 'components/ui/kit'
import { T, fmtPx, fq, splitPair } from '../terminal'
import { RowKV, Rows, SectionTitle, Tile, Tiles } from './parts'

const Bars = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 110px;
`

const BarCol = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
  justify-content: flex-end;
  span {
    font-size: 10px;
    color: ${C.muted};
  }
`

const BarFill = styled.div`
  width: 100%;
  background: ${C.primary};
  border-radius: 4px 4px 0 0;
  transition: height 300ms ${EASE_OUT};
`

const NoData = styled.div`
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px dashed ${C.borderStrong};
  font-size: 12px;
  color: ${C.muted};
`

type Day = { day: string; vol: number }

const AnalyticsModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose
}) => {
  const { selectedPair, ticker, orderbook } = useSpot()
  const [days, setDays] = useState<Day[] | null>(null)
  const [base] = splitPair(selectedPair)

  // 7d volume from daily candles (real data; empty when the API is offline)
  useEffect(() => {
    if (!open) return
    let alive = true
    spotApi
      .getCandles(selectedPair, '1d', 7)
      .then(res => {
        if (!alive) return
        setDays(
          (res.candles || []).slice(-7).map(c => ({
            day: new Date(c.openTime).toLocaleDateString('en-US', {
              weekday: 'short'
            }),
            vol: parseFloat(c.volume) || 0
          }))
        )
      })
      .catch(() => alive && setDays([]))
    return () => {
      alive = false
    }
  }, [open, selectedPair])

  const price = ticker?.lastPrice ?? 0
  const bestBid = orderbook?.bestBid ?? ticker?.bestBid ?? 0
  const bestAsk = orderbook?.bestAsk ?? ticker?.bestAsk ?? 0
  const spreadPct =
    bestBid > 0 && bestAsk > 0 && price > 0
      ? ((bestAsk - bestBid) / price) * 100
      : null

  const depth = useMemo(() => {
    const sum = (l?: Array<{ amount: number }>) =>
      (l || []).slice(0, 20).reduce((s, x) => s + (Number(x?.amount) || 0), 0)
    const bid = sum(orderbook?.bids)
    const ask = sum(orderbook?.asks)
    return { bid, ask, buyPct: bid + ask > 0 ? (bid / (bid + ask)) * 100 : 0 }
  }, [orderbook])

  const maxVol = Math.max(1, ...(days || []).map(d => d.vol))
  const hasVol = !!days && days.some(d => d.vol > 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${selectedPair} analytics`}
      width={460}
      padding={22}
    >
      <Tiles>
        <Tile>
          <div>24h volume</div>
          <div>
            {ticker?.volume24h ? `${fq(ticker.volume24h)} ${base}` : '—'}
          </div>
        </Tile>
        <Tile>
          <div>Trades</div>
          <div>{ticker ? ticker.tradeCount.toLocaleString('en-US') : '—'}</div>
        </Tile>
        <Tile>
          <div>Spread</div>
          <div>{spreadPct !== null ? `${spreadPct.toFixed(2)}%` : '—'}</div>
        </Tile>
      </Tiles>

      <SectionTitle>Volume trend (7d)</SectionTitle>
      {hasVol ? (
        <Bars>
          {(days || []).map((d, i) => (
            <BarCol key={i} title={`${d.day}: ${fq(d.vol)} ${base}`}>
              <BarFill
                style={{ height: `${Math.max(3, (d.vol / maxVol) * 100)}%` }}
              />
              <span>{d.day}</span>
            </BarCol>
          ))}
        </Bars>
      ) : (
        <NoData>
          {days === null ? 'Loading volume…' : 'No volume data for this market'}
        </NoData>
      )}

      <Rows>
        <RowKV>
          <span>Best bid</span>
          <span style={{ color: bestBid ? T.up : undefined }}>
            {fmtPx(bestBid)}
          </span>
        </RowKV>
        <RowKV>
          <span>Best ask</span>
          <span style={{ color: bestAsk ? T.down : undefined }}>
            {fmtPx(bestAsk)}
          </span>
        </RowKV>
        <RowKV>
          <span>Bid depth (top 20)</span>
          <span>
            {fq(depth.bid)} {base}
          </span>
        </RowKV>
        <RowKV>
          <span>Ask depth (top 20)</span>
          <span>
            {fq(depth.ask)} {base}
          </span>
        </RowKV>
        <RowKV>
          <span>Buy pressure</span>
          <span>
            {depth.bid + depth.ask > 0 ? `${depth.buyPct.toFixed(0)}%` : '—'}
          </span>
        </RowKV>
      </Rows>
    </Dialog>
  )
}

export default AnalyticsModal
