import React from 'react'
import { it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
const mocks = vi.hoisted(() => ({ wallet: 'maker' }))
vi.mock('context/SpotContext', () => ({
  useSpot: () => ({
    userOrders: [],
    userTrades: [
      {
        id: 'trade',
        makerAddress: 'maker',
        takerAddress: 'taker',
        side: 'BUY',
        price: '2',
        amount: '10',
        makerFee: '0.02',
        takerFee: '0.05',
        createdAt: '2026-10-18T16:00:00Z',
        pair: { symbol: 'QAX/QUSD' }
      }
    ],
    isConnected: true,
    walletAddress: mocks.wallet,
    cancelOrder: vi.fn(),
    selectedPair: 'QAX/QUSD',
    refreshOrders: vi.fn(),
    refreshTrades: vi.fn()
  })
}))
vi.mock('context/SDKContext', () => ({
  useSDK: () => ({ signMessage: vi.fn() })
}))
import OrderHistory from './index'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('shows each wallet its own side and fee for the same settled trade', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<OrderHistory />)
    })
    await act(async () => {
      ;[...host.querySelectorAll('button')]
        .find(b => b.textContent === 'Trade History')
        ?.click()
    })
    const row = () => host.querySelector('tbody tr')!
    expect(row().textContent).toContain('Sell')
    expect(row().textContent).toContain('0.0200')
    mocks.wallet = 'taker'
    await act(async () => {
      root.render(<OrderHistory />)
    })
    expect(row().textContent).toContain('Buy')
    expect(row().textContent).toContain('0.0500')
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
