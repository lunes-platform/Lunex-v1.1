import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePools } from './usePools'

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  token0: vi.fn()
}))
vi.mock('../context/SDKContext', () => ({
  useSDK: () => ({ walletAddress: null })
}))
vi.mock('../config/contracts', () => ({
  CONTRACTS: { FACTORY: 'factory', ROUTER: 'router', WNATIVE: 'wrapped' },
  TOKENS: { LETH: 'leth', LUSDT: 'usd' }
}))
vi.mock('../services/contractService', () => ({
  contractService: {
    getIsConnected: () => true,
    setContracts: vi.fn(),
    allPairsLength: async () => 1,
    allPairs: async () => 'pair',
    getReserves: async () => ({
      reserve0: '10000000000',
      reserve1: '300000000000'
    }),
    getPairToken0: mocks.token0,
    getPairToken1: async () => 'usd',
    getPairTotalSupply: async () => '1000000',
    getTokenInfo: mocks.metadata
  }
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let state: ReturnType<typeof usePools>
function Consumer() {
  state = usePools()
  return null
}
beforeEach(() => {
  mocks.token0.mockResolvedValue('leth')
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('reads LETH precision from on-chain metadata instead of assuming Ethereum decimals', async () => {
  mocks.metadata.mockImplementation(async (address: string) => ({
    symbol: '[object Object]',
    name: '[object Object]',
    decimals: address === 'leth' ? 8 : 6
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ symbol: 'LETH/LUSDT', volume24h: 1000 }]
    })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Consumer />))
  expect(mocks.metadata).toHaveBeenCalledWith('leth')
  expect(state.pools[0].token0.decimals).toBe(8)
  expect(state.pools[0].token1.decimals).toBe(6)
  expect(state.pools[0].token0.symbol).toBe('LETH')
  expect(state.pools[0].token0.name).toBe('Lunes ETH')
  expect(state.pools[0].token1.symbol).toBe('LUSDT')
  expect(state.pools[0].liquidity).toBe(600000)
  expect(state.pools[0].fee).toBe('0.5%')
  expect(state.pools[0].fees24h).toBe(3)
})

it('keeps on-chain labels and precision for tokens outside the registry', async () => {
  mocks.token0.mockResolvedValueOnce('unknown')
  mocks.metadata.mockImplementation(async (address: string) => ({
    symbol: address === 'unknown' ? 'COMMUNITY' : 'LUSDT',
    name: address === 'unknown' ? 'Community Token' : 'USD',
    decimals: address === 'unknown' ? 12 : 6
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Consumer />))
  expect(state.pools[0].token0.symbol).toBe('COMMUNITY')
  expect(state.pools[0].token0.name).toBe('Community Token')
  expect(state.pools[0].token0.decimals).toBe(12)
})
