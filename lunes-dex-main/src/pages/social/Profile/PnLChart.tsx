import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { C, grotesk, tabular } from 'components/ui/kit'
import { fmtPct } from '../shared'

const Wrap = styled.div`
  position: relative;
  width: 100%;
  height: 200px;
  @media (max-width: 759px) {
    height: 160px;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
`

const Tip = styled.div`
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 8px;
  background: ${C.bg};
  border: 1px solid ${C.borderStrong};
  font-size: 12px;
  font-weight: 600;
  ${grotesk};
  ${tabular};
  pointer-events: none;
  white-space: nowrap;
`

const Axis = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: ${C.muted};
  ${tabular};
`

const Empty = styled.div`
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${C.muted};
  font-size: 13px;
  border: 1px dashed ${C.borderStrong};
  border-radius: 12px;
`

const W = 120
const H = 40

/** 30-day PnL line (inline SVG). Values are cumulative PnL % per point. */
const PnLChart: React.FC<{ data: number[]; color: string }> = ({
  data,
  color
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const pts = useMemo(() => {
    const d = (data || []).filter(n => Number.isFinite(n))
    if (d.length < 2) return null
    const min = Math.min(...d, 0)
    const max = Math.max(...d, 0)
    const span = max - min || 1
    const pad = 2
    const xy = d.map((v, i) => ({
      v,
      x: (i / (d.length - 1)) * W,
      y: H - pad - ((v - min) / span) * (H - pad * 2)
    }))
    const zeroY = H - pad - ((0 - min) / span) * (H - pad * 2)
    return { xy, zeroY }
  }, [data])

  if (!pts) return <Empty>Not enough history yet.</Empty>

  const line = pts.xy.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  const gid = `pnl-${color.replace('#', '')}`
  const h = hover !== null ? pts.xy[hover] : null

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setHover(Math.round(ratio * (pts.xy.length - 1)))
  }

  return (
    <>
      <Wrap
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`PnL over the last 30 days, ending at ${fmtPct(
          pts.xy[pts.xy.length - 1].v
        )}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 10H120M0 20H120M0 30H120"
            stroke={C.border}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={W}
            y1={pts.zeroY}
            y2={pts.zeroY}
            stroke={C.borderStrong}
            strokeDasharray="3 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={area} fill={`url(#${gid})`} />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {h && (
            <line
              x1={h.x}
              x2={h.x}
              y1={0}
              y2={H}
              stroke={C.borderStrong}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {h && (
          <Tip
            style={{
              left: `${Math.min(92, Math.max(8, (h.x / W) * 100))}%`,
              color: h.v >= 0 ? C.successText : C.criticalText
            }}
          >
            {fmtPct(h.v, 2)}
          </Tip>
        )}
      </Wrap>
      <Axis>
        <span>30d ago</span>
        <span>15d</span>
        <span>Today</span>
      </Axis>
    </>
  )
}

export default PnLChart
