#!/usr/bin/env bash
# =============================================================================
# Lunex DEX — VPS Provisioning Script (OVH Ubuntu 22.04)
#
# Usage (first-time, root):
#   curl -sL https://raw.githubusercontent.com/your-org/lunex/main/scripts/provision-vps.sh | bash
#
# Or clone first:
#   git clone https://github.com/your-org/lunex.git /opt/lunex
#   chmod +x /opt/lunex/scripts/provision-vps.sh && sudo /opt/lunex/scripts/provision-vps.sh
#
# What this script does:
#   1. System update + essential packages
#   2. Create unprivileged deploy user (lunex)
#   3. Harden SSH (disable root login, key-only auth)
#   4. Configure UFW firewall
#   5. Install Fail2ban
#   6. Install Docker + Docker Compose plugin
#   7. Install Node.js 18 (for scripts)
#   8. Setup app directories + permissions
#   9. Configure log rotation
#  10. Enable automatic security updates
#  11. Install monitoring tools (node_exporter)
# =============================================================================
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[PROVISION]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# ── Must run as root ─────────────────────────────────────────────────────────
[[ "$EUID" -ne 0 ]] && err "Run as root: sudo $0"

# ── Variables (override via env) ──────────────────────────────────────────────
DEPLOY_USER="${DEPLOY_USER:-lunex}"
DEPLOY_HOME="/home/${DEPLOY_USER}"
APP_DIR="/opt/lunex"
LOG_DIR="/var/log/lunex"
SSH_PORT="${SSH_PORT:-22}"
DOMAIN="${DOMAIN:-lunex.lunes.io}"
DOMAIN_SANDBOX="${DOMAIN_SANDBOX:-lunex-sandbox.lunes.io}"
DOMAIN_TESTNET="${DOMAIN_TESTNET:-sandbox.lunes.io}"
GITHUB_ORG="${GITHUB_ORG:-your-org}"       # Replace with your GitHub org

log "============================================="
log " Lunex DEX — VPS Provisioning"
log " User: ${DEPLOY_USER} | Domains: ${DOMAIN}, ${DOMAIN_SANDBOX}, ${DOMAIN_TESTNET}"
log "============================================="

# ─────────────────────────────────────────────────────────────────────────────
# 1. SYSTEM UPDATE
# ─────────────────────────────────────────────────────────────────────────────
log "Step 1/11 — Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl wget git unzip jq \
    ca-certificates gnupg lsb-release \
    htop iotop ncdu tree \
    software-properties-common \
    apt-transport-https \
    ufw fail2ban \
    logrotate \
    unattended-upgrades \
    net-tools

# ─────────────────────────────────────────────────────────────────────────────
# 2. CREATE DEPLOY USER
# ─────────────────────────────────────────────────────────────────────────────
log "Step 2/11 — Creating deploy user '${DEPLOY_USER}'..."
if ! id "${DEPLOY_USER}" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo "${DEPLOY_USER}"
    # Lock password login — SSH key only
    passwd -l "${DEPLOY_USER}"
    log "User '${DEPLOY_USER}' created (password login disabled)"
else
    warn "User '${DEPLOY_USER}' already exists, skipping creation"
fi

# Setup .ssh directory
mkdir -p "${DEPLOY_HOME}/.ssh"
chmod 700 "${DEPLOY_HOME}/.ssh"

# If caller provides a public key via env, install it
if [[ -n "${DEPLOY_SSH_PUBKEY:-}" ]]; then
    echo "${DEPLOY_SSH_PUBKEY}" >> "${DEPLOY_HOME}/.ssh/authorized_keys"
    chmod 600 "${DEPLOY_HOME}/.ssh/authorized_keys"
    chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"
    log "SSH public key installed for ${DEPLOY_USER}"
else
    warn "No DEPLOY_SSH_PUBKEY set — add your key manually:"
    warn "  echo 'ssh-ed25519 AAAA...' >> ${DEPLOY_HOME}/.ssh/authorized_keys"
fi

# Sudo without password for deploy user (needed for CI/CD SSH deploy commands)
echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/local/bin/docker" \
    > "/etc/sudoers.d/90-${DEPLOY_USER}"
chmod 440 "/etc/sudoers.d/90-${DEPLOY_USER}"

# ─────────────────────────────────────────────────────────────────────────────
# 3. SSH HARDENING
# ─────────────────────────────────────────────────────────────────────────────
log "Step 3/11 — Hardening SSH..."
SSHD_CONFIG="/etc/ssh/sshd_config"

# Backup original
cp "${SSHD_CONFIG}" "${SSHD_CONFIG}.backup.$(date +%Y%m%d)"

cat > "${SSHD_CONFIG}" <<EOF
# =============================================================================
# Hardened SSH Configuration — Lunex DEX VPS
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# =============================================================================

