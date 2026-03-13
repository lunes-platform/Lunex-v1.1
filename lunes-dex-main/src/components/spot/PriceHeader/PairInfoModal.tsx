import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { spotApi } from '../../../services/spotService'

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
  width: 420px;
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

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`

const InfoRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.04);
`

const Label = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Space Grotesk', sans-serif;
`

const Value = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
`

const AddressValue = styled.span`
  font-size: 11px;
  font-weight: 500;
  color: rgba(108, 56, 255, 0.8);
  word-break: break-all;
  font-family: monospace;
`

const FullRow = styled(InfoRow)`
  grid-column: 1 / -1;
`

const Divider = styled.div`
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 0;
  grid-column: 1 / -1;
`

const StatusBadge = styled.span<{ online: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ online }) => online ? '#00C076' : 'rgba(255,255,255,0.4)'};

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${({ online }) => online ? '#00C076' : 'rgba(255,255,255,0.2)'};
  }
`

const LoadingText = styled.div`
  text-align: center;
  padding: 32px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
`

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M'
  if (vol >= 1_000) return (vol / 1_000).toFixed(0) + 'K'
  return vol.toFixed(0)
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(5)
  return price.toFixed(8)
}

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

interface Props {
  onClose: () => void
}

const PairInfoModal: React.FC<Props> = ({ onClose }) => {
  const { selectedPair, ticker, isConnected } = useSpot()
  const [marketInfo, setMarketInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    spotApi.getMarketInfo(selectedPair)
      .then(data => setMarketInfo(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedPair])

  const price = ticker?.lastPrice ?? 0
  const change = ticker?.change24h ?? 0
  const volume = ticker?.volume24h ?? 0
  const high = ticker?.high24h ?? 0
  const low = ticker?.low24h ?? 0
  const pair = marketInfo?.pair

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <TitleRow>
            <TitleIcon>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </TitleIcon>
            <Title>{selectedPair} Info</Title>
          </TitleRow>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </Header>

        {loading ? (
          <LoadingText>Loading pair data...</LoadingText>
        ) : (
          <InfoGrid>
            <InfoRow>
              <Label>Current Price</Label>
              <Value style={{ color: change >= 0 ? '#00C076' : '#FF4B55' }}>
                {price > 0 ? `$${formatPrice(price)}` : '--'}
              </Value>
            </InfoRow>

            <InfoRow>
              <Label>24h Change</Label>
              <Value style={{ color: change >= 0 ? '#00C076' : '#FF4B55' }}>
                {change >= 0 ? '+' : ''}{change.toFixed(2)}%
              </Value>
            </InfoRow>

            <InfoRow>
              <Label>24h High</Label>
              <Value>{high > 0 ? `$${formatPrice(high)}` : '--'}</Value>
            </InfoRow>

            <InfoRow>
              <Label>24h Low</Label>
              <Value>{low > 0 ? `$${formatPrice(low)}` : '--'}</Value>
            </InfoRow>

            <InfoRow>
              <Label>24h Volume</Label>
              <Value>{volume > 0 ? `${formatVolume(volume)}` : '--'}</Value>
            </InfoRow>

            <InfoRow>
              <Label>Trade Count</Label>
              <Value>{ticker?.tradeCount ?? '--'}</Value>
            </InfoRow>

            {pair && (
              <>
                <Divider />

                <InfoRow>
                  <Label>Base Token</Label>
                  <Value>{pair.baseName}</Value>
                </InfoRow>
                <InfoRow>
                  <Label>Quote Token</Label>
                  <Value>{pair.quoteName}</Value>
                </InfoRow>

                <FullRow>
                  <Label>Base Address</Label>
                  <AddressValue title={pair.baseToken}>
                    {shortenAddress(pair.baseToken)}
                  </AddressValue>
                </FullRow>

                <FullRow>
                  <Label>Quote Address</Label>
                  <AddressValue title={pair.quoteToken}>
                    {shortenAddress(pair.quoteToken)}
                  </AddressValue>
                </FullRow>

                {pair.pairAddress && (
                  <FullRow>
                    <Label>Pair Contract</Label>
                    <AddressValue title={pair.pairAddress}>
                      {shortenAddress(pair.pairAddress)}
                    </AddressValue>
                  </FullRow>
                )}

                <InfoRow>
                  <Label>Maker Fee</Label>
                  <Value>{(pair.makerFeeBps / 100).toFixed(2)}%</Value>
                </InfoRow>
                <InfoRow>
                  <Label>Taker Fee</Label>
                  <Value>{(pair.takerFeeBps / 100).toFixed(2)}%</Value>
                </InfoRow>

                <InfoRow>
                  <Label>Listed</Label>
                  <Value>{new Date(pair.listingDate).toLocaleDateString()}</Value>
                </InfoRow>
              </>
            )}

            {marketInfo?.onChain && (
              <>
                <Divider />
                <FullRow>
                  <Label>On-Chain Stats (SubQuery)</Label>
                  <StatusBadge online={true}>Live</StatusBadge>
                </FullRow>
                <InfoRow>
                  <Label>Total Swaps</Label>
                  <Value>{Number(marketInfo.onChain.swapCount).toLocaleString()}</Value>
                </InfoRow>
                <InfoRow>
                  <Label>Last Swap</Label>
                  <Value>
                    {marketInfo.onChain.lastSwapAt
                      ? new Date(marketInfo.onChain.lastSwapAt).toLocaleString()
                      : '--'}
                  </Value>
                </InfoRow>
              </>
            )}

            <Divider />

            {!marketInfo?.onChain && !loading && (
              <FullRow>
                <Label>SubQuery Indexer</Label>
                <StatusBadge online={false}>Offline</StatusBadge>
              </FullRow>
            )}

            <FullRow>
              <Label>API Status</Label>
              <StatusBadge online={isConnected}>
                {isConnected ? 'Connected' : 'Offline'}
              </StatusBadge>
            </FullRow>
          </InfoGrid>
        )}
      </Modal>
    </Overlay>
  )
}

export default PairInfoModal
