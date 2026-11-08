import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NATIVE_SENTINEL } from '../../utils/nativeToken'
import { buildPoolTokens, sameRoutedToken } from './tokens'

const WLUNES = '5C75w2nFNbjd8cZFSparTvQHJ52nca7EfQYBYueBiD5rzYJW'
const LUSDT = '5HDcVt1VQbkdhxd4xNKjhGzjCgWCyoCzjEY9f75YDem7oVhA'

const known = [
  { address: WLUNES, symbol: 'WLUNES', name: 'Wrapped Lunes', decimals: 8, icon: '' },
  { address: LUSDT, symbol: 'LUSDT', name: 'Lunes USD', decimals: 6, icon: '' }
]

beforeEach(() => {
  process.env.REACT_APP_TOKEN_WLUNES = WLUNES
})
afterEach(() => {
  delete process.env.REACT_APP_TOKEN_WLUNES
})

describe('buildPoolTokens', () => {
  it('lists native LUNES first when WLUNES is configured', () => {
    const list = buildPoolTokens(known)
    expect(list[0]).toMatchObject({
      symbol: 'LUNES',
      address: NATIVE_SENTINEL,
      decimals: 8,
      isNative: true
    })
    expect(list.slice(1).map(t => t.symbol)).toEqual(['WLUNES', 'LUSDT'])
  })

  it('omits native LUNES when WLUNES is not listed (no routing target)', () => {
    expect(buildPoolTokens([known[1]]).map(t => t.symbol)).toEqual(['LUSDT'])
  })
})

describe('sameRoutedToken', () => {
  it('treats LUNES and WLUNES as the same pool side', () => {
    const [lunes, wlunes, lusdt] = buildPoolTokens(known)
    expect(sameRoutedToken(lunes, wlunes)).toBe(true)
    expect(sameRoutedToken(lunes, lusdt)).toBe(false)
    expect(sameRoutedToken(lusdt, lusdt)).toBe(true)
    expect(sameRoutedToken(null, lusdt)).toBe(false)
  })
})
