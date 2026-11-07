/**
 * Pure helpers for the spot settlement vault panel. Amounts are exact
 * bigints in token units — never Number — because they feed fund-moving
 * contract calls. The contract and spot-api stay authoritative: these only
 * pre-validate so the user is not asked to sign a call that would revert.
 */

/** `constants::MIN_DEPOSIT` in spot_settlement (raw units, every token). */
export const SPOT_VAULT_MIN_DEPOSIT_UNITS = 1_000_000n

export type VaultMode = 'deposit' | 'withdraw'

export type VaultStep =
  | 'approve'
  | 'depositNative'
  | 'depositPsp22'
  | 'withdrawNative'
  | 'withdrawPsp22'

/** Exact decimal string → token units. Throws on anything ambiguous. */
export function toUnits(amount: string, decimals: number): bigint {
  const v = amount.trim()
  if (!/^\d*(\.\d*)?$/.test(v) || v === '' || v === '.') {
    throw new Error('Invalid amount')
  }
  const [whole, frac = ''] = v.split('.')
  if (frac.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimals`)
  }
  const scale = 10n ** BigInt(decimals)
  return BigInt(whole || '0') * scale + BigInt(frac.padEnd(decimals, '0') || '0')
}

/** Token units → plain decimal string (for Max buttons and labels). */
export function fromUnits(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const frac = (units % scale).toString().padStart(decimals, '0')
  const trimmed = frac.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole.toString()
}

/**
 * Steps of one vault action. A PSP22 deposit approves the settlement
 * contract for EXACTLY `amount` (PSP22 approve sets, not adds) — never an
 * infinite allowance — and only when the current allowance is short.
 */
export function planVaultSteps(p: {
  mode: VaultMode
  isNative: boolean
  amount: bigint
  allowance?: bigint
}): VaultStep[] {
  if (p.mode === 'withdraw') {
    return [p.isNative ? 'withdrawNative' : 'withdrawPsp22']
  }
  if (p.isNative) return ['depositNative']
  return (p.allowance ?? 0n) >= p.amount
    ? ['depositPsp22']
    : ['approve', 'depositPsp22']
}

/**
 * `max` = wallet balance for deposits (null = unknown, the chain decides),
 * AVAILABLE vault balance for withdrawals (null = unknown → blocked: a
 * withdrawal of funds locked by open orders would make their settlement
 * revert).
 */
export function validateVaultAmount(p: {
  mode: VaultMode
  amount: bigint
  max?: bigint | null
}): string | null {
  if (p.amount <= 0n) return 'Enter an amount'
  if (p.mode === 'deposit') {
    if (p.amount < SPOT_VAULT_MIN_DEPOSIT_UNITS) {
      return 'Below the vault minimum deposit'
    }
    if (p.max !== undefined && p.max !== null && p.amount > p.max) {
      return 'Exceeds your wallet balance'
    }
    return null
  }
  if (p.max === undefined || p.max === null) {
    return 'Available vault balance unknown'
  }
  if (p.amount > p.max) return 'Exceeds your available vault balance'
  return null
}

export type SettlementMode = {
  settlementEnabled: boolean
  contractAddress: string | null
}

export type VaultGate =
  | { ok: true; reason: null }
  | {
      ok: false
      reason: 'unknown' | 'disabled' | 'unconfigured' | 'mismatch'
    }

/**
 * Deposits/withdrawals open only when spot-api settles on-chain AND this
 * build targets the very vault the relayer settles against. Funds sent to
 * any other contract would never back an order.
 */
export function vaultGate(p: {
  mode: SettlementMode | null
  envContract: string
}): VaultGate {
  if (!p.mode) return { ok: false, reason: 'unknown' }
  if (!p.mode.settlementEnabled) return { ok: false, reason: 'disabled' }
  if (!p.envContract) return { ok: false, reason: 'unconfigured' }
  if (p.mode.contractAddress !== p.envContract) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true, reason: null }
}
