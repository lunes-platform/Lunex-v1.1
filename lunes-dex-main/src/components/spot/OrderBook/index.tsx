import React, { useState, useMemo } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'

// ──────────── Animations ────────────

const flashGreen = keyframes`
  0% { background: rgba(0,192,118,0.3); }
  100% { background: transparent; }
`

const flashRed = keyframes`
  0% { background: rgba(255,75,85,0.3); }
  100% { background: transparent; }
`

// ──────────── Styled Components ────────────

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
`

const TabRow = styled.div`
  display: flex;
  gap: 2px;
`

const MiniTab = styled.button<{ active?: boolean }>`
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ active }) => active ? 'rgba(0,192,118,0.15)' : 'transparent'};
  color: ${({ active }) => active ? '#00C076' : 'rgba(255,255,255,0.4)'};

  &:hover {
    color: rgba(255, 255, 255, 0.7);
  }
`

const PrecisionSelect = styled.select`
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  outline: none;

  option {
    background: #1a1a1a;
    color: #ffffff;
  }
`

const ColHeaders = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const OrderSection = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

const AskSection = styled(OrderSection)`
  justify-content: flex-end;
  display: flex;
  flex-direction: column;
`

const BidSection = styled(OrderSection)`
  justify-content: flex-start;
`

const OrderRow = styled.div<{ side: 'ask' | 'bid'; depth: number }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 12px;
  font-size: 12px;
  font-weight: 500;
  height: 20px;
  min-height: 20px;
  position: relative;
  cursor: pointer;

  &::before {
    content: '';
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: ${({ depth }) => depth}%;
    background: ${({ side }) =>
    side === 'ask' ? 'rgba(255,75,85,0.1)' : 'rgba(0,192,118,0.1)'};
    transition: width 0.3s ease;
  }

  &:hover::before {
    background: ${({ side }) =>
    side === 'ask' ? 'rgba(255,75,85,0.2)' : 'rgba(0,192,118,0.2)'};
  }
`

const PriceText = styled.span<{ side: 'ask' | 'bid' }>`
  color: ${({ side }) => (side === 'ask' ? '#FF4B55' : '#00C076')};
  font-weight: 600;
  position: relative;
  z-index: 1;
`

const NumText = styled.span`
  color: rgba(255, 255, 255, 0.7);
  position: relative;
  z-index: 1;
  font-size: 11px;
`

const SpreadBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(0, 192, 118, 0.05);
  border-top: 1px solid rgba(0, 192, 118, 0.1);
  border-bottom: 1px solid rgba(0, 192, 118, 0.1);
  flex-shrink: 0;
`

const SpreadLabel = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
`

const SpreadValue = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
`

const CurrentPrice = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: #00c076;
`

// ──────────── Recent Trades ────────────

const TradesList = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

