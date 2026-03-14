# Lunex DEX — Spot Orderbook: Arquitetura & Plano de Execução

## 1. Análise do Estado Atual

### 1.1 Frontend Spot (Já Implementado)
O módulo Spot já possui uma interface completa estilo dYdX com:

| Componente | Arquivo | Status |
|---|---|---|
| **SpotPage** (layout 3 colunas) | `src/pages/spot/index.tsx` | ✅ Pronto |
| **PairSelector** (seletor de pares com favoritos/busca) | `src/components/spot/PairSelector/index.tsx` | ✅ Pronto |
| **PriceHeader** (ticker do par) | `src/components/spot/PriceHeader/index.tsx` | ✅ Pronto |
| **ChartPanel** (gráfico candlestick com lightweight-charts) | `src/components/spot/ChartPanel/index.tsx` | ✅ Pronto |
| **OrderBook** (livro de ofertas com profundidade visual) | `src/components/spot/OrderBook/index.tsx` | ✅ Pronto (mock) |
| **OrderForm** (Limit, Market, Stop, Stop-Limit, Margin) | `src/components/spot/OrderForm/index.tsx` | ✅ Pronto (mock) |
| **OrderHistory** (ordens abertas, histórico, trades) | `src/components/spot/OrderHistory/index.tsx` | ✅ Pronto (mock) |

**Problema:** Tudo é **mock data** — não há integração com backend real, nem assinatura de ordens via wallet.

### 1.2 Smart Contracts Existentes (ink! 4.2.1)

| Contrato | Função | Relevância para Spot |
|---|---|---|
| `factory` | Cria pares de tokens | Reutilizável para registrar pares Spot |
| `pair` | Pool de liquidez AMM (Uniswap v2) | Não usado diretamente pelo Spot (AMM ≠ Orderbook) |
| `router` | Roteamento de swaps via AMM | Não usado diretamente pelo Spot |
| `wnative` | Wrapper do token nativo (LUNES) | **Essencial** — permite usar LUNES nativo como PSP22 |
| `staking` | Staking + Governance | Independente do Spot |
| `rewards` | Trading rewards | **Integrar** — premiar volume no Spot |

### 1.3 Tokens Suportados
A rede Lunes suporta dois tipos de tokens que o Spot precisa lidar:
- **Token Nativo (LUNES):** Transferido via `env().transfer()` — não é PSP22.
- **Tokens PSP22:** Padrão equivalente ao ERC-20 no ecossistema ink!/Substrate.

O contrato `wnative` já faz o wrap LUNES → wLUNES (PSP22), o que simplifica a lógica.

---

## 2. Arquitetura Híbrida: Off-chain Orderbook + On-chain Settlement

### Princípio
> **Off-chain para velocidade, On-chain para segurança.**

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                       │
│  PairSelector │ Chart │ OrderBook │ OrderForm │ History     │
│                                                             │
│  1. Usuário assina ordem com Polkadot.js (signRaw)          │
│  2. Envia ordem assinada para o Backend via REST/WS         │
│  3. Recebe updates do book em tempo real via WebSocket      │
└────────────────┬──────────────────────┬─────────────────────┘
                 │ REST + WebSocket     │
                 ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js + Prisma)                │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  REST API    │  │  WebSocket   │  │  Matching Engine  │  │
│  │  (público)   │  │  Server      │  │  (cruza ordens)   │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │             │
│         ▼                 ▼                    ▼             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              PostgreSQL (Prisma ORM)                  │   │
│  │  Orders │ Trades │ Pairs │ Balances │ Candles         │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                 │
│               Quando match acontece:                        │
│               Envia tx para Smart Contract                  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Polkadot.js API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              BLOCKCHAIN LUNES (ink! 4.2.1)                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          SpotSettlement Contract (NOVO)              │    │
│  │                                                     │    │
│  │  • deposit(token)        — deposita PSP22 ou LUNES  │    │
│  │  • withdraw(token, amt)  — saca fundos              │    │
│  │  • settle(maker, taker)  — executa trade atômico    │    │
│  │  • cancel_order(hash)    — registra cancel on-chain │    │
│  │  • get_balance(user,tok) — consulta saldo interno   │    │
│  │                                                     │    │
│  │  Suporta: LUNES nativo + qualquer PSP22             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Contratos existentes: factory, pair, router, wnative       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Responsabilidades Detalhadas

### 3.1 OFF-CHAIN (Backend API)

