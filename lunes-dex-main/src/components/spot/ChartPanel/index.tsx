import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
    createChart,
    ColorType,
    IChartApi,
    CandlestickData,
    Time,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    ISeriesApi,
    SeriesType,
} from 'lightweight-charts'
import styled, { css, keyframes } from 'styled-components'
import { spotApi, SpotCandle } from '../../../services/spotService'
import { useSpot } from '../../../context/SpotContext'

interface CandleWithVolume extends CandlestickData {
    volume: number
}

// ──────────── Animations ────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ──────────── Styled Components ────────────

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`

const TfButton = styled.button<{ active?: boolean }>`
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ active }) => (active ? 'rgba(0, 192, 118, 0.2)' : 'transparent')};
  color: ${({ active }) => (active ? '#ffffff' : 'rgba(255,255,255,0.5)')};

  &:hover {
    background: rgba(0, 192, 118, 0.15);
    color: #ffffff;
  }
`

const Divider = styled.span`
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
`

const ChartContainer = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
`

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']

// ──────────── Trade Lines Panel ────────────

const TradeLinesPanel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  animation: ${fadeIn} 0.2s ease;
`

const LineToggleBtn = styled.button<{ lineColor: string; active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid ${({ lineColor, active }) =>
        active ? lineColor : 'rgba(255,255,255,0.1)'};
  background: ${({ lineColor, active }) =>
        active ? `${lineColor}15` : 'transparent'};
  color: ${({ lineColor, active }) =>
        active ? lineColor : 'rgba(255,255,255,0.5)'};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: ${({ lineColor }) => lineColor};
    color: ${({ lineColor }) => lineColor};
  }
`

const LineDot = styled.span<{ dotColor: string }>`
  width: 8px;
  height: 3px;
  border-radius: 2px;
  background: ${({ dotColor }) => dotColor};
`

const PriceInput = styled.input<{ lineColor: string }>`
  width: 80px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid ${({ lineColor }) => `${lineColor}40`};
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
  color: ${({ lineColor }) => lineColor};
  outline: none;
  font-weight: 600;
  text-align: center;

  &:focus {
    border-color: ${({ lineColor }) => lineColor};
    background: rgba(255, 255, 255, 0.08);
  }
`

const LineLabel = styled.span`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
`

const PnlDisplay = styled.span<{ positive: boolean }>`
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${({ positive }) =>
        positive ? 'rgba(0,192,118,0.1)' : 'rgba(255,75,85,0.1)'};
  color: ${({ positive }) =>
        positive ? '#00C076' : '#FF4B55'};
`

const Spacer = styled.div`
  flex: 1;
`

const ClearBtn = styled.button`
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: rgba(255, 75, 85, 0.4);
    color: #FF4B55;
  }
`

// ──────────── Types ────────────

interface TradeLine {
    enabled: boolean
    price: number
}

interface TradeLines {
    entry: TradeLine
    takeProfit: TradeLine
    stopLoss: TradeLine
}

// ──────────── Constants ────────────

const LINE_COLORS = {
    entry: '#3B82F6', // Blue
    takeProfit: '#00C076', // Green
    stopLoss: '#FF4B55', // Red
}

const DEFAULT_ENTRY = 0.02345
const DEFAULT_TP = 0.02500
const DEFAULT_SL = 0.02200

// ─── Mock OHLCV data generator ───────────────────────────────
function generateMockCandles(count = 150): CandleWithVolume[] {
    const now = Math.floor(Date.now() / 1000)
    const interval = 3600
    let close = 0.02345

    return Array.from({ length: count }, (_, i) => {
        const time = (now - (count - i) * interval) as Time
        const open = close
        const change = (Math.random() - 0.48) * 0.001
        close = Math.max(0.001, open + change)
        const high = Math.max(open, close) + Math.random() * 0.0005
        const low = Math.min(open, close) - Math.random() * 0.0005
        const volume = Math.random() * 50000 + 5000
        return { time, open, high, low, close, volume }
    })
}

const OfflineBanner = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(24, 24, 24, 0.92);
  z-index: 10;
  font-size: 13px;
  color: rgba(255,255,255,0.45);
`

const OfflineIcon = styled.span`
  font-size: 28px;
  opacity: 0.4;
