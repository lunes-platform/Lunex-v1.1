import React, { useState } from 'react'
import styled from 'styled-components'

// ─── Styled Components ───────────────────────────────────────────

const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding: 80px 24px 48px;
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 48px;
  padding: 32px 0;
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #00ff88, #00d4ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const PageSubtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8A8A8E;
  margin: 0;
`

const SectionTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 20px 0;
`

const SectionSubtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8A8A8E;
  margin: -12px 0 20px 0;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 500px) {
    grid-template-columns: 1fr;
  }
`

const StatCard = styled.div<{ $accent?: string }>`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid ${props => props.$accent ? `${props.$accent}30` : 'rgba(255,255,255,0.05)'};
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  backdrop-filter: blur(10px);
  transition: border-color 0.2s;

  &:hover {
    border-color: ${props => props.$accent ? `${props.$accent}60` : 'rgba(255,255,255,0.15)'};
  }
`

const StatValue = styled.div<{ $color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: ${props => props.$color || '#fff'};
  letter-spacing: -0.5px;
  margin-bottom: 6px;
`

const StatLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8A8A8E;
  font-weight: 500;
`

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 32px;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`

const Card = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 16px;
  padding: 28px;
  backdrop-filter: blur(10px);
`

const FeeRow = styled.div<{ $highlight?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;

  &:last-child { border-bottom: none; }

  span:first-child { color: #8A8A8E; }
  span:last-child {
    font-weight: 700;
    color: ${props => props.$highlight ? '#00ff88' : '#fff'};
  }
`

