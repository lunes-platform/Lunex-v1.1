import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { SpotPair } from 'services/spotService'

const mocks = vi.hoisted(() => ({
  getBalances: vi.fn(),
  session: 'lxs1.session.token' as string | null
}))
vi.mock('services/spotService', async importOriginal => ({
  ...(await importOriginal<typeof import('services/spotService')>()),
  spotApi: { getBalances: mocks.getBalances }
}))
vi.mock('services/sessionService', () => ({
  getReadSessionToken: () => mocks.session,
  subscribeReadSession: () => () => undefined
}))
import { useSpotBalances } from '../useSpotBalances'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const pair = (over: Partial<SpotPair>): SpotPair => ({
  id: 'p',
  symbol: 'QAX/QUSD',
  baseName: 'QAX',
  quoteName: 'QUSD',
  baseToken: 'base',
  quoteToken: 'quote',
  baseDecimals: 8,
  quoteDecimals: 6,
  isNativeBase: false,
  isNativeQuote: false,
  makerFeeBps: 10,
  takerFeeBps: 25,
  ...over
})

let root: Root | undefined
let host: HTMLDivElement | undefined
let state: ReturnType<typeof useSpotBalances>
function Consumer({ p }: { p: SpotPair }) {
  state = useSpotBalances('wallet', p.symbol, p)
  return null
}
const render = async (p: SpotPair) => {
  if (!host) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  await act(async () => {
    root?.render(<Consumer p={p} />)
  })
}
afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  host = undefined
  root = undefined
  mocks.session = 'lxs1.session.token'
  vi.clearAllMocks()
})

const VAULT = {
  balances: [
    { token: 'base', available: '500' },
    { token: 'quote', available: '5000' },
    { token: '0x' + '00'.repeat(32), available: '2' },
    { token: 'wrapped', available: '99' }
  ]
}

it('reads the spendable vault balances for the pair via the read session', async () => {
  mocks.getBalances.mockResolvedValue(VAULT)
  await render(pair({}))
  expect(mocks.getBalances).toHaveBeenCalledWith('wallet', {
    sessionToken: 'lxs1.session.token'
  })
  expect(state.base).toBe(500)
  expect(state.quote).toBe(5000)
})

it('distinguishes native LUNES from wrapped WLUNES in the vault', async () => {
  mocks.getBalances.mockResolvedValue(VAULT)
  await render(
    pair({ symbol: 'LUNES/QUSD', baseToken: 'wrapped', isNativeBase: true })
  )
  expect(state.base).toBe(2)
  await render(
    pair({ symbol: 'WLUNES/QUSD', baseToken: 'wrapped', isNativeBase: false })
  )
  expect(state.base).toBe(99)
})

it('never prompts the wallet: without a read session balances stay unknown', async () => {
  mocks.session = null
  await render(pair({}))
  expect(mocks.getBalances).not.toHaveBeenCalled()
  expect(state.base).toBeNull()
  expect(state.quote).toBeNull()
})

it('exposes total / locked / available rows for the vault panel', async () => {
  mocks.getBalances.mockResolvedValue({
    balances: [
      { token: 'base', total: '10', locked: '4', available: '6' },
      { token: 'quote', total: '5', locked: '0', available: '5' }
    ]
  })
  await render(pair({}))
  expect(state.baseRow).toEqual({
    token: 'base',
    total: '10',
    locked: '4',
    available: '6'
  })
  expect(state.quoteRow?.available).toBe('5')
})

it('re-fetches when a vault action or order notifies a change', async () => {
  const { notifyVaultChanged } = await import('../../Vault/vaultEvents')
  mocks.getBalances.mockResolvedValue(VAULT)
  await render(pair({}))
  expect(mocks.getBalances).toHaveBeenCalledTimes(1)
  await act(async () => {
    notifyVaultChanged()
  })
  expect(mocks.getBalances).toHaveBeenCalledTimes(2)
})
