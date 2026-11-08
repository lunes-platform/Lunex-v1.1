import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../../context/useContext'
import Home from './index'

// Swap quote state on the redesigned Swap screen (pages/home + hooks/useSwap).
// Real AppProvider (token selection / amount), real useSwap, real token picker
// and review dialog. Mocked boundaries only: the SDK (chain), the tx runner
// (TxProvider → runs the steps in order), the token registry (env-driven) and
// the spot price API.

const mocks = vi.hoisted(() => {
  const native = {
    id: -1,
    icon: '',
    tokenPrice: '',
    address: 'native',
    acronym: 'LUNES',
    token: 'Lunes',
    decimals: 8,
    isNative: true
  }
  const wrapped = {
    id: 0,
    icon: '',
    tokenPrice: '',
    address: 'wrapped',
    acronym: 'WLUNES',
    token: 'Wrapped Lunes',
    decimals: 8
  }
  const usd = {
    id: 1,
    icon: '',
    tokenPrice: '',
    address: 'usd',
    acronym: 'LUSDT',
    token: 'Lunes USD',
    decimals: 6
  }
  const btc = {
    id: 2,
    icon: '',
    tokenPrice: '',
    address: 'btc',
    acronym: 'LBTC',
    token: 'Bitcoin',
    decimals: 8
  }
  return {
    tokens: [native, usd, btc],
    all: [native, usd, btc, wrapped],
    sdk: {} as any,
    txRuns: [] as any[]
  }
})

vi.mock('../../context/SDKContext', () => ({ useSDK: () => mocks.sdk }))
vi.mock('../../context/TxContext', () => ({
  useTx: () => ({
    run: async (cfg: any) => {
      mocks.txRuns.push(cfg)
      for (const step of cfg.steps) await step.run?.({ advance: () => {} })
      cfg.onSuccess?.()
    }
  })
}))
vi.mock('./modals/chooseToken/tokenRegistry', () => ({
  default: mocks.tokens,
  searchableTokens: mocks.all
}))
vi.mock('services/spotService', async importOriginal => ({
  ...(await importOriginal<typeof import('services/spotService')>()),
  spotApi: {
    getPairs: async () => [],
    getTicker: async () => null
  }
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root

function format(raw: string, decimals: number) {
  return String(Number(raw) / 10 ** decimals)
}

beforeEach(() => {
  vi.useFakeTimers()
  try {
    localStorage.clear() // persisted slippage / deadline
  } catch {
    /* storage unavailable */
  }
  mocks.txRuns = []
  Object.assign(mocks.sdk, {
    isConnected: true,
    isLoading: false,
    walletAddress: 'bob',
    error: null,
    getQuote: vi.fn().mockResolvedValue({
      amountOut: '2000000',
      executionPrice: '2',
      priceImpact: '0.5',
      minimumReceived: '1990000'
    }),
    parseAmount: (amount: string, decimals: number) =>
      String(Math.round(Number(amount) * 10 ** decimals)),
    formatAmount: format,
    calculateMinAmount: (amount: string, slippage: number) =>
      String(
        (BigInt(amount) * BigInt(Math.floor((100 - slippage) * 100))) / 10000n
      ),
    calculateDeadline: () => 9999999999,
    getNativeBalance: vi.fn().mockResolvedValue('10000000000'),
    getTokenBalance: vi
      .fn()
      .mockImplementation((address: string) =>
        Promise.resolve(address === 'wrapped' ? '500000000' : '10000000')
      ),
    executeSwap: vi.fn().mockResolvedValue(true)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <AppProvider>
          <Home />
        </AppProvider>
      </MemoryRouter>
    )
  )
}
/** Buttons of the page and of portalled dialogs (token picker, review). */
const buttons = () =>
  Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]
async function press(button: HTMLButtonElement | undefined, name: string) {
  expect(button, name).toBeDefined()
  await act(async () => button!.click())
}
async function click(text: string) {
  await press(
    buttons().find(b => b.textContent === text),
    text
  )
}
/** Pick the output token: open the "to" pill, then the token row. */
async function choose(symbol: string, current?: string) {
  const pill = current ? `Change token, ${current}` : 'Select a token'
  await press(
    buttons().find(b => b.getAttribute('aria-label') === pill),
    pill
  )
  await press(
    buttons().find(
      b =>
        b.getAttribute('role') === 'option' &&
        b.textContent?.startsWith(symbol)
    ),
    `token row ${symbol}`
  )
}
async function setValue(el: Element, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function input(value: string) {
  await setValue(
    container.querySelector('input[aria-label="Amount to pay"]')!,
    value
  )
}
async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}
/** Estimated output shown in "You receive" ('0' when there is no quote). */
function output() {
  return container.querySelector('[aria-live="polite"]')!.textContent
}
function swapEnabled() {
  return buttons().some(
    b => b.textContent?.startsWith('Review swap') && !b.disabled
  )
}
function detail(label: string) {
  const row = Array.from(container.querySelectorAll('span')).find(
    s => s.textContent === label
  )?.parentElement
  return row?.lastElementChild?.textContent
}

describe('Swap quote state', () => {
  it('clears the estimated output when the amount is cleared', async () => {
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    expect(output()).toBe('2')
    expect(swapEnabled()).toBe(true)
    await input('')
    await debounce()
    expect(output()).toBe('0')
    expect(detail('Minimum received')).toBeUndefined()
    expect(swapEnabled()).toBe(false)
  })

  it('invalidates the old quote immediately and keeps it cleared if the next pair has no quote', async () => {
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    expect(output()).toBe('2')
    mocks.sdk.getQuote.mockResolvedValue(null)
    await choose('LBTC', 'LUSDT')
    expect(swapEnabled()).toBe(false)
    expect(output()).toBe('0')
    await debounce()
    expect(output()).toBe('0')
    expect(swapEnabled()).toBe(false)
  })

  it('ignores an earlier quote that resolves after the current quote', async () => {
    let resolveOld!: (value: any) => void
    mocks.sdk.getQuote.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOld = resolve
        })
    )
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    await input('2')
    await debounce()
    expect(output()).toBe('2')
    await act(async () =>
      resolveOld({
        amountOut: '99000000',
        executionPrice: '99',
        priceImpact: '1',
        minimumReceived: '98000000'
      })
    )
    expect(output()).toBe('2')
  })

  it('loads the wrapped token balance even though it is only shown by search', async () => {
    await mount()
    await choose('WLUNES')
    expect(mocks.sdk.getTokenBalance).toHaveBeenCalledWith('wrapped', 'bob')
    expect(container.textContent).toContain('Balance: 5')
  })

  it('uses the selected slippage for both preview and the transaction minimum', async () => {
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    await press(
      buttons().find(b => b.getAttribute('aria-label') === 'Swap settings'),
      'Swap settings'
    )
    await setValue(
      container.querySelector('input[aria-label="Custom slippage"]')!,
      '2'
    )
    // preview: 2 LUSDT out, 2% slippage → at least 1.96 LUSDT
    expect(detail('Slippage tolerance')).toBe('2%')
    expect(detail('Minimum received')).toBe('1.96 LUSDT')
    await click('Review swap')
    expect(document.body.textContent).toContain('at least 1.96 LUSDT')
    await click('Confirm swap')
    expect(mocks.txRuns).toHaveLength(1)
    expect(mocks.sdk.executeSwap).toHaveBeenCalledTimes(1)
    expect(mocks.sdk.executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({ amountIn: '100000000', amountOutMin: '1960000' })
    )
  })
})
