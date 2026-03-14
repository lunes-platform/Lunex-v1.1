#!/bin/sh
# Lunex DEX — PostgreSQL backup script
# Runs inside the db-backup container daily.
# Uploads to S3 if AWS credentials are set, otherwise keeps local.

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-lunex}"
DB_NAME="${DB_NAME:-lunex_spot}"
BACKUP_DIR="/backups"
FILENAME="lunex_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting backup of ${DB_NAME} at ${TIMESTAMP}"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  --no-owner \
  --no-acl \
  "${DB_NAME}" | gzip > "${FILEPATH}"

echo "[backup] Backup written to ${FILEPATH} ($(du -sh "${FILEPATH}" | cut -f1))"

# Upload to S3 if configured
if [ -n "${S3_BUCKET}" ] && [ -n "${AWS_ACCESS_KEY_ID}" ]; then
  aws s3 cp "${FILEPATH}" "s3://${S3_BUCKET}/postgres-backups/${FILENAME}" \
    --storage-class STANDARD_IA \
    --quiet
  echo "[backup] Uploaded to s3://${S3_BUCKET}/postgres-backups/${FILENAME}"
fi

# Prune old local backups
find "${BACKUP_DIR}" -name "lunex_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] Pruned local backups older than ${RETENTION_DAYS} days"

echo "[backup] Done"
