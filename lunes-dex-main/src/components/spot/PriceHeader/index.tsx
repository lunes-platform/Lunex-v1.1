import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { ChartColumn, Info, Share2, Star } from 'lucide-react'
import { useSpot } from 'context/SpotContext'
import { C, grotesk, tabular } from 'components/ui/kit'
import AnimatedNumber from 'components/ui/AnimatedNumber'
import contractService from '../../../services/contractService'
import { useFavorites } from '../../../hooks/useFavorites'
import { T, fmtPx, fq, splitPair } from '../terminal'
import PairInfoModal from './PairInfoModal'
import ShareModal from './ShareModal'
import AnalyticsModal from './AnalyticsModal'

const MAX_SUPPLY = 6_000_000_000
const WLUNES_ADDRESS =
  process.env.REACT_APP_TOKEN_WLUNES ||
  '5HRAhbbqPdBSB4WBKM2JYxrEDwE5FbsajJcAMcPHjqNgKiA'
const LUNES_DECIMALS = 8
const LUNES_BASES = ['LUNES', 'WLUNES']

const Price = styled.div<{ $up: boolean }>`
  display: flex;
  flex-direction: column;
  color: ${p => (p.$up ? T.up : T.down)};
  b {
    ${grotesk};
    ${tabular};
    font-size: 22px;
    font-weight: 600;
    line-height: 1.15;
  }
  small {
    ${tabular};
    font-size: 12px;
    font-weight: 600;
  }
`

const Stat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  span:first-child {
    font-size: 11px;
    color: ${C.muted};
    white-space: nowrap;
  }
  span:last-child {
    ${tabular};
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
`

const Pressure = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  > div:first-child {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    ${tabular};
  }
`

const Bar = styled.div`
  height: 4px;
  border-radius: 999px;
  background: ${T.down};
  overflow: hidden;
  > div {
    height: 100%;
    background: ${T.up};
    transition: width 300ms ease;
  }
`

const Actions = styled.div`
  display: flex;
  gap: 6px;
  margin-left: auto;
`

const Act = styled.button<{ $on?: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid ${p => (p.$on ? 'rgba(254,146,63,0.45)' : T.line)};
  background: ${p => (p.$on ? 'rgba(254,146,63,0.1)' : 'transparent')};
  color: ${p => (p.$on ? C.warning : C.secondary)};
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 150ms ease,
    color 150ms ease;
  &:hover {
    border-color: ${p => (p.$on ? C.warning : C.primary)};
    color: ${p => (p.$on ? C.warning : C.text)};
  }
`

type ModalKind = 'info' | 'share' | 'analytics' | null

/** Price + 24h stats + pressure bar + actions. Rendered inside the pair bar. */
const PriceHeader: React.FC = () => {
  const { ticker, orderbook, selectedPair, walletAddress } = useSpot()
  const { isFavorite, toggleFavorite } = useFavorites(walletAddress)
  const [supply, setSupply] = useState(0)
  const [modal, setModal] = useState<ModalKind>(null)
  const [base, quote] = splitPair(selectedPair)
  const isLunes = LUNES_BASES.includes(base)

  useEffect(() => {
    if (!isLunes) return
    contractService
      .getTokenInfo(WLUNES_ADDRESS)
      .then(info => {
        if (info) {
          const raw = Number(info.totalSupply) || 0
          setSupply(raw / Math.pow(10, LUNES_DECIMALS))
        }
      })
      .catch(() => undefined)
  }, [isLunes])

  const price = ticker?.lastPrice ?? 0
  const change = ticker?.change24h ?? 0
  const volume = ticker?.volume24h ?? 0
  const turnover = ticker?.quoteVolume24h || volume * price
  const up = change >= 0
  const marketCap = isLunes && supply > 0 ? supply * price : 0
  const circPct =
    isLunes && supply > 0 ? Math.round((supply / MAX_SUPPLY) * 100) : 0

  const { buyPct, hasBook } = useMemo(() => {
    const sum = (l?: Array<{ amount: number }>) =>
      (l || []).slice(0, 20).reduce((s, x) => s + (Number(x?.amount) || 0), 0)
    const b = sum(orderbook?.bids)
    const a = sum(orderbook?.asks)
    return {
      buyPct: b + a > 0 ? Math.round((b / (b + a)) * 100) : 50,
      hasBook: b + a > 0
    }
  }, [orderbook])

  const stats: Array<[string, string]> = [
    ['24h High', fmtPx(ticker?.high24h)],
    ['24h Low', fmtPx(ticker?.low24h)],
    ['24h Volume', volume > 0 ? `${fq(volume)} ${base}` : '—'],
    ['24h Turnover', turnover > 0 ? `${fq(turnover)} ${quote}` : '—'],
    ['Market cap', marketCap > 0 ? `$${fq(marketCap)}` : '—'],
    ['Circulating', circPct > 0 ? `${circPct}%` : '—']
  ]

  const fav = isFavorite(selectedPair)

  return (
    <>
      <Price $up={up} aria-live="polite">
        <b>
          {price > 0 ? <AnimatedNumber text={fmtPx(price)} noFlash /> : '—'}
        </b>
        <small>
          {price > 0 ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
        </small>
      </Price>

      {stats.map(([l, v]) => (
        <Stat key={l}>
          <span>{l}</span>
          <span>{v}</span>
        </Stat>
      ))}

      <Pressure aria-label="Order book buy / sell pressure">
        <div>
          <span style={{ color: T.upText }}>
            Buy {hasBook ? `${buyPct}%` : '—'}
          </span>
          <span style={{ color: T.downText }}>
            {hasBook ? `${100 - buyPct}%` : '—'} Sell
          </span>
        </div>
        <Bar>
          <div style={{ width: `${buyPct}%` }} />
        </Bar>
      </Pressure>

      <Actions>
        <Act
          $on={fav}
          title={fav ? 'Remove from favourites' : 'Add to favourites'}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
          aria-pressed={fav}
          onClick={() => toggleFavorite(selectedPair)}
        >
          <Star size={15} strokeWidth={1.75} fill={fav ? C.warning : 'none'} />
        </Act>
        <Act
          title="Pair info"
          aria-label="Pair info"
          onClick={() => setModal('info')}
        >
          <Info size={15} strokeWidth={1.75} />
        </Act>
        <Act
          title="Share market"
          aria-label="Share market"
          onClick={() => setModal('share')}
        >
          <Share2 size={15} strokeWidth={1.75} />
        </Act>
        <Act
          title="Analytics"
          aria-label="Analytics"
          onClick={() => setModal('analytics')}
        >
          <ChartColumn size={15} strokeWidth={1.75} />
        </Act>
      </Actions>

      <PairInfoModal open={modal === 'info'} onClose={() => setModal(null)} />
      <ShareModal open={modal === 'share'} onClose={() => setModal(null)} />
      <AnalyticsModal
        open={modal === 'analytics'}
        onClose={() => setModal(null)}
      />
    </>
  )
}

export default PriceHeader
