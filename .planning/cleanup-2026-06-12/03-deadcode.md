# 03 — Código Não Utilizado (Dead Code)

**Agente:** 3/8 — Limpeza de código | **Data:** 2026-06-12 | **Fase:** A (somente leitura)

## Metodologia

- **spot-api, lunes-dex-main, sdk, mcp:** rodados os gates existentes (`deadcode:exports` via ts-prune, `deadcode:deps` via depcheck) **+ ts-prune/depcheck crus** para inspecionar o que os gates filtram por padrão (whitelists e filtros amplos).
- **lunex-admin:** `npx ts-prune` + `npx depcheck` (pacote não tem gates).
- **Raiz do workspace:** `npx depcheck` com ignore dos subpacotes.
- **Verificação manual:** cada candidato foi confirmado com `grep -rnw` em src/, scripts/, configs, index.html, CI workflows e ecosystem.config.js, com desambiguação de homônimos (ex.: `pulse`, `Skeleton`, `Spinner` existem como definições locais em outros arquivos — verificado que NÃO importam de motion.ts).
- **Ignorados (por instrução):** node_modules, dist, build, .next, target/, artifacts/, types/, .planning/, PATHFINDER*, exports públicos do sdk (API externa), faucet/.
- **Rust:** pulado — `cargo clippy --workspace` compilaria todo o workspace ink! (custo alto); recomendado rodar em CI dedicado.

---

## lunes-dex-main (DEX UI — Vite/React)

> O gate `check-ts-prune.cjs` passa, mas filtra **em bloco** `src/pages/`, `src/components/`, `*/styles.ts` e `src/styles/motion.ts` — os itens abaixo estão escondidos por esses filtros.

### Confiança ALTA (verificado: zero referências fora do arquivo definidor)

| Item | Evidência | LOC |
|---|---|---|
| `test-debug.js`, `test-pointer.js`, `test-radius.js`, `test-script.js`, `test.js` (raiz do pacote) | 5 arquivos de 39–68 bytes, só `console.log` de debug (mar/2026); grep em *.json/yml/cjs/md/Dockerfile/CI: 0 refs | 5 (5 arquivos) |
| `src/hooks/useAnimatedCounter.ts` (arquivo inteiro: `useAnimatedCounter`, `useFlashOnChange`) | Única ref externa é a própria whitelist `allowExact` do gate (scripts/check-ts-prune.cjs:9-10) | 93 |
| `src/pages/copytrade/styles.ts` (arquivo inteiro: 15 styled-components) | Nenhum import: `Page.tsx` não importa `./styles`; único `from './styles'` no dir é o de `CopyModal/styles.ts`. A página copytrade em si ESTÁ roteada (`/spot/copytrade`) — só o styles.ts é órfão | 165 |
| `src/styles/motion.ts` — 17 exports: `fadeInDown`, `slideInLeft`, `pulse`, `rippleEffect`, `progressFill`, `elevatedCard`, `numberUpdate`, `Skeleton`, `Spinner`, `FadeIn`, `ScaleIn`, `SlideInRight`, `AnimatedCheckmark`, `RippleContainer`, `GlowBadge`, `AnimatedPage`, `StaggeredGrid` | Só 4 arquivos importam de motion.ts e usam apenas: `fadeInUp`, `spin`, `timing`, `easing`, `pageEntrance`, `interactiveButton`, `staggerChildren`, `interactiveCard`. Hits de grep em `pulse`/`Skeleton`/`Spinner` são definições locais homônimas (landing, governance, affiliates, strategies, agent, staking) | ~180 de 300 |
| `src/pages/home/styles.ts`: `PillNav`, `PillOption`, `Span` | 0 refs; o `S.Span` de tabBar vem de `./styles` próprio do tabBar (import verificado) | ~47 |
| `src/components/layout/styles.ts`: `PageFooter` | 0 refs no pacote | ~10 |
| `src/components/bases/skeleton/index.tsx`: `SkeletonBox` | 0 refs externas E 0 usos internos (grep só acha a definição, linha 27). `TraderCardSkeleton` do mesmo arquivo ESTÁ em uso (social/index.tsx) — não tocar | ~30 |
| `src/pages/landing/styles.ts`: `floatY`, `counterSpin` | 0 refs (keyframes órfãos) | ~14 |
| `src/pages/copytrade/CopyModal/styles.ts`: `MaxButton` | CopyModal importa `* as S` mas nunca usa `S.MaxButton` (grep -w: 0) | ~12 |
| `src/pages/header/modals/connectWallet/styles.ts`: `Modal` | index.tsx define `Modal` local próprio (linha 31) e não importa `./styles`; demais exports do styles.ts têm uso (não flagados pelo ts-prune) | ~12 |
| `src/config/contracts.ts`: type `TokenMeta` | Única ref externa é a whitelist do gate; `usePools.ts` define seu PRÓPRIO type local `TokenMeta` | ~6 |

**Subtotal ALTA: ~574 LOC + 5 arquivos**

### Confiança MÉDIA

| Item | Motivo |
|---|---|
| Whitelist desatualizada em `scripts/check-ts-prune.cjs`: entrada `src/sdk/AsymmetricClient.ts:104 - AsymmetricClient` | `AsymmetricClient` ESTÁ em uso (src/pages/pool/asymmetric/index.tsx:17,492) — a entrada da whitelist é obsoleta (falso positivo do ts-prune com import relativo). Após remover useAnimatedCounter/TokenMeta, limpar as 4 entradas `allowExact` |
| Filtros em bloco do gate (`src/pages/`, `src/components/`, `*/styles.ts`, `motion.ts`) | Escondem dead code real (tudo da tabela ALTA acima). Recomendação: substituir filtros amplos por whitelist exata após a limpeza |

