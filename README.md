# Lunex DEX

> DEX não-custodial construída sobre a blockchain Lunes. Spot trading, copy trading, margin, staking, governança e API para agentes de IA — tudo em um protocolo.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange)](https://www.rust-lang.org)
[![ink!](https://img.shields.io/badge/ink!-4.2.1-purple)](https://use.ink)
[![License](https://img.shields.io/badge/License-Proprietary-red)](./LICENSE.md)

> Documentação canônica: [Docs Map](docs/README.md) | [Project PRD](docs/prd/PROJECT_PRD.md) | [Project Spec](docs/specs/PROJECT_SPEC.md) | [SDD Workflow](docs/sdd/README.md)

---

## Índice

1. [O que é o Lunex?](#1-o-que-é-o-lunex)
2. [Visão Geral da Arquitetura](#2-visão-geral-da-arquitetura)
3. [Stack Tecnológico](#3-stack-tecnológico)
4. [Pré-requisitos](#4-pré-requisitos)
5. [Setup Local — Passo a Passo](#5-setup-local--passo-a-passo)
6. [Emitir Tokens PSP22 na Rede Local](#6-emitir-tokens-psp22-na-rede-local)
7. [Tokens Compatíveis e Paletes de Assets](#7-tokens-compatíveis-e-paletes-de-assets)
8. [Listar um Token na DEX](#8-listar-um-token-na-dex)
9. [SubQuery Indexer](#9-subquery-indexer)
10. [Setup com Docker (Full Stack)](#10-setup-com-docker-full-stack)
11. [Produção](#11-produção)
12. [CI/CD Pipeline](#12-cicd-pipeline)
13. [API Reference](#13-api-reference)
14. [WebSocket Reference](#14-websocket-reference)
15. [Variáveis de Ambiente](#15-variáveis-de-ambiente)
16. [Segurança — Dicas e Configurações](#16-segurança--dicas-e-configurações)
17. [Testes](#17-testes)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. O que é o Lunex?

O Lunex é um protocolo DEX full-stack construído sobre a [Rede Lunes](https://lunes.io) (Substrate/Polkadot). Ele oferece:

| Módulo | Descrição |
|--------|-----------|
| **Spot Trading** | Order book on-chain com autenticação via assinatura sr25519 |
| **Copy Trading** | Siga vaults de traders top com lógica de performance fee |
| **Margin Trading** | Posições alavancadas com liquidação automatizada |
| **Agents API** | Trading programático via API keys com limites por staking |
| **Social Trading** | Leaderboards, trade ideas, perfis de líderes |
| **Affiliate System** | Comissões multi-nível (até 5 níveis) |
| **Token Listing** | Listagem permissionada com lock de liquidez on-chain |
| **Governance** | Votações de proposta com cooldown anti-spam |
| **Asymmetric LP** | Provimento de liquidez assimétrico (concentrado) |

---

## 2. Visão Geral da Arquitetura

### 2.1 Arquitetura Geral

```mermaid
graph TB
    subgraph "CLIENT LAYER"
        FE["🖥️ lunes-dex-main<br/>React + Vite<br/>:3000"]
        SDK["📦 @lunex/sdk<br/>TypeScript SDK"]
        ADM["🔧 lunex-admin<br/>Next.js<br/>:3001"]
        BOT["🤖 AI Agents<br/>API Key (lnx_...)"]
    end

    subgraph "API LAYER — spot-api :4000"
        REST["REST /api/v1/*"]
        WS["WebSocket :4001"]
        RL["Rate Limit<br/>(Redis)"]
        AUTH["Auth Middleware<br/>sr25519 / Bearer / API Key"]
        SVC["24 Services<br/>orderService, tradeService,<br/>marginService, socialService..."]
    end

    subgraph "PERSISTENCE"
        PG[("PostgreSQL<br/>41 modelos")]
        RD[("Redis<br/>Nonces / Cache")]
    end

    subgraph "BLOCKCHAIN — Lunes Network"
        NODE["Substrate Node<br/>:9944 (WS)"]
        CONTRACTS["ink! Contracts<br/>Factory, Pair, Router<br/>Staking, Rewards, Listing"]
    end

    subgraph "INDEXER"
        SQ_NODE["SubQuery Node<br/>:3010"]
        SQ_GQL["SubQuery GraphQL<br/>:3011"]
    end

    FE -->|HTTP + WS| REST
    FE -->|WS| WS
    SDK -->|HTTP| REST
    ADM -->|HTTP| REST
    BOT -->|X-API-Key| REST
    REST --> AUTH
    AUTH --> SVC
    SVC --> PG
    SVC --> RD
    SVC -->|Polkadot.js| NODE
    NODE --> CONTRACTS
    NODE --> SQ_NODE
    SQ_NODE --> SQ_GQL
    SVC -->|GraphQL| SQ_GQL
```

### 2.2 Fluxo de Colocação de Ordem

```mermaid
sequenceDiagram
    participant W as Wallet (usuário)
    participant FE as Frontend
    participant API as spot-api
    participant DB as PostgreSQL
    participant OB as Orderbook (in-memory)
    participant WS as WebSocket
    participant Chain as Lunes Node

    W->>FE: Cria ordem (price, amount, side)
    FE->>W: Solicita assinatura sr25519
    W-->>FE: signature + nonce
    FE->>API: POST /api/v1/orders<br/>{pairSymbol, side, type, price, amount, nonce, signature}
    API->>API: Verifica assinatura (sr25519)<br/>Verifica nonce (Redis, anti-replay)
    API->>DB: INSERT Order (status: OPEN)
    API->>OB: Push para orderbook em memória
    OB->>OB: Matching Engine (FIFO, price-time priority)
    alt Match encontrado
        OB->>DB: INSERT Trade (maker + taker)
        OB->>Chain: Settlement (relayer assina on-chain)
        DB-->>WS: Broadcast trade
    end
    WS-->>FE: orderbook:LUNES/LUSDT atualizado
    WS-->>FE: user:{address} notificação
```

### 2.3 Fluxo de Copy Trade

```mermaid
sequenceDiagram
    participant L as Líder (API Key)
    participant API as spot-api
    participant CS as copytradeService
    participant DB as PostgreSQL
    participant OS as orderService

    L->>API: POST /copytrade/vaults/{leaderId}/signals<br/>{pairSymbol, side, amountIn}
    API->>CS: createSignal()
    CS->>DB: Busca seguidores ativos do vault
    loop Para cada seguidor
        CS->>CS: Calcula tamanho proporcional<br/>(shareBalance / totalShares × amount)
        CS->>OS: createOrder() para o seguidor
        OS->>DB: INSERT Order espelhada
    end
    CS->>DB: INSERT CopyTradeSignal + Executions
```

### 2.4 Fluxo de Token Listing

```mermaid
flowchart TD
    A[👤 Projeto/Emissário] -->|POST /api/v1/listing/create| B[spot-api]
    B -->|Valida metadados| C{PSP22 válido?}
    C -->|Não| D[❌ Rejeita com erro]
    C -->|Sim| E[INSERT TokenListing<br/>status: PENDING]
    E -->|Webhook/Admin| F[🔧 lunex-admin]
    F -->|Revisão manual| G{Aprovado?}
    G -->|Não| H[PUT status: REJECTED]
    G -->|Sim| I[POST /api/v1/listing/id/activate<br/>Bearer ADMIN_SECRET]
    I -->|listingService| J[ListingManager Contract]
    J -->|PSP22::transfer_from| K[Coleta listing fee em LUNES]
    K --> L{Distribui fees}
    L -->|50%| M[Treasury]
    L -->|30%| N[Rewards Pool]
    L -->|20%| O[Staking Pool]
    J -->|Emit ListingActivated| P[Evento on-chain]
    P -->|Relayer| Q[UPDATE Pair status: ACTIVE]
    Q -->|WebSocket| R[✅ Par disponível para trade]
```

### 2.5 Distribuição de Comissões de Afiliados

```mermaid
flowchart LR
    T[Trade executado] --> A[affiliateService<br/>distributeCommissions]
    A --> L1[Nível 1: 4%]
    A --> L2[Nível 2: 3%]
    A --> L3[Nível 3: 1.5%]
    A --> L4[Nível 4: 1%]
    A --> L5[Nível 5: 0.5%]
    L1 & L2 & L3 & L4 & L5 --> DB[(AffiliateCommission<br/>isPaid: false)]
    DB -->|Cron semanal| PAY[processPayoutBatch<br/>$transaction batch]
    PAY --> PAID[isPaid: true]
```

### 2.6 Schema do Banco de Dados (ERD Simplificado)

```mermaid
erDiagram
    Pair ||--o{ Order : "possui"
    Pair ||--o{ Trade : "possui"
    Pair ||--o{ Candle : "possui"
    Order ||--o{ Trade : "origina"
    Trade ||--o| TradeSettlement : "liquidado em"
    Leader ||--o| CopyVault : "gerencia"
    CopyVault ||--o{ CopyVaultPosition : "possui"
    CopyVault ||--o{ CopyTradeSignal : "emite"
    CopyTradeSignal ||--o{ CopyTradeExecution : "resulta em"
    Leader ||--o{ LeaderFollow : "recebe"
    Leader ||--o{ SocialIdea : "publica"
    SocialIdea ||--o{ SocialIdeaComment : "tem"
    SocialIdea ||--o{ SocialIdeaLike : "tem"
    Agent ||--o{ AgentApiKey : "possui"
    Agent ||--o{ AgentStake : "fez"
    TokenListing ||--o| LiquidityLock : "tem lock"
    Referral ||--o{ AffiliateCommission : "gera"
    AffiliateCommission }o--|| AffiliatePayoutBatch : "agrupada em"
    MarginAccount ||--o{ MarginPosition : "abre"
    MarginPosition ||--o| MarginLiquidation : "pode ter"
```

---

## 3. Stack Tecnológico

| Camada | Tecnologia | Versão | Porta |
|--------|-----------|--------|-------|
| **Smart Contracts** | ink! (Rust) | 4.2.1 | — |
| **Backend API** | Express.js + TypeScript | 4.21.2 | 4000 / 4001 (WS) |
| **Frontend** | React + Vite | 18.2.0 / 6.3.5 | 3000 |
| **Admin** | Next.js + shadcn/ui | 16.1.6 | 3001 |
| **Banco de Dados** | PostgreSQL | 15 | 5432 |
| **Cache / Nonces** | Redis | 7+ | 6379 |
| **ORM** | Prisma | 5.10.0 | — |
| **Indexador** | SubQuery | 6.4.0 node | 3010 / 3011 (GQL) |
| **Blockchain** | Lunes Network (Substrate) | — | 9944 (WS) / 9933 (RPC) |
| **Proxy reverso** | Nginx | 1.25 | 8080 |
| **SDK externo** | @lunex/sdk | 1.0.0 | — |

---

## 4. Pré-requisitos

### 4.1 Ferramentas Obrigatórias

```bash
# Node.js ≥ 20 (use nvm para gerenciar versões)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 20
nvm use 20
node --version  # deve mostrar v20.x.x

# Rust + cargo (para contratos ink!)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup update
rustup target add wasm32-unknown-unknown

# cargo-contract (ferramenta de build ink!)
cargo install --force --locked cargo-contract@4.1.1

# Verificar versão
cargo contract --version  # cargo-contract 4.1.1

# PostgreSQL ≥ 15
# macOS:
brew install postgresql@16
brew services start postgresql@16

# Ubuntu/Debian:
sudo apt install postgresql-15 postgresql-client-15

# Redis ≥ 7
# macOS:
brew install redis
brew services start redis

# Ubuntu/Debian:
sudo apt install redis-server
sudo systemctl start redis

# Docker + Docker Compose (para setup completo)
# https://docs.docker.com/engine/install/
docker --version   # ≥ 24
docker compose version  # ≥ 2.x
```

### 4.2 Ferramentas Opcionais mas Recomendadas

```bash
# pop CLI — para subir nó Lunes local com contratos pré-carregados
cargo install --locked pop-cli

# npx ts-node — para scripts TypeScript
npm install -g ts-node typescript

# Prisma CLI global (opcional — o projeto já tem local)
npm install -g prisma
```

### 4.3 Extensões de Carteira (para testar o frontend)

Instale **ao menos uma** destas extensões no Chrome/Firefox:

| Carteira | Link |
|----------|------|
| **Lunes Wallet** (fork polkadot-js) | [Chrome Web Store](https://chrome.google.com/webstore/detail/polkadotjs-extension/mopnmbcafieddcagagdcbnhejhlodfdd) |
| **SubWallet** | [subwallet.app/download](https://subwallet.app/download.html) |
| **Talisman** | [talisman.xyz/download](https://talisman.xyz/download) |

> **Nota:** Para testes locais sem extensão de browser, o backend usa dev accounts Substrate (`//Alice`, `//Bob`, etc.) diretamente nos scripts.

---

## 5. Setup Local — Passo a Passo

> **Tempo estimado:** ~30 minutos na primeira vez.

### Etapa 1 — Clonar o repositório

```bash
git clone <repo-url> Lunex
cd Lunex
```

### Etapa 2 — Instalar dependências

```bash
# Dependências raiz
npm install

# Dependências do backend
cd spot-api && npm install && cd ..

# Dependências do frontend
cd lunes-dex-main && npm install && cd ..

# Dependências do admin
cd lunex-admin && npm install && cd ..
```

### Etapa 3 — Subir o nó Lunes local

O Lunex usa a **Lunes Network**, uma chain Substrate. Para desenvolvimento local, você precisa de um nó local.

#### Opção A — Pop CLI (Recomendado para contratos)

```bash
# Instala e sobe um nó Substrate local com suporte a ink!
pop up node --version v1.0.0

# O nó ficará disponível em:
# - WS: ws://127.0.0.1:9944
# - RPC: http://127.0.0.1:9933
# - Explorer: https://polkadot.js.org/apps/?rpc=ws://127.0.0.1:9944
```

#### Opção B — substrate-contracts-node (alternativo)

```bash
# Baixar o binário pré-compilado
wget https://github.com/paritytech/substrate-contracts-node/releases/latest/download/substrate-contracts-node-linux.tar.gz
tar -xzf substrate-contracts-node-linux.tar.gz

# Subir em modo dev (dados resetam a cada restart)
./substrate-contracts-node --dev --tmp

# macOS/ARM:
# Use Rosetta ou compile da fonte:
cargo install contracts-node --git https://github.com/paritytech/substrate-contracts-node --force --locked
substrate-contracts-node --dev --tmp
```

> **Dev accounts pré-fundadas no nó local:**
> - `//Alice` — `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY` (~1M LUNES)
> - `//Bob` — `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty`
> - `//Charlie`, `//Dave`, `//Eve`, `//Ferdie` — também pré-fundados

### Etapa 4 — Configurar banco de dados PostgreSQL

```bash
# Criar usuário e banco (só na primeira vez)
createuser -s postgres 2>/dev/null || true
createdb -U postgres lunex_spot 2>/dev/null || true

# Verificar conexão
psql -U postgres -d lunex_spot -c "SELECT version();"
```

### Etapa 5 — Configurar variáveis de ambiente

```bash
# Backend
cp spot-api/.env.example spot-api/.env
```

Edite `spot-api/.env` com os valores mínimos para desenvolvimento local:

```dotenv
# Banco de dados
DATABASE_URL="postgresql://postgres:@localhost:5432/lunex_spot"

# Blockchain
LUNES_WS_URL="ws://127.0.0.1:9944"

# Redis
REDIS_URL="redis://127.0.0.1:6379"

# Segurança — gere uma chave aleatória:
# openssl rand -base64 32
ADMIN_SECRET="dev-secret-troque-em-producao"

# Relayer — conta que assina settlements on-chain
# Para dev, use Alice (//Alice):
RELAYER_SEED="bottom drive obey lake curtain smoke basket hold race lonely fit walk"

# Contratos deployed (preencher após deploy dos contratos — ver Etapa 7)
FACTORY_CONTRACT_ADDRESS=""
ROUTER_CONTRACT_ADDRESS=""
STAKING_CONTRACT_ADDRESS=""
LISTING_MANAGER_CONTRACT_ADDRESS=""
LIQUIDITY_LOCK_CONTRACT_ADDRESS=""

# Modo dev — deixar false para usar DB real
DEV_MODE=false

# Portas
PORT=4000
WS_PORT=4001

# CORS — origens permitidas
CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"

# Rate limits (relaxar para dev/testes)
RATE_LIMIT_MAX_REQUESTS=500
ORDER_RATE_LIMIT_MAX=20
```

```bash
# Frontend
cp lunes-dex-main/.env.example lunes-dex-main/.env
```

Edite `lunes-dex-main/.env`:

```dotenv
# URL da spot-api
REACT_APP_SPOT_API_URL="http://localhost:4000"
REACT_APP_WS_URL="ws://localhost:4001"

# Rede blockchain
REACT_APP_NETWORK="testnet"
REACT_APP_RPC_TESTNET="ws://127.0.0.1:9944"

# Endereços dos contratos (preencher após deploy)
REACT_APP_FACTORY_CONTRACT=""
REACT_APP_ROUTER_CONTRACT=""
REACT_APP_STAKING_CONTRACT=""
REACT_APP_REWARDS_CONTRACT=""
REACT_APP_TOKEN_WLUNES=""
REACT_APP_TOKEN_LUSDT=""
REACT_APP_TOKEN_LBTC=""
REACT_APP_TOKEN_LETH=""
REACT_APP_TOKEN_GMC=""
REACT_APP_TOKEN_LUP=""

# Deixar true enquanto contratos não estão deployados
# false = usa contratos reais on-chain
REACT_APP_DEV_MODE=true
```

### Etapa 6 — Aplicar schema e seed do banco

```bash
cd spot-api

# Aplica o schema sem histórico de migrations (mais rápido para dev)
npx prisma db push

# Gera os tipos TypeScript do Prisma
npx prisma generate

# Popula dados iniciais (pares, configurações)
npx prisma db seed

cd ..
```

> **O que o seed cria?**
> - Pares de trading: `LUNES/LUSDT`, `LBTC/LUSDT`, `LETH/LUSDT`, `GMC/LUSDT`, `LUP/LUSDT`
> - Tokens no TokenRegistry com metadados e ícones
> - Configurações padrão de fee (0.3% maker/taker)

### Etapa 7 — Compilar e deployar os contratos ink!

#### 7.1 Compilar todos os contratos

```bash
# No diretório raiz, compila todos os contratos do workspace
# Atenção: isso pode demorar 5-10 minutos na primeira vez

# Contrato por contrato (recomendado para debug):
cd Lunex/contracts/wnative    && cargo contract build --release && cd ../..
cd Lunex/contracts/pair       && cargo contract build --release && cd ../..
cd Lunex/contracts/factory    && cargo contract build --release && cd ../..
cd Lunex/contracts/router     && cargo contract build --release && cd ../..
cd Lunex/contracts/staking    && cargo contract build --release && cd ../..
cd Lunex/contracts/rewards    && cargo contract build --release && cd ../..

# Os arquivos .contract (bundle wasm + metadata) ficam em:
# Lunex/contracts/<nome>/target/ink/<nome>.contract
```

#### 7.2 Deployar os contratos na rede local

```bash
# Script automatizado — deploy completo de todos os contratos
cd spot-api

# Certifique-se de que LUNES_WS_URL e RELAYER_SEED estão no .env
npx ts-node scripts/deploy-contracts.ts

# O script imprimirá os endereços. Exemplo de output:
# ✅ wnative:  5HRAv1VDe...
# ✅ pair code hash: 0xe03a...
# ✅ factory:  5D7pe8Yh...
# ✅ router:   5GSR7WUo...
# ✅ staking:  5DuuYUt...
# ✅ rewards:  5EiX7yUa...
```

Copie os endereços para `spot-api/.env` e `lunes-dex-main/.env`.

#### 7.3 Deployar tokens PSP22 de teste

```bash
# Deploy LUSDT (stablecoin de teste)
npx ts-node scripts/deploy-tokens.ts

# Deploy tokens adicionais (LBTC, LETH, GMC, LUP) + pares AMM
npx ts-node scripts/deploy-additional-tokens.ts

# Verificar deployment
npx ts-node scripts/verify-deployment.ts
```

### Etapa 8 — Iniciar o backend (spot-api)

```bash
cd spot-api

# Modo desenvolvimento (com hot-reload via ts-node)
npm run dev

# Deve imprimir:
# [spot-api] 🚀 REST API running on http://0.0.0.0:4000
# [spot-api] 🔌 WebSocket server running on port 4001
# [spot-api] ✅ Database connected
# [spot-api] ✅ Redis connected
# [spot-api] 📊 Rehydrating orderbooks from DB...
```

> **Verifique que está funcionando:**
> ```bash
> curl http://localhost:4000/health
> # {"status":"ok","db":"connected","redis":"connected","uptime":5}
>
> curl http://localhost:4000/api/v1/pairs
> # [{"id":"...","symbol":"LUNES/LUSDT",...}]
> ```

### Etapa 9 — Iniciar o frontend

```bash
cd lunes-dex-main

# Modo desenvolvimento
PORT=3000 npm start
# ou: npm run dev

# Abrir: http://localhost:3000
```

### Etapa 10 — Iniciar o admin (opcional)

```bash
cd lunex-admin

# Configurar .env do admin
cp .env.example .env.local
# Edite: DATABASE_URL (mesmo do spot-api), NEXTAUTH_SECRET, NEXTAUTH_URL

# Criar primeiro usuário admin
ADMIN_EMAIL=admin@lunex.io ADMIN_NAME="Admin" ADMIN_PASSWORD="SenhaForte123!" npx tsx scripts/create-admin.ts

# Iniciar
npm run dev
# Abrir: http://localhost:3001
```

### Resumo — Todos os serviços rodando

```bash
# Terminal 1: Nó blockchain
substrate-contracts-node --dev --tmp

# Terminal 2: PostgreSQL (se não estiver como serviço)
brew services start postgresql@16  # macOS

# Terminal 3: Redis (se não estiver como serviço)
brew services start redis  # macOS

# Terminal 4: Backend API
cd spot-api && npm run dev

# Terminal 5: Frontend
cd lunes-dex-main && PORT=3000 npm start

# Terminal 6: Admin (opcional)
cd lunex-admin && npm run dev
```

---

## 6. Emitir Tokens PSP22 na Rede Local

### 6.1 O que é PSP22?

PSP22 é o padrão de token fungível para contratos ink! — equivalente ao ERC-20 no Ethereum. Todo token listado na Lunex DEX **deve ser PSP22**.

```mermaid
classDiagram
    class PSP22 {
        +total_supply() Balance
        +balance_of(owner: AccountId) Balance
        +allowance(owner: AccountId, spender: AccountId) Balance
        +transfer(to: AccountId, value: Balance, data: Vec~u8~) Result
        +transfer_from(from: AccountId, to: AccountId, value: Balance, data: Vec~u8~) Result
        +approve(spender: AccountId, value: Balance) Result
        +increase_allowance(spender: AccountId, delta: Balance) Result
        +decrease_allowance(spender: AccountId, delta: Balance) Result
    }
    class PSP22Metadata {
        +token_name() Option~String~
        +token_symbol() Option~String~
        +token_decimals() u8
    }
    class PSP22Mintable {
        +mint(account: AccountId, amount: Balance) Result
    }
    PSP22 <|-- PSP22Metadata
    PSP22 <|-- PSP22Mintable
```

### 6.2 Deploy de um novo token PSP22 via script

```bash
cd spot-api

# Criar e configurar um novo token PSP22
cat > scripts/my-new-token.ts << 'EOF'
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise } from '@polkadot/api-contract'
import fs from 'fs'
import path from 'path'

async function deployPSP22Token() {
  const wsProvider = new WsProvider('ws://127.0.0.1:9944')
  const api = await ApiPromise.create({ provider: wsProvider })

  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')

  // Ler o bundle .contract compilado
  const contractPath = path.resolve(
    '../Lunex/contracts/psp22/target/ink/psp22.contract'
  )
  const contractBundle = JSON.parse(fs.readFileSync(contractPath, 'utf-8'))

  // Instanciar o contrato
  const code = new CodePromise(api, contractBundle, contractBundle.source.wasm)

  const gasLimit = api.registry.createType('WeightV2', {
    refTime: 10_000_000_000n,
    proofSize: 131_072n
  })

  // Parâmetros do construtor PSP22:
  // initial_supply: u128, name: Option<String>, symbol: Option<String>, decimals: u8
  const tx = code.tx.new(
    { gasLimit, storageDepositLimit: null },
    1_000_000_000_000n,  // 1.000.000 tokens com 6 decimais
    'My Test Token',
    'MTT',
    6
  )

  await new Promise((resolve, reject) => {
    tx.signAndSend(alice, ({ status, events }) => {
      if (status.isInBlock) {
        const instantiateEvent = events.find(
          e => api.events.contracts.Instantiated.is(e.event)
        )
        if (instantiateEvent) {
          const [, contractAddress] = instantiateEvent.event.data
          console.log('✅ Token deployed:', contractAddress.toString())
          resolve(contractAddress.toString())
        }
      }
      if (status.isFinalized) resolve(null)
    }).catch(reject)
  })

  await api.disconnect()
}

deployPSP22Token().catch(console.error)
EOF

npx ts-node scripts/my-new-token.ts
```

### 6.3 Mint de tokens para carteiras de teste

```bash
# Usar o script utilitário já existente
cat > scripts/mint-test-tokens.ts << 'EOF'
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import psp22Abi from '../abis/PSP22.json'  // ABI do contrato PSP22

async function mintTokens(
  tokenAddress: string,
  recipientAddress: string,
  amount: bigint
) {
  const api = await ApiPromise.create({
    provider: new WsProvider('ws://127.0.0.1:9944')
  })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')  // Alice é a dona do token

  const contract = new ContractPromise(api, psp22Abi, tokenAddress)

  await contract.tx['psp22Mintable::mint'](
    { gasLimit: api.registry.createType('WeightV2', { refTime: 5_000_000_000n, proofSize: 65536n }) },
    recipientAddress,
    amount
  ).signAndSend(alice, ({ status }) => {
    if (status.isInBlock) {
      console.log(`✅ Minted ${amount} tokens to ${recipientAddress}`)
    }
  })

  await api.disconnect()
}

// Exemplo: mint 10000 LUSDT (6 decimais) para Bob
mintTokens(
  '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf',  // endereço LUSDT
  '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',   // Bob
  10_000_000_000n  // 10000 com 6 decimais
)
EOF

npx ts-node scripts/mint-test-tokens.ts
```

### 6.4 Adicionar liquidez ao par AMM

```bash
# Antes de adicionar liquidez, aprovar o router para gastar seus tokens
# (approve PSP22 para o endereço do Router)

cat > scripts/add-liquidity.ts << 'EOF'
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import routerAbi from '../abis/Router.json'
import psp22Abi from '../abis/PSP22.json'

const ROUTER = '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B'
const LUSDT  = '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'
const WLUNES = '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'

async function addLiquidity() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')

  const router = new ContractPromise(api, routerAbi, ROUTER)
  const lusdt  = new ContractPromise(api, psp22Abi, LUSDT)
  const wlunes = new ContractPromise(api, psp22Abi, WLUNES)

  const gasLimit = api.registry.createType('WeightV2', {
    refTime: 10_000_000_000n, proofSize: 131_072n
  })

  // 1. Aprovar LUSDT para o Router
  await lusdt.tx['psp22::approve']({ gasLimit }, ROUTER, 1_000_000_000_000n)
    .signAndSend(alice)

  // 2. Aprovar WLUNES para o Router
  await wlunes.tx['psp22::approve']({ gasLimit }, ROUTER, 1_000_000_000_000n)
    .signAndSend(alice)

  // 3. Adicionar liquidez
  // add_liquidity(token_a, token_b, amount_a_desired, amount_b_desired,
  //               amount_a_min, amount_b_min, to, deadline)
  await router.tx.addLiquidity(
    { gasLimit },
    WLUNES, LUSDT,
    1_000_000_000n,    // 10 WLUNES (8 decimais)
    10_000_000_000n,   // 10000 LUSDT (6 decimais) → preço ~1000 LUSDT/LUNES
    1n, 1n,
    alice.address,
    BigInt(Date.now() + 3_600_000)  // deadline: 1 hora em ms
  ).signAndSend(alice, ({ status }) => {
    if (status.isInBlock) console.log('✅ Liquidez adicionada!')
  })

  await api.disconnect()
}

addLiquidity().catch(console.error)
EOF

npx ts-node scripts/add-liquidity.ts
```

> ⚠️ **Atenção — Deadline em MILLISECONDS!**
> A Lunes Network usa timestamps em **milissegundos**. Sempre passe `BigInt(Date.now() + 3_600_000)` (1 hora em ms).
> Não use `Math.floor(Date.now() / 1000) + 3600` (em segundos) — isso vai causar revert com `expired`.

---

## 7. Tokens Compatíveis e Paletes de Assets

### 7.1 Padrão PSP22 — Requisitos para Listagem

Para um token ser listado e negociado na Lunex DEX, ele deve implementar:

| Interface | Obrigatório | Seletor (selector) |
|-----------|-------------|-------------------|
| `PSP22::total_supply` | ✅ | — |
| `PSP22::balance_of` | ✅ | `0x6568382f` |
| `PSP22::allowance` | ✅ | `0x4d47d921` |
| `PSP22::transfer` | ✅ | `0xdb20f9f5` |
| `PSP22::transfer_from` | ✅ | `0x54b3c76e` |
| `PSP22::approve` | ✅ | `0xb20f1bbd` |
| `PSP22Metadata::token_name` | ✅ | — |
| `PSP22Metadata::token_symbol` | ✅ | — |
| `PSP22Metadata::token_decimals` | ✅ | — |
| `PSP22Mintable::mint` | Opcional | — |
| `PSP22Burnable::burn` | Opcional | — |

> ⚠️ **Os seletores acima devem ser declarados explicitamente no contrato** para compatibilidade com o Router e a Factory. O ink! 4.x usa seletores baseados em hash — se você usar um namespace diferente (ex: `Erc20::transfer` em vez de `PSP22::transfer`), o seletor será diferente e os cross-contract calls vão falhar silenciosamente.

**Exemplo de declaração correta em Rust (ink! 4.x):**

```rust
#[ink(message, selector = 0xdb20f9f5)]
pub fn transfer(
    &mut self,
    to: AccountId,
    value: Balance,
    _data: Vec<u8>,   // ← obrigatório! PSP22 inclui este parâmetro
) -> Result<(), PSP22Error> {
    // implementação...
}
```

### 7.2 Decimais dos Tokens

| Token | Símbolo | Decimais | Observação |
|-------|---------|----------|-----------|
| LUNES (nativo) | LUNES | 8 | Token nativo da chain — não é contrato PSP22 |
| Wrapped LUNES | WLUNES | 8 | Contrato wnative — PSP22 para LUNES nativo |
| Lunes USD | LUSDT | 6 | Stablecoin de referência (igual ao USDT) |
| Lunes Bitcoin | LBTC | 8 | Representação de BTC (igual ao Bitcoin) |
| Lunes Ethereum | LETH | 8 | Representação de ETH |
| GameCoin | GMC | 8 | Token de gaming |
| LunaUp | LUP | 8 | Token de governança |

> 🔢 **Como calcular amounts:** Para transferir `10 LUSDT` (6 decimais), o valor no contrato é `10 * 10^6 = 10_000_000`. Para `10 LUNES` (8 decimais): `10 * 10^8 = 1_000_000_000`.

### 7.3 Palete de Assets (pallet-assets)

A Lunes Network usa o **pallet-assets** do Substrate para tokens nativos da chain (sem ser contratos ink!). Esses assets têm ID numérico.

```
LUNES nativo → currency = Substrate native (não precisa de pallet-assets)
pallet-assets → usado para tokens cross-chain (via XCM/bridges)
```

**Para interagir com pallet-assets via Polkadot.js:**

```typescript
// Verificar saldo de um asset nativo da chain
const balance = await api.query.assets.account(assetId, accountAddress)
console.log(balance.toHuman())

// Transferir asset nativo
await api.tx.assets.transfer(assetId, destinationAddress, amount)
  .signAndSend(signer)
```

> **Nota:** A maioria dos tokens na Lunex DEX são **contratos PSP22** (ink!), não assets do `pallet-assets`. A integração com pallet-assets é usada apenas para tokens bridgeados via XCM.

### 7.4 AssetWrapper — Bridge entre pallet-assets e PSP22

O contrato `asset_wrapper` permite empacotar tokens do `pallet-assets` em um wrapper PSP22, tornando-os compatíveis com a DEX:

```mermaid
flowchart LR
    A[Token no<br/>pallet-assets<br/>ID: 1234] -->|deposit| W[AssetWrapper<br/>Contrato PSP22]
    W -->|withdraw| A
    W -->|transfer/approve| DEX[Lunex DEX<br/>Router/Factory]
```

```bash
# Deploy de um wrapper para um asset existente
npx ts-node scripts/deploy-asset-wrappers.ts --asset-id 1234 --name "My Asset" --symbol "MAS"
```

---

## 8. Listar um Token na DEX

### 8.1 Tiers de Listagem

| Tier | Fee em LUNES | Benefícios |
|------|-------------|-----------|
| **BASIC** | 1.000 LUNES | Par listado, sem destaque |
| **VERIFIED** | 5.000 LUNES | Badge verificado, featured nas buscas |
| **FEATURED** | 20.000 LUNES | Featured no topo, material de marketing |

### 8.2 Passo a passo de listagem

```bash
# 1. Submeter a listagem via script
cd spot-api
npx ts-node scripts/list-token.ts \
  --token-address "5Abc...xyz" \
  --quote-token "5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf" \
  --tier BASIC \
  --seed "//Alice"

# 2. Aguardar aprovação admin via lunex-admin
# http://localhost:3001/listings/pending

# 3. Após aprovação admin, ativar via relayer
npx ts-node scripts/listing-relayer.ts
```

### 8.3 Via API (para integradores)

```bash
# Passo 1: Criar listing request
curl -X POST http://localhost:4000/api/v1/listing/create \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddress": "5Abc...xyz",
    "quoteTokenAddress": "5CdL...Xsf",
    "tokenName": "My Token",
    "tokenSymbol": "MTK",
    "decimals": 8,
    "tier": "BASIC",
    "logoUrl": "https://example.com/logo.png",
    "website": "https://mytoken.io",
    "nonce": 1234567890,
    "signature": "0x...",
    "requesterAddress": "5GrwvaEF..."
  }'

# Passo 2: Admin aprova via lunex-admin ou API admin
curl -X POST http://localhost:4000/api/v1/listing/{id}/activate \
  -H "Authorization: Bearer seu-admin-secret"
```

---

## 9. SubQuery Indexer

O SubQuery indexa eventos on-chain (swaps, listings, locks) em um banco PostgreSQL separado, expondo-os via GraphQL em `:3011`.

### 9.1 Subir o indexador localmente

```bash
cd subquery-node

# Instalar dependências
npm install

# Compilar os handlers
npm run build

# Subir via Docker (recomendado — precisa de PostgreSQL)
docker compose -f ../docker-compose.dev.yml up subquery-node subquery-query postgres -d

# Verificar logs
docker logs subquery-node -f

# GraphQL Playground disponível em:
# http://localhost:3011/graphql
```

### 9.2 Configurar a hash do genesis da chain local

Edite `subquery-node/project.yaml`:

```yaml
network:
  chainId: "0x..."  # genesis hash da sua chain local
  endpoint:
    - "ws://host.docker.internal:9944"  # usa host.docker.internal dentro do Docker
    # ou: "ws://127.0.0.1:9944" se rodando fora do Docker
```

Para obter a genesis hash da chain local:

```bash
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getBlockHash","params":[0]}' \
  http://localhost:9933
# {"jsonrpc":"2.0","result":"0x7a556a...","id":1}
```

### 9.3 Habilitar SubQuery no backend

No `spot-api/.env`:

```dotenv
SUBQUERY_ENDPOINT="http://localhost:3011"
SUBQUERY_ENABLED=true
```

---

## 10. Setup com Docker (Full Stack)

A maneira mais simples de subir tudo de uma vez:

```bash
# 1. Copiar arquivo de configuração Docker
cp docker/.env.docker.example docker/.env.docker
# Editar docker/.env.docker com suas configurações

# 2. Subir todos os serviços
docker compose -f docker-compose.dev.yml up -d

# 3. Verificar status
docker compose -f docker-compose.dev.yml ps

# 4. Ver logs de um serviço específico
docker compose -f docker-compose.dev.yml logs spot-api -f

# 5. Aplicar migrations (apenas na primeira vez)
docker compose -f docker-compose.dev.yml exec spot-api npx prisma db push
docker compose -f docker-compose.dev.yml exec spot-api npx prisma db seed
```

### Serviços e portas do Docker

| Serviço | Porta (host) | Descrição |
|---------|-------------|-----------|
| `postgres` | 5433 | PostgreSQL 15 |
| `spot-api` | 4000, 4001 | Backend REST + WebSocket |
| `frontend` | 3000 | React DEX |
| `admin` | 3001 | Next.js Admin Panel |
| `subquery-node` | 3010 | Indexador SubQuery |
| `subquery-query` | 3011 | GraphQL da SubQuery |
| `nginx` | 8080 | Reverse proxy unificado |

```
# Acessos via Nginx (porta 8080):
# http://localhost:8080/        → Frontend
# http://localhost:8080/api/    → spot-api REST
# http://localhost:8080/admin/  → Admin Panel
# http://localhost:8080/ws      → WebSocket
```

---

## 11. Produção

### 11.1 Checklist de pré-deploy

- [ ] `NODE_ENV=production` definido
- [ ] `ADMIN_SECRET` gerado com `openssl rand -base64 32` (mín. 32 chars)
- [ ] `RELAYER_SEED` configurado com carteira dedicada (não usar dev accounts)
- [ ] `DATABASE_URL` aponta para PostgreSQL de produção (com SSL)
- [ ] `REDIS_URL` aponta para Redis de produção (com AUTH)
- [ ] `CORS_ALLOWED_ORIGINS` contém apenas domínios de produção
- [ ] `TRUST_PROXY=true` se por trás de nginx/load balancer
- [ ] `RATE_LIMIT_MAX_REQUESTS=100` (padrão de produção)
- [ ] `LOG_LEVEL=warn` (reduz volume de logs)
- [ ] Migrations aplicadas (`npx prisma migrate deploy`)
- [ ] SSL/TLS configurado no nginx
- [ ] Firewalls: expor apenas 80/443 externamente
- [ ] PostgreSQL: `max_connections` ajustado (≥ 100 para produção)
- [ ] Redis: `maxmemory-policy allkeys-lru` configurado

### 11.2 Build de produção

```bash
# Backend
cd spot-api
npm run build        # compila TypeScript para dist/
npm start            # executa dist/index.js

# Frontend
cd lunes-dex-main
npm run build        # gera build/ otimizado
# Servir com nginx ou CDN

# Admin
cd lunex-admin
npm run build
npm start
```

### 11.3 Variáveis de ambiente — Produção

```dotenv
# spot-api — produção
NODE_ENV=production
DATABASE_URL="postgresql://lunex_prod:SenhaSegura@db.producao.com:5432/lunex_prod?sslmode=require"
REDIS_URL="redis://:SenhaRedis@redis.producao.com:6379"
LUNES_WS_URL="wss://ws.lunes.io"
ADMIN_SECRET="<openssl rand -base64 32>"
RELAYER_SEED="<seed da carteira relayer>"
CORS_ALLOWED_ORIGINS="https://app.lunex.io,https://admin.lunex.io"
TRUST_PROXY=true
RATE_LIMIT_MAX_REQUESTS=100
ORDER_RATE_LIMIT_MAX=10
LOG_LEVEL=warn
PORT=4000
WS_PORT=4001

# Contratos mainnet
FACTORY_CONTRACT_ADDRESS="5..."
ROUTER_CONTRACT_ADDRESS="5..."
STAKING_CONTRACT_ADDRESS="5..."
LISTING_MANAGER_CONTRACT_ADDRESS="5..."
LIQUIDITY_LOCK_CONTRACT_ADDRESS="5..."
```

### 11.4 Configuração nginx recomendada para produção

```nginx
# /etc/nginx/sites-available/lunex
server {
    listen 80;
    server_name app.lunex.io api.lunex.io;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.lunex.io;

    ssl_certificate     /etc/ssl/lunex/fullchain.pem;
    ssl_certificate_key /etc/ssl/lunex/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Rate limiting global
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # API REST
    location /api/ {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass         http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    # Métricas (acesso interno apenas)
    location /metrics {
        allow 10.0.0.0/8;  # rede interna
        deny all;
        proxy_pass http://localhost:4000/metrics;
    }
}
```

### 11.5 Gerenciamento de processos com PM2

```bash
npm install -g pm2

# Iniciar backend com PM2
cd spot-api
pm2 start ecosystem.config.js --env production

# Iniciar frontend servido
pm2 start "npx serve -s build -l 3000" --name frontend

# Salvar configuração (reinicia após reboot)
pm2 save
pm2 startup
```

O arquivo `ecosystem.config.js` na raiz já está configurado para todos os serviços.

---

## 12. CI/CD Pipeline

O Lunex possui um pipeline completo de CI/CD via GitHub Actions.

### 12.1 Workflows

| Workflow | Gatilho | Descrição |
|----------|---------|-----------|
| **CI** (`ci.yml`) | PR, push na `main` | Lint, build, testes unitários, validação SubQuery, compilação de contratos ink!, smoke tests |
| **PR Check** (`pr-check.yml`) | Pull Request | Verifica apenas os módulos alterados no PR (path filtering) |
| **Contracts** (`contracts.yml`) | PR, push na `main` | Testes Rust, build de contratos ink!, `cargo audit` de segurança |
| **Release** (`release.yml`) | Tags `v*.*.*` | Cria release candidate (RC), build de artefatos, imagens Docker, deploy opcional para staging |
| **Dependabot** (`dependabot.yml`) | Semanal | Atualizações automáticas de dependências |

### 12.2 Status Checks Obrigatórios

Para merge na `main`, os seguintes checks devem passar:

- ✅ `ci / validate` — Lint e typecheck de todos os módulos
- ✅ `ci / build` — Build de spot-api, frontend, sdk, mcp, subquery
- ✅ `ci / test` — Testes unitários (com cobertura mínima)
- ✅ `ci / subquery-validation` — `subql codegen` e `subql build`
- ✅ `contracts / test` — Testes Rust dos contratos ink!
- ✅ `pr-check / path-filter` — Verificação de módulos alterados

### 12.3 Release Candidates

Versionamento segue semver com RC automático:

```bash
# Versão atual no package.json raiz: 0.8.0
# Tag gerada automaticamente: v0.8.0-rc1, v0.8.0-rc2, ...
```

Para criar uma release estável:

```bash
# 1. Atualizar versão no package.json raiz
# 2. Criar tag e push
git tag -a v0.9.0 -m "Release v0.9.0"
git push origin v0.9.0

# O workflow release.yml irá:
# - Buildar todos os artefatos
# - Criar GitHub Release
# - Buildar e pushar imagens Docker
# - Deploy opcional para staging (com secrets configurados)
```

### 12.4 Secrets Necessários

Configure em **Settings > Secrets and variables > Actions**:

| Secret | Descrição | Usado em |
|--------|-----------|----------|
| `STAGING_HOST` | IP ou hostname do servidor staging | `release.yml` |
| `STAGING_USER` | Usuário SSH para deploy | `release.yml` |
| `STAGING_SSH_KEY` | Chave SSH privada (base64) | `release.yml` |
| `DOCKER_USERNAME` | Usuário Docker Hub | `release.yml` |
| `DOCKER_PASSWORD` | Token Docker Hub | `release.yml` |
| `GITHUB_TOKEN` | Token automático do GitHub | Todos os workflows |

---

## 13. API Reference

Base URL: `http://localhost:4000/api/v1`

### Autenticação

Todas as rotas de escrita (criar ordem, cancelar, etc.) requerem assinatura sr25519:

```typescript
// Construir a mensagem de assinatura
const message = `lunex-order:${pairSymbol}:${side}:${type}:${price}:0:${amount}:${nonce}`

// Assinar com a carteira (Polkadot.js extension ou keyring local)
const { signature } = await injector.signer.signRaw({
  address: walletAddress,
  data: stringToHex(message),
  type: 'bytes'
})

// Enviar com a requisição
await fetch('/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pairSymbol, side, type, price, amount,
    nonce,                    // timestamp Unix (segundos) + offset único
    signature,
    makerAddress: walletAddress
  })
})
```

### Rotas Principais

| Módulo | Método | Endpoint | Descrição |
|--------|--------|----------|-----------|
| **Health** | GET | `/health` | Status da API, DB e Redis |
| **Pairs** | GET | `/pairs` | Lista todos os pares ativos |
| **Pairs** | GET | `/pairs/:symbol` | Detalhe de um par |
| **Orders** | POST | `/orders` | Criar ordem (requer assinatura) |
| **Orders** | DELETE | `/orders/:id` | Cancelar ordem |
| **Orders** | GET | `/orders?address=` | Ordens do usuário |
| **Orderbook** | GET | `/orderbook/:symbol` | Snapshot do livro de ordens |
| **Trades** | GET | `/trades/:symbol` | Trades de um par |
| **Trades** | GET | `/trades?address=` | Trades do usuário |
| **Candles** | GET | `/candles/:symbol?timeframe=1m&limit=200` | OHLCV candlestick |
| **Social** | GET | `/social/leaderboard` | Top traders |
| **Social** | GET | `/social/leaders/:address` | Perfil do líder |
| **CopyTrade** | GET | `/copytrade/vaults` | Lista de vaults |
| **Margin** | GET | `/margin/price-health` | Saúde dos preços mark |
| **Margin** | POST | `/margin/open` | Abrir posição |
| **Affiliates** | GET | `/affiliates/code?address=` | Código de referência |
| **Affiliates** | GET | `/affiliates/dashboard?address=` | Dashboard afiliado |
| **Agents** | POST | `/agents/register` | Registrar agente IA |
| **Agents** | POST | `/agents/:id/api-key` | Gerar API key |
| **Listing** | POST | `/listing/create` | Submeter token para listagem |
| **Listing** | POST | `/listing/:id/activate` | Ativar listagem (admin) |
| **Governance** | POST | `/governance/vote` | Registrar voto |
| **Metrics** | GET | `/metrics` | Métricas Prometheus |

### Timeframes de Candles

`1m`, `5m`, `15m`, `1h`, `4h`, `1d`

---

## 14. WebSocket Reference

URL: `ws://localhost:4001`

### Canais disponíveis

```javascript
const ws = new WebSocket('ws://localhost:4001')

ws.onopen = () => {
  // Orderbook em tempo real
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:LUNES/LUSDT' }))

  // Trades em tempo real
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'trades:LUNES/LUSDT' }))

  // Ticker (preço, volume 24h)
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'ticker:LUNES/LUSDT' }))

  // Notificações do usuário (ordens preenchidas, etc)
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'user:5GrwvaEF...' }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  // msg.type: 'orderbook_update' | 'trade' | 'ticker' | 'order_filled'
  // msg.data: payload específico do evento
}
```

---

## 15. Variáveis de Ambiente

### spot-api/.env (completo)

```dotenv
# ═══════════════════════════════════════════
# BANCO DE DADOS
# ═══════════════════════════════════════════
DATABASE_URL="postgresql://postgres:senha@localhost:5432/lunex_spot"

# ═══════════════════════════════════════════
# BLOCKCHAIN
# ═══════════════════════════════════════════
LUNES_WS_URL="ws://127.0.0.1:9944"              # nó local
# LUNES_WS_URL="wss://ws.lunes.io"              # mainnet

# ═══════════════════════════════════════════
# REDIS
# ═══════════════════════════════════════════
REDIS_URL="redis://127.0.0.1:6379"
NONCE_TTL_SECONDS=300                            # janela anti-replay (5 min)

# ═══════════════════════════════════════════
# SEGURANÇA
# ═══════════════════════════════════════════
ADMIN_SECRET="<openssl rand -base64 32>"        # Bearer token para rotas admin
RELAYER_SEED="<mnemonic da carteira relayer>"   # assina settlements on-chain
JWT_SECRET="<openssl rand -base64 32>"          # para NextAuth no admin

# ═══════════════════════════════════════════
# SERVIDOR
# ═══════════════════════════════════════════
PORT=4000
WS_PORT=4001
NODE_ENV=development                             # production em prod
TRUST_PROXY=false                               # true se atrás de nginx

# ═══════════════════════════════════════════
# CORS
# ═══════════════════════════════════════════
CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"

# ═══════════════════════════════════════════
# RATE LIMITS
# ═══════════════════════════════════════════
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100                     # 500 para dev/testes
ORDER_RATE_LIMIT_MAX=10                         # 20 para dev/testes
RATE_LIMIT_WINDOW_MS=1000

# ═══════════════════════════════════════════
# CONTRATOS ink!
# ═══════════════════════════════════════════
FACTORY_CONTRACT_ADDRESS=""
ROUTER_CONTRACT_ADDRESS=""
STAKING_CONTRACT_ADDRESS=""
REWARDS_CONTRACT_ADDRESS=""
LISTING_MANAGER_CONTRACT_ADDRESS=""
LIQUIDITY_LOCK_CONTRACT_ADDRESS=""
WNATIVE_CONTRACT_ADDRESS=""

# ═══════════════════════════════════════════
# SUBQUERY INDEXER
# ═══════════════════════════════════════════
SUBQUERY_ENDPOINT=""                            # http://localhost:3011
SUBQUERY_ENABLED=false

# ═══════════════════════════════════════════
# SERVIÇOS OPCIONAIS
# ═══════════════════════════════════════════
SOCIAL_ANALYTICS_ENABLED=false
VAULT_RECONCILIATION_ENABLED=false
LOG_LEVEL=info                                  # debug | info | warn | error

# ═══════════════════════════════════════════
# MARGIN
# ═══════════════════════════════════════════
MARGIN_MARK_PRICE_MAX_AGE_MS=120000             # 2 min (mark price máx antigo)
MARGIN_MAX_BOOK_SPREAD_BPS=1000                 # 10% spread máximo

# ═══════════════════════════════════════════
# DEV
# ═══════════════════════════════════════════
DEV_MODE=false                                  # true = mocks, sem blockchain
```

---

## 16. Segurança — Dicas e Configurações

### 16.1 Autenticação por assinatura sr25519

A DEX usa autenticação sem senha — cada ação é verificada por assinatura criptográfica da carteira do usuário.

```
⚠️  NUNCA aceite mensagens de assinatura genéricas.
     A mensagem DEVE ter o formato exato:
     "lunex-order:{par}:{lado}:{tipo}:{preco}:0:{amount}:{nonce}"

     Qualquer desvio = rejeite com 401.
```

### 15.2 Proteção contra Replay Attacks

O nonce em cada requisição assinada é armazenado no Redis por `NONCE_TTL_SECONDS` (padrão: 5 min). Um nonce reutilizado é rejeitado com `401 Nonce already used`.

```bash
# Gerar nonces corretamente (nunca reutilizar):
const nonce = Math.floor(Date.now() / 1000) + uniqueOffset
# Usar timestamp em segundos + offset por request para evitar colisão
```

### 15.3 Proteção do ADMIN_SECRET

```bash
# ✅ Gere sempre com openssl:
openssl rand -base64 32

# ✅ Armazene em gerenciador de secrets (HashiCorp Vault, AWS Secrets Manager)

# ❌ NUNCA:
# - Commitar no git
# - Usar valores simples como "admin123"
# - Compartilhar em Slack/email
# - Usar o mesmo secret em dev e produção
```

### 15.4 Seed do Relayer

```bash
# ✅ Em produção, use uma carteira dedicada APENAS para settlements
# ✅ Nunca use //Alice ou outras dev accounts em produção
# ✅ Mantenha saldo mínimo necessário (reduz risco de perda em caso de comprometimento)

# Gerar nova carteira com subkey:
subkey generate --scheme sr25519 --network substrate
# Output:
# Secret phrase: word1 word2 ... word12
# Address: 5...
```

### 15.5 PostgreSQL — Hardening

```bash
# ✅ Criar usuário dedicado (não use o user 'postgres' padrão em produção):
psql -U postgres
CREATE USER lunex_prod WITH PASSWORD 'SenhaForte!@#123' LOGIN;
CREATE DATABASE lunex_prod OWNER lunex_prod;
GRANT ALL PRIVILEGES ON DATABASE lunex_prod TO lunex_prod;

# ✅ Habilitar SSL no PostgreSQL:
# postgresql.conf:
ssl = on
ssl_cert_file = '/etc/ssl/certs/ssl-cert-snakeoil.pem'
ssl_key_file = '/etc/ssl/private/ssl-cert-snakeoil.key'

# ✅ Na DATABASE_URL, adicione ?sslmode=require:
DATABASE_URL="postgresql://lunex_prod:SenhaForte@db:5432/lunex_prod?sslmode=require"
```

### 15.6 Redis — Hardening

```bash
# redis.conf
requirepass SenhaRedisForte123
maxmemory 256mb
maxmemory-policy allkeys-lru
bind 127.0.0.1  # Não expor publicamente

# Na REDIS_URL:
REDIS_URL="redis://:SenhaRedisForte123@127.0.0.1:6379"
```

### 15.7 Headers de Segurança (Helmet)

O backend já usa Helmet com CSP. Em produção, configure o header `X-Forwarded-For` corretamente:

```dotenv
TRUST_PROXY=true   # Habilitar se atrás de nginx/proxy
```

Isso garante que o Rate Limiting use o IP real do cliente (não o IP do proxy).

### 15.8 Firewall — Portas a expor

| Porta | Acesso | Quem acessa |
|-------|--------|-------------|
| 80/443 | Público | Usuários (nginx) |
| 4000 | Interno | nginx → spot-api |
| 4001 | Interno | nginx → websocket |
| 3000 | Interno | nginx → frontend |
| 3001 | Interno | nginx → admin |
| 5432 | Interno | spot-api → postgres |
| 6379 | Interno | spot-api → redis |
| 9944 | Interno | spot-api → lunes node |
| 3010/3011 | Interno | spot-api → subquery |

```bash
# Exemplo com ufw (Ubuntu):
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
# Tudo mais é bloqueado por padrão
```

### 15.9 Segredos — Nunca commitar no git

```bash
# Adicionar ao .gitignore (já deve estar, mas verifique):
echo "*.env" >> .gitignore
echo ".env.*" >> .gitignore
echo "!.env.example" >> .gitignore

# Verificar se há secrets no histórico git:
git log --all --full-history -- "**/.env"
git log --all --full-history -- "**/*.env"
```

### 15.10 Gitleaks — Scanning automático de secrets

```bash
# Instalar Gitleaks
brew install gitleaks  # macOS
# ou: https://github.com/gitleaks/gitleaks/releases

# Scanear repositório inteiro
gitleaks detect --source . --report-format json --report-path secrets-report.json

# Scanear apenas staged files (usar como pre-commit hook)
gitleaks protect --staged
```

O repositório já possui o workflow `.github/workflows/ci.yml` com verificação automática via Gitleaks no CI.

---

## 17. Testes

### 17.1 Contratos Rust (ink!)

```bash
# Testes unitários de todos os contratos
cargo test -p lunex-sim-tests

# Contrato específico
cargo test -p factory_contract
cargo test -p pair_contract
cargo test -p router_contract
cargo test -p staking_contract
cargo test -p rewards_contract

# Com output detalhado
cargo test -p pair_contract -- --nocapture

# ⚠️ 8 testes no router são marcados com #[ignore]
# Eles requerem cross-contract calls (só funcionam com pop-cli/swanky):
cargo test -p router_contract -- --ignored
```

### 17.2 Backend (spot-api)

```bash
cd spot-api

# Todos os testes (unit + integration — usa mocks, não precisa de PostgreSQL)
npm test -- --forceExit

# Testes específicos
npm test -- --testPathPattern=affiliate --forceExit
npm test -- --testPathPattern=marginService --forceExit

# E2E (precisa de PostgreSQL rodando)
npm run test:e2e -- --forceExit
```

### 17.3 Frontend (TypeScript check)

```bash
cd lunes-dex-main

# Verificar tipos TypeScript sem compilar
npx tsc --noEmit

# Build completo (0 erros = passou)
npm run build
```

### 17.4 Simular volume de trades (dev)

```bash
# Gera trades sintéticos para popular candles/orderbook
cd spot-api
npx ts-node scripts/simulate-volume.ts
```

---

## 18. Troubleshooting

### "Chart data unavailable — spot-api offline"

```bash
# Verificar se a API está rodando
curl http://localhost:4000/health

# Se retornar erro de conexão, reiniciar a API:
cd spot-api && npm run dev
```

> **Nota:** O banner "spot-api offline" só aparece quando a API está completamente inacessível. Se a API estiver rodando mas sem trades, aparece "No trades yet — place an order to start the chart".

### Orderbook mostrando dados antigos/falsos

```bash
# O orderbook vive em memória. Se reiniciar a API, ele é recarregado do DB.
# Se o DB está limpo mas o orderbook ainda tem dados, o processo antigo ainda está rodando.

# Encontrar o processo
lsof -i :4000

# Matar o processo antigo
kill -9 <PID>

# Reiniciar limpo
cd spot-api && npm run dev
```

### `expired` ao chamar função do Router

O Router recebe o deadline em **milissegundos**. Verifique se está usando:

```typescript
// ✅ CORRETO — deadline em milissegundos
const deadline = BigInt(Date.now() + 3_600_000)  // +1 hora em ms

// ❌ ERRADO — deadline em segundos (causará revert "expired")
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
```

### PSP22 `transfer_from` falhando silenciosamente

Verifique se o seletor está declarado explicitamente:

```rust
// ✅ Correto — seletor PSP22 padrão
#[ink(message, selector = 0x54b3c76e)]
pub fn transfer_from(
    &mut self,
    from: AccountId,
    to: AccountId,
    value: Balance,
    _data: Vec<u8>,   // ← parâmetro _data OBRIGATÓRIO
) -> Result<(), PSP22Error>
```

### `prisma db push` com erro de conexão

```bash
# Verificar se PostgreSQL está rodando
pg_isready -h localhost -p 5432

# macOS com Homebrew:
brew services start postgresql@16

# Ubuntu:
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verificar string de conexão:
echo $DATABASE_URL
# ou: cat spot-api/.env | grep DATABASE_URL
```

### Nó Lunes não aceita transações

```bash
# Verificar se o nó está sincronizado e aceitando conexões
curl -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health","params":[]}' \
  http://localhost:9933
# Deve retornar: {"jsonrpc":"2.0","result":{"isSyncing":false,...},"id":1}

# Se não responder, reiniciar o nó:
substrate-contracts-node --dev --tmp
```

### Redis não conecta

```bash
# Testar conexão Redis
redis-cli ping
# Deve retornar: PONG

# Iniciar Redis:
# macOS:
brew services start redis
# Ubuntu:
sudo systemctl start redis-server
```

### Erro "Nonce already used"

```bash
# Cada nonce só pode ser usado uma vez por NONCE_TTL_SECONDS (5 min padrão).
# Solução: gere um novo nonce único para cada request.

const nonce = Math.floor(Date.now() / 1000)  // timestamp em segundos
// Se enviar múltiplas requests no mesmo segundo, adicione um offset:
const nonce = Math.floor(Date.now() / 1000) + requestIndex
```

---

## Estrutura do Projeto

```
Lunex/
├── spot-api/                  # Backend REST API + WebSocket
│   ├── prisma/
│   │   ├── schema.prisma      # 41 modelos, 30+ enums
│   │   └── seed.ts            # Dados iniciais (pares, tokens)
│   ├── src/
│   │   ├── routes/            # 15 módulos de rotas
│   │   ├── services/          # 24 serviços de negócio
│   │   ├── middleware/        # auth, errors, pagination, metrics
│   │   └── utils/             # logger, redis, signing, orderbook
│   └── scripts/               # Deploy, seed, simulação
│
├── lunes-dex-main/            # Frontend React (Vite)
│   └── src/
│       ├── context/           # SDKContext, SpotContext
│       ├── pages/             # Rotas (home, spot, staking, social...)
│       ├── components/        # UI components
│       └── services/          # Clientes de API
│
├── Lunex/contracts/           # Contratos ink! (Rust)
│   ├── factory/               # AMM factory (cria pares)
│   ├── pair/                  # Par de liquidez AMM
│   ├── router/                # Router de swap
│   ├── wnative/               # WLUNES (PSP22 wrapper do nativo)
│   ├── staking/               # Staking de LUNES
│   ├── rewards/               # Distribuição de recompensas
│   ├── copy_vault/            # Vault de copy trading
│   ├── psp22/                 # Token PSP22 genérico
│   ├── asset_wrapper/         # Bridge pallet-assets ↔ PSP22
│   ├── listing_manager/       # Gestão de listagens
│   └── liquidity_lock/        # Lock de liquidez por tier
│
├── lunex-admin/               # Painel admin (Next.js)
│   ├── src/app/(admin)/       # Rotas protegidas por auth
│   └── prisma/                # Schema compartilhado com spot-api
│
├── sdk/                       # @lunex/sdk — SDK para integradores
├── subquery-node/             # Indexador SubQuery
├── mcp/                       # Model Context Protocol server
├── docker/                    # Dockerfiles + configs
├── scripts/                   # Scripts de deploy e setup
├── docs/                      # Documentação técnica
└── tests/                     # Testes de integração Rust
```

---

## Contribuindo

1. Crie uma branch a partir de `main`
2. Faça commits seguindo o padrão Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
3. Abra um Pull Request com descrição do que foi alterado
4. CI precisa passar (TypeScript + testes + Gitleaks)

---

## Licença

Veja [LICENSE.md](./LICENSE.md) e [NOTICE.md](./NOTICE.md).
