import { SubstrateEvent } from '@subql/types'
import { StakingEvent } from '../types'
import { makeEventId, safeNum } from './utils'

// ─── staking: StakeCreated ─────────────────────────────────────────────────
export async function handleStakeCreated(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const staker = String(args.staker ?? args.account ?? '')
  const amount = safeNum(args.amount)
  const lockPeriod = safeNum(args.lock_period_seconds ?? args.lock_period)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'STAKE_CREATED',
    staker,
    amount,
    rewardAmount: undefined,
    lockPeriodSeconds: lockPeriod,
    pendingRewardsBefore: undefined,
  })
  await ev.save()
}

// ─── staking: StakeWithdrawn ───────────────────────────────────────────────
export async function handleStakeWithdrawn(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const staker = String(args.staker ?? args.account ?? '')
  const amount = safeNum(args.amount)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'STAKE_WITHDRAWN',
    staker,
    amount,
    rewardAmount: undefined,
    lockPeriodSeconds: undefined,
    pendingRewardsBefore: undefined,
  })
  await ev.save()
}

// ─── staking: RewardClaimed ────────────────────────────────────────────────
export async function handleRewardClaimed(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const staker = String(args.staker ?? args.account ?? '')
  const rewardAmount = safeNum(args.reward_amount ?? args.amount)
  const pendingBefore = safeNum(args.pending_rewards_before ?? args.pending_before)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'REWARD_CLAIMED',
    staker,
    amount: undefined,
    rewardAmount,
    lockPeriodSeconds: undefined,
    pendingRewardsBefore: pendingBefore,
  })
  await ev.save()
}
