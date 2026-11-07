import { describe, expect, it } from 'vitest'
import { readEnv } from '../env'

describe('readEnv', () => {
  it('returns the value the getter yields (vite-inlined literal)', () => {
    expect(readEnv(() => 'abc')).toBe('abc')
  })

  it('returns "" when the variable is unset', () => {
    expect(readEnv(() => undefined)).toBe('')
  })

  it('returns "" instead of throwing when `process` does not exist (browser)', () => {
    expect(
      readEnv(() => {
        throw new ReferenceError('process is not defined')
      })
    ).toBe('')
  })
})
