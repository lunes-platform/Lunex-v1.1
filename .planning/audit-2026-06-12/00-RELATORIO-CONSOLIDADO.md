# Relatório Consolidado — Auditoria de Produção Lunex DEX
**Data:** 2026-06-12 · **Método:** 5 especialistas em paralelo + validação runtime (node local, E2E on-chain, navegação browser)

---

## Decisão: 🔴 **NO-GO para mainnet** (mantido)

O NO-GO anterior do projeto permanece correto. **4 bloqueadores P0** impedem o launch, todos concentrados em contratos e alerting. As demais camadas (backend, frontend, segurança transversal) estão em estado **APROVADO COM RESSALVAS** — boas para staging/testnet hoje.

## Vereditos dos 5 especialistas

| # | Especialista | Veredito | P0 | P1 | P2 | P3 | Relatório |
|---|---|---|---|---|---|---|---|
| 1 | Contratos ink! | 🔴 REPROVADO | 3 | 4 | 4 | 2 | `01-contratos.md` |
| 2 | Segurança cross-layer | 🟡 Ressalvas | 0 | 0 | 3 | 5 | `02-seguranca.md` |
| 3 | Backend (spot-api/sdk/mcp/subquery) | 🟡 Ressalvas | 0 | 2 | 5 | 5 | `03-backend.md` |
| 4 | Frontend (DEX + admin) | 🟡 Ressalvas | 0 | 3 | 5 | 4 | `04-frontend.md` |
| 5 | DevOps/Infra + QA | 🟡 Ressalvas | 1 | 8 | 7 | 4 | `05-devops-qa.md` |
| — | **Total** | — | **4** | **17** | **24** | **20** | — |

## Bloqueadores P0 (ordem de prioridade)

1. **`spot_settlement::verify_order_signature` é no-op** (`lib.rs:1138-1148`) — só rejeita assinatura zerada. Relayer malicioso pode drenar depósitos custodiais. Causa-raiz confirmada em runtime: o lunes-nightly atual **não expõe `sr25519_verify`** no pallet-contracts (dependência externa CRYPTO-01 segue aberta). **Ação:** implementar a alternativa já prevista no CLAUDE.md (atestação off-chain + verificação on-chain) ou destravar o pallet com o time da chain antes do freeze.
2. **`copy_vault::swap_through_router` chama seletor inexistente no Router** (`lib.rs:847-873`) — ABI/args/retorno errados; reverte sempre; mascarado por `#[cfg(not(test))]`. **Ação:** corrigir o cross-contract call + teste E2E on-chain obrigatório.
3. **`copy_vault` contabilidade incoerente** (`lib.rs:1167`) — equity = só saldo nativo, mas swaps movem PSP22 → fundos presos/invisíveis. **Ação:** redesenho da contabilidade de equity (multi-asset) com testes de propriedade.
4. **Alertmanager morto em silêncio** (`docker/alertmanager.yml:58-76`) — usa `${ENV}` que a v0.27 não expande; nenhuma notificação (relayer parado, settlement backlog, API down) chega. **Ação:** substituir por valores concretos/secret injetado + teste de fogo do pipeline de alertas.

## Validação runtime executada nesta auditoria (evidências)

| Item | Resultado |
|---|---|
| Node local lunes-nightly (Colima/Docker, modo dev) | ✅ Blocos produzidos e finalizados (GRANDPA), WS 9944 |
| Deploy dos 6 contratos core via script do projeto | ✅ factory/router/wnative/staking/rewards + pair code |
| E2E on-chain: wrap → createPair → approve → addLiquidity → **swap via router** | ✅ PASSOU (saldo USDT 2.500,00 → 2.548,78; matemática AMM com fee correta) |
| Suite spot-api completa (rodada pelo Especialista 3) | ✅ 44 suites / **341 testes, 0 falhas** |
| tsc + lint dos dois frontends (Especialista 4) | ✅ 0 erros |
| Navegação browser DEX (/, /swap, /pools, /staking, /spot) | ✅ Sem crash; /pools exibe os pares on-chain reais; /spot **fail-closed** (ordens desabilitadas sem ticker; zero dado fake) |
| Navegação browser Admin (:3001) | ✅ Middleware redireciona p/ /login; credencial inválida → erro genérico sem leak |

