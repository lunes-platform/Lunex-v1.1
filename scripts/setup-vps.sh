#!/usr/bin/env bash
# =============================================================================
# Lunex DEX — VPS Setup & Hardening Script
# Ubuntu 22.04 LTS
#
# Usage (na VPS, como root):
#   curl -fsSL https://raw.githubusercontent.com/SEU_ORG/lunex/main/scripts/setup-vps.sh | sudo bash
#   # ou
#   sudo bash scripts/setup-vps.sh
#
# O que este script faz:
#   1. Atualiza o sistema e instala dependências
#   2. Cria usuário 'lunex' dedicado (sem senha root)
#   3. Endurece SSH (sem login por senha, sem root)
#   4. Configura UFW (firewall: só 22/80/443)
#   5. Instala fail2ban (bloqueia brute-force)
#   6. Instala Docker + Docker Compose
#   7. Clona o repositório em /opt/lunex
#   8. Cria env files com permissão 600
#   9. Configura logrotate e auditd
#  10. Instala unattended-upgrades (patches automáticos)
#
# NUNCA execute este script com valores de segredo hardcoded.
# Use o gen-secrets.sh localmente antes e copie via SCP.
# =============================================================================

set -euo pipefail

# ── Cores para output ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn] ${NC} $1"; }
err()  { echo -e "${RED}[error]${NC} $1" >&2; exit 1; }
step() { echo -e "\n${BLUE}══════════════════════════════════════════${NC}"; echo -e "${BLUE} $1${NC}"; echo -e "${BLUE}══════════════════════════════════════════${NC}"; }

# ── Verificações iniciais ─────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Execute como root: sudo bash $0"
[[ -f /etc/os-release ]] && source /etc/os-release
[[ "${ID:-}" != "ubuntu" ]] && warn "Testado em Ubuntu 22.04. Outros sistemas podem precisar de ajustes."

LUNEX_USER="${LUNEX_USER:-lunex}"
REPO_URL="${REPO_URL:-git@github.com:lunesproject/lunex.git}"
DEPLOY_DIR="/opt/lunex"
SSH_PORT="${SSH_PORT:-22}"

# ── 1. Atualizar sistema ──────────────────────────────────────────────────────
step "1. Atualizando sistema"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip jq \
  ufw fail2ban \
  auditd audispd-plugins \
  logrotate \
  ca-certificates gnupg lsb-release \
  unattended-upgrades apt-listchanges \
  htop iotop ncdu \
  openssl
log "Sistema atualizado ✅"

# ── 2. Criar usuário deploy ───────────────────────────────────────────────────
step "2. Criando usuário '${LUNEX_USER}'"
if id "${LUNEX_USER}" &>/dev/null; then
  log "Usuário '${LUNEX_USER}' já existe — pulando criação"
else
  useradd -m -s /bin/bash -G sudo,docker "${LUNEX_USER}" 2>/dev/null || true
  # Sem senha — só acesso via SSH key
  passwd -l "${LUNEX_USER}"
  log "Usuário '${LUNEX_USER}' criado (sem senha, só SSH key) ✅"
fi

# Copiar authorized_keys do root para o lunex user (se existir)
ROOT_KEYS="/root/.ssh/authorized_keys"
LUNEX_SSH_DIR="/home/${LUNEX_USER}/.ssh"
if [[ -f "$ROOT_KEYS" ]]; then
  mkdir -p "$LUNEX_SSH_DIR"
  cp "$ROOT_KEYS" "${LUNEX_SSH_DIR}/authorized_keys"
  chown -R "${LUNEX_USER}:${LUNEX_USER}" "$LUNEX_SSH_DIR"
  chmod 700 "$LUNEX_SSH_DIR"
  chmod 600 "${LUNEX_SSH_DIR}/authorized_keys"
  log "SSH keys copiadas para '${LUNEX_USER}' ✅"
fi

# ── 3. Endurecer SSH ──────────────────────────────────────────────────────────
step "3. Endurecendo SSH"
SSHD_CONFIG="/etc/ssh/sshd_config"

# Backup da config original
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