const BarContainer = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const BarRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const BarLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8A8A8E;

  span:last-child { color: #fff; font-weight: 600; }
`

const BarTrack = styled.div`
  background: rgba(255,255,255,0.05);
  border-radius: 99px;
  height: 8px;
  overflow: hidden;
`

const BarFill = styled.div<{ $pct: number; $color: string }>`
  height: 100%;
  width: ${props => props.$pct}%;
  background: ${props => props.$color};
  border-radius: 99px;
  transition: width 0.6s ease;
`

const SliderSection = styled.div`
  margin-bottom: 32px;
`

const SliderCard = styled(Card)`
  padding: 32px;
`

const SliderGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 24px;
  margin-top: 24px;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`

const SliderGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SliderLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8A8A8E;
  display: flex;
  justify-content: space-between;

  span { color: #fff; font-weight: 600; }
`

const Slider = styled.input`
  width: 100%;
  accent-color: #00ff88;
  cursor: pointer;
`

const ResultsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 28px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`

const ResultCard = styled.div<{ $primary?: boolean }>`
  background: ${props => props.$primary
    ? 'linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,212,255,0.1))'
    : 'rgba(255,255,255,0.03)'};
  border: 1px solid ${props => props.$primary ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.05)'};
  border-radius: 16px;
  padding: 24px;
  text-align: center;
`

const ResultValue = styled.div<{ $color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 32px;
  font-weight: 800;
  color: ${props => props.$color || '#fff'};
  letter-spacing: -1px;
  margin-bottom: 6px;
`

const ResultLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8A8A8E;
`

const Note = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #47474A;
  text-align: center;
  margin-top: 16px;
`

const DistTable = styled.div`
  margin-top: 8px;
`

const DistRow = styled.div<{ $accent: string }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;

  &:last-child { border-bottom: none; }
`

const DistLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ccc;
`

const DistDot = styled.div<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${props => props.$color};
  flex-shrink: 0;
`

const DistRight = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
`

const DistPct = styled.span`
  font-weight: 700;
  color: #fff;
`

const DistAmount = styled.span`
  font-size: 12px;
  color: #8A8A8E;
`

// ─── Component ───────────────────────────────────────────────────

const SWAP_FEE_TOTAL = 0.5 // 0.5% total swap fee
const SWAP_FEE_LP = 0.4 // 0.4% to LPs
const SWAP_FEE_PROTOCOL = 0.05 // 0.05% to team/protocol
const SWAP_FEE_STAKERS = 0.05 // 0.05% to stakers

// Spot Orderbook fee split
const SPOT_MAKER_FEE = 0.001 // 0.1% maker fee
const SPOT_TAKER_FEE = 0.0025 // 0.25% taker fee
const SPOT_MAKER_TEAM = 0.50
const SPOT_MAKER_STAKERS = 0.30
const SPOT_MAKER_AFFILIATES = 0.20
const SPOT_TAKER_TEAM = 0.40
const SPOT_TAKER_STAKERS = 0.30
const SPOT_TAKER_AFFILIATES = 0.20
const SPOT_TAKER_TREASURY = 0.10
const SPOT_AVG_TAKER_RATIO = 0.7 // ~70% of Spot trades are taker

const VOTE_COST = 10 // LUNES per vote
const VOTE_TEAM_PCT = 0.40
const VOTE_STAKERS_PCT = 0.30
const VOTE_LP_PCT = 0.20
const VOTE_TREASURY_PCT = 0.10

const LISTING_FEE = 1000 // LUNES per proposal

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtUSD = (n: number) =>
  n >= 1_000_000
    ? `$${fmt(n / 1_000_000)}M`
    : n >= 1_000
      ? `$${fmt(n / 1_000)}K`
      : `$${fmt(n)}`

const ProtocolStats: React.FC = () => {
  const [dailyVolumeK, setDailyVolumeK] = useState(200) // AMM $k/day
  const [dailySpotVolumeK, setDailySpotVolumeK] = useState(100) // Spot $k/day
  const [dailyVotes, setDailyVotes] = useState(50) // votes/day
  const [monthlyListings, setMonthlyListings] = useState(5) // proposals/month
  const [lunesPrice, setLunesPrice] = useState(0.05) // USD per LUNES

  // ── AMM Swap fee revenue ──
  const dailyVolumeUSD = dailyVolumeK * 1_000
  const dailyProtocolFeeUSD = dailyVolumeUSD * (SWAP_FEE_PROTOCOL / 100)
  const dailyStakerFeeUSD = dailyVolumeUSD * (SWAP_FEE_STAKERS / 100)
  const dailyLPFeeUSD = dailyVolumeUSD * (SWAP_FEE_LP / 100)
  const monthlySwapTeam = dailyProtocolFeeUSD * 30
  const monthlySwapStakers = dailyStakerFeeUSD * 30

  // ── Spot Orderbook fee revenue ──
  const dailySpotVolumeUSD = dailySpotVolumeK * 1_000
  const dailySpotTakerFee = dailySpotVolumeUSD * SPOT_TAKER_FEE * SPOT_AVG_TAKER_RATIO
  const dailySpotMakerFee = dailySpotVolumeUSD * SPOT_MAKER_FEE * (1 - SPOT_AVG_TAKER_RATIO)
  const dailySpotTeam = dailySpotTakerFee * SPOT_TAKER_TEAM + dailySpotMakerFee * SPOT_MAKER_TEAM
  const dailySpotStakers = dailySpotTakerFee * SPOT_TAKER_STAKERS + dailySpotMakerFee * SPOT_MAKER_STAKERS
  const dailySpotAffiliates = dailySpotTakerFee * SPOT_TAKER_AFFILIATES + dailySpotMakerFee * SPOT_MAKER_AFFILIATES
  const dailySpotTreasury = dailySpotTakerFee * SPOT_TAKER_TREASURY
  const monthlySpotTeam = dailySpotTeam * 30
  const monthlySpotStakers = dailySpotStakers * 30
  const monthlySpotAffiliates = dailySpotAffiliates * 30

  // ── Governance vote revenue ──
  const dailyVoteRevenueLUNES = dailyVotes * VOTE_COST
  const monthlyVoteRevenueLUNES = dailyVoteRevenueLUNES * 30
  const monthlyVoteTeamUSD = monthlyVoteRevenueLUNES * VOTE_TEAM_PCT * lunesPrice
  const monthlyVoteStakersUSD = monthlyVoteRevenueLUNES * VOTE_STAKERS_PCT * lunesPrice

  // ── Listing fee revenue ──
  const monthlyListingRevenueLUNES = monthlyListings * LISTING_FEE
  const monthlyListingTeamUSD = monthlyListingRevenueLUNES * 0.5 * lunesPrice

  // ── Totals ──
  const monthlyTeamTotal = monthlySwapTeam + monthlySpotTeam + monthlyVoteTeamUSD + monthlyListingTeamUSD
  const monthlyStakersTotal = monthlySwapStakers + monthlySpotStakers + monthlyVoteStakersUSD
  const monthlyAffiliatesTotal = monthlySpotAffiliates
  const monthlyEcosystemTotal = dailyLPFeeUSD * 30 + monthlyStakersTotal + monthlyAffiliatesTotal
  const annualTeamTotal = monthlyTeamTotal * 12

  return (
    <Page>
      <Container>
        <HeroBanner>
          <PageTitle>Protocol <span>Revenue</span></PageTitle>
          <PageSubtitle>Transparent breakdown of how Lunex generates and distributes revenue across the ecosystem.</PageSubtitle>
        </HeroBanner>

        {/* Fee Model Overview */}
        <TwoCol>
          <Card>
            <SectionTitle>AMM Swap Fee Split (0.5% total)</SectionTitle>
            <SectionSubtitle>Charged on every AMM swap — distributed across 3 stakeholders</SectionSubtitle>
            <BarContainer>
              <BarRow>
                <BarLabel><span>Liquidity Providers</span><span>0.4% (80%)</span></BarLabel>
                <BarTrack><BarFill $pct={80} $color="#6C38FF" /></BarTrack>
              </BarRow>
              <BarRow>
                <BarLabel><span>Team / Protocol</span><span>0.05% (10%)</span></BarLabel>
                <BarTrack><BarFill $pct={10} $color="#00ff88" /></BarTrack>
              </BarRow>
              <BarRow>
                <BarLabel><span>Stakers</span><span>0.05% (10%)</span></BarLabel>
                <BarTrack><BarFill $pct={10} $color="#00d4ff" /></BarTrack>
              </BarRow>
            </BarContainer>
          </Card>

          <Card>
            <SectionTitle>Governance Vote Split (10 LUNES/vote)</SectionTitle>
            <SectionSubtitle>Charged per vote cast on listing proposals</SectionSubtitle>
            <DistTable>
              <DistRow $accent="#00ff88">
                <DistLeft><DistDot $color="#00ff88" />Stakers (Rewards Pool)</DistLeft>
                <DistRight>
                  <DistPct>30% — {VOTE_COST * VOTE_STAKERS_PCT} LUNES</DistPct>
                </DistRight>
              </DistRow>
              <DistRow $accent="#6C38FF">
                <DistLeft><DistDot $color="#6C38FF" />Project Liquidity</DistLeft>
                <DistRight>
                  <DistPct>20% — {VOTE_COST * VOTE_LP_PCT} LUNES</DistPct>
                </DistRight>
              </DistRow>
              <DistRow $accent="#ffa500">
                <DistLeft><DistDot $color="#ffa500" />Treasury</DistLeft>
                <DistRight>
                  <DistPct>10% — {VOTE_COST * VOTE_TREASURY_PCT} LUNES</DistPct>
                </DistRight>
              </DistRow>
              <DistRow $accent="#00d4ff">
                <DistLeft><DistDot $color="#00d4ff" />Team</DistLeft>
                <DistRight>
                  <DistPct>40% — {VOTE_COST * VOTE_TEAM_PCT} LUNES</DistPct>
                </DistRight>
              </DistRow>
            </DistTable>
          </Card>
        </TwoCol>

        {/* Spot Fee Split */}
        <Card style={{ marginBottom: '32px' }}>
          <SectionTitle>Spot Orderbook Fee Split</SectionTitle>
          <SectionSubtitle>Charged on every matched trade — Maker 0.1% | Taker 0.25%</SectionSubtitle>
          <TwoCol style={{ marginBottom: 0, gap: '16px' }}>
            <div>
              <BarContainer>
                <BarRow>
                  <BarLabel><span>Team (Maker 50% / Taker 40%)</span><span style={{ color: '#00ff88' }}>~45% avg</span></BarLabel>
                  <BarTrack><BarFill $pct={45} $color="#00ff88" /></BarTrack>
                </BarRow>
                <BarRow>
                  <BarLabel><span>Stakers</span><span style={{ color: '#00d4ff' }}>30%</span></BarLabel>
                  <BarTrack><BarFill $pct={30} $color="#00d4ff" /></BarTrack>
                </BarRow>
                <BarRow>
                  <BarLabel><span>Affiliates</span><span style={{ color: '#a78bfa' }}>20%</span></BarLabel>
                  <BarTrack><BarFill $pct={20} $color="#a78bfa" /></BarTrack>
                </BarRow>
                <BarRow>
                  <BarLabel><span>Treasury (taker only)</span><span style={{ color: '#ffa500' }}>10%</span></BarLabel>
                  <BarTrack><BarFill $pct={10} $color="#ffa500" /></BarTrack>
                </BarRow>
              </BarContainer>
            </div>
            <DistTable>
              <DistRow $accent="#00ff88">
                <DistLeft><DistDot $color="#00ff88" />Team</DistLeft>
                <DistRight><DistPct>Maker: 50% &nbsp;|&nbsp; Taker: 40%</DistPct></DistRight>
              </DistRow>
              <DistRow $accent="#00d4ff">
                <DistLeft><DistDot $color="#00d4ff" />Stakers</DistLeft>
                <DistRight><DistPct>Maker: 30% &nbsp;|&nbsp; Taker: 30%</DistPct></DistRight>
              </DistRow>
              <DistRow $accent="#a78bfa">
                <DistLeft><DistDot $color="#a78bfa" />Affiliates</DistLeft>
                <DistRight><DistPct>Maker: 20% &nbsp;|&nbsp; Taker: 20%</DistPct></DistRight>
              </DistRow>
              <DistRow $accent="#ffa500">
                <DistLeft><DistDot $color="#ffa500" />Treasury</DistLeft>
                <DistRight><DistPct>Maker: 0% &nbsp;|&nbsp; Taker: 10%</DistPct></DistRight>
              </DistRow>
            </DistTable>
          </TwoCol>
        </Card>

        {/* Listing Fee */}
        <Card style={{ marginBottom: '32px' }}>
          <SectionTitle>Token Listing Fee</SectionTitle>
          <SectionSubtitle>Paid upfront to create a community governance proposal</SectionSubtitle>
          <StatsGrid>
            <StatCard $accent="#00ff88">
              <StatValue $color="#00ff88">1,000 LUNES</StatValue>
              <StatLabel>Proposal fee</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>14 days</StatValue>
              <StatLabel>Voting period</StatLabel>
            </StatCard>
            <StatCard $accent="#00d4ff">
              <StatValue $color="#00d4ff">Refunded</StatValue>
              <StatLabel>If approved by community</StatLabel>
            </StatCard>
            <StatCard $accent="#ff6b6b">
              <StatValue $color="#ff6b6b">Kept</StatValue>
              <StatLabel>If rejected — split 50% Team / 30% Treasury / 20% Stakers</StatLabel>
            </StatCard>
          </StatsGrid>
        </Card>

        {/* Financial Simulator */}
        <SliderSection>
          <SliderCard>
            <SectionTitle>Financial Simulator</SectionTitle>
            <SectionSubtitle>Adjust the sliders to project revenue at different growth stages</SectionSubtitle>

            <SliderGrid>
              <SliderGroup>
                <SliderLabel>
                  AMM Swap Volume <span>${fmt(dailyVolumeK)}K/day</span>
                </SliderLabel>
                <Slider
                  type="range" min={10} max={5000} step={10}
                  value={dailyVolumeK}
                  onChange={e => setDailyVolumeK(Number(e.target.value))}
                />
                <SliderLabel style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>$10K</span><span>$5M</span>
                </SliderLabel>
              </SliderGroup>

              <SliderGroup>
                <SliderLabel>
                  Spot Orderbook Volume <span>${fmt(dailySpotVolumeK)}K/day</span>
                </SliderLabel>
                <Slider
                  type="range" min={0} max={5000} step={10}
                  value={dailySpotVolumeK}
                  onChange={e => setDailySpotVolumeK(Number(e.target.value))}
                />
                <SliderLabel style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>$0</span><span>$5M</span>
                </SliderLabel>
              </SliderGroup>

              <SliderGroup>
                <SliderLabel>
                  Governance Votes/day <span>{dailyVotes} votes</span>
                </SliderLabel>
                <Slider
                  type="range" min={0} max={500} step={5}
                  value={dailyVotes}
                  onChange={e => setDailyVotes(Number(e.target.value))}
                />
                <SliderLabel style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>0</span><span>500</span>
                </SliderLabel>
              </SliderGroup>
            </SliderGrid>
            <SliderGrid style={{ marginTop: '0' }}>
              <SliderGroup>
                <SliderLabel>
                  Listings/month <span>{monthlyListings} proposals</span>
                </SliderLabel>
                <Slider
                  type="range" min={0} max={50} step={1}
                  value={monthlyListings}
                  onChange={e => setMonthlyListings(Number(e.target.value))}
                />
                <SliderLabel style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>0</span><span>50</span>
                </SliderLabel>
              </SliderGroup>
            </SliderGrid>

            <SliderGrid style={{ marginTop: '8px' }}>
              <SliderGroup style={{ gridColumn: 'span 3' }}>
                <SliderLabel>
                  LUNES Price <span>${lunesPrice.toFixed(3)}</span>
                </SliderLabel>
                <Slider
                  type="range" min={0.001} max={1} step={0.001}
                  value={lunesPrice}
                  onChange={e => setLunesPrice(Number(e.target.value))}
                />
                <SliderLabel style={{ justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>$0.001</span><span>$1.00</span>
                </SliderLabel>
              </SliderGroup>
            </SliderGrid>

            {/* Results */}
            <ResultsGrid>
              <ResultCard $primary>
                <ResultValue $color="#00ff88">{fmtUSD(monthlyTeamTotal)}</ResultValue>
                <ResultLabel>Team monthly revenue</ResultLabel>
              </ResultCard>
              <ResultCard>
                <ResultValue $color="#00d4ff">{fmtUSD(monthlyStakersTotal)}</ResultValue>
                <ResultLabel>Stakers monthly yield</ResultLabel>
              </ResultCard>
              <ResultCard>
                <ResultValue $color="#a78bfa">{fmtUSD(monthlyAffiliatesTotal)}</ResultValue>
                <ResultLabel>Affiliates monthly (Spot)</ResultLabel>
              </ResultCard>
              <ResultCard>
                <ResultValue $color="#6C38FF">{fmtUSD(monthlyEcosystemTotal)}</ResultValue>
                <ResultLabel>Total ecosystem monthly</ResultLabel>
              </ResultCard>
            </ResultsGrid>

            {/* Breakdown */}
            <Card style={{ marginTop: '24px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <SectionTitle style={{ fontSize: '16px', marginBottom: '4px' }}>Monthly Team Revenue Breakdown</SectionTitle>
              <FeeRow>
                <span>AMM swap fee (0.05% × {fmtUSD(dailyVolumeUSD)}/day × 30)</span>
                <span>{fmtUSD(monthlySwapTeam)}</span>
              </FeeRow>
              <FeeRow>
                <span>Spot orderbook fee ({fmtUSD(dailySpotVolumeUSD)}/day × ~45% team share × 30)</span>
                <span>{fmtUSD(monthlySpotTeam)}</span>
              </FeeRow>
              <FeeRow>
                <span>Governance votes ({dailyVotes}/day × 30 × 40% × {VOTE_COST} LUNES @ ${lunesPrice.toFixed(3)})</span>
                <span>{fmtUSD(monthlyVoteTeamUSD)}</span>
              </FeeRow>
              <FeeRow>
                <span>Listing fees ({monthlyListings} proposals × 1,000 LUNES × 50% @ ${lunesPrice.toFixed(3)})</span>
                <span>{fmtUSD(monthlyListingTeamUSD)}</span>
              </FeeRow>
              <FeeRow $highlight>
                <span>Annual team projection</span>
                <span>{fmtUSD(annualTeamTotal)}/year</span>
              </FeeRow>
            </Card>

            <Note>* Simulation only. Swap fee split requires on-chain contract update to take effect. Governance and listing fees already partially active.</Note>
          </SliderCard>
        </SliderSection>
      </Container>
    </Page>
  )
}

export default ProtocolStats
