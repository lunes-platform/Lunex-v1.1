import { describe, it, expect } from 'vitest';
import { computeLpFee, isQuoteReady } from './quoteUtils';

describe('computeLpFee', () => {
  it('computes 0.3% of a normal amount with trailing zeros stripped', () => {
    // 100 * 0.003 = 0.3, toFixed(8) = '0.30000000', stripped = '0.3'
    expect(computeLpFee('100', 8)).toBe('0.3');
  });

  it('returns "0" when inputAmount is "0"', () => {
    expect(computeLpFee('0', 8)).toBe('0');
  });

  it('returns "0" when inputAmount is empty string', () => {
    expect(computeLpFee('', 8)).toBe('0');
  });

  it('handles decimal inputs correctly', () => {
    // 10.5 * 0.003 = 0.0315, toFixed(8) = '0.03150000', stripped = '0.0315'
    expect(computeLpFee('10.5', 8)).toBe('0.0315');
  });

  it('returns "0" for NaN input', () => {
    expect(computeLpFee('not-a-number', 8)).toBe('0');
  });
});

describe('isQuoteReady', () => {
  it('returns true when minimumReceived is a non-zero string (priceImpact present)', () => {
    expect(isQuoteReady('0.00040321', '1.2')).toBe(true);
  });

  it('returns true when priceImpact is "0" — zero impact is valid', () => {
    expect(isQuoteReady('0.00040321', '0')).toBe(true);
  });

  it('returns false when minimumReceived is empty string', () => {
    expect(isQuoteReady('', '1.2')).toBe(false);
  });

  it('returns false when minimumReceived is "0"', () => {
    expect(isQuoteReady('0', '1.2')).toBe(false);
  });

  it('returns false when minimumReceived is undefined', () => {
    expect(isQuoteReady(undefined, '1.2')).toBe(false);
  });
});
