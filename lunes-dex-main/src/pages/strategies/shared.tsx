/**
 * Shared bits for the strategy marketplace, detail page and the register
 * strategy modal (also used by the agent dashboard).
 */
import React from 'react'
import styled from 'styled-components'
import { ArrowLeft } from 'lucide-react'
import { C, grotesk, tabular } from 'components/ui/kit'
import type {
  StrategyRiskLevel,
  StrategyType
} from '../../services/strategyService'

export const TYPE_LABEL: Record<StrategyType, string> = {
  COPYTRADE: 'Copy trading',
  MARKET_MAKER: 'Market making',
  ARBITRAGE: 'Arbitrage',
  MOMENTUM: 'Momentum',
  HEDGE: 'Hedge',
  CUSTOM: 'Custom'
}

export const RISK_STYLE: Record<
  StrategyRiskLevel,
  { bg: string; color: string; label: string; short: string }
> = {
  LOW: {
    bg: 'rgba(38,208,124,0.14)',
    color: C.successText,
    label: 'Low risk',
    short: 'Low'
  },
  MEDIUM: {
    bg: 'rgba(254,146,63,0.14)',
    color: C.warning,
    label: 'Medium risk',
    short: 'Medium'
  },
  HIGH: {
    bg: 'rgba(255,40,76,0.14)',
    color: C.criticalText2,
    label: 'High risk',
    short: 'High'
  },
  AGGRESSIVE: {
    bg: 'rgba(255,40,76,0.2)',
    color: C.criticalText,
    label: 'Aggressive',
    short: 'Aggressive'
  }
}

/** Values from the API are fractions (0.142 = 14.2%). */
export const fmtPct = (v: number, digits = 1, sign = true) =>
  `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`

export const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export const fmtCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US')
}

export const roiColor = (v: number) => (v >= 0 ? C.success : C.criticalText)

export const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback

export const RiskTag = styled.span<{ $risk: StrategyRiskLevel }>`
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  background: ${p => (RISK_STYLE[p.$risk] ?? RISK_STYLE.MEDIUM).bg};
  color: ${p => (RISK_STYLE[p.$risk] ?? RISK_STYLE.MEDIUM).color};
`

export const TypeLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${C.primaryText};
`

/** Risk / type filter pill (neutral active state, per prototype). */
export const FilterPill = styled.button<{ $active?: boolean; $h?: number }>`
  height: ${p => p.$h ?? 32}px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => (p.$active ? C.borderStrong : C.border)};
  background: ${p => (p.$active ? C.field : 'transparent')};
  color: ${p => (p.$active ? C.text : C.muted)};
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    color 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease;
  &:hover {
    color: ${C.text};
  }
`

/** Purple-active choice chip used inside forms. */
export const ChoiceChip = styled.button<{ $active?: boolean }>`
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.16)' : 'transparent')};
  color: ${p => (p.$active ? C.primaryText2 : C.secondary)};
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  &:hover {
    color: ${C.text};
  }
`

export const MiniStat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 11px;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    ${grotesk};
    ${tabular};
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

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
    color: ${C.text};
  }
`

export const BackLink: React.FC<{ label: string; onClick: () => void }> = ({
  label,
  onClick
}) => (
  <BackBtn onClick={onClick}>
    <ArrowLeft size={16} strokeWidth={2} />
    {label}
  </BackBtn>
)
