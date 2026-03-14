# Lunex DEX — Deployment Guide

> Production deployment for the Lunex DEX stack.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 LTS | API runtime |
| PostgreSQL | ≥ 15 | Primary database |
| Redis | ≥ 7 | Nonce store, rate limiting |
| Docker | ≥ 24 | Container orchestration |
| PM2 | latest | Process management |

---

## Environment Configuration

Copy and fill the template for each service:

```bash
cp spot-api/.env.example spot-api/.env
```

### Required Variables (Production)

| Variable | How to Generate | Example |
|----------|----------------|---------|
| `DATABASE_URL` | From PostgreSQL provisioner | `postgresql://user:pass@db:5432/lunex` |
| `REDIS_URL` | From Redis provisioner | `redis://redis:6379` |
| `ADMIN_SECRET` | `openssl rand -base64 32` | — |
| `RELAYER_SEED` | Wallet mnemonic (12/24 words) | — |
| `LUNES_WS_URL` | Lunes node WebSocket RPC | `wss://rpc.lunes.io` |
| `FACTORY_CONTRACT_ADDRESS` | After contract deployment | `5XYZAbc...` |
| `SPOT_CONTRACT_ADDRESS` | After contract deployment | `5XYZDef...` |
| `CORS_ALLOWED_ORIGINS` | Production frontend URL | `https://dex.lunex.io` |

### Optional Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `SUBQUERY_ENDPOINT` | — | Recommended for analytics |
| `VAULT_RECONCILIATION_ENABLED` | `false` | Set to `true` in prod |
| `LOG_LEVEL` | `info` | `debug` in staging |
| `TRUST_PROXY` | `false` | Set `true` behind nginx/LB |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Requests per window |
| `NONCE_TTL_SECONDS` | `300` | Replay protection window |

---

## Database Setup

```bash
cd spot-api

# Apply all migrations
npx prisma migrate deploy

# Verify schema
npx prisma migrate status

# Generate client (if needed)
npx prisma generate
```

> ⚠️ **Never run `migrate reset` on production.** This drops and recreates the database.

---

## Docker Deployment (Recommended)

### Full Stack

```bash
# Production compose
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose logs -f spot-api

# Scale API instances
docker-compose up -d --scale spot-api=3
```

### Individual Services

```bash
# API only
docker build -f spot-api/Dockerfile -t lunex-api .
docker run -d \
  --env-file spot-api/.env \
  -p 4000:4000 \
  -p 4001:4001 \
  lunex-api

# Frontend
docker build -f lunes-dex-main/Dockerfile -t lunex-frontend .
docker run -d -p 3000:3000 lunex-frontend
```

---

## PM2 (Bare Metal)

```bash
# Install PM2 globally
npm install -g pm2

# Start services
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Save and enable startup
pm2 save
pm2 startup

# View logs
pm2 logs spot-api
```

`ecosystem.config.js` is pre-configured at the project root.

---

## nginx Reverse Proxy

```nginx
server {
    listen 443 ssl http2;
    server_name api.lunex.io;

    ssl_certificate /etc/letsencrypt/live/api.lunex.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.lunex.io/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

> Set `TRUST_PROXY=true` in `.env` when using nginx.

---

## Smart Contract Deployment

```bash
# Build contracts
cargo contract build --release

# Deploy factory
cargo contract instantiate \
  --contract ./artifacts/factory.wasm \
  --constructor new \
  --url wss://rpc.lunes.io \
  --suri "$RELAYER_SEED"

# Update .env with deployed addresses
FACTORY_CONTRACT_ADDRESS=<deployed-address>
```

---

## SubQuery Indexer

```bash
cd subquery-node

# Configure network in project.yaml
# Edit: endpoint, startBlock, dataSources

# Start indexer
docker-compose up -d

# SubQuery Studio URL: http://localhost:3000
```

Set `SUBQUERY_ENDPOINT=http://localhost:3000` in spot-api `.env`.

---

