# Social Copytrade V1 SPEC

**Status:** completed  
**Owner:** Core Protocol / Social Trading  
**PRD:** [`./PRD.md`](./PRD.md)  
**Related docs:** [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md), [`../../API.md`](../../API.md), [`../../spot/copytrade-arquitetura.md`](../../spot/copytrade-arquitetura.md)

## Summary

Esta feature formaliza a separação entre três domínios que hoje se sobrepõem:

- `social graph`: perfis, follow, ideias, comentários, leaderboard e exposição pública;
- `copytrade vault`: depósito, saque, shares, posições, atividade e sinais;
- `economic distribution`: performance fee, afiliados e rewards.

O objetivo é transformar a implementação atual, que está híbrida e parcialmente simulada, em um contrato canônico e rastreável.

## Current Implementation Snapshot

### O que já existe e está útil

- perfis, follow e ideias em [`spot-api/src/services/socialService.ts`](../../../spot-api/src/services/socialService.ts);
- vaults, posições, atividade e sinais em [`spot-api/src/services/copytradeService.ts`](../../../spot-api/src/services/copytradeService.ts);
- API key de leader e autenticação de signals em [`spot-api/src/routes/copytrade.ts`](../../../spot-api/src/routes/copytrade.ts);
- performance fee com high-water mark em [`spot-api/src/utils/copytrade.ts`](../../../spot-api/src/utils/copytrade.ts);
- afiliados com cadeia de 5 níveis em [`spot-api/src/services/affiliateService.ts`](../../../spot-api/src/services/affiliateService.ts);
- analytics indexados em [`spot-api/src/services/socialIndexerService.ts`](../../../spot-api/src/services/socialIndexerService.ts) e [`spot-api/src/services/socialAnalyticsService.ts`](../../../spot-api/src/services/socialAnalyticsService.ts).

### Gaps críticos observados

1. **Duas superfícies de vault convivendo**
   - `/api/v1/social/vaults/:leaderId/deposit|withdraw` continuam existindo apenas como rotas legadas de compatibilidade em [`spot-api/src/routes/social.ts`](../../../spot-api/src/routes/social.ts), respondendo `410 Gone` e apontando para `/api/v1/copytrade/vaults/...`.
   - A lógica operacional remanescente de vault foi removida de `socialService`; o caminho canônico agora é `copytradeService`.

2. **Signal não equivale a execução real agregada**
   - `copytradeService.createSignal()` usa `positionEffect` (`AUTO`, `OPEN`, `CLOSE`) e `signalMode` (`AUTO`, `JOURNAL`, `EXECUTE_VAULT`) para separar journaling de execução real.
   - `realizedPnlPct` é calculado no servidor e persistido como dado derivado de fechamento, não como input confiável do caller.
   - A primeira fatia de `Option B` já existe: com vault contract-backed e melhor rota server-side executável (`ORDERBOOK` ou `AMM_V1`), o signal pode disparar ordem spot real e só depois persistir `CopyTradeExecution` a partir dos fills efetivos.
   - `ASYMMETRIC` ainda depende de assinatura de carteira; em `AUTO` o fluxo cai para journaling, mas agora retorna `walletAssistedContinuation.contractCallIntent` para continuação via wallet; em `EXECUTE_VAULT` ele falha explicitamente.
   - Guardrails de integridade foram adicionados no caminho canônico: `amountIn`/`amountOutMin` e `executionPrice` são validados como positivos, `OPEN` falha quando o notional estimado excede `CopyVault.totalEquity`, e o roteador rejeita execução quando `bestAmountOut < amountOutMin`.
   - A confirmação wallet-assisted agora recusa confirmação com `amountOut` abaixo de `signal.amountOutMin`, evitando fechamento assinado com pior saída do que o contrato do signal.

3. **Reconciliação ainda é DB-driven, mas já considera PnL realizado**
   - `vaultReconciliationService` passou a reconstruir equity por `deposits - grossWithdrawals + realizedPnl` a partir de signals fechados.
   - `copytradeService.createSignal()` continua incrementando `totalEquity` por `pnlDelta` em trades fechados.
   - O risco sistêmico de apagar PnL legítimo caiu, mas a fonte ainda é journaling de banco e não paridade on-chain.

