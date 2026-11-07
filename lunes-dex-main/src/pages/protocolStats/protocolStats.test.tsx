import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// Live LUNES/LUSDT price (spot ticker) is a network boundary: mock it.
const lunesPrice = vi.hoisted(() => ({ value: null as number | null }))
vi.mock('./useLunesPrice', () => ({
  useLunesUsdPrice: () => ({ price: lunesPrice.value, loading: false })
}))
import ProtocolStats from './index'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// The redesigned page renders the simulator results through AnimatedNumber,
// which counts up over ~900ms unless the user prefers reduced motion. Stub the
// media query (browser boundary) so the final values render immediately.
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList
  )
  lunesPrice.value = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** Displayed USD value of a simulator result row, e.g. "Team monthly revenue". */
function result(label: string): number {
  const span = [...container.querySelectorAll('span')].find(
    s => s.textContent === label
  )
  expect(span, label).toBeTruthy()
  const value = span!.nextElementSibling?.textContent ?? ''
  return Number(value.replace(/[$,]/g, ''))
}

function setSlider(label: string, value: number) {
  const input = container.querySelector(
    `input[aria-label="${label}"]`
  ) as HTMLInputElement
  expect(input, label).toBeTruthy()
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('shows the current Pair fee split and uses it in the revenue simulation', () => {
  act(() => root.render(<ProtocolStats />))
  const text = container.textContent ?? ''

  // Pair contract: 0.5% swap fee = 0.3% LPs / 0.1% protocol / 0.1% stakers.
  expect(text).toContain('0.5% on every swap')
  expect(text).toContain('0.30% · 60%')
  expect(text.match(/0\.10% · 20%/g)).toHaveLength(2)
  expect(text).toMatch(/Trading rewards/i)
  expect(text).not.toContain('requires on-chain contract update')

  // The simulator applies that same split: every extra $1M/day of AMM volume
  // adds 30 days × 0.1% = $30,000 to the team and to stakers, and the full
  // 0.5% ($150,000) to the ecosystem total (the 0.3% LP share included).
  setSlider('Daily AMM volume', 200_000)
  const team0 = result('Team monthly revenue')
  const stakers0 = result('Stakers monthly yield')
  const total0 = result('Total ecosystem monthly')
  setSlider('Daily AMM volume', 1_200_000)
  expect(result('Team monthly revenue') - team0).toBeCloseTo(30_000, -1)
  expect(result('Stakers monthly yield') - stakers0).toBeCloseTo(30_000, -1)
  expect(result('Total ecosystem monthly') - total0).toBeCloseTo(150_000, -1)
})

it('labels the simulator as hypothetical and never assumes a LUNES price (P0-8)', () => {
  act(() => root.render(<ProtocolStats />))
  const disclaimer = container.querySelector('[data-testid="sim-disclaimer"]')
  expect(disclaimer?.textContent).toMatch(/hypothetical/i)
  expect(disclaimer?.textContent).toMatch(/not a\s+projection, forecast or promise/i)
  const text = container.textContent ?? ''
  // the old fixed simulator price must be gone
  expect(text).not.toContain('0.0142')
  expect(container.querySelector('[data-testid="sim-assumptions"]')?.textContent).toMatch(
    /price unavailable/i
  )
  // without a live price, governance votes add nothing (no invented USD value)
  setSlider('Governance votes per day', 0)
  const total0 = result('Total ecosystem monthly')
  setSlider('Governance votes per day', 500)
  expect(result('Total ecosystem monthly')).toBeCloseTo(total0, 0)
})

it('values LUNES-denominated fees at the live LUNES/LUSDT price', () => {
  lunesPrice.value = 0.02
  act(() => root.render(<ProtocolStats />))
  expect(container.querySelector('[data-testid="sim-assumptions"]')?.textContent).toContain('$0.02')
  // +100 votes/day × 30 days × 10 LUNES × $0.02 = +$600 to the ecosystem total
  setSlider('Governance votes per day', 50)
  const total0 = result('Total ecosystem monthly')
  setSlider('Governance votes per day', 150)
  expect(result('Total ecosystem monthly') - total0).toBeCloseTo(600, -1)
})