const TradeRow = styled.div<{ side: 'buy' | 'sell'; isNew?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 12px;
  font-size: 12px;
  height: 20px;
  min-height: 20px;
  animation: ${({ side, isNew }) => isNew
    ? (side === 'buy' ? flashGreen : flashRed)
    : 'none'
  } 0.6s ease;
`

const TradePrice = styled.span<{ side: 'buy' | 'sell' }>`
  color: ${({ side }) => side === 'buy' ? '#00C076' : '#FF4B55'};
  font-weight: 600;
`

const TradeAmount = styled.span`
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
`

const TradeTime = styled.span`
  color: rgba(255, 255, 255, 0.3);
  font-size: 10px;
`

// ──────────── Types ────────────

interface Order {
  price: number
  amount: number
  total: number
}

interface Trade {
  id: number
  price: number
  amount: number
  side: 'buy' | 'sell'
  time: string
}

type ViewMode = 'book' | 'trades'
type PrecisionLevel = 5 | 4 | 3

// ──────────── Helpers ────────────

function groupOrders(orders: Order[], precision: PrecisionLevel): Order[] {
  const factor = Math.pow(10, precision)
  const grouped = new Map<number, Order>()

  for (const order of orders) {
    const key = Math.round(order.price * factor) / factor
    const existing = grouped.get(key)
    if (existing) {
      existing.amount += order.amount
      existing.total += order.total
    } else {
      grouped.set(key, { price: key, amount: order.amount, total: order.total })
    }
  }

  return Array.from(grouped.values())
}

// ──────────── Component ────────────

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: rgba(255, 255, 255, 0.25);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.3px;
  padding: 20px;
  text-align: center;
`

const OrderBook: React.FC = () => {
  const { orderbook, recentTrades: spotTrades, isConnected } = useSpot()
  const [viewMode, setViewMode] = useState<ViewMode>('book')
  const [precision, setPrecision] = useState<PrecisionLevel>(5)

  // Map API data to local Order type
  const asks: Order[] = useMemo(() => {
    if (isConnected && orderbook?.asks && orderbook.asks.length > 0) {
      return orderbook.asks
        .filter((a): a is NonNullable<typeof a> => a != null)
        .map(a => ({ price: Number(a.price), amount: Number(a.amount), total: Number(a.total) }))
    }
    return []
  }, [isConnected, orderbook])

  const bids: Order[] = useMemo(() => {
    if (isConnected && orderbook?.bids && orderbook.bids.length > 0) {
      return orderbook.bids
        .filter((b): b is NonNullable<typeof b> => b != null)
        .map(b => ({ price: Number(b.price), amount: Number(b.amount), total: Number(b.total) }))
    }
    return []
  }, [isConnected, orderbook])

  const trades: Trade[] = useMemo(() => {
    if (isConnected && spotTrades.length > 0) {
      return spotTrades
        .filter((t): t is NonNullable<typeof t> => t != null)
        .map((t, i) => ({
          id: i,
          price: parseFloat(t.price),
          amount: parseFloat(t.amount),
          side: t.side.toLowerCase() as 'buy' | 'sell',
          time: new Date(t.createdAt).toLocaleTimeString('en-US', { hour12: false }),
        }))
    }
    return []
  }, [isConnected, spotTrades])

  const groupedAsks = useMemo(
    () => groupOrders(asks, precision).sort((a, b) => a.price - b.price),
    [asks, precision]
  )
  const groupedBids = useMemo(
    () => groupOrders(bids, precision).sort((a, b) => b.price - a.price),
    [bids, precision]
  )

  const maxAsk = Math.max(...groupedAsks.map(o => o.total), 1)
  const maxBid = Math.max(...groupedBids.map(o => o.total), 1)
  const spread = groupedAsks[0] && groupedBids[0] ? groupedAsks[0].price - groupedBids[0].price : 0

  return (
    <Wrapper>
      <Header>
        <TabRow>
          <MiniTab active={viewMode === 'book'} onClick={() => setViewMode('book')}>
            Book
          </MiniTab>
          <MiniTab active={viewMode === 'trades'} onClick={() => setViewMode('trades')}>
            Trades
          </MiniTab>
        </TabRow>
        {viewMode === 'book' && (
          <PrecisionSelect
            value={precision}
            onChange={e => setPrecision(Number(e.target.value) as PrecisionLevel)}
          >
            <option value={5}>0.00001</option>
            <option value={4}>0.0001</option>
            <option value={3}>0.001</option>
          </PrecisionSelect>
        )}
      </Header>

      {viewMode === 'book' ? (
        <>
          <ColHeaders>
            <span>Price (USDT)</span>
            <span>Size</span>
            <span>Total</span>
          </ColHeaders>

          {groupedAsks.length === 0 && groupedBids.length === 0 ? (
            <EmptyState>No orders yet</EmptyState>
          ) : (
            <>
              {/* ASKS */}
              <AskSection>
                {groupedAsks.slice(0, 22).reverse().map((o, i) => (
                  <OrderRow key={i} side="ask" depth={(o.total / maxAsk) * 100}>
                    <PriceText side="ask">{o.price.toFixed(precision)}</PriceText>
                    <NumText>{o.amount.toFixed(0)}</NumText>
                    <NumText>{o.total.toFixed(2)}</NumText>
                  </OrderRow>
                ))}
              </AskSection>

              {/* SPREAD */}
              <SpreadBar>
                <CurrentPrice>{groupedBids[0]?.price.toFixed(precision) ?? '—'}</CurrentPrice>
                <SpreadLabel>Spread</SpreadLabel>
                <SpreadValue>{spread.toFixed(precision + 1)}</SpreadValue>
              </SpreadBar>

              {/* BIDS */}
              <BidSection>
                {groupedBids.slice(0, 22).map((o, i) => (
                  <OrderRow key={i} side="bid" depth={(o.total / maxBid) * 100}>
                    <PriceText side="bid">{o.price.toFixed(precision)}</PriceText>
                    <NumText>{o.amount.toFixed(0)}</NumText>
                    <NumText>{o.total.toFixed(2)}</NumText>
                  </OrderRow>
                ))}
              </BidSection>
            </>
          )}
        </>
      ) : (
        <>
          <ColHeaders>
            <span>Price</span>
            <span>Amount</span>
            <span>Time</span>
          </ColHeaders>
          <TradesList>
            {trades.length === 0 ? (
              <EmptyState>No trades executed</EmptyState>
            ) : (
              trades.slice(0, 28).map((t, i) => (
                <TradeRow key={t.id} side={t.side} isNew={i === 0}>
                  <TradePrice side={t.side}>{t.price.toFixed(5)}</TradePrice>
                  <TradeAmount>{t.amount.toFixed(0)}</TradeAmount>
                  <TradeTime>{t.time}</TradeTime>
                </TradeRow>
              ))
            )}
          </TradesList>
        </>
      )}
    </Wrapper>
  )
}

export default OrderBook
