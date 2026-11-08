import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { SpotPair } from 'services/spotService'

// Beta gates on the order form:
//  - the Margin tab is DB-only collateral → hidden unless REACT_APP_FEATURE_MARGIN
//  - when spot-api does not settle on-chain the form says so explicitly
const PAIR: SpotPair = {
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
  takerFeeBps: 25
}

const mocks = vi.hoisted(() => ({
  mode: null as null | { settlementEnabled: boolean; contractAddress: string | null }
}))

vi.mock('context/SpotContext', () => ({
  useSpot: () => ({
    selectedPair: 'QAX/QUSD',
    pairs: [PAIR],
    ticker: { symbol: 'QAX/QUSD', lastPrice: 1 },
    orderbook: { bids: [], asks: [] },
    refreshOrders: async () => undefined
  })
}))
vi.mock('context/SDKContext', () => ({
  useSDK: () => ({ walletAddress: 'bob', signMessage: async () => '0xsig' })
}))
vi.mock('context/TxContext', () => ({ useTx: () => ({ run: () => undefined }) }))
vi.mock('../useSpotBalances', () => ({
  useSpotBalances: () => ({ base: 1, quote: 1, refresh: () => undefined })
}))
vi.mock('../MarginTab', () => ({ default: () => <div>MARGIN-TAB</div> }))
vi.mock('../../Vault', () => ({ default: () => <div>VAULT-PANEL</div> }))
vi.mock('../../Vault/useSettlementMode', () => ({
  useSettlementMode: () => mocks.mode
}))

import OrderForm from '../index'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const mount = () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<OrderForm />))
}
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  mocks.mode = null
})
const tabs = () =>
  Array.from(
    container.querySelectorAll('[role="tablist"][aria-label="Order type"] [role="tab"]')
  ).map(b => b.textContent)

describe('OrderForm beta gates', () => {
  it('hides the DB-only Margin tab by default', () => {
    mount()
    expect(tabs()).toEqual(['Limit', 'Market', 'Stop', 'Stop-Limit'])
    expect(container.textContent).not.toContain('MARGIN-TAB')
  })

  it('renders the spot vault panel with the form', () => {
    mount()
    expect(container.textContent).toContain('VAULT-PANEL')
  })

  it('warns when orders are not settled on chain', () => {
    mocks.mode = { settlementEnabled: false, contractAddress: null }
    mount()
    expect(container.textContent).toContain(
      'Orders are not settled on chain in this environment.'
    )
  })

  it('shows no warning when settlement is on-chain', () => {
    mocks.mode = { settlementEnabled: true, contractAddress: 'v' }
    mount()
    expect(container.textContent).not.toContain('not settled on chain')
  })
})
