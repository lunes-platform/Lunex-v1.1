import { describe, it, expect } from 'vitest'
import { toPlancks, PLANCKS_PER_UNIT } from '../plancks'

// Characterization tests for the fund-conversion helper (custody-grade per the
// project Core Value). Behaviour was extracted verbatim from
// useAsymmetricDeploy.ts — these lock it so the extraction stays faithful and
// future edits cannot silently mis-scale deployed capital.

describe('PLANCKS_PER_UNIT', () => {
  it('is 10^12', () => {
    expect(PLANCKS_PER_UNIT).toBe(1_000_000_000_000n)
  })
})

describe('toPlancks (default 12 decimals)', () => {
  it('converts a whole number of units', () => {
    expect(toPlancks('1')).toBe('1000000000000')
    expect(toPlancks('100')).toBe('100000000000000')
  })

  it('converts a fractional amount, padding the fraction to 12 places', () => {
    expect(toPlancks('1.5')).toBe('1500000000000')
    expect(toPlancks('0.5')).toBe('500000000000')
  })

  it('represents the smallest unit (1 planck)', () => {
    expect(toPlancks('0.000000000001')).toBe('1')
  })

  it('treats zero / empty as 0', () => {
    expect(toPlancks('0')).toBe('0')
    expect(toPlancks('')).toBe('0')
  })

  it('truncates (does not round) fraction digits beyond 12 places', () => {
    // 13 nines → the 13th digit is dropped, not rounded up.
    expect(toPlancks('1.9999999999999')).toBe('1999999999999')
  })

  it('returns "0" on non-numeric input instead of throwing', () => {
    expect(toPlancks('abc')).toBe('0')
    expect(toPlancks('not-a-number')).toBe('0')
  })

  it('silently keeps only the integer + first fraction segment of multi-dot input', () => {
    // "1.2.3".split(".") = ["1","2","3"]; the destructure uses intPart="1" and
    // fracPart="2" only — the trailing ".3" is dropped and it does NOT throw.
    // Documented so a future stricter parse is a deliberate change.
    expect(toPlancks('1.2.3')).toBe('1200000000000')
  })
})

describe('toPlancks (decimals coupling quirk — documented current behaviour)', () => {
  it('mis-scales when given decimals != 12, since PLANCKS_PER_UNIT is fixed at 10^12', () => {
    // No caller does this today; the test documents the latent coupling so a
    // future change to support real per-token decimals is a conscious choice.
    expect(toPlancks('1.5', 6)).toBe('1000000500000')
  })
})
