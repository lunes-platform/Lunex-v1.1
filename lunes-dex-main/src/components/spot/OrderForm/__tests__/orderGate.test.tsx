import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { LimitForm, StopForm, StopLimitForm, MarketForm } from '../index'

// Tell React 18 we are inside an act()-aware test environment (jsdom + vitest).
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

// Regression test for the "freshly listed pair" order-gate blocker.
//
// A pair that has been registered but has never traded returns an empty ticker
// (lastPrice === 0), so the UI derives `marketPrice = null`. The fee schedule,
// however, IS available (takerFee / makerFee come from the pairs endpoint).
//
// Invariant under test:
//   New pair, no trades (marketPrice = null) + fee schedule loaded
//     => LIMIT orders ENABLED   (user supplies the price)
//     => STOP  orders ENABLED   (user supplies the trigger price)
//     => MARKET orders DISABLED (genuinely needs a live reference price)
//
// React 18 client API renders into jsdom; no @testing-library dependency.

let container: HTMLDivElement
let root: Root

function mount(node: React.ReactElement): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(node)
  })
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

// Set a controlled <input> value the way React expects (native setter + event).
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function inputs(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input')).filter(
    (el) => (el as HTMLInputElement).type === 'number',
  ) as HTMLInputElement[]
}

function submitButton(): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll('button'))
  // The submit button is the last button in each sub-form.
  return btns[btns.length - 1] as HTMLButtonElement
}

function hasUnavailableWarning(): boolean {
  return /Market data is unavailable/i.test(container.textContent ?? '')
}

// New, never-traded pair: ticker is empty -> marketPrice is null, but fees load.
const NEW_PAIR_PROPS = {
  side: 'buy' as const,
  onSubmit: () => undefined,
  balanceUsdt: 100000,
  balanceLunes: 100000,
  marketPrice: null,
  makerFee: 0.001,
  takerFee: 0.0025,
}

describe('OrderForm gate — freshly listed pair (no trades, ticker empty)', () => {
  it('LIMIT: enables orders when only the fee schedule is loaded', () => {
    mount(<LimitForm {...NEW_PAIR_PROPS} />)
    const [priceInput, amountInput] = inputs()
    setInput(priceInput, '0.5')
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(false)
    expect(submitButton().disabled).toBe(false)
  })

  it('STOP: enables orders when only the fee schedule is loaded (the blocker fix)', () => {
    mount(<StopForm {...NEW_PAIR_PROPS} />)
    const [stopInput, amountInput] = inputs()
    setInput(stopInput, '0.5')
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(false)
    expect(submitButton().disabled).toBe(false)
  })

  it('STOP-LIMIT: enables orders when only the fee schedule is loaded (user supplies both prices)', () => {
    // StopLimitForm gates on feeDataReady (makerFee is a number), NOT on
    // marketPrice > 0 — so a freshly listed pair (marketPrice = null) must
    // still allow a Stop-Limit order once the fee schedule has loaded.
    mount(<StopLimitForm {...NEW_PAIR_PROPS} />)
    const [stopInput, limitInput, amountInput] = inputs()
    setInput(stopInput, '0.6')
    setInput(limitInput, '0.5')
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(false)
    expect(submitButton().disabled).toBe(false)
  })

  it('MARKET: stays disabled without a live reference price (gate correctly retained)', () => {
    mount(<MarketForm {...NEW_PAIR_PROPS} />)
    const [amountInput] = inputs()
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(true)
    expect(submitButton().disabled).toBe(true)
  })
})

describe('OrderForm gate — STOP-LIMIT still requires the fee schedule', () => {
  it('STOP-LIMIT: stays disabled when the fee schedule has not loaded (makerFee null)', () => {
    mount(<StopLimitForm {...NEW_PAIR_PROPS} makerFee={null} />)
    const [stopInput, limitInput, amountInput] = inputs()
    setInput(stopInput, '0.6')
    setInput(limitInput, '0.5')
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(true)
    expect(submitButton().disabled).toBe(true)
  })
})

describe('OrderForm gate — STOP still requires the fee schedule', () => {
  it('STOP: stays disabled when the fee schedule has not loaded (takerFee null)', () => {
    mount(<StopForm {...NEW_PAIR_PROPS} takerFee={null} />)
    const [stopInput, amountInput] = inputs()
    setInput(stopInput, '0.5')
    setInput(amountInput, '100')
    expect(hasUnavailableWarning()).toBe(true)
    expect(submitButton().disabled).toBe(true)
  })
})
