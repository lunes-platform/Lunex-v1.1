/**
 * Token Registry Service
 *
 * Unified, trusted token metadata. Auto-populated when listings are
 * activated. Supports manual admin entries for seed tokens (LUNES, USDT).
 */
export type RegisterTokenInput = {
    address: string;
    symbol: string;
    name: string;
    decimals?: number;
    logoURI?: string;
    isVerified?: boolean;
    isTrusted?: boolean;
    source?: string;
    listingId?: string;
};
export declare function registerToken(input: RegisterTokenInput): Promise<{
    symbol: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    address: string;
    source: string;
    isVerified: boolean;
    decimals: number;
    logoURI: string | null;
    isTrusted: boolean;
    listingId: string | null;
}>;
export declare function getToken(address: string): Promise<{
    symbol: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    address: string;
    source: string;
    isVerified: boolean;
    decimals: number;
    logoURI: string | null;
    isTrusted: boolean;
    listingId: string | null;
} | null>;
export declare function getAllTokens(params?: {
    verified?: boolean;
    trusted?: boolean;
}): Promise<{
    symbol: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    address: string;
    source: string;
    isVerified: boolean;
    decimals: number;
    logoURI: string | null;
    isTrusted: boolean;
    listingId: string | null;
}[]>;
export declare function searchTokens(query: string): Promise<{
    symbol: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    address: string;
    source: string;
    isVerified: boolean;
    decimals: number;
    logoURI: string | null;
    isTrusted: boolean;
    listingId: string | null;
}[]>;
export declare function deleteToken(address: string): Promise<{
    symbol: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    address: string;
    source: string;
    isVerified: boolean;
    decimals: number;
    logoURI: string | null;
    isTrusted: boolean;
    listingId: string | null;
}>;
//# sourceMappingURL=tokenRegistryService.d.ts.map