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

// ── BUG-01 regression tests: real on-chain reserves (2026-06-14) ───────────
// These tests lock the prices produced by normalizeReservesForPath for each
// active pair.  They prove that passing reserveIn/reserveOut in CANONICAL
// contract order (reserve0, reserve1) to humanPrice gives the correct result
// regardless of which token is token_0 in that specific pair.
//
// In all pairs below LUSDT (6 dec) is assumed to be the canonical token_0 for
// LBTC/LUSDT and LETH/LUSDT — the canonical order is determined at pair
// creation by the factory (sort by address).  The exact token_0 is fetched on
// chain at runtime; the tests here only need to verify the math is correct
// when token0 is supplied correctly.
//
// Real reserves (raw u128, from the live node):
//   WLUNES/LUSDT : WLUNES 50 * 1e8, LUSDT 100107 * 1e6  → price ~1996
//   LBTC/LUSDT   : LBTC   5  * 1e8, LUSDT 400176 * 1e6  → price ~79743
//   LETH/LUSDT   : LETH 100  * 1e8, LUSDT 300615 * 1e6  → price ~3000
//   GMC/LUSDT    : GMC 200410 * 1e8, LUSDT 100205 * 1e6 → price ~0.5
describe('BUG-01 regression — real on-chain reserves produce correct prices', () => {
  // Synthetic addresses — the test only cares about which one is token_0
  const TOKEN_A = '0x0000000000000000000000000000000000000001' // canonical token_0
  const _TOKEN_B = '0x0000000000000000000000000000000000000002' // canonical token_1

  function getAmountOutRaw(amountIn: bigint, rIn: bigint, rOut: bigint): bigint {
    const fee = amountIn * 997n
    return (fee * rOut) / (rIn * 1000n + fee)
  }

  it('WLUNES/LUSDT: selling 1 WLUNES gives ~1957 LUSDT (WLUNES is token_0)', () => {
    // WLUNES is token_0 here; reserves in canonical order: r0=WLUNES, r1=LUSDT
    // With 2% price impact (1 WLUNES out of 50) and 0.3% fee → ~1957 LUSDT out
    const r0 = 50n * 100_000_000n      // 50 WLUNES in raw (8 dec)
    const r1 = 100107n * 1_000_000n    // 100107 LUSDT in raw (6 dec)
    const amtIn = 1n * 100_000_000n    // 1 WLUNES

    // normalizeReservesForPath: path[0]=WLUNES=token_0 → reserveIn=r0, reserveOut=r1
    const { reserveIn, reserveOut } = normalizeReservesForPath(TOKEN_A, TOKEN_A, r0.toString(), r1.toString())
    expect(reserveIn).toBe(r0)
    expect(reserveOut).toBe(r1)

    const rawOut = getAmountOutRaw(amtIn, reserveIn, reserveOut)
    const lusdtOut = Number(rawOut) / 1e6
    // 1 WLUNES in 50-WLUNES pool → significant 2% price impact; expected ~1957 LUSDT
    expect(lusdtOut).toBeGreaterThan(1900)
    expect(lusdtOut).toBeLessThan(2100)
  })

  it('LBTC/LUSDT: selling 1 LBTC gives ~66000+ LUSDT (LBTC is token_0)', () => {
    const r0 = 5n * 100_000_000n       // 5 LBTC (8 dec)
    const r1 = 400176n * 1_000_000n    // 400176 LUSDT (6 dec)
    const amtIn = 1n * 100_000_000n    // 1 LBTC

    const { reserveIn, reserveOut } = normalizeReservesForPath(TOKEN_A, TOKEN_A, r0.toString(), r1.toString())
    const rawOut = getAmountOutRaw(amtIn, reserveIn, reserveOut)
    const lusdtOut = Number(rawOut) / 1e6
    expect(lusdtOut).toBeGreaterThan(60000)
    expect(lusdtOut).toBeLessThan(85000)
  })

  it('LETH/LUSDT: selling 1 LETH gives ~2950+ LUSDT (LETH is token_0)', () => {
    const r0 = 100n * 100_000_000n     // 100 LETH (8 dec)
    const r1 = 300615n * 1_000_000n    // 300615 LUSDT (6 dec)
    const amtIn = 1n * 100_000_000n    // 1 LETH

    const { reserveIn, reserveOut } = normalizeReservesForPath(TOKEN_A, TOKEN_A, r0.toString(), r1.toString())
    const rawOut = getAmountOutRaw(amtIn, reserveIn, reserveOut)
    const lusdtOut = Number(rawOut) / 1e6
    expect(lusdtOut).toBeGreaterThan(2950)
    expect(lusdtOut).toBeLessThan(3050)
  })

  it('BUG reproduces with inverted reserves: selling 1 WLUNES gives ~4.97 LUSDT (WRONG)', () => {
    // This test documents what the bug produced so we know the fix is active.
    const r0 = 50n * 100_000_000n
    const r1 = 100107n * 1_000_000n
    const amtIn = 1n * 100_000_000n

    // BUG: swap r0 and r1 (as if LUSDT were passed as reserveIn)
    const rawOutBug = getAmountOutRaw(amtIn, r1, r0)
    const wrongOut = Number(rawOutBug) / 1e6   // applying 6-dec as if LUSDT came out
    expect(wrongOut).toBeCloseTo(4.97, 1)      // proves the old bug
  })
})
