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
import { ListingTier, ListingStatus } from '@prisma/client';
export declare const TIER_CONFIG: {
    readonly BASIC: {
        readonly tier: "BASIC";
        readonly tierNumber: 1;
        readonly label: "Basic";
        readonly listingFee: 1000;
        readonly minLunesLiq: 10000;
        readonly lockDays: 90;
        readonly lockMs: number;
        readonly badge: null;
        readonly description: "Entry-level listing. Token visible in search.";
    };
    readonly VERIFIED: {
        readonly tier: "VERIFIED";
        readonly tierNumber: 2;
        readonly label: "Verified";
        readonly listingFee: 5000;
        readonly minLunesLiq: 25000;
        readonly lockDays: 120;
        readonly lockMs: number;
        readonly badge: "verified";
        readonly description: "Verified badge, trending section, DEX highlight.";
    };
    readonly FEATURED: {
        readonly tier: "FEATURED";
        readonly tierNumber: 3;
        readonly label: "Featured";
        readonly listingFee: 20000;
        readonly minLunesLiq: 50000;
        readonly lockDays: 180;
        readonly lockMs: number;
        readonly badge: "featured";
        readonly description: "Home highlight, campaigns, reward incentives.";
    };
};
export type TierKey = keyof typeof TIER_CONFIG;
export declare function calcFeeDistribution(fee: number): {
    staking: number;
    treasury: number;
    rewards: number;
};
export type CreateListingInput = {
    ownerAddress: string;
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals?: number;
    tier: TierKey;
    lunesLiquidity: string;
    tokenLiquidity: string;
    description?: string;
    website?: string;
    pairAddress?: string;
    lpTokenAddress?: string;
    lpAmount?: string;
    txHash?: string;
    logoURI?: string;
};
export type ListingWithLock = Awaited<ReturnType<typeof getListingById>>;
export declare function getAllTierConfigs(): Promise<{
    tier: "BASIC" | "VERIFIED" | "FEATURED";
    tierNumber: 1 | 2 | 3;
    label: "Basic" | "Verified" | "Featured";
    listingFee: 1000 | 5000 | 20000;
    minLunesLiq: 10000 | 25000 | 50000;
    lockDays: 90 | 120 | 180;
    badge: "verified" | "featured" | null;
    description: "Entry-level listing. Token visible in search." | "Verified badge, trending section, DEX highlight." | "Home highlight, campaigns, reward incentives.";
    feeDistribution: {
        staking: number;
        treasury: number;
        rewards: number;
    };
}[]>;
export declare function createListing(input: CreateListingInput): Promise<{
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
}>;
export type ActivateListingInput = {
    onChainListingId?: number;
    pairAddress?: string;
    lpTokenAddress?: string;
    lpAmount?: string;
    txHash?: string;
};
export declare function activateListing(listingId: string, input?: ActivateListingInput): Promise<{
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
}>;
export declare function rejectListing(listingId: string): Promise<{
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
}>;
export declare function getListingById(listingId: string): Promise<({
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
}) | null>;
export declare function getListingByToken(tokenAddress: string): Promise<({
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
}) | null>;
export declare function getListings(params: {
    tier?: ListingTier;
    status?: ListingStatus;
    limit?: number;
    offset?: number;
}): Promise<({
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
})[]>;
export declare function getOwnerListings(ownerAddress: string): Promise<({
    liquidityLock: {
        id: string;
        status: import(".prisma/client").$Enums.LockStatus;
        createdAt: Date;
        updatedAt: Date;
        pairAddress: string;
        tier: import(".prisma/client").$Enums.ListingTier;
        listingId: string;
        ownerAddress: string;
        lpAmount: import("@prisma/client/runtime/library").Decimal;
        lpTokenAddress: string;
        lunesLocked: import("@prisma/client/runtime/library").Decimal;
        tokenLocked: import("@prisma/client/runtime/library").Decimal;
        unlockAt: Date;
        onChainLockId: number | null;
        txHashLock: string | null;
        txHashUnlock: string | null;
        withdrawnAt: Date | null;
    } | null;
} & {
    id: string;
    status: import(".prisma/client").$Enums.ListingStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string | null;
    txHash: string | null;
    tier: import(".prisma/client").$Enums.ListingTier;
    logoURI: string | null;
    tokenAddress: string;
    ownerAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    listingFee: import("@prisma/client/runtime/library").Decimal;
    lunesLiquidity: import("@prisma/client/runtime/library").Decimal;
    tokenLiquidity: import("@prisma/client/runtime/library").Decimal;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    onChainListingId: number | null;
    verifiedAt: Date | null;
})[]>;
export declare function processExpiredLocks(): Promise<number>;
export declare function withdrawLock(lockId: string, ownerAddress: string, txHash?: string): Promise<{
    id: string;
    status: import(".prisma/client").$Enums.LockStatus;
    createdAt: Date;
    updatedAt: Date;
    pairAddress: string;
    tier: import(".prisma/client").$Enums.ListingTier;
    listingId: string;
    ownerAddress: string;
    lpAmount: import("@prisma/client/runtime/library").Decimal;
    lpTokenAddress: string;
    lunesLocked: import("@prisma/client/runtime/library").Decimal;
    tokenLocked: import("@prisma/client/runtime/library").Decimal;
    unlockAt: Date;
    onChainLockId: number | null;
    txHashLock: string | null;
    txHashUnlock: string | null;
    withdrawnAt: Date | null;
}>;
export declare function getListingStats(): Promise<{
    byTier: (import(".prisma/client").Prisma.PickEnumerable<import(".prisma/client").Prisma.TokenListingGroupByOutputType, "tier"[]> & {
        _count: {
            id: number;
        };
    })[];
    byStatus: (import(".prisma/client").Prisma.PickEnumerable<import(".prisma/client").Prisma.TokenListingGroupByOutputType, "status"[]> & {
        _count: {
            id: number;
        };
    })[];
    totalLockedLunes: string;
    totalActiveLocks: number;
}>;
//# sourceMappingURL=listingService.d.ts.map