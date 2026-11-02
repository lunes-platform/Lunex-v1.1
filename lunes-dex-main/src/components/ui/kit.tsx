/**
 * Lunex UI kit — shared primitives for the redesign (Claude Design handoff).
 *
 * Tokens: see README "Design tokens". Cards 24, panels/inputs 16, chips 10–12,
 * pills 999. 4/8 grid. Space Grotesk for headings, numbers and buttons.
 */
import React from 'react'
import styled, { css } from 'styled-components'
import {
  pageEnter,
  fadeIn,
  spin,
  skeletonShimmer,
  riseIn
} from '../../styles/motion'

export const C = {
  bg: '#1A1A1A',
  surface: '#232323',
  field: '#2A2A2C',
  border: '#2A2A2C',
  borderStrong: '#47474A',
  muted: '#8A8A8E',
  secondary: '#B6B6B6',
  body: '#D0D0D3',
  text: '#FFFFFF',
  primary: '#6C38FF',
  primaryHover: '#5228DB',
  primaryBorder: '#3C1CB7',
  primaryText: '#AD87FF',
  primaryText2: '#CAAFFF',
  success: '#26D07C',
  successText: '#57E290',
  critical: '#FF284C',
  criticalText: '#FF5D69',
  criticalText2: '#FF807E',
  warning: '#FE923F',
  space: '#07070A',
  terminal: '#0D0D0D',
  terminalInput: '#141414'
} as const

export const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

export const tint = {
  primary: { bg: 'rgba(108,56,255,0.12)', border: C.primaryBorder },
  success: { bg: 'rgba(38,208,124,0.14)', border: 'rgba(38,208,124,0.35)' },
  critical: { bg: 'rgba(255,40,76,0.1)', border: 'rgba(255,93,105,0.35)' },
  warning: { bg: 'rgba(254,146,63,0.1)', border: 'rgba(254,146,63,0.35)' }
} as const

export const grotesk = css`
  font-family: 'Space Grotesk', 'Inter', sans-serif;
`

export const tabular = css`
  font-variant-numeric: tabular-nums;
`

// ─── Layout ──────────────────────────────────────────────────────

/** Page wrapper with enter animation. `$fadeOnly` for Spot (fade 150ms). */
export const Page = styled.div<{ $max?: number; $fadeOnly?: boolean }>`
  width: 100%;
  max-width: ${p => (p.$max ? `${p.$max}px` : 'none')};
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: ${p =>
    p.$fadeOnly
      ? css`
          ${fadeIn} 150ms ${EASE_OUT} both
        `
      : css`
          ${pageEnter} 300ms ${EASE_OUT} both
        `};
`

export const PageHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
`

export const H1 = styled.h1`
  ${grotesk};
  font-size: 32px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  @media (max-width: 759px) {
    font-size: 26px;
  }
`

export const H2 = styled.h2`
  ${grotesk};
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
`

export const H3 = styled.h3`
  ${grotesk};
  font-size: 16px;
  font-weight: 600;
`

export const Sub = styled.p`
  font-size: 14px;
  color: ${C.muted};
  line-height: 1.5;
  margin-top: 6px;
`

export const Muted = styled.span<{ $size?: number }>`
  color: ${C.muted};
  font-size: ${p => p.$size ?? 13}px;
`

export const Row = styled.div<{
  $gap?: number
  $justify?: string
  $align?: string
  $wrap?: boolean
}>`
  display: flex;
  align-items: ${p => p.$align ?? 'center'};
  justify-content: ${p => p.$justify ?? 'flex-start'};
  gap: ${p => p.$gap ?? 8}px;
  flex-wrap: ${p => (p.$wrap ? 'wrap' : 'nowrap')};
  min-width: 0;
`

export const Col = styled.div<{ $gap?: number }>`
  display: flex;
  flex-direction: column;
  gap: ${p => p.$gap ?? 8}px;
  min-width: 0;
`

export const Grid = styled.div<{ $min?: number; $gap?: number }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(min(100%, ${p => p.$min ?? 240}px), 1fr)
  );
  gap: ${p => p.$gap ?? 16}px;
`

// ─── Surfaces ────────────────────────────────────────────────────

/** Main card (swap / liquidity / stake). Radius 24 with static purple glow. */
export const MainCard = styled.div<{ $glow?: boolean }>`
  width: 100%;
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 24px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  ${p =>
    p.$glow !== false &&
    css`
      box-shadow: 0 0 140px -30px rgba(108, 56, 254, 0.55);
    `}
  @media (max-width: 759px) {
    padding: 16px;
  }
`

export const Card = styled.div<{ $pad?: number; $hover?: boolean }>`
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 16px;
  padding: ${p => p.$pad ?? 20}px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  transition:
    border-color 200ms ease,
    transform 200ms ease;
  ${p =>
    p.$hover &&
    css`
      &:hover {
        border-color: ${C.borderStrong};
      }
    `}
  @media (max-width: 759px) {
    padding: ${p => Math.min(p.$pad ?? 20, 16)}px;
  }
`

