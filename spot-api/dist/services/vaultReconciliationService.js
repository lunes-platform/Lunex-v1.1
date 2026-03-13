"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vaultReconciliationService = void 0;
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const DRIFT_THRESHOLD = 0.01; // 1 cent tolerance
class VaultReconciliationService {
    constructor() {
        this.intervalHandle = null;
        this.running = false;
    }
    isEnabled() {
        return config_1.config.reconciliation.enabled;
    }
    start() {
        if (!this.isEnabled()) {
            logger_1.log.info('[Reconciliation] Vault reconciliation disabled (VAULT_RECONCILIATION_ENABLED not set)');
            return;
        }
        logger_1.log.info(`[Reconciliation] Starting vault reconciliation every ${config_1.config.reconciliation.intervalMs}ms`);
        this.intervalHandle = setInterval(() => {
            this.runCycle().catch((err) => {
                logger_1.log.error('[Reconciliation] Cycle failed:', err);
            });
        }, config_1.config.reconciliation.intervalMs);
    }
    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    async runCycle() {
        if (this.running) {
            logger_1.log.warn('[Reconciliation] Previous cycle still running — skipping');
            return [];
        }
        this.running = true;
        const results = [];
        try {
            const vaults = await db_1.default.copyVault.findMany({
                select: {
                    id: true,
                    name: true,
                    totalEquity: true,
                    totalShares: true,
                },
            });
            for (const vault of vaults) {
                try {
                    const result = await this.reconcileVault(vault);
                    results.push(result);
                }
                catch (err) {
                    logger_1.log.error({ err }, `[Reconciliation] Failed to reconcile vault ${vault.id}`);
                }
            }
            const repaired = results.filter((r) => r.repaired).length;
            if (repaired > 0) {
                logger_1.log.warn(`[Reconciliation] Cycle complete — repaired ${repaired}/${vaults.length} vaults`);
            }
            else {
                logger_1.log.info(`[Reconciliation] Cycle complete — ${vaults.length} vaults consistent`);
            }
        }
        finally {
            this.running = false;
        }
        return results;
    }
    async reconcileVault(vault) {
        // Sum all confirmed deposits
        const depositsAgg = await db_1.default.copyVaultDeposit.aggregate({
            where: { vaultId: vault.id },
            _sum: { amount: true },
        });
        // Sum all confirmed gross withdrawals (what left the vault)
        const withdrawalsAgg = await db_1.default.copyVaultWithdrawal.aggregate({
            where: { vaultId: vault.id },
            _sum: { grossAmount: true },
        });
        const totalDeposited = parseFloat(depositsAgg._sum.amount?.toString() ?? '0');
        const totalWithdrawn = parseFloat(withdrawalsAgg._sum.grossAmount?.toString() ?? '0');
        const expectedEquity = Math.max(0, totalDeposited - totalWithdrawn);
        const actualEquity = parseFloat(vault.totalEquity.toString());
        const drift = Math.abs(expectedEquity - actualEquity);
        const result = {
            vaultId: vault.id,
            vaultName: vault.name,
            expectedEquity,
            actualEquity,
            drift,
            repaired: false,
        };
        if (drift <= DRIFT_THRESHOLD) {
            return result;
        }
        logger_1.log.warn(`[Reconciliation] Drift detected in vault "${vault.name}" (${vault.id}): ` +
            `expected=${expectedEquity.toFixed(6)} actual=${actualEquity.toFixed(6)} drift=${drift.toFixed(6)}`);
        // Repair: update DB to match computed expected equity
        await db_1.default.copyVault.update({
            where: { id: vault.id },
            data: {
                totalEquity: expectedEquity.toFixed(18),
                totalDeposits: totalDeposited.toFixed(18),
                totalWithdrawals: totalWithdrawn.toFixed(18),
            },
        });
        logger_1.log.warn(`[Reconciliation] Repaired vault "${vault.name}" — set totalEquity to ${expectedEquity.toFixed(6)}`);
        result.repaired = true;
        return result;
    }
}
exports.vaultReconciliationService = new VaultReconciliationService();
//# sourceMappingURL=vaultReconciliationService.js.map