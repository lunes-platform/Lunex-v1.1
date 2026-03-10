import React from 'react'
import styled from 'styled-components'
import PairSelector from 'components/spot/PairSelector'
import PriceHeader from 'components/spot/PriceHeader'
import ChartPanel from 'components/spot/ChartPanel'
import OrderBook from 'components/spot/OrderBook'
import OrderForm from 'components/spot/OrderForm'
import OrderHistory from 'components/spot/OrderHistory'

// ──────────────────────────────────────────────────────────────
// Fullscreen layout — zero scroll, dYdX-inspired
// 8pt grid, clear visual hierarchy, no overlap
// ──────────────────────────────────────────────────────────────

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #0d0d0d;
  padding-top: 64px; /* match header height */
  box-sizing: border-box;
`

const PairBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #121212;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  min-height: 48px;
`

const Content = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`

/* ─── Left column: Chart + Bottom Orders ─── */
const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`

const ChartArea = styled.div`
  flex: 1;
  min-height: 0;
  background: #121212;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
`

const BottomTabs = styled.div`
  height: 200px;
  flex-shrink: 0;
  background: #121212;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
`

/* ─── Middle column: Order Book ─── */
const MiddleCol = styled.div`
  width: 260px;
  flex-shrink: 0;
  background: #121212;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

/* ─── Right column: Order Form ─── */
const RightCol = styled.div`
  width: 300px;
  flex-shrink: 0;
  background: #121212;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;

  /* Hide scrollbar but keep function */
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
  }
`

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────

const SpotPage: React.FC = () => {
  return (
    <Page>
      {/* Pair info bar */}
      <PairBar>
        <PairSelector />
        <PriceHeader />
      </PairBar>

      {/* 3-column layout */}
      <Content>
        {/* LEFT: Chart + Bottom panel */}
        <LeftCol>
          <ChartArea>
            <ChartPanel />
          </ChartArea>
          <BottomTabs>
            <OrderHistory />
          </BottomTabs>
        </LeftCol>

        {/* MIDDLE: Order Book */}
        <MiddleCol>
          <OrderBook />
        </MiddleCol>

        {/* RIGHT: Order Form */}
        <RightCol>
          <OrderForm />
        </RightCol>
      </Content>
    </Page>
  )
}

export default SpotPage
