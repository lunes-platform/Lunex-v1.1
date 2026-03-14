# Lunex DEX — De-Para & Arquitetura Completa

## 1. Visão Geral do Sistema

```mermaid
graph TB
    subgraph Frontend["🖥️ Frontend (lunes-dex-main)"]
        LP[Landing Page]
        SW[Swap Page]
        PL[Pools Page]
        SP[Spot Trading]
        ST[Staking]
        RW[Rewards]
        LS[Listing]
        CT[Copy Trade]
        AG[AI Agents]
        GV[Governance]
        SO[Social]
    end

    subgraph Admin["⚙️ Admin Panel (lunex-admin)"]
        AD[Dashboard]
        TM[Token Management]
        FM[Fee Management]
    end

    subgraph Backend["🔧 Backend (spot-api)"]
        RE[REST API - Express]
        WS[WebSocket Server]
        ME[Matching Engine]
        DB[(PostgreSQL via Prisma)]
        RD[(Redis Cache)]
    end

    subgraph Indexer["📊 SubQuery Indexer"]
        SQ[SubQuery Node]
        GQL[GraphQL API]
    end

    subgraph Blockchain["⛓️ Lunes Blockchain (Substrate/ink!)"]
        subgraph Core["DEX Core"]
            FC[Factory]
            PA[Pair]
            RO[Router]
        end
        subgraph Tokens["Tokens"]
            P22[PSP22]
            WN[WNative]
            AW[Asset Wrapper]
        end
        subgraph DeFi["DeFi Modules"]
            SK[Staking]
            TR[Trading Rewards]
            LM[Listing Manager]
            LL[Liquidity Lock]
            CV[Copy Vault]
            AP[Asymmetric Pair]
            SS[Spot Settlement]
        end
    end

    Frontend -->|"@polkadot/api"| Blockchain
    Frontend -->|"REST/WS"| Backend
    Admin -->|"REST"| Backend
    Backend -->|"@polkadot/api"| Blockchain
    Indexer -->|"RPC"| Blockchain
    Frontend -->|"GraphQL"| Indexer
```

---

## 2. Contratos On-Chain (De-Para)

| # | Contrato | Diretório | Função | Depende de | Quem chama |
|---|---|---|---|---|---|
| 1 | **Factory** | `contracts/factory/` | Registra e deploya pares de tokens | Pair (code hash) | Router, Frontend |
| 2 | **Pair** | `contracts/pair/` | AMM x*y=k, LP tokens, fee accrual | PSP22 (tokens) | Router, Factory |
| 3 | **Router** | `contracts/router/` | Entry point para swaps e liquidez | Factory, Pair, PSP22 | Frontend, Backend |
| 4 | **PSP22** | `contracts/psp22/` | Token padrão fungível | — | Todos |
| 5 | **WNative** | `contracts/wnative/` | Wrapper LUNES nativo → PSP22 | — | Router |
| 6 | **Staking** | `contracts/staking/` | Stake LUNES, governance, proposals | — | Frontend, Listing Manager |
| 7 | **Trading Rewards** | `contracts/rewards/` | Track volume, epochs, tiers, claim | — | Router (track), Frontend (claim) |
| 8 | **Listing Manager** | `contracts/listing_manager/` | Cobra fee, cria pool, trava LP | PSP22, Factory, Liquidity Lock | Frontend (listing page) |
| 9 | **Liquidity Lock** | `contracts/liquidity_lock/` | Trava LP tokens por período | Pair (LP token) | Listing Manager |
| 10 | **Spot Settlement** | `contracts/spot_settlement/` | Vault + atomic trade settlement | PSP22 | Backend (matching engine) |
| 11 | **Copy Vault** | `contracts/copy_vault/` | Vault para copy trading | — | Frontend, Leader |
| 12 | **Asymmetric Pair** | `contracts/asymmetric_pair/` | Curva parametrizada V2 | — | Frontend, Manager |
| 13 | **Asset Wrapper** | `contracts/asset_wrapper/` | Bridge wrapper para ativos externos | PSP22 | Backend |

