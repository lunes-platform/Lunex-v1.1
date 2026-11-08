/**
 * Live SVG preview of the asymmetric buy / sell liquidity curves.
 *
 * Buy liquidity sits below the current price (left), sell liquidity above
 * (right). Height follows k (relative to the larger side), width follows the
 * max capacity, and the fall-off follows the curvature γ: y ∝ (1 − t)^γ.
 */
import React, { useMemo } from 'react'
import styled from 'styled-components'
import { C, grotesk } from '../ui/kit'

export type CurveSide = {
  /** Base liquidity (LUSDT). */
  k: number
  /** Max capacity (LUSDT). */
  x0: number
  /** Curvature γ 1–5. */
  g: number
}

export const GAMMA_LABELS = [
  '',
  'Linear',
  'Moderate',
  'Balanced',
  'Aggressive',
  'Extreme'
]

const W = 300
const H = 160
const MID = W / 2
const MAX_CAP = 50000

const points = (
  c: CurveSide,
  dir: -1 | 1,
  maxK: number
): [number, number][] => {
  const pts: [number, number][] = []
  const span = MID * ((c.x0 / MAX_CAP) * 0.5 + 0.5)
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    const x = MID + dir * t * span
    const y = H - 10 - (c.k / maxK) * 130 * Math.pow(1 - t, c.g)
    pts.push([x, y])
  }
  return pts
}

const poly = (p: [number, number][]) =>
  p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

const area = (p: [number, number][]) =>
  `M${p[0][0].toFixed(1)} ${H}` +
  p.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('') +
  `L${p[p.length - 1][0].toFixed(1)} ${H}Z`

const Wrap = styled.div`
  flex: 1.3 1 380px;
  min-width: 0;
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.surface};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  path,
  polyline {
    transition: d 200ms ease;
  }
  @media (max-width: 759px) {
    flex-basis: 100%;
  }
`

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  b {
    ${grotesk};
    font-weight: 600;
    font-size: 15px;
  }
  span {
    font-size: 12px;
  }
`

const Axis = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: ${C.muted};
  font-variant-numeric: tabular-nums;
`

type Props = {
  buy: CurveSide
  sell: CurveSide
  pairLabel: string
  /** Current price of the base token in the quote token (optional). */
  price?: number
}

const fmtPrice = (n: number) =>
  n.toLocaleString('en-US', { maximumSignificantDigits: 4 })

const CurveChart: React.FC<Props> = ({ buy, sell, pairLabel, price }) => {
  const { bp, sp } = useMemo(() => {
    const maxK = Math.max(buy.k, sell.k, 1)
    return { bp: points(buy, -1, maxK), sp: points(sell, 1, maxK) }
  }, [buy, sell])

  return (
    <Wrap>
      <Head>
        <b>Liquidity curves · {pairLabel}</b>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ color: C.successText }}>● Buy</span>
          <span style={{ color: C.criticalText2 }}>● Sell</span>
        </div>
      </Head>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 240, display: 'block' }}
        role="img"
        aria-label={`Buy curve γ${buy.g}, sell curve γ${sell.g}`}
      >
        <path
          d={`M0 40H${W}M0 80H${W}M0 120H${W}M${MID} 0V${H}`}
          stroke={C.border}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path d={area(bp)} fill="rgba(38,208,124,0.14)" />
        <path d={area(sp)} fill="rgba(255,93,105,0.14)" />
        <polyline
          points={poly(bp)}
          fill="none"
          stroke={C.success}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={poly(sp)}
          fill="none"
          stroke={C.criticalText}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Axis>
        <span>{price ? fmtPrice(price * 0.8) : '−20%'}</span>
        <span>Current {price ? fmtPrice(price) : 'price'}</span>
        <span>{price ? fmtPrice(price * 1.2) : '+20%'}</span>
      </Axis>
    </Wrap>
  )
}

export default CurveChart
