import {
  calculateDeadline,
  clampDeadlineMinutes,
  clampSlippagePercent,
  MAX_DEADLINE_MINUTES,
  MAX_SLIPPAGE_PERCENT,
  MIN_DEADLINE_MINUTES,
} from '../utils';
import { RouterModule } from '../modules/router';
import { HttpClient } from '../http-client';

// FE-04: slippage/deadline must be bounded in the layer that builds the
// swap parameters, independent of any UI or localStorage value.

describe('clampSlippagePercent', () => {
  it('keeps values inside (0, 50]', () => {
    expect(clampSlippagePercent(0.5)).toBe(0.5);
    expect(clampSlippagePercent(MAX_SLIPPAGE_PERCENT)).toBe(50);
  });

  it('clamps above the max and below zero', () => {
    expect(clampSlippagePercent(100)).toBe(50);
    expect(clampSlippagePercent(150)).toBe(50);
    expect(clampSlippagePercent(-5)).toBe(0);
  });

  it('rejects non-finite input', () => {
    expect(() => clampSlippagePercent(Number.NaN)).toThrow(RangeError);
    expect(() => clampSlippagePercent(Infinity)).toThrow(RangeError);
  });
});

describe('RouterModule.calculateMinAmount', () => {
  const router = new RouterModule({} as HttpClient);

  it('applies normal slippage', () => {
    expect(router.calculateMinAmount('1000000', 1)).toBe('990000');
  });

  it('never returns 0 or a negative amount for slippage >= 100%', () => {
    expect(router.calculateMinAmount('1000000', 100)).toBe('500000');
    expect(router.calculateMinAmount('1000000', 150)).toBe('500000');
    expect(BigInt(router.calculateMinAmount('1000000', 1e9))).toBeGreaterThan(
      0n,
    );
  });

  it('does not raise the minimum above the quote for negative slippage', () => {
    expect(router.calculateMinAmount('1000000', -10)).toBe('1000000');
  });
});

describe('deadline bounds', () => {
  const now = 1_700_000_000_000;

  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => jest.restoreAllMocks());

  it('clamps minutes into [MIN, MAX]', () => {
    expect(clampDeadlineMinutes(20)).toBe(20);
    expect(clampDeadlineMinutes(0)).toBe(MIN_DEADLINE_MINUTES);
    expect(clampDeadlineMinutes(-3)).toBe(MIN_DEADLINE_MINUTES);
    expect(clampDeadlineMinutes(4320)).toBe(MAX_DEADLINE_MINUTES);
    expect(() => clampDeadlineMinutes(Number.NaN)).toThrow(RangeError);
  });

  it('calculateDeadline never produces a past or multi-day deadline', () => {
    const nowSec = Math.floor(now / 1000);
    expect(calculateDeadline(20)).toBe(nowSec + 20 * 60);
    expect(calculateDeadline(0)).toBe(nowSec + MIN_DEADLINE_MINUTES * 60);
    expect(calculateDeadline(-60)).toBe(nowSec + MIN_DEADLINE_MINUTES * 60);
    expect(calculateDeadline(4320)).toBe(nowSec + MAX_DEADLINE_MINUTES * 60);
  });
});
