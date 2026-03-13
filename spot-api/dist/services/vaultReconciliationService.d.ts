/**
 * Vault State Reconciliation Service
 *
 * Runs periodically to detect and repair inconsistencies between
 * on-chain CopyVault state and the PostgreSQL database.
 *
 * Architecture:
 *   1. Query all CopyVaultDeposits and CopyVaultWithdrawals from the DB
 *   2. Sum expected equity = sum(deposits) - sum(grossWithdrawals)
 *   3. Compare with CopyVault.totalEquity in DB
 *   4. If drift detected beyond threshold → log and repair
 *
 * Note: On-chain query (via CopyVaultService) is used when the ABI is
 * available. When unavailable (e.g. ABI not deployed yet), the reconciler
 * falls back to pure DB-side consistency checks.
 */
export type ReconciliationResult = {
    vaultId: string;
    vaultName: string;
    expectedEquity: number;
    actualEquity: number;
    drift: number;
    repaired: boolean;
};
declare class VaultReconciliationService {
    private intervalHandle;
    private running;
    isEnabled(): boolean;
    start(): void;
    stop(): void;
    runCycle(): Promise<ReconciliationResult[]>;
    private reconcileVault;
}
export declare const vaultReconciliationService: VaultReconciliationService;
export {};
//# sourceMappingURL=vaultReconciliationService.d.ts.map