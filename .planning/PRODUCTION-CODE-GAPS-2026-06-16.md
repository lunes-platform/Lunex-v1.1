# Lunex DEX — Lacunas de Código para Produção (sem auditoria externa, sem infra)

**Data:** 2026-06-16
**Escopo:** Análise profunda do código real de todos os módulos. Apenas **código e módulos** — exclui auditoria externa (já prevista, MAINNET-03) e infra/devops (docker, k8s, prometheus, volumes, secrets manager). Foco em encontrar **mockups, stubs, no-ops e paths fake** que ainda bloqueiam mainnet com fundos reais.

**Método:** 6 agentes paralelos varreram contratos ink!, spot-api, frontend DEX, lunex-admin, sdk+mcp, subquery+faucet. Cada achado validado contra o código atual (file:line), não contra comentários/docs.

**Veredito:** 🔴 **NO-GO para mainnet** — confirma o status de 2026-06-12, mas agora com o mapa de código exato. Os bloqueadores se concentram em **3 temas de confiança off-chain** + **lacunas de honestidade de teste** que impedem *provar* que os paths reais funcionam.

---

## 🔴 Os 3 bloqueadores estruturais (resolver primeiro)

Custódia, trava de liquidez e settlement dependem hoje de atores off-chain confiáveis **sem fallback on-chain**. Isto é incompatível com mainnet, independente de auditoria.

| # | Onde | Problema | Fix de código |
|---|------|----------|---------------|
| **B1** | `Lunex/contracts/listing_manager/src/lib.rs:416-448` | `list_token` cobra fee, registra listing e emite evento mas **nunca chama `LiquidityLock::create_lock`**. A trava de LP é 100% off-chain (relayer). Listing pode completar com `lp_amount>0` on-chain sem LP travado → **vetor de rug-pull**. | Chamar `LiquidityLock::create_lock(...)` inline no Step 4 do `list_token`; reverter a tx inteira se falhar. |
| **B2** | `Lunex/contracts/asset_wrapper/src/lib.rs` (`request_withdraw`) | Queima o PSP22 do usuário na hora e só emite `WithdrawRequest`. Entrega do ativo subjacente é 100% off-chain. Relayer offline/comprometido = usuário perde fundos sem recurso on-chain. | Escrow on-chain com claim gated em confirmação, **ou** janela de disputa com reclaim do PSP22 se o relayer não responder em N blocos. |
| **B3** | `Lunex/contracts/spot_settlement/lib.rs:1346-1386` | `verify_order_signature` tem path de zero-verificação quando `signature_verification_enforced=false`, e `set_signature_verification_enforced(false)` é **owner-only, imediato, sem timelock**. Owner comprometido desliga a verificação e liquida ordens forjadas no mesmo bloco. | Gate do toggle-off atrás de multisig 2-de-3 **ou** timelock ≥24-48h; `attestor_pubkey` como parâmetro do construtor; teste de invariante `enforced==true` pós-deploy. |

---

## 🔴 P0 — Bloqueadores de código por módulo

### Contratos (ink!)
- **Honestidade de teste / paths reais não exercitados** — o maior risco depois de B1-B3, porque você não consegue *provar* que os cross-contract calls funcionam sem auditoria:
  - `copy_vault/lib.rs:1297-1299` — `swap_through_router` retorna `min_amount_out` sob `#[cfg(test)]`; o pipeline approve→swap→decode real **nunca** é testado. Selector/arg/decode errado só aparece on-chain.
  - `copy_vault/lib.rs:1863-2000` — toda a valuation de NAV (`balance_of`, `pair_reserves`, `quote_token_to_native`) é mock sob `#[cfg(test)]`. Share-minting e saques dependem desse NAV.
  - `staking/lib.rs:1137` — transfer nativo do `execute_proposal` é `#[cfg(not(test))]`; testes setam `fee_refunded=true` sem mover fundo nenhum.
  - `router/lib.rs:1710-2145` — 8 testes de math AMM `#[ignore]`'d (add-liquidity, swap routing, get-amounts). Wiring Router↔Factory↔Pair sem cobertura automatizada.
  - **Fix:** injeção de trait mockável (`PairRef`/`ValuationOracle`) para exercitar o código real, + harness `ink-e2e` ou testnet Substrate local rodando os 4 paths fund-moving. **Critério de saída:** E2E on-chain verde de settlement + copy_vault + withdraw + listing-lock contra node local.

