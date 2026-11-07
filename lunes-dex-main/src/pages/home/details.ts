/**
 * Derived display rows for the swap quote (card + review modal).
 * Display only: the minimum received comes from the SDK slippage helper and
 * the fee split is the contract's 0.3 / 0.1 / 0.1 (Lunex/contracts/pair).
 */
import { C } from 'components/ui/kit'
import { fmtAmount } from 'components/TokenSelect'

export const IMPACT_WARN = 3
export const IMPACT_RISK = 5
export const IMPACT_BLOCK = 15
export const SLIPPAGE_RISK = 3

export const FEE_SPLIT_TEXT =
  'Fee 0.5% · 0.3% to liquidity providers · 0.1% protocol · 0.1% LUNES stakers'

export const impactColor = (i: number) =>
  i < 1 ? C.success : i < 3 ? C.warning : C.criticalText

export type DetailRow = {
  label: string
  value: string
  color?: string
  tip?: string
}

export const buildDetailRows = ({
  impact,
  minReceived,
  slippage,
  fee,
  fromSym,
  toSym,
  route,
  wrap = false
}: {
  impact: number
  minReceived: number
  slippage: number
  fee: number
  fromSym: string
  toSym: string
  route: string[]
  /** LUNES⇄WLUNES 1:1 — no router, so no fee and no slippage. */
  wrap?: boolean
}): DetailRow[] => [
  {
    label: 'Price impact',
    value: (impact < 0.01 ? '<0.01' : impact.toFixed(2)) + '%',
    color: impactColor(impact),
    tip: 'How much your trade moves the pool price.'
  },
  {
    label: 'Minimum received',
    value: `${fmtAmount(minReceived)} ${toSym}`,
    tip: 'Below this the transaction reverts.'
  },
  ...(wrap
    ? []
    : [
        { label: 'Slippage tolerance', value: `${slippage}%` },
        {
          label: 'Fee (0.5%)',
          value: `${fmtAmount(fee)} ${fromSym}`,
          tip: '0.3% liquidity providers · 0.1% protocol · 0.1% LUNES stakers'
        }
      ]),
  { label: 'Route', value: route.join(' → ') }
]
