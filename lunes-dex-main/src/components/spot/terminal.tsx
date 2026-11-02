/**
 * Spot terminal — shared tokens, formatters, primitives and the small UI-only
 * store that links the panels (book row click → form price, history tab).
 *
 * Nothing here owns financial rules: prices, fees and balances come from
 * SpotContext / spot-api; this file only formats and lays them out.
 */
import React, { createContext, useCallback, useContext, useState } from 'react'
import styled, { css } from 'styled-components'
import { C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import { fadeIn } from '../../styles/motion'
import { generateIdenticon } from '../../utils/getTokenLogo'

// ─── Terminal tokens ─────────────────────────────────────────────

export const T = {
  bg: C.terminal, // #0D0D0D
  panel: C.bg, // #1A1A1A
  input: C.terminalInput, // #141414
  line: C.field, // #2A2A2C
  rowHover: C.surface, // #232323
  up: C.success, // #26D07C
  down: C.criticalText, // #FF5D69
  upText: C.successText, // #57E290
  downText: C.criticalText2, // #FF807E
  sell: C.critical // #FF284C (sell CTA)
} as const

// ─── Formatters ──────────────────────────────────────────────────

/** Decimals used for a price of this magnitude. */
export const pxDec = (p: number): number => {
  const a = Math.abs(p)
  if (!a) return 5
  if (a >= 1000) return 2
  if (a >= 1) return 4
  if (a >= 0.001) return 5
  return 8
}

export const nf = (v: number, d: number): string =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      })
    : '—'

/** Price with magnitude-aware decimals, or an em dash when unknown. */
export const fmtPx = (p: number | null | undefined, d?: number): string =>
  p && p > 0 ? nf(p, d ?? pxDec(p)) : '—'

/** Compact quantity: 1.2K / 3.45M / 1.1B. */
export const fq = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(v >= 100 ? 0 : 2)
}

/** Amount: integers above 100, up to 4 decimals below. */
export const fmtAmt = (v: number): string => {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('en-US')
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export const splitPair = (symbol: string): [string, string] => {
  const [b, q] = symbol.split('/')
  return [b || symbol, q || '']
}

export const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour12: false })

// ─── Terminal UI store (UI-only, no financial state) ─────────────

export type HistoryTab = 'open' | 'history' | 'trades'

type TerminalCtx = {
  /** Last price picked in the book; `n` changes on every pick. */
  picked: { price: number; n: number } | null
  pickPrice: (price: number) => void
  historyTab: HistoryTab
  setHistoryTab: (t: HistoryTab) => void
}

const noop = () => undefined
const TerminalContext = createContext<TerminalCtx>({
  picked: null,
  pickPrice: noop,
  historyTab: 'open',
  setHistoryTab: noop
})

export const SpotTerminalProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [picked, setPicked] = useState<TerminalCtx['picked']>(null)
  const [historyTab, setHistoryTab] = useState<HistoryTab>('open')
  const pickPrice = useCallback(
    (price: number) => setPicked(p => ({ price, n: (p?.n ?? 0) + 1 })),
    []
  )
  return (
    <TerminalContext.Provider
      value={{ picked, pickPrice, historyTab, setHistoryTab }}
    >
      {children}
    </TerminalContext.Provider>
  )
}

export const useTerminal = () => useContext(TerminalContext)

// ─── Primitives ──────────────────────────────────────────────────

export const TPanel = styled.section`
  background: ${T.panel};
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`

const UTabsWrap = styled.div<{ $spread?: boolean }>`
  display: flex;
  gap: ${p => (p.$spread ? '8px' : '18px')};
  justify-content: ${p => (p.$spread ? 'space-between' : 'flex-start')};
  padding: 0 14px;
  border-bottom: 1px solid ${T.line};
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`

const UTab = styled.button<{ $active: boolean; $h: number }>`
  ${grotesk};
  height: ${p => p.$h}px;
  padding: 0 2px;
  border: none;
  border-bottom: 2px solid ${p => (p.$active ? C.primary : 'transparent')};
  margin-bottom: -1px;
  background: transparent;
  color: ${p => (p.$active ? C.text : C.muted)};
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  transition:
    color 150ms ease,
    border-color 150ms ease;
  &:hover {
    color: ${C.text};
  }
`