/** Inner panel (pay/receive boxes, details). */
export const Panel = styled.div<{ $error?: boolean }>`
  background: ${C.bg};
  border: 1px solid ${p => (p.$error ? 'rgba(255,93,105,0.6)' : C.border)};
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
`

export const Divider = styled.div`
  height: 1px;
  background: ${C.border};
  width: 100%;
`

// ─── Buttons ─────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type BtnSize = 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<BtnSize, { h: number; px: number; fs: number; r: number }> =
  {
    sm: { h: 32, px: 12, fs: 13, r: 8 },
    md: { h: 40, px: 16, fs: 14, r: 10 },
    lg: { h: 48, px: 20, fs: 15, r: 12 },
    xl: { h: 56, px: 24, fs: 17, r: 16 }
  }

const variants: Record<BtnVariant, ReturnType<typeof css>> = {
  primary: css`
    background: ${C.primary};
    color: #fff;
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: ${C.primaryHover};
    }
  `,
  secondary: css`
    background: transparent;
    color: #fff;
    border: 1px solid ${C.borderStrong};
    &:hover:not(:disabled) {
      border-color: ${C.primary};
    }
  `,
  ghost: css`
    background: transparent;
    color: ${C.secondary};
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      color: #fff;
      background: ${C.field};
    }
  `,
  danger: css`
    background: ${C.critical};
    color: #fff;
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: #db1d4e;
    }
  `,
  success: css`
    background: ${C.success};
    color: #0d0d0d;
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: #1bb277;
    }
  `
}

const StyledButton = styled.button<{
  $variant: BtnVariant
  $size: BtnSize
  $block?: boolean
}>`
  ${grotesk};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: ${p => sizes[p.$size].h}px;
  padding: 0 ${p => sizes[p.$size].px}px;
  border-radius: ${p => sizes[p.$size].r}px;
  font-size: ${p => sizes[p.$size].fs}px;
  font-weight: 600;
  width: ${p => (p.$block ? '100%' : 'auto')};
  flex-shrink: 0;
  ${p => variants[p.$variant]};
  &:disabled {
    background: ${C.field};
    color: ${C.muted};
    border-color: transparent;
  }
`

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: BtnSize
  block?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', block, type, ...rest }, ref) => (
    <StyledButton
      ref={ref}
      type={type ?? 'button'}
      $variant={variant}
      $size={size}
      $block={block}
      data-cta={size === 'lg' || size === 'xl' ? '' : undefined}
      {...rest}
    />
  )
)
Button.displayName = 'Button'

export const IconButton = styled.button<{ $active?: boolean; $size?: number }>`
  width: ${p => p.$size ?? 40}px;
  height: ${p => p.$size ?? 40}px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: transparent;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
  &:hover {
    border-color: ${C.primary};
  }
`

export const LinkButton = styled.button<{ $color?: string }>`
  border: none;
  background: none;
  padding: 0;
  color: ${p => p.$color ?? C.primaryText};
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover {
    color: ${C.primaryText2};
  }
`

// ─── Chips / tabs / pills ───────────────────────────────────────

export const Chip = styled.button<{ $active?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.16)' : 'transparent')};
  color: ${p => (p.$active ? C.primaryText2 : C.secondary)};
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover {
    color: #fff;
  }
`

export const PillChip = styled(Chip)`
  height: 28px;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 10px;
`

const TabsWrap = styled.div<{ $block?: boolean }>`
  display: ${p => (p.$block ? 'flex' : 'inline-flex')};
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: ${C.bg};
  border: 1px solid ${C.border};
  max-width: 100%;
  overflow-x: auto;
`

const TabBtn = styled.button<{ $active: boolean; $block?: boolean }>`
  ${grotesk};
  flex: ${p => (p.$block ? 1 : 'none')};
  height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: none;
  background: ${p => (p.$active ? C.field : 'transparent')};
  color: ${p => (p.$active ? '#fff' : C.muted)};
  font-size: 14px;
  font-weight: 600;
  &:hover {
    color: #fff;
  }
`

export type TabItem<T extends string> = { value: T; label: React.ReactNode }

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  block,
  ariaLabel
}: {
  items: TabItem<T>[]
  value: T
  onChange: (v: T) => void
  block?: boolean
  ariaLabel?: string
}) {
  return (
    <TabsWrap role="tablist" aria-label={ariaLabel} $block={block}>
      {items.map(it => (
        <TabBtn
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          $active={value === it.value}
          $block={block}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </TabBtn>
      ))}
    </TabsWrap>
  )
}

/** Cross-fade wrapper for tab content: re-key it with the active tab. */
export const TabPanel = styled.div`
  animation: ${fadeIn} 200ms ${EASE_OUT} both;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

// ─── Status chips & badges ──────────────────────────────────────

export type Tone = 'success' | 'critical' | 'warning' | 'primary' | 'neutral'