4. **Rewards semanticamente desalinhados**
   - `rewardDistributionService` deixou de materializar `STAKER` por usuário a partir de `copyVaultPosition`; a distribuição para stakers agora é tratada como funding on-chain do contrato de staking.
   - O split canônico agora está explícito no backend e nos docs como `rewardPoolPct` seguido por `leader/trader/staker`, com validação de soma `100%` entre os subpools.
   - O frontend de rewards agora separa explicitamente `staking rewards` de `leader/trader rewards`: staking continua em `sdk.claimStakingRewards()` on-chain, enquanto leader/trader usam read/claim assinado contra `/api/v1/rewards/pending|claim`.
   - `sdk.rewards` foi alinhado para `pool`, `pending`, `history`, `weeks`, `claim` e `rankings`, e `weeks` agora expõe breakdown/observability por tipo para inspeção operacional dos payouts.

5. **Ranking e follower count agora têm contrato canônico, mas ainda precisam rollout completo**
   - `rewardDistributionService` passou a rankear leaders com `LeaderFollow.groupBy` para follower count real, `CopyVault.totalEquity` para AUM canônico e `LeaderAnalyticsSnapshot` para métricas como `roi30d`, `winRate` e `sharpe`.
   - o frontend de rewards deixou de reconstruir `Top Spot Traders` via `/trades` e maker+taker localmente; agora consome `GET /api/v1/rewards/rankings`.
   - o principal follow-up residual é remover ou despromover telas legadas que ainda usem rankings sociais quando a intenção do produto for reward-engine ranking.

### Atualização aplicada (2026-04-14)

- `depositToVault` deixou de criar `LeaderFollow` implicitamente; follow voltou a ser ação social explícita.
- API key challenge de líder passou a usar persistência com Redis (com fallback em memória), reduzindo risco operacional em restart e multi-instância.
- Falhas de auth de API key/challenge passaram a responder com semântica HTTP consistente (`401/403/404`) via `ApiError`, em vez de `500`.
- Cálculo de `pnlDelta` em fechamento de signal foi ajustado para usar notional do trade de abertura resolvido no histórico (`CopyTradeSignal`) como referência, evitando dependência direta do `amountIn` do fechamento.
- Distribuição semanal não marca mais semana como `DISTRIBUTED` quando funding/distribution on-chain de staker falha; o ciclo falha explicitamente para retry seguro.

## Scope

- Canonicalizar `copytrade` como superfície única de vault.
- Marcar `social/vaults/*` como legado e preparar sua remoção.
- Definir contrato explícito para `signal`.
- Corrigir a fórmula de reconciliação de vault.
- Alinhar reward distribution com staking, trader rewards e leader rewards.
- Registrar rollout e validação.

## Out of Scope

- Redesenho do leaderboard do zero.
- Mudança de fee schedule de produto.
- Nova UI completa de social/copytrade.
- Nova camada de custódia ou settlement fora do desenho atual.

## Impacted Modules

| Módulo | Arquivos principais | Papel |
|---|---|---|
| Social API | [`spot-api/src/routes/social.ts`](../../../spot-api/src/routes/social.ts), [`spot-api/src/services/socialService.ts`](../../../spot-api/src/services/socialService.ts) | Social graph e vestígios legados de vault |
| Copytrade API | [`spot-api/src/routes/copytrade.ts`](../../../spot-api/src/routes/copytrade.ts), [`spot-api/src/services/copytradeService.ts`](../../../spot-api/src/services/copytradeService.ts) | Vault canônico e signals |
| CopyVault on-chain | [`spot-api/src/services/copyVaultService.ts`](../../../spot-api/src/services/copyVaultService.ts) | Interação ink! real com vault |
| Analytics | [`spot-api/src/services/socialIndexerService.ts`](../../../spot-api/src/services/socialIndexerService.ts), [`spot-api/src/services/socialAnalyticsService.ts`](../../../spot-api/src/services/socialAnalyticsService.ts), [`spot-api/src/services/socialAnalyticsPipeline.ts`](../../../spot-api/src/services/socialAnalyticsPipeline.ts) | Snapshot e ranking |
| Rewards | [`spot-api/src/routes/rewards.ts`](../../../spot-api/src/routes/rewards.ts), [`spot-api/src/services/rewardDistributionService.ts`](../../../spot-api/src/services/rewardDistributionService.ts), [`spot-api/src/services/rewardPayoutService.ts`](../../../spot-api/src/services/rewardPayoutService.ts) | Pool, payout e claim |
| Affiliate | [`spot-api/src/routes/affiliate.ts`](../../../spot-api/src/routes/affiliate.ts), [`spot-api/src/services/affiliateService.ts`](../../../spot-api/src/services/affiliateService.ts) | Performance fee downstream |
| Reconciliation | [`spot-api/src/services/vaultReconciliationService.ts`](../../../spot-api/src/services/vaultReconciliationService.ts) | Drift detection |
| Frontend social | [`lunes-dex-main/src/services/socialService.ts`](../../../lunes-dex-main/src/services/socialService.ts), [`lunes-dex-main/src/pages/copytrade/Page.tsx`](../../../lunes-dex-main/src/pages/copytrade/Page.tsx) | UX social/copytrade |
| Frontend rewards | [`lunes-dex-main/src/pages/rewards/index.tsx`](../../../lunes-dex-main/src/pages/rewards/index.tsx) | Rewards UX |
| SDK rewards | [`sdk/src/modules/rewards.ts`](../../../sdk/src/modules/rewards.ts) | Contrato externo atual desatualizado |