# Aplicar configurações seguras
cat > /etc/ssh/sshd_config.d/99-lunex-hardening.conf << 'EOF'
# Lunex SSH hardening
Protocol 2
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitEmptyPasswords no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem sftp /usr/lib/openssh/sftp-server
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers lunex
# Desabilitar métodos inseguros
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp521,ecdh-sha2-nistp384
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com
EOF

sshd -t && systemctl restart sshd
log "SSH endurecido ✅ (sem login por senha, sem root)"

# ── 4. Firewall UFW ───────────────────────────────────────────────────────────
step "4. Configurando firewall UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment "SSH"
ufw allow 80/tcp   comment "HTTP"
ufw allow 443/tcp  comment "HTTPS"
ufw --force enable
ufw status verbose
log "Firewall UFW configurado ✅"

# ── 5. Fail2ban ───────────────────────────────────────────────────────────────
step "5. Configurando fail2ban"
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ${SSH_PORT}
logpath = %(sshd_log)s

[nginx-http-auth]
enabled = true

[nginx-botsearch]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/access.log
maxretry = 2

[nginx-req-limit]
enabled = true
filter  = nginx-req-limit
port    = http,https
logpath = /var/log/nginx/error.log
maxretry = 10
EOF

# Filtro para rate limit do nginx
cat > /etc/fail2ban/filter.d/nginx-req-limit.conf << 'EOF'
[Definition]
failregex = limiting requests, excess:.* by zone.*client: <HOST>
ignoreregex =
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log "fail2ban configurado ✅"

# ── 6. Instalar Docker ────────────────────────────────────────────────────────
step "6. Instalando Docker"
if command -v docker &>/dev/null; then
  log "Docker já instalado: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Adicionar lunex user ao grupo docker
  usermod -aG docker "${LUNEX_USER}"

  # Habilitar e iniciar Docker
  systemctl enable docker
  systemctl start docker
  log "Docker instalado: $(docker --version) ✅"
fi

# Configurar Docker daemon (sem exposição de socket externa, log rotation)
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "icc": false,
  "no-new-privileges": true,
  "live-restore": true
}
EOF
systemctl reload docker || systemctl restart docker
log "Docker daemon endurecido ✅"

# ── 7. Criar diretório do projeto ──────────────────────────────────────────────
step "7. Preparando ${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}"
chown "${LUNEX_USER}:${LUNEX_USER}" "${DEPLOY_DIR}"
chmod 750 "${DEPLOY_DIR}"

if [[ -d "${DEPLOY_DIR}/.git" ]]; then
  log "Repositório já existe em ${DEPLOY_DIR} — pulando clone"
else
  log "Clone será feito pelo usuário '${LUNEX_USER}' após adicionar deploy key"
  log "  → Adicione a chave pública em GitHub Settings → Deploy Keys"
  log "  → Depois execute: sudo -u ${LUNEX_USER} git clone ${REPO_URL} ${DEPLOY_DIR}"
fi

# ── 8. Criar env files com permissões corretas ────────────────────────────────
step "8. Criando env files seguros"
ENV_DIR="${DEPLOY_DIR}/docker"
mkdir -p "${ENV_DIR}"

