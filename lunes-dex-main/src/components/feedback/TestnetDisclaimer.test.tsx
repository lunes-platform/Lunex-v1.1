import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DISCLAIMER_KEY, TestnetDisclaimer } from './TestnetDisclaimer'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const dialog = () => document.body.querySelector('[role="alertdialog"]')
const enter = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Enter the beta') as HTMLButtonElement

it('first visit on testnet: shows the disclaimer with the required statements', () => {
  act(() => root.render(<TestnetDisclaimer network="testnet" />))
  const text = dialog()?.textContent ?? ''
  expect(text).toMatch(/test network/i)
  expect(text).toMatch(/no\s+monetary value/i)
  expect(text).toMatch(/reset/i)
  expect(text).toMatch(/financial, investment or legal\s+advice/i)
  expect(document.body.querySelector('button[aria-label="Close"]')).toBeNull()
})

it('requires the checkbox, then stores acceptance and closes', () => {
  act(() => root.render(<TestnetDisclaimer network="testnet" />))
  expect(enter().disabled).toBe(true)
  act(() => (document.body.querySelector('input[type=checkbox]') as HTMLInputElement).click())
  act(() => enter().click())
  expect(dialog()).toBeNull()
  expect(localStorage.getItem(DISCLAIMER_KEY)).toBeTruthy()
})

it('is not shown again once accepted', () => {
  localStorage.setItem(DISCLAIMER_KEY, '2026-11-07T00:00:00Z')
  act(() => root.render(<TestnetDisclaimer network="testnet" />))
  expect(dialog()).toBeNull()
})

it('is never shown on mainnet', () => {
  act(() => root.render(<TestnetDisclaimer network="mainnet" />))
  expect(dialog()).toBeNull()
})

it('works when localStorage throws (private mode)', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceeded')
  })
  act(() => root.render(<TestnetDisclaimer network="testnet" />))
  expect(dialog()).toBeTruthy()
  act(() => (document.body.querySelector('input[type=checkbox]') as HTMLInputElement).click())
  act(() => enter().click())
  expect(dialog()).toBeNull()
})