Port ${SSH_PORT}
AddressFamily inet
ListenAddress 0.0.0.0

# ── Protocol & Crypto ────────────────────────────────────────────────────────
Protocol 2
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com

# ── Authentication ───────────────────────────────────────────────────────────
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

UsePAM yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30

AllowUsers ${DEPLOY_USER}

# ── Hardening ────────────────────────────────────────────────────────────────
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no
GatewayPorts no
PrintMotd no
PrintLastLog yes
Banner /etc/ssh/banner

# ── Timeouts & Limits ────────────────────────────────────────────────────────
ClientAliveInterval 300
ClientAliveCountMax 2
MaxSessions 5
MaxStartups 3:50:10

# ── SFTP ─────────────────────────────────────────────────────────────────────
Subsystem sftp /usr/lib/openssh/sftp-server -l INFO
EOF

# SSH banner
cat > /etc/ssh/banner <<'EOF'
=============================================================================
 LUNEX DEX — Authorized Access Only
 All activities are monitored and logged.
 Unauthorized access will be reported and prosecuted.
=============================================================================
EOF

# Validate and reload
sshd -t && systemctl reload sshd
log "SSH hardened (port ${SSH_PORT}, key-only, root login disabled)"

# ─────────────────────────────────────────────────────────────────────────────
# 4. UFW FIREWALL
# ─────────────────────────────────────────────────────────────────────────────
log "Step 4/11 — Configuring UFW firewall..."

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# SSH (custom port)
ufw allow "${SSH_PORT}/tcp" comment "SSH"

# HTTP/HTTPS (nginx)
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"

# Internal: monitoring only accessible from localhost (Prometheus/Grafana via nginx)
# PostgreSQL — NOT exposed externally (Docker internal network)
# Redis — NOT exposed externally

ufw --force enable
ufw status verbose
log "UFW enabled: SSH(${SSH_PORT}), HTTP(80), HTTPS(443) only"

# ─────────────────────────────────────────────────────────────────────────────
# 5. FAIL2BAN
# ─────────────────────────────────────────────────────────────────────────────
log "Step 5/11 — Configuring Fail2ban..."

cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend = systemd
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled  = true
port     = ${SSH_PORT}
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 86400
findtime = 600

[nginx-http-auth]
enabled  = true
port     = http,https
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 5

[nginx-noscript]
enabled  = true
port     = http,https
filter   = nginx-noscript
logpath  = /var/log/nginx/access.log
maxretry = 6

[nginx-req-limit]
enabled  = true
port     = http,https
filter   = nginx-req-limit
logpath  = /var/log/nginx/error.log
maxretry = 10
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban configured (SSH: 3 retries → 24h ban, nginx: 5-10 retries → 1h ban)"

# ─────────────────────────────────────────────────────────────────────────────
# 6. DOCKER + DOCKER COMPOSE
# ─────────────────────────────────────────────────────────────────────────────
log "Step 6/11 — Installing Docker..."

if ! command -v docker &>/dev/null; then
    # Official Docker install
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    # Enable + start
    systemctl enable docker
    systemctl start docker

    # Add deploy user to docker group
    usermod -aG docker "${DEPLOY_USER}"
    log "Docker $(docker --version) installed"
else
    warn "Docker already installed: $(docker --version)"
fi

# Docker daemon hardening
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true,
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  },
  "storage-driver": "overlay2"
}
EOF

systemctl reload docker

# ─────────────────────────────────────────────────────────────────────────────
# 7. NODE.JS 18 (for deployment scripts)
# ─────────────────────────────────────────────────────────────────────────────
log "Step 7/11 — Installing Node.js 18..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y -qq nodejs
    log "Node.js $(node --version) installed"
else
    warn "Node.js already installed: $(node --version)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. DIRECTORY STRUCTURE + PERMISSIONS
# ─────────────────────────────────────────────────────────────────────────────
log "Step 8/11 — Setting up app directories..."

# App + log directories
mkdir -p "${APP_DIR}"
mkdir -p "${LOG_DIR}"
mkdir -p "${APP_DIR}/backups"
mkdir -p "${APP_DIR}/certs"

# Ownership
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${LOG_DIR}"

# Clone repo if not already present
if [[ ! -d "${APP_DIR}/.git" ]]; then
    log "Cloning Lunex repository..."
    sudo -u "${DEPLOY_USER}" git clone \
        "https://github.com/${GITHUB_ORG}/lunex.git" \
        "${APP_DIR}" || warn "Could not clone — will need manual setup"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. LOG ROTATION
# ─────────────────────────────────────────────────────────────────────────────
log "Step 9/11 — Configuring log rotation..."

