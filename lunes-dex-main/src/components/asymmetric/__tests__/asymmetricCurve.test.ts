import { describe, it, expect } from 'vitest'
import { simulateLiquidity, buildChartData } from '../CurveChart'
import type { CurveParams } from '../CurveChart'
import { STRATEGY_TEMPLATES } from '../StrategyCards'

// Characterization tests for the Asymmetric Liquidity curve math.
//
// These mirror the page defaults (AsymmetricPool `defaultBuy` / `defaultSell`)
// and lock the exact "Liquidity @ 30%" preview values shown in the UI, plus the
// edge-case guards in simulateLiquidity.

const defaultBuy: CurveParams = {
  k: 1000,
  L: 0,
  c: 0.5,
  x0: 10000,
  gamma: 3,
  feeT: 0.003,
  interestR: 0
}
const defaultSell: CurveParams = {
  k: 500,
  L: 0,
  c: 0.5,
  x0: 8000,
  gamma: 2,
  feeT: 0.003,
  interestR: 0
}

describe('simulateLiquidity', () => {
  it('reproduces the Buy @30% preview value (334.00)', () => {
    // x = 30% of capacity = 3000.  base=1000, (0.7)^3=0.343 → 343 − 0.003·3000=9
    const midBuy = simulateLiquidity(defaultBuy.x0 * 0.3, defaultBuy)
    expect(midBuy.toFixed(2)).toBe('334.00')
  })

  it('reproduces the Sell @30% preview value (237.80)', () => {
    // x = 30% of capacity = 2400.  base=500, (0.7)^2=0.49 → 245 − 0.003·2400=7.2
    const midSell = simulateLiquidity(defaultSell.x0 * 0.3, defaultSell)
    expect(midSell.toFixed(2)).toBe('237.80')
  })

  it('returns the full base liquidity (k + c·L) at zero volume', () => {
    expect(simulateLiquidity(0, defaultBuy)).toBe(1000)
  })

  it('returns 0 once volume reaches or exceeds max capacity', () => {
    expect(simulateLiquidity(defaultBuy.x0, defaultBuy)).toBe(0)
    expect(simulateLiquidity(defaultBuy.x0 + 1, defaultBuy)).toBe(0)
  })

  it('returns 0 for non-positive max capacity (x0 <= 0)', () => {
    expect(simulateLiquidity(0, { ...defaultBuy, x0: 0 })).toBe(0)
  })

  it('clamps negative results to 0 (fees exceed gross liquidity)', () => {
    const drained: CurveParams = {
      k: 1,
      L: 0,
      c: 0,
      x0: 100,
      gamma: 1,
      feeT: 1,
      interestR: 0
    }
    // base=1, (0.5)^1=0.5 → gross=0.5, fee=1·50=50 → max(0, 0.5−50) = 0
    expect(simulateLiquidity(50, drained)).toBe(0)
  })
})

describe('buildChartData', () => {
  it('returns steps+1 points spanning 0..max(x0)', () => {
    const data = buildChartData(defaultBuy, defaultSell)
    expect(data).toHaveLength(51) // default steps = 50

    const maxX = Math.max(defaultBuy.x0, defaultSell.x0)
    expect(data[0].x).toBe(0)
    expect(data[50].x).toBe(maxX)
  })

  it('starts at full base liquidity and ends fully exhausted', () => {
    const data = buildChartData(defaultBuy, defaultSell)
    expect(data[0].buy).toBe(1000) // base at x=0
    expect(data[50].buy).toBe(0) // x = 10000 >= buy.x0 → 0
    expect(data[50].sell).toBe(0) // x = 10000 >= sell.x0 (8000) → 0
  })
})

describe('STRATEGY_TEMPLATES', () => {
  it('exposes exactly the three named templates', () => {
    expect(STRATEGY_TEMPLATES).toHaveLength(3)
    expect(STRATEGY_TEMPLATES.map(t => t.name)).toEqual([
      'Buy the Dip',
      'Take Profit Gradually',
      'Stablecoin Range'
    ])
  })

  it('keeps every gamma within the supported [1, 5] range and k/x0 positive', () => {
    for (const template of STRATEGY_TEMPLATES) {
      for (const side of [template.buyParams, template.sellParams]) {
        expect(side.gamma).toBeGreaterThanOrEqual(1)
        expect(side.gamma).toBeLessThanOrEqual(5)
        expect(side.k).toBeGreaterThan(0)
        expect(side.x0).toBeGreaterThan(0)
      }
    }
  })
})
