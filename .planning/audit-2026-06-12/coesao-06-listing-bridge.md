# Coesão 6/6 — Listing de Token + Asset Bridge

**Data:** 2026-06-12
**Escopo:** Entrada de novos ativos no protocolo (listagem de token + bridge nativo↔PSP22).
**Modo:** Somente leitura.

## Tese avaliada

> "Um token é listado via escrow de taxa on-chain + liquidity lock, ativado SÓ contra prova
> finalizada (SubQuery), com relayer durável; e o asset bridge faz wrap/unwrap de ativos
> nativos↔PSP22 de forma consistente, sem mint/burn indevido."

## Veredito: **PARCIAL** (forte, com 1 ressalva de contrato + lacunas operacionais)

A camada off-chain (spot-api + relayer + bridge) implementa fail-closed contra evidência
finalizada do SubQuery de forma sólida e coesa. A ressalva central está **no contrato**
`listing_manager`, cuja semântica de "ativação por prova" vive inteiramente no plano off-chain:
o contrato marca `ListingStatus::Active` de forma síncrona no `list_token`, sem etapa
`Pending`. Isso não quebra a tese (o gate de prova existe na camada que controla a UI/orderbook),
mas significa que "ativado SÓ contra prova" é uma garantia **do spot-api**, não do contrato.

A migração de logging do `assetBridgeService` para **pino está CONFIRMADA**: o arquivo importa
`{ log } from '../utils/logger'` e usa `log.info/warn/error` em todo o fluxo (deposit, mint,
withdraw, state). Nenhum `console.*` remanescente no serviço.

---

## Tabela de handoffs (contrato → spot-api → relayer → indexer → frontend)

| # | Origem | Evento/Chamada | Destino | Consistência |
|---|--------|----------------|---------|--------------|
| H1 | `listing_manager::list_token` | `transfer_from` taxa LUNES → contrato; `FeeDistributed` (20/50/30) | tesouraria/staking/rewards | OK — escrow on-chain real, checked math |
| H2 | `listing_manager` | `TokenListed` + `LiquidityLocked` (mesmo `lock_id`) | SubQuery `handleTokenListed`/`handleLiquidityLocked` | OK — ambos registrados em project.yaml |
| H3 | SubQuery `ListingEvent` | `getListingEventsByTxHash(txHash)` | `listingProofService` | OK — prova exige TOKEN_LISTED **e** LIQUIDITY_LOCKED finalizados |
| H4 | relayer (finalized head) | `POST /listing/:id/activate` (Bearer admin) | `listingService.activateListing` | OK — `requireAdmin`; relayer pareia tokenListed+locked por `lockId` antes de chamar |
| H5 | `listingService.activateListing` | `verifyListingActivationProof` | SubQuery | OK — fail-closed: throw se evento finalizado ausente; exige `status===PENDING` |
| H6 | user extrinsic `assets.transfer(bridge)` | finalized head | `assetBridgeService.processDeposits` | OK — só finalized; dedup `block:extrinsicIdx` |
| H7 | `assetBridgeService` | `wrapper.mint_with_ref(user, amt, ref)` | `asset_wrapper` | OK — `deposit_ref` rejeita double-mint on-chain + dedup local |
| H8 | `asset_wrapper::request_withdraw` | `WithdrawRequest` (burn já feito) | `assetBridgeService.processWithdrawals` | OK — burn precede evento; pre-flight balance check antes do release |
| H9 | `assetBridgeService` | `assets.transfer(user, amt)` | pallet-assets | OK — só após burn confirmado; dedup `w:block:idx` |
| H10 | bridge Mint/WithdrawRequest events | — | SubQuery | **LACUNA** — não indexados (sem handler no project.yaml) |

---

## Verificação ponto a ponto

### 1. Ativação fail-closed contra evidência finalizada? Relayer não ativa por isInBlock?
**SIM — robusto.**
- `assetBridgeService.ts:163` e `listing-relayer.ts:541` usam `subscribeFinalizedHeads` /
  `getFinalizedHead` — nunca `isInBlock`/`subscribeNewHeads`. Comentário SEC B-01 explícito.
