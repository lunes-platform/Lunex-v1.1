import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { SpotPair } from 'services/spotService'
import type { TxConfig } from 'context/TxContext'

const { VAULT } = vi.hoisted(() => ({
  VAULT: '5SpotVault1111111111111111111111111111111'
}))

const PSP_PAIR: SpotPair = {
  id: 'p',
  symbol: 'QAX/QUSD',
  baseName: 'QAX',
  quoteName: 'QUSD',
  baseToken: 'base-token',
  quoteToken: 'quote-token',
  baseDecimals: 8,
  quoteDecimals: 6,
  isNativeBase: false,
  isNativeQuote: false,
  makerFeeBps: 10,
  takerFeeBps: 25
}

const mocks = vi.hoisted(() => ({
  mode: null as null | { settlementEnabled: boolean; contractAddress: string | null },
  pair: null as unknown as SpotPair,
  run: vi.fn(),
  rows: {
    baseRow: { token: 'base-token', total: '10', locked: '4', available: '6' },
    quoteRow: { token: 'quote-token', total: '50', locked: '0', available: '50' }
  } as Record<string, unknown>,
  svc: {
    getIsConnected: vi.fn(() => true),
    connect: vi.fn(),
    getNativeBalance: vi.fn(async () => '1000000000'), // 10 LUNES
    getTokenBalance: vi.fn(async () => '100000000'), // 100 QUSD (6 dp)
    spotVaultAllowance: vi.fn(async () => 0n),
    spotVaultApprove: vi.fn(async () => ({ txHash: '0xa', blockHash: '0xb' })),
    spotVaultDepositNative: vi.fn(async () => ({ txHash: '0xd', blockHash: '0xb' })),
    spotVaultDepositPsp22: vi.fn(async () => ({ txHash: '0xd', blockHash: '0xb' })),
    spotVaultWithdrawNative: vi.fn(async () => ({ txHash: '0xw', blockHash: '0xb' })),
    spotVaultWithdrawPsp22: vi.fn(async () => ({ txHash: '0xw', blockHash: '0xb' }))
  }
}))

vi.mock('../../../../config/contracts', async importOriginal => {
  const orig = await importOriginal<typeof import('../../../../config/contracts')>()
  return { ...orig, CONTRACTS: { ...orig.CONTRACTS, SPOT_SETTLEMENT: VAULT } }
})
vi.mock('context/SpotContext', () => ({
  useSpot: () => ({ selectedPair: mocks.pair.symbol, pairs: [mocks.pair] })
}))
vi.mock('context/SDKContext', () => ({
  useSDK: () => ({ walletAddress: 'bob' })
}))
vi.mock('context/TxContext', () => ({ useTx: () => ({ run: mocks.run }) }))
vi.mock('services/contractService', () => ({ contractService: mocks.svc }))
vi.mock('../../OrderForm/useSpotBalances', () => ({
  useSpotBalances: () => ({ base: 6, quote: 50, ...mocks.rows, refresh: () => undefined })
}))
vi.mock('../useSettlementMode', () => ({ useSettlementMode: () => mocks.mode }))

import VaultPanel from '../index'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const mount = async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<VaultPanel />))
}
beforeEach(() => {
  mocks.pair = PSP_PAIR
  mocks.mode = { settlementEnabled: true, contractAddress: VAULT }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

const text = () => container.textContent ?? ''
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
const tab = (group: string, label: string) =>
  Array.from(
    container.querySelectorAll(`[role="tablist"][aria-label="${group}"] [role="tab"]`)
  ).find(b => b.textContent === label)
const setAmount = async (value: string) => {
  const input = container.querySelector('input') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const cta = () => {
  const btns = Array.from(container.querySelectorAll('button'))
  return btns[btns.length - 1] as HTMLButtonElement
}
const lastRun = () => mocks.run.mock.calls.at(-1)?.[0] as TxConfig

describe('VaultPanel gate', () => {
  it('shows available and locked per token of the pair', async () => {
    await mount()
    expect(text()).toContain('QAX6 avail · 4 locked')
    expect(text()).toContain('QUSD50 avail · 0 locked')
  })

  it('disables vault actions and says so when settlement is off-chain only', async () => {
    mocks.mode = { settlementEnabled: false, contractAddress: null }
    await mount()
    expect(text()).toContain('NOT settled on chain')
    expect(container.querySelector('input')).toBeNull()
  })

  it('blocks a vault the backend does not settle against', async () => {
    mocks.mode = { settlementEnabled: true, contractAddress: '5Other' }
    await mount()
    expect(text()).toContain('different spot vault')
    expect(container.querySelector('input')).toBeNull()
  })
})

describe('VaultPanel deposit', () => {
  it('PSP22: approves EXACTLY the amount, then deposits, each step resolving on finality', async () => {
    await mount()
    await setAmount('12.5')
    await click(cta())
    const cfg = lastRun()
    expect(cfg.steps.map(s => s.label)).toEqual([
      'Approve exactly 12.5 QUSD for the spot vault',
      'Deposit 12.5 QUSD into the spot vault'
    ])
    for (const s of cfg.steps) await s.run?.({ advance: () => undefined })
    expect(mocks.svc.spotVaultApprove).toHaveBeenCalledWith(
      'bob',
      'quote-token',
      '12500000'
    )
    expect(mocks.svc.spotVaultDepositPsp22).toHaveBeenCalledWith(
      'bob',
      'quote-token',
      '12500000'
    )
  })

  it('PSP22: skips approve when the allowance already covers the amount', async () => {
    mocks.svc.spotVaultAllowance.mockResolvedValueOnce(12_500_000n)
    await mount()
    await setAmount('12.5')
    await click(cta())
    expect(lastRun().steps.map(s => s.label)).toEqual([
      'Deposit 12.5 QUSD into the spot vault'
    ])
  })

  it('native LUNES: one payable deposit_native step, Max keeps a gas reserve', async () => {
    mocks.pair = {
      ...PSP_PAIR,
      symbol: 'LUNES/QUSD',
      baseName: 'LUNES',
      isNativeBase: true
    }
    await mount()
    await click(tab('Vault token', 'LUNES'))
    await act(async () => undefined)
    const max = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Max'
    )
    await click(max)
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(
      '9.9'
    )
    await click(cta())
    const cfg = lastRun()
    expect(cfg.steps).toHaveLength(1)
    await cfg.steps[0].run?.({ advance: () => undefined })
    expect(mocks.svc.spotVaultDepositNative).toHaveBeenCalledWith('bob', '990000000')
    expect(mocks.svc.spotVaultApprove).not.toHaveBeenCalled()
  })

  it('rejects an amount above the wallet balance before any wallet prompt', async () => {
    await mount()
    await setAmount('101')
    expect(cta().disabled).toBe(true)
    expect(cta().textContent).toMatch(/wallet balance/i)
  })
})

describe('VaultPanel withdraw', () => {
  it('caps withdrawals at the AVAILABLE balance (locked stays for open orders)', async () => {
    await mount()
    await click(tab('Vault action', 'Withdraw'))
    await click(tab('Vault token', 'QAX'))
    await setAmount('7')
    expect(cta().disabled).toBe(true)
    await setAmount('6')
    expect(cta().disabled).toBe(false)
    await click(cta())
    const cfg = lastRun()
    await cfg.steps[0].run?.({ advance: () => undefined })
    expect(mocks.svc.spotVaultWithdrawPsp22).toHaveBeenCalledWith(
      'bob',
      'base-token',
      '600000000'
    )
  })
})
