import { SubstrateEvent } from '@subql/types'
import { StakingEvent } from '../types'
import { makeEventId } from './utils'
import {
  labelGuard,
  decodeStaked,
  decodeUnstaked,
  decodeRewardsClaimed,
} from './contractEvents'

// ─── staking: StakeCreated ─────────────────────────────────────────────────
export async function handleStakeCreated(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-Staked event.
  const raw = labelGuard(event, ['StakingContract::Staked'])
  if (!raw) return

  const decoded = decodeStaked(raw.payload)
  if (!decoded) return
  const staker = decoded.staker
  const amount = decoded.amount
  const lockPeriod = decoded.duration

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
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

  // Discriminate by ink! string topic; bail on any non-Unstaked event.
  const raw = labelGuard(event, ['StakingContract::Unstaked'])
  if (!raw) return

  const decoded = decodeUnstaked(raw.payload)
  if (!decoded) return
  const staker = decoded.staker
  const amount = decoded.amount

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'STAKE_WITHDRAWN',
    staker,
    amount,
    rewardAmount: decoded.rewards,
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

  // Discriminate by ink! string topic; bail on any non-RewardsClaimed event.
  const raw = labelGuard(event, ['StakingContract::RewardsClaimed'])
  if (!raw) return

  const decoded = decodeRewardsClaimed(raw.payload)
  if (!decoded) return
  const staker = decoded.staker
  const rewardAmount = decoded.amount

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = StakingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'REWARD_CLAIMED',
    staker,
    amount: undefined,
    rewardAmount,
    lockPeriodSeconds: undefined,
    pendingRewardsBefore: undefined,
  })
  await ev.save()
}