### Não são dead code (falsos positivos do ts-prune cru — manter)

- Todos os `default` exports de pages/components (115 itens crus): usados via `React.lazy`/rotas — ts-prune não vê dynamic import.
- `TraderCardSkeleton`, `AsymmetricClient`, `LunexLogo` (5 refs), `pulse`/`Skeleton`/`Spinner` locais de outros arquivos.

---

## lunex-admin (Next.js Admin)

### Confiança ALTA

| Item | Evidência | LOC |
|---|---|---|
| `src/auth.ts:6` — `signOut` (do destructure `NextAuth()`) | App usa `signOut` de `next-auth/react` (app-sidebar.tsx:32); o do auth.ts: 0 refs | 1 (remover do destructure) |
| `src/lib/rateLimit.ts:85` — `__resetRateLimitStore` | Helper de teste; pacote NÃO tem nenhum arquivo `*.test.*`/`__tests__` (find: 0) | ~8 |

### Confiança MÉDIA

| Item | Evidência |
|---|---|
| `src/app/(admin)/team/actions.ts:47` — server action `updateAdminUser` | 0 refs em todo o pacote (nenhum form/`action=`/import). Implementação completa com `requireRole('SUPER_ADMIN')` — pode ser feature de UI pendente; confirmar com o time antes de remover (~40 LOC) |
| `src/app/(admin)/listings/pending/actions.ts:19` — server action `approveListing` | 0 refs. Mesma situação: implementação completa com auth, possivelmente aguardando UI (~50 LOC) |
| dep `shadcn@^4.0.0` em `dependencies` | É CLI de scaffolding (usado via npx + components.json), não é importado em runtime. Mover para devDependencies ou remover |

### Falsos positivos do depcheck (NÃO remover)

- `tw-animate-css`: usado via `@import "tw-animate-css"` em src/app/globals.css:2.
- `tailwindcss`: usado via `@import "tailwindcss"` em globals.css:1.
- `@tailwindcss/postcss`: usado em postcss.config.mjs:3.
- `@types/node`, `@types/react-dom`: usados implicitamente pelo build TS.

---

## spot-api (Express API)

**Limpo.** Gates `deadcode:exports` e `deadcode:deps` passam; ts-prune cru reporta apenas `src/index.ts:481 - default` (entrypoint, não é dead).

- Whitelist depcheck (`@polkadot/keyring` + 5 devDeps) verificada: `@polkadot/keyring` É usado de verdade (rebalancerService, emergencyService, settlementService, rewardPayoutService, copyVaultService) — falso negativo do depcheck, whitelist correta.
- `spot-api/scripts/`: ferramentas operacionais (guardrail) — nenhuma marcada para remoção (BAIXA por política).

## sdk (@lunex/sdk)

**Limpo.** `ts-prune -i "src/index.ts" --error` passa (exports públicos do index são API externa — fora de escopo por política); depcheck: 0 unused/0 missing.

## mcp/lunex-agent-mcp

**Limpo.** ts-prune cru: 0 achados; depcheck: 0 unused/0 missing. `smokeRouter.ts` é referenciado pelo script `smoke:router`.

## Raiz do workspace (lunex-platform)

### Confiança BAIXA (hygiene, não remoção)

| Item | Evidência |
|---|---|
| `@types/jest` está em `dependencies` (deveria ser devDependencies) | depcheck flagou como unused; é usado implicitamente pelo ts-jest nos testes — não remover, apenas mover |
| Deps "missing" (resolvidas via transitivas): `@jest/globals`, `@polkadot/keyring`, `@polkadot/types`, `@polkadot/util-crypto`, `bn.js`, `ws`, `@lunex/sdk` (examples) | Usadas em tests/ e scripts/ mas não declaradas no package.json raiz — risco de quebra em atualização de lockfile. Declarar explicitamente |
| `scripts/` da raiz (deploy, listing-relayer, explore-*, fund_tester etc.) | Operacionais — guardrail: BAIXA, não remover sem confirmação do time |

## Rust (contratos ink! + crate raiz)

**Pulado** — `cargo clippy --workspace` exigiria compilação completa do workspace (custo alto nesta fase de leitura). Recomendação: job de CI com `-W dead_code` ou rodar clippy no pipeline existente de contratos.

---

## Resumo

| Confiança | Itens | LOC removível (estim.) |
|---|---|---|
| ALTA | 13 (11 lunes-dex-main + 2 lunex-admin) | ~583 + 7 arquivos deletáveis |
| MÉDIA | 5 (2 gate-whitelist dex + 2 server actions admin + 1 dep shadcn) | ~90 |
| BAIXA | 3 (hygiene de deps raiz + scripts operacionais) | 0 (mover/declarar, não remover) |

**Ações de maior valor (Fase B):**
1. Deletar 5 `test*.js` da raiz de lunes-dex-main (lixo de debug).
2. Deletar `src/hooks/useAnimatedCounter.ts` + entradas da whitelist do gate (93 LOC).
3. Deletar `src/pages/copytrade/styles.ts` (165 LOC órfãos).
4. Podar 17 exports de `src/styles/motion.ts` (~180 LOC).
5. Apertar os filtros do gate `check-ts-prune.cjs` do dex (filtros em bloco escondem dead code novo).
