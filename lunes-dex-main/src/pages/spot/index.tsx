import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useSearchParams } from 'react-router-dom'
import { Page } from 'components/ui/kit'
import { useSpot } from 'context/SpotContext'
import PairSelector from 'components/spot/PairSelector'
import PriceHeader from 'components/spot/PriceHeader'
import ChartPanel from 'components/spot/ChartPanel'
import OrderBook from 'components/spot/OrderBook'
import OrderForm from 'components/spot/OrderForm'
import OrderHistory from 'components/spot/OrderHistory'
import { SpotTerminalProvider, T, TPanel } from 'components/spot/terminal'

// ──────────────────────────────────────────────────────────────
// Terminal layout
//   ≥1200   chart + history | book 280 | form 320, full height
//   760–1199 chart full width; book + form side by side; history below
//   <760    stacked
// Panels are separated by 1px gaps over the #0D0D0D terminal background.
// ──────────────────────────────────────────────────────────────

const Terminal = styled(Page)`
  gap: 1px;
  background: ${T.bg};
  min-height: 0;
  @media (min-width: 1200px) {
    height: calc(100vh - 64px);
  }
`

const PairBar = styled.div`
  background: ${T.panel};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 22px;
  padding: 10px 16px;
  position: relative;
  z-index: 5;
  flex-shrink: 0;
`

const Body = styled.div`
  display: flex;
  gap: 1px;
  flex: 1;
  min-height: 0;
  @media (max-width: 1199px) {
    flex-wrap: wrap;
  }
  @media (max-width: 759px) {
    flex-direction: column;
    flex-wrap: nowrap;
  }
`

const Left = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  @media (max-width: 1199px) {
    display: contents;
  }
`

const ChartBox = styled(TPanel)`
  flex: 1 1 auto;
  @media (max-width: 1199px) {
    order: 0;
    flex: 1 1 100%;
    min-height: 360px;
  }
  @media (max-width: 759px) {
    flex: none;
  }
`

const HistoryBox = styled(TPanel)`
  height: 230px;
  flex: 0 0 auto;
  @media (max-width: 1199px) {
    order: 3;
    flex: 1 1 100%;
    height: 300px;
  }
  @media (max-width: 759px) {
    flex: none;
  }
`

const BookBox = styled(TPanel)`
  width: 280px;
  flex-shrink: 0;
  order: 1;
  @media (max-width: 1199px) {
    width: calc(50% - 1px);
    height: 440px;
  }
  @media (max-width: 759px) {
    width: 100%;
  }
`

const FormBox = styled(TPanel)`
  width: 320px;
  flex-shrink: 0;
  order: 2;
  overflow-y: auto;
  @media (max-width: 1199px) {
    width: 50%;
  }
  @media (max-width: 759px) {
    width: 100%;
  }
`

/** Select the pair from a shared link (`/spot?pair=WLUNES-LUSDT`). */
const usePairFromUrl = () => {
  const [params] = useSearchParams()
  const { pairs, setSelectedPair, selectedPair } = useSpot()
  const done = useRef(false)
  useEffect(() => {
    const raw = params.get('pair')
    if (done.current || !raw || pairs.length === 0) return
    done.current = true
    const symbol = raw.replace('-', '/').toUpperCase()
    if (symbol !== selectedPair && pairs.some(p => p.symbol === symbol)) {
      setSelectedPair(symbol)
    }
  }, [params, pairs, setSelectedPair, selectedPair])
}

const SpotPage: React.FC = () => {
  usePairFromUrl()

  return (
    <SpotTerminalProvider>
      <Terminal $fadeOnly>
        <PairBar>
          <PairSelector />
          <PriceHeader />
        </PairBar>
        <Body>
          <Left>
            <ChartBox aria-label="Price chart">
              <ChartPanel />
            </ChartBox>
            <HistoryBox aria-label="Your orders">
              <OrderHistory />
            </HistoryBox>
          </Left>
          <BookBox aria-label="Order book">
            <OrderBook />
          </BookBox>
          <FormBox aria-label="Place order">
            <OrderForm />
          </FormBox>
        </Body>
      </Terminal>
    </SpotTerminalProvider>
  )
}

export default SpotPage