## Design

### 1. Domain Boundaries

#### Social

Responsável por:

- perfil de leader;
- follow/unfollow;
- ideias, comentários e likes;
- leaderboard e exposição pública;
- followers e contexto do viewer.

Não deve ser responsável por:

- depósito e saque de vault;
- shares;
- journaling operacional de copytrade.

#### Copytrade

Responsável por:

- vault metadata;
- posições do follower;
- depósitos e saques;
- signals e executions;
- API key de leader;
- atividade do vault.

#### Rewards / Distribution

Responsável por:

- reward pool semanal;
- rewards de leader;
- rewards de trader;
- rewards de staker;
- payout e claim.

### 2. Canonical Vault Flow

Fluxo desejado:

1. follower autentica e deposita em `/copytrade/vaults/:leaderId/deposit`;
2. `copytradeService` valida vault, token, minDeposit e grava estado canônico;
3. quando houver contrato de vault habilitado e `copyVaultService` estiver pronto, a confirmação on-chain precede a gravação definitiva de DB;
4. follower passa a ter `CopyVaultPosition`;
5. saques usam HWM fee e atualizam `CopyVaultWithdrawal`.

Regras:

- `copytradeService` é a única fonte de verdade de shares e equity off-chain;
- `socialService` não deve manter outro motor de vault;
- depósito e saque devem retornar `executionMode` (`db-journal` ou `on-chain-confirmed`) e `txHash` quando houver confirmação on-chain;
- `followersCount` social pode derivar de follow explícito, não de shares diretamente.

### 3. Signal Modes

O sistema precisa escolher explicitamente um de dois contratos:

#### Option A — Execution Journal

`createSignal()` continua sendo journaling / simulation:

- registra intenção;
- calcula slices e métricas;
- usa `positionEffect` para explicitar `OPEN`/`CLOSE`, com `AUTO` apenas como compatibilidade controlada;
- calcula `realizedPnlPct` no servidor quando um fechamento é resolvido;
- não promete execução real dos seguidores.

Se este caminho for mantido, a documentação pública deve dizer isso sem ambiguidade.

#### Option B — Real Aggregated Execution

`createSignal()` passa a:

- reservar/usar a equity do vault;
- disparar order/router/contract path real;
- persistir `CopyTradeExecution` a partir de execução efetiva;
- atualizar PnL e equity só após confirmação.

Esta SPEC considera `Option B` o alvo de produto correto. O repositório agora implementa a primeira fatia server-side dessa opção para `ORDERBOOK` e `AMM_V1`, mantendo `Option A` como fallback controlado para rotas ainda não suportadas.

### 4. Performance Fee

O modelo atual de HWM é válido como base:

- fee cobrada apenas sobre lucro acima do high-water mark;
- fee aplicada no saque;
- fee registrada em `CopyVaultWithdrawal`;
- fee do leader pode alimentar comissão de afiliado.

Regras desejadas:

- `profitAmount`, `feeAmount` e `remainingHighWaterMark` devem continuar auditáveis;
- total de fee do leader precisa refletir saques reais, não apenas eventos sintéticos;
- follower precisa conseguir entender net/gross/fee no histórico.

### 5. Affiliate Distribution

O programa de afiliados atual distribui sobre:

- `SPOT`
- `MARGIN`
- `COPYTRADE`

Para copytrade, a distribuição hoje ocorre sobre `feeAmount` do saque. Isso é coerente com um modelo de performance fee, e deve permanecer, desde que:

- o saque seja canônico;
- a fee seja economicamente real;
- o batch semanal de payout continue separado da apuração.

### 6. Reward Distribution

Contrato desejado:

- `leader rewards`: derivados do ranking canônico de leaders;
- `trader rewards`: derivados do ranking anti-wash de traders;
- `staker rewards`: derivados exclusivamente do contrato/posição de staking, nunca de `copyVaultPosition`;
- claim e payout precisam ter contrato único por tipo de reward.