| Responsabilidade | Descrição |
|---|---|
| **Orderbook em memória** | Red-Black Tree ou Sorted Map para bids/asks, O(log n) insert/delete |
| **Matching Engine** | Price-Time Priority — cruza ordens quando bid ≥ ask |
| **Validação de Ordens** | Verifica assinatura sr25519, saldo no contrato, nonce único |
| **Persistência (Prisma)** | Salva ordens, trades, candles (OHLCV), saldos cache |
| **REST API Pública** | CRUD de ordens, consulta de book, histórico — para bots/automação |
| **WebSocket** | Push de orderbook diffs, trades, ticker — para frontend e bots |
| **Candle Aggregator** | Agrega trades em candles 1m/5m/15m/1h/4h/1d/1w para o ChartPanel |
| **Rate Limiting** | Proteção contra spam de ordens (ex: 10 ordens/segundo por IP) |

### 3.2 ON-CHAIN (Smart Contract ink! 4.2.1)

| Responsabilidade | Descrição |
|---|---|
| **Vault / Custódia** | Usuário deposita LUNES (nativo) ou PSP22 no contrato |
| **Saldos Internos** | `Mapping<(AccountId, TokenId), Balance>` — saldo de cada user/token |
| **Settlement Atômico** | Recebe par de ordens cruzadas, valida assinaturas, transfere saldos |
| **Nonce Registry** | `Mapping<Hash, bool>` — previne replay de ordens já executadas |
| **Cancel Registry** | Registra on-chain que uma ordem foi cancelada pelo maker |
| **Suporte a LUNES Nativo** | Aceita `#[ink(payable)]` para depósito de LUNES via `env().transferred_value()` |
| **Suporte a PSP22** | Chama `psp22::transfer_from` para depósito de tokens PSP22 |
| **Eventos** | Emite `Deposit`, `Withdraw`, `TradeSettled`, `OrderCancelled` |

### 3.3 FRONTEND (Ajustes Necessários)

| Ajuste | Descrição |
|---|---|
| **Assinatura de Ordens** | Usar `signRaw` do Polkadot.js para assinar a ordem off-chain |
| **Deposit/Withdraw UI** | Tela para depositar/sacar do contrato Spot (custódia) |
| **WebSocket Client** | Substituir mock data por dados reais via WS |
| **OrderBook real** | Consumir `/api/orderbook/:pair` e WS diffs |
| **OrderHistory real** | Consumir `/api/orders?user=...` |
| **ChartPanel real** | Consumir `/api/candles/:pair?tf=1h` |

---

## 4. Schema do Banco de Dados (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Pair {
  id          String   @id @default(uuid())
  symbol      String   @unique          // "LUNES/USDT"
  baseToken   String                     // Endereço do token base
  quoteToken  String                     // Endereço do token quote
  baseName    String                     // "LUNES"
  quoteName   String                     // "USDT"
  baseDecimals  Int    @default(8)
  quoteDecimals Int    @default(8)
  isNativeBase  Boolean @default(false)  // true se base é LUNES nativo
  isNativeQuote Boolean @default(false)  // true se quote é LUNES nativo
  isActive    Boolean  @default(true)
  makerFee    Decimal  @default(0.001)   // 0.1%
  takerFee    Decimal  @default(0.0025)  // 0.25%
  createdAt   DateTime @default(now())

  orders      Order[]
  trades      Trade[]
  candles     Candle[]
}

model Order {
  id              String   @id @default(uuid())
  pairId          String
  makerAddress    String                  // Endereço da carteira
  side            String                  // "BUY" ou "SELL"
  type            String                  // "LIMIT", "MARKET", "STOP", "STOP_LIMIT"
  price           Decimal                 // Preço da ordem (0 para market)
  stopPrice       Decimal?                // Preço de ativação (stop orders)
  amount          Decimal                 // Quantidade total
  filledAmount    Decimal  @default(0)
  remainingAmount Decimal                 // = amount - filledAmount
  status          String   @default("OPEN") // "OPEN","PARTIAL","FILLED","CANCELLED"
  signature       String                  // Assinatura sr25519 da ordem
  nonce           String   @unique        // Nonce único anti-replay
  orderHash       String   @unique        // Hash da ordem (para referência on-chain)
  timeInForce     String   @default("GTC") // GTC, IOC, FOK
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  pair            Pair     @relation(fields: [pairId], references: [id])
  makerTrades     Trade[]  @relation("MakerTrades")
  takerTrades     Trade[]  @relation("TakerTrades")

  @@index([pairId, side, status, price])
  @@index([makerAddress, status])
  @@index([orderHash])
}

