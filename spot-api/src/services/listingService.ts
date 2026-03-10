/**
 * Token Listing Service
 *
 * Implements the Liquidity-Locked Listing System for Lunex DEX.
 * Tiers:
 *   BASIC    (1): 1 000 LUNES fee | 2 000 LUNES liq | 90 days lock
 *   VERIFIED (2): 5 000 LUNES fee | 10 000 LUNES liq | 120 days lock
 *   FEATURED (3): 20 000 LUNES fee | 50 000 LUNES liq | 180 days lock
 *
 * Fee distribution: 50% burn · 30% treasury · 20% rewards pool
 */

import prisma from '../db'
import { ListingTier, ListingStatus, LockStatus } from '@prisma/client'
import { log } from '../utils/logger'

// ── Tier parameters ───────────────────────────────────────────────

export const TIER_CONFIG = {
  BASIC: {
    tier:         ListingTier.BASIC,
    tierNumber:   1,
    label:        'Basic',
    listingFee:   1_000,         // LUNES
    minLunesLiq:  2_000,         // LUNES
    lockDays:     90,
    lockMs:       90 * 24 * 60 * 60 * 1000,
    badge:        null,
    description:  'Entry-level listing. Token visible in search.',
  },
  VERIFIED: {
    tier:         ListingTier.VERIFIED,
    tierNumber:   2,
    label:        'Verified',
    listingFee:   5_000,
    minLunesLiq:  10_000,
    lockDays:     120,
    lockMs:       120 * 24 * 60 * 60 * 1000,
    badge:        'verified',
    description:  'Verified badge, trending section, DEX highlight.',
  },
  FEATURED: {
    tier:         ListingTier.FEATURED,
    tierNumber:   3,
    label:        'Featured',
    listingFee:   20_000,
    minLunesLiq:  50_000,
    lockDays:     180,
    lockMs:       180 * 24 * 60 * 60 * 1000,
    badge:        'featured',
    description:  'Home highlight, campaigns, reward incentives.',
  },
} as const

export type TierKey = keyof typeof TIER_CONFIG

// Fee split (basis points)
const BPS_BURN     = 5000 // 50%
const BPS_TREASURY = 3000 // 30%
const BPS_REWARDS  = 2000 // 20%

export function calcFeeDistribution(fee: number) {
  return {
    burn:     Math.floor((fee * BPS_BURN)     / 10_000),
    treasury: Math.floor((fee * BPS_TREASURY) / 10_000),
    rewards:  Math.floor((fee * BPS_REWARDS)  / 10_000),
  }
}

// ── Types ─────────────────────────────────────────────────────────

export type CreateListingInput = {
  ownerAddress:   string
  tokenAddress:   string
  tokenName:      string
  tokenSymbol:    string
  tokenDecimals?: number
  tier:           TierKey
  pairAddress?:   string
  lpTokenAddress: string
  lpAmount:       string        // decimal string (raw units)
  lunesLiquidity: string        // decimal string
  tokenLiquidity: string        // decimal string
  txHash?:        string
}

export type ListingWithLock = Awaited<ReturnType<typeof getListingById>>

// ── Service functions ─────────────────────────────────────────────

export async function getAllTierConfigs() {
  return Object.values(TIER_CONFIG).map((c) => ({
    tier:          c.tier,
    tierNumber:    c.tierNumber,
    label:         c.label,
    listingFee:    c.listingFee,
    minLunesLiq:   c.minLunesLiq,
    lockDays:      c.lockDays,
    badge:         c.badge,
    description:   c.description,
    feeDistribution: calcFeeDistribution(c.listingFee),
  }))
}

export async function createListing(input: CreateListingInput) {
  const cfg = TIER_CONFIG[input.tier]
  if (!cfg) throw new Error(`Invalid tier: ${input.tier}`)

  const lunesLiq = parseFloat(input.lunesLiquidity)
  if (isNaN(lunesLiq) || lunesLiq < cfg.minLunesLiq) {
    throw new Error(
      `Insufficient LUNES liquidity for ${cfg.label} tier. ` +
      `Required: ${cfg.minLunesLiq} LUNES, provided: ${lunesLiq} LUNES`,
    )
  }

  const existing = await prisma.tokenListing.findUnique({
    where: { tokenAddress: input.tokenAddress },
  })
  if (existing) {
    throw new Error(`Token ${input.tokenAddress} is already listed`)
  }

  const unlockAt = new Date(Date.now() + cfg.lockMs)

  const listing = await prisma.tokenListing.create({
    data: {
      ownerAddress:   input.ownerAddress,
      tokenAddress:   input.tokenAddress,
      tokenName:      input.tokenName,
      tokenSymbol:    input.tokenSymbol,
      tokenDecimals:  input.tokenDecimals ?? 18,
      pairAddress:    input.pairAddress,
      tier:           cfg.tier,
      status:         ListingStatus.PENDING,
      listingFee:     cfg.listingFee.toFixed(18),
      lunesLiquidity: input.lunesLiquidity,
      tokenLiquidity: input.tokenLiquidity,
      lpAmount:       input.lpAmount,
      txHash:         input.txHash,
      liquidityLock: {
        create: {
          ownerAddress:   input.ownerAddress,
          pairAddress:    input.pairAddress ?? '',
          lpTokenAddress: input.lpTokenAddress,
          lpAmount:       input.lpAmount,
          lunesLocked:    input.lunesLiquidity,
          tokenLocked:    input.tokenLiquidity,
          tier:           cfg.tier,
          status:         LockStatus.LOCKED,
          unlockAt,
        },
      },
    },
    include: { liquidityLock: true },
  })

  log.info(
    { listingId: listing.id, token: input.tokenSymbol, tier: cfg.label },
    '[Listing] Token listing created',
  )

  const feeDist = calcFeeDistribution(cfg.listingFee)
  log.info(
    { ...feeDist, totalFee: cfg.listingFee },
    '[Listing] Fee distribution',
  )

  return listing
}