Ações obrigatórias:

- manter removido o acoplamento `STAKER -> copyVaultPosition`;
- alinhar schema comments, config e frontend;
- manter contrato canônico por tipo: `STAKER` via claim on-chain, `LEADER/TRADER` via claim assinado no rewards API.

### 7. Analytics and Ranking

O ranking deve consumir:

- snapshot indexado de performance;
- follower count canônico;
- AUM canônico do vault.

Regras:

- follower count de ranking e reward engine devem usar a mesma origem;
- PnL e equity devem refletir execução real, não reconstrução incompleta;
- indexer e reconciliador não podem se contradizer.

### 8. Reconciliation

O reconciliador atual não pode continuar usando só:

- `sum(deposits) - sum(grossWithdrawals)`.

Ele deve evoluir para uma das opções:

- ler estado on-chain do vault e comparar com DB;
- ou reconstruir equity com base em depósitos, saques, PnL realizado e ajustes explícitos.

Enquanto a paridade on-chain não existir, o reconciliador continua sendo uma reconstrução DB-side e deve ser tratado como mecanismo de integridade operacional, não como fonte final de NAV.

## Business Rules

### Social Enrollment

- follow é uma escolha social explícita;
- depósito em vault não deve ser a única fonte de truth para relacionamento social;
- unfollow não deve implicar saque automático.

### Vault Participation

- follower deposita no token aceito pelo vault;
- shares são proporcionais à equity e supply;
- primeiro depósito minta 1:1;
- saques queimam shares proporcionalmente.

### Leader Operations

- leader humano usa wallet signature;
- leader IA usa API key ou fluxo WEB3;
- signals precisam respeitar `maxSlippageBps` e `twapThreshold`.

### Gain Distribution

- performance fee do leader: apenas sobre lucro acima de HWM;
- affiliate commission: sobre fee real do copytrade;
- leader/trader/staker rewards: definidos por reward engine canônico e não por telas derivadas localmente.

## Interfaces and Contracts

### Canonical APIs

- `GET /api/v1/social/*` para social graph
- `GET|POST /api/v1/copytrade/*` para vaults e signals
- `GET|POST /api/v1/rewards/*` para reward pool, history, claim e distribuição
- `GET /api/v1/rewards/rankings` para leaderboard público canônico de leaders/traders do reward engine
- `GET|POST /api/v1/affiliate/*` para referral, dashboard e payout history

### Canonical Signal Contract

`POST /api/v1/copytrade/vaults/:leaderId/signals`

Campos operacionais:

- `pairSymbol`
- `side`
- `amountIn`
- `amountOutMin`
- `positionEffect`: `AUTO`, `OPEN`, `CLOSE`
- `signalMode`: `AUTO`, `JOURNAL`, `EXECUTE_VAULT`
- `executionPrice` opcional
- `route`, `strategyTag`, `maxSlippageBps`

Regras:

- `positionEffect` é o único campo que define a intenção de abertura/fechamento;
- `signalMode` define se o caller exige journaling, live execution ou fallback automático;
- `amountIn` e `amountOutMin` devem ser numéricos positivos; `executionPrice` e `amountOut` opcionais também seguem essa restrição quando enviados;
- `realizedPnlPct` é legado e não dirige mais a semântica do signal;
- `AUTO` resolve para `CLOSE` quando existe trade aberto compatível, senão `OPEN`;
- `signalMode: AUTO` tenta execução real quando existe `contractAddress` no vault e a melhor rota é executável no backend (`ORDERBOOK` ou `AMM_V1`);
- `OPEN` deve respeitar guardrail de capacidade econômica (`notional estimado <= CopyVault.totalEquity`);
- quando `AUTO` resolve para `ASYMMETRIC`, a resposta inclui `walletAssistedContinuation` (intent on-chain) e o journaling continua disponível;
- `GET /copytrade/vaults/:leaderId/signals/pending-wallet` expõe backlog de continuations pendentes para recuperação operacional do agente;
- confirmações wallet-assisted de `ASYMMETRIC` devem usar `POST /copytrade/vaults/:leaderId/signals/:signalId/wallet-confirmation` com assinatura `copytrade.confirm-wallet-signal`;
- confirmações wallet-assisted devem respeitar o piso econômico original do signal (`amountOut >= amountOutMin`);
- continuations pendentes devem expirar automaticamente por TTL (`EXPIRED`) via scheduler backend para evitar backlog infinito;
- em `signalMode: AUTO`, falhas operacionais na execução live devem degradar para journaling com log explícito, sem derrubar a operação do signal;
- `signalMode: EXECUTE_VAULT` falha quando a execução real do vault não está disponível para aquela rota (ex.: rotas que exigem wallet signature como `ASYMMETRIC`);
- `CLOSE` sem trade aberto compatível deve falhar com conflito explícito.

