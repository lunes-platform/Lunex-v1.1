import React, { useState, useMemo } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { calcFeeBreakdown } from 'services/spotService'

const Wrapper = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`

const Tabs = styled.div`
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 0 16px;
`

const Tab = styled.button<{ active?: boolean }>`
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid ${({ active }) => (active ? '#6c38fe' : 'transparent')};
  color: ${({ active }) => (active ? '#ffffff' : 'rgba(255,255,255,0.4)')};
  margin-bottom: -1px;
  transition: all 0.15s;

  &:hover {
    color: rgba(255, 255, 255, 0.8);
  }
`

const Body = styled.div`
  flex: 1;
  overflow: auto;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
`

const Thead = styled.thead`
  tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  th {
    padding: 8px 16px;
    text-align: left;
    color: rgba(255, 255, 255, 0.35);
    font-weight: 500;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
`

const Tbody = styled.tbody`
  tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.1s;

    &:hover {
      background: rgba(255, 255, 255, 0.03);
    }
  }
  td {
    padding: 10px 16px;
    color: rgba(255, 255, 255, 0.7);
  }
`

const SideBadge = styled.span<{ side: 'buy' | 'sell' }>`
  color: ${({ side }) => (side === 'buy' ? '#00C076' : '#FF4B55')};
  font-weight: 600;
`

const getStatusBg = (s: string) => {
  if (s === 'open') return 'rgba(108,56,254,0.2)'
  if (s === 'pending_trigger') return 'rgba(245, 158, 11, 0.18)'
  if (s === 'filled') return 'rgba(0,192,118,0.15)'
  return 'rgba(255,255,255,0.07)'
}

const getStatusColor = (s: string) => {
  if (s === 'open') return '#a78bfa'
  if (s === 'pending_trigger') return '#f59e0b'
  if (s === 'filled') return '#00C076'
  return 'rgba(255,255,255,0.4)'
}

const formatOrderStatus = (status: string) => {
  if (status === 'pending_trigger') return 'armed'
  return status
}

const formatOrderType = (type: string, stopPrice?: number | null) => {
  if ((type === 'STOP' || type === 'STOP_LIMIT') && stopPrice) {
    return `${type} @ ${stopPrice.toFixed(5)}`
  }
  return type
}

const getOrderPriceLabel = (type: string, price: number, stopPrice?: number | null) => {
  if (type === 'STOP') {
    return stopPrice ? `${stopPrice.toFixed(5)} trig.` : 'Market'
  }

  return price.toFixed(5)
}

const StatusBadge = styled.span<{ status: string }>`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: ${({ status }) => getStatusBg(status)};
  color: ${({ status }) => getStatusColor(status)};
`

const CancelBtn = styled.button`
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid rgba(255,75,85,0.3);
  background: transparent;
  color: #FF4B55;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,75,85,0.15);
  }
`

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
  gap: 8px;
`

const FeeCell = styled.td`
  position: relative;
  cursor: default;

  &:hover > div {
    display: flex;
  }
`

const FeeTooltip = styled.div`
  display: none;
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  background: #1e1e1e;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 10px 12px;
  z-index: 99;
  min-width: 180px;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
`

const FeeTooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  white-space: nowrap;

  span:last-child {
    color: rgba(255,255,255,0.7);
    font-weight: 600;
    margin-left: 16px;
  }
`

const FeeTooltipTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,0.6);
  margin-bottom: 2px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding-bottom: 4px;
`

type OrderRow = {
  id: string | number
  pair: string
  type: string
  side: 'buy' | 'sell'
  price: number
  stopPrice?: number | null
  amount: number
  filled: number
  status: string
  time: string
}

type HistoryTab = 'open' | 'history' | 'trades'

