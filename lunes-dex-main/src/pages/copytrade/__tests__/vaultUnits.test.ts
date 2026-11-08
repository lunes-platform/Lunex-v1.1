import { describe, expect, it } from 'vitest'
import { lunesToPlancks } from '../vaultUnits'

describe('lunesToPlancks (CopyVault holds native LUNES, 8 decimals)', () => {
  it.each([
    ['1', '100000000'],
    ['15', '1500000000'],
    ['0.5', '50000000'],
    ['1.123456789', '112345678'], // truncates beyond 8 decimals
    ['  2.5 ', '250000000']
  ])('converts %s → %s plancks', (units, plancks) => {
    expect(lunesToPlancks(units)).toBe(plancks)
  })

  it.each(['', '0', '-1', 'abc', '1e5', '1.2.3', '0.000000001'])(
    'rejects invalid or non-positive amount %j',
    units => {
      expect(() => lunesToPlancks(units)).toThrow()
    }
  )
})
