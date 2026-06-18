import { describe, it, expect } from 'vitest'
import { isValidSubstrateAddress } from '../address'

describe('isValidSubstrateAddress', () => {
  it('accepts a real SS58 address', () => {
    expect(
      isValidSubstrateAddress('5C75w2nFNbjd8cZFSparTvQHJ52nca7EfQYBYueBiD5rzYJW'),
    ).toBe(true)
  })

  it('rejects the native sentinel, empty, garbage, and nullish', () => {
    expect(isValidSubstrateAddress('native')).toBe(false)
    expect(isValidSubstrateAddress('')).toBe(false)
    expect(isValidSubstrateAddress('not-a-valid-base58-0OIl')).toBe(false)
    expect(isValidSubstrateAddress(null)).toBe(false)
    expect(isValidSubstrateAddress(undefined)).toBe(false)
  })
})
