import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = { status: 'testnet' as string }
vi.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ status: state.status, switchNetwork: vi.fn() })
}))
vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }))
vi.mock('../../config/contracts', () => ({ NETWORK: { name: 'testnet' } }))

import SystemBanner from './SystemBanner'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = () =>
  act(() =>
    root.render(
      <MemoryRouter>
        <SystemBanner />
      </MemoryRouter>
    )
  )

it('shows the testnet notice with a faucet link on non-mainnet', () => {
  state.status = 'testnet'
  render()
  const bar = container.querySelector('[data-testid="testnet-banner"]')
  expect(bar?.textContent).toMatch(/no real value/i)
  expect(bar?.querySelector('a')?.getAttribute('href')).toBe('/faucet')
})

it('keeps the testnet notice visible while a degraded banner is shown', () => {
  state.status = 'degraded'
  render()
  expect(container.textContent).toMatch(/Network congestion/)
  expect(container.querySelector('[data-testid="testnet-banner"]')).toBeTruthy()
})

it('testnet notice is dismissable for the session only (sessionStorage, not localStorage)', () => {
  state.status = 'testnet'
  render()
  const x = container.querySelector('button[aria-label^="Hide testnet"]') as HTMLButtonElement
  act(() => x.click())
  expect(container.querySelector('[data-testid="testnet-banner"]')).toBeNull()
  expect(sessionStorage.getItem('lunex-testnet-banner-dismissed')).toBe('1')
  expect(localStorage.length).toBe(0)
})

it('wrong network banner is an alert and cannot be dismissed', () => {
  state.status = 'wrong'
  render()
  const alert = container.querySelector('[role="alert"]')
  expect(alert?.textContent).toMatch(/Wrong network/)
  expect(alert?.querySelector('button[aria-label="Dismiss"]')).toBeNull()
})
