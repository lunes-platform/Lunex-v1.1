import React from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { ArrowLeft } from 'lucide-react'
import { C, grotesk, tabular } from 'components/ui/kit'
import { Trader } from './types'

// ─── Formatting ─────────────────────────────────────────────────

export const fmtPct = (v: number, digits = 1) =>
  `${v > 0 ? '+' : ''}${(Number.isFinite(v) ? v : 0).toFixed(digits)}%`

export const roiColor = (v: number) => (v >= 0 ? C.success : C.criticalText)

export const fmtUsd = (v: number, digits = 2) =>
  `$${(Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`

export const fmtCompactUsd = (v: number) => {
  const n = Number.isFinite(v) ? v : 0
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

/** API `aum` is a pre-formatted string; normalise to a `$…` label. */
export const aumLabel = (aum: string | number | undefined) => {
  if (aum === undefined || aum === null || aum === '') return '$0'
  if (typeof aum === 'number') return fmtCompactUsd(aum)
  const raw = String(aum).trim()
  const n = Number(raw.replace(/[$,\s]/g, ''))
  if (Number.isFinite(n) && /^[$\d.,\s]+$/.test(raw)) return fmtCompactUsd(n)
  return raw.startsWith('$') ? raw : `$${raw}`
}

export const fmtCount = (v: number) => (v ?? 0).toLocaleString('en-US')

export const initials = (name?: string) => {
  const clean = (name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim()
  if (!clean) return '?'
  return clean
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export const handle = (username?: string) =>
  username ? `@${username.replace(/^@/, '')}` : ''

export const relTime = (iso: string) => {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

// ─── Avatar ─────────────────────────────────────────────────────

const isImage = (v?: string) => !!v && /^(https?:|data:image|\/|blob:)/.test(v)

const AvatarCircle = styled.div<{ $size: number; $bg: string }>`
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-weight: 700;
  font-size: ${p => Math.round(p.$size * 0.38)}px;
  color: #fff;
  background: ${p => p.$bg};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

export const TraderAvatar: React.FC<{
  name?: string
  avatar?: string
  ai?: boolean
  size?: number
}> = ({ name, avatar, ai, size = 42 }) => (
  <AvatarCircle
    $size={size}
    $bg={ai ? C.primary : C.borderStrong}
    aria-hidden="true"
  >
    {isImage(avatar) ? <img src={avatar} alt="" /> : initials(name)}
  </AvatarCircle>
)

export const AIBadge = styled.span<{ $lg?: boolean }>`
  height: ${p => (p.$lg ? 22 : 20)}px;
  padding: 0 ${p => (p.$lg ? 7 : 6)}px;
  border-radius: 6px;
  background: rgba(108, 56, 255, 0.18);
  color: ${C.primaryText2};
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-family: 'Inter', sans-serif;
`
AIBadge.defaultProps = { children: 'AI' }

// ─── Sparkline (inline SVG) ─────────────────────────────────────

export const sparkPoints = (data: number[], w = 120, h = 40, pad = 3) => {
  const d = (data || []).filter(n => Number.isFinite(n))
  if (d.length < 2) return `0,${h / 2} ${w},${h / 2}`
  const min = Math.min(...d)
  const max = Math.max(...d)
  const span = max - min || 1
  return d
    .map((v, i) => {
      const x = (i / (d.length - 1)) * w
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export const Sparkline: React.FC<{
  data: number[]
  color: string
  width?: number
  height?: number
}> = ({ data, color, width = 120, height = 40 }) => (
  <svg
    viewBox="0 0 120 40"
    preserveAspectRatio="none"
    style={{ width, height, flexShrink: 0 }}
    aria-hidden="true"
  >
    <polyline
      points={sparkPoints(data)}
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      vectorEffect="non-scaling-stroke"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
)

// ─── Back link ──────────────────────────────────────────────────

const BackBtn = styled.button`
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: ${C.muted};
  font-size: 14px;
  font-weight: 500;
  &:hover {
    color: #fff;
  }
`

export const BackToSocial: React.FC = () => {
  const navigate = useNavigate()
  return (
    <BackBtn type="button" onClick={() => navigate('/social')}>
      <ArrowLeft size={16} strokeWidth={2} />
      Social trading
    </BackBtn>
  )
}

// ─── Small layout helpers shared across social screens ──────────

export const SectionTitle = styled.h2`
  ${grotesk};
  font-size: 18px;
  font-weight: 600;
`

export const MiniStat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  min-width: 0;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child,
  > strong {
    font-weight: 600;
    font-size: 14px;
    color: #fff;
    ${tabular};
    white-space: nowrap;
  }
`

/** List container with 1px separators (vault rows, executions, trades). */
export const ListBox = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
  > * + * {
    border-top: 1px solid ${C.border};
  }
`

export const ListRow = styled.div`
  display: flex;
  gap: 12px;
  padding: 10px 16px;
  font-size: 13px;
  align-items: center;
  ${tabular};
`

export const SideLabel = styled.span<{ $buy: boolean }>`
  font-weight: 600;
  color: ${p => (p.$buy ? C.success : C.criticalText)};
  min-width: 36px;
`

export const DashedEmpty = styled.div`
  padding: 24px;
  border-radius: 14px;
  border: 1px dashed ${C.borderStrong};
  text-align: center;
  font-size: 13px;
  color: ${C.muted};
  line-height: 1.5;
`

export const traderVaultToken = (t?: Pick<Trader, 'vault'> | null) =>
  t?.vault?.collateralToken || 'USDT'
