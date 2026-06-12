# Runbook: Database And Backup

## Alerts

- `PostgreSQLDown`
- `DatabaseBackupFailed`
- `DatabaseConnectionPoolExhausted`

## Impact

Orders, signed-read records, profiles, rewards, and operational audit data can be unavailable. If writes are partially failing, stop fund-moving workflows until consistency is understood.

## Triage

1. Check Postgres health, disk, CPU, memory, and connection count.
2. Check Prisma/API errors for connection pool exhaustion.
3. For backup alerts, confirm `lunex_last_backup_age_seconds` and S3 object freshness.
4. Verify the latest backup file integrity with `gzip -t` or `pg_restore --list`, depending on format.

## Mitigation

1. For transient connection exhaustion, restart API only after confirming DB is healthy.
2. For DB down, fail over or restore according to the current deployment topology.
3. For backup failure, run `docker/backup.sh` manually from the backup container and confirm upload.
4. Do not delete old backups until a newer backup has been integrity-checked.

## Restore Drill Requirements

Before public mainnet, run and record a scratch restore:

1. Restore latest S3 backup into isolated Postgres.
2. Verify row counts for orders, trades, users, nonces, rewards, and copytrade tables.
3. Measure RTO and document RPO.
4. Archive the drill log with the release candidate SHA.