model Trade {
  id              String   @id @default(uuid())
  pairId          String
  makerOrderId    String
  takerOrderId    String
  makerAddress    String
  takerAddress    String
  side            String                  // Lado do taker
  price           Decimal
  amount          Decimal
  quoteAmount     Decimal                 // price * amount
  makerFee        Decimal
  takerFee        Decimal
  txHash          String?  @unique        // Hash da tx on-chain (após settlement)
  settledAt       DateTime?               // Quando foi liquidado on-chain
  createdAt       DateTime @default(now())

  pair            Pair     @relation(fields: [pairId], references: [id])
  makerOrder      Order    @relation("MakerTrades", fields: [makerOrderId], references: [id])
  takerOrder      Order    @relation("TakerTrades", fields: [takerOrderId], references: [id])

  @@index([pairId, createdAt])
  @@index([makerAddress])
  @@index([takerAddress])
}

model Candle {
  id          String   @id @default(uuid())
  pairId      String
  timeframe   String                     // "1m","5m","15m","1h","4h","1d","1w"
  openTime    DateTime
  open        Decimal
  high        Decimal
  low         Decimal
  close       Decimal
  volume      Decimal
  quoteVolume Decimal
  tradeCount  Int      @default(0)

  pair        Pair     @relation(fields: [pairId], references: [id])

  @@unique([pairId, timeframe, openTime])
  @@index([pairId, timeframe, openTime])
}

model UserBalance {
  id          String   @id @default(uuid())
  address     String
  token       String                     // Endereço do token ou "NATIVE"
  available   Decimal  @default(0)       // Disponível para ordens
  locked      Decimal  @default(0)       // Travado em ordens abertas
  updatedAt   DateTime @updatedAt

  @@unique([address, token])
  @@index([address])
}
```

---

## 5. API Pública REST (para bots e automação)

### Endpoints

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| `GET` | `/api/v1/pairs` | Listar todos os pares ativos | Não |
| `GET` | `/api/v1/ticker` | Ticker 24h de todos os pares | Não |
| `GET` | `/api/v1/ticker/:symbol` | Ticker 24h de um par | Não |
| `GET` | `/api/v1/orderbook/:symbol` | Snapshot do livro (depth) | Não |
| `GET` | `/api/v1/trades/:symbol` | Últimos trades de um par | Não |
| `GET` | `/api/v1/candles/:symbol` | Candles OHLCV | Não |
| `POST` | `/api/v1/order` | Criar ordem (assinada) | Signature |
| `DELETE` | `/api/v1/order/:id` | Cancelar ordem (assinada) | Signature |
| `GET` | `/api/v1/orders` | Ordens do usuário | Signature |
| `GET` | `/api/v1/balances` | Saldos do usuário no vault | Signature |

### WebSocket Events

| Canal | Evento | Payload |
|---|---|---|
| `orderbook:{symbol}` | `snapshot` | Livro completo |
| `orderbook:{symbol}` | `update` | Diff incremental (adds/removes/changes) |
| `trades:{symbol}` | `trade` | Novo trade executado |
| `ticker:{symbol}` | `ticker` | Atualização de preço/volume |
| `user:{address}` | `order_update` | Status da ordem mudou |
| `user:{address}` | `balance_update` | Saldo alterado |

---

## 6. Smart Contract: SpotSettlement (ink! 4.2.1)

### Estrutura do Contrato

```rust
#[ink::contract]
pub mod spot_settlement {
    // Funções públicas:

    // === DEPÓSITO / SAQUE ===
    #[ink(message, payable)]
    pub fn deposit_native(&mut self)
    // Deposita LUNES nativo no vault

    #[ink(message)]
    pub fn deposit_psp22(&mut self, token: AccountId, amount: Balance)
    // Deposita token PSP22 no vault (requer approve prévio)

    #[ink(message)]
    pub fn withdraw_native(&mut self, amount: Balance)
    // Saca LUNES nativo do vault

    #[ink(message)]
    pub fn withdraw_psp22(&mut self, token: AccountId, amount: Balance)
    // Saca token PSP22 do vault

    // === SETTLEMENT (chamado pelo Relayer) ===
    #[ink(message)]
    pub fn settle_trade(
        &mut self,
        maker_order: SignedOrder,
        taker_order: SignedOrder,
        fill_amount: Balance,
        fill_price: Balance,
    )
    // Valida assinaturas, verifica saldos, executa transferência atômica

    // === CANCELAMENTO ===
    #[ink(message)]
    pub fn cancel_order(&mut self, order_hash: Hash, signature: [u8; 64])
    // Registra cancel on-chain (maker-only)

    // === QUERIES ===
    #[ink(message)]
    pub fn get_balance(&self, user: AccountId, token: AccountId) -> Balance