- `listingProofService.requireListingProofVerifier()` lança erro se `SUBQUERY_ENABLED!=true`
  (exceto `nodeEnv==='test'`). `verifyListingActivationProof` exige encontrar `TOKEN_LISTED`
  **e** `LIQUIDITY_LOCKED` finalizados batendo owner/token/pair/tier/lockId/lpAmount, senão throw.
- `listingService.activateListing` exige `status===PENDING` e chama o verifier antes de mudar status.
- Rota `/:id/activate` protegida por `requireAdmin` (Bearer) — relayer é o único chamador.

### 2. liquidity_lock::withdraw (transfer PSP22 real, atrás de #[cfg(not(test))]) — off-chain confia? Janela respeitada?
**Parcialmente — confia, mas com risco residual de teste.**
- Contrato: `withdraw` faz `build_call(PSP22::transfer)` real em produção (`liquidity_lock` sec 3),
  com rollback (`record.withdrawn=false`) e `Error::TransferFailed` em falha. `LockNotExpired`
  protege a janela; `AlreadyWithdrawn` previne dupla retirada. Correto.
- O bypass `#[cfg(not(test))]` significa que **a transferência PSP22 nunca é exercida em unit test** —
  só a máquina de estados (expiry, double-withdraw, auth). Cobertura real do transfer depende de
  testes de integração em testnet (declarado em comentário, não verificado neste audit).
- Off-chain: `verifyListingUnlockProof` exige `LIQUIDITY_UNLOCKED` finalizado (lockId+owner+lpAmount)
  antes de finalizar a retirada via `/lock/onchain/:onChainLockId/withdraw-finalized` (requireAdmin).
  A janela de lock real é a `unlock_at` on-chain; o spot-api calcula `unlockAt` próprio na ativação
  (`Date.now()+cfg.lockMs`) — **divergência potencial**: o relógio off-chain é informativo, a verdade
  é a expiração on-chain. Aceitável pois o withdraw real é gated pelo contrato.

### 3. Bridge: deposit→mint, withdraw→burn+release. Contas batem? Dedup por finality?
**SIM — sem mint sem deposit, sem release sem burn.**
- WRAP: deposit detectado em bloco finalizado → `mint_with_ref(user, amount, ref)`. `ref =
  block*10000+extrinsicIdx`. Contrato rejeita ref repetido (`DepositAlreadyProcessed`) e há dedup
  local persistido (`processedDeposits[block:idx]`). Falha de mint **não** marca processado (retry).
- UNWRAP: `request_withdraw` **queima primeiro** (`_burn` + `total_withdrawn`), depois emite
  `WithdrawRequest`. Relayer faz pre-flight balance check (SEC B-05) e só então `assets.transfer`.
  Saldo insuficiente → não marca processado (intervenção manual). Auditoria on-chain via
  `total_minted`/`total_withdrawn`. Ordem garante "sem release sem burn".
- Dedup por finality: ambos os fluxos só processam `subscribeFinalizedHeads`; `lastProcessedBlock`
  pula blocos já vistos.

### 4. Relayer durável recupera de crash sem reprocessar nem pular? Métricas cobrem parada/lag?
**Recuperação: SIM, forte. Métricas: parcial.**
- Cursor durável: `saveState` escreve atômico (`.tmp` + `rename`). `processFinalizedBlock`
  (listing-relayer.ts:520-537) só avança cursor **após** `Promise.allSettled` confirmar que nenhum
  eventTask rejeitou — se uma activation falha, lança antes do `saveState`, cursor não avança → retry.
- Sem skip: `processLiveHead` (562-575) faz backfill de `lastFinalizedBlock+1` até o head atual,
  cobrindo gaps perdidos durante downtime. `replayFromCursor` reprocessa janela `REPLAY_BLOCKS`
  no boot. Dedup in-memory (`processed` Set por blockHash:idx:addr) evita re-trabalho intra-sessão;
  e a idempotência final está no contrato (`status PENDING` / `deposit_ref`).