---

## 3. Fluxo de Swap (AMM)

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Router
    participant Factory
    participant Pair
    participant Rewards

    User->>Frontend: Seleciona tokens + amount
    Frontend->>Router: swap_exact_tokens_for_tokens()
    Router->>Factory: get_pair(tokenA, tokenB)
    Factory-->>Router: pair_address
    Router->>Pair: PSP22::transfer_from(user, pair, amountIn)
    Router->>Pair: swap(amount0Out, amount1Out, to)
    
    Note over Pair: Verifica K-invariant<br/>Fee: 0.5% total
    
    Pair->>Pair: accumulate_fees()
    Note over Pair: 60% LP (fica no pool)<br/>20% Protocol<br/>20% Rewards

    Pair->>User: PSP22::transfer(amountOut)
    Router->>Rewards: track_trading_volume(user, volume)
    
    Note over Rewards: Atualiza tier<br/>Bronze→Silver→Gold→Platinum
```

---

## 4. Fluxo de Listagem de Token

```mermaid
sequenceDiagram
    participant Project
    participant Frontend
    participant ListingMgr as Listing Manager
    participant PSP22Token as LUNES (PSP22)
    participant Factory
    participant Pair
    participant LiqLock as Liquidity Lock

    Project->>Frontend: Escolhe tier (1/2/3)
    Frontend->>PSP22Token: approve(listing_manager, fee)
    Frontend->>ListingMgr: list_token(token, tier, liq_amount)
    
    ListingMgr->>PSP22Token: transfer_from(project, self, fee)
    
    Note over ListingMgr: Distribui fee:<br/>20% Staking<br/>50% Treasury<br/>30% Rewards Pool

    ListingMgr->>PSP22Token: transfer(staking, 20%)
    ListingMgr->>PSP22Token: transfer(treasury, 50%)
    ListingMgr->>PSP22Token: transfer(rewards, 30%)
    
    ListingMgr->>Factory: create_pair(token, LUNES)
    Factory-->>ListingMgr: pair_address
    
    ListingMgr->>Pair: add_liquidity(liq_amount)
    Pair-->>ListingMgr: LP tokens
    
    ListingMgr->>LiqLock: lock(LP, duration)
    Note over LiqLock: Tier 1: 90d<br/>Tier 2: 120d<br/>Tier 3: 180d
```

### Regras de Negócio — Listagem

| Tier | Nome | Fee (LUNES) | Liquidez Mínima | Lock |
|:---:|---|---:|---:|---:|
| 1 | Basic | 1.000 | 10.000 | 90 dias |
| 2 | Verified | 5.000 | 25.000 | 120 dias |
| 3 | Featured | 20.000 | 50.000 | 180 dias |

---

## 5. Fluxo de Staking & Governança

```mermaid
sequenceDiagram
    participant User
    participant Staking

    User->>Staking: stake(amount, duration)
    Note over Staking: Min: 100 LUNES<br/>Durações: 30/90/180/365 dias

    Staking->>Staking: Calcula voting_power
    Note over Staking: power = amount × duration_multiplier

    User->>Staking: create_proposal(name, desc)
    Note over Staking: Requer fee + stake ativo

    User->>Staking: vote(proposal_id, approve)
    Note over Staking: Voting power = staked amount

    Note over Staking: Após voting period:<br/>Se approved → executa via timelock<br/>Se rejected → arquivada
    
    User->>Staking: unstake()
    Note over Staking: Early unstake = penalty<br/>Após lock = 100% devolvido
```

---

## 6. Fluxo Spot Trading (Orderbook)

```mermaid
sequenceDiagram
    participant Trader
    participant Frontend
    participant SpotAPI as Spot API (Backend)
    participant MatchEngine as Matching Engine
    participant Settlement as Spot Settlement (On-chain)

    Trader->>Settlement: deposit_native{value: 1000}
    Note over Settlement: Credita saldo no vault

    Trader->>Frontend: Place order (BUY LUNES/USDT @ 0.05)
    Frontend->>SpotAPI: POST /orders
    SpotAPI->>MatchEngine: Adiciona ao orderbook
    
    Note over MatchEngine: Match com orders opostas<br/>Preço-tempo priority

    MatchEngine->>Settlement: settle_trade(maker, taker, params)
    
    Note over Settlement: Atomicamente:<br/>1. Verifica saldos<br/>2. Desconta fees<br/>3. Transfere base/quote<br/>4. Atualiza nonces

    Settlement-->>Trader: Saldo atualizado
    Trader->>Settlement: withdraw_native(amount)
