import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useLiquidity from './useLiquidity'

const mocks = vi.hoisted(() => ({ sdk: {} as any }))
vi.mock('../context/SDKContext', () => ({
  useSDK: () => mocks.sdk,
  parseBlockchainError: (e: Error) => e.message
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
let state: ReturnType<typeof useLiquidity>
function Consumer() {
  state = useLiquidity()
  return null
}
beforeEach(async () => {
  Object.assign(mocks.sdk, {
    walletAddress: 'bob',
    isLoading: false,
    error: null,
    getPairInfo: vi.fn().mockResolvedValue({
      address: 'pair',
      reserve0: '20000000000',
      reserve1: '10000000000',
      totalSupply: '10000000000'
    }),
    getPairToken0: vi.fn().mockResolvedValue('usd'),
    getTokenBalance: vi.fn().mockResolvedValue('100000000'),
    parseAmount: (s: string, d: number) =>
      String(Math.round(Number(s) * 10 ** d)),
    formatAmount: (s: string, d: number) => String(Number(s) / 10 ** d),
    calculateMinAmount: (s: string) => String((BigInt(s) * 995n) / 1000n),
    calculateDeadline: () => 9999999999,
    removeLiquidity: vi.fn().mockResolvedValue(true)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Consumer />))
  await act(async () => {
    state.setTokenA({
      address: 'wrapped',
      symbol: 'WLUNES',
      name: 'Wrapped',
      decimals: 8
    })
    state.setTokenB({
      address: 'usd',
      symbol: 'LUSDT',
      name: 'USD',
      decimals: 6
    })
  })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('quotes the deposit in selected token order when token A is canonical token1', async () => {
  await act(async () => state.setAmountA('1'))
  expect(state.amountB).toBe('200')
})
it('assigns withdrawal minimums to their matching token when reserves are reversed', async () => {
  await act(async () => {
    await state.removeLiquidity('1')
  })
  expect(mocks.sdk.removeLiquidity).toHaveBeenCalledWith(
    expect.objectContaining({
      tokenA: 'wrapped',
      tokenB: 'usd',
      liquidity: '100000000',
      amountAMin: '99500000',
      amountBMin: '199000000'
    })
  )
})

it('refreshes the LP balance when the wallet disconnects and reconnects', async () => {
  expect(state.poolInfo?.lpBalance).toBe('100000000')
  mocks.sdk.walletAddress = null
  await act(async () => root.render(<Consumer />))
  expect(state.poolInfo?.lpBalance).toBe('0')
  mocks.sdk.walletAddress = 'bob'
  await act(async () => root.render(<Consumer />))
  expect(state.poolInfo?.lpBalance).toBe('100000000')
})
