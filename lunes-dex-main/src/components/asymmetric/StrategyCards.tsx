/**
 * Asymmetric strategy presets: one click sets both curves.
 */
import React from 'react'
import styled from 'styled-components'
import { C, grotesk } from '../ui/kit'
import type { CurveSide } from './CurveChart'

export type PresetId = 'dip' | 'tp' | 'range'

export type Preset = {
  id: PresetId
  name: string
  tag: string
  desc: string
  buy: CurveSide
  sell: CurveSide
  /** Sell-side profit target sent to the backend (bps). */
  profitTargetBps: number
  /** Curve fee target (bps) for both sides. */
  feeBps: number
}

export const PRESETS: Preset[] = [
  {
    id: 'dip',
    name: 'Buy the Dip',
    tag: 'Accumulate on drops',
    desc: 'Deep buy curve below the price, thin sell curve above.',
    buy: { k: 1000, x0: 10000, g: 3 },
    sell: { k: 200, x0: 4000, g: 1 },
    profitTargetBps: 500,
    feeBps: 30
  },
  {
    id: 'tp',
    name: 'Take Profit Gradually',
    tag: 'Scale out on rallies',
    desc: 'Thin buy side, deep sell curve that sells into strength.',
    buy: { k: 200, x0: 4000, g: 1 },
    sell: { k: 1000, x0: 12000, g: 3 },
    profitTargetBps: 300,
    feeBps: 30
  },
  {
    id: 'range',
    name: 'Stablecoin Range',
    tag: 'Fee harvesting ±1%',
    desc: 'Tight, steep curves on both sides to earn fees in a narrow band.',
    buy: { k: 2000, x0: 20000, g: 5 },
    sell: { k: 2000, x0: 20000, g: 5 },
    profitTargetBps: 100,
    feeBps: 10
  }
]

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
`

const Card = styled.button<{ $on: boolean }>`
  white-space: normal;
  text-align: left;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid ${p => (p.$on ? C.primary : C.border)};
  background: ${p => (p.$on ? 'rgba(108,56,255,0.12)' : C.surface)};
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
  &:hover {
    border-color: ${p => (p.$on ? C.primary : C.borderStrong)};
  }
  b {
    ${grotesk};
    font-size: 17px;
    font-weight: 600;
  }
  em {
    font-style: normal;
    font-size: 12px;
    font-weight: 600;
    color: ${C.primaryText};
  }
  span {
    font-size: 13px;
    color: ${C.secondary};
    line-height: 1.5;
  }
`

type Props = {
  selected: PresetId | null
  onSelect: (p: Preset) => void
}

const StrategyCards: React.FC<Props> = ({ selected, onSelect }) => (
  <Grid role="radiogroup" aria-label="Strategy presets">
    {PRESETS.map(p => (
      <Card
        key={p.id}
        role="radio"
        aria-checked={selected === p.id}
        $on={selected === p.id}
        onClick={() => onSelect(p)}
      >
        <b>{p.name}</b>
        <em>{p.tag}</em>
        <span>{p.desc}</span>
      </Card>
    ))}
  </Grid>
)

export default StrategyCards
