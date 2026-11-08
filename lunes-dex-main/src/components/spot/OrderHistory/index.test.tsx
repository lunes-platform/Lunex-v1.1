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
  useSDK: () => ({ signMessage: vi.fn(), walletAddress: mocks.wallet })
}))
vi.mock('context/TxContext', () => ({ useTx: () => ({ run: vi.fn() }) }))
vi.mock('hooks/useReadSession', () => ({
  useReadSession: () => ({ hasSession: true })
}))
import OrderHistory from './index'
import { SpotTerminalProvider } from '../terminal'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it('shows each wallet its own side and fee for the same settled trade', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  // a fresh element each render so React re-reads the wallet from context
  const ui = () => (
    <SpotTerminalProvider>
      <OrderHistory />
    </SpotTerminalProvider>
  )
  // The trade row is the grid that holds the pair symbol (not the header).
  const row = () => {
    const pair = [...host.querySelectorAll('span')].find(
      s => s.textContent === 'QAX/QUSD'
    )
    expect(pair, 'trade row').toBeTruthy()
    return pair!.parentElement!
  }
  const cells = () => [...row().children].map(c => c.textContent)
  const feeCell = () =>
    [...row().children].find(c => c.getAttribute('title')) as HTMLElement
  try {
    await act(async () => {
      root.render(ui())
    })
    await act(async () => {
      ;[...host.querySelectorAll('[role="tab"]')]
        .find(b => b.textContent === 'Trade history')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Maker of a BUY-taker trade sold; it pays the maker fee.
    expect(cells()).toEqual(
      expect.arrayContaining(['Sell', '0.02'])
    )
    expect(cells()).not.toContain('Buy')
    expect(feeCell().textContent).toBe('0.02')
    expect(feeCell().getAttribute('title')).toMatch(/^Maker fee split/)

    mocks.wallet = 'taker'
    await act(async () => {
      root.render(ui())
    })
    // The taker sees the trade's own side and pays the taker fee.
    expect(cells()).toEqual(expect.arrayContaining(['Buy', '0.05']))
    expect(cells()).not.toContain('Sell')
    expect(feeCell().textContent).toBe('0.05')
    expect(feeCell().getAttribute('title')).toMatch(/^Taker fee split/)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