## Gerenciamento de Secrets em VPS (LEITURA OBRIGATÓRIA — INFRA)

> **Para quem:** pessoa responsável pelo deploy em VPS (Ubuntu/Debian/CentOS).
> Esta seção é sobre o `RELAYER_SEED` — a chave privada do relayer que assina transações on-chain.
> Um vazamento significa perda dos fundos da carteira do relayer.

### Por que é crítico

O `RELAYER_SEED` é equivalente à chave privada de uma carteira Substrate. Ele é usado pelo `spot-api` para assinar e enviar transações on-chain (liquidações de trades). Se vazar:
- O atacante controla a carteira do relayer
- Pode drenar o LUNES de gas dessa carteira
- Pode assinar transações fraudulentas

O servidor detecta seeds de desenvolvimento e **recusa iniciar em produção**:
```
FATAL: RELAYER_SEED is a development account — refusing to start in production
```
Seeds bloqueadas: `//Alice`, `//Bob`, `//Charlie`, `//Dave`, `//Eve`, `//Ferdie`

---

### Opção 1 — Arquivo `.env` com permissões restritas (mínimo viável para VPS)

Esta é a abordagem mais simples para uma VPS sem infraestrutura adicional.

```bash
# 1. Crie o arquivo .env fora do diretório do projeto (nunca dentro do git)
sudo mkdir -p /etc/lunex
sudo nano /etc/lunex/spot-api.env
```

Conteúdo do `/etc/lunex/spot-api.env`:
```env
NODE_ENV=production
RELAYER_SEED=minha frase mnemônica de doze palavras aqui
ADMIN_SECRET=<saída do comando abaixo>
DATABASE_URL=postgresql://lunex:senha@127.0.0.1:5432/lunex_prod
REDIS_URL=redis://:senha_redis@127.0.0.1:6379
LUNES_WS_URL=wss://rpc.lunes.io
FACTORY_CONTRACT_ADDRESS=5...
SPOT_CONTRACT_ADDRESS=5...
CORS_ALLOWED_ORIGINS=https://dex.lunex.io
TRUST_PROXY=true
```

Gere o `ADMIN_SECRET`:
```bash
openssl rand -base64 32
```

Restrinja as permissões do arquivo — **apenas o usuário que roda o processo pode ler**:
```bash
# Crie um usuário dedicado para o serviço (nunca rodar como root)
sudo useradd -r -s /bin/false lunex-api

# Dono: root, grupo: lunex-api, sem leitura por outros
sudo chown root:lunex-api /etc/lunex/spot-api.env
sudo chmod 640 /etc/lunex/spot-api.env

# Verifique
ls -la /etc/lunex/spot-api.env
# Esperado: -rw-r----- 1 root lunex-api ...
```

Configure o PM2 para usar o arquivo:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'spot-api',
    script: './spot-api/dist/index.js',
    user: 'lunex-api',          // roda como usuário sem privilégios
    env_file: '/etc/lunex/spot-api.env',
    restart_delay: 5000,
    max_restarts: 10,
  }]
}
```

Ou com Docker (passa o arquivo diretamente, nunca via `COPY` no Dockerfile):
```bash
docker run -d \
  --env-file /etc/lunex/spot-api.env \
  --name lunex-api \
  --restart always \
  -p 127.0.0.1:4000:4000 \
  lunex-api:latest
