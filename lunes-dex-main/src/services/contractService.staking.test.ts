import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contractService } from './contractService'
import { DAY_MS, VOTE_COST_PLANCK } from '../utils/staking'

vi.mock('@polkadot/extension-dapp', () => ({
  web3FromAddress: vi.fn().mockResolvedValue({ signer: {} })
}))
vi.mock('../wallet/activeWallet', () => ({
  getSignerFor: vi.fn(() => ({ signPayload: vi.fn() }))
}))

const bob = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const account = { address: bob, meta: { source: 'polkadot-js' } } as any
const service = contractService as any

const okDry = (json: unknown = { ok: { ok: null } }) => ({
  result: { isOk: true, isErr: false },
  gasRequired: { refTime: 1, proofSize: 1 },
  output: { toJSON: () => json }
})

const status = (s: Record<string, boolean>) => ({
  status: { isInBlock: false, isFinalized: false, ...s },
  txHash: { toHex: () => '0xfeed' }
})

/** A tx builder whose signAndSend callback the test drives by hand. */
const makeTx = () => {
  let cb: ((r: unknown) => void) | null = null
  const unsub = vi.fn()
  const signAndSend = vi.fn((_addr: string, _opts: unknown, c: any) => {
    cb = c
    return Promise.resolve(unsub)
  })
  const builder = vi.fn((..._args: unknown[]) => ({ signAndSend }))
  return {
    builder,
    signAndSend,
    unsub,
    emit: (r: unknown) => cb?.(r)
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

/** Asserts the promise stays pending at isInBlock and resolves at
 *  isFinalized (CLAUDE.md: fund-moving code resolves on finality only). */
const expectFinalityGating = async (
  p: Promise<unknown>,
  t: ReturnType<typeof makeTx>
) => {
  let settled = false
  p.then(
    () => (settled = true),
    () => (settled = true)
  )
  await vi.waitFor(() => expect(t.signAndSend).toHaveBeenCalled())
  t.emit(status({ isReady: true }))
  t.emit(status({ isInBlock: true }))
  await flush()
  expect(settled).toBe(false)
  t.emit(status({ isFinalized: true }))
  await expect(p).resolves.toBe('0xfeed')
  await flush()
  expect(t.unsub).toHaveBeenCalled()
}

beforeEach(() => {
  service.api = { registry: { createType: vi.fn(() => ({})) } }
  service.contracts = { staking: bob }
})

afterEach(() => {
  service.api = null
  service.stakingContract = null
  service.contracts = null
})

describe('stake (payable, native LUNES)', () => {
  it('sends the amount as `value` and the duration (ms) as the only arg, resolving only on finality', async () => {
    const t = makeTx()
    const query = vi.fn().mockResolvedValue(okDry())
    service.stakingContract = { query: { stake: query }, tx: { stake: t.builder } }

    const p = contractService.stake('100000000000', 7 * DAY_MS, account)
    await expectFinalityGating(p, t)

    expect(query).toHaveBeenCalledWith(
      bob,
      expect.objectContaining({ value: '100000000000' }),
      7 * DAY_MS
    )
    expect(t.builder).toHaveBeenCalledWith(
      expect.objectContaining({ value: '100000000000' }),
      7 * DAY_MS
    )
  })

  it('does not broadcast when the dry-run returns a contract error', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: {
        stake: vi.fn().mockResolvedValue(okDry({ ok: { err: 'MinimumStakeNotMet' } }))
      },
      tx: { stake: t.builder }
    }
    await expect(
      contractService.stake('1', 7 * DAY_MS, account)
    ).rejects.toThrow('Minimum stake is 1,000 LUNES')
    expect(t.builder).not.toHaveBeenCalled()
  })

  it('rejects on dispatchError', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: { stake: vi.fn().mockResolvedValue(okDry()) },
      tx: { stake: t.builder }
    }
    const p = contractService.stake('100000000000', 7 * DAY_MS, account)
    await vi.waitFor(() => expect(t.signAndSend).toHaveBeenCalled())
    t.emit({
      ...status({ isInBlock: true }),
      dispatchError: { isModule: false, toString: () => 'BadOrigin' }
    })
    await expect(p).rejects.toThrow('BadOrigin')
  })

  it('rejects when the extrinsic is dropped / invalid', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: { stake: vi.fn().mockResolvedValue(okDry()) },
      tx: { stake: t.builder }
    }
    const p = contractService.stake('100000000000', 7 * DAY_MS, account)
    await vi.waitFor(() => expect(t.signAndSend).toHaveBeenCalled())
    t.emit(status({ isDropped: true }))
    await expect(p).rejects.toThrow(/dropped|invalid/i)
  })
})

