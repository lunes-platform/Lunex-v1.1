import React, { useState } from 'react'
import styled from 'styled-components'
import { AnimatedNumber } from '../../components/ui/AnimatedNumber'
import {
  C,
  Card,
  Col,
  H1,
  Muted,
  Notice,
  Page,
  Row,
  StatCard,
  StatLabel,
  StatValue,
  Sub,
  grotesk,
  tabular
} from '../../components/ui/kit'
import { useLunesUsdPrice } from './useLunesPrice'

// ─── Fee schedule (display mirror of the contracts — not a source of rules) ──
// AMM: 0.5% per swap = 0.3% LPs / 0.1% protocol / 0.1% stakers (pair contract).
const AMM_FEE = 0.005
const AMM_SPLIT = { lp: 0.6, protocol: 0.2, stakers: 0.2 }

// Spot orderbook: maker 0.10%, taker 0.25%.
const SPOT_MAKER_FEE = 0.001
const SPOT_TAKER_FEE = 0.0025
const SPOT_TAKER_RATIO = 0.7 // simulator assumption: ~70% of volume is taker
const SPOT_SPLIT = [
  { label: 'Team', maker: 0.5, taker: 0.4, color: C.primary },
  { label: 'Stakers', maker: 0.3, taker: 0.3, color: C.primaryText },
  { label: 'Affiliates', maker: 0.2, taker: 0.2, color: C.success },
  { label: 'Treasury', maker: 0, taker: 0.1, color: C.warning }
]

// Governance: 10 LUNES per vote.
const VOTE_COST = 10
const VOTE_SPLIT = [
  { label: 'Stakers', pct: 0.3, color: C.primaryText },
  { label: 'Liquidity providers', pct: 0.2, color: C.success },
  { label: 'Treasury', pct: 0.1, color: C.warning },
  { label: 'Team', pct: 0.4, color: C.primary }
]

// Listing manager tiers: fee split 20% staking / 50% team / 30% rewards.
const LISTING_BASIC_FEE = 1_000
const LISTING_SPLIT = { staking: 0.2, team: 0.5, rewards: 0.3 }

// LUNES → USD comes from the live LUNES/LUSDT spot ticker (useLunesUsdPrice);
// no hard-coded price. Without a market, LUNES-denominated fees are excluded.

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}K`
      : `$${n.toFixed(0)}`

const usdFull = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

// ─── Styles ──────────────────────────────────────────────────────

const TwoUp = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 12px;
`

const CardTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
`

const Bar = styled.div`
  height: 6px;
  border-radius: 999px;
  background: ${C.bg};
  overflow: hidden;
  > div {
    height: 100%;
    border-radius: 999px;
  }
`

const SplitGrid = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 8px;
  font-size: 14px;
  ${tabular};
  > span:nth-child(n + 2) {
    text-align: right;
    font-weight: 600;
  }
`

const SplitHead = styled(SplitGrid)`
  font-size: 11px;
  color: ${C.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 4px;
  > span:nth-child(n + 2) {
    font-weight: 400;
  }
`

const SplitRow = styled(SplitGrid)`
  padding: 8px 0;
  border-top: 1px solid ${C.border};
`