```

> ⚠️ **Nunca faça:** `cat /etc/lunex/spot-api.env` logado como root num terminal com histórico ativado.
> Limpe o histórico após manipular o arquivo: `history -c && history -w`

---

### Opção 2 — systemd com `EnvironmentFile` (recomendado para VPS bare metal)

Esta abordagem isola os secrets no systemd sem depender de PM2.

```bash
# /etc/systemd/system/lunex-api.service
[Unit]
Description=Lunex DEX API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=lunex-api
Group=lunex-api
WorkingDirectory=/opt/lunex/spot-api
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/etc/lunex/spot-api.env
Restart=always
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable lunex-api
sudo systemctl start lunex-api
sudo journalctl -u lunex-api -f
```

O systemd lê o `EnvironmentFile` e injeta as variáveis no processo — as variáveis não ficam visíveis em `ps aux` nem no histórico do shell.

---

### Opção 3 — Doppler ✅ Recomendado para VPS

Doppler é a opção mais segura sem precisar de AWS/GCP. Os secrets nunca tocam o disco da VPS — o CLI busca direto da API do Doppler e injeta no processo.

#### Passo 1 — Criar conta e projeto no Doppler

1. Acesse [doppler.com](https://doppler.com) e crie uma conta (free tier suficiente)
2. Crie um projeto chamado `lunex-dex`
3. O projeto já vem com 3 configs: `development`, `staging`, `production`
4. Em **production**, adicione os secrets:

| Secret | Valor |
|--------|-------|
| `RELAYER_SEED` | Mnemônico de 12/24 palavras da carteira relayer |
| `ADMIN_SECRET` | `openssl rand -base64 32` |
| `DB_PASSWORD` | Senha forte para o PostgreSQL |
| `REDIS_PASSWORD` | Senha forte para o Redis |
| `LUNES_WS_URL` | `wss://rpc.lunes.io` |
| `FACTORY_CONTRACT_ADDRESS` | Endereço do contrato factory |
| `CORS_ALLOWED_ORIGINS` | `https://dex.lunex.io` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` (para o painel admin) |
| `NEXTAUTH_URL` | `https://admin.lunex.io` |

#### Passo 2 — Gerar Service Token (para a VPS)

No Doppler: **Project → lunex-dex → production → Access → Service Tokens → Generate**

O token tem formato: `dp.st.prod.xxxxxxxxxxxx`

> Guarde este token com cuidado. É a "senha" que a VPS usa para buscar os outros secrets.

#### Passo 3 — Rodar o setup na VPS

```bash
# Na VPS, como root
git clone <repo> /opt/lunex
cd /opt/lunex

export DOPPLER_TOKEN=dp.st.prod.xxxxxxxxxxxx
sudo -E bash scripts/setup-doppler.sh
```

O script [`scripts/setup-doppler.sh`](../scripts/setup-doppler.sh):
- Instala a CLI do Doppler
- Valida que `RELAYER_SEED` e `ADMIN_SECRET` existem no projeto
- Cria o usuário de sistema `lunex-api` (sem shell, sem privilégios)
- Instala e habilita o serviço systemd que usa `doppler run --`
- Armazena o token em `/etc/lunex/doppler-token` com `chmod 600`

#### Passo 4 — Fazer deploy do código e iniciar

```bash
# Build
cd /opt/lunex/spot-api
npm ci --production=false
npm run build

# Iniciar serviço
sudo systemctl start lunex-api
sudo journalctl -u lunex-api -f
```

#### Passo 4b — Alternativa: Docker com Doppler

```bash
# Build das imagens
docker compose -f docker/docker-compose.doppler.yml build

# Subir tudo (Doppler injeta os secrets no processo do compose)
DOPPLER_TOKEN=dp.st.prod.xxxx doppler run -- \
  docker compose -f docker/docker-compose.doppler.yml up -d

# Verificar
docker compose -f docker/docker-compose.doppler.yml ps
docker compose -f docker/docker-compose.doppler.yml logs -f api
```

O arquivo [`docker/docker-compose.doppler.yml`](../docker/docker-compose.doppler.yml) usa as variáveis injetadas pelo Doppler — não há `env_file` em disco.

#### Rotação de secrets (sem redeploy)

```bash
# 1. Atualize o secret no painel do Doppler (web ou CLI)
doppler secrets set RELAYER_SEED "nova frase mnemônica aqui"

# 2. Reinicie o serviço para buscar o novo valor
sudo systemctl restart lunex-api

# 3. Verifique nos logs
sudo journalctl -u lunex-api -n 30
```

