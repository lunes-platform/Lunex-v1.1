import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ThemeProvider } from 'styled-components'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../theme'
import { AppProvider } from '../../context/useContext'
import Home from './index'

const mocks = vi.hoisted(() => {
  const nativeAddress = 'native'
  const native = {
    id: -1,
    address: nativeAddress,
    acronym: 'LUNES',
    token: 'Lunes',
    decimals: 8
  }
  const wrapped = {
    id: 0,
    address: 'wrapped',
    acronym: 'WLUNES',
    token: 'Wrapped Lunes',
    decimals: 8
  }
  const usd = {
    id: 1,
    address: 'usd',
    acronym: 'LUSDT',
    token: 'Lunes USD',
    decimals: 6
  }
  const btc = {
    id: 2,
    address: 'btc',
    acronym: 'LBTC',
    token: 'Bitcoin',
    decimals: 8
  }
  return {
    tokens: [native, usd, btc],
    all: [native, usd, btc, wrapped],
    sdk: {} as any
  }
})

vi.mock('../../context/SDKContext', () => ({ useSDK: () => mocks.sdk }))
vi.mock('./modals/chooseToken/tokenRegistry', () => ({
  default: mocks.tokens,
  searchableTokens: mocks.all
}))
vi.mock('./tabBar', () => ({ default: () => null }))
vi.mock('components/FooterTag', () => ({ default: () => null }))
vi.mock('../../components/tradeSubNav', () => ({
  default: ({ onSettingsClick }: any) => (
    <button onClick={onSettingsClick}>Settings</button>
  )
}))
vi.mock('./modals', () => ({
  ChooseToken: ({ tokens, onSelect }: any) => (
    <div>
      {tokens.map((t: any) => (
        <button key={t.id} onClick={() => onSelect(t)}>
          Choose {t.acronym}
        </button>
      ))}
    </div>
  ),
  TransactionSetting: ({ onSave }: any) => (
    <button onClick={() => onSave(2, 20)}>Save 2%</button>
  ),
  WaitingConfirmation: () => <div>Signing</div>,
  TransactionSubmitted: () => <div>Submitted</div>,
  ConfirmSwap: () => null,
  ModalError: () => <div>Transaction failed</div>
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root

function format(raw: string, decimals: number) {
  return String(Number(raw) / 10 ** decimals)
}

beforeEach(() => {
  vi.useFakeTimers()
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
      <ThemeProvider theme={theme}>
        <AppProvider>
          <Home />
        </AppProvider>
      </ThemeProvider>
    )
  )
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    b => b.textContent === text
  )
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}
async function choose(symbol: string, current = 'Select a token') {
  await click(current)
  await click(`Choose ${symbol}`)
}
async function input(value: string) {
  const el = container.querySelector('input#swap-from-amount')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}
function output() {
  return (container.querySelector('input#swap-to-amount') as HTMLInputElement)
    .value
}
function swapEnabled() {
  return Array.from(container.querySelectorAll('button')).some(
    b => b.textContent === 'Swap tokens' && !b.disabled
  )
}

describe('Swap quote state', () => {
  it('clears the estimated output when the amount is cleared', async () => {
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    expect(output()).toBe('2')
    await input('')
    await debounce()
    expect(output()).toBe('')
    expect(swapEnabled()).toBe(false)
  })

  it('invalidates the old quote immediately and keeps it cleared if the next pair has no quote', async () => {
    await mount()
    await choose('LUSDT')
    await input('1')
    await debounce()
    mocks.sdk.getQuote.mockResolvedValue(null)
    await choose('LBTC', 'LUSDT')
    expect(swapEnabled()).toBe(false)
    expect(output()).toBe('')
    await debounce()
    expect(output()).toBe('')
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
    await click('Settings')
    await click('Save 2%')
    expect(container.textContent).toContain('1.96 LUSDT')
    await click('Swap tokens')
    expect(mocks.sdk.executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({ amountOutMin: '1960000' })
    )
  })
})