const Dot = styled.span<{ $c: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${p => p.$c};
  flex-shrink: 0;
`

const FeeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  @media (max-width: 479px) {
    grid-template-columns: 1fr 1fr;
  }
`

const SimCard = styled(Card)`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 24px;
  padding: 18px;
`

const Slider = styled.input.attrs({ type: 'range' })`
  width: 100%;
  accent-color: ${C.primary};
  height: 20px;
`

const Result = styled.div<{ $hl?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: ${p => (p.$hl ? 'rgba(108,56,255,0.16)' : C.bg)};
  > span:first-child {
    font-size: 13px;
    color: ${p => (p.$hl ? C.primaryText2 : C.muted)};
  }
  > span:last-child {
    ${grotesk};
    ${tabular};
    font-size: 20px;
    font-weight: 600;
  }
`

const SplitBars: React.FC<{
  rows: { label: string; value: string; pct: number; color: string }[]
}> = ({ rows }) => (
  <>
    {rows.map(r => (
      <Col key={r.label} $gap={5}>
        <Row $justify="space-between" style={{ fontSize: 13 }}>
          <span>{r.label}</span>
          <span style={{ fontWeight: 600 }} className="num">
            {r.value}
          </span>
        </Row>
        <Bar>
          <div style={{ width: `${r.pct * 100}%`, background: r.color }} />
        </Bar>
      </Col>
    ))}
  </>
)

const SliderField: React.FC<{
  label: string
  display: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}> = ({ label, display, min, max, step, value, onChange }) => (
  <Col $gap={6}>
    <Row $justify="space-between" style={{ fontSize: 13 }}>
      <Muted>{label}</Muted>
      <span style={{ fontWeight: 600 }} className="num">
        {display}
      </span>
    </Row>
    <Slider
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={e => onChange(Number(e.target.value))}
    />
  </Col>
)

// ─── Component ───────────────────────────────────────────────────

const ProtocolStats: React.FC = () => {
  const [simSwap, setSimSwap] = useState(200_000)
  const [simSpot, setSimSpot] = useState(100_000)
  const [simVotes, setSimVotes] = useState(50)
  const [simList, setSimList] = useState(5)
  const { price: lunesUsd, loading: priceLoading } = useLunesUsdPrice()
  const LUNES_USD = lunesUsd ?? 0

  // Monthly (30 days) projections in USD.
  const swapFees = simSwap * 30 * AMM_FEE
  const takerFees = simSpot * 30 * SPOT_TAKER_RATIO * SPOT_TAKER_FEE
  const makerFees = simSpot * 30 * (1 - SPOT_TAKER_RATIO) * SPOT_MAKER_FEE
  const spotShare = (key: 'Team' | 'Stakers' | 'Affiliates' | 'Treasury') => {
    const s = SPOT_SPLIT.find(x => x.label === key)!
    return takerFees * s.taker + makerFees * s.maker
  }
  const voteFees = simVotes * 30 * VOTE_COST * LUNES_USD
  const listFees = simList * LISTING_BASIC_FEE * LUNES_USD

  const team =
    swapFees * AMM_SPLIT.protocol +
    spotShare('Team') +
    voteFees * 0.4 +
    listFees * LISTING_SPLIT.team
  const stakers =
    swapFees * AMM_SPLIT.stakers +
    spotShare('Stakers') +
    voteFees * 0.3 +
    listFees * LISTING_SPLIT.staking
  const affiliates = spotShare('Affiliates')
  const total = swapFees + takerFees + makerFees + voteFees + listFees

  const results = [
    { label: 'Team monthly revenue', value: team },
    { label: 'Stakers monthly yield', value: stakers },
    { label: 'Affiliates monthly (spot)', value: affiliates },
    { label: 'Total ecosystem monthly', value: total, hl: true }
  ]

  return (
    <Page $max={1080}>
      <div>
        <H1>Protocol revenue</H1>
        <Sub>
          Where every fee goes. All splits are enforced by the contracts and can
          only change through governance.
        </Sub>
      </div>

      <TwoUp>
        <Card $pad={16}>
          <Col $gap={2}>
            <CardTitle>AMM swap fee split</CardTitle>
            <Muted $size={12}>0.5% on every swap</Muted>
          </Col>
          <SplitBars
            rows={[
              {
                label: 'Liquidity providers',
                value: '0.30% · 60%',
                pct: AMM_SPLIT.lp,
                color: C.success
              },
              {
                label: 'Protocol / team',
                value: '0.10% · 20%',
                pct: AMM_SPLIT.protocol,
                color: C.primary
              },
              {
                label: 'Trading rewards (stakers)',
                value: '0.10% · 20%',
                pct: AMM_SPLIT.stakers,
                color: C.primaryText
              }
            ]}
          />
        </Card>
        <Card $pad={16}>
          <Col $gap={2}>
            <CardTitle>Governance vote split</CardTitle>
            <Muted $size={12}>{VOTE_COST} LUNES per vote</Muted>
          </Col>
          <SplitBars
            rows={VOTE_SPLIT.map(v => ({
              label: v.label,
              value: `${v.pct * 100}% · ${v.pct * VOTE_COST} LUNES`,
              pct: v.pct,
              color: v.color
            }))}
          />
        </Card>
      </TwoUp>

      <Card $pad={16} style={{ gap: 10 }}>
        <Col $gap={2}>
          <CardTitle>Spot orderbook fee split</CardTitle>
          <Muted $size={12}>
            Charged on every matched trade — maker 0.10% · taker 0.25%
          </Muted>
        </Col>
        <SplitHead>
          <span>Recipient</span>
          <span>Maker</span>
          <span>Taker</span>
        </SplitHead>
        {SPOT_SPLIT.map(s => (
          <SplitRow key={s.label}>
            <Row $gap={8}>
              <Dot $c={s.color} />
              {s.label}
            </Row>
            <span>{s.maker * 100}%</span>
            <span>{s.taker * 100}%</span>
          </SplitRow>
        ))}
      </Card>

      <Card $pad={16}>
        <CardTitle>Token listing fee</CardTitle>
        <FeeGrid>
          {[
            { label: 'Proposal fee', value: '1,000 LUNES' },
            { label: 'Voting period', value: '14 days' },
            { label: 'If approved', value: 'Refunded', color: C.successText },
            { label: 'If rejected', value: '90% treasury' }
          ].map(k => (
            <StatCard
              key={k.label}
              style={{ padding: '14px 16px', background: C.surface }}
            >
              <StatLabel>{k.label}</StatLabel>
              <StatValue style={{ fontSize: 20, color: k.color }}>
                <AnimatedNumber text={k.value} />
              </StatValue>
            </StatCard>
          ))}
        </FeeGrid>
        <Muted $size={12}>
          A rejected proposal fee goes 90% to the treasury and 10% to the
          staking rewards pool. Tiered listings (1k / 5k / 20k LUNES) split 20%
          staking / 50% team / 30% rewards pool.
        </Muted>
      </Card>

      <Notice $tone="warning" role="note" data-testid="sim-disclaimer">
        Hypothetical simulator — illustrative only. The volumes below are your
        own assumptions, not protocol data, and the results are not a
        projection, forecast or promise of revenue or returns. Testnet tokens
        have no monetary value.
      </Notice>
      <SimCard>
        <Col $gap={14} style={{ flex: '1 1 300px' }}>
          <span
            style={{
              fontFamily: 'Space Grotesk',
              fontWeight: 600,
              fontSize: 16
            }}
          >
            Revenue simulator (hypothetical)
          </span>
          <SliderField
            label="Daily AMM volume"
            display={`${usd(simSwap)}/day`}
            min={10_000}
            max={2_000_000}
            step={10_000}
            value={simSwap}
            onChange={setSimSwap}
          />
          <SliderField
            label="Daily spot volume"
            display={`${usd(simSpot)}/day`}
            min={10_000}
            max={2_000_000}
            step={10_000}
            value={simSpot}
            onChange={setSimSpot}
          />
          <SliderField
            label="Governance votes per day"
            display={`${simVotes}/day`}
            min={0}
            max={500}
            step={5}
            value={simVotes}
            onChange={setSimVotes}
          />
          <SliderField
            label="Listings per month"
            display={`${simList}/month`}
            min={0}
            max={30}
            step={1}
            value={simList}
            onChange={setSimList}
          />
        </Col>
        <Col $gap={8} style={{ flex: '1 1 280px' }}>
          {results.map(r => (
            <Result key={r.label} $hl={r.hl}>
              <span>{r.label}</span>
              <span>
                <AnimatedNumber value={r.value} format={usdFull} />
              </span>
            </Result>
          ))}
          <Muted $size={11} data-testid="sim-assumptions">
            Hypothetical monthly figure at 30 days, ~70% taker volume on spot,
            Basic-tier listings.{' '}
            {lunesUsd != null
              ? `LUNES valued at $${lunesUsd} (last LUNES/LUSDT spot trade).`
              : priceLoading
                ? 'Loading LUNES/LUSDT price…'
                : 'LUNES/LUSDT price unavailable — LUNES-denominated fees (votes, listings) are excluded.'}
          </Muted>
        </Col>
      </SimCard>
    </Page>
  )
}

export default ProtocolStats