- Métricas relayer: Prometheus em `/metrics` — `up`, `uptime`, `last_finalized_block`,
  `cursor_age_seconds` (cobre relayer parado/lag de cursor), `processed/failed_blocks_total`,
  `activation_success/failure_total`, `withdraw_success/failure_total`. Bom.
- **LACUNAS:** (a) `assetBridgeService` **não expõe métricas Prometheus** (só logs pino) — não há
  gauge de `lastProcessedBlock`/lag para o bridge. (b) Não há métrica de **lag do indexer SubQuery**
  (distância head finalizado vs. último bloco indexado) em nenhum dos dois — alerta de "indexer parado"
  depende de monitoramento externo.

### 5. SubQuery schema cobre eventos de listing/bridge? Mappings consistentes com eventos reais?
**Listing: SIM. Bridge: NÃO (lacuna).**
- `schema.graphql` define `ListingEvent` com kind `TOKEN_LISTED|LIQUIDITY_LOCKED|LIQUIDITY_UNLOCKED|
  FEE_DISTRIBUTED` e todos os campos (listingId, lockId, owner, pairAddress, lpAmount, tier, fees).
- `project.yaml` registra os 4 handlers (`handleTokenListed`, `handleFeeDistributed`,
  `handleLiquidityLocked`, `handleLiquidityUnlocked`) em `contracts.ContractEmitted`.
- `mappings/listing.ts` lê args reais (`token_address`, `lock_id`, `lp_amount`, etc.) — consistente
  com os eventos dos contratos. Pequena observação: `FeeDistributed` deriva `listingFee` somando
  burn+treasury+rewards (não há `burn` no contrato — é "staking"; nomenclatura `burnAmount`
  no schema mapeia para a fatia de 20% staking, divergência cosmética de nome).
- **LACUNA:** os eventos do `asset_wrapper` (`Mint`, `WithdrawRequest`) **não têm handler nem
  entidade no SubQuery**. O bridge não é indexado — o relayer depende só de seu próprio state file
  para auditoria, sem fonte de verdade indexada cruzável (diferente do listing, que tem prova SubQuery).

---

## Lacunas (priorizadas)

| Sev | Lacuna | Local | Impacto |
|-----|--------|-------|---------|
| MÉDIA | `asset_wrapper` Mint/WithdrawRequest não indexados no SubQuery | subquery-node/project.yaml + schema.graphql | Bridge sem prova finalizada cruzável; auditoria depende de state file local |
| MÉDIA | `assetBridgeService` sem métricas Prometheus (só logs) | assetBridgeService.ts | Sem gauge de lastProcessedBlock/lag → parada do bridge invisível ao monitoramento |
| MÉDIA | Sem métrica de lag do indexer SubQuery (head finalizado vs. indexado) | relayer + bridge | "Indexer parado" não dispara alerta; prova pode ficar indisponível silenciosamente |
| BAIXA | `listing_manager` ativa `Active` síncrono (sem `Pending` on-chain) | listing_manager/lib.rs list_token | Gate de prova é só off-chain; semântica "ativado por prova" não é garantida pelo contrato |
| BAIXA | PSP22 transfer do withdraw nunca exercido em unit test (`#[cfg(not(test))]`) | liquidity_lock/lib.rs | Cobertura do transfer real depende de testnet (declarado, não verificado) |
| BAIXA | `unlockAt` off-chain (Date.now()+lockMs) pode divergir do `unlock_at` on-chain | listingService.activateListing | Apenas informativo; withdraw real é gated pelo contrato |

---

## Conclusão

A espinha dorsal off-chain (fail-closed por prova finalizada, relayer com cursor durável e
no-skip/no-reprocess, bridge com dedup por finality + ordem burn-antes-de-release) está **coesa e
correta**. A tese é **PARCIAL** por: (1) o gate "ativado SÓ contra prova" ser garantia do spot-api
e não do contrato (que ativa síncrono), e (2) o lado bridge do "indexer" não existir no SubQuery,
deixando o wrap/unwrap sem fonte de verdade indexada equivalente à do listing. Nenhum caminho de
mint/burn indevido foi encontrado.
