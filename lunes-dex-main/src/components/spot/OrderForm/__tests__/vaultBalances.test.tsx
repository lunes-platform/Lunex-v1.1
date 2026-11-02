import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
const mocks = vi.hoisted(() => ({
  getBalances: vi.fn(),
  sign: vi.fn(),
  selectedPair: 'QAX/QUSD'
}))
vi.mock('context/SpotContext', () => ({
  useSpot: () => ({
    selectedPair: mocks.selectedPair,
    pairs: [
      {
        symbol: 'QAX/QUSD',
        baseToken: 'base',
        quoteToken: 'quote',
        baseDecimals: 8,
        quoteDecimals: 6,
        makerFeeBps: 10,
        takerFeeBps: 25
      },
      {
        symbol: 'LUNES/QUSD',
        baseToken: 'wrapped',
        quoteToken: 'quote',
        isNativeBase: true,
        baseDecimals: 8,
        quoteDecimals: 6,
        makerFeeBps: 10,
        takerFeeBps: 25
      }
    ],
    ticker: { lastPrice: 2 },
    orderbook: { bids: [], asks: [] },
    createOrder: vi.fn(),
    isLoading: false,
    error: null,
    walletAddress: 'wallet',
    selectedPrice: null
  })
}))
vi.mock('context/SDKContext', () => ({
  useSDK: () => ({
    walletAddress: 'wallet',
    connectWallet: vi.fn(),
    signMessage: mocks.sign
  })
}))
vi.mock('services/spotService', async importOriginal => ({
  ...(await importOriginal<typeof import('services/spotService')>()),
  spotApi: { getBalances: mocks.getBalances }
}))
vi.mock('../MarginTab', () => ({ default: () => null }))
import OrderForm from '../index'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})
it('loads signed Spot balances for the selected pair and distinguishes native from wrapped', async () => {
  mocks.sign.mockResolvedValue('0xsigned')
  mocks.getBalances.mockResolvedValue({
    balances: [
      { token: 'base', available: '500' },
      { token: 'quote', available: '5000' },
      { token: '0x' + '00'.repeat(32), available: '2' },
      { token: 'wrapped', available: '99' }
    ]
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(<OrderForm />)
  })
  expect(mocks.sign).not.toHaveBeenCalled()
  const load = [...host.querySelectorAll('button')].find(b =>
    /load spot balance/i.test(b.textContent || '')
  )
  expect(load).toBeDefined()
  await act(async () => {
    load?.click()
  })
  expect(mocks.sign).toHaveBeenCalledWith(
    expect.stringContaining('lunex-auth:balances.list')
  )
  expect(mocks.getBalances).toHaveBeenCalledWith(
    'wallet',
    expect.objectContaining({ signature: '0xsigned' })
  )
  expect(host.textContent).toContain('5000.00 QUSD')
  await act(async () => {
    ;[...host!.querySelectorAll('button')]
      .find(b => b.textContent === 'Sell')
      ?.click()
  })
  expect(host.textContent).toContain('500 QAX')
  mocks.selectedPair = 'LUNES/QUSD'
  await act(async () => {
    root?.render(<OrderForm />)
  })
  expect(host.textContent).toContain('2 LUNES')
  expect(host.textContent).not.toContain('99 LUNES')
})