### Backend (spot-api)
- `src/services/routerService.ts:495-500` — `AMM_V1 execution is not implemented` → `throw`. Qualquer par cuja melhor rota seja AMM_V1 **falha todo swap**. Fix: implementar, remover AMM_V1 das fontes de quote, ou retornar 501 explícito.
- `src/services/routerService.ts:532` — path ORDERBOOK injeta assinatura sintética `agent:<id>`/`manual:<addr>` direto no `orderService.createOrder()`, **pulando** o `verifyAddressSignature` da rota. Ordens persistem com assinatura sem prova de consentimento. Fix: mover a checagem sr25519 para dentro de `createOrder()` e rejeitar `agent:`/`manual:` na criação.
- `src/services/emergencyService.ts:132-145` — kill-switch de `copy_vault` e `staking` são stubs (`Not wired in admin yet`). Em emergência só dá pra pausar `spot_settlement`; fundos em vault/staking não têm como ser parados. Fix: wire das mensagens de pause/unpause dos dois contratos.

### Frontend (lunes-dex-main) — dados financeiros fabricados
- `src/pages/home/modals/confirmSwap/index.tsx:89-91` — modal de confirmação mostra **"Unavailable"** para *Minimum received*, *Price impact* e *LP Fee* — campos de consentimento informado antes de assinar. O `getQuote` já computa esses valores; só não foram ligados. Fix: passar `quote.minimumReceived`/`quote.priceImpact` e bloquear assinatura até populados. **(Único P0 frontend que afeta transação real.)**
- `src/pages/landing/index.tsx` — métricas inventadas renderadas como fato: `$12M+ secured`, `50K+ trades`, `10K+ wallets` (318-336), `142% AVG APY` / `-12% IL` (756/778), leaderboard de copytrade fake `CryptoWhale_88 +142%` com CTA "Copy Strategy" que vai pra feature real (1020-1082), preços hardcoded `1000 LUNES ≈ $45` (274-289). Risco legal/honestidade (mockup numa landing de produto financeiro). Fix: dados reais ou rótulo explícito "ilustrativo/exemplo".
- Inconsistência de fee: landing diz `0.5%` (304), AMM/Pools usa `0.3%` (`usePools.ts:231`). Reconciliar a taxa canônica em todas as telas.

### Admin (lunex-admin)
- `src/app/(admin)/listings/pending/actions.ts:19` — `approveListing()` é **dead code**: nunca importado/chamado; o botão (`listing-actions.tsx:32`) é permanentemente `disabled`; nenhum dialog coleta o `ListingActivationProof`. **Nenhuma listagem pode ser aprovada pelo admin.** Fix: construir o dialog de prova e ligar ao `approveListing()`, ou assumir oficialmente o fluxo relayer-initiated e remover o botão morto.

### SubQuery (indexer) — corrompe gates de fundo

> **[FALSE POSITIVE — 2026-06-16 characterization tests]** `LiquidityUnlocked`
> has EXACTLY 3 fields: `lock_id (u64)`, `owner (AccountId)`, `lp_amount (u128)`.
> There is NO `pairAddress` in this event (pairAddress only exists in
> `LiquidityLocked`, a different 6-field event). The payload is 57 bytes:
> [0]=variant, [1..9]=lock_id, [9..41]=owner, [41..57]=lp_amount. Offset 41 is
> CORRECT. Applying the suggested "fix" (move lpAmount to 73, add pairAddress)
> would read past the 57-byte payload boundary → readU128LE returns 0 → corrupts
> the withdraw-finalization gate. DO NOT apply this fix.
> Verified by: `subquery-node/src/__tests__/contractEvents.decoder.test.ts`.

- `src/mappings/contractEvents.ts:443-458` + `listing.ts:195-217` — `decodeLiquidityUnlocked` lê `lpAmount` no **byte offset 41**, que cai dentro do campo `pairAddress` (32 bytes). Decodifica lixo (bigint na casa dos trilhões) e grava em `ListingEvent.lpAmount` + `totalLunesLocked`. Como a **finalização de withdraw depende de evidência finalizada de `LIQUIDITY_UNLOCKED`**, isso corrompe silenciosamente todo o gate de saque. Fix: auditar a struct real do evento ink!, ler `pairAddress` no offset 41 (+32) e `lpAmount` em 73 (+16); adicionar `pairAddress` ao tipo e à entidade.
- `src/mappings/router.ts:236` — `handlePairSwap` grava `pairSymbol: contract.slice(0,12)+'...'` (stub). Todo swap AMM direto é indexado com símbolo corrompido e excluído do `PairStats` → métricas de volume erradas. Fix: resolver símbolo por `tokenIn/tokenOut` decodificados ou registry endereço→símbolo.

---

## 🟡 P1 — Necessário antes do launch (não catastrófico)