    #[ink(message)]
    pub fn is_order_filled(&self, order_hash: Hash) -> bool

    #[ink(message)]
    pub fn is_order_cancelled(&self, order_hash: Hash) -> bool
}
```

### Estrutura `SignedOrder`

```rust
#[derive(Debug, Clone, Encode, Decode)]
pub struct SignedOrder {
    pub maker: AccountId,        // Quem criou a ordem
    pub base_token: AccountId,   // Token base (ou ZERO_ADDRESS para nativo)
    pub quote_token: AccountId,  // Token quote
    pub side: u8,                // 0 = BUY, 1 = SELL
    pub price: Balance,          // Preço em unidades mínimas
    pub amount: Balance,         // Quantidade em unidades mínimas
    pub nonce: u64,              // Nonce anti-replay
    pub expiry: u64,             // Timestamp de expiração
    pub signature: [u8; 64],     // Assinatura sr25519
}
```

---

## 7. Plano de Execução (Fases)

### Fase 1 — Smart Contract SpotSettlement (ink! 4.2.1)
**Prioridade:** ALTA | **Estimativa:** 3-5 dias

- [ ] Criar `/Lunex/contracts/spot_settlement/`
- [ ] Implementar storage: balances, filled_orders, cancelled_orders, nonces
- [ ] Implementar `deposit_native()` (payable) e `deposit_psp22()` (cross-contract call PSP22)
- [ ] Implementar `withdraw_native()` e `withdraw_psp22()`
- [ ] Implementar `settle_trade()` com validação de assinatura e transferência atômica
- [ ] Implementar `cancel_order()` com verificação de owner
- [ ] Implementar queries: `get_balance`, `is_order_filled`, `is_order_cancelled`
- [ ] Testes unitários completos (`#[ink::test]`)
- [ ] Constante `ZERO_ADDRESS` para identificar LUNES nativo vs PSP22

### Fase 2 — Backend: Setup + Prisma + CRUD
**Prioridade:** ALTA | **Estimativa:** 2-3 dias

- [ ] Criar `/spot-api/` na raiz do projeto
- [ ] Instalar: express, prisma, @prisma/client, ws, cors, helmet, express-rate-limit
- [ ] Schema Prisma completo (Pair, Order, Trade, Candle, UserBalance)
- [ ] Migration inicial do PostgreSQL
- [ ] Seed de pares iniciais (LUNES/USDT, LUNES/BTC, LUNES/ETH)
- [ ] CRUD REST para ordens com validação de assinatura sr25519
- [ ] Endpoint de deposit/withdraw sync (escuta eventos do contrato)

### Fase 3 — Matching Engine
**Prioridade:** ALTA | **Estimativa:** 2-3 dias

- [ ] Implementar orderbook em memória (sorted arrays por preço-tempo)
- [ ] Lógica Price-Time Priority matching
- [ ] Suporte a Limit, Market, Stop, Stop-Limit
- [ ] Ao match: criar Trade no DB + chamar `settle_trade()` on-chain
- [ ] Fill parcial: atualizar `filledAmount` e `remainingAmount`
- [ ] Lock/Unlock de saldos ao criar/cancelar ordens

### Fase 4 — WebSocket + API Pública
**Prioridade:** MÉDIA | **Estimativa:** 2 dias

- [ ] WebSocket server (ws ou socket.io)
- [ ] Canais: orderbook, trades, ticker, user
- [ ] Orderbook diffs (não enviar snapshot a cada update)
- [ ] Candle aggregator (agrega trades em OHLCV)
- [ ] Rate limiting (10 ordens/s por address, 60 req/min por IP para queries)
- [ ] Documentação Swagger/OpenAPI

### Fase 5 — Integração Frontend
**Prioridade:** MÉDIA | **Estimativa:** 2-3 dias

- [ ] Criar `SpotContext` (similar ao `SDKContext` existente)
- [ ] Integrar `signRaw` do Polkadot.js para assinar ordens
- [ ] Tela de Deposit/Withdraw (LUNES nativo + PSP22)
- [ ] Substituir mock do OrderBook por dados reais via WS
- [ ] Substituir mock do OrderForm por envio real de ordens assinadas
- [ ] Substituir mock do OrderHistory por dados reais via API
- [ ] Substituir mock do ChartPanel por candles reais via API
- [ ] Substituir mock do PairSelector por pares reais via API

### Fase 6 — Performance & Segurança
**Prioridade:** MÉDIA | **Estimativa:** 1-2 dias