describe('unstake / claimRewards (no args, no value)', () => {
  it('unstake() takes no amount and resolves only on finality', async () => {
    const t = makeTx()
    const query = vi.fn().mockResolvedValue(okDry())
    service.stakingContract = { query: { unstake: query }, tx: { unstake: t.builder } }
    const p = contractService.unstake(account)
    await expectFinalityGating(p, t)
    expect(query.mock.calls[0]).toHaveLength(2)
    expect(t.builder.mock.calls[0]).toHaveLength(1)
    expect(t.builder.mock.calls[0][0]).not.toHaveProperty('value')
  })

  it('claimRewards() resolves only on finality', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: { claimRewards: vi.fn().mockResolvedValue(okDry()) },
      tx: { claimRewards: t.builder }
    }
    await expectFinalityGating(contractService.claimRewards(account), t)
  })
})

describe('governance txs', () => {
  it('vote() pays VOTE_COST (10 LUNES) as value and resolves only on finality', async () => {
    const t = makeTx()
    const query = vi.fn().mockResolvedValue(okDry())
    service.stakingContract = { query: { vote: query }, tx: { vote: t.builder } }
    const p = contractService.vote(1, true, account)
    await expectFinalityGating(p, t)
    const value = VOTE_COST_PLANCK.toString()
    expect(query).toHaveBeenCalledWith(
      bob,
      expect.objectContaining({ value }),
      1,
      true
    )
    expect(t.builder).toHaveBeenCalledWith(
      expect.objectContaining({ value }),
      1,
      true
    )
  })

  it('vote() surfaces AlreadyVoted from the dry-run without broadcasting', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: { vote: vi.fn().mockResolvedValue(okDry({ ok: { err: 'AlreadyVoted' } })) },
      tx: { vote: t.builder }
    }
    await expect(contractService.vote(1, true, account)).rejects.toThrow(
      'already voted'
    )
    expect(t.builder).not.toHaveBeenCalled()
  })

  it('createProposal() pays the live proposal fee and resolves only on finality', async () => {
    const t = makeTx()
    const query = vi.fn().mockResolvedValue(okDry({ ok: { ok: 1 } }))
    service.stakingContract = {
      query: {
        getCurrentProposalFee: vi
          .fn()
          .mockResolvedValue(okDry({ ok: '0x0000000000000000000000ba43b74000' })),
        createProposal: query
      },
      tx: { createProposal: t.builder }
    }
    const p = contractService.createProposal('X', 'desc', bob, account)
    await expectFinalityGating(p, t)
    expect(t.builder).toHaveBeenCalledWith(
      expect.objectContaining({ value: '800000000000' }),
      'X',
      'desc',
      bob
    )
  })
})

describe('governance reads', () => {
  it('getListingStats decodes the tuple', async () => {
    service.stakingContract = {
      query: { getListingStats: vi.fn().mockResolvedValue(okDry({ ok: [4, 9, 0] })) }
    }
    expect(await contractService.getListingStats()).toEqual({
      totalProposals: 4,
      activeStakers: 9,
      approvedProposals: 0
    })
  })

  it('getProposal maps vote_count/votes_against to yes/no', async () => {
    service.stakingContract = {
      query: {
        getProposal: vi.fn().mockResolvedValue(
          okDry({
            ok: {
              id: 1,
              name: 'N',
              description: 'D',
              tokenAddress: bob,
              proposer: bob,
              voteCount: 5,
              votesFor: 60_00000000,
              votesAgainst: 1,
              votingDeadline: 123,
              executed: false,
              active: true,
              fee: 100_000_000_000,
              feeRefunded: false,
              newFeeAmount: null,
              executionTime: 456
            }
          })
        )
      }
    }
    const p = await contractService.getProposal(1)
    expect(p).toMatchObject({ id: 1, votesYes: 5, votesNo: 1, votingDeadline: 123 })
  })

  it('getProposalFee reads get_current_proposal_fee', async () => {
    service.stakingContract = {
      query: {
        getCurrentProposalFee: vi.fn().mockResolvedValue(okDry({ ok: 100_000_000_000 }))
      }
    }
    expect(await contractService.getProposalFee()).toBe('100000000000')
  })
})

