#!/usr/bin/env bash
# =============================================================================
# Lunex DEX — Gerador de Segredos
#
# Gera TODOS os segredos necessários para produção de forma criptograficamente
# segura. Execute LOCALMENTE, nunca na VPS diretamente.
#
# Uso:
#   bash scripts/gen-secrets.sh                  # imprime no terminal
#   bash scripts/gen-secrets.sh > secrets.env    # salva em arquivo
#
# Depois copie para a VPS via SCP (NUNCA via git):
#   scp secrets.env lunex@VPS_IP:/tmp/
#   # Na VPS: cat /tmp/secrets.env >> /opt/lunex/docker/.env.prod
#   # Na VPS: shred -u /tmp/secrets.env
#
# NUNCA commite o arquivo gerado. O .gitignore já protege, mas confirme.
# =============================================================================

set -euo pipefail

# Verificar dependências
command -v openssl >/dev/null 2>&1 || { echo "openssl não encontrado" >&2; exit 1; }

# Gera string aleatória base64 segura
gen() {
  local bytes="${1:-32}"
  openssl rand -base64 "$bytes" | tr -d '\n/+=' | head -c "$((bytes * 4 / 3))"
}

# Gera string aleatória hex segura
gen_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

echo "# ═══════════════════════════════════════════════════════"
echo "# Lunex DEX — Segredos Gerados em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# NUNCA commite este arquivo. Apague após uso."
echo "# ═══════════════════════════════════════════════════════"
echo ""

echo "# ── Banco de dados ──────────────────────────────────────"
echo "DB_PASSWORD=$(gen 32)"
echo "SANDBOX_DB_PASSWORD=$(gen 32)"
echo ""

echo "# ── Next.js Admin (NextAuth) ───────────────────────────"
echo "NEXTAUTH_SECRET=$(gen 48)"
echo ""

echo "# ── Grafana ────────────────────────────────────────────"
echo "GRAFANA_ADMIN_PASSWORD=$(gen 24)"
echo ""

echo "# ── API Admin Secret (listing approval) ────────────────"
echo "ADMIN_SECRET=$(gen_hex 32)"
echo ""

echo "# ── Redis (opcional, se auth habilitado) ───────────────"
echo "REDIS_PASSWORD=$(gen 32)"
echo ""

echo "# ── JWT / API Token (se necessário) ────────────────────"
echo "JWT_SECRET=$(gen 48)"
echo ""

echo "# ── Alertmanager / SMTP (preencha manualmente) ─────────"
echo "# SLACK_WEBHOOK_OPS="
echo "# SLACK_WEBHOOK_CRITICAL="
echo "# SLACK_WEBHOOK_SECURITY="
echo "# SMTP_USER="
echo "# SMTP_PASSWORD="
echo ""

echo "# ── Relayer Seeds (GERAR COM CARTEIRAS REAIS) ──────────"
echo "# ATENÇÃO: NÃO use //Alice nem seeds de dev em produção!"
echo "# Gere uma seed real com: subkey generate --scheme sr25519"
echo "# ou via Polkadot.js extension → Create Account → export"
echo "# RELAYER_SEED="
echo "# SANDBOX_RELAYER_SEED="
echo ""

echo "# ── Backup S3 (opcional) ────────────────────────────────"
echo "# AWS_ACCESS_KEY_ID="
echo "# AWS_SECRET_ACCESS_KEY="
echo "# BACKUP_S3_BUCKET="
echo ""

echo "# ═══════════════════════════════════════════════════════"
echo "# Fim dos segredos gerados em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# ═══════════════════════════════════════════════════════"
