import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.15s ease;
`

const Modal = styled.div`
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
  animation: ${slideUp} 0.25s ease;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(108, 56, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6C38FF;
  flex-shrink: 0;
`

const Title = styled.h3`
  font-size: 18px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  color: #ffffff;
  margin: 0;
`

const CloseBtn = styled.button`
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 20px;
`

const StatCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
`

const StatLabel = styled.span`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Space Grotesk', sans-serif;
`

const StatValue = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
`

const SectionTitle = styled.h4`
  font-size: 13px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 12px;
`

const ChartContainer = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 120px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  margin-bottom: 16px;
`

const Bar = styled.div<{ height: number; accent?: boolean }>`
  flex: 1;
  height: ${({ height }) => height}%;
  min-height: 2px;
  background: ${({ accent }) => accent
    ? 'linear-gradient(to top, rgba(108, 56, 255, 0.3), rgba(108, 56, 255, 0.7))'
    : 'linear-gradient(to top, rgba(108, 56, 255, 0.15), rgba(108, 56, 255, 0.35))'};
  border-radius: 4px 4px 0 0;
  transition: height 0.3s ease;

  &:hover {
    background: linear-gradient(to top, rgba(108, 56, 255, 0.4), rgba(108, 56, 255, 0.8));
  }
`

const BarLabel = styled.span`
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  text-align: center;
  display: block;
  margin-top: 4px;
`

const BarCol = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
`

const DepthGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`

const NoData = styled.div`
  text-align: center;
  padding: 24px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 16px;
`

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M'
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K'
  return vol.toFixed(0)
}

interface Props {
  onClose: () => void
}

const AnalyticsModal: React.FC<Props> = ({ onClose }) => {
  const { selectedPair, ticker } = useSpot()

  const volume = ticker?.volume24h ?? 0
  const tradeCount = ticker?.tradeCount ?? 0
  const spread = ticker?.spread ?? 0
  const bestBid = ticker?.bestBid ?? 0
  const bestAsk = ticker?.bestAsk ?? 0

  // 7-day trend — only show today's real volume; past days are unknown without historical data
  const volumeTrend = Array.from({ length: 7 }, (_, i) => ({
    day: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en', { weekday: 'short' }),
    value: i === 6 ? volume : 0,  // only today's real volume is known
    isToday: i === 6,
  }))

  const maxVol = Math.max(...volumeTrend.map(v => v.value), 1)

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <TitleRow>
            <TitleIcon>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </TitleIcon>
            <Title>{selectedPair} Analytics</Title>
          </TitleRow>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </Header>

        <StatsGrid>
          <StatCard>
            <StatLabel>24h Volume</StatLabel>
            <StatValue>{volume > 0 ? formatVolume(volume) : '--'}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>Trades</StatLabel>
            <StatValue>{tradeCount > 0 ? tradeCount.toLocaleString() : '--'}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>Spread</StatLabel>
            <StatValue>{spread > 0 ? `${(spread * 100).toFixed(3)}%` : '--'}</StatValue>
          </StatCard>
        </StatsGrid>

        <SectionTitle>Volume Trend (7d)</SectionTitle>
        {volume > 0 ? (
          <ChartContainer>
            {volumeTrend.map((d, i) => (
              <BarCol key={i}>
                <Bar
                  height={Math.max((d.value / maxVol) * 100, 3)}
                  accent={d.isToday}
                  title={`${d.day}: ${formatVolume(d.value)}`}
                />
                <BarLabel>{d.day}</BarLabel>
              </BarCol>
            ))}
          </ChartContainer>
        ) : (
          <NoData>Volume data unavailable — spot-api offline</NoData>
        )}

        <SectionTitle>Order Book Depth</SectionTitle>
        <DepthGrid>
          <StatCard>
            <StatLabel>Best Bid</StatLabel>
            <StatValue style={{ color: '#00C076', fontSize: '14px' }}>
              {bestBid > 0 ? `$${bestBid >= 1 ? bestBid.toFixed(4) : bestBid.toFixed(8)}` : '--'}
            </StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>Best Ask</StatLabel>
            <StatValue style={{ color: '#FF4B55', fontSize: '14px' }}>
              {bestAsk > 0 ? `$${bestAsk >= 1 ? bestAsk.toFixed(4) : bestAsk.toFixed(8)}` : '--'}
            </StatValue>
          </StatCard>
        </DepthGrid>
      </Modal>
    </Overlay>
  )
}

export default AnalyticsModal
