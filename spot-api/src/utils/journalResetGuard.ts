/**
 * Safety guard for scripts/reset-journal-vaults.ts (item 3).
 *
 * The reset deletes journal-only CopyVault rows, so it may only run against
 * an explicitly allowlisted, non-production database, and only executes when
 * `--confirm=<database name>` repeats the database it is connected to.
 * `lunex_spot` (the main database) is never in the allowlist.
 */

export const JOURNAL_RESET_ALLOWED_DATABASES: readonly string[] = [
  'lunex_spot_merge',
  'lunex_spot_testnet',
  'lunex_testnet',
];

export function databaseNameFromUrl(
  databaseUrl: string | undefined,
): string | null {
  if (!databaseUrl) return null;
  try {
    const name = decodeURIComponent(
      new URL(databaseUrl).pathname.replace(/^\/+/, ''),
    );
    return name || null;
  } catch {
    return null;
  }
}

export function assertJournalResetAllowed(input: {
  DATABASE_URL?: string;
  NODE_ENV?: string;
  confirm?: string;
}): { database: string; execute: boolean } {
  if (input.NODE_ENV === 'production') {
    throw new Error('Refusing to reset vault data with NODE_ENV=production');
  }
  const database = databaseNameFromUrl(input.DATABASE_URL);
  if (!database) {
    throw new Error('DATABASE_URL is missing or has no database name');
  }
  if (!JOURNAL_RESET_ALLOWED_DATABASES.includes(database)) {
    throw new Error(
      `Database "${database}" is not in the reset allowlist (${JOURNAL_RESET_ALLOWED_DATABASES.join(', ')})`,
    );
  }
  if (input.confirm === undefined) return { database, execute: false };
  if (input.confirm !== database) {
    throw new Error(
      `--confirm must repeat the connected database name ("${database}")`,
    );
  }
  return { database, execute: true };
}
