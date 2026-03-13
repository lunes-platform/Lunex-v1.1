import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useFavorites } from '../../../hooks/useFavorites'
import contractService from '../../../services/contractService'
import PairInfoModal from './PairInfoModal'
import ShareModal from './ShareModal'
import AnalyticsModal from './AnalyticsModal'

const MAX_SUPPLY = 6_000_000_000
const WLUNES_ADDRESS = process.env.REACT_APP_TOKEN_WLUNES || '5HRAhbbqPdBSB4WBKM2JYxrEDwE5FbsajJcAMcPHjqNgKiA'
const LUNES_DECIMALS = 8

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 28px;
  flex: 1;
  overflow: hidden;
`

const MainPrice = styled.div`
  display: flex;
  flex-direction: column;
`

const PriceValue = styled.span<{ positive?: boolean }>`
  font-size: 22px;
  font-weight: 700;
  color: ${({ positive }) => (positive ? '#00C076' : '#FF4B55')};
  line-height: 1;
`

const PriceSub = styled.span<{ positive?: boolean }>`
  font-size: 12px;
  color: ${({ positive }) => (positive ? '#00C076' : '#FF4B55')};
  margin-top: 2px;
`

const Stat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const StatLabel = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const StatValue = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
`

const RatioWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 120px;
  margin-left: 12px;
`

const RatioLabels = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 500;
`

const RatioBar = styled.div`
  display: flex;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255,255,255,0.1);
`

const RatioBuy = styled.div<{ percent: number }>`
  width: ${({ percent }) => percent}%;
  background: #00C076;
`

const RatioSell = styled.div<{ percent: number }>`
  width: ${({ percent }) => percent}%;
  background: #FF4B55;
`

const ActionsWrapper = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
`

const ActionBtn = styled.button<{ isFav?: boolean }>`
  background: ${({ isFav }) => isFav ? 'rgba(255, 184, 0, 0.1)' : 'rgba(255, 255, 255, 0.03)'};
  border: 1px solid ${({ isFav }) => isFav ? 'rgba(255, 184, 0, 0.25)' : 'rgba(255, 255, 255, 0.08)'};
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ isFav }) => isFav ? '#FFB800' : 'rgba(255, 255, 255, 0.5)'};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ isFav }) => isFav ? 'rgba(255, 184, 0, 0.15)' : 'rgba(255, 255, 255, 0.08)'};
    color: ${({ isFav }) => isFav ? '#FFB800' : '#fff'};
    border-color: ${({ isFav }) => isFav ? 'rgba(255, 184, 0, 0.4)' : 'rgba(255, 255, 255, 0.2)'};
  }
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

const PriceHeader: React.FC = () => {
  const { ticker, orderbook, selectedPair, walletAddress } = useSpot()
  const { isFavorite, toggleFavorite } = useFavorites(walletAddress)
  const [circulatingSupply, setCirculatingSupply] = useState(0)
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false)

  const price = ticker?.lastPrice ?? 0
  const change = ticker?.change24h ?? 0
  const high = ticker?.high24h ?? 0
  const low = ticker?.low24h ?? 0
  const volume = ticker?.volume24h ?? 0
  const turnover = volume * price
  const positive = change >= 0

  const marketCap = circulatingSupply > 0 ? circulatingSupply * price : 0
  const circulatingPct = circulatingSupply > 0 ? Math.round((circulatingSupply / MAX_SUPPLY) * 100) : 0

  useEffect(() => {
    contractService.getTokenInfo(WLUNES_ADDRESS).then(info => {
      if (info) {
        const raw = Number(info.totalSupply) || 0
        setCirculatingSupply(raw / Math.pow(10, LUNES_DECIMALS))
      }
    }).catch(() => {})
  }, [])

  const bidVolume = orderbook?.bids?.reduce((sum: number, b: any) => sum + (Number(b.amount) || Number(b[1]) || 0), 0) ?? 0
  const askVolume = orderbook?.asks?.reduce((sum: number, a: any) => sum + (Number(a.amount) || Number(a[1]) || 0), 0) ?? 0
  const totalVolume = bidVolume + askVolume
  const buyPercent = totalVolume > 0 ? Math.round((bidVolume / totalVolume) * 100) : 0
  const sellPercent = totalVolume > 0 ? 100 - buyPercent : 0

  const isFav = isFavorite(selectedPair)

  return (
    <>
      <Wrapper>
        <MainPrice>
          <PriceValue positive={positive}>
            {price > 0 ? `$${formatPrice(price)}` : '--'}
          </PriceValue>
          <PriceSub positive={positive}>
            {price > 0 ? `${positive ? '+' : ''}${change.toFixed(2)}%` : '--'}
          </PriceSub>
        </MainPrice>

        <Stat>
          <StatLabel>24h High</StatLabel>
          <StatValue>{high > 0 ? `$${formatPrice(high)}` : '--'}</StatValue>
        </Stat>

        <Stat>
          <StatLabel>24h Low</StatLabel>
          <StatValue>{low > 0 ? `$${formatPrice(low)}` : '--'}</StatValue>
        </Stat>

        <Stat>
          <StatLabel>24h Volume</StatLabel>
          <StatValue>{volume > 0 ? `${formatVolume(volume)} LUNES` : '--'}</StatValue>
        </Stat>

        <Stat>
          <StatLabel>24h Turnover</StatLabel>
          <StatValue>{turnover > 0 ? `${formatVolume(turnover)} USDT` : '--'}</StatValue>
        </Stat>

        <Stat>
          <StatLabel>Market Cap</StatLabel>
          <StatValue>{marketCap > 0 ? `$${formatVolume(marketCap)}` : '--'}</StatValue>
        </Stat>

        <Stat>
          <StatLabel>Circulating</StatLabel>
          <StatValue>{circulatingPct > 0 ? `${circulatingPct}% Unlocked` : '--'}</StatValue>
        </Stat>

        <RatioWrapper>
          <RatioLabels>
            <span style={{ color: '#00C076' }}>{totalVolume > 0 ? `Buy ${buyPercent}%` : 'Buy --'}</span>
            <span style={{ color: '#FF4B55' }}>{totalVolume > 0 ? `${sellPercent}% Sell` : '-- Sell'}</span>
          </RatioLabels>
          <RatioBar>
            <RatioBuy percent={buyPercent} />
            <RatioSell percent={sellPercent} />
          </RatioBar>
        </RatioWrapper>

        <ActionsWrapper>
          {/* ⭐ Favorite */}
          <ActionBtn
            title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
            isFav={isFav}
            onClick={() => toggleFavorite(selectedPair)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? '#FFB800' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </ActionBtn>

          {/* ℹ️ Pair Info */}
          <ActionBtn
            title="Pair Info"
            onClick={() => setShowInfoModal(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </ActionBtn>

          {/* 🔗 Share */}
          <ActionBtn
            title="Share Market"
            onClick={() => setShowShareModal(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
          </ActionBtn>

          {/* 📊 Analytics */}
          <ActionBtn
            title="Analytics"
            onClick={() => setShowAnalyticsModal(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </ActionBtn>
        </ActionsWrapper>
      </Wrapper>

      {/* Modals */}
      {showInfoModal && <PairInfoModal onClose={() => setShowInfoModal(false)} />}
      {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
      {showAnalyticsModal && <AnalyticsModal onClose={() => setShowAnalyticsModal(false)} />}
    </>
  )
}

export default PriceHeader
