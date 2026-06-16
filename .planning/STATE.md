---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: NO-GO confirmed; Sprint 1 hardening implemented; CRYPTO-02 strategy recorded; signed-read query leakage closed for mapped clients; critical fake financial display removed; frontend no-auto-signing/static fallback guard added; security disclosure, threat model, runbook baseline added; token-listing activation/withdraw now fail closed against finalized SubQuery evidence; listing relayer has production compose wiring, durable finalized cursor, metrics, alerts, runbook coverage, Grafana dashboard, and SubQuery listing deploy/backfill gate
last_updated: "2026-06-14T19:10:05.099Z"
---

# Project State: Lunex

**Last updated:** 2026-06-04
**Milestone:** Mainnet launch readiness
**Core Value:** Custody-grade correctness at every fund-moving step

## Project Reference

Lunex is a decentralized exchange on the Lunes Substrate-based blockchain. The system spans 13 ink! smart contracts, a TypeScript orchestration backend (`spot-api`), a Next.js admin panel (`lunex-admin`), a Vite+React DEX UI (`lunes-dex-main`), a client SDK, an MCP server, a SubQuery indexer, and a faucet. Production runs on PM2 + nginx VPS with Docker Compose for non-prod; Doppler for secrets; Prometheus + Grafana + Loki + Alertmanager for observability.

**Current focus:** Brownfield production-readiness milestone driven by the 2026-05-21 consolidated audit (`.planning/audit/PRODUCTION_READINESS_AUDIT.md`) plus the 2026-06-03 five-specialist NO-GO review. Execution plan is tracked in `.planning/PRODUCTION_GSD_EXECUTION_PLAN_2026-06-03.md`.

## Current Position

- **Phase:** 0 (Truth-up & Reconciliation) plus P0 execution prep
- **Plan:** `.planning/PRODUCTION_GSD_EXECUTION_PLAN_2026-06-03.md`
- **Status:** NO-GO confirmed; Sprint 1 hardening implemented; CRYPTO-02 strategy recorded; signed-read query leakage closed for mapped clients; critical fake financial display removed; frontend no-auto-signing/static fallback guard added; security disclosure, threat model, runbook baseline added; token-listing activation/withdraw now fail closed against finalized SubQuery evidence; listing relayer has production compose wiring, durable finalized cursor, metrics, alerts, runbook coverage, Grafana dashboard, and SubQuery listing deploy/backfill gate
- **Progress:** [███████████████░░░░░] Sprint 1 complete for API finality/guards; cancel signing, synthetic settlement gates, signed-read headers, frontend explicit-signing cleanup, frontend prod API URL guard, compose template validation, critical fake financial display cleanup, no-auto-signing guard, runtime SS58 fallback cleanup, ops-docs baseline, listing fail-closed activation, listing finalized proof verification, relayer durable cursor, relayer/indexer alerting, Grafana dashboard, and SubQuery listing deploy gate aligned; contract redesign and lifecycle e2e still pending

## Performance Metrics

| Metric | Baseline (2026-05-21) | Target | Delta |
|---|---|---|---|
| Contract unit tests passing | 282 / 282 (8 ignored) | 290 / 290 (0 ignored) | Phase 5 unignores 8 router math tests |
| spot-api unit tests passing | 194 / 194 across 23 suites | ≥194 + new finality/guards/SDK tests | Phases 1, 2, 3 add tests |
| Frontend automated tests | 0 / 0 | ≥10 smoke (admin + dex) | Phase 4 |
| `lunex-admin` lint exit code | 0 (with 3 errors + 2 warnings) | non-zero on findings | Phase 0 |
| Tier 0 blockers open | 9 | 0 | Phases 1, 2, 5, 6, 7 close them |
| `isInBlock` references on fund paths | 3 (rewardPayout×2 + rebalancer×1) | 0 | Phase 1 |
| `//Alice` reachable in prod code | ≥5 sites (bridge, faucet, scripts, env.example, standalone) | 0 | Phase 2 |
| Runbooks with real URLs | 0 (`your-org` placeholder) | 13 | Phase 7 |
| Backups successfully restored in test | 0 | nightly CI | Phase 7 |
| Canonical API docs | 4 (none match code) | 1 (OpenAPI from Zod) | Phase 3 |
| SDK calls hitting real endpoints | 9 / 36 | 36 / 36 | Phase 3 |

