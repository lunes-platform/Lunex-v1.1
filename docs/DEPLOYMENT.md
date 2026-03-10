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

## Production Checklist

### Security
- [ ] `NODE_ENV=production`
- [ ] `ADMIN_SECRET` set (32+ random bytes)
- [ ] `RELAYER_SEED` stored securely (vault/secret manager)
- [ ] `CORS_ALLOWED_ORIGINS` restricted to production domains
- [ ] Database credentials are not defaults
- [ ] Redis has AUTH password set
- [ ] TLS/SSL enabled on all public endpoints

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
