/**
 * Testnet reset of journal-only CopyVault data (item 3, after BE-01/BE-02).
 *
 * Before BE-01/BE-02 the API credited vault deposits from the request body
 * ("db-journal") or from relayer-signed txs. Those rows have no finalized
 * follower-signed proof — every pre-fix row has `blockHash = NULL` (the column
 * was added by migration 20261107130000_copyvault_tx_proof_and_follower_stoploss)
 * — so their equity/shares are fictitious and must not survive into the beta.
 *
 * What it does (per affected vault):
 *   1. archives the vault, its positions, unproven deposits and withdrawals to
 *      a JSON file (default ./journal-vault-reset-<timestamp>.json);
 *   2. deletes unproven CopyVaultDeposit / CopyVaultWithdrawal rows
 *      (`blockHash IS NULL`);
 *   3. deletes the vault's CopyVaultPosition rows and zeroes the vault totals;
 *   4. zeroes `Leader.totalAum` of the affected leaders.
 * Signals, executions and affiliate commissions are left untouched (history).
 *
 * Affected vault = has unproven deposits/withdrawals, OR has no contract and
 * non-zero totals.
 *
 * SAFETY (src/utils/journalResetGuard.ts): refuses NODE_ENV=production and any
 * database outside the allowlist (`lunex_spot` is never allowed). Dry run by
 * default; executes only with --confirm=<connected database name>.
 *
 * Run (dry):  npx ts-node scripts/reset-journal-vaults.ts
 * Run (real): npx ts-node scripts/reset-journal-vaults.ts --confirm=lunex_spot_merge [--archive=path.json]
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { Prisma } from '@prisma/client';
import { assertJournalResetAllowed } from '../src/utils/journalResetGuard';

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  // Guard BEFORE importing the Prisma client (no connection is opened when
  // the target database is not allowed).
  const guard = assertJournalResetAllowed({
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    confirm: readFlag('confirm'),
  });
  const { default: prisma } = await import('../src/db');

  try {
    const unprovenDeposits = await prisma.copyVaultDeposit.findMany({
      where: { blockHash: null },
    });
    const unprovenWithdrawals = await prisma.copyVaultWithdrawal.findMany({
      where: { blockHash: null },
    });
    const taintedIds = new Set<string>([
      ...unprovenDeposits.map((d) => d.vaultId),
      ...unprovenWithdrawals.map((w) => w.vaultId),
    ]);
    const nonZero = { not: new Prisma.Decimal(0) };
    const vaults = await prisma.copyVault.findMany({
      where: {
        OR: [
          { id: { in: [...taintedIds] } },
          {
            contractAddress: null,
            OR: [
              { totalShares: nonZero },
              { totalEquity: nonZero },
              { totalDeposits: nonZero },
              { totalWithdrawals: nonZero },
            ],
          },
        ],
      },
      include: { positions: true },
    });
    const vaultIds = vaults.map((v) => v.id);
    const leaderIds = [...new Set(vaults.map((v) => v.leaderId))];

    console.log(
      JSON.stringify(
        {
          database: guard.database,
          mode: guard.execute ? 'EXECUTE' : 'DRY_RUN',
          affectedVaults: vaultIds.length,
          positionsToDelete: vaults.reduce((n, v) => n + v.positions.length, 0),
          unprovenDeposits: unprovenDeposits.length,
          unprovenWithdrawals: unprovenWithdrawals.length,
          leadersToZeroAum: leaderIds.length,
        },
        null,
        2,
      ),
    );

    if (!guard.execute) {
      console.log(
        `Dry run only. Re-run with --confirm=${guard.database} to apply.`,
      );
      return;
    }
    if (vaultIds.length === 0 && unprovenDeposits.length === 0) {
      console.log('Nothing to reset.');
      return;
    }

    const archivePath = resolve(
      readFlag('archive') ??
        `journal-vault-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(
      archivePath,
      JSON.stringify(
        {
          database: guard.database,
          createdAt: new Date().toISOString(),
          vaults,
          unprovenDeposits,
          unprovenWithdrawals,
        },
        null,
        2,
      ),
    );
    console.log(`Archived to ${archivePath}`);

    const zero = new Prisma.Decimal(0);
    await prisma.$transaction([
      prisma.copyVaultWithdrawal.deleteMany({ where: { blockHash: null } }),
      prisma.copyVaultDeposit.deleteMany({ where: { blockHash: null } }),
      prisma.copyVaultPosition.deleteMany({
        where: { vaultId: { in: vaultIds } },
      }),
      prisma.copyVault.updateMany({
        where: { id: { in: vaultIds } },
        data: {
          totalEquity: zero,
          totalShares: zero,
          totalDeposits: zero,
          totalWithdrawals: zero,
        },
      }),
      prisma.leader.updateMany({
        where: { id: { in: leaderIds } },
        data: { totalAum: zero },
      }),
    ]);
    console.log('Journal-only vault data reset.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
