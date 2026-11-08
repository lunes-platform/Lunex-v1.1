import { describe, expect, it } from 'vitest'
import {
  SPOT_VAULT_MIN_DEPOSIT_UNITS,
  planVaultSteps,
  toUnits,
  validateVaultAmount,
  vaultGate
} from '../vaultMath'

describe('toUnits (exact decimal → token units, no floats)', () => {
  it('scales by the token decimals', () => {
    expect(toUnits('1', 8)).toBe(100_000_000n)
    expect(toUnits('0.01', 8)).toBe(1_000_000n)
    expect(toUnits('12.5', 6)).toBe(12_500_000n)
    expect(toUnits('0.1', 18)).toBe(100_000_000_000_000_000n)
  })

  it('does not lose precision like Number math would', () => {
    // 0.1 + 0.2 style float error must never reach a fund-moving call
    expect(toUnits('0.3', 8)).toBe(30_000_000n)
    expect(toUnits('123456789.12345678', 8)).toBe(12_345_678_912_345_678n)
  })

  it('rejects more decimals than the token supports, negatives and junk', () => {
    expect(() => toUnits('0.000000001', 8)).toThrow(/decimals/)
    expect(() => toUnits('-1', 8)).toThrow()
    expect(() => toUnits('1e3', 8)).toThrow()
    expect(() => toUnits('', 8)).toThrow()
    expect(() => toUnits('.', 8)).toThrow()
  })
})

describe('planVaultSteps', () => {
  it('deposits native LUNES as a payable call, no approve', () => {
    expect(
      planVaultSteps({ mode: 'deposit', isNative: true, amount: 5n })
    ).toEqual(['depositNative'])
  })

  it('approves EXACTLY the missing allowance before a PSP22 deposit', () => {
    expect(
      planVaultSteps({
        mode: 'deposit',
        isNative: false,
        amount: 5n,
        allowance: 4n
      })
    ).toEqual(['approve', 'depositPsp22'])
  })

  it('skips approve when the current allowance already covers the amount', () => {
    expect(
      planVaultSteps({
        mode: 'deposit',
        isNative: false,
        amount: 5n,
        allowance: 5n
      })
    ).toEqual(['depositPsp22'])
  })

  it('withdraws without any approval', () => {
    expect(
      planVaultSteps({ mode: 'withdraw', isNative: true, amount: 5n })
    ).toEqual(['withdrawNative'])
    expect(
      planVaultSteps({ mode: 'withdraw', isNative: false, amount: 5n })
    ).toEqual(['withdrawPsp22'])
  })
})

describe('validateVaultAmount', () => {
  it('requires a positive amount', () => {
    expect(validateVaultAmount({ mode: 'deposit', amount: 0n })).toBe(
      'Enter an amount'
    )
  })

  it('enforces the contract minimum deposit (raw units)', () => {
    expect(
      validateVaultAmount({
        mode: 'deposit',
        amount: SPOT_VAULT_MIN_DEPOSIT_UNITS - 1n
      })
    ).toMatch(/minimum/i)
    expect(
      validateVaultAmount({
        mode: 'deposit',
        amount: SPOT_VAULT_MIN_DEPOSIT_UNITS
      })
    ).toBeNull()
  })

  it('caps a deposit at the wallet balance when known', () => {
    expect(
      validateVaultAmount({ mode: 'deposit', amount: 2_000_000n, max: 1_500_000n })
    ).toMatch(/wallet/i)
  })

  it('caps a withdraw at the AVAILABLE vault balance (locked stays for open orders)', () => {
    expect(
      validateVaultAmount({ mode: 'withdraw', amount: 11n, max: 10n })
    ).toMatch(/available/i)
    expect(validateVaultAmount({ mode: 'withdraw', amount: 10n, max: 10n })).toBe(
      null
    )
  })

  it('blocks a withdraw while the available balance is unknown', () => {
    expect(
      validateVaultAmount({ mode: 'withdraw', amount: 10n, max: null })
    ).toMatch(/available/i)
  })
})

describe('vaultGate', () => {
  const VAULT = '5SpotVault1111111111111111111111111111111'

  it('blocks everything while the settlement mode is unknown', () => {
    expect(
      vaultGate({ mode: null, envContract: VAULT }).ok
    ).toBe(false)
  })

  it('is explicit when the backend does not settle on-chain', () => {
    const g = vaultGate({
      mode: { settlementEnabled: false, contractAddress: null },
      envContract: VAULT
    })
    expect(g).toMatchObject({ ok: false, reason: 'disabled' })
  })

  it('requires the vault contract to be configured in this build', () => {
    const g = vaultGate({
      mode: { settlementEnabled: true, contractAddress: VAULT },
      envContract: ''
    })
    expect(g).toMatchObject({ ok: false, reason: 'unconfigured' })
  })

  it('refuses a vault the backend does not settle against', () => {
    const g = vaultGate({
      mode: { settlementEnabled: true, contractAddress: VAULT },
      envContract: '5OtherVault111111111111111111111111111111'
    })
    expect(g).toMatchObject({ ok: false, reason: 'mismatch' })
  })

  it('opens when build and backend agree on the settling vault', () => {
    expect(
      vaultGate({
        mode: { settlementEnabled: true, contractAddress: VAULT },
        envContract: VAULT
      })
    ).toEqual({ ok: true, reason: null })
  })
})