const toneColor: Record<Tone, [string, string, string]> = {
  success: [C.successText, 'rgba(38,208,124,0.14)', 'rgba(38,208,124,0.35)'],
  critical: [C.criticalText, 'rgba(255,40,76,0.1)', 'rgba(255,93,105,0.35)'],
  warning: [C.warning, 'rgba(254,146,63,0.1)', 'rgba(254,146,63,0.35)'],
  primary: [C.primaryText2, 'rgba(108,56,255,0.14)', C.primaryBorder],
  neutral: [C.secondary, C.field, C.borderStrong]
}

export const Badge = styled.span<{ $tone?: Tone }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: ${p => toneColor[p.$tone ?? 'neutral'][0]};
  background: ${p => toneColor[p.$tone ?? 'neutral'][1]};
  border: 1px solid ${p => toneColor[p.$tone ?? 'neutral'][2]};
`

export const Notice = styled.div<{ $tone?: Tone }>`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: ${p => toneColor[p.$tone ?? 'primary'][0]};
  background: ${p => toneColor[p.$tone ?? 'primary'][1]};
  border: 1px solid ${p => toneColor[p.$tone ?? 'primary'][2]};
  animation: ${riseIn} 200ms ${EASE_OUT} both;
  svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
`

// ─── Loading ─────────────────────────────────────────────────────

export const Spinner = styled.span<{ $size?: number; $color?: string }>`
  display: inline-block;
  width: ${p => p.$size ?? 16}px;
  height: ${p => p.$size ?? 16}px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: ${p => p.$color ?? '#fff'};
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`
Spinner.defaultProps = { 'data-motion': 'pulse', 'aria-hidden': true } as any

export const SkeletonLine = styled.div<{ $w?: string; $h?: number }>`
  width: ${p => p.$w ?? '100%'};
  height: ${p => p.$h ?? 14}px;
  border-radius: 6px;
  background: linear-gradient(90deg, #2a2a2c 0px, #333336 80px, #2a2a2c 160px)
    #2a2a2c;
  background-size: 400px 100%;
  animation: ${skeletonShimmer} 1.2s linear infinite;
`
SkeletonLine.defaultProps = { 'data-motion': 'pulse' } as any

// ─── Form ────────────────────────────────────────────────────────

export const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: ${C.muted};
  display: block;
`

export const Input = styled.input`
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  color: #fff;
  font-size: 14px;
  &:focus {
    border-color: ${C.primary};
  }
`

export const Textarea = styled.textarea`
  width: 100%;
  min-height: 96px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  color: #fff;
  font-size: 14px;
  resize: vertical;
  &:focus {
    border-color: ${C.primary};
  }
`

/** Container card for a borderless input; gets the focus ring. */
export const Field = styled.div.attrs({ 'data-field': '' })<{
  $error?: boolean
}>`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$error ? 'rgba(255,93,105,0.6)' : C.border)};
  background: ${C.bg};
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
`

export const BareInput = styled.input.attrs({ 'data-bare': '' })`
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 14px;
  outline: none;
`

export const KV = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    font-weight: 600;
    text-align: right;
    ${tabular};
  }
`

// ─── Stats ───────────────────────────────────────────────────────

export const StatCard = styled(Card)<{ $accent?: boolean }>`
  gap: 6px;
  padding: 18px 20px;
  ${p =>
    p.$accent &&
    css`
      background: ${C.primary};
      border-color: ${C.primary};
      span {
        color: rgba(255, 255, 255, 0.8);
      }
    `}
`

export const StatLabel = styled.span`
  font-size: 13px;
  color: ${C.muted};
`

export const StatValue = styled.div`
  ${grotesk};
  ${tabular};
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  @media (max-width: 759px) {
    font-size: 20px;
  }
`

// ─── Empty state ────────────────────────────────────────────────

export const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 40px 16px;
  color: ${C.muted};
  font-size: 14px;
  h3 {
    color: #fff;
  }
`

// ─── Token visuals ──────────────────────────────────────────────

export const PairIcons = styled.div<{ $size?: number }>`
  display: flex;
  flex-shrink: 0;
  img {
    width: ${p => p.$size ?? 28}px;
    height: ${p => p.$size ?? 28}px;
    border-radius: 50%;
  }
  img + img {
    margin-left: -${p => Math.round((p.$size ?? 28) / 4)}px;
    border: 2px solid ${C.surface};
  }
`

export const Avatar = styled.div<{ $size?: number; $color?: string }>`
  width: ${p => p.$size ?? 40}px;
  height: ${p => p.$size ?? 40}px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-weight: 700;
  font-size: ${p => Math.round((p.$size ?? 40) * 0.4)}px;
  color: #fff;
  background: ${p => p.$color ?? C.primary};
`

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  ${tabular};
  th {
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: ${C.muted};
    padding: 10px 16px;
    border-bottom: 1px solid ${C.border};
    white-space: nowrap;
  }
  td {
    padding: 14px 16px;
    border-bottom: 1px solid ${C.border};
    white-space: nowrap;
  }
  tr:last-child td {
    border-bottom: none;
  }
  tbody tr {
    transition: background-color 150ms ease;
  }
  tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }
`

export const short = (addr?: string | null, a = 6, b = 4) =>
  addr ? `${addr.slice(0, a)}…${addr.slice(-b)}` : ''
