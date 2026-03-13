/**
 * CopyVault On-Chain Service
 *
 * Handles real blockchain interactions with the CopyVault ink! smart contract.
 * Replaces the mock DB-only deposit/withdraw pattern in socialService.
 *
 * Flow:
 *   1. User signs deposit/withdraw request
 *   2. This service calls the CopyVault contract via Polkadot.js
 *   3. Waits for on-chain confirmation (inBlock or isFinalized)
 *   4. Returns the tx hash — caller updates DB only AFTER confirmation
 */
export interface VaultDepositResult {
    txHash: string;
    blockHash: string;
    shares: string;
    success: true;
}
export interface VaultWithdrawResult {
    txHash: string;
    blockHash: string;
    amount: string;
    success: true;
}
declare class CopyVaultService {
    private api;
    private relayer;
    private abi;
    private initPromise;
    private isConfigured;
    isEnabled(): boolean;
    ensureReady(): Promise<boolean>;
    private initialize;
    /**
     * Call the CopyVault contract's `deposit()` method on-chain.
     * The contract mints shares proportional to deposited amount.
     */
    deposit(vaultAddress: string, depositorAddress: string, amount: string): Promise<VaultDepositResult>;
    /**
     * Call the CopyVault contract's `withdraw()` method on-chain.
     * Burns shares and returns the proportional underlying tokens.
     */
    withdraw(vaultAddress: string, withdrawerAddress: string, shares: string): Promise<VaultWithdrawResult>;
}
export declare const copyVaultService: CopyVaultService;
export {};
//# sourceMappingURL=copyVaultService.d.ts.map