cat > /etc/logrotate.d/lunex <<EOF
${LOG_DIR}/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${DEPLOY_USER} ${DEPLOY_USER}
    sharedscripts
    postrotate
        docker compose -f ${APP_DIR}/docker/docker-compose.prod.yml \
            exec api kill -USR1 1 2>/dev/null || true
    endscript
}
EOF

# ─────────────────────────────────────────────────────────────────────────────
# 10. AUTOMATIC SECURITY UPDATES
# ─────────────────────────────────────────────────────────────────────────────
log "Step 10/11 — Enabling automatic security updates..."

cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "root";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

systemctl enable unattended-upgrades

# ─────────────────────────────────────────────────────────────────────────────
# 11. NODE EXPORTER (system metrics for Prometheus)
# ─────────────────────────────────────────────────────────────────────────────
log "Step 11/11 — Installing Node Exporter..."

NODE_EXPORTER_VER="1.7.0"
NODE_EXPORTER_URL="https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VER}/node_exporter-${NODE_EXPORTER_VER}.linux-amd64.tar.gz"

if ! command -v node_exporter &>/dev/null; then
    wget -qO /tmp/node_exporter.tar.gz "${NODE_EXPORTER_URL}"
    tar xzf /tmp/node_exporter.tar.gz -C /tmp
    mv "/tmp/node_exporter-${NODE_EXPORTER_VER}.linux-amd64/node_exporter" /usr/local/bin/
    rm -rf /tmp/node_exporter*

    # systemd service (binds only to localhost)
    cat > /etc/systemd/system/node_exporter.service <<'EOF'
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/node_exporter \
    --web.listen-address="127.0.0.1:9100" \
    --collector.disable-defaults \
    --collector.cpu \
    --collector.diskstats \
    --collector.filesystem \
    --collector.loadavg \
    --collector.meminfo \
    --collector.netdev \
    --collector.netstat \
    --collector.systemd \
    --collector.uname
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable node_exporter
    systemctl start node_exporter
    log "Node Exporter installed (localhost:9100)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# FINALIZE
# ─────────────────────────────────────────────────────────────────────────────
log ""
log "============================================="
log " ✅ Provisioning Complete!"
log "============================================="
log ""
log " NEXT STEPS:"
log ""
log " 1. Add SSH public key for deploy user:"
log "    echo 'ssh-ed25519 AAAA...' >> ${DEPLOY_HOME}/.ssh/authorized_keys"
log ""
log " 2. Copy production .env files to VPS:"
log "    scp docker/.env.prod.example ${DEPLOY_USER}@${DOMAIN}:${APP_DIR}/docker/.env.prod"
log "    scp docker/.env.sandbox.example ${DEPLOY_USER}@${DOMAIN}:${APP_DIR}/docker/.env.sandbox"
log "    # Then edit them: nano ${APP_DIR}/docker/.env.prod"
log ""
log " 3. Initial SSL certificates (run as ${DEPLOY_USER}):"
log "    cd ${APP_DIR}"
log "    # Start nginx first (HTTP only, no SSL block yet)"
log "    docker compose -f docker/docker-compose.prod.yml up -d nginx"
log "    docker compose -f docker/docker-compose.prod.yml run --rm certbot certonly \\"
log "      --webroot --webroot-path=/var/lib/letsencrypt \\"
log "      -d ${DOMAIN} -d ${DOMAIN_SANDBOX} -d ${DOMAIN_TESTNET} \\"
log "      --email admin@lunes.io --agree-tos --no-eff-email"
log ""
log " 4. Start all services (prod + sandbox):"
log "    cd ${APP_DIR}"
log "    docker compose -f docker/docker-compose.prod.yml \\"
log "      -f docker/docker-compose.sandbox.yml \\"
log "      --env-file docker/.env.prod --env-file docker/.env.sandbox up -d"
log ""
log " 5. Run initial DB migrations:"
log "    docker compose -f docker/docker-compose.prod.yml exec api npx prisma migrate deploy"
log "    docker compose -f docker/docker-compose.prod.yml -f docker/docker-compose.sandbox.yml \\"
log "      --env-file docker/.env.prod --env-file docker/.env.sandbox \\"
log "      exec sandbox-api npx prisma migrate deploy"
log ""
log " 6. Add GitHub Actions secrets:"
log "    VPS_HOST    = $(hostname -I | awk '{print $1}')"
log "    VPS_USER    = ${DEPLOY_USER}"
log "    VPS_SSH_KEY = (private key matching the public key above)"
log ""
log " Domains:"
log "    Production : https://${DOMAIN}"
log "    Sandbox    : https://${DOMAIN_SANDBOX}"
log "    Testnet RPC: https://${DOMAIN_TESTNET}"
log ""
log " Server info:"
log "    IP: $(hostname -I | awk '{print $1}')"
log "    UFW status: $(ufw status | head -1)"
log "    Docker: $(docker --version 2>/dev/null || echo 'not found')"
log ""