Vantagens sobre `.env` em disco:
- Secrets **nunca ficam em arquivo na VPS** (apenas o token em `/etc/lunex/doppler-token`)
- Rotação sem editar arquivo na VPS
- Audit log no Doppler de quem acessou/alterou o quê
- Revogação imediata: basta deletar o service token no painel

---

### Rotação do RELAYER_SEED (emergência ou rotina)

Se suspeitar que o seed foi comprometido:

```bash
# 1. Gere uma nova carteira (em máquina segura, offline se possível)
# Use subkey ou polkadot.js apps para gerar novo mnemônico

# 2. Transfira o LUNES de gas da carteira antiga para a nova ANTES de trocar

# 3. Atualize no Doppler (não precisa acessar a VPS)
doppler secrets set RELAYER_SEED "nova frase mnemônica aqui"

# 4. Reinicie o serviço
sudo systemctl restart lunex-api   # ou: doppler run -- pm2 restart lunex-api

# 5. Verifique nos logs que o servidor subiu sem FATAL
sudo journalctl -u lunex-api -n 50
```

---

### O que NUNCA fazer

| ❌ Errado | ✅ Correto |
|-----------|------------|
| `RELAYER_SEED=//Alice` em produção | Mnemônico de 12/24 palavras real |
| Commitar `.env` no git | `.env` no `.gitignore`, secrets em `/etc/lunex/` |
| Rodar API como `root` | Usuário dedicado `lunex-api` sem shell |
| Seed no `ecosystem.config.js` (commitado) | `env_file` apontando para `/etc/lunex/` |
| `echo $RELAYER_SEED` no terminal | Nunca imprimir o seed |
| Mesmo seed em staging e produção | Seeds diferentes por ambiente |

---

## Production Checklist

### Security
- [ ] `NODE_ENV=production`
- [ ] `ADMIN_SECRET` set (32+ random bytes via `openssl rand -base64 32`)
- [ ] `RELAYER_SEED` em `/etc/lunex/spot-api.env` com `chmod 640`, dono `root:lunex-api`
- [ ] `RELAYER_SEED` **não** é `//Alice`, `//Bob` nem nenhuma conta de dev (servidor rejeita no startup)
- [ ] `CORS_ALLOWED_ORIGINS` restrito ao domínio de produção
- [ ] Credenciais do banco não são defaults
- [ ] Redis com senha (`requirepass` no `redis.conf`)
- [ ] TLS/SSL ativo em todos os endpoints públicos
- [ ] API rodando como usuário `lunex-api` (não root)

### Reliability
- [ ] PostgreSQL with daily backups enabled
- [ ] Redis persistence enabled (`appendonly yes`)
- [ ] PM2 or Docker restart policy set to `always`
- [ ] `VAULT_RECONCILIATION_ENABLED=true`
- [ ] Health check endpoint responding: `GET /health`

### Observability
- [ ] Prometheus scraping `/metrics` every 15s
- [ ] Grafana dashboards configured
- [ ] Alerting on `redis_healthy=0`, p99 latency, error rate
- [ ] Log aggregation configured (Loki / CloudWatch / ELK)

### Blockchain
- [ ] Lunes node fully synced before starting API
- [ ] Contract addresses verified on-chain
- [ ] Relayer wallet funded with LUNES for gas
- [ ] `TRUST_PROXY=true` if behind load balancer

---

## Health Check

```bash
# API health
curl http://localhost:4000/health
# Expected: { "status": "ok", "db": "connected", "redis": "connected" }

# Metrics
curl http://localhost:4000/metrics | grep http_request_duration
```

---

## Rollback Procedure

```bash
# 1. Deploy previous version
git checkout <previous-tag>
yarn install --frozen-lockfile

# 2. Check for migration reversals (manual — Prisma has no built-in rollback)
# Review the last migration file and apply inverse SQL if needed
psql $DATABASE_URL < ./spot-api/prisma/rollback-<version>.sql

# 3. Restart services
pm2 restart all
```

> Always test rollback procedures in staging before production deploys.