## Accumulated Context

### Key Decisions (carried from PROJECT.md)

| Decision | Rationale | Status |
|---|---|---|
| Tests-first audit methodology | Avoid confirmation bias; measure code vs intended behavior | Done (surfaced ~30 blockers, 7 not previously in CONCERNS) |
| GSD quality profile (Opus) + all workflow agents enabled | DEX with real funds = correctness over speed | Active |
| 11-phase roadmap starting with Truth-up | Cheap reconciliation unblocks every downstream phase | Written (2026-05-21) |
| Mainnet blocker = correctness + secrets + finality + custody | Per Core Value | Active |
| `lunex-admin` repo strategy (absorb vs locked submodule) | Either restores parent CI visibility | Open — Phase 0 closes Q2 |
| CRYPTO-02: SpotSettlement signature strategy | Relayer-only verification is not acceptable for public mainnet; current signed payloads do not match contract canonical payload | Accepted 2026-06-03 — see `.planning/decisions.md` |

### Open Questions (resolved in Phase 0)

1. Faucet at mainnet — public feature or testnet-only? (drives Phase 2 SEC-03 + Phase 9 DOCS-05)
2. `lunex-admin` — absorb or git submodule with locked SHA? (drives Phase 6 INFRA-01)
3. SDK audience — public npm or internal-only? (drives Phase 3 urgency)
4. Bridge at launch — enabled or staged? (softens Phase 2 SEC-01 classification if staged)
5. Polish reclassification — is CSP/i18n/a11y truly non-blocking given admin holds emergency-pause? (Phase 4)
6. Canonical API doc choice — fresh OpenAPI from Zod, or seed from one of the 4? (Phase 3)
7. Relayer key strategy — HSM/KMS only at mainnet, or threshold/multi-relayer required? (Phase 5 CRYPTO-02 + downstream T1-18)

### External Dependencies (track outside the phase critical path)

- **Lunes pallet-contracts** must expose a production-usable sr25519 verification primitive for the direct `CRYPTO-01` path. Even then, Lunex must migrate API/frontend/SDK/MCP to one canonical payload. If chain support is blocked, the accepted fallback is an on-chain order-commitment design, not public-mainnet relayer-only settlement.
- **Security audit firm** engagement (Halborn / Trail of Bits / OpenZeppelin / CertiK). Handoff must occur post-Phase 1 (no `isInBlock` on fund paths) and post-Phase 2 (no `//Alice` reachable). Sign-off is `MAINNET-03`, closed in Phase 10.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260612-udl | Fix B4+B2: normalização de reservas (ordem canônica + decimais) — Price da Pool e price impact/executionPrice do Swap | 2026-06-13 | 53babbc | [260612-udl-fix-b4-b2-normalizar-reservas-ordem-can-](./quick/260612-udl-fix-b4-b2-normalizar-reservas-ordem-can-/) |
| 260613-k9v | Vitest infra + 25 characterization tests locking Asymmetric Liquidity (reserveUtils B4/B2 → 1063.39, curve math 334.00/237.80, STRATEGY_TEMPLATES, toPlancks); behaviour-preserving toPlancks extraction to utils/plancks.ts | 2026-06-13 | b2f8c48 | [260613-k9v-vitest-asymmetric-liquidity-characteriza](./quick/260613-k9v-vitest-asymmetric-liquidity-characteriza/) |
| 260616-j69 | B3 — timelock no toggle de signature-enforcement (`spot_settlement`): propose/cancel/execute_disable_enforcement (48h), `set(false)` agora fail-closed (`EnforcementTimelockNotExpired`), `set(true)` imediato; fase GREEN dos testes RED já escritos. Verde: 9/9 enforcement, 59 total, exit 0 | 2026-06-16 | b06909d | [260616-j69-b3-timelock-signature-enforcement-toggle](./quick/260616-j69-b3-timelock-signature-enforcement-toggle/) |

