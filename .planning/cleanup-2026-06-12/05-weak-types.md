# 05 — Tipos Fracos (`any` / `as any` / `unknown` mal usado)

> Agente 5/8 — Fase A (somente leitura). Data: 2026-06-11.
> Escopo: spot-api/src, lunes-dex-main/src, lunex-admin/src, sdk/src, mcp/lunex-agent-mcp/src, scripts/.
> Excluídos: node_modules, dist, build, .next, `.d.ts`, .planning/, e testes com `any` deliberado em mocks (contados à parte).
> Convenção respeitada: `catch (e: unknown)` é correto e NÃO entra na contagem de problemas (29 ocorrências em catch identificadas e ignoradas).

## 1. Contagem por pacote (código de produção, ocorrências de `any`)

| Pacote | `any` (prod) | Arquivos afetados | `any` em testes (ignorar) | `as unknown as X` (suspeito) | Observação |
|---|---|---|---|---|---|
| spot-api/src | **156** | 22 | 68 | 8 | Maior ofensor; serviços de social/copytrade/margin |
| lunes-dex-main/src | **114** | 25 | 0 | 2 | Concentrado em contractService/asymmetricContractService |
| scripts/ | **113** | 16 | 0 | 9 | Quase tudo workaround polkadot.js (root usa @polkadot/api ^9.10.3 e ^10.9.1 simultâneos) |
| sdk/src | **33** | 9 | 0 | 0 | http-client.ts é metade do problema |
| mcp/lunex-agent-mcp/src | **1** | 1 | 0 | 0 | Praticamente limpo (usa `unknown` corretamente) |
| lunex-admin/src | **0** | 0 | 0 | 1 | ✅ Limpo — referência de qualidade do repo |
| **TOTAL** | **417** | 73 | 68 | 20 | |

Uso de `: unknown` em prod: 83 ocorrências, das quais ~29 são catch blocks (corretas) e a maioria do restante são funções de narrowing legítimas (`toFloat(value: unknown)`, `normalizePlanckAmount(value: unknown)`) — **não mexer**. Problema real de `unknown` está apenas nos double-casts `as unknown as any[]` / `as unknown as () => void` (~20).

## 2. Padrões recorrentes identificados (prod)

| Padrão | Ocorrências | Tipo-alvo | Confiança |
|---|---|---|---|
| `(result: any) =>` em callbacks de `signAndSend` | 19 | `ISubmittableResult` (`@polkadot/types/types`) | **ALTA** |
| `client: any` / `tx as any` (transação Prisma) | 13 | `Prisma.TransactionClient` | **ALTA** |
| `prisma as any` / `db = prisma as any` | 9 | `PrismaClient` direto — **todos os modelos acessados (userReward, socialIndexedEvent, rewardWeek, socialAnalyticsCursor, leaderAnalyticsSnapshot, leader, marginPosition, copyTradeWalletContinuation) JÁ EXISTEM em schema.prisma**; cast é resquício de client desatualizado → `prisma generate` resolve | **ALTA** |
| `(r: any)` em `.map/.filter/.reduce` sobre resultados Prisma | ~30 | Tipo inferido do query ou `Prisma.<Model>GetPayload<{...}>` | **ALTA** |
| `output.toJSON() as any` (polkadot codec) | 25 | Interface de retorno por mensagem do contrato (ex.: `{ ok?: T; err?: E }`) | MÉDIA |
| `this.api as any` em `new ContractPromise(...)` | 27 | Remover cast — spot-api e lunes-dex-main usam @polkadot/api e api-contract na MESMA versão (16.5.3); cast provavelmente é resquício; `tsc` confirma | MÉDIA |
| `RouterABI as any` etc. (JSON de ABI importado) | 17 | `Record<string, unknown>` ou `Abi` (assinatura de `ContractPromise` aceita) | MÉDIA |
| `gasRequired as any` / `gasLimit as any` | 4 | `WeightV2` (`@polkadot/types/interfaces`) | ALTA |
| `as unknown as any[]` em eventRecords | ~10 | `Vec<EventRecord>` (`@polkadot/types/interfaces`) | MÉDIA |
| Scripts de deploy com `as any` em ApiPromise/keyring | ~94 | Workaround conhecido (versões 9.x/10.x conflitantes no root package.json) | BAIXA |

## 3. Hotspots e substituições propostas