for ENV_FILE in .env.prod .env.sandbox; do
  EXAMPLE="${ENV_DIR}/${ENV_FILE}.example"
  TARGET="${ENV_DIR}/${ENV_FILE}"

  if [[ -f "$TARGET" ]]; then
    warn "${TARGET} já existe — NÃO sobrescrevendo (preservando segredos)"
  elif [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$TARGET"
    # Permissão restrita: só o dono pode ler
    chown "${LUNEX_USER}:${LUNEX_USER}" "$TARGET"
    chmod 600 "$TARGET"
    log "Criado ${TARGET} (chmod 600) — PREENCHA os valores CHANGE_ME ✅"
  else
    warn "${EXAMPLE} não encontrado — clone o repositório primeiro"
  fi
done

# Verificar se há valores CHANGE_ME não substituídos
if [[ -f "${ENV_DIR}/.env.prod" ]]; then
  UNFILLED=$(grep -c "CHANGE_ME" "${ENV_DIR}/.env.prod" 2>/dev/null || true)
  if [[ "$UNFILLED" -gt 0 ]]; then
    warn "${UNFILLED} variáveis com CHANGE_ME em .env.prod — preencha antes de subir"
    warn "  → nano ${ENV_DIR}/.env.prod"
  fi
fi

# ── 9. Auditd — rastrear acesso a arquivos de segredo ─────────────────────────
step "9. Configurando auditd"
cat > /etc/audit/rules.d/lunex.rules << EOF
# Lunex DEX — Audit rules
# Rastrear leitura dos env files (segredos)
-w ${DEPLOY_DIR}/docker/.env.prod    -p r -k lunex_secrets
-w ${DEPLOY_DIR}/docker/.env.sandbox -p r -k lunex_secrets

# Rastrear modificações no diretório de deploy
-w ${DEPLOY_DIR} -p wa -k lunex_deploy

# Rastrear logins SSH
-w /var/log/auth.log -p r -k lunex_auth

# Rastrear uso de sudo
-w /usr/bin/sudo -p x -k lunex_sudo
EOF

systemctl enable auditd
systemctl restart auditd
log "auditd configurado ✅ (acesso a segredos rastreado)"

# ── 10. Logrotate para Docker ──────────────────────────────────────────────────
step "10. Configurando logrotate"
cat > /etc/logrotate.d/lunex-docker << 'EOF'
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
EOF
log "logrotate configurado ✅"

# ── 11. Unattended-upgrades (patches de segurança automáticos) ────────────────
step "11. Ativando patches automáticos de segurança"
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "root";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

systemctl enable unattended-upgrades
log "unattended-upgrades ativado ✅"

# ── 12. Deploy key para CI/CD ─────────────────────────────────────────────────
step "12. Gerando deploy key SSH para CI/CD"
DEPLOY_KEY_PATH="/home/${LUNEX_USER}/.ssh/github_deploy"
if [[ ! -f "$DEPLOY_KEY_PATH" ]]; then
  sudo -u "${LUNEX_USER}" ssh-keygen -t ed25519 -f "$DEPLOY_KEY_PATH" -N "" -C "lunex-deploy@$(hostname)"
  log "Deploy key gerada ✅"
else
  log "Deploy key já existe"
fi

echo ""
echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW} PRÓXIMOS PASSOS MANUAIS OBRIGATÓRIOS:${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}1. Adicione esta chave pública no GitHub (Deploy Keys):${NC}"
cat "${DEPLOY_KEY_PATH}.pub"
echo ""
echo -e "${BLUE}2. Clone o repositório:${NC}"
echo "   sudo -u ${LUNEX_USER} git clone ${REPO_URL} ${DEPLOY_DIR}"
echo ""
echo -e "${BLUE}3. Gere os segredos localmente e copie para a VPS:${NC}"
echo "   # Na sua máquina local:"
echo "   bash scripts/gen-secrets.sh > secrets.env"
echo "   scp secrets.env ${LUNEX_USER}@VPS_IP:/tmp/secrets.env"
echo "   # Na VPS:"
echo "   sudo -u ${LUNEX_USER} bash -c 'cat /tmp/secrets.env >> ${DEPLOY_DIR}/docker/.env.prod'"
echo "   rm /tmp/secrets.env"
echo ""
echo -e "${BLUE}4. Preencha os segredos restantes (CHANGE_ME):${NC}"
echo "   sudo -u ${LUNEX_USER} nano ${DEPLOY_DIR}/docker/.env.prod"
echo "   sudo -u ${LUNEX_USER} nano ${DEPLOY_DIR}/docker/.env.sandbox"
echo ""
echo -e "${BLUE}5. Configure os GitHub Secrets (Settings → Secrets → Actions):${NC}"
echo "   VPS_HOST    = $(curl -s ifconfig.me 2>/dev/null || echo 'IP_DA_VPS')"
echo "   VPS_USER    = ${LUNEX_USER}"
echo "   VPS_SSH_KEY = (conteúdo de ~/.ssh/github_deploy no seu PC)"
echo ""
echo -e "${BLUE}6. Emita os certificados SSL:${NC}"
echo "   cd ${DEPLOY_DIR}"
echo "   docker compose -f docker/docker-compose.prod.yml up -d nginx certbot"
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN} Setup base concluído! ✅${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
