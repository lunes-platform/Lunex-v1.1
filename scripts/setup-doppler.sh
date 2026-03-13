#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Lunex DEX — Doppler setup para VPS (Ubuntu/Debian)
#
#  Execute uma vez na VPS como root (ou com sudo):
#    sudo bash scripts/setup-doppler.sh
#
#  O script:
#    1. Instala a CLI do Doppler
#    2. Autentica com o service token (DOPPLER_TOKEN obrigatório)
#    3. Cria o usuário de sistema lunex-api
#    4. Registra o serviço via systemd (ou PM2, conforme escolha)
#    5. Valida a configuração antes de subir
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Pré-requisitos ────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || error "Execute como root: sudo bash $0"

: "${DOPPLER_TOKEN:?}" \
  || error "Defina DOPPLER_TOKEN antes de rodar:\n  export DOPPLER_TOKEN=dp.st.prod.xxxx\n  sudo -E bash $0"

APP_DIR="${APP_DIR:-/opt/lunex/spot-api}"
APP_USER="lunex-api"
LOG_DIR="/var/log/lunex"
SERVICE_NAME="lunex-api"

# ── 1. Instalar Doppler CLI ───────────────────────────────────────────────────

info "Instalando Doppler CLI..."

if command -v doppler &>/dev/null; then
  info "Doppler já instalado: $(doppler --version)"
else
  apt-get update -qq
  apt-get install -y -qq apt-transport-https ca-certificates curl gnupg

  curl -sLf --retry 3 \
    "https://cli.doppler.com/install.sh" \
    | sh

  info "Doppler instalado: $(doppler --version)"
fi

# ── 2. Configurar Service Token ───────────────────────────────────────────────

info "Configurando service token do Doppler..."

# Salva o token de forma segura no diretório de configuração do doppler
# (Não em .env — essa é a vantagem do Doppler)
doppler configure set token "$DOPPLER_TOKEN" --scope /

# Valida que consegue buscar os secrets
info "Validando acesso aos secrets..."
doppler secrets --only-names 2>/dev/null | grep -q "RELAYER_SEED" \
  || error "RELAYER_SEED não encontrado no projeto Doppler.\nVerifique se o token tem acesso ao config 'production'."

doppler secrets --only-names 2>/dev/null | grep -q "ADMIN_SECRET" \
  || error "ADMIN_SECRET não encontrado no projeto Doppler."

info "Secrets validados com sucesso."

# ── 3. Criar usuário de sistema ───────────────────────────────────────────────

info "Configurando usuário $APP_USER..."

if id "$APP_USER" &>/dev/null; then
  info "Usuário $APP_USER já existe."
else
  useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
  info "Usuário $APP_USER criado."
fi

# ── 4. Criar diretórios ───────────────────────────────────────────────────────

info "Criando diretórios..."
mkdir -p "$LOG_DIR"
chown "$APP_USER":"$APP_USER" "$LOG_DIR"
mkdir -p "$APP_DIR"

# ── 5. Instalar serviço systemd ───────────────────────────────────────────────

info "Configurando serviço systemd..."

# O DOPPLER_TOKEN fica APENAS neste arquivo, com permissões restritas.
# O systemd injeta ele como variável de ambiente para o processo doppler run.
TOKEN_FILE="/etc/lunex/doppler-token"
mkdir -p /etc/lunex
echo "DOPPLER_TOKEN=$DOPPLER_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
chown root:root "$TOKEN_FILE"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Lunex DEX API (via Doppler)
Documentation=https://github.com/lunexdex/lunex
After=network-online.target postgresql.service redis.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR

# Doppler injeta os secrets como variáveis de ambiente — nenhum arquivo .env em disco
EnvironmentFile=$TOKEN_FILE
ExecStartPre=/usr/bin/doppler run -- npx prisma migrate deploy
ExecStart=/usr/bin/doppler run -- node dist/index.js

Restart=always
RestartSec=5
StandardOutput=append:$LOG_DIR/api-out.log
StandardError=append:$LOG_DIR/api-error.log

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$LOG_DIR $APP_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

info "Serviço $SERVICE_NAME configurado."

# ── 6. Resumo ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup concluído!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  Token armazenado em : $TOKEN_FILE (chmod 600)"
echo "  Serviço systemd     : $SERVICE_NAME"
echo "  Logs                : $LOG_DIR/"
echo ""
echo "  Próximos passos:"
echo ""
echo "  1. Faça o deploy do código em $APP_DIR"
echo "     (cd $APP_DIR && npm ci --production && npm run build)"
echo ""
echo "  2. Inicie o serviço:"
echo "     sudo systemctl start $SERVICE_NAME"
echo ""
echo "  3. Verifique o status:"
echo "     sudo systemctl status $SERVICE_NAME"
echo "     sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "  4. Para rotacionar o token Doppler:"
echo "     sudo bash $0   # com novo DOPPLER_TOKEN exportado"
echo ""