const OrderHistory: React.FC = () => {
  const { userOrders, userTrades, isConnected, walletAddress, cancelOrder, selectedPair } = useSpot()
  const { signMessage } = useSDK()
  const [activeTab, setActiveTab] = useState<HistoryTab>('open')

  // Real data from API or mock fallback
  const openOrders = useMemo(() => {
    if (isConnected) {
      return userOrders
        .filter(o => o.status === 'OPEN' || o.status === 'PARTIAL' || o.status === 'PENDING_TRIGGER')
        .map(o => ({
          id: o.id,
          pair: o.pair?.symbol || selectedPair,
          type: o.type,
          side: o.side.toLowerCase() as 'buy' | 'sell',
          price: parseFloat(o.price),
          stopPrice: o.stopPrice ? parseFloat(o.stopPrice) : null,
          amount: parseFloat(o.amount),
          filled: parseFloat(o.filledAmount),
          status: o.status.toLowerCase(),
          time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour12: false }),
        }))
    }
    return []
  }, [isConnected, userOrders, selectedPair])

  const historyOrders = useMemo(() => {
    if (isConnected) {
      return userOrders
        .filter(o => o.status === 'FILLED' || o.status === 'CANCELLED')
        .map(o => ({
          id: o.id,
          pair: o.pair?.symbol || selectedPair,
          type: o.type,
          side: o.side.toLowerCase() as 'buy' | 'sell',
          price: parseFloat(o.price),
          stopPrice: o.stopPrice ? parseFloat(o.stopPrice) : null,
          amount: parseFloat(o.amount),
          filled: parseFloat(o.filledAmount),
          status: o.status.toLowerCase(),
          time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour12: false }),
        }))
    }
    return []
  }, [isConnected, userOrders, selectedPair])

  const tradeHistory = useMemo(() => {
    if (isConnected && userTrades.length > 0) {
      return userTrades.map(t => {
        const isMaker = t.makerAddress === t.takerAddress
          ? false
          : t.makerFee !== '0'
        const feeVal = parseFloat(isMaker ? t.makerFee : t.takerFee)
        return {
          id: t.id,
          pair: t.pair?.symbol || selectedPair,
          side: t.side.toLowerCase() as 'buy' | 'sell',
          price: parseFloat(t.price),
          amount: parseFloat(t.amount),
          fee: feeVal,
          isMaker,
          breakdown: calcFeeBreakdown(feeVal, isMaker),
          time: new Date(t.createdAt).toLocaleTimeString('en-US', { hour12: false }),
        }
      })
    }
    return []
  }, [isConnected, userTrades, selectedPair])

  const handleCancel = async (orderId: string) => {
    await cancelOrder(orderId, signMessage)
  }

  return (
    <Wrapper>
      <Tabs>
        <Tab active={activeTab === 'open'} onClick={() => setActiveTab('open')}>
          Open Orders ({openOrders.length})
        </Tab>
        <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          Order History
        </Tab>
        <Tab active={activeTab === 'trades'} onClick={() => setActiveTab('trades')}>
          Trade History
        </Tab>
      </Tabs>

      <Body>
        {activeTab === 'open' && (
          openOrders.length > 0 ? (
            <Table>
              <Thead>
                <tr>
                  <th>Pair</th>
                  <th>Type</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Filled</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Action</th>
                </tr>
              </Thead>
              <Tbody>
                {openOrders.map(o => (
                  <tr key={o.id}>
                    <td>{o.pair}</td>
                    <td>{formatOrderType(o.type, o.stopPrice)}</td>
                    <td><SideBadge side={o.side}>{o.side === 'buy' ? 'Buy' : 'Sell'}</SideBadge></td>
                    <td>{getOrderPriceLabel(o.type, o.price, o.stopPrice)}</td>
                    <td>{o.amount.toLocaleString()}</td>
                    <td>{o.filled.toLocaleString()}</td>
                    <td><StatusBadge status={o.status}>{formatOrderStatus(o.status)}</StatusBadge></td>
                    <td>{o.time}</td>
                    <td><CancelBtn onClick={async () => { await handleCancel(String(o.id)) }}>Cancel</CancelBtn></td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EmptyState>
              <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
              <span>{!isConnected ? 'API offline — backend unavailable' : !walletAddress ? 'Connect your wallet to see orders' : 'No open orders'}</span>
            </EmptyState>
          )
        )}

        {activeTab === 'history' && (
          historyOrders.length > 0 ? (
            <Table>
              <Thead>
                <tr>
                  <th>Pair</th>
                  <th>Type</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Filled</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </Thead>
              <Tbody>
                {historyOrders.map(o => (
                  <tr key={o.id}>
                    <td>{o.pair}</td>
                    <td>{formatOrderType(o.type, o.stopPrice)}</td>
                    <td><SideBadge side={o.side}>{o.side === 'buy' ? 'Buy' : 'Sell'}</SideBadge></td>
                    <td>{getOrderPriceLabel(o.type, o.price, o.stopPrice)}</td>
                    <td>{o.amount.toLocaleString()}</td>
                    <td>{o.filled.toLocaleString()}</td>
                    <td><StatusBadge status={o.status}>{formatOrderStatus(o.status)}</StatusBadge></td>
                    <td>{o.time}</td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EmptyState>
              <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></span>
              <span>{!isConnected ? 'API offline — backend unavailable' : !walletAddress ? 'Connect your wallet to see history' : 'No order history'}</span>
            </EmptyState>
          )
        )}

        {activeTab === 'trades' && (
          tradeHistory.length > 0 ? (
            <Table>
              <Thead>
                <tr>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Fee ↕</th>
                  <th>Time</th>
                </tr>
              </Thead>
              <Tbody>
                {tradeHistory.map(t => (
                  <tr key={t.id}>
                    <td>{t.pair}</td>
                    <td><SideBadge side={t.side}>{t.side === 'buy' ? 'Buy' : 'Sell'}</SideBadge></td>
                    <td>{t.price.toFixed(5)}</td>
                    <td>{t.amount.toLocaleString()}</td>
                    <FeeCell>
                      {t.fee.toFixed(4)}
                      <FeeTooltip>
                        <FeeTooltipTitle>Fee split ({t.isMaker ? 'Maker' : 'Taker'})</FeeTooltipTitle>
                        <FeeTooltipRow><span>Team</span><span>{t.breakdown.team.toFixed(5)}</span></FeeTooltipRow>
                        <FeeTooltipRow><span>Stakers</span><span>{t.breakdown.stakers.toFixed(5)}</span></FeeTooltipRow>
                        <FeeTooltipRow><span>Affiliates</span><span>{t.breakdown.affiliates.toFixed(5)}</span></FeeTooltipRow>
                        {t.breakdown.treasury > 0 && (
                          <FeeTooltipRow><span>Treasury</span><span>{t.breakdown.treasury.toFixed(5)}</span></FeeTooltipRow>
                        )}
                      </FeeTooltip>
                    </FeeCell>
                    <td>{t.time}</td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EmptyState>
              <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></span>
              <span>No trades executed</span>
            </EmptyState>
          )
        )}
      </Body>
    </Wrapper>
  )
}

export default OrderHistory
