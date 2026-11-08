import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CurveChart, { GAMMA_LABELS } from '../CurveChart'
import type { CurveSide } from '../CurveChart'
import { PRESETS } from '../StrategyCards'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// Characterization tests for the Asymmetric Liquidity curve preview.
//
// The redesign removed the old pure math module (`simulateLiquidity`,
// `buildChartData`, `STRATEGY_TEMPLATES`). The curve math now lives inside
// `CurveChart` (SVG preview, y ∝ (1 − t)^γ, height ∝ k, width ∝ x0) and the
// templates are `PRESETS` in `StrategyCards`. These tests lock what the user
// sees in that preview: the plotted curve, its edge cases and the presets.
//
// NOTE: the old model also discounted fees (feeT·x) and leverage interest from
// the preview liquidity. The new preview no longer models those terms — see
// the test report; there is nothing left to assert for them.

// Chart geometry (CurveChart.tsx): viewBox 300×160, centre x = 150,
// baseline y = 150, max curve height 130, 31 points per side, max cap 50k.
const MID = 150
const BASE_Y = 150
const HEIGHT = 130

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(buy: CurveSide, sell: CurveSide, price?: number) {
  act(() =>
    root.render(
      React.createElement(CurveChart, { buy, sell, pairLabel: 'WLUNES/LUSDT', price })
    )
  )
}

/** Plotted [x, y] points of the buy (0) or sell (1) curve. */
function curve(side: 0 | 1): [number, number][] {
  const lines = container.querySelectorAll('polyline')
  expect(lines).toHaveLength(2)
  return lines[side]
    .getAttribute('points')!
    .split(' ')
    .map(p => p.split(',').map(Number) as [number, number])
}

const dip = PRESETS.find(p => p.id === 'dip')!

describe('CurveChart preview curve', () => {
  it('plots 31 points per side, buy to the left and sell to the right of the current price', () => {
    render(dip.buy, dip.sell)
    const buy = curve(0)
    const sell = curve(1)
    expect(buy).toHaveLength(31)
    expect(sell).toHaveLength(31)
    expect(buy[0][0]).toBe(MID)
    expect(sell[0][0]).toBe(MID)
    expect(buy.every(([x]) => x <= MID)).toBe(true)
    expect(sell.every(([x]) => x >= MID)).toBe(true)
  })

  it('starts the larger side at full height and the other proportionally to k', () => {
    // dip: buy k=1000 (larger), sell k=200 → sell peaks at 20% of the height
    render(dip.buy, dip.sell)
    expect(curve(0)[0][1]).toBeCloseTo(BASE_Y - HEIGHT, 1)
    expect(curve(1)[0][1]).toBeCloseTo(BASE_Y - HEIGHT * 0.2, 1)
  })

  it('follows the curvature γ: liquidity at 30% of the range is (0.7)^γ of the base', () => {
    // point i = 9 → t = 0.3.  buy γ3: 130·0.343 = 44.59 → y 105.41
    //                         sell γ1: 26·0.7  = 18.2  → y 131.8
    render(dip.buy, dip.sell)
    expect(curve(0)[9][1]).toBeCloseTo(BASE_Y - HEIGHT * Math.pow(0.7, 3), 1)
    expect(curve(1)[9][1]).toBeCloseTo(BASE_Y - HEIGHT * 0.2 * 0.7, 1)
  })

  it('is fully exhausted (back on the baseline) at the end of the capacity range', () => {
    render(dip.buy, dip.sell)
    expect(curve(0)[30][1]).toBe(BASE_Y)
    expect(curve(1)[30][1]).toBe(BASE_Y)
  })

  it('widens the curve with the max capacity (x0)', () => {
    // span = 150 · (x0 / 50000 · 0.5 + 0.5): buy 10k → 90, sell 4k → 81
    render(dip.buy, dip.sell)
    expect(curve(0)[30][0]).toBeCloseTo(MID - 90, 1)
    expect(curve(1)[30][0]).toBeCloseTo(MID + 81, 1)
  })

  it('never plots NaN for empty sides (k = 0, x0 = 0)', () => {
    render({ k: 0, x0: 0, g: 1 }, { k: 0, x0: 0, g: 5 })
    for (const side of [0, 1] as const) {
      for (const [x, y] of curve(side)) {
        expect(Number.isFinite(x)).toBe(true)
        expect(y).toBe(BASE_Y)
      }
    }
  })

  it('labels the gammas and the ±20% price axis around the current price', () => {
    render(dip.buy, dip.sell, 0.5)
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Buy curve γ3, sell curve γ1'
    )
    const text = container.textContent ?? ''
    expect(text).toContain('0.4')
    expect(text).toContain('Current 0.5')
    expect(text).toContain('0.6')
  })
})

describe('PRESETS (strategy templates)', () => {
  it('exposes exactly the three named templates', () => {
    expect(PRESETS).toHaveLength(3)
    expect(PRESETS.map(t => t.name)).toEqual([
      'Buy the Dip',
      'Take Profit Gradually',
      'Stablecoin Range'
    ])
  })

  it('keeps every gamma within the supported [1, 5] range and k/x0 positive', () => {
    for (const template of PRESETS) {
      for (const side of [template.buy, template.sell]) {
        expect(side.g).toBeGreaterThanOrEqual(1)
        expect(side.g).toBeLessThanOrEqual(5)
        expect(Number.isInteger(side.g)).toBe(true)
        expect(GAMMA_LABELS[side.g]).toBeTruthy()
        expect(side.k).toBeGreaterThan(0)
        expect(side.x0).toBeGreaterThan(0)
      }
    }
  })

  it('stays inside the ranges the page controls can represent (k 100–5000, x0 1k–50k)', () => {
    for (const template of PRESETS) {
      for (const side of [template.buy, template.sell]) {
        expect(side.k).toBeGreaterThanOrEqual(100)
        expect(side.k).toBeLessThanOrEqual(5000)
        expect(side.x0).toBeGreaterThanOrEqual(1000)
        expect(side.x0).toBeLessThanOrEqual(50000)
      }
      expect(template.feeBps).toBeGreaterThan(0)
      expect(template.profitTargetBps).toBeGreaterThan(0)
    }
  })
})