```

### Regras de Negócio — Spot

| Parâmetro | Valor |
|---|---|
| Maker fee | 0.10% (10 bps) |
| Taker fee | 0.25% (25 bps) |
| Depósito mínimo | 0.01 LUNES |
| Trade mínimo | 0.01 LUNES |
| Max relayers | 10 |

---

## 7. Fluxo Copy Trading

```mermaid
sequenceDiagram
    participant Follower
    participant CopyVault as Copy Vault
    participant Leader

    Follower->>CopyVault: deposit{value: 1000 LUNES}
    Note over CopyVault: Emite shares proporcional<br/>1ª deposit: 1:1

    Leader->>CopyVault: execute_trade(pair, Buy, amount)
    
    Note over CopyVault: Validações:<br/>1. Só leader pode operar<br/>2. Max 20% equity/trade<br/>3. Block volume cap<br/>4. Circuit breaker check

    CopyVault->>CopyVault: Registra trade
    
    Note over CopyVault: Se drawdown > 30%:<br/>🚨 Circuit breaker<br/>Trading halted!

    Follower->>CopyVault: withdraw(shares)
    Note over CopyVault: Performance fee<br/>apenas sobre lucro<br/>(max 50%)
    
    Note over CopyVault: Large withdrawal (>10%):<br/>24h cooldown obrigatório
```

### Regras de Negócio — Copy Vault

| Parâmetro | Valor |
|---|---|
| Performance fee máxima | 50% (sobre lucro) |
| Max trade por operação | 20% do equity |
| Large withdrawal threshold | 10% das shares |
| Large withdrawal cooldown | 24 horas |
| Max drawdown (circuit breaker) | 30% |
| Emergency withdrawal delay | 48 horas |
| Depósito mínimo | 10 LUNES |

---

## 8. Distribuição de Fees

```mermaid
pie title "Swap Fee (0.5% do volume)"
    "LPs (pool automático)" : 60
    "Protocol Treasury" : 20
    "Trading Rewards" : 20
```

```mermaid
pie title "Listing Fee (por tier)"
    "Staking Pool" : 20
    "Team Revenue" : 50
    "Rewards Pool" : 30
```

---

## 9. Trading Rewards — Tiers

```mermaid
graph LR
    B["🥉 Bronze<br/>0-10k LUNES/mês<br/>1.0x rewards"] -->|"10k volume"| S["🥈 Silver<br/>10k-50k LUNES/mês<br/>1.2x rewards"]
    S -->|"50k volume"| G["🥇 Gold<br/>50k-200k LUNES/mês<br/>1.5x rewards"]
    G -->|"200k volume"| P["💎 Platinum<br/>200k+ LUNES/mês<br/>2.0x rewards"]