### Contratos
- `copy_vault/fuzz/fuzz_targets/fuzz_vault.rs:8` — fuzz target é no-op (constrange inputs e não instancia `CopyVault`). Spec de segurança conta com fuzz do share-accounting. Fix: chamar `deposit`/`withdraw` fuzzados e assertar invariantes.
- `staking/lib.rs:502-509` — `MIN_VOTES_FOR_APPROVAL` (1 vs 10.000) e `EXECUTION_DELAY_MS` (0 vs 48h) divergem entre teste e produção → lógica de governança testada é estruturalmente diferente da de mainnet. Fix: parametrizar via construtor.
- `spot_settlement/Cargo.toml` — ink! `4.3.0` enquanto os outros 12 contratos usam `4.2.1`. Cross-contract calls podem ter diferenças de encoding. Fix: pinar todos na mesma versão.
- `copy_vault/lib.rs:762` — `TODO(ADR-002)` saque em duas fases adiado; líder que move tudo pra posições PSP22 pode travar saque de todos (`InsufficientNativeLiquidity`) → vetor de griefing/soft-exit. Fix: implementar request/claim withdrawal ou liquidação forçada admin.

### Backend
- `src/services/copyVaultService.ts:171,251` — `deposit()`/`withdraw()` resolvem com `shares:'0'`/`amount:'0'` ("Parsed from events by caller") mas **nenhum caller faz o parse**. Downstream lê `'0'` silenciosamente. Fix: parsear eventos `Deposited`/`Withdrawn` dentro do service.
- `src/services/assetBridgeService.ts:525` — cursor da bridge (`lastProcessedBlock`, dedup de deposits) em arquivo JSON local; restart sem volume reseta pra bloco 0 → **reprocessa deposits e re-minta tokens**. Fix de código: cursor em DB (Prisma) em vez de arquivo + guard de startup. *(Borderline infra, mas a correção é de código/arquitetura.)*
- `src/services/settlementService.ts:~760` + `config.ts:88` — sem `ATTESTOR_SEED`, envia atestação de 65 zeros; não há guard de startup exigindo `ATTESTOR_SEED` quando `SETTLEMENT_ENABLED=true`. Fix: adicionar ao `collectProductionConfigErrors()`.
- `src/middleware/auth.ts:35` — replay de nonce cai pra Map in-memory (per-process) sob outage de Redis; restart perde nonces → janela de replay. Fix: confirmar que todos os callers rejeitam em `'unavailable'`; circuit-breaker em vez de fallback.
- `config.ts:74-77` — `ADMIN_SECRET` cai pra `''` se `NODE_ENV !== 'production'` exato (ex: `staging`, `prod`). Fix: validação incondicional de comprimento no middleware.

### Frontend
- `src/config/contracts.ts:35` / `config/api.ts:7` — `NETWORK.name` default `testnet` e `SPOT_API_URL` default `localhost:4000`. Build de prod sem env vars aponta silenciosamente pra testnet/localhost. Fix de código: `build:prod` falha-rápido se `network!=mainnet` ou API for localhost (parcialmente existe em `check-production-env.cjs`).
- `src/pages/listing/index.tsx:13-54` — `TIERS` (fees de listagem) hardcoded no front e mostrados como termos vinculantes antes de assinar. Se divergir do `TIER_CONFIG` do backend, usuário vê valor errado. Fix: buscar de `GET /api/v1/listing/tiers`.
- `src/components/wallet/ConnectWallet.tsx:142` + `tokenRegistry.ts` — saldo lUSDT (PSP22) nunca é buscado (só LUNES nativo é pollado); mostra "Unavailable". Fix: chamada de balance PSP22 por token.
- `src/hooks/usePools.ts:213-215` — TVL de pares não-LUSDT retorna `$0` (sem oráculo) e parece pool morto. Fix: mostrar `—`/`N/A`.

### Admin
- 7 páginas server-component (`pending`, `listings`, `dex-users`, `users`, dashboard, `treasury`, `audit`) **não** chamam `requireAuth()`/`requireRole()` no corpo — só dependem do middleware Edge (bypassável via RSC fetch direto). Outras 8 páginas já fazem. Fix: adicionar `requireAuth()` nas 7.
- `listings/pending/page.tsx:24-35` — `getPendingListings()` faz fetch sem header `Authorization`. Fix: adicionar `Bearer ${ADMIN_SECRET}`.
- 4 action files — `ADMIN_SECRET`/`SPOT_API_URL` com fallback `''`/localhost sem guard de startup. Fix: `instrumentation.ts` que aborta se ausente.

### SDK / MCP
- `sdk/src/spot-utils.ts:67` — `buildSpotOrderSignMessage` sempre acrescenta `:timestamp` (colon final quando undefined), mas o backend (`auth.ts:96-99`) só acrescenta quando definido. Fluxo comum é seguro (sempre injeta `Date.now()`), mas caller direto gera assinatura inválida. Fix: alinhar — segmento opcional.
- `sdk/src/index.ts:29` — exemplo JSDoc de `baseURL: 'https://api.lunex.io/v1'` gera duplo prefixo `/v1/api/v1/...` → 404 pra quem copiar. Fix: `'https://api.lunex.io'` + teste anti-duplo-prefixo.
- `sdk/src/modules/agents.ts` — `swap()/getPortfolio()` etc. não têm guard de `apiKey`; chamam e tomam 401 sem aviso client-side. Fix: `assertApiKey()`.

