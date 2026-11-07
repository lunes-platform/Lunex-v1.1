import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  SeriesType,
  Time,
  createChart
} from 'lightweight-charts'
import { WifiOff, CandlestickChart } from 'lucide-react'
import { useSpot } from 'context/SpotContext'
import { spotApi, SpotCandle } from 'services/spotService'
import { C, Spinner } from 'components/ui/kit'
import { T, Segmented, pxDec } from '../terminal'

type Bar = {
  time: Time
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type ChartType = 'candle' | 'line'
type Status = 'loading' | 'ready' | 'empty' | 'offline'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const
type Tf = (typeof TIMEFRAMES)[number]
const TF_SECONDS: Record<Tf, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800
}

const VOL_UP = 'rgba(38,208,124,0.28)'
const VOL_DOWN = 'rgba(255,93,105,0.28)'

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 8px;
  flex: 1;
  min-height: 0;
`

const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
`

const Tfs = styled.div`
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
`

const TfBtn = styled.button<{ $on: boolean }>`
  height: 28px;
  padding: 0 9px;
  border: none;
  border-radius: 7px;
  background: ${p => (p.$on ? T.line : 'transparent')};
  color: ${p => (p.$on ? C.text : C.muted)};
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition:
    background-color 150ms ease,
    color 150ms ease;
  &:hover {
    color: ${C.text};
  }
`

const Area = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  @media (max-width: 1199px) {
    flex: none;
    height: 300px;
  }
  @media (max-width: 759px) {
    height: 280px;
  }
`

const Canvas = styled.div`
  position: absolute;
  inset: 0;
`

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 16px;
  background: rgba(26, 26, 26, 0.88);
  color: ${C.muted};
  font-size: 13px;
  svg {
    color: ${C.borderStrong};
  }
`

const toBar = (c: SpotCandle): Bar => ({
  time: Math.floor(new Date(c.openTime).getTime() / 1000) as Time,
  open: parseFloat(c.open),
  high: parseFloat(c.high),
  low: parseFloat(c.low),
  close: parseFloat(c.close),
  volume: parseFloat(c.volume) || 0
})

/**
 * Price chart (lightweight-charts): timeframes 1m–1w, candles or line,
 * volume bars and a purple last-price tag on the price axis. Candles come
 * from spot-api; the last bar follows the live ticker.
 */
