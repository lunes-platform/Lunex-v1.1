import { afterEach, describe, expect, it } from 'vitest'
import {
  balanceFraction,
  maxSpendableNative,
  nativeGasReservePlanck,
  parseLunesToPlanck
} from '../gasReserve'

const ENV_ED = 'REACT_APP_NATIVE_EXISTENTIAL_DEPOSIT_LUNES'
const ENV_FEE = 'REACT_APP_NATIVE_FEE_BUFFER_LUNES'

afterEach(() => {
  delete process.env[ENV_ED]
  delete process.env[ENV_FEE]
})

describe('parseLunesToPlanck', () => {
  it.each([
    ['1', 100_000_000n],
    ['0.5', 50_000_000n],
    ['0.000000019', 1n], // truncated to 8 decimals
    ['', null],
    ['abc', null],
    ['-1', null]
  ])('%s → %s', (input, out) => {
    expect(parseLunesToPlanck(input)).toBe(out)
  })
})

describe('nativeGasReservePlanck', () => {
  it('defaults to existential deposit + fee buffer (1.01 LUNES)', () => {
    expect(nativeGasReservePlanck()).toBe(101_000_000n)
  })

  it('is configurable through env', () => {
    process.env[ENV_ED] = '0.5'
    process.env[ENV_FEE] = '2'
    expect(nativeGasReservePlanck()).toBe(250_000_000n)
  })

  it('ignores invalid env values', () => {
    process.env[ENV_FEE] = 'lots'
    expect(nativeGasReservePlanck()).toBe(101_000_000n)
  })
})

describe('maxSpendableNative', () => {
  it('keeps the reserve out of MAX', () => {
    expect(maxSpendableNative('1000000000', 101_000_000n)).toBe('899000000')
  })

  it('never goes negative', () => {
    expect(maxSpendableNative('100', 101_000_000n)).toBe('0')
    expect(maxSpendableNative('garbage', 1n)).toBe('0')
  })
})

describe('balanceFraction', () => {
  it('MAX on native LUNES leaves the gas reserve', () => {
    expect(balanceFraction('1000000000', 1n, 1n, true, 101_000_000n)).toBe(
      '899000000'
    )
  })

  it('50% on native is capped by the spendable amount', () => {
    expect(balanceFraction('1000000000', 1n, 2n, true, 101_000_000n)).toBe(
      '500000000'
    )
    expect(balanceFraction('150000000', 1n, 2n, true, 101_000_000n)).toBe(
      '49000000'
    )
  })

  it('PSP22 tokens use the whole balance', () => {
    expect(balanceFraction('1000000000', 1n, 1n, false, 101_000_000n)).toBe(
      '1000000000'
    )
  })
})
