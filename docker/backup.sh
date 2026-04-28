#!/bin/sh
# Lunex DEX — PostgreSQL backup script
# Runs inside the db-backup container daily.
# Uploads to S3 (REQUIRED in production) and keeps a short local rotation.

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

# ── S3 upload is REQUIRED in production ────────────────────────────────────
# Local-only backup is unsafe — if the host dies, backups die with it. To
# allow local-only mode for dev/testing, set BACKUP_ALLOW_LOCAL_ONLY=true.
REQUIRE_S3=true
if [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" = "true" ]; then
  REQUIRE_S3=false
  echo "[backup] WARNING: BACKUP_ALLOW_LOCAL_ONLY=true — backups will not be uploaded off-host"
fi

if [ "${REQUIRE_S3}" = "true" ]; then
  if [ -z "${S3_BUCKET}" ]; then
    echo "[backup] FATAL: S3_BUCKET is required in production" >&2
    echo "  Set BACKUP_ALLOW_LOCAL_ONLY=true to override (NOT recommended for prod)" >&2
    exit 1
  fi
  if [ -z "${AWS_ACCESS_KEY_ID}" ] || [ -z "${AWS_SECRET_ACCESS_KEY}" ]; then
    echo "[backup] FATAL: AWS credentials are required when S3_BUCKET is set" >&2
    exit 1
  fi
fi

# Install AWS CLI on first run (postgres:15-alpine doesn't bundle it).
if [ -n "${S3_BUCKET}" ] && ! command -v aws >/dev/null 2>&1; then
  echo "[backup] Installing aws-cli (one-time setup)"
  apk add --no-cache aws-cli >/dev/null
fi

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

# Upload to S3
if [ -n "${S3_BUCKET}" ]; then
  aws s3 cp "${FILEPATH}" "s3://${S3_BUCKET}/postgres-backups/${FILENAME}" \
    --storage-class STANDARD_IA \
    --quiet
  echo "[backup] Uploaded to s3://${S3_BUCKET}/postgres-backups/${FILENAME}"

  # Prune old S3 backups beyond retention window
  S3_RETENTION_DAYS="${BACKUP_S3_RETENTION_DAYS:-30}"
  CUTOFF_DATE=$(date -u -d "${S3_RETENTION_DAYS} days ago" '+%Y-%m-%d' 2>/dev/null \
    || date -u -v-"${S3_RETENTION_DAYS}"d '+%Y-%m-%d')
  aws s3 ls "s3://${S3_BUCKET}/postgres-backups/" | \
    awk -v cutoff="${CUTOFF_DATE}" '$1 < cutoff {print $4}' | \
    while read -r old; do
      [ -n "${old}" ] && aws s3 rm "s3://${S3_BUCKET}/postgres-backups/${old}" --quiet
    done
fi

# Prune old local backups
find "${BACKUP_DIR}" -name "lunex_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] Pruned local backups older than ${RETENTION_DAYS} days"

echo "[backup] Done"