### 3.1 `spot-api/src/services/socialIndexerService.ts` — 46 ocorrências (maior hotspot)
- **L92 `const db = prisma as any`** e **L1277 `(prisma as any).leader`**: modelos existem no schema → usar `prisma` tipado. **ALTA**.
- **L444-514 `new ContractPromise(this.api as any, xAbi as any, ...)`** (10 casts): api e api-contract na mesma versão 16.5.3 → remover `this.api as any`; ABIs JSON tipar como `Record<string, unknown>`. **MÉDIA** (verificar com tsc).
- **L103-172 helpers `toSerializable(value: any)`, `extractAddresses(payload: any)`, `extractNumbers`, `extractPairSymbol`**: trocar `any` por `unknown` + narrowing (já fazem narrowing interno). **ALTA**.
- **L851-852 `(decoder.contract.abi as any).decodeEvent(eventData as any)`**: API dinâmica de decode de eventos — `Abi.decodeEvent` espera `EventRecord`; requer refactor do fluxo. **BAIXA/MÉDIA**.
- **L963-994 `eventRecords as unknown as any[]`**: tipar como `Vec<EventRecord>`. **MÉDIA**.
- **L38 `payload: any`** em interface interna: definir union/`Record<string, unknown>`. **ALTA**.

### 3.2 `lunes-dex-main/src/services/contractService.ts` — 42 ocorrências
- **L375, 733, 851, 935, 1042, 1088, 1130, 1255, 1325 `(result: any) =>`** (9×): → `ISubmittableResult`. **ALTA** — mudança local, import único.
- **L150 `makeDryGas(): any`**: → `WeightV2`. **ALTA**.
- **L159 `decodeDispatchError(dispatchError: any)`**: → `DispatchError` (`@polkadot/types/interfaces`). **ALTA**.
- **L256-1357 `output.toJSON() as any`** (14×): definir interfaces de retorno por query (`getReserves`, `balanceOf`, etc.). **MÉDIA** — exige criar tipos, mas isolado por método.
- **L116-604 `PairABI as any` etc.** (10×): → `Record<string, unknown>` ou habilitar `resolveJsonModule`. **MÉDIA**.
- **L212 `(await this.api.query.system.account(...)) as any`**: → `FrameSystemAccountInfo`/`AccountInfo`. **MÉDIA**.

### 3.3 `spot-api/src/services/rewardDistributionService.ts` — 19 `any` + padrão Prisma
- **L85 `const db = prisma as any`**: modelos `rewardWeek`/`userReward` existem no schema → remover. **ALTA**.
- **L330, 1094-1228 `(r: any)`, `(snapshot: any)`, `(week: any)`** (~14×): tipos inferem automaticamente após remover o `db as any`; alternativamente `Prisma.UserRewardGetPayload<{}>`. **ALTA** (cascata positiva: 1 fix elimina ~14 `any`).

### 3.4 `scripts/listing-relayer.ts` — 19 ocorrências (script de produção, não deploy)
- **L297-328 `decodeTokenListedEvent(data: any[])`**: → `Codec[]` ou `GenericEventData`. **MÉDIA**.
- **L430, 477, 562 `block: any`, `blockHash: any`, `header: any`**: → `SignedBlock`, `BlockHash`, `Header` (`@polkadot/types/interfaces`). **MÉDIA** (root tem versões 9.x/10.x conflitantes — verificar qual resolve).
- **L484-501 `rawEvents as unknown as any[]`**: → `Vec<EventRecord>`. **MÉDIA**.

### 3.5 `lunes-dex-main/src/services/asymmetricContractService.ts` — 19 ocorrências
- **L116-429 `(result: any)` (6×) e `({ event }: any)`**: → `ISubmittableResult` / `EventRecord`. **ALTA**.
- **L341-422 `gasLimit: gasRequired as any`** (3×): `gasRequired` já é `WeightV2` no retorno de query — remover cast. **ALTA**.
- **L51 já documenta eslint-disable** — exemplo do padrão "exceção documentada" exigido pelo CONTRIBUTING; replicar onde o cast for inevitável.
- **L58-94 ABI/bundle casts**: **MÉDIA**.

### 3.6 `sdk/src/http-client.ts` — 17 ocorrências
- **L155-200 `this.instance.get<any, unknown>(...)`** (5×): primeiro generic do axios é o tipo de `response.data` → usar `get<unknown, unknown>` ou propagar `<T>`. **ALTA**.
- **L209-223 `(customError as any).details/statusCode/code`**: criar classe `LunexApiError extends Error` com campos tipados (o SDK já tem `sdk/src` types próprios). **ALTA** — melhora API pública do SDK.

### 3.7 `spot-api/src/services/copytradeService.ts` — 16 ocorrências
- **L499-523 `(routedExecution.contractCallIntent as any).X`** (8×): definir interface `ContractCallIntent { contractAddress; method; minAmountOut; makerAddress; nonce; agentId? }` no tipo de retorno do router. **MÉDIA** (requer ajuste no tipo de `routedExecution` — cadeia).
- **L165-167 `client: unknown` + `(client as any).copyTradeWalletContinuation`**: → `Prisma.TransactionClient` (modelo existe no schema). **ALTA**.
- **L1325 `'PENDING_WALLET_SIGNATURE' as any`**: enum status — se o valor existe no enum Prisma, usar o enum; se não, é bug latente. **ALTA** (investigar).
- **L1284, 1593 `prisma as any` / `tx as any`**: → `Prisma.TransactionClient`. **ALTA**.

