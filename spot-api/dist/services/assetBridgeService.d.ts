/**
 * Asset Bridge Service (Security Hardened)
 *
 * Relay-bridge service that monitors pallet-assets transfers to the bridge account
 * and mints PSP22 wrapper tokens. Also monitors WithdrawRequest events from wrapper
 * contracts and sends pallet-assets tokens back to users.
 *
 * SECURITY FEATURES:
 *   B-01: Uses FINALIZED blocks only (prevents block reorg double-mint)
 *   B-02: Persistent deduplication via file + on-chain deposit_ref
 *   B-03: Sequential nonce management (prevents nonce collision)
 *   B-04: ABI-based event decoding (not raw byte offsets)
 *   B-05: Pre-flight balance check before withdrawal
 *
 * Flow:
 *   WRAP:   user -> assets.transfer(bridge) -> relayer detects -> wrapper.mint_with_ref(user, amount, ref)
 *   UNWRAP: user -> wrapper.request_withdraw(amount) -> relayer detects -> assets.transfer(user, amount)
 */
interface BridgeAssetConfig {
    assetId: number;
    wrapperAddress: string;
    symbol: string;
}
interface BridgeConfig {
    wsEndpoint: string;
    adminSeed: string;
    assets: BridgeAssetConfig[];
    contractMetadataPath: string;
    stateFilePath: string;
}
export declare class AssetBridgeService {
    private config;
    private api;
    private adminAccount;
    private wrapperContracts;
    private running;
    private unsubscribeBlocks?;
    private state;
    private currentNonce;
    constructor(config: BridgeConfig);
    get bridgeAddress(): string;
    private loadState;
    private saveState;
    private makeDepositKey;
    private makeDepositRef;
    start(): Promise<void>;
    stop(): Promise<void>;
    private processDeposits;
    private processWithdrawals;
    /**
     * SEC B-05: Check pallet-asset balance of an account
     */
    private checkAssetBalance;
    /**
     * Call wrapper.mint_with_ref(to, amount, deposit_ref) as admin.
     * SEC B-02: Uses deposit_ref for on-chain deduplication (contract rejects duplicates).
     * SEC B-03: Uses sequential nonce management.
     */
    private mintWrappedTokens;
    /**
     * Send pallet-assets tokens from bridge account to user.
     * SEC B-03: Uses sequential nonce management.
     */
    private sendPalletAsset;
}
export declare function createBridgeFromEnv(): AssetBridgeService;
export {};
//# sourceMappingURL=assetBridgeService.d.ts.map