```

### Anti-Fraude

| Mecanismo | Default |
|---|---|
| Volume mínimo/trade | 100 LUNES |
| Cooldown entre trades | 60 segundos |
| Volume máximo diário | 1.000.000 LUNES |
| Blacklist | Endereços suspeitos |
| Época de distribuição | 7 dias |

---

## 10. Frontend → Contrato (De-Para)

| Página | Rota | Contrato(s) | Ações Principais |
|---|---|---|---|
| Landing | `/` | — | Hero, métricas, CTA |
| Swap | `/home` | Router, Factory, Pair | swap, quote, approve |
| Pools | `/pools` | Factory, Pair | list pools, add/remove liq |
| Pool Detail | `/pool/:id` | Pair | get_reserves, mint, burn |
| Spot | `/spot` | Spot Settlement | deposit, withdraw, orders |
| Staking | `/staking` | Staking | stake, unstake, claim |
| Rewards | `/rewards` | Trading Rewards | get_tier, claim_rewards |
| Listing | `/listing` | Listing Manager | list_token, tier_config |
| Copy Trade | `/copytrade` | Copy Vault | deposit, withdraw, stats |
| Governance | `/governance` | Staking | proposals, vote |
| Social | `/social` | — (API) | profiles, comments, follow |
| Agents | `/agents` | — (API) | AI strategy agents |
| Strategies | `/strategies` | — (API) | social trading strategies |
| Affiliates | `/affiliates` | — (API) | referral program |
| Docs | `/docs` | — | documentation |
| Protocol Stats | `/protocolStats` | — (SubQuery) | TVL, volume, fees |

---

## 11. Backend API → Contrato (De-Para)

| API Route | Métodos | Contrato On-chain | Função |
|---|---|---|---|
| `pairs.ts` | GET/POST | Factory, Pair | Listar/criar pares |
| `orderbook.ts` | GET | — (in-memory) | Orderbook local |
| `orders.ts` | POST/DELETE | Spot Settlement | Place/cancel orders |
| `trades.ts` | GET | Spot Settlement | Histórico de trades |
| `execution.ts` | POST | Spot Settlement | settle_trade |
| `listing.ts` | POST/GET | Listing Manager | Submit/query listings |
| `governance.ts` | GET/POST | Staking | Proposals/votes |
| `rewards.ts` | GET | Trading Rewards | Tier/rewards info |
| `copytrade.ts` | GET/POST | Copy Vault | Vault stats/deposit |
| `asymmetric.ts` | GET/POST | Asymmetric Pair | Curve params |
| `social.ts` | CRUD | — (DB) | Profiles, comments |
| `strategies.ts` | CRUD | — (DB) | Trading strategies |
| `agents.ts` | CRUD | — (DB) | AI agents |
| `affiliate.ts` | GET/POST | — (DB) | Referral program |
| `candles.ts` | GET | — (SubQuery) | Price candles |
| `marketInfo.ts` | GET | — (SubQuery) | Market data |
| `tokenRegistry.ts` | GET | — (DB) | Token metadata |
| `tradeApi.ts` | POST | Router | Execute swaps |
| `router.ts` | GET | Router | Quote, path finding |
| `favorites.ts` | CRUD | — (DB) | User favorites |
| `margin.ts` | CRUD | — (DB) | Margin positions |

---

## 12. Segurança — Controles por Contrato

| Contrato | Reentrancy | Pause | Access Control | Checked Math |
|---|:---:|:---:|:---:|:---:|
| Pair | ✅ lock/unlock | ✅ | Factory-only (skim, set_*) | ✅ |
| Factory | — | — | fee_to_setter only | ✅ |
| Router | — | — | — (public) | ✅ |
| Staking | ✅ | ✅ | Admin + timelock | ✅ |
| Trading Rewards | ✅ | ✅ | Admin + router-only | ✅ |
| Spot Settlement | — | ✅ | Owner + relayers | ✅ |
| Listing Manager | — | ✅ | Admin + timelock | ✅ |
| Copy Vault | ✅ | ✅ | Leader + admin | ✅ |
| Asymmetric Pair | — | — | Owner + manager (guardrails) | ✅ |

---

## 13. Stack Tecnológica

| Camada | Tecnologia | Versão |
|---|---|---|
| Blockchain | Substrate (Lunes Nightly) | Polkadot v0.9.40 |
| Smart Contracts | ink! | 4.3.0 |
| Token Standard | PSP22 (local) | Compatible w/ ink! 4.x |
| Frontend | React + TypeScript | CRA |
| Admin Panel | Next.js + shadcn/ui | 14.x |
| Backend API | Express + TypeScript | 4.x |
| Database | PostgreSQL + Prisma | 7.x |
| Cache | Redis | — |
| Indexer | SubQuery | — |
| Blockchain Client | @polkadot/api | 10.x |
| Testing | cargo test (Rust), Jest (TS) | — |