### Active Todos / Blockers

- P0 fund safety: implemented for reward payout, rebalancer, and emergency services; finalized-only helper, tests, and CI grep gate are in place.
- P0 contracts: close `SpotSettlement` signature no-op risk and `CopyVault`/`Router` ABI mismatch.
- P0 signing contract: cancel signing is aligned across frontend, API, SDK, MCP, and docs; synthetic `agent:` / `manual:` settlement paths are blocked when settlement is enabled; create-order canonical payload and on-chain contract implementation remain open.
- P0 secrets: implemented for `BRIDGE_ADMIN_SEED || '//Alice'` removal, production guard expansion, and env/deploy examples.
- P0 frontend: Spot tab/remount signing prompts fixed; mapped signed reads moved from query string to `X-Lunex-*` headers across Spot, margin, agents, social/copytrade, rewards, strategies, governance, affiliate, SDK, and MCP. Automatic signing removed from copytrade dashboard load, margin overview load, bot registry wallet lookup, affiliate dashboard load, strategies follow-state sync, social profile private follow-state sync, and social settings saved-profile load. Critical fake financial values removed from wallet balance modal, Spot order form, token picker, chart trade-line defaults, and swap confirmation. `frontend:guard` now blocks signing inside `useEffect` and runtime SS58 contract/token fallbacks; Playwright browser-level coverage still needed.
- P0 integration: frontend production API build URL now fails closed for missing/localhost/private URLs; SDK/API route drift and canonical OpenAPI remain open.
- P0 operations/compliance: prod/testnet compose templates now interpolate successfully; root `SECURITY.md`, `docs/THREAT_MODEL.md`, runbook baseline, alert runbook links, and `ops:docs` guard are in place. Still need backup restore proof, chaos/runbook drills, backup metric runtime proof, and launch compliance posture.
- P0 listing lifecycle: new applications no longer create fake locked-liquidity rows; activation now requires proof fields plus finalized SubQuery `TOKEN_LISTED`/`LIQUIDITY_LOCKED` evidence; withdraw finalization requires finalized `LIQUIDITY_UNLOCKED`; listing relayer is wired in production compose with durable cursor/replay, metrics, alerts, runbook, and Grafana dashboard; SubQuery listing deploy/backfill has an executable gate; admin direct approve is disabled; DEX copy no longer claims immediate lock/listing; logo upload matches backend PNG/WebP validation. Still need production execution evidence, canonical on-chain wizard or application-only launch posture, and lifecycle e2e coverage.

## Session Continuity

