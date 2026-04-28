import { SubstrateEvent } from '@subql/types'
import { ListingEvent } from '../types'
import {
  makeEventId,
  safeNum,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'

// ── ListingManager: TokenListed ────────────────────────────────
export async function handleTokenListed(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber    = BigInt(block.block.header.number.toString())
  const timestamp      = block.timestamp ?? new Date()
  const extrinsicHash  = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer         = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args         = event.event.data.toJSON() as Record<string, unknown>
  const owner        = String(args.owner ?? signer ?? '')
  const tokenAddress = String(args.token_address ?? '')
  const pairAddress  = args.pair_address ? String(args.pair_address) : undefined
  const tier         = args.tier ? Number(args.tier) : undefined
  const listingFee   = safeNum(args.listing_fee)
  const id           = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind:            'TOKEN_LISTED',
    owner,
    tokenAddress,
    pairAddress,
    lpTokenAddress:  undefined,
    lpAmount:        undefined,
    lunesAmount:     undefined,
    tokenAmount:     undefined,
    unlockTimestamp: undefined,
    tier,
    listingFee,
    burnAmount:      listingFee * BigInt(50) / BigInt(100),
    treasuryAmount:  listingFee * BigInt(30) / BigInt(100),
    rewardsAmount:   listingFee * BigInt(20) / BigInt(100),
  })

  await ev.save()

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.newListings = (day.newListings ?? 0) + 1
  await day.save()
}

// ── LiquidityLock: LiquidityLocked ────────────────────────────
export async function handleLiquidityLocked(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber    = BigInt(block.block.header.number.toString())
  const timestamp      = block.timestamp ?? new Date()
  const extrinsicHash  = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer         = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args           = event.event.data.toJSON() as Record<string, unknown>
  const owner          = String(args.owner ?? signer ?? '')
  const pairAddress    = args.pair_address ? String(args.pair_address) : undefined
  const lpTokenAddress = args.lp_token    ? String(args.lp_token)    : undefined
  const lpAmount       = safeNum(args.lp_amount)
  const lunesAmount    = safeNum(args.lunes_amount)
  const tokenAmount    = safeNum(args.token_amount)
  const tier           = args.tier ? Number(args.tier) : undefined
  const unlockTs       = args.unlock_timestamp ? BigInt(String(args.unlock_timestamp)) : undefined

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind:            'LIQUIDITY_LOCKED',
    owner,
    tokenAddress:    undefined,
    pairAddress,
    lpTokenAddress,
    lpAmount,
    lunesAmount,
    tokenAmount,
    unlockTimestamp: unlockTs,
    tier,
    listingFee:      undefined,
    burnAmount:      undefined,
    treasuryAmount:  undefined,
    rewardsAmount:   undefined,
  })

  await ev.save()

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.totalLunesLocked = (day.totalLunesLocked ?? BigInt(0)) + lunesAmount
  await day.save()
}

// ── ListingManager: FeeDistributed ────────────────────────────
export async function handleFeeDistributed(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber    = BigInt(block.block.header.number.toString())
  const timestamp      = block.timestamp ?? new Date()
  const extrinsicHash  = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer         = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args           = event.event.data.toJSON() as Record<string, unknown>
  const owner          = String(args.owner ?? signer ?? '')
  const burnAmount     = safeNum(args.burn_amount)
  const treasuryAmount = safeNum(args.treasury_amount)
  const rewardsAmount  = safeNum(args.rewards_amount)
  const listingFee     = burnAmount + treasuryAmount + rewardsAmount
  const id             = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind:            'FEE_DISTRIBUTED',
    owner,
    tokenAddress:    args.token_address ? String(args.token_address) : undefined,
    pairAddress:     undefined,
    lpTokenAddress:  undefined,
    lpAmount:        undefined,
    lunesAmount:     undefined,
    tokenAmount:     undefined,
    unlockTimestamp: undefined,
    tier:            undefined,
    listingFee,
    burnAmount,
    treasuryAmount,
    rewardsAmount,
  })

  await ev.save()
}

// ── LiquidityLock: LiquidityUnlocked ──────────────────────────
export async function handleLiquidityUnlocked(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber   = BigInt(block.block.header.number.toString())
  const timestamp     = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer        = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args     = event.event.data.toJSON() as Record<string, unknown>
  const owner    = String(args.owner ?? signer ?? '')
  const lpAmount = safeNum(args.lp_amount)
  const id       = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind:            'LIQUIDITY_UNLOCKED',
    owner,
    tokenAddress:    undefined,
    pairAddress:     undefined,
    lpTokenAddress:  undefined,
    lpAmount,
    lunesAmount:     undefined,
    tokenAmount:     undefined,
    unlockTimestamp: undefined,
    tier:            undefined,
    listingFee:      undefined,
    burnAmount:      undefined,
    treasuryAmount:  undefined,
    rewardsAmount:   undefined,
  })

  await ev.save()
}