describe('getStakingUserInfo', () => {
  const position = (active: boolean) => ({
    ok: {
      amount: 1_000_000_000_000,
      startTime: 1_000,
      duration: 31 * DAY_MS,
      lastClaim: 1_000,
      pendingRewards: 0,
      active,
      tier: 'Silver',
      earlyAdopterTier: 'Top100',
      governanceParticipation: 0
    }
  })

  it('returns position, live pending rewards and the tier APR', async () => {
    service.stakingContract = {
      query: {
        getStake: vi.fn().mockResolvedValue(okDry(position(true))),
        getStats: vi.fn().mockResolvedValue(okDry({ ok: [5_000_000_000_000, 0, 3] })),
        getPendingRewards: vi.fn().mockResolvedValue(okDry({ ok: { ok: 12345 } }))
      }
    }
    const info = await contractService.getStakingUserInfo(bob)
    expect(info).toMatchObject({
      totalStaked: '5000000000000',
      userStaked: '1000000000000',
      pendingRewards: '12345',
      apr: '11', // Silver 10% × 1.1 (10k LUNES)
      lockPeriod: 31
    })
    expect(info?.position?.unlockAt).toBe(1_000 + 31 * DAY_MS)
  })

  it('reports zero stake once the position is no longer active', async () => {
    service.stakingContract = {
      query: {
        getStake: vi.fn().mockResolvedValue(okDry(position(false))),
        getStats: vi.fn().mockResolvedValue(okDry({ ok: [0, 0, 0] })),
        getPendingRewards: vi.fn().mockResolvedValue(okDry({ ok: { err: 'NoActiveStake' } }))
      }
    }
    const info = await contractService.getStakingUserInfo(bob)
    expect(info).toMatchObject({ userStaked: '0', pendingRewards: '0' })
    expect(info?.position).toBeNull()
  })

  it('still reports owed rewards after unstake (claimable once the pool is funded)', async () => {
    service.stakingContract = {
      query: {
        getStake: vi.fn().mockResolvedValue(okDry(position(false))),
        getStats: vi.fn().mockResolvedValue(okDry({ ok: [0, 0, 0] })),
        getPendingRewards: vi.fn().mockResolvedValue(okDry({ ok: { ok: 777 } })),
        getRewardPools: vi.fn().mockResolvedValue(okDry({ ok: [100, 0, 0] }))
      }
    }
    const info = await contractService.getStakingUserInfo(bob)
    expect(info).toMatchObject({
      userStaked: '0',
      pendingRewards: '777',
      rewardsPool: '100'
    })
  })
})

describe('reward pools (solvency)', () => {
  it('getRewardPools decodes (apy_pool, trading_pool, credited)', async () => {
    service.stakingContract = {
      query: {
        getRewardPools: vi
          .fn()
          .mockResolvedValue(okDry({ ok: ['0x0000000000000000000000174876e800', 5, 7] }))
      }
    }
    expect(await contractService.getRewardPools()).toEqual({
      apyPool: '100000000000',
      tradingPool: '5',
      credited: '7'
    })
  })

  it('surfaces InsufficientRewardsPool readably', async () => {
    const t = makeTx()
    service.stakingContract = {
      query: {
        claimRewards: vi
          .fn()
          .mockResolvedValue(okDry({ ok: { err: 'InsufficientRewardsPool' } }))
      },
      tx: { claimRewards: t.builder }
    }
    await expect(contractService.claimRewards(account)).rejects.toThrow(
      /rewards pool/i
    )
    expect(t.builder).not.toHaveBeenCalled()
  })
})
