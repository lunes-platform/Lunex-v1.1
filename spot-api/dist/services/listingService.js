"use strict";
/**
 * Token Listing Service
 *
 * Implements the Liquidity-Locked Listing System for Lunex DEX.
 * The system automatically creates the pool, deposits liquidity,
 * and locks LP tokens on behalf of the user.
 *
 * Tiers:
 *   BASIC    (1): 1 000 LUNES fee | 10 000 LUNES min liq | 90 days lock
 *   VERIFIED (2): 5 000 LUNES fee | 25 000 LUNES min liq | 120 days lock
 *   FEATURED (3): 20 000 LUNES fee | 50 000 LUNES min liq | 180 days lock
 *
 * Fee distribution: 20% staking · 50% team revenue · 30% rewards pool
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_CONFIG = void 0;
exports.calcFeeDistribution = calcFeeDistribution;
exports.getAllTierConfigs = getAllTierConfigs;
exports.createListing = createListing;
exports.activateListing = activateListing;
exports.rejectListing = rejectListing;
exports.getListingById = getListingById;
exports.getListingByToken = getListingByToken;
exports.getListings = getListings;
exports.getOwnerListings = getOwnerListings;
exports.processExpiredLocks = processExpiredLocks;
exports.withdrawLock = withdrawLock;
exports.getListingStats = getListingStats;
const db_1 = __importDefault(require("../db"));
const client_1 = require("@prisma/client");
const logger_1 = require("../utils/logger");
const tokenRegistryService_1 = require("./tokenRegistryService");
// ── Tier parameters ───────────────────────────────────────────────
exports.TIER_CONFIG = {
    BASIC: {
        tier: client_1.ListingTier.BASIC,
        tierNumber: 1,
        label: 'Basic',
        listingFee: 1000, // LUNES
        minLunesLiq: 10000, // LUNES (min 10k)
        lockDays: 90,
        lockMs: 90 * 24 * 60 * 60 * 1000,
        badge: null,
        description: 'Entry-level listing. Token visible in search.',
    },
    VERIFIED: {
        tier: client_1.ListingTier.VERIFIED,
        tierNumber: 2,
        label: 'Verified',
        listingFee: 5000,
        minLunesLiq: 25000, // LUNES (min 25k)
        lockDays: 120,
        lockMs: 120 * 24 * 60 * 60 * 1000,
        badge: 'verified',
        description: 'Verified badge, trending section, DEX highlight.',
    },
    FEATURED: {
        tier: client_1.ListingTier.FEATURED,
        tierNumber: 3,
        label: 'Featured',
        listingFee: 20000,
        minLunesLiq: 50000, // LUNES (min 50k)
        lockDays: 180,
        lockMs: 180 * 24 * 60 * 60 * 1000,
        badge: 'featured',
        description: 'Home highlight, campaigns, reward incentives.',
    },
};
// Fee split (basis points)
const BPS_STAKING = 2000; // 20% → staking pool
const BPS_TREASURY = 5000; // 50% (team revenue)
const BPS_REWARDS = 3000; // 30%
function calcFeeDistribution(fee) {
    return {
        staking: Math.floor((fee * BPS_STAKING) / 10000),
        treasury: Math.floor((fee * BPS_TREASURY) / 10000),
        rewards: Math.floor((fee * BPS_REWARDS) / 10000),
    };
}
// ── Service functions ─────────────────────────────────────────────
async function getAllTierConfigs() {
    return Object.values(exports.TIER_CONFIG).map((c) => ({
        tier: c.tier,
        tierNumber: c.tierNumber,
        label: c.label,
        listingFee: c.listingFee,
        minLunesLiq: c.minLunesLiq,
        lockDays: c.lockDays,
        badge: c.badge,
        description: c.description,
        feeDistribution: calcFeeDistribution(c.listingFee),
    }));
}
async function createListing(input) {
    const cfg = exports.TIER_CONFIG[input.tier];
    if (!cfg)
        throw new Error(`Invalid tier: ${input.tier}`);
    const lunesLiq = parseFloat(input.lunesLiquidity);
    if (isNaN(lunesLiq) || lunesLiq < cfg.minLunesLiq) {
        throw new Error(`Insufficient LUNES liquidity for ${cfg.label} tier. ` +
            `Required: ${cfg.minLunesLiq} LUNES, provided: ${lunesLiq} LUNES`);
    }
    const existing = await db_1.default.tokenListing.findUnique({
        where: { tokenAddress: input.tokenAddress },
    });
    if (existing) {
        throw new Error(`Token ${input.tokenAddress} is already listed`);
    }
    const unlockAt = new Date(Date.now() + cfg.lockMs);
    // LP fields are auto-generated: pool creation happens on-chain
    const lpTokenAddress = input.lpTokenAddress || 'pending-pool-creation';
    const lpAmount = input.lpAmount || '0';
    const pairAddress = input.pairAddress || 'pending-pool-creation';
    const listing = await db_1.default.tokenListing.create({
        data: {
            ownerAddress: input.ownerAddress,
            tokenAddress: input.tokenAddress,
            tokenName: input.tokenName,
            tokenSymbol: input.tokenSymbol,
            tokenDecimals: input.tokenDecimals ?? 18,
            pairAddress,
            tier: cfg.tier,
            status: client_1.ListingStatus.PENDING,
            listingFee: cfg.listingFee.toFixed(18),
            lunesLiquidity: input.lunesLiquidity,
            tokenLiquidity: input.tokenLiquidity,
            lpAmount,
            txHash: input.txHash,
            logoURI: input.logoURI ?? null,
            liquidityLock: {
                create: {
                    ownerAddress: input.ownerAddress,
                    pairAddress,
                    lpTokenAddress,
                    lpAmount,
                    lunesLocked: input.lunesLiquidity,
                    tokenLocked: input.tokenLiquidity,
                    tier: cfg.tier,
                    status: client_1.LockStatus.LOCKED,
                    unlockAt,
                },
            },
        },
        include: { liquidityLock: true },
    });
    logger_1.log.info({ listingId: listing.id, token: input.tokenSymbol, tier: cfg.label }, '[Listing] Token listing created');
    const feeDist = calcFeeDistribution(cfg.listingFee);
    logger_1.log.info({ ...feeDist, totalFee: cfg.listingFee }, '[Listing] Fee distribution');
    return listing;
}
async function activateListing(listingId, input = {}) {
    const listing = await db_1.default.tokenListing.update({
        where: { id: listingId },
        data: {
            status: client_1.ListingStatus.ACTIVE,
            onChainListingId: input.onChainListingId,
            pairAddress: input.pairAddress || undefined,
            lpAmount: input.lpAmount || undefined,
            txHash: input.txHash || undefined,
            verifiedAt: new Date(),
        },
        include: { liquidityLock: true },
    });
    // Update the liquidity lock with real on-chain pool data
    if (listing.liquidityLock && (input.pairAddress || input.lpTokenAddress || input.lpAmount)) {
        await db_1.default.liquidityLock.update({
            where: { id: listing.liquidityLock.id },
            data: {
                ...(input.pairAddress ? { pairAddress: input.pairAddress } : {}),
                ...(input.lpTokenAddress ? { lpTokenAddress: input.lpTokenAddress } : {}),
                ...(input.lpAmount ? { lpAmount: input.lpAmount } : {}),
            },
        });
    }
    logger_1.log.info({ listingId, pairAddress: input.pairAddress || 'unchanged' }, '[Listing] Listing activated');
    // Auto-register token in registry
    try {
        await (0, tokenRegistryService_1.registerToken)({
            address: listing.tokenAddress,
            symbol: listing.tokenSymbol,
            name: listing.tokenName,
            decimals: listing.tokenDecimals,
            logoURI: listing.logoURI ?? undefined,
            isVerified: listing.tier !== client_1.ListingTier.BASIC,
            source: 'LISTING',
            listingId: listing.id,
        });
    }
    catch (regErr) {
        logger_1.log.warn({ listingId, err: regErr }, '[Listing] TokenRegistry auto-register failed');
    }
    return listing;
}
async function rejectListing(listingId) {
    const listing = await db_1.default.tokenListing.update({
        where: { id: listingId },
        data: { status: client_1.ListingStatus.REJECTED },
    });
    logger_1.log.warn({ listingId }, '[Listing] Listing rejected by admin');
    return listing;
}
async function getListingById(listingId) {
    return db_1.default.tokenListing.findUnique({
        where: { id: listingId },
        include: { liquidityLock: true },
    });
}
async function getListingByToken(tokenAddress) {
    return db_1.default.tokenListing.findUnique({
        where: { tokenAddress },
        include: { liquidityLock: true },
    });
}
async function getListings(params) {
    const { tier, status, limit = 50, offset = 0 } = params;
    return db_1.default.tokenListing.findMany({
        where: {
            ...(tier ? { tier } : {}),
            ...(status ? { status } : {}),
        },
        include: { liquidityLock: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
    });
}
async function getOwnerListings(ownerAddress) {
    return db_1.default.tokenListing.findMany({
        where: { ownerAddress },
        include: { liquidityLock: true },
        orderBy: { createdAt: 'desc' },
    });
}
async function processExpiredLocks() {
    const now = new Date();
    const expiredLocks = await db_1.default.liquidityLock.findMany({
        where: {
            status: client_1.LockStatus.LOCKED,
            unlockAt: { lte: now },
        },
        include: { listing: true },
    });
    for (const lock of expiredLocks) {
        await db_1.default.liquidityLock.update({
            where: { id: lock.id },
            data: { status: client_1.LockStatus.UNLOCKED },
        });
        logger_1.log.info({ lockId: lock.id, owner: lock.ownerAddress, token: lock.listing.tokenSymbol }, '[Listing] Lock expired — owner can now withdraw LP tokens');
    }
    return expiredLocks.length;
}
async function withdrawLock(lockId, ownerAddress, txHash) {
    const lock = await db_1.default.liquidityLock.findUnique({ where: { id: lockId } });
    if (!lock)
        throw new Error('Lock not found');
    if (lock.ownerAddress !== ownerAddress)
        throw new Error('Not the lock owner');
    if (lock.status === client_1.LockStatus.WITHDRAWN)
        throw new Error('Already withdrawn');
    if (lock.status === client_1.LockStatus.LOCKED && lock.unlockAt > new Date()) {
        throw new Error(`Lock expires at ${lock.unlockAt.toISOString()}`);
    }
    return db_1.default.liquidityLock.update({
        where: { id: lockId },
        data: {
            status: client_1.LockStatus.WITHDRAWN,
            withdrawnAt: new Date(),
            txHashUnlock: txHash,
        },
    });
}
async function getListingStats() {
    const [byTier, byStatus, totalLocked] = await Promise.all([
        db_1.default.tokenListing.groupBy({
            by: ['tier'],
            _count: { id: true },
        }),
        db_1.default.tokenListing.groupBy({
            by: ['status'],
            _count: { id: true },
        }),
        db_1.default.liquidityLock.aggregate({
            where: { status: client_1.LockStatus.LOCKED },
            _sum: { lunesLocked: true },
            _count: { id: true },
        }),
    ]);
    return {
        byTier,
        byStatus,
        totalLockedLunes: totalLocked._sum.lunesLocked?.toString() ?? '0',
        totalActiveLocks: totalLocked._count.id,
    };
}
//# sourceMappingURL=listingService.js.map