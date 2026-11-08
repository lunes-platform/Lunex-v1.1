// Item 3: the testnet reset of journal-only vault data is destructive, so the
// script must refuse to run anywhere but an allowlisted, non-production DB,
// and only with an explicit confirmation naming that DB.
import {
  assertJournalResetAllowed,
  databaseNameFromUrl,
} from '../utils/journalResetGuard';

const url = (db: string) =>
  `postgresql://lunex:pw@127.0.0.1:5432/${db}?schema=public`;

describe('databaseNameFromUrl', () => {
  it('extracts the database name without query params', () => {
    expect(databaseNameFromUrl(url('lunex_spot_merge'))).toBe(
      'lunex_spot_merge',
    );
  });

  it('returns null for missing or malformed urls', () => {
    expect(databaseNameFromUrl(undefined)).toBeNull();
    expect(databaseNameFromUrl('not a url')).toBeNull();
    expect(databaseNameFromUrl('postgresql://h:5432/')).toBeNull();
  });
});

describe('assertJournalResetAllowed', () => {
  const ok = {
    DATABASE_URL: url('lunex_spot_merge'),
    NODE_ENV: 'development',
    confirm: 'lunex_spot_merge',
  };

  it('allows an allowlisted non-production database with matching confirm', () => {
    expect(assertJournalResetAllowed(ok)).toEqual({
      database: 'lunex_spot_merge',
      execute: true,
    });
  });

  it('is a dry run without --confirm', () => {
    expect(assertJournalResetAllowed({ ...ok, confirm: undefined })).toEqual({
      database: 'lunex_spot_merge',
      execute: false,
    });
  });

  it('refuses in production', () => {
    expect(() =>
      assertJournalResetAllowed({ ...ok, NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });

  it('refuses the main lunex_spot database even if confirmed', () => {
    expect(() =>
      assertJournalResetAllowed({
        ...ok,
        DATABASE_URL: url('lunex_spot'),
        confirm: 'lunex_spot',
      }),
    ).toThrow(/not in the reset allowlist/);
  });

  it('refuses a database outside the allowlist', () => {
    expect(() =>
      assertJournalResetAllowed({
        ...ok,
        DATABASE_URL: url('lunex_prod'),
        confirm: 'lunex_prod',
      }),
    ).toThrow(/not in the reset allowlist/);
  });

  it('refuses a confirm that names another database', () => {
    expect(() =>
      assertJournalResetAllowed({ ...ok, confirm: 'lunex_testnet' }),
    ).toThrow(/--confirm/);
  });

  it('refuses without DATABASE_URL', () => {
    expect(() =>
      assertJournalResetAllowed({ ...ok, DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/);
  });
});