### Achados novos desta validação (além dos 5 relatórios)
- **P1 — Artifacts desatualizados vs. código-fonte:** `target/ink`/`artifacts/` não contêm as mensagens atuais dos contratos (ex.: pair sem interface PSP22 de LP que existe em `pair/lib.rs:1149-1226`). Deploy de produção a partir deles publicaria contratos antigos. Reforça a Fase 6 (Deploy Trust Model): **rebuild reprodutível + verificação de code hash contra source obrigatórios no pipeline.**
- **P3 — Mensagem de erro enganosa no /spot:** exibe "spot-api offline" quando a causa real é par não cadastrado no DB (404 em `/pairs/:pair/ticker`).
- **P3 — Par on-chain ≠ par no DB:** criar par na chain não o registra no spot-api (fluxo de listing é o caminho oficial) — documentar para onboarding dev.
- **P3 — Scripts de dev com drift de ABI:** `deploy-tokens.ts` chamava `pair.balanceOf` inexistente no artifact (corrigido nesta sessão com guarda resiliente).
- **Risco estrutural — ink! descontinuado (jan/2026):** decisão de pin em 4.2.1 é correta, mas exige plano documentado de manutenção (fork/vendoring das deps, monitoramento de CVEs do stack parity).

## Mapa de melhorias aprovadas (consolidado dos 5 especialistas)

### Contratos (após os 3 P0)
- Cobrir todos os cross-contract calls hoje atrás de `#[cfg(not(test))]` com testes `ink_e2e` reais contra node local (agora disponível neste Mac).
- Two-step ownership também em `staking` e `asset_wrapper` (hoje só `spot_settlement`).
- Reativar os 8 testes de matemática do router que estão `#[ignore]`.
- Unificar versão ink! (4.2.1 vs 4.3.0 em 2 contratos).
- Completar `asymmetric_pair::asymmetric_swap` (hoje esqueleto sem movimentação de tokens/slippage).

### Backend
- Reconciliar SDK ↔ rotas reais do spot-api (6 módulos retornam 404 hoje) — Fase 3 do roadmap.
- Migrar caminho monetário interno de float para BigInt/decimal (orderbook, orderService, socialIndexer).
- Graceful shutdown completo (parar pipeline social, fechar WSS, drenar settlements em voo).
- Modo degradado quando a chain está fora (boot não pode bloquear o listen).
- `npm update express ws` (CVE HIGH ReDoS).

### Frontend
- Validação de genesisHash/chainId antes de habilitar signing.
- Rodar `check-production-env.cjs` em todo build (não só `build:prod`); remover fallbacks `localhost:4000` duplicados.
- Primeiros testes automatizados (mínimo: smoke de rotas + guard de no-auto-signing como teste real, não só regex).
- Admin: `maxAge` na sessão JWT, gate de role no middleware, rate-limit no login.
- Corrigir mensagem "spot-api offline" e fallback `decimals ?? 12`.

### DevOps/QA
- Corrigir Alertmanager (P0) + 3 alertas mortos por métricas inexistentes + alerta de lag do indexer.
- Incluir lunex-admin na matriz de CI; e2e do spot-api num gate automático (nightly se não couber em PR).
- `npm ci` + lockfiles nos Dockerfiles (builds reproduzíveis); gate `ci-status` deve incluir contratos.
- Fuzz nightly 600s (hoje 60s); suite `ink_e2e` mínima por contrato de fundos.
- Drill de restore-from-S3 com RTO medido (pré-requisito da Fase 10).
- sdk/lunes-dex-main/lunex-admin/subquery: hoje **0 testes** — definir piso mínimo.

## Sequência recomendada para produção segura
1. **Sprint P0 (bloqueadores):** itens 1-4 acima + rebuild/verificação de artifacts. Critério de saída: E2E on-chain de settlement+copy_vault verde contra node local e alerta de teste recebido no canal real.
2. **Sprint P1:** SDK/API reconciliation, float→BigInt, CI completo (admin+e2e+contratos), validação de rede no front, runbooks/restore drill.
3. **Auditoria externa** (já prevista como MAINNET-03) sobre o commit pós-P0/P1.
4. **Fase 10 (Dress Rehearsal)** conforme roadmap — agora com base executável: o fluxo clean-clone→stack local→E2E foi provado neste Mac nesta sessão.

---
*Stack local desta sessão: node lunes-nightly dev em :9944 (container `lunes-dev`), spot-api :4000/:4001, DEX :3000, admin :3001. Backups: `spot-api/.env.backup-2026-06-12`, `lunes-dex-main/.env.backup-2026-06-12`.*