- [ ] Redis para cache de orderbook em memória (opcional, se PostgreSQL não aguentar)
- [ ] Índices otimizados no PostgreSQL
- [ ] Testes de carga (k6 ou Artillery)
- [ ] Auditoria de segurança do contrato
- [ ] Rate limiting agressivo para proteção anti-spam
- [ ] Monitoramento de saúde do matching engine

---

## 8. Estrutura Final de Diretórios

```
Lunex/
├── Lunex/contracts/
│   ├── factory/           # Existente
│   ├── pair/              # Existente
│   ├── router/            # Existente
│   ├── wnative/           # Existente — wrap LUNES → wLUNES
│   ├── staking/           # Existente
│   ├── rewards/           # Existente
│   └── spot_settlement/   # NOVO — vault + settlement on-chain
│       ├── Cargo.toml
│       └── lib.rs
│
├── spot-api/              # NOVO — Backend off-chain
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── index.ts            # Express server entry
│   │   ├── config.ts           # Env vars, contract addresses
│   │   ├── routes/
│   │   │   ├── pairs.ts
│   │   │   ├── orders.ts
│   │   │   ├── trades.ts
│   │   │   ├── candles.ts
│   │   │   ├── balances.ts
│   │   │   └── ticker.ts
│   │   ├── services/
│   │   │   ├── matchingEngine.ts
│   │   │   ├── orderService.ts
│   │   │   ├── tradeService.ts
│   │   │   ├── candleService.ts
│   │   │   ├── settlementService.ts  # Chama contrato on-chain
│   │   │   └── signatureService.ts   # Valida sr25519
│   │   ├── websocket/
│   │   │   ├── server.ts
│   │   │   └── channels.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts               # Valida assinatura
│   │   │   ├── rateLimit.ts
│   │   │   └── validation.ts
│   │   └── utils/
│   │       ├── orderbook.ts          # Estrutura in-memory
│   │       └── helpers.ts
│   └── .env.example
│
├── lunes-dex-main/        # Frontend (existente)
│   └── src/
│       ├── components/spot/   # Existente — será integrado
│       ├── context/
│       │   ├── SDKContext.tsx  # Existente (AMM)
│       │   └── SpotContext.tsx # NOVO (Orderbook)
│       └── services/
│           ├── contractService.ts  # Existente
│           └── spotService.ts      # NOVO — REST + WS client
│
└── docs/
    └── SPOT_ORDERBOOK_ARCHITECTURE.md  # Este documento
```

---

## 9. Decisões Técnicas

| Decisão | Escolha | Justificativa |
|---|---|---|
| **Orderbook** | Off-chain (PostgreSQL + memória) | Latência <50ms vs ~6s on-chain por bloco |
| **Settlement** | On-chain (ink! 4.2.1) | Segurança de fundos, trustless |
| **Token nativo** | `deposit_native()` payable | Não precisa de wrap para operar |
| **PSP22** | `deposit_psp22()` com cross-contract | Approve + transfer_from padrão |
| **Assinaturas** | sr25519 (Substrate nativo) | Compatível com Polkadot.js `signRaw` |
| **DB** | PostgreSQL + Prisma | Typed queries, migrations, performance |
| **WebSocket** | ws (nativo Node.js) | Mais leve que socket.io para dados financeiros |
| **API Pública** | REST + WS | REST para bots simples, WS para tempo real |
| **Rate Limit** | express-rate-limit | 10 ordens/s por address, 60 req/min queries |

---

## 10. Fluxo de uma Ordem Limit (Exemplo)

```
1. Usuário preenche formulário no frontend (Buy 1000 LUNES @ 0.02345 USDT)
2. Frontend monta objeto da ordem com nonce único
3. Frontend chama signRaw() do Polkadot.js → gera assinatura sr25519
4. Frontend envia POST /api/v1/order com ordem + assinatura
5. Backend valida:
   a. Assinatura é válida?
   b. Nonce não foi usado?
   c. Usuário tem saldo suficiente no vault? (USDT disponível ≥ 23.45)
   d. Par existe e está ativo?
6. Backend trava saldo (available -= 23.45, locked += 23.45)
7. Backend insere ordem no DB (status=OPEN)
8. Backend insere no orderbook em memória
9. Matching Engine verifica se há asks ≤ 0.02345
10. Se match parcial/total:
    a. Cria Trade no DB
    b. Chama settle_trade() no contrato on-chain
    c. Contrato valida assinaturas e transfere saldos internos
    d. Emite evento TradeSettled
    e. Backend atualiza saldos (unlock, transfer)
    f. Backend publica via WebSocket: trade, orderbook update, ticker
11. Se não há match: ordem fica no book aguardando
```
