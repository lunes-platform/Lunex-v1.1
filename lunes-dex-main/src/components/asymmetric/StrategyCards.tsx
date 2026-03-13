import React from 'react'
import styled from 'styled-components'
import { CurveParams } from './CurveChart'

import { TrendingUp, Coins, Target } from 'lucide-react'
import { Icon } from '../ui/Icon'

export interface StrategyTemplate {
    id: string
    name: string
    icon: React.ReactNode
    tagline: string
    description: string
    riskLabel: string
    riskColor: string
    buyParams: Omit<CurveParams, 'L' | 'c' | 'interestR'>
    sellParams: Omit<CurveParams, 'L' | 'c' | 'interestR'>
    profitTargetBps: number
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
    {
        id: 'buy_the_dip',
        name: 'Buy the Dip',
        icon: <Icon icon={TrendingUp} color="#fbbf24" size={28} />,
        tagline: 'Accumulate on decline',
        description:
            'Places a heavy buy curve that accumulates tokens automatically if the price drops. More liquidity at lower prices.',
        riskLabel: 'Moderate',
        riskColor: '#fbbf24',
        buyParams: { k: 1_000, x0: 10_000, gamma: 3, feeT: 0.003 },
        sellParams: { k: 500, x0: 8_000, gamma: 2, feeT: 0.003 },
        profitTargetBps: 500,
    },
    {
        id: 'take_profit',
        name: 'Take Profit Gradually',
        icon: <Icon icon={Coins} color="#34d399" size={28} />,
        tagline: 'Sell the rally',
        description:
            'Distributes your sell orders over a wide price range so you exit gradually as the price rises, avoiding slippage.',
        riskLabel: 'Conservative',
        riskColor: '#34d399',
        buyParams: { k: 300, x0: 5_000, gamma: 1, feeT: 0.003 },
        sellParams: { k: 1_500, x0: 15_000, gamma: 2, feeT: 0.003 },
        profitTargetBps: 300,
    },
    {
        id: 'stablecoin_range',
        name: 'Stablecoin Range',
        icon: <Icon icon={Target} color="#60a5fa" size={28} />,
        tagline: 'Fee harvesting ±1%',
        description:
            'Maximizes fee collection on a very narrow band (e.g. LUSDT/USDC 0.99–1.01). High γ concentrates liquidity around the peg.',
        riskLabel: 'Low',
        riskColor: '#60a5fa',
        buyParams: { k: 5_000, x0: 2_000, gamma: 5, feeT: 0.001 },
        sellParams: { k: 5_000, x0: 2_000, gamma: 5, feeT: 0.001 },
        profitTargetBps: 100,
    },
]

// ─── Styled ───────────────────────────────────────────────────────

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
`

const Card = styled.button<{ selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border-radius: 16px;
  border: 2px solid ${({ selected, theme }) =>
        selected ? theme.colors.themeColors[100] : theme.colors.themeColors[400]};
  background: ${({ selected, theme }) =>
        selected ? theme.colors.themeColors[700] : theme.colors.themeColors[600]};
  cursor: pointer;
  text-align: left;
  transition: all 0.18s;
  overflow: hidden;
  min-width: 0;
  word-break: break-word;

  &:hover {
    border-color: ${({ theme }) => theme.colors.themeColors[300]};
    transform: translateY(-1px);
  }
`

const CardEmoji = styled.span`
  font-size: 28px;
`

const CardName = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const CardTagline = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const CardDesc = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
`

const RiskBadge = styled.span<{ color: string }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: ${({ color }) => color};
  background: ${({ color }) => `${color}22`};
`

// ─── Component ────────────────────────────────────────────────────

interface Props {
    selected: string | null
    onSelect: (template: StrategyTemplate) => void
}

const StrategyCards: React.FC<Props> = ({ selected, onSelect }) => {
    return (
        <Grid>
            {STRATEGY_TEMPLATES.map((t) => (
                <Card key={t.id} selected={selected === t.id} onClick={() => onSelect(t)}>
                    <CardEmoji>{t.icon}</CardEmoji>
                    <CardName>{t.name}</CardName>
                    <CardTagline>{t.tagline}</CardTagline>
                    <CardDesc>{t.description}</CardDesc>
                    <RiskBadge color={t.riskColor}>{t.riskLabel} Risk</RiskBadge>
                </Card>
            ))}
        </Grid>
    )
}

export default StrategyCards
