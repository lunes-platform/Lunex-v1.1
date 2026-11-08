import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { SpotPair } from 'services/spotService'

// Regression test for the "freshly listed pair" order-gate blocker, rewritten
// for the redesigned single OrderForm (tabs Limit / Market / Stop / Stop-Limit
// instead of the old LimitForm / MarketForm / StopForm / StopLimitForm).
//
// A pair that has been registered but has never traded returns an empty ticker
// (lastPrice === 0) and an empty book, so there is no live reference price.
// The fee schedule, however, IS available: the pair's makerFeeBps /
// takerFeeBps come from the pairs endpoint.
//
// Invariant under test:
//   New pair, no trades (no reference price) + fee schedule loaded
//     => LIMIT orders ENABLED   (user supplies the price)
//     => STOP  orders ENABLED   (user supplies the trigger price)
//     => STOP-LIMIT ENABLED     (user supplies both prices)
//     => MARKET orders DISABLED (genuinely needs a live reference price)
//   Fee schedule NOT loaded (pair metadata missing)
//     => STOP and STOP-LIMIT stay DISABLED
//
// React 18 client API renders into jsdom; no @testing-library dependency.

const NEW_PAIR = 'NEW/LUSDT'
const PAIR: SpotPair = {
  id: 'new',
  symbol: NEW_PAIR,
  baseName: 'NEW',
  quoteName: 'LUSDT',
  baseToken: 'new-token',
  quoteToken: 'lusdt',
  baseDecimals: 8,
  quoteDecimals: 6,
  isNativeBase: false,
  isNativeQuote: false,
  // deliberately different from the form's display fallbacks (10 / 25 bps)
  makerFeeBps: 20,
  takerFeeBps: 40
}

const mocks = vi.hoisted(() => ({
  pairs: [] as SpotPair[]
}))

vi.mock('context/SpotContext', () => ({
  useSpot: () => ({
    selectedPair: 'NEW/LUSDT',
    pairs: mocks.pairs,
    // freshly listed: empty ticker, empty book → no reference price
    ticker: { symbol: 'NEW/LUSDT', lastPrice: 0, bestBid: null, bestAsk: null },
    orderbook: { bids: [], asks: [], bestBid: null, bestAsk: null },
    refreshOrders: async () => undefined
  })
}))
vi.mock('context/SDKContext', () => ({
  useSDK: () => ({ walletAddress: 'bob', signMessage: async () => '0xsig' })
}))
vi.mock('context/TxContext', () => ({ useTx: () => ({ run: () => undefined }) }))
vi.mock('../useSpotBalances', () => ({
  useSpotBalances: () => ({ base: 100000, quote: 100000, refresh: () => undefined })
}))
vi.mock('../MarginTab', () => ({ default: () => null }))
vi.mock('../../Vault', () => ({ default: () => null }))
vi.mock('../../Vault/useSettlementMode', () => ({
  useSettlementMode: () => ({ settlementEnabled: true, contractAddress: 'v' })
}))

import OrderForm from '../index'

// Tell React 18 we are inside an act()-aware test environment (jsdom + vitest).
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function mount(tab: 'Limit' | 'Market' | 'Stop' | 'Stop-Limit'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<OrderForm />)
  })
  const tabBtn = Array.from(
    container.querySelectorAll('[role="tablist"][aria-label="Order type"] [role="tab"]')
  ).find(b => b.textContent === tab) as HTMLButtonElement
  expect(tabBtn, tab).toBeTruthy()
  act(() => {
    tabBtn.click()
  })
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  mocks.pairs = []
})

// Set a controlled <input> value the way React expects (native setter + event).
function setInput(label: string, value: string): void {
  const input = container.querySelector(
    `input[aria-label="${label}"]`
  ) as HTMLInputElement
  expect(input, label).toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submitButton(): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll('button'))
  // The submit (CTA) button is the last button of the form.
  return btns[btns.length - 1] as HTMLButtonElement
}

const text = () => container.textContent ?? ''

describe('OrderForm gate — freshly listed pair (no trades, ticker empty)', () => {
  it('LIMIT: enables orders when only the fee schedule is loaded', () => {
    mocks.pairs = [PAIR]
    mount('Limit')
    setInput('Limit price', '0.5')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent).toBe('Buy NEW')
    // the pair's own maker fee is the one applied, not a fallback
    expect(text()).toContain('Fee (maker 0.20%)')
  })

  it('STOP: enables orders when only the fee schedule is loaded (the blocker fix)', () => {
    mocks.pairs = [PAIR]
    mount('Stop')
    setInput('Stop price', '0.5')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent).toBe('Stop Buy NEW')
    expect(text()).toContain('Fee (taker 0.40%)')
  })

  it('STOP-LIMIT: enables orders when only the fee schedule is loaded (user supplies both prices)', () => {
    mocks.pairs = [PAIR]
    mount('Stop-Limit')
    setInput('Stop price', '0.6')
    setInput('Limit price', '0.5')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent).toBe('Stop Buy NEW')
    expect(text()).toContain('Fee (maker 0.20%)')
  })

  it('MARKET: stays disabled without a live reference price (gate correctly retained)', () => {
    mocks.pairs = [PAIR]
    mount('Market')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(true)
    expect(submitButton().textContent).toBe('No liquidity in the book')
  })
})

// The fee schedule is "not loaded" while the pair metadata (makerFeeBps /
// takerFeeBps) has not arrived from the pairs endpoint.

describe('OrderForm gate — STOP-LIMIT still requires the fee schedule', () => {
  it('STOP-LIMIT: stays disabled when the fee schedule has not loaded (pair fees missing)', () => {
    mocks.pairs = []
    mount('Stop-Limit')
    setInput('Stop price', '0.6')
    setInput('Limit price', '0.5')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(true)
  })
})

describe('OrderForm gate — STOP still requires the fee schedule', () => {
  it('STOP: stays disabled when the fee schedule has not loaded (pair fees missing)', () => {
    mocks.pairs = []
    mount('Stop')
    setInput('Stop price', '0.5')
    setInput('Amount', '100')
    expect(submitButton().disabled).toBe(true)
  })
})
