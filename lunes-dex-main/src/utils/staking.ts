/**
 * Pure helpers for the staking + governance contract
 * (`Lunex/contracts/staking/lib.rs`, ABI `src/abis/Staking.json`).
 *
 * The contract stakes NATIVE LUNES (payable `stake(duration)`), one position
 * per account, and hosts the listing governance (`vote` costs 10 LUNES,
 * `create_proposal` costs `get_current_proposal_fee()`). All durations and
 * timestamps are milliseconds (`block_timestamp()`).
 *
 * The constants below are DISPLAY / pre-flight mirrors only — the contract
 * enforces them. No runtime imports so this stays unit-testable.
 */

/** Native LUNES uses 8 decimals. */
export const LUNES_DECIMALS = 8

export const DAY_MS = 24 * 60 * 60 * 1000

/** constants::MIN_STAKE — 1,000 LUNES. */
export const MIN_STAKE_PLANCK = 100_000_000_000n
/** constants::VOTE_COST — 10 LUNES per vote (must be sent as `value`). */
export const VOTE_COST_PLANCK = 1_000_000_000n
/** constants::PROPOSAL_FEE — initial fee; the live value comes from
 *  `get_current_proposal_fee()`. */
export const DEFAULT_PROPOSAL_FEE_PLANCK = 100_000_000_000n
/** constants::MIN_PROPOSAL_POWER — 10,000 LUNES staked to propose. */
export const MIN_PROPOSAL_POWER_PLANCK = 1_000_000_000_000n
/** constants::MIN_VOTES_FOR_APPROVAL (non-test build). */
export const MIN_VOTES_FOR_APPROVAL = 10_000
/** constants::VOTING_PERIOD — 14 days (ms). */
export const VOTING_PERIOD_MS = 14 * DAY_MS
/** constants::EXECUTION_DELAY_MS — 48 h timelock after voting ends. */
export const EXECUTION_DELAY_MS = 48 * 60 * 60 * 1000
/** constants::EARLY_PENALTY_RATE — 5% of principal when unstaking early. */
export const EARLY_UNSTAKE_PENALTY_BPS = 500

export const MIN_DURATION_MS = 7 * DAY_MS
export const MAX_DURATION_MS = 365 * DAY_MS

export type StakingTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

/** Tier APY in basis points (constants::*_REWARD_RATE). */
export const TIER_APR_BPS: Record<StakingTier, number> = {
  Bronze: 800,
  Silver: 1000,
  Gold: 1200,
  Platinum: 1500
}

/** calculate_staking_tier(): thresholds on the staking duration. */
export const tierForDurationMs = (durationMs: number): StakingTier => {
  if (durationMs >= 181 * DAY_MS) return 'Platinum'
  if (durationMs >= 91 * DAY_MS) return 'Gold'
  if (durationMs >= 31 * DAY_MS) return 'Silver'
  return 'Bronze'
}

export type DurationOption = {
  days: number
  durationMs: number
  tier: StakingTier
  aprBps: number
}

/** One preset per tier (the threshold day) plus the 7d minimum and the 1y
 *  maximum. */
export const STAKE_DURATION_OPTIONS: DurationOption[] = [
  7, 31, 91, 181, 365
].map(days => {
  const durationMs = days * DAY_MS
  const tier = tierForDurationMs(durationMs)
  return { days, durationMs, tier, aprBps: TIER_APR_BPS[tier] }
})

/** get_quantity_multiplier(): 1.0x / 1.1x / 1.2x / 1.3x at 10k/50k/200k. */
export const quantityMultiplierBps = (amountPlanck: bigint): number => {
  if (amountPlanck >= 20_000_000_000_000n) return 13000
  if (amountPlanck >= 5_000_000_000_000n) return 12000
  if (amountPlanck >= 1_000_000_000_000n) return 11000
  return 10000
}

/** Base APR (bps) = tier rate × quantity multiplier. Excludes the temporary
 *  early-adopter bonus (+10/25/50% for the first 1–3 months). */
export const estimateAprBps = (
  tier: StakingTier,
  amountPlanck: bigint
): number =>
  Math.floor((TIER_APR_BPS[tier] * quantityMultiplierBps(amountPlanck)) / 10000)

/** Normalise any codec JSON number (number, "1,000", hex, bigint) to a
 *  decimal integer string. Returns '0' when it cannot be parsed. */
export const toPlanckString = (v: unknown): string => {
  try {
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'number')
      return Number.isFinite(v) ? BigInt(Math.trunc(v)).toString() : '0'
    if (typeof v === 'string' && v.trim() !== '')
      return BigInt(v.replace(/,/g, '').trim()).toString()
  } catch {
    /* fall through */
  }
  return '0'
}

const toNum = (v: unknown): number => Number(toPlanckString(v))

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Strip ink's MessageResult / Result `ok` layers. Stops at an `err`. */
export const unwrapInk = (json: unknown): unknown => {
  let v = json
  while (isObj(v) && ('ok' in v || 'Ok' in v)) v = 'ok' in v ? v.ok : v.Ok
  return v
}

/** Name of the contract / dispatch error inside a dry-run output, if any. */
export const inkError = (json: unknown): string | null => {
  const v = unwrapInk(json)
  if (!isObj(v) || !('err' in v || 'Err' in v)) return null
  const e = 'err' in v ? v.err : v.Err
  if (typeof e === 'string') return e
  if (isObj(e)) return Object.keys(e)[0] ?? JSON.stringify(e)
  return JSON.stringify(e)
}