/** Underlined tab row (order types, history tabs). */
export function UnderlineTabs<K extends string>({
  items,
  value,
  onChange,
  height = 40,
  spread,
  ariaLabel
}: {
  items: Array<[K, React.ReactNode]>
  value: K
  onChange: (k: K) => void
  height?: number
  spread?: boolean
  ariaLabel?: string
}) {
  return (
    <UTabsWrap role="tablist" aria-label={ariaLabel} $spread={spread}>
      {items.map(([k, label]) => (
        <UTab
          key={k}
          role="tab"
          aria-selected={value === k}
          $active={value === k}
          $h={height}
          onClick={() => onChange(k)}
        >
          {label}
        </UTab>
      ))}
    </UTabsWrap>
  )
}

const SegWrap = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: ${T.input};
  flex-shrink: 0;
`

const SegBtn = styled.button<{ $active: boolean }>`
  height: 26px;
  padding: 0 11px;
  border: none;
  border-radius: 6px;
  background: ${p => (p.$active ? T.line : 'transparent')};
  color: ${p => (p.$active ? C.text : C.muted)};
  font-size: 12px;
  font-weight: 600;
  transition:
    background-color 150ms ease,
    color 150ms ease;
  &:hover {
    color: ${C.text};
  }
`

/** Small segmented control (Book / Trades, Candles / Line). */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  ariaLabel
}: {
  items: Array<[K, React.ReactNode]>
  value: K
  onChange: (k: K) => void
  ariaLabel?: string
}) {
  return (
    <SegWrap role="tablist" aria-label={ariaLabel}>
      {items.map(([k, label]) => (
        <SegBtn
          key={k}
          role="tab"
          aria-selected={value === k}
          $active={value === k}
          onClick={() => onChange(k)}
        >
          {label}
        </SegBtn>
      ))}
    </SegWrap>
  )
}

/** Buy / Sell (or Long / Short) switch. */
export const SideSwitch = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: ${T.input};
`

export const SideBtn = styled.button<{ $on: boolean; $side: 'buy' | 'sell' }>`
  ${grotesk};
  height: 36px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  transition:
    background-color 150ms ease,
    color 150ms ease;
  ${p =>
    p.$on
      ? p.$side === 'buy'
        ? css`
            background: ${T.up};
            color: ${T.bg};
          `
        : css`
            background: ${T.sell};
            color: #fff;
          `
      : css`
          background: transparent;
          color: ${C.muted};
          &:hover {
            color: ${C.text};
          }
        `}
`

export const TLabel = styled.span`
  font-size: 12px;
  color: ${C.muted};
`

/** Input container (focus ring lives here — see globals `data-field`). */
export const TField = styled.div.attrs({ 'data-field': '' })<{
  $error?: boolean
  $readOnly?: boolean
}>`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid
    ${p =>
      p.$error
        ? 'rgba(255,93,105,0.6)'
        : p.$readOnly
          ? T.line
          : C.borderStrong};
  background: ${T.input};
  color: ${p => (p.$readOnly ? C.muted : C.text)};
  font-size: 14px;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
  span {
    font-size: 12px;
    color: ${C.muted};
    flex-shrink: 0;
  }
`

export const TInput = styled.input.attrs({
  'data-bare': '',
  inputMode: 'decimal',
  autoComplete: 'off'
})`
  ${tabular};
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: ${C.text};
  font-size: 14px;
  &::placeholder {
    color: ${C.muted};
  }
`

export const TKV = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    ${tabular};
    font-weight: 500;
    text-align: right;
  }
`

export const Fade = styled.div`
  animation: ${fadeIn} 200ms ${EASE_OUT} both;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

export const TEmpty = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  color: ${C.muted};
`

/** Keep only digits and one dot. */
export const cleanNum = (v: string): string => {
  const s = v.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const i = s.indexOf('.')
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
}

const ICONS: Record<string, string> = {
  LUNES: '/img/lunes-logo.svg',
  WLUNES: '/img/lunes-logo.svg',
  LUSDT: '/img/lusdt.png',
  GMC: '/img/gmc.svg',
  LETH: '/img/leth.svg',
  LBTC: '/img/lbtc.svg',
  LUP: '/img/up.svg',
  UP: '/img/up.svg'
}

export const tokenIcon = (sym: string): string =>
  ICONS[sym.toUpperCase()] ?? generateIdenticon(sym || 'unknown')
