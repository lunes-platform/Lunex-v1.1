import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
const mocks = vi.hoisted(() => ({
  getTicker: vi.fn(),
  subscribe: vi.fn(),
  sign: vi.fn(),
  createOrder: vi.fn()
}))
vi.mock('./SDKContext', () => ({
  useSDK: () => ({ walletAddress: 'wallet', signMessage: mocks.sign })
}))
vi.mock('../services/spotService', () => ({
  spotApi: {
    getPairs: async () => [{ symbol: 'QAX/QUSD' }],
    getTicker: mocks.getTicker,
    createOrder: mocks.createOrder,
    getOrderbook: async () => ({ bids: [], asks: [] }),
    getRecentTrades: async () => ({ trades: [] })
  },
  spotWs: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: mocks.subscribe,
    unsubscribe: vi.fn()
  }
}))
import { SpotProvider, useSpot } from './SpotContext'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let current: ReturnType<typeof useSpot>
function Probe() {
  current = useSpot()
  return <div>{current.selectedPair}</div>
}
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
it('chooses a registered pair without requests to an absent default or forbidden private channels', async () => {
  mocks.getTicker.mockResolvedValue({ lastPrice: 2 })
  await act(async () => {
    root.render(
      <SpotProvider>
        <Probe />
      </SpotProvider>
    )
    await Promise.resolve()
  })
  expect(host.textContent).toBe('QAX/QUSD')
  expect(mocks.getTicker).toHaveBeenCalledWith('QAX/QUSD')
  expect(mocks.getTicker).not.toHaveBeenCalledWith('WLUNES/LUSDT')
  expect(
    mocks.subscribe.mock.calls.some(([channel]) => channel.startsWith('user:'))
  ).toBe(false)
  expect(mocks.sign).not.toHaveBeenCalled()
  mocks.sign.mockResolvedValue('0xsigned')
  mocks.createOrder.mockResolvedValue({ order: { id: 'created' } })
  const expiresAt = '2026-10-18T18:00:00.000Z'
  await act(async () => {
    await current.createOrder({
      pairSymbol: 'QAX/QUSD',
      side: 'BUY',
      type: 'LIMIT',
      price: '2',
      amount: '1',
      timeInForce: 'FOK',
      expiresAt,
      signMessage: mocks.sign
    })
  })
  expect(mocks.sign).toHaveBeenCalledWith(
    expect.stringContaining(':FOK:1792346400000')
  )
  expect(mocks.createOrder).toHaveBeenCalledWith(
    expect.objectContaining({
      timeInForce: 'FOK',
      expiresAt,
      signature: '0xsigned'
    })
  )
})