`

// ──────────── Component ────────────

const ChartPanel: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
    const [activeTimeframe, setActiveTimeframe] = useState('1h')
    const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
    const [showTradeLines, setShowTradeLines] = useState(false)
    const [isOffline, setIsOffline] = useState(false)
    const [tradeLines, setTradeLines] = useState<TradeLines>({
        entry: { enabled: false, price: DEFAULT_ENTRY },
        takeProfit: { enabled: false, price: DEFAULT_TP },
        stopLoss: { enabled: false, price: DEFAULT_SL },
    })
    const { selectedPair } = useSpot()

    // Fetch candles from API — do NOT fall back to random data which could mislead traders
    const loadCandles = useCallback(async (): Promise<{ data: CandleWithVolume[]; offline: boolean }> => {
        try {
            const res = await spotApi.getCandles(selectedPair, activeTimeframe, 200)
            if (res.candles && res.candles.length > 0) {
                return {
                    data: res.candles.map((c: SpotCandle) => ({
                        time: (new Date(c.openTime).getTime() / 1000) as Time,
                        open: parseFloat(c.open),
                        high: parseFloat(c.high),
                        low: parseFloat(c.low),
                        close: parseFloat(c.close),
                        volume: parseFloat(c.volume) || 0,
                    })).sort((a, b) => (a.time as number) - (b.time as number)),
                    offline: false,
                }
            }
        } catch {
            // API unavailable — show error banner instead of random data
        }
        return { data: [], offline: true }
    }, [selectedPair, activeTimeframe])

    // Create / destroy chart
    useEffect(() => {
        if (!containerRef.current) return

        const container = containerRef.current
        const chart = createChart(container, {
            layout: {
                background: { type: ColorType.Solid, color: '#181818' },
                textColor: 'rgba(255, 255, 255, 0.5)',
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.04)' },
                horzLines: { color: 'rgba(255,255,255,0.04)' },
            },
            crosshair: { mode: 1 },
            rightPriceScale: {
                borderColor: 'rgba(255,255,255,0.1)',
                scaleMargins: { top: 0.1, bottom: 0.25 },
            },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.1)',
                timeVisible: true,
                secondsVisible: false,
            },
            width: container.clientWidth,
            height: container.clientHeight || 360,
        })

        chartRef.current = chart
        let isMounted = true

        loadCandles().then(({ data, offline }) => {
            if (!isMounted || !chart) return

            setIsOffline(offline)
            if (offline || data.length === 0) return // never render random data

            if (chartType === 'candlestick') {
                const candleSeries = chart.addSeries(CandlestickSeries, {
                    upColor: '#00C076',
                    downColor: '#FF4B55',
                    borderUpColor: '#00C076',
                    borderDownColor: '#FF4B55',
                    wickUpColor: '#00C076',
                    wickDownColor: '#FF4B55',
                })
                candleSeries.setData(data)
                seriesRef.current = candleSeries as unknown as ISeriesApi<SeriesType>

                const volSeries = chart.addSeries(HistogramSeries, {
                    color: 'rgba(0, 192, 118, 0.3)',
                    priceFormat: { type: 'volume' },
                    priceScaleId: 'volume',
                })
                chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
                volSeries.setData(
                    data.map(d => ({
                        time: d.time,
                        value: d.volume,
                        color: d.close >= d.open ? 'rgba(0,192,118,0.25)' : 'rgba(255,75,85,0.25)',
                    }))
                )
            } else {
                const lineSeries = chart.addSeries(LineSeries, { color: '#00C076', lineWidth: 2 })
                lineSeries.setData(data.map(d => ({ time: d.time, value: d.close })))
                seriesRef.current = lineSeries as unknown as ISeriesApi<SeriesType>
            }

            chart.timeScale().fitContent()
        })

        const resizeObserver = new ResizeObserver(() => {
            if (container && chart) {
                chart.applyOptions({ width: container.clientWidth, height: container.clientHeight || 360 })
            }
        })
        resizeObserver.observe(container)

        return () => {
            isMounted = false
            resizeObserver.disconnect()
            chart.remove()
            chartRef.current = null
            seriesRef.current = null
        }
    }, [activeTimeframe, chartType, loadCandles])


    // Manage price lines
    useEffect(() => {
        const series = seriesRef.current
        if (!series) return

        // Remove all existing price lines
        const existingLines = (series as any)._priceLines || []
        // We'll use a different approach - recreate on each change

        // Helper to create a price line
        const lines: any[] = []

        if (tradeLines.entry.enabled) {
            const line = series.createPriceLine({
                price: tradeLines.entry.price,
                color: LINE_COLORS.entry,
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: '► Entry',
            })
            lines.push(line)
        }

        if (tradeLines.takeProfit.enabled) {
            const line = series.createPriceLine({
                price: tradeLines.takeProfit.price,
                color: LINE_COLORS.takeProfit,
                lineWidth: 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: '▲ TP',
            })
            lines.push(line)
        }

        if (tradeLines.stopLoss.enabled) {
            const line = series.createPriceLine({
                price: tradeLines.stopLoss.price,
                color: LINE_COLORS.stopLoss,
                lineWidth: 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: '▼ SL',
            })
            lines.push(line)
        }

        return () => {
            lines.forEach(line => {
                try {
                    series.removePriceLine(line)
                } catch {
                    // line already removed
                }
            })
        }
    }, [tradeLines])

    const toggleLine = useCallback((key: keyof TradeLines) => {
        setTradeLines(prev => ({
            ...prev,
            [key]: { ...prev[key], enabled: !prev[key].enabled },
        }))
    }, [])

    const updatePrice = useCallback((key: keyof TradeLines, value: string) => {
        const num = parseFloat(value)
        if (!isNaN(num) && num > 0) {
            setTradeLines(prev => ({
                ...prev,
                [key]: { ...prev[key], price: num },
            }))
        }
    }, [])

    const clearAll = useCallback(() => {
        setTradeLines({
            entry: { enabled: false, price: DEFAULT_ENTRY },
            takeProfit: { enabled: false, price: DEFAULT_TP },
            stopLoss: { enabled: false, price: DEFAULT_SL },
        })
    }, [])

    // Calculate PnL
    const pnl = tradeLines.entry.enabled && tradeLines.takeProfit.enabled
        ? ((tradeLines.takeProfit.price - tradeLines.entry.price) / tradeLines.entry.price * 100)
        : null

    const risk = tradeLines.entry.enabled && tradeLines.stopLoss.enabled
        ? ((tradeLines.stopLoss.price - tradeLines.entry.price) / tradeLines.entry.price * 100)
        : null

    const riskReward = pnl !== null && risk !== null && risk !== 0
        ? Math.abs(pnl / risk)
        : null

    return (
        <Wrapper>
            <Controls>
                {TIMEFRAMES.map(tf => (
                    <TfButton
                        key={tf}
                        active={activeTimeframe === tf}
                        onClick={() => setActiveTimeframe(tf)}
                    >
                        {tf}
                    </TfButton>
                ))}
                <Divider />
                <TfButton
                    active={chartType === 'candlestick'}
                    onClick={() => setChartType('candlestick')}
                    title="Candlestick"
                >
                    ▪▪
                </TfButton>
                <TfButton
                    active={chartType === 'line'}
                    onClick={() => setChartType('line')}
                    title="Line"
                >
                    ╱
                </TfButton>
                <Divider />
                <TfButton
                    active={showTradeLines}
                    onClick={() => setShowTradeLines(v => !v)}
                    title="Trade Lines"
                >
                    ⊞ Trade
                </TfButton>
            </Controls>

            {showTradeLines && (
                <TradeLinesPanel>
                    {/* Entry */}
                    <LineToggleBtn
                        lineColor={LINE_COLORS.entry}
                        active={tradeLines.entry.enabled}
                        onClick={() => toggleLine('entry')}
                    >
                        <LineDot dotColor={LINE_COLORS.entry} />
                        Entry
                    </LineToggleBtn>
                    {tradeLines.entry.enabled && (
                        <PriceInput
                            lineColor={LINE_COLORS.entry}
                            type="number"
                            step={0.00001}
                            value={tradeLines.entry.price}
                            onChange={e => updatePrice('entry', e.target.value)}
                        />
                    )}

                    {/* Take Profit */}
                    <LineToggleBtn
                        lineColor={LINE_COLORS.takeProfit}
                        active={tradeLines.takeProfit.enabled}
                        onClick={() => toggleLine('takeProfit')}
                    >
                        <LineDot dotColor={LINE_COLORS.takeProfit} />
                        TP
                    </LineToggleBtn>
                    {tradeLines.takeProfit.enabled && (
                        <PriceInput
                            lineColor={LINE_COLORS.takeProfit}
                            type="number"
                            step={0.00001}
                            value={tradeLines.takeProfit.price}
                            onChange={e => updatePrice('takeProfit', e.target.value)}
                        />
                    )}

                    {/* Stop Loss */}
                    <LineToggleBtn
                        lineColor={LINE_COLORS.stopLoss}
                        active={tradeLines.stopLoss.enabled}
                        onClick={() => toggleLine('stopLoss')}
                    >
                        <LineDot dotColor={LINE_COLORS.stopLoss} />
                        SL
                    </LineToggleBtn>
                    {tradeLines.stopLoss.enabled && (
                        <PriceInput
                            lineColor={LINE_COLORS.stopLoss}
                            type="number"
                            step={0.00001}
                            value={tradeLines.stopLoss.price}
                            onChange={e => updatePrice('stopLoss', e.target.value)}
                        />
                    )}

                    <Spacer />

                    {/* PnL / Risk-Reward */}
                    {pnl !== null && (
                        <PnlDisplay positive={pnl >= 0}>
                            TP: {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
                        </PnlDisplay>
                    )}
                    {risk !== null && (
                        <PnlDisplay positive={false}>
                            SL: {risk.toFixed(2)}%
                        </PnlDisplay>
                    )}
                    {riskReward !== null && (
                        <LineLabel>
                            R:R {riskReward.toFixed(1)}:1
                        </LineLabel>
                    )}

                    <ClearBtn onClick={clearAll}>
                        ✕ Clear
                    </ClearBtn>
                </TradeLinesPanel>
            )}

            <ChartContainer ref={containerRef}>
                {isOffline && (
                    <OfflineBanner>
                        <OfflineIcon>📡</OfflineIcon>
                        Chart data unavailable — spot-api offline
                    </OfflineBanner>
                )}
            </ChartContainer>
        </Wrapper>
    )
}

export default ChartPanel
