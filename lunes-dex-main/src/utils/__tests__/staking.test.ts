import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  MIN_STAKE_PLANCK,
  STAKE_DURATION_OPTIONS,
  VOTE_COST_PLANCK,
  decodeListingStats,
  decodeProposal,
  decodeStakePosition,
  estimateAprBps,
  inkError,
  proposalIdsFor,
  tierForDurationMs,
  toPlanckString,
  unwrapInk
} from '../staking'

describe('staking constants mirror Lunex/contracts/staking/lib.rs', () => {
  it('uses 8-decimal native LUNES amounts', () => {
    expect(MIN_STAKE_PLANCK).toBe(100_000_000_000n) // 1000 LUNES
    expect(VOTE_COST_PLANCK).toBe(1_000_000_000n) // 10 LUNES
  })

  it('offers durations inside 7..365 days, expressed in milliseconds', () => {
    for (const o of STAKE_DURATION_OPTIONS) {
      expect(o.days).toBeGreaterThanOrEqual(7)
      expect(o.days).toBeLessThanOrEqual(365)
      expect(o.durationMs).toBe(o.days * DAY_MS)
      expect(o.tier).toBe(tierForDurationMs(o.durationMs))
    }
    const tiers = new Set(STAKE_DURATION_OPTIONS.map(o => o.tier))
    expect(tiers).toEqual(new Set(['Bronze', 'Silver', 'Gold', 'Platinum']))
  })
})

describe('tierForDurationMs', () => {
  it.each([
    [7, 'Bronze'],
    [30, 'Bronze'],
    [31, 'Silver'],
    [90, 'Silver'],
    [91, 'Gold'],
    [180, 'Gold'],
    [181, 'Platinum'],
    [365, 'Platinum']
  ])('%i days → %s', (days, tier) => {
    expect(tierForDurationMs(days * DAY_MS)).toBe(tier)
  })
})

describe('estimateAprBps', () => {
  it('applies the tier rate and the quantity multiplier', () => {
    expect(estimateAprBps('Bronze', 100_000_000_000n)).toBe(800) // 1k
    expect(estimateAprBps('Silver', 1_000_000_000_000n)).toBe(1100) // 10k 1.1x
    expect(estimateAprBps('Gold', 5_000_000_000_000n)).toBe(1440) // 50k 1.2x
    expect(estimateAprBps('Platinum', 20_000_000_000_000n)).toBe(1950) // 1.3x
  })
})

describe('toPlanckString', () => {
  it.each([
    [123, '123'],
    ['1,000,000', '1000000'],
    ['0x0000000000000000000000174876e800', '100000000000'],
    [10n, '10'],
    [null, '0'],
    ['garbage', '0']
  ])('%s → %s', (input, out) => {
    expect(toPlanckString(input)).toBe(out)
  })
})

describe('unwrapInk / inkError', () => {
  it('strips MessageResult and Result layers', () => {
    expect(unwrapInk({ ok: { ok: 5 } })).toBe(5)
    expect(unwrapInk({ Ok: [1, 2, 3] })).toEqual([1, 2, 3])
    expect(unwrapInk({ ok: null })).toBeNull()
  })

  it('detects a nested contract error', () => {
    expect(inkError({ ok: { err: 'MinimumStakeNotMet' } })).toBe(
      'MinimumStakeNotMet'
    )
    expect(inkError({ ok: { err: { insufficientFee: null } } })).toBe(
      'insufficientFee'
    )
    expect(inkError({ ok: { ok: null } })).toBeNull()
  })
})

describe('decodeListingStats', () => {
  it('reads the (proposals, activeStakers, approved) tuple', () => {
    expect(decodeListingStats({ ok: [3, 12, 0] })).toEqual({
      totalProposals: 3,
      activeStakers: 12,
      approvedProposals: 0
    })
  })

  it('returns null for a non-tuple', () => {
    expect(decodeListingStats({ ok: { totalProposals: 3 } })).toBeNull()
  })
})

describe('proposalIdsFor', () => {
  it('starts at 1 (contract next_proposal_id starts at 1)', () => {
    expect(proposalIdsFor(0)).toEqual([])
    expect(proposalIdsFor(3)).toEqual([1, 2, 3])
  })
})

describe('decodeProposal', () => {
  const raw = {
    id: 2,
    name: 'Token X',
    description: 'desc',
    tokenAddress: '5Token',
    proposer: '5Alice',
    voteCount: 7,
    votesFor: '0x000000000000000000000002540be400', // 100 LUNES collected
    votesAgainst: 3,
    votingDeadline: 1_700_000_000_000,
    executed: false,
    active: true,
    fee: 100_000_000_000,
    feeRefunded: false,
    newFeeAmount: null,
    executionTime: 1_700_172_800_000
  }

  it('maps contract fields (vote_count = YES, votes_against = NO)', () => {
    expect(decodeProposal({ ok: raw }, 2)).toEqual({
      id: 2,
      name: 'Token X',
      description: 'desc',
      tokenAddress: '5Token',
      proposer: '5Alice',
      votesYes: 7,
      votesNo: 3,
      lunesCollected: '10000000000',
      votingDeadline: 1_700_000_000_000,
      executionTime: 1_700_172_800_000,
      executed: false,
      active: true,
      fee: '100000000000',
      isFeeChange: false
    })
  })

  it('accepts snake_case keys and flags fee-change proposals', () => {
    const p = decodeProposal(
      {
        ok: {
          ...raw,
          voteCount: undefined,
          vote_count: 1,
          new_fee_amount: 5
        }
      },
      2
    )
    expect(p?.votesYes).toBe(1)
    expect(p?.isFeeChange).toBe(true)
  })

  it('returns null for Option::None', () => {
    expect(decodeProposal({ ok: null }, 9)).toBeNull()
  })
})

describe('decodeStakePosition', () => {
  it('derives unlock time and tier from start + duration (ms)', () => {
    const p = decodeStakePosition({
      ok: {
        amount: '0x0000000000000000000000174876e800',
        startTime: 1_000,
        duration: 7 * DAY_MS,
        lastClaim: 1_000,
        pendingRewards: 0,
        active: true,
        tier: 'Bronze',
        earlyAdopterTier: 'Top100',
        governanceParticipation: 2
      }
    })
    expect(p).toEqual({
      amount: '100000000000',
      startTime: 1_000,
      durationMs: 7 * DAY_MS,
      unlockAt: 1_000 + 7 * DAY_MS,
      lastClaim: 1_000,
      active: true,
      tier: 'Bronze',
      earlyAdopterTier: 'Top100',
      governanceParticipation: 2
    })
  })

  it('returns null for Option::None', () => {
    expect(decodeStakePosition({ ok: null })).toBeNull()
  })
})
