import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MAX_SLIPPAGE_PERCENT,
  MAX_DEADLINE_MINUTES,
  minAmountAfterSlippage,
  deadlineFromNow
} from '../txBounds'

afterEach(() => vi.useRealTimers())

describe('minAmountAfterSlippage', () => {
  it('applies the slippage tolerance to the raw amount', () => {
    expect(minAmountAfterSlippage('1000000', 0.5)).toBe('995000')
  })

  it('never goes below the hard slippage ceiling', () => {
    const floor = (1000000 * (100 - MAX_SLIPPAGE_PERCENT)) / 100
    expect(minAmountAfterSlippage('1000000', 99)).toBe(String(floor))
    expect(minAmountAfterSlippage('1000000', 100)).toBe(String(floor))
  })

  it('never returns 0 (unlimited slippage) for a corrupted slippage value', () => {
    expect(minAmountAfterSlippage('1000000', NaN)).toBe('995000')
    expect(minAmountAfterSlippage('1000000', Infinity)).toBe('995000')
    expect(minAmountAfterSlippage('1000000', -3)).toBe('1000000')
  })

  it('returns 0 only for an unparseable amount', () => {
    expect(minAmountAfterSlippage('abc', 0.5)).toBe('0')
  })
})

describe('deadlineFromNow', () => {
  it('returns unix seconds bounded to [1, MAX] minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000_000_000_000))
    const now = 1_000_000_000
    expect(deadlineFromNow(20)).toBe(now + 20 * 60)
    expect(deadlineFromNow(0)).toBe(now + 60)
    expect(deadlineFromNow(10_000)).toBe(now + MAX_DEADLINE_MINUTES * 60)
    expect(deadlineFromNow(NaN)).toBe(now + 20 * 60)
  })
})
