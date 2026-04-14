import React, { useMemo, useRef, useCallback, useState } from 'react'
import styled from 'styled-components'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────

export interface CurveParams {
  k: number // base liquidity
  L: number // leverage
  c: number // allocation 0–1
  x0: number // max capacity
  gamma: number // curvature 1–5
  feeT: number // fee rate e.g. 0.003
  interestR: number // interest rate e.g. 0.01
}

interface Props {
  buyParams: CurveParams
  sellParams: CurveParams
  label?: React.ReactNode
  /** Callback fired when the user drags on the chart to adjust γ. */
  onGammaChange?: (side: 'buy' | 'sell', newGamma: number) => void
  /** When true, chart is interactive — curve adjusts on drag. */
  interactive?: boolean
}

// ─── Math ─────────────────────────────────────────────────────────

function simulateLiquidity(x: number, p: CurveParams): number {
  if (x >= p.x0 || p.x0 <= 0) return 0
  const base = p.k + p.c * p.L
  const exhaustion = Math.pow(1 - x / p.x0, p.gamma)
  const gross = base * exhaustion
  const feeDiscount = p.feeT * x
  const interestDiscount = p.interestR * p.L
  return Math.max(0, gross - feeDiscount - interestDiscount)
}

function buildChartData(
  buyParams: CurveParams,
  sellParams: CurveParams,
  steps = 50
) {
  const maxX = Math.max(buyParams.x0, sellParams.x0)
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = (i / steps) * maxX
    return {
      x: parseFloat(x.toFixed(2)),
      buy: parseFloat(simulateLiquidity(x, buyParams).toFixed(4)),
      sell: parseFloat(simulateLiquidity(x, sellParams).toFixed(4))
    }
  })
}

// ─── Styled ───────────────────────────────────────────────────────

const ChartWrapper = styled.div<{ isDragging?: boolean }>`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 16px;
  padding: 20px;
  cursor: ${({ isDragging }) => (isDragging ? 'ns-resize' : 'default')};
  user-select: ${({ isDragging }) => (isDragging ? 'none' : 'auto')};
`

const ChartHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const ChartTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0;
`

const GammaBadge = styled.span<{ side: 'buy' | 'sell' }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  background: ${({ side }) =>
    side === 'buy' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)'};
  color: ${({ side }) => (side === 'buy' ? '#34d399' : '#f87171')};
`

const BadgesRow = styled.div`
  display: flex;
  gap: 8px;
`

const DragHint = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[300]};
  opacity: 0.7;
`

const tooltipStyle = {
  backgroundColor: '#1a1a2e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  fontSize: 12
}

// ─── Component ────────────────────────────────────────────────────

const CurveChart: React.FC<Props> = ({
  buyParams,
  sellParams,
  label,
  onGammaChange,
  interactive = false
}) => {
  const data = useMemo(
    () => buildChartData(buyParams, sellParams),
    [buyParams, sellParams]
  )

  // ── Drag-to-adjust gamma ────────────────────────────────────
  const dragRef = useRef<{
    startY: number
    side: 'buy' | 'sell'
    startGamma: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive || !onGammaChange) return
      // Left half of chart = buy curve, right half = sell curve
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const relX = e.clientX - rect.left
      const side: 'buy' | 'sell' = relX < rect.width / 2 ? 'buy' : 'sell'
      dragRef.current = {
        startY: e.clientY,
        side,
        startGamma: side === 'buy' ? buyParams.gamma : sellParams.gamma
      }
      setIsDragging(true)
    },
    [interactive, onGammaChange, buyParams.gamma, sellParams.gamma]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current || !onGammaChange) return
      const deltaY = dragRef.current.startY - e.clientY // up = positive
      const sensitivity = 0.02 // γ change per pixel
      const rawGamma = dragRef.current.startGamma + deltaY * sensitivity
      const clampedGamma =
        Math.round(Math.max(1, Math.min(5, rawGamma)) * 10) / 10
      onGammaChange(dragRef.current.side, clampedGamma)
    },
    [onGammaChange]
  )

  const handleMouseUp = useCallback(() => {
    dragRef.current = null
    setIsDragging(false)
  }, [])

  return (
    <ChartWrapper
      isDragging={isDragging}
      onMouseDown={interactive ? handleMouseDown : undefined}
      onMouseMove={interactive ? handleMouseMove : undefined}
      onMouseUp={interactive ? handleMouseUp : undefined}
      onMouseLeave={interactive ? handleMouseUp : undefined}
    >
      <ChartHeader>
        <ChartTitle>{label || 'Liquidity Curves'}</ChartTitle>
        <BadgesRow>
          <GammaBadge side="buy">Buy γ={buyParams.gamma}</GammaBadge>
          <GammaBadge side="sell">Sell γ={sellParams.gamma}</GammaBadge>
          {interactive && <DragHint>↕ drag to adjust γ</DragHint>}
        </BadgesRow>
      </ChartHeader>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradBuy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradSell" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />

          <XAxis
            dataKey="x"
            tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'Volume',
              position: 'insideBottomRight',
              offset: -8,
              fill: '#6b7280',
              fontSize: 11
            }}
          />

          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'Liquidity',
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              fill: '#6b7280',
              fontSize: 11
            }}
          />

          <Tooltip contentStyle={tooltipStyle} />

          <Legend
            wrapperStyle={{ fontFamily: 'Inter', fontSize: 12, paddingTop: 8 }}
          />

          <Area
            type="monotone"
            dataKey="buy"
            name="Buy Curve"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#gradBuy)"
            dot={false}
            activeDot={{ r: 4, fill: '#34d399' }}
          />

          <Area
            type="monotone"
            dataKey="sell"
            name="Sell Curve"
            stroke="#f87171"
            strokeWidth={2}
            fill="url(#gradSell)"
            dot={false}
            activeDot={{ r: 4, fill: '#f87171' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}

export { simulateLiquidity, buildChartData }
export default CurveChart