### Canonical Vault Mutation Contract

`POST /api/v1/copytrade/vaults/:leaderId/deposit`
`POST /api/v1/copytrade/vaults/:leaderId/withdraw`

Campos de resposta obrigatórios:

- identificador canônico (`depositId` ou `withdrawalId`);
- resultado econômico (`sharesMinted` ou `gross/net/fee`);
- `executionMode`: `db-journal` ou `on-chain-confirmed`;
- `txHash`: hash confirmado quando existir contrato de vault habilitado e chamada relayed bem-sucedida.

Regras:

- `on-chain-confirmed` significa que a mutação foi confirmada no contrato antes do journaling de DB;
- `db-journal` continua válido como fallback operacional quando o relayer/contrato não estiverem habilitados;
- falha no journaling após confirmação on-chain deve ser logada como incidente operacional de alta severidade.

### Legacy APIs to Deprecate

- `POST /api/v1/social/vaults/:leaderId/deposit`
- `POST /api/v1/social/vaults/:leaderId/withdraw`

## Security and Failure Modes

- reads privadas continuam assinadas;
- mutations continuam exigindo wallet signature ou API key válida;
- rewards admin continuam protegidos por bearer admin;
- signal failure não pode deixar DB em estado parcialmente confirmado se a execução real for adotada;
- reconciliador não pode sobrescrever equity quando a fonte de verdade for incompleta.

## Rollout and Migration

### Phase A — Canonicalization

- declarar `copytrade` como único módulo de vault;
- despromover `/social/vaults/*` para legado;
- registrar o contrato em docs e testes.

### Phase B — Accounting Integrity

- mover qualquer caminho remanescente de vault para `copytradeService`;
- confirmar depósito/saque on-chain antes do journaling quando `copyVaultService` estiver habilitado;
- corrigir reconciliador;
- validar HWM, equity e follower activity.

### Phase C — Rewards Alignment

- alinhar backend, frontend e SDK;
- separar staker rewards de follower vault shares;
- revisar payout/claim por tipo.

### Phase D — Execution Integrity

- decidir e implementar `signal` como journaling explícito ou execução real agregada;
- expandir a fatia já implementada de `ORDERBOOK` e `AMM_V1` para execução agregada completa nas demais rotas.

## Test Plan

- cobertura unitária de HWM, mint/burn de shares e payout economics;
- E2E para deposit/withdraw/activity/positions;
- validação explícita da descontinuação de `/social/vaults/*`;
- testes de reconciliação com cenários de PnL positivo e negativo;
- testes de reward distribution por tipo `LEADER`, `TRADER`, `STAKER`;
- smoke do fluxo `agent trade -> copytrade signal -> activity`.

Status atual de validação:

- smoke automatizado de `agent trade -> copytrade signal -> activity` já existe no backend;
- o fluxo validado cobre emissão best-effort de signal a partir de `tradeApi` e exposição posterior em `copytrade/activity`;
- há testes de economia de saque cobrindo `high-water mark`, `gross/net withdrawal`, `leader fee accrual` e comissão downstream de afiliado em `copytradeService`;
- há testes de reward distribution por tipo cobrindo `LEADER`, `TRADER` e o modo `STAKER` como funding on-chain não materializado em DB;
- há cobertura do split canônico do reward pool e de semanas distribuídas com observabilidade por tipo (`leader`, `trader`, `staker`);
- há cobertura do ranking canônico no reward engine usando follower count real, AUM do vault e snapshot analítico, além de uma rota pública de rankings para frontend/SDK;
- o frontend passou a expor claims separados para staking on-chain e leader/trader rewards assinados, consumindo o contrato canônico em vez de tratar tudo como um único saldo;
- a execução agregada real do vault continua fora desse smoke porque o contrato implementado hoje ainda é journaling explícito.

## Acceptance Criteria

- O repositório passa a ter uma SPEC canônica para social/copytrade.
- Fica registrado que `copytrade` é a única superfície operacional de vault.
- Os gaps de reconciliação, rewards e signal mode estão explicitados.
- Existe backlog executável para remover o estado híbrido atual.
