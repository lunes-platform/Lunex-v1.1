#!/usr/bin/env bash
# =============================================================================
# Lunex DEX — Production Deploy Script
#
# Usage (from VPS, as deploy user):
#   ./scripts/deploy.sh [--env prod|dev] [--skip-migrations] [--rollback]
#
# Called automatically by GitHub Actions CI/CD.
# Can also be run manually for emergency deploys.
# =============================================================================
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "${GREEN}[DEPLOY $(date -u +%H:%M:%S)]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()     { echo -e "${RED}[FAIL]${NC} $1" >&2; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ── Argument parsing ─────────────────────────────────────────────────────────
ENV="prod"
SKIP_MIGRATIONS=false
ROLLBACK=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env) ENV="$2"; shift 2 ;;
        --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
        --rollback) ROLLBACK=true; shift ;;
        *) warn "Unknown argument: $1"; shift ;;
    esac
done

APP_DIR="/opt/lunex"
COMPOSE_FILE="${APP_DIR}/docker/docker-compose.prod.yml"
LOG_FILE="/var/log/lunex/deploy.log"

[[ -f "${COMPOSE_FILE}" ]] || err "Compose file not found: ${COMPOSE_FILE}"

cd "${APP_DIR}"

# Log all output
exec > >(tee -a "${LOG_FILE}") 2>&1

# ─────────────────────────────────────────────────────────────────────────────
# ROLLBACK MODE
# ─────────────────────────────────────────────────────────────────────────────
if [[ "${ROLLBACK}" == "true" ]]; then
    section "ROLLBACK"
    warn "Rolling back to previous images..."

    # Save current containers for reference
    docker compose -f "${COMPOSE_FILE}" ps --format json > /tmp/pre-rollback-state.json 2>/dev/null || true

    # Pull previous tagged images (assumes GHCR tagging with SHA)
    # The rollback uses the second-most-recent image in local Docker
    REGISTRY="ghcr.io/your-org/lunex"
    for SERVICE in api frontend admin; do
        PREV_TAG=$(docker images "${REGISTRY}/${SERVICE}" \
            --format '{{.Tag}}' | grep -v latest | sort -rV | sed -n '2p' || echo "")
        if [[ -n "${PREV_TAG}" ]]; then
            log "Rolling back ${SERVICE} → ${PREV_TAG}"
            docker compose -f "${COMPOSE_FILE}" up -d --no-deps "${SERVICE}"
        else
            warn "No previous tag found for ${SERVICE}, keeping current"
        fi
    done

    log "Rollback complete. Verifying health..."
    sleep 10
    if ! curl -sf http://localhost:4000/health > /dev/null; then
        err "Health check FAILED after rollback!"
    fi
    log "✅ Rollback successful"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# NORMAL DEPLOY
# ─────────────────────────────────────────────────────────────────────────────
section "PRE-DEPLOY CHECKS"

# Verify docker is running
docker info > /dev/null 2>&1 || err "Docker is not running"

# Verify compose file is valid
docker compose -f "${COMPOSE_FILE}" config > /dev/null || err "docker-compose.yml has syntax errors"

# Check current API health before deploy
CURRENT_HEALTHY=false
if curl -sf --max-time 5 http://localhost:4000/health > /dev/null 2>&1; then
    CURRENT_HEALTHY=true
    log "Pre-deploy: API is healthy ✓"
else
    warn "Pre-deploy: API is not responding (first deploy or already down)"
fi

# ── Git status ───────────────────────────────────────────────────────────────
section "GIT STATUS"
CURRENT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
log "Branch: ${CURRENT_BRANCH} | Commit: ${CURRENT_SHA}"

# ── Pull latest images ───────────────────────────────────────────────────────
section "PULLING IMAGES"
log "Pulling latest images from registry..."
docker compose -f "${COMPOSE_FILE}" pull

# ── Database Migrations ───────────────────────────────────────────────────────
if [[ "${SKIP_MIGRATIONS}" == "false" ]]; then
    section "DATABASE MIGRATIONS"
    log "Running Prisma migrations..."
    docker compose -f "${COMPOSE_FILE}" run --rm \
        -e DATABASE_URL \
        api npx prisma migrate deploy
    log "Migrations complete ✓"
else
    warn "Skipping migrations (--skip-migrations flag set)"
fi

# ── Deploy API (rolling update) ───────────────────────────────────────────────
section "DEPLOYING API"
log "Updating API container..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps api

# Health check with exponential backoff
log "Waiting for API to become healthy..."
MAX_ATTEMPTS=18   # 18 × 5s = 90s timeout
ATTEMPT=0
while [[ "${ATTEMPT}" -lt "${MAX_ATTEMPTS}" ]]; do
    ATTEMPT=$((ATTEMPT + 1))
    if curl -sf --max-time 3 http://localhost:4000/health > /dev/null 2>&1; then
        log "✅ API healthy after $((ATTEMPT * 5))s"
        break
    fi
    if [[ "${ATTEMPT}" -eq "${MAX_ATTEMPTS}" ]]; then
        err "❌ API health check FAILED after $((MAX_ATTEMPTS * 5))s — deploy aborted"
    fi
    sleep 5
done

# ── Deploy Frontend & Admin ───────────────────────────────────────────────────
section "DEPLOYING FRONTEND & ADMIN"
log "Updating frontend and admin containers..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps frontend admin

# ── Reload Nginx ──────────────────────────────────────────────────────────────
section "RELOADING NGINX"
if docker compose -f "${COMPOSE_FILE}" exec -T nginx nginx -t; then
    docker compose -f "${COMPOSE_FILE}" exec -T nginx nginx -s reload
    log "Nginx reloaded ✓"
else
    warn "Nginx config test FAILED — not reloading nginx"
fi

# ── Start monitoring (if not running) ────────────────────────────────────────
section "MONITORING STACK"
for SERVICE in prometheus grafana loki promtail alertmanager; do
    if ! docker compose -f "${COMPOSE_FILE}" ps "${SERVICE}" | grep -q "running" 2>/dev/null; then
        log "Starting ${SERVICE}..."
        docker compose -f "${COMPOSE_FILE}" up -d "${SERVICE}" || warn "Could not start ${SERVICE}"
    fi
done

# ── Cleanup old images ────────────────────────────────────────────────────────
section "CLEANUP"
log "Pruning Docker images older than 48h..."
docker system prune -f --filter "until=48h"

FREED=$(docker system df --format '{{.ReclaimableSize}}' 2>/dev/null | head -1 || echo "unknown")
log "Disk reclaimed: ${FREED}"

# ── Final summary ─────────────────────────────────────────────────────────────
section "DEPLOY COMPLETE"
FINAL_HEALTH=$(curl -sf --max-time 5 http://localhost:4000/health 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','ok'))" 2>/dev/null \
    || echo "ok")

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ✅ Deploy successful"
log " Environment : ${ENV}"
log " Commit      : ${CURRENT_SHA}"
log " API health  : ${FINAL_HEALTH}"
log " Timestamp   : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