- Last major roadmap session: 2026-05-21 — roadmap drafted from audit, requirements traceability updated, STATE.md initialized.
- Latest implementation: 2026-06-05 — completed mapped signed-read header migration across frontend/API/SDK/MCP, added regression gates for signed auth in client query strings and frontend auto-signing/address fallbacks, removed automatic signing from copytrade/margin/bot registry/affiliate/strategies/social profile/social settings loads, replaced critical fake financial displays with unavailable states, removed runtime SS58 contract/token fallbacks, added SECURITY/threat-model/runbook baseline with CI guard, made token-listing activation fail closed, added finalized SubQuery proof verification plus finalized-head relayer processing for listing activation/withdraw, added relayer production compose wiring with durable cursor/replay, added relayer/SubQuery metrics, alerts, runbook coverage, Grafana dashboard, and executable SubQuery listing deploy/backfill gate.
- Next session start: continue with listing lifecycle e2e, production execution evidence collection, browser-level Playwright no-auto-signing tests when deps are available, create-order canonical payload alignment, contract-side CRYPTO-02 implementation path, public docs/dev-key cleanup, backup restore drill proof, and legal/compliance launch posture.
- 2026-06-12 — auditoria 5-especialistas + sprint P0 (sessão grande, tudo na working tree SEM commits): veredito NO-GO mantido (relatórios em `.planning/audit-2026-06-12/`). Node lunes-nightly dev local rodando (ws://localhost:9944) + staging local sincronizando (ws://localhost:9945); 6 contratos core + tokens deployados localmente; E2E on-chain swap PASSOU. P0-2 copy_vault swap corrigido + provado on-chain; P0-1 gate fail-closed `signature_verification_enforced` no spot_settlement (46/46) + ADR-001; P0-3 ADR-002; P0-4 Alertmanager template+sed validado com amtool. P1s: slippage copytrade fail-closed (TDD), executionPrice fabricado removido (TDD), bridge → pino, CVEs zerados (npm audit fix), SDK reconciliado com API real (3 fixes + ~30 métodos deprecados honestos), CI com admin+e2e+contratos no gate, Dockerfile.api npm ci, alertas de backup/pool vivos via postgres-exporter custom queries (provado), fuzz 600s, graceful shutdown completo, golden tests de assinatura no sdk (paridade dex↔sdk provada), admin lint --max-warnings=0 (Fase 0). Limpeza 8-agentes: ~700 LOC (relatórios `.planning/cleanup-2026-06-12/`). Ambiente: cargo-contract 4.1.1 instalado; Rust do Homebrew (1.94) incompatível — usar rustup 1.85.0 do toolchain file. Decisões pendentes: ADR-001/ADR-002, rebuild+verificação de artifacts pré-deploy (relatório 08), float→BigInt, sandbox.lunes.io fora do ar.
- Working tree state: frontend Spot signature-prompt fixes are already modified locally; `spot-api/prisma/migrations/20260603194050_local_bootstrap_sync/` remains untracked from local bootstrap; sessão 2026-06-12 adicionou mudanças extensas não commitadas (ver `git status` + relatórios da auditoria).
- 2026-06-12 (sessão noturna, retomada) — **Prioridade 1 do handoff CONCLUÍDA**: Add Liquidity validado E2E pela UI com carteira real (conta 5HYVGH...FfBb): +1 WLUNES / +1.063,391882 LUSDT nas reservas on-chain (deltas exatos), LP 3,25611619 mintado, pool share 1,30% (relatório `coesao-10-add-liquidity-e2e.md`). Suspeita da sessão anterior resolvida invertida: o auto-quote estava CERTO; o bug é o display "Price" que usa ratio raw sem decimais (B4, fator 100 em WLUNES 8dec ↔ LUSDT 6dec). Bugs novos: B5 saldos stale pós-add, B6 float math no input, B7 allowance/approve duplicado em SDKContext+contractService. Achado P1 backend: boot do spot-api bloqueia indefinidamente em `await socialAnalyticsPipeline.start()` antes do listen (24 min sem porta; workaround `SOCIAL_ANALYTICS_ENABLED=false` no .env local). Script novo: `spot-api/scripts/query-pair-reserves.ts`. **Prioridade 2 também CONCLUÍDA**: análise dos 3 tier systems (`coesao-11-tier-systems-analise.md`) — veredito: distintos por design (dimensões ortogonais: duração→APY, volume→peso reward, valor→limites de agente), NÃO unificar; corrigir desambiguação. Achado novo T1 (P2): tier 1 de agente (100 LUNES) é inalcançável porque o contrato exige MIN_STAKE=1000 — decisão de produto pendente (alinhar tabela vs reduzir MIN_STAKE). T2: rename `stakingTier`→`agentTier` com deprecação. T3/T4: copy e docs misturam conceitos. T6: tiers por duração assumem block-time 2s hardcoded (verificar mainnet; conecta com ADR-001). Próximo: decisão T1, fixes B4/B2, ou prioridade 3 do handoff (backlog P1).
- 2026-06-13 (madrugada, mesma sessão) — **Quick task 260612-udl CONCLUÍDA (B4+B2)**: helper `reserveUtils.ts` (normalizeReservesForPath + humanPrice), Price da Pool corrigido (1063.39 ✓ verificado browser), price impact do Swap corrigido (0,00%→6,55% p/ 5 WLUNES ✓) — incluía bug pré-existente extra (BPS prematuro em midPriceNum travava impact em zero), executionPrice em escala humana (993.70 ✓). Commits 37ee90c/a54fc46/83de77a (executor) + 53babbc (conclusão). B6 (float no input) e B5 (saldos stale) seguem abertos. Preferência do usuário: subagents com model fable daqui em diante. Pendente: decisão T1 (tier 1 agente inalcançável), prioridade 3 do handoff (backlog P1: affiliate, social indexer, trade float→BigInt).
- 2026-06-13 (tarde) — **Quick task 260613-k9v CONCLUÍDA**: infra Vitest 3 + jsdom em `lunes-dex-main` (antes SEM testes) + **25 testes de caracterização** travando Asymmetric Liquidity contra regressão: reserveUtils B4/B2 (humanPrice → 1063.39; normalizeReservesForPath), curva `simulateLiquidity`/`buildChartData` (reproduz preview **334.00 / 237.80** com defaults da página), STRATEGY_TEMPLATES (3 templates, γ∈[1,5]), toPlancks (extraído verbatim p/ `src/utils/plancks.ts` puro, hook re-aponta o import). Commits: a491e78(plan)/d5ada14(infra)/6f9313b(extract)/b2f8c48(tests)/0262bdb(docs). `25/25` verde, `tsc --noEmit` 0, prettier+eslint limpos. Runner Vitest 3 (não 4 — repo pina @types/node 18); desvio do Jest do CLAUDE.md anotado no commit. Surpresas documentadas (não corrigidas, disciplina de escopo): toPlancks acopla decimals=12 a PLANCKS_PER_UNIT; `toPlancks('1.2.3')` não lança, lê como `'1.2'`. **Verificado AO VIVO no navegador** (`/pool/asymmetric` → aba Builder Pro): preview mostra **334.00 / 237.80**, 3 templates + 3 abas renderizam, labels γ Balanced/Moderate, SEM "Rate limit" da captura antiga; 9 erros de console = só spot-api ausente (`:4000`/`:4001` ERR_CONNECTION_REFUSED) + extensão de carteira, **nenhum bug de render**. Captura: `lunes-dex-main/asymmetric-builder-preview.jpeg`. **PENDENTE — E2E on-chain profundo (nova sessão, contexto cheio):** o nó `lunes-dev` é `--dev` SEM volume persistente (`Mounts:` vazio) → reiniciar ZERA a cadeia e apaga os contratos; `deployed-addresses.json` fica inválido após restart. Retomada: (1) `colima start` + `docker start lunes-dev`; (2) re-deploy completo (`spot-api/scripts/deploy-contracts.ts` + `deploy-tokens.ts` + criar par WLUNES/LUSDT + asymmetric pair); (3) subir postgres do Lunex (CAÍDO — só há containers `quasar-platform-*` de outro projeto no docker) + spot-api com workaround `SOCIAL_ANALYTICS_ENABLED=false`; (4) navegador: conectar+fundar carteira, exercitar estratégia/swaps — **assinaturas exigem o usuário aprovar os popups da extensão**. Deixado rodando ao fim desta sessão: Colima ✅, nó `ws://localhost:9944` ✅ (cadeia `--dev` vazia), frontend `:3000` ✅; spot-api/postgres ✗.
- 2026-06-13 (tarde, cont.) — **Foundation on-chain RE-DEPLOYADA no nó `--dev` fresco** (usuário pediu p/ seguir o E2E). `deploy-contracts.ts` + `deploy-tokens.ts` rodados em background (ambos exit 0; alvo HARDCODED `ws://127.0.0.1:9944`, deployer `//Alice` sem flag; artifacts em `target/ink/` presentes). Endereços NOVOS (gravados em `deployed-addresses.json` + `lunes-dex-main/.env` + `spot-api/.env`): wnative `5H1mCe…8ymu`, factory `5EVMmH…AH9M8`, router `5ErwTY…LP2Ub`, staking `5DmBby…88Vsw`, rewards `5EGPEf…91HsUw`, **LUSDT `5CPq5VyKiq1cSFyUcjjS4wmQ4eks8xeagqmXXQxjotjEXJpP`**, **par WLUNES/LUSDT `5CxnYXmzG6h6UQH4K8b9MFjo3dsHg7LkoucrUhaem3fVJA56`** com liquidez 50 WLUNES + 100k LUSDT (1 WLUNES = 2000 LUSDT). Carteira de teste fundada: 10 WLUNES / 5000 LUSDT / 100 LUNES. **Estado agora:** swap/pool/liquidity têm par real on-chain; asymmetric BUILDER (preview client-side 334.00/237.80) já verificado no browser. **FALTA p/ E2E asymmetric completo:** (a) deployar `asymmetric_pair` (artifact existe em target/ink) + registrar estratégia; (b) subir spot-api — resolver mismatch postgres (`.env` → `localhost:5432` postgres/postgres, fonte CAÍDA; compose usa `:5433` lunex/lunex_dev) + override `LUNES_WS_URL=ws://localhost:9944` (env aponta p/ sandbox.lunes.io morto); (c) navegador: conectar/fundar/assinar com a carteira (exige o usuário nos popups). Rodando ao fim: Colima ✅, nó `:9944` ✅ (AGORA com contratos), frontend `:3000` ✅; spot-api/postgres ✗.

- 2026-06-16 — **Quick task 260616-j69 CONCLUÍDA (B3, #1 do roadmap de blockers)**: timelock de 48h no toggle de signature-enforcement do `spot_settlement` (roadmap `.planning/blockers-roadmap-2026-06-16/04-signature-toggle-timelock.md`). Os testes RED já estavam escritos não-commitados na working tree (sessão anterior, computador desligou); esta sessão fez a fase GREEN. Storage `pending_enforcement_off:Option<u64>` + `enforcement_timelock_ms:u64` (48h); erros `EnforcementTimelockNotExpired`/`NoPendingEnforcementDisable`; métodos `propose_/cancel_/execute_disable_enforcement` espelhando o padrão two-step ownership; `set_signature_verification_enforced(false)` agora retorna `EnforcementTimelockNotExpired` (fail-closed), `(true)` continua imediato; evento `SignatureEnforcementChanged{enforced,changed_by}`. 3 testes pré-existentes que chamavam `set(false)` direto migrados p/ propose+advance_timestamp+execute. Commit de código `b06909d` (só `lib.rs`, atômico). Verificado independente (saída crua do cargo): 9/9 testes enforcement ok incl. os 4 RED do B3, 59 total, exit 0. **Fable indisponível na sessão → subagents rodaram em sonnet (fallback).** Próximo no roadmap: SubQuery `decodeLiquidityUnlocked` offset bug (P0, TS puro) ou B2/B1/B4/B5 de contrato.

## Verification Notes

- Coverage validated: 53 / 53 v1 REQ-IDs mapped to exactly one phase. (REQUIREMENTS.md header previously stated "47" — reconciled to actual category-sum count of 53.)
- Goal-backward checks passed for each phase (2-5 observable criteria, no implementation tasks framed as criteria).
- No `isInBlock` on fund paths is an explicit success criterion in Phase 1, Phase 3 (regression), and Phase 10 (final check).
- Tier 0 / Tier 1 phases all include test-coverage criteria; no T0/T1 phase ships untested.

---

*State initialized 2026-05-21 by gsd-roadmapper following audit-driven brownfield phase derivation.*