const pick = (o: Record<string, unknown>, camel: string, snake: string) =>
  o[camel] !== undefined && o[camel] !== null ? o[camel] : o[snake]

export type ListingStats = {
  totalProposals: number
  activeStakers: number
  approvedProposals: number
}

/** get_listing_stats() -> (u32 proposals, u32 active_stakers, u32 approved). */
export const decodeListingStats = (json: unknown): ListingStats | null => {
  const v = unwrapInk(json)
  if (!Array.isArray(v) || v.length < 2) return null
  return {
    totalProposals: toNum(v[0]),
    activeStakers: toNum(v[1]),
    approvedProposals: toNum(v[2])
  }
}

/** Proposal ids are 1..=total (next_proposal_id starts at 1). */
export const proposalIdsFor = (total: number): number[] =>
  Array.from({ length: Math.max(0, Math.floor(total)) }, (_, i) => i + 1)

export type GovernanceProposal = {
  id: number
  name: string
  description: string
  tokenAddress: string
  proposer: string
  /** YES votes (contract `vote_count`). */
  votesYes: number
  /** NO votes (contract `votes_against`). */
  votesNo: number
  /** Total LUNES paid by voters, planck (contract `votes_for`). */
  lunesCollected: string
  /** ms timestamp. */
  votingDeadline: number
  /** ms timestamp at which execute_proposal is allowed. */
  executionTime: number
  executed: boolean
  active: boolean
  fee: string
  isFeeChange: boolean
}

/** get_proposal(id) -> Option<ProjectProposal>. */
export const decodeProposal = (
  json: unknown,
  id: number
): GovernanceProposal | null => {
  const o = unwrapInk(json)
  if (!isObj(o)) return null
  const deadline = toNum(pick(o, 'votingDeadline', 'voting_deadline'))
  const exec = pick(o, 'executionTime', 'execution_time')
  const newFee = pick(o, 'newFeeAmount', 'new_fee_amount')
  return {
    id,
    name: String(o.name ?? ''),
    description: String(o.description ?? ''),
    tokenAddress: String(pick(o, 'tokenAddress', 'token_address') ?? ''),
    proposer: String(o.proposer ?? ''),
    votesYes: toNum(pick(o, 'voteCount', 'vote_count')),
    votesNo: toNum(pick(o, 'votesAgainst', 'votes_against')),
    lunesCollected: toPlanckString(pick(o, 'votesFor', 'votes_for')),
    votingDeadline: deadline,
    executionTime:
      exec !== undefined && exec !== null
        ? toNum(exec)
        : deadline + EXECUTION_DELAY_MS,
    executed: Boolean(o.executed),
    active: Boolean(o.active),
    fee: toPlanckString(o.fee),
    isFeeChange: newFee !== undefined && newFee !== null
  }
}

export type StakePositionView = {
  amount: string
  startTime: number
  durationMs: number
  unlockAt: number
  lastClaim: number
  active: boolean
  tier: StakingTier
  earlyAdopterTier: string
  governanceParticipation: number
}

const enumName = (v: unknown, fallback: string): string => {
  if (typeof v === 'string') return v
  if (isObj(v)) return Object.keys(v)[0] ?? fallback
  return fallback
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** get_stake(account) -> Option<StakePosition>. */
export const decodeStakePosition = (
  json: unknown
): StakePositionView | null => {
  const o = unwrapInk(json)
  if (!isObj(o)) return null
  const startTime = toNum(pick(o, 'startTime', 'start_time'))
  const durationMs = toNum(o.duration)
  const tierName = capitalise(enumName(o.tier, 'Bronze'))
  const tier: StakingTier = tierName in TIER_APR_BPS
    ? (tierName as StakingTier)
    : tierForDurationMs(durationMs)
  return {
    amount: toPlanckString(o.amount),
    startTime,
    durationMs,
    unlockAt: startTime + durationMs,
    lastClaim: toNum(pick(o, 'lastClaim', 'last_claim')),
    active: Boolean(o.active),
    tier,
    earlyAdopterTier: capitalise(
      enumName(pick(o, 'earlyAdopterTier', 'early_adopter_tier'), 'None')
    ),
    governanceParticipation: toNum(
      pick(o, 'governanceParticipation', 'governance_participation')
    )
  }
}

/** Readable messages for StakingError variants (lib.rs). */
const STAKING_ERRORS: Record<string, string> = {
  InsufficientBalance: 'The staking contract could not pay out (insufficient contract balance).',
  NoActiveStake: 'No active stake found (or you already have an active stake — one position per wallet).',
  MinimumStakeNotMet: 'Minimum stake is 1,000 LUNES.',
  InvalidDuration: 'Lock duration must be between 7 and 365 days.',
  ContractPaused: 'Staking is paused.',
  MaxStakersReached: 'Maximum number of stakers reached.',
  InvalidProposal: 'Proposal not found or no longer active.',
  AlreadyVoted: 'You already voted on this proposal.',
  VotingPeriodExpired: 'Voting for this proposal has ended.',
  InsufficientVotingPower: 'You need at least 10,000 LUNES staked to propose.',
  InsufficientFee: 'Insufficient LUNES sent for the fee.',
  NoStakeFound: 'You need an active stake to vote.',
  Reentrancy: 'Contract busy, try again.',
  ZeroAddress: 'Invalid token address.',
  InsufficientRewardsPool:
    'The staking rewards pool is not funded enough for this payout yet. Your rewards stay owed.'
}

export const describeStakingError = (name: string): string => {
  const key = capitalise(name)
  return STAKING_ERRORS[key] ?? `Contract error: ${name}`
}
