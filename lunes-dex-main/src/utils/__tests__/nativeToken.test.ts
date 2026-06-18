import { describe, it, expect, beforeAll } from 'vitest'
import {
  LUNES_TOKEN,
  NATIVE_SENTINEL,
  GAS_RESERVE_LUNES,
  isLunes,
  isWlunes,
  toRoutingAddress,
  wlunesAddress,
  classifyTrade,
  maxNativeSpendable,
} from '../nativeToken'

const WLUNES_ADDR = '5C75w2nFNbjd8cZFSparTvQHJ52nca7EfQYBYueBiD5rzYJW'
const LUSDT_ADDR = '5HDcVt1VQbkdhxd4xNKjhGzjCgWCyoCzjEY9f75YDem7oVhA'
const LBTC_ADDR = '5Cnc1LKaLZdmLVYiqkUbewgZavAXxxjDR24SWbzQf7QoP4bw'

beforeAll(() => {
  // wlunesAddress() reads env at call-time (mirrors config/contracts.ts pattern)
  process.env.REACT_APP_TOKEN_WLUNES = WLUNES_ADDR
})

const LUNES = LUNES_TOKEN
const WLUNES = { acronym: 'WLUNES', address: WLUNES_ADDR, isNative: false }
const LUSDT = { acronym: 'LUSDT', address: LUSDT_ADDR, isNative: false }
const LBTC = { acronym: 'LBTC', address: LBTC_ADDR, isNative: false }

describe('LUNES_TOKEN', () => {
  it('is the native LUNES token (sentinel address, isNative, 8 decimals)', () => {
    expect(LUNES_TOKEN.acronym).toBe('LUNES')
    expect(LUNES_TOKEN.address).toBe(NATIVE_SENTINEL)
    expect(LUNES_TOKEN.isNative).toBe(true)
    expect(LUNES_TOKEN.decimals).toBe(8)
  })
})

describe('isLunes', () => {
  it('recognizes the native token by sentinel, flag, and symbol', () => {
    expect(isLunes(LUNES)).toBe(true)
    expect(isLunes(NATIVE_SENTINEL)).toBe(true)
    expect(isLunes('LUNES')).toBe(true)
    expect(isLunes({ acronym: 'X', address: NATIVE_SENTINEL })).toBe(true)
  })
  it('rejects WLUNES and other tokens', () => {
    expect(isLunes(WLUNES)).toBe(false)
    expect(isLunes(LUSDT)).toBe(false)
    expect(isLunes('WLUNES')).toBe(false)
    expect(isLunes(null)).toBe(false)
  })
})

describe('isWlunes', () => {
  it('recognizes WLUNES by symbol and by wnative address', () => {
    expect(isWlunes(WLUNES)).toBe(true)
    expect(isWlunes('WLUNES')).toBe(true)
    expect(isWlunes(WLUNES_ADDR)).toBe(true)
  })
  it('rejects native LUNES and other tokens', () => {
    expect(isWlunes(LUNES)).toBe(false)
    expect(isWlunes(LUSDT)).toBe(false)
  })
})

describe('wlunesAddress / toRoutingAddress', () => {
  it('resolves the WLUNES contract address from env', () => {
    expect(wlunesAddress()).toBe(WLUNES_ADDR)
  })
  it('maps native LUNES to the WLUNES routing address', () => {
    expect(toRoutingAddress(LUNES)).toBe(WLUNES_ADDR)
  })
  it('keeps non-native token addresses unchanged', () => {
    expect(toRoutingAddress(LUSDT)).toBe(LUSDT_ADDR)
  })
})

describe('classifyTrade', () => {
  it('LUNES -> token = native-for-tokens swap, no approve', () => {
    expect(classifyTrade(LUNES, LUSDT)).toEqual({
      kind: 'swap',
      method: 'swapExactNativeForTokens',
      needsApprove: false,
    })
  })
  it('token -> LUNES = tokens-for-native swap, needs approve', () => {
    expect(classifyTrade(LUSDT, LUNES)).toEqual({
      kind: 'swap',
      method: 'swapExactTokensForNative',
      needsApprove: true,
    })
  })
  it('token -> token = tokens-for-tokens swap, needs approve', () => {
    expect(classifyTrade(LUSDT, LBTC)).toEqual({
      kind: 'swap',
      method: 'swapExactTokensForTokens',
      needsApprove: true,
    })
  })
  it('LUNES -> WLUNES = wrap (1:1, no approve, no router method)', () => {
    expect(classifyTrade(LUNES, WLUNES)).toEqual({
      kind: 'wrap',
      needsApprove: false,
    })
  })
  it('WLUNES -> LUNES = unwrap (1:1, no approve, no router method)', () => {
    expect(classifyTrade(WLUNES, LUNES)).toEqual({
      kind: 'unwrap',
      needsApprove: false,
    })
  })
})

describe('maxNativeSpendable', () => {
  it('subtracts the gas reserve from the native balance', () => {
    expect(maxNativeSpendable(10)).toBeCloseTo(10 - GAS_RESERVE_LUNES, 8)
  })
  it('never returns negative (balance below reserve -> 0)', () => {
    expect(maxNativeSpendable(GAS_RESERVE_LUNES / 2)).toBe(0)
    expect(maxNativeSpendable(0)).toBe(0)
  })
})
