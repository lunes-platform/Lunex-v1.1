import { describe, it, expect } from 'vitest'
import { normalizeReservesForPath, humanPrice } from '../reserveUtils'

// Characterization tests for the B4/B2 reserve-decimal-normalization fix.
//
// Real on-chain example used throughout (from reserveUtils.ts doc + the value
// verified live in the browser): a WLUNES/LUSDT pair where WLUNES is canonical
// token_0 (8 decimals) and LUSDT is token_1 (6 decimals).
const WLUNES = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' // canonical token_0
const LUSDT = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty' // canonical token_1
const RESERVE_WLUNES = '7679233508' // raw u128, 8 decimals
const RESERVE_LUSDT = '81660345758' // raw u128, 6 decimals

describe('normalizeReservesForPath', () => {
  it('keeps reserve orientation when path[0] is the canonical token_0', () => {
    const { reserveIn, reserveOut } = normalizeReservesForPath(
      WLUNES, // pair token_0
      WLUNES, // path[0] — selling WLUNES
      RESERVE_WLUNES,
      RESERVE_LUSDT
    )
    expect(reserveIn).toBe(7679233508n)
    expect(reserveOut).toBe(81660345758n)
  })

  it('swaps reserves when path[0] is the canonical token_1', () => {
    const { reserveIn, reserveOut } = normalizeReservesForPath(
      WLUNES, // pair token_0
      LUSDT, // path[0] — selling LUSDT (the canonical token_1)
      RESERVE_WLUNES,
      RESERVE_LUSDT
    )
    // reserveIn must follow path[0] (LUSDT), reserveOut follows path[1] (WLUNES)
    expect(reserveIn).toBe(81660345758n)
    expect(reserveOut).toBe(7679233508n)
  })

  it('matches token addresses case-insensitively', () => {
    const { reserveIn, reserveOut } = normalizeReservesForPath(
      WLUNES.toUpperCase(),
      WLUNES.toLowerCase(),
      RESERVE_WLUNES,
      RESERVE_LUSDT
    )
    // Despite the case mismatch, path[0] is recognised as token_0 → no swap.
    expect(reserveIn).toBe(7679233508n)
    expect(reserveOut).toBe(81660345758n)
  })
})

describe('humanPrice', () => {
  it('applies the 8↔6 decimal adjustment (price ≈ 1063.39, not the naive 10.63)', () => {
    const price = humanPrice(
      WLUNES, // pair token_0
      WLUNES, // display token — price of 1 WLUNES in LUSDT
      RESERVE_WLUNES,
      RESERVE_LUSDT,
      8, // decimals of token_0 (WLUNES)
      6 // decimals of token_1 (LUSDT)
    )
    // The fix: real price is ~1063.39, exactly 10^(8-6)=100x the naive ratio.
    expect(price).toBeCloseTo(1063.39, 1)

    const naiveRatio = Number(RESERVE_LUSDT) / Number(RESERVE_WLUNES) // ≈ 10.63
    expect(price / naiveRatio).toBeCloseTo(100, 1)
  })

  it('returns the reciprocal price when querying the other token', () => {
    const priceOfLusdtInWlunes = humanPrice(
      WLUNES,
      LUSDT, // display the canonical token_1
      RESERVE_WLUNES,
      RESERVE_LUSDT,
      8,
      6
    )
    // 1 LUSDT ≈ 0.00094 WLUNES (reciprocal of ~1063.39).
    expect(priceOfLusdtInWlunes).toBeCloseTo(0.00094, 5)
  })

  it('returns 0 when either reserve is empty (no division by zero)', () => {
    expect(humanPrice(WLUNES, WLUNES, '0', RESERVE_LUSDT, 8, 6)).toBe(0)
    expect(humanPrice(WLUNES, WLUNES, RESERVE_WLUNES, '0', 8, 6)).toBe(0)
  })
})