const ChartPanel: React.FC = () => {
  const { selectedPair, ticker } = useSpot()
  const [tf, setTf] = useState<Tf>('1h')
  const [type, setType] = useState<ChartType>('candle')
  const [status, setStatus] = useState<Status>('loading')
  const [bars, setBars] = useState<Bar[]>([])

  const boxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const priceRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineRef = useRef<IPriceLine | null>(null)
  const barsRef = useRef<Bar[]>([])
  barsRef.current = bars

  // Create the chart once.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      layout: {
        background: { type: ColorType.Solid, color: T.panel },
        textColor: C.muted,
        fontSize: 10,
        fontFamily: 'Inter, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: C.surface }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: T.line,
        scaleMargins: { top: 0.08, bottom: 0.24 }
      },
      timeScale: {
        borderColor: T.line,
        timeVisible: true,
        secondsVisible: false
      },
      width: box.clientWidth,
      height: box.clientHeight || 300
    })
    chartRef.current = chart
    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: box.clientWidth,
        height: box.clientHeight || 300
      })
    })
    ro.observe(box)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      priceRef.current = null
      volRef.current = null
      lineRef.current = null
    }
  }, [])

  // Load candles for the pair / timeframe — never invent data.
  useEffect(() => {
    let alive = true
    setStatus('loading')
    if (!selectedPair) return
    spotApi
      .getCandles(selectedPair, tf, 200)
      .then(res => {
        if (!alive) return
        const data = (res.candles || [])
          .map(toBar)
          .filter(b => Number.isFinite(b.close))
          .sort((a, b) => (a.time as number) - (b.time as number))
        setBars(data)
        setStatus(data.length ? 'ready' : 'empty')
      })
      .catch(() => {
        if (!alive) return
        setBars([])
        setStatus('offline')
      })
    return () => {
      alive = false
    }
  }, [selectedPair, tf])

  // (Re)build series when data or chart type changes.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (priceRef.current) chart.removeSeries(priceRef.current)
    if (volRef.current) chart.removeSeries(volRef.current)
    priceRef.current = null
    volRef.current = null
    lineRef.current = null
    if (!bars.length) return

    const last = bars[bars.length - 1]
    const dp = pxDec(last.close)
    const priceFormat = {
      type: 'price' as const,
      precision: dp,
      minMove: Math.pow(10, -dp)
    }

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    })
    vol.setData(
      bars.map(b => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? VOL_UP : VOL_DOWN
      }))
    )

    let series: ISeriesApi<SeriesType>
    if (type === 'candle') {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: T.up,
        downColor: T.down,
        borderUpColor: T.up,
        borderDownColor: T.down,
        wickUpColor: T.up,
        wickDownColor: T.down,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat
      })
      s.setData(bars)
      series = s as unknown as ISeriesApi<SeriesType>
    } else {
      const s = chart.addSeries(LineSeries, {
        color: C.primaryText,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat
      })
      s.setData(bars.map(b => ({ time: b.time, value: b.close })))
      series = s as unknown as ISeriesApi<SeriesType>
    }

    lineRef.current = series.createPriceLine({
      price: last.close,
      color: C.primaryText,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: C.primary,
      axisLabelTextColor: '#FFFFFF',
      title: ''
    })
    priceRef.current = series
    volRef.current = vol
    chart.timeScale().fitContent()
  }, [bars, type])

  // Live: move the last bar and the last-price tag with the ticker.
  const livePrice = ticker?.symbol === selectedPair ? ticker.lastPrice : 0
  useEffect(() => {
    const series = priceRef.current
    const list = barsRef.current
    if (!series || !list.length || !livePrice) return
    const last = list[list.length - 1]
    const step = TF_SECONDS[tf]
    const now = Math.floor(Date.now() / 1000)
    const bucket = (Math.floor(now / step) * step) as Time
    const next: Bar =
      (last.time as number) >= (bucket as number)
        ? {
            ...last,
            close: livePrice,
            high: Math.max(last.high, livePrice),
            low: Math.min(last.low, livePrice)
          }
        : {
            time: bucket,
            open: last.close,
            high: Math.max(last.close, livePrice),
            low: Math.min(last.close, livePrice),
            close: livePrice,
            volume: 0
          }
    try {
      if (type === 'candle') series.update(next)
      else series.update({ time: next.time, value: next.close })
      lineRef.current?.applyOptions({ price: livePrice })
    } catch {
      // out-of-order update (clock skew) — ignore
    }
  }, [livePrice, tf, type])

  return (
    <Wrap>
      <Controls>
        <Tfs role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map(t => (
            <TfBtn
              key={t}
              role="tab"
              aria-selected={tf === t}
              $on={tf === t}
              onClick={() => setTf(t)}
            >
              {t}
            </TfBtn>
          ))}
        </Tfs>
        <Segmented
          ariaLabel="Chart type"
          items={[
            ['candle', 'Candles'],
            ['line', 'Line']
          ]}
          value={type}
          onChange={setType}
        />
      </Controls>
      <Area>
        <Canvas ref={boxRef} />
        {status === 'loading' && (
          <Overlay>
            <Spinner $size={18} $color={C.primaryText} />
            Loading chart…
          </Overlay>
        )}
        {status === 'offline' && (
          <Overlay>
            <WifiOff size={22} />
            Chart data unavailable — spot-api offline
          </Overlay>
        )}
        {status === 'empty' && (
          <Overlay>
            <CandlestickChart size={22} />
            No trades yet — the chart starts with the first fill
          </Overlay>
        )}
      </Area>
    </Wrap>
  )
}

export default ChartPanel
