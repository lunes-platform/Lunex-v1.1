# Lunex SubQuery Indexer

Indexador blockchain da Lunex DEX baseado em [SubQuery](https://subquery.network/), equivalente ao The Graph para Substrate/Polkadot.

## Arquitetura

```
Lunes Blockchain (Substrate + ink! contracts)
        ↓
subquery-node  (indexa eventos on-chain → PostgreSQL)
        ↓
subquery-query (expõe GraphQL API sobre os dados indexados)
        ↓
spot-api/src/services/subqueryClient.ts
        ↓
socialIndexerService.ts → socialAnalyticsService.ts
        ↓
LeaderAnalyticsSnapshot (ROI, Sharpe, MaxDD, WinRate)
        ↓
/api/v1/social/* → Frontend /social
```

## O que é indexado

| Evento | Contrato | Dados salvos |
|--------|----------|-------------|
| `Swap` | Router | trader, par, amountIn/Out, timestamp |
| `LiquidityAdded` | Router | provider, par, amounts, LP tokens |
| `LiquidityRemoved` | Router | provider, par, amounts |
| `Deposited` | CopyVault | depositor, leader, amount, shares, sharePrice |
| `Withdrawn` | CopyVault | depositor, leader, amountOut, performanceFee |
| `TradeExecuted` | CopyVault | leader, par, amount, equityAfter |
| `CircuitBreakerTriggered` | CopyVault | vault, drawdownBps, equity |
| eventos genéricos | Substrate pallets | swap, trade, liquidity events via pallets |

## Entidades GraphQL

- `SwapEvent` — cada swap executado
- `LiquidityEvent` — add/remove de liquidez
- `VaultEvent` — depósitos/saques/trades no CopyVault
- `TradeEvent` — posições abertas/fechadas
- `WalletSummary` — agregados por carteira (atualizado em-place)
- `PairStats` — volume e contagens por par (atualizado em-place)
- `DailyProtocolStats` — métricas diárias do protocolo

## Setup local (Docker)

### 1. Construir o projeto SubQuery

```bash
cd subquery-node
npm install
npm run codegen   # gera tipos TypeScript a partir do schema.graphql
npm run build     # compila os mappings → dist/
```

### 2. Subir com docker-compose

```bash
# Na raiz do projeto
docker compose -f docker-compose.dev.yml up subquery-node subquery-query --build
```

Portas:
- `subquery-node`: http://localhost:3010
- `subquery-query` (GraphQL Playground): http://localhost:3011

### 3. Configurar o spot-api

No `spot-api/.env` ou `docker/.env.docker`:

```env
SUBQUERY_ENDPOINT=http://subquery-query:3000   # Docker interno
# SUBQUERY_ENDPOINT=http://localhost:3011       # acesso local direto
SUBQUERY_ENABLED=true
```

### 4. Verificar indexação

```bash
# Status do indexer
curl http://localhost:3010/health

# Testar GraphQL
curl -X POST http://localhost:3011 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ _metadata { lastProcessedHeight indexerHealthy } }"}'
```

## Exemplos de queries GraphQL

### Swaps de um trader

```graphql
query {
  swapEvents(
    filter: { trader: { equalTo: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" } }
    orderBy: BLOCK_NUMBER_DESC
    first: 10
  ) {
    nodes {
      id
      timestamp
      pairSymbol
      amountIn
      amountOut
    }
  }
}
```

### Leaderboard por volume

```graphql
query {
  walletSummaries(
    orderBy: TOTAL_SWAP_VOLUME_IN_DESC
    first: 20
  ) {
    nodes {
      address
      totalSwapCount
      totalSwapVolumeIn
      totalRealizedPnl
      winningTrades
      losingTrades
    }
  }
}
```

### Stats diárias dos últimos 7 dias

```graphql
query {
  dailyProtocolStats(
    orderBy: DATE_DESC
    first: 7
  ) {
    nodes {
      date
      swapCount
      swapVolumeUsd
      uniqueTraders
      vaultDeposits
    }
  }
}
```

### Eventos do CopyVault de um leader

```graphql
query {
  vaultEvents(
    filter: {
      leader: { equalTo: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" }
      kind: { equalTo: "TRADE_EXECUTED" }
    }
    orderBy: BLOCK_NUMBER_DESC
    first: 50
  ) {
    nodes {
      timestamp
      pairSymbol
      amountIn
      equityAfter
    }
  }
}
```

## Variáveis de ambiente do projeto SubQuery

Configuradas no `docker-compose.dev.yml` para os serviços `subquery-node` e `subquery-query`:

| Variável | Descrição | Default |
|----------|-----------|---------|
| `DB_USER` | Usuário PostgreSQL | `lunex` |
| `DB_PASS` | Senha PostgreSQL | `lunex_dev` |
| `DB_DATABASE` | Banco de dados | `lunex_subquery` |
| `DB_HOST` | Host do PostgreSQL | `postgres` |
| `START_BLOCK` | Bloco inicial de indexação | `1` |

## Configuração para produção

Em produção, atualizar `project.yaml`:

1. Substituir `${LUNES_WS_URL}` pelo endpoint RPC de produção
2. Substituir `${SUBQUERY_CHAIN_ID}` pelo genesis hash da rede
3. Substituir `${ROUTER_CONTRACT_ADDRESS}` e `${COPY_VAULT_CONTRACT_ADDRESS}` pelos endereços reais
4. Considerar usar o [SubQuery Managed Service](https://managedservice.subquery.network/) para hospedagem gerenciada

## Fallback para polling RPC direto

Se o `SUBQUERY_ENDPOINT` não estiver configurado ou o SubQuery estiver indisponível, o `socialIndexerService` automaticamente faz fallback para o modo de polling RPC direto via Polkadot.js (mais lento, mas funcional).

Logs indicam a fonte:
- `[SocialIndexer] SubQuery sync: N new events` → usando SubQuery ✅
- `[SocialIndexer] SubQuery sync failed, falling back to RPC` → usando RPC polling ⚠️
