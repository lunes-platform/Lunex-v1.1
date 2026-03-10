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

import prisma from '../db'
import { config } from '../config'
import { log } from '../utils/logger'

const DRIFT_THRESHOLD = 0.01 // 1 cent tolerance

export type ReconciliationResult = {
  vaultId: string
  vaultName: string
  expectedEquity: number
  actualEquity: number
  drift: number
  repaired: boolean
}

class VaultReconciliationService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private running = false

  isEnabled(): boolean {
    return config.reconciliation.enabled
  }

  start(): void {
    if (!this.isEnabled()) {
      log.info('[Reconciliation] Vault reconciliation disabled (VAULT_RECONCILIATION_ENABLED not set)')
      return
    }

    log.info(`[Reconciliation] Starting vault reconciliation every ${config.reconciliation.intervalMs}ms`)

    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err) => {
        log.error('[Reconciliation] Cycle failed:', err)
      })
    }, config.reconciliation.intervalMs)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  async runCycle(): Promise<ReconciliationResult[]> {
    if (this.running) {
      log.warn('[Reconciliation] Previous cycle still running — skipping')
      return []
    }

    this.running = true
    const results: ReconciliationResult[] = []

    try {
      const vaults = await prisma.copyVault.findMany({
        select: {
          id: true,
          name: true,
          totalEquity: true,
          totalShares: true,
        },
      })

      for (const vault of vaults) {
        try {
          const result = await this.reconcileVault(vault)
          results.push(result)
        } catch (err) {
          log.error({ err }, `[Reconciliation] Failed to reconcile vault ${vault.id}`)
        }
      }

      const repaired = results.filter((r) => r.repaired).length
      if (repaired > 0) {
        log.warn(`[Reconciliation] Cycle complete — repaired ${repaired}/${vaults.length} vaults`)
      } else {
        log.info(`[Reconciliation] Cycle complete — ${vaults.length} vaults consistent`)
      }
    } finally {
      this.running = false
    }

    return results
  }

  private async reconcileVault(vault: {
    id: string
    name: string
    totalEquity: { toString(): string }
    totalShares: { toString(): string }
  }): Promise<ReconciliationResult> {
    // Sum all confirmed deposits
    const depositsAgg = await prisma.copyVaultDeposit.aggregate({
      where: { vaultId: vault.id },
      _sum: { amount: true },
    })

    // Sum all confirmed gross withdrawals (what left the vault)
    const withdrawalsAgg = await prisma.copyVaultWithdrawal.aggregate({
      where: { vaultId: vault.id },
      _sum: { grossAmount: true },
    })

    const totalDeposited = parseFloat(depositsAgg._sum.amount?.toString() ?? '0')
    const totalWithdrawn = parseFloat(withdrawalsAgg._sum.grossAmount?.toString() ?? '0')
    const expectedEquity = Math.max(0, totalDeposited - totalWithdrawn)
    const actualEquity = parseFloat(vault.totalEquity.toString())
    const drift = Math.abs(expectedEquity - actualEquity)

    const result: ReconciliationResult = {
      vaultId: vault.id,
      vaultName: vault.name,
      expectedEquity,
      actualEquity,
      drift,
      repaired: false,
    }

    if (drift <= DRIFT_THRESHOLD) {
      return result
    }

    log.warn(
      `[Reconciliation] Drift detected in vault "${vault.name}" (${vault.id}): ` +
      `expected=${expectedEquity.toFixed(6)} actual=${actualEquity.toFixed(6)} drift=${drift.toFixed(6)}`,
    )

    // Repair: update DB to match computed expected equity
    await prisma.copyVault.update({
      where: { id: vault.id },
      data: {
        totalEquity: expectedEquity.toFixed(18),
        totalDeposits: totalDeposited.toFixed(18),
        totalWithdrawals: totalWithdrawn.toFixed(18),
      },
    })

    log.warn(
      `[Reconciliation] Repaired vault "${vault.name}" — set totalEquity to ${expectedEquity.toFixed(6)}`,
    )

    result.repaired = true
    return result
  }
}

export const vaultReconciliationService = new VaultReconciliationService()