### 3.8 `spot-api/src/services/marginService.ts` — 12 ocorrências
- **L30 `prismaAny = prisma as any`** + **L345-546 `client: any` (6×)** + **L782-1066 `tx as any` (5×)**: tudo → `Prisma.TransactionClient`. **ALTA** — padrão único, fix mecânico.
- **L404 `catch (error: any)`**: → `unknown` (convenção do repo). **ALTA**.

### 3.9 `spot-api/src/services/socialService.ts` — 12 ocorrências
- **L79 `db = prisma as any`**: remover (modelos existem). **ALTA**.
- **L36-164 `formatTrade(trade: any)`, `formatIdea`, `formatComment`, `formatFollower`, `leaders: any[]`**: → `Prisma.LeaderTradeGetPayload<...>`, `Prisma.SocialIdeaGetPayload<{ include: ... }>` etc. **MÉDIA** (precisa casar com os `include` usados nos queries).

### 3.10 `lunes-dex-main/src/services/strategyService.ts` — 10 ocorrências
- **L106 `normalize(s: any)`** e **L164-292 `apiRequest<{ strategies: any[] }>`**: o arquivo já tem o tipo `Strategy` — criar `RawStrategyDTO` (shape da API) e usar nos generics. **ALTA** — tipos locais, sem cadeia.

### 3.11 Demais (cauda)
- `spot-api/src/services/assetBridgeService.ts` (14): `adminAccount: any` → `KeyringPair`; `(this.api.query as any).assets.account` → augment de tipos ou `QueryableStorage`; callbacks → `ISubmittableResult`/`EventRecord`. ALTA/MÉDIA.
- `spot-api/src/services/rebalancerService.ts` (10), `rewardPayoutService.ts` (8), `factoryService.ts` (7): mesmos padrões (callbacks polkadot + rows Prisma). ALTA/MÉDIA.
- `lunes-dex-main/src/services/agentService.ts` (7): DTOs de API → interfaces locais. ALTA.
- `scripts/deploy-*.ts`, `debug_contracts.ts`, `fund_tester.ts`, `discover_tokens.ts`, `list-token.ts`, `verify-deployment.ts` (~94 no total): `as any` em ApiPromise/ContractPromise/keyring — **workaround conhecido** das versões @polkadot/api ^9.10.3 + ^10.9.1 coexistindo no package.json raiz. **BAIXA** — não tocar sem antes unificar versões (problema raiz é dependência, não tipo).

## 4. Resumo por confiança (ocorrências em prod)

| Confiança | Estimativa | Principais grupos |
|---|---|---|
| **ALTA** | **~115** | Callbacks `ISubmittableResult` (19), Prisma `TransactionClient`/`prisma as any`/rows (~55), axios generics + error class SDK (11), `WeightV2`/`DispatchError` (7), helpers `any`→`unknown` com narrowing (~15), DTOs strategyService/agentService (~12) |
| **MÉDIA** | **~170** | `toJSON() as any` → interfaces de retorno (25), ABI JSON casts (17), `this.api as any` (27 — depende de tsc), `contractCallIntent` (10), `Vec<EventRecord>` (~15), listing-relayer (19), formatters socialService (~12), cauda diversa |
| **BAIXA** | **~130** | Scripts de deploy/debug com conflito de versão polkadot 9.x/10.x (~94), decode dinâmico de eventos ABI (~20), casts profundos no indexer (~16) |

## 5. Recomendações de ordem de ataque (Fase B)

1. **Quick win com cascata**: rodar `prisma generate` no spot-api e remover todos os `prisma as any`/`db as any`/`tx as any` → elimina ~55 ocorrências e os `(r: any)` passam a inferir sozinhos. Verificável com `tsc --noEmit`.
2. **Mecânico**: `(result: any)` → `ISubmittableResult` em contractService/asymmetricContractService/assetBridgeService (1 import por arquivo).
3. **SDK público**: tipar http-client (axios generics + `LunexApiError`) — afeta consumidores do SDK, maior valor por ocorrência.
4. **Interfaces de retorno de contrato** (`toJSON() as any`): criar `lunes-dex-main/src/types/contract-results.ts` com os shapes — MÉDIA, mas concentra 25 ocorrências.
5. **NÃO tocar agora**: scripts de deploy (BAIXA) até unificar @polkadot/api no root; catch blocks com `unknown`; funções de narrowing com `unknown`; mocks de teste (68 ocorrências).

lunex-admin permanece como referência: 0 `any` em 55 arquivos.