### SubQuery / Faucet
- `subquery-node/src/mappings/listing.ts:108-122` — `totalLunesLocked` acumula `lpAmount` (LP tokens), dimensionalmente incompatível com LUNES nativo. Dashboards mostram contagem errada. Fix: renomear pra `totalLpLocked` ou decodificar valor LUNES.
- `faucet/index.js:61-114` — `fundFaucetFromAlice` usa `//Alice` (dev-only) chamado incondicionalmente no startup; em mainnet falha/trava o boot. Fix: remover; funding operacional + balance-check no startup. *(Faucet é tooling testnet, mas o //Alice no boot é code blocker.)*
- `faucet/index.js:29-34,186-190` — rate-limit todo in-memory (perde em restart → drena faucet) e CORS `*` sem validação SS58 do address. Fix: persistir state (SQLite/Redis) + `checkAddress()` antes do transfer.

---

## 🟢 P2 — Limpeza / honestidade (pós-P0/P1)

- **SDK:** ~30 métodos on-chain (`auth`, `pair`, `router`, `factory`, `staking`, `wnative`) lançam `EndpointNotAvailableError` — corretamente `@deprecated`, mas inflam a API pública e compilam limpo (falham só em runtime). Considerar `@internal`/namespace `sdk.onchain` ou remover em major bump.
- **Contratos:** `set_signature_verification_enforced` sem cooldown (P2 reforça B3); selectors do copy_vault verificados por teste e não em compile-time (`ink::selector_bytes!` no const); `EXECUTION_DELAY_MS=0` em teste deixa timelock de governança sem cobertura; fuzz do `asymmetric_pair` não assert monotonicidade.
- **Backend:** `TODO(types)` em `socialAnalyticsService.ts:44`, `socialIndexerService.ts:92`, `tradeService.ts:43` (type-unsafety conhecida, não fund-moving).
- **Frontend:** terminal "AI Agent" com trades/lucro simulados (978), Strategy Marketplace com retornos hardcoded `+38%/+94%/+187%` (1127-1188) — mesmo padrão do leaderboard; magic number `0.003` inline no APR.
- **Admin:** `logAudit()` engole falha em silêncio (sem trilha se DB falhar); `reject` via `window.prompt()` sem limite; `scripts/create-admin.ts` sem guard `NODE_ENV`.
- **SubQuery:** `project.yaml` commitado com `chainId`/`endpoint` devnet (fallback se entrypoint não rodar); `ListingEvent.lpTokenAddress` declarado no schema e nunca populado; `unlockTimestamp` ausente no `LIQUIDITY_UNLOCKED`.

---

## Caminho recomendado (código, ordenado)

1. **3 bloqueadores estruturais (B1-B3)** — listing-lock on-chain, custódia asset_wrapper, timelock/multisig do toggle de assinatura.
2. **Honestidade de teste dos contratos** — substituir stubs `#[cfg(test)]` por injeção mockável + harness ink-e2e; un-ignore dos 8 testes de router. **Sem isso você não consegue provar correção sem auditoria.**
3. **Backend fund-paths** — AMM_V1, assinatura sintética no createOrder, kill-switch copy_vault/staking, parse de eventos do copyVaultService.
4. **SubQuery data-integrity** — bug de offset do `decodeLiquidityUnlocked` (gate de withdraw), stub do pairSymbol.
5. **Frontend consentimento** — confirmSwap (minimum received/price impact), reconciliar fee, remover/rotular números fabricados da landing, tier config do servidor.
6. **Admin** — implementar fluxo de aprovação de listing (dialog de prova), `requireAuth()` nas 7 páginas, guards de env.
7. **SDK + Faucet** — alinhar payload de assinatura, exemplo de baseURL, guards de apiKey; remover `//Alice` do faucet.
8. **P2** — limpeza de superfície e honestidade.

**Fora deste escopo (você confirmou):** auditoria externa por firma ink!/Substrate (MAINNET-03) e infra/devops (volumes persistentes, secrets manager, prometheus, k8s). Vários fixes de "guard de env" acima são código (validação no boot), não infra — mantidos.

---

### Contagem consolidada (após filtrar infra pura e dedup)
- **Estruturais:** 3
- **P0 código:** ~12 (contratos 5, backend 3, frontend 2, admin 1, subquery 2)
- **P1 código:** ~22
- **P2 honestidade:** ~22

*Relatórios brutos por agente disponíveis sob demanda; este doc é a síntese filtrada para "código e módulos, sem mockup".*