export async function activateListing(listingId: string, onChainListingId?: number) {
  const listing = await prisma.tokenListing.update({
    where: { id: listingId },
    data: {
      status:          ListingStatus.ACTIVE,
      onChainListingId,
      verifiedAt:      new Date(),
    },
    include: { liquidityLock: true },
  })

  log.info({ listingId }, '[Listing] Listing activated')
  return listing
}

export async function rejectListing(listingId: string) {
  const listing = await prisma.tokenListing.update({
    where: { id: listingId },
    data: { status: ListingStatus.REJECTED },
  })
  log.warn({ listingId }, '[Listing] Listing rejected by admin')
  return listing
}

export async function getListingById(listingId: string) {
  return prisma.tokenListing.findUnique({
    where: { id: listingId },
    include: { liquidityLock: true },
  })
}

export async function getListingByToken(tokenAddress: string) {
  return prisma.tokenListing.findUnique({
    where: { tokenAddress },
    include: { liquidityLock: true },
  })
}

export async function getListings(params: {
  tier?:   ListingTier
  status?: ListingStatus
  limit?:  number
  offset?: number
}) {
  const { tier, status, limit = 50, offset = 0 } = params
  return prisma.tokenListing.findMany({
    where: {
      ...(tier   ? { tier }   : {}),
      ...(status ? { status } : {}),
    },
    include: { liquidityLock: true },
    orderBy: { createdAt: 'desc' },
    take:    limit,
    skip:    offset,
  })
}

export async function getOwnerListings(ownerAddress: string) {
  return prisma.tokenListing.findMany({
    where:   { ownerAddress },
    include: { liquidityLock: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function processExpiredLocks() {
  const now = new Date()
  const expiredLocks = await prisma.liquidityLock.findMany({
    where: {
      status:   LockStatus.LOCKED,
      unlockAt: { lte: now },
    },
    include: { listing: true },
  })

  for (const lock of expiredLocks) {
    await prisma.liquidityLock.update({
      where: { id: lock.id },
      data:  { status: LockStatus.UNLOCKED },
    })
    log.info(
      { lockId: lock.id, owner: lock.ownerAddress, token: lock.listing.tokenSymbol },
      '[Listing] Lock expired — owner can now withdraw LP tokens',
    )
  }

  return expiredLocks.length
}

export async function withdrawLock(lockId: string, ownerAddress: string, txHash?: string) {
  const lock = await prisma.liquidityLock.findUnique({ where: { id: lockId } })
  if (!lock) throw new Error('Lock not found')
  if (lock.ownerAddress !== ownerAddress) throw new Error('Not the lock owner')
  if (lock.status === LockStatus.WITHDRAWN) throw new Error('Already withdrawn')
  if (lock.status === LockStatus.LOCKED && lock.unlockAt > new Date()) {
    throw new Error(`Lock expires at ${lock.unlockAt.toISOString()}`)
  }

  return prisma.liquidityLock.update({
    where: { id: lockId },
    data: {
      status:      LockStatus.WITHDRAWN,
      withdrawnAt: new Date(),
      txHashUnlock: txHash,
    },
  })
}

export async function getListingStats() {
  const [byTier, byStatus, totalLocked] = await Promise.all([
    prisma.tokenListing.groupBy({
      by:     ['tier'],
      _count: { id: true },
    }),
    prisma.tokenListing.groupBy({
      by:     ['status'],
      _count: { id: true },
    }),
    prisma.liquidityLock.aggregate({
      where:  { status: LockStatus.LOCKED },
      _sum:   { lunesLocked: true },
      _count: { id: true },
    }),
  ])

  return {
    byTier,
    byStatus,
    totalLockedLunes: totalLocked._sum.lunesLocked?.toString() ?? '0',
    totalActiveLocks: totalLocked._count.id,
  }
}
