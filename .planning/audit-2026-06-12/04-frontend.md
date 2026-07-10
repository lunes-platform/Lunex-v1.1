# Auditoria de Produção — Especialista 4: Frontend

**Escopo:** `lunes-dex-main/` (Vite + React 18) e `lunex-admin/` (Next.js + NextAuth)
**Data:** 2026-06-12
**Auditor:** Painel de produção — Frontend

---

## Veredito: APROVADO COM RESSALVAS

O frontend cumpre o contrato do AGENTS.md (não-autoritativo), os guards do Sprint 1 existem e funcionam como descritos no STATE.md, e a matemática de valores usa BigInt sem bugs de precisão float nos caminhos críticos. `tsc --noEmit` e `eslint --max-warnings=0` passam limpos nos dois projetos. As ressalvas que impedem aprovação plena: ausência total de validação de identidade da chain (genesisHash), guard de URL de produção contornável pelo script `build` comum, zero testes automatizados de frontend, e i18n/a11y praticamente inexistentes (pendência conhecida e ainda aberta).

**Contagem:** P0: 0 | P1: 3 | P2: 5 | P3: 4

---

## Verificação dos guards do Sprint 1 (STATE.md) — CONFIRMADOS

| Guard declarado | Evidência | Status |
|---|---|---|
| No-auto-signing / static fallback guard | `lunes-dex-main/scripts/check-frontend-regressions.cjs` — bloqueia `signRaw(`/`signMessage` dentro de `useEffect(` e fallbacks hardcoded de endereço SS58 (`envAddressFallback` regex, linha ~88). Script wired em `npm run frontend:guard` e `npm run quality` (package.json) | EXISTE (com limitação — ver P1-3) |
| Fake financial display removido | `src/pages/home/modals/chooseToken/mock.ts` — `tokenPrice: 'Unavailable'` em todos os tokens; `src/components/spot/PairSelector/index.tsx:233,250` — "Returns empty array if API is unavailable — never shows fake pairs" | CONFIRMADO |
| Frontend prod API URL guard | `lunes-dex-main/scripts/check-production-env.cjs` — falha fechado para URL ausente, inválida, localhost e faixas privadas (10/127/172.16-31/192.168/169.254); valida `REACT_APP_SPOT_API_URL` | EXISTE (com bypass — ver P1-2) |
| Wallet restore sem signer | `src/context/SDKContext.tsx:243-251` — endereço salvo é hint de UI; "the signer is NOT restored. User must reconnect" | CONFIRMADO |

## Spot-check PRODUCTION-READINESS.md — CONFIRMADO

- `manualChunks` (polkadot/charts/vendor): `lunes-dex-main/vite.config.ts` (rollupOptions.output.manualChunks) — OK, com `chunkSizeWarningLimit: 800` e `drop: ['console','debugger']` em prod.
- NotFound page: `src/routers/index.tsx` — `<Route path="*" element={<NotFound />} />` com página real em `src/pages/notFound/index.tsx` — OK.
- `.env.production.example`: existe em `lunes-dex-main/` (e também em `lunex-admin/`) — OK; só contém endereços/URLs/flags, nenhum segredo.
- "My Pools" tab removida: `src/pages/pools/index.tsx:323` — comentário confirmando remoção pendente de integração LP-balance — OK.

## Conformidade AGENTS.md (frontend não-autoritativo) — SEM VIOLAÇÕES

Nenhuma decisão de matching, settlement, fees finais, rewards, ativação de listing ou autorização encontrada no frontend. Slippage/`calculateMinAmount` (`SDKContext.tsx:954-961`) e `minimumReceived` são preparação de payload assinado pelo usuário — permitido. `priceImpact` é cálculo visual de preview — permitido. Ativação de pares no admin é feita via chamada autenticada ao spot-api (`lunex-admin/src/app/(admin)/listings/actions.ts` → `POST /api/v1/pairs/register`), não decidida no frontend.

---

## Achados

### P1 — Corrigir antes do mainnet

**P1-1. Nenhuma validação de identidade da chain (genesisHash/chainId).**
`grep genesisHash|chainId|ss58|specName` em `lunes-dex-main/src` retorna **zero** ocorrências. `src/services/contractService.ts:81` conecta via `new WsProvider(NETWORKS[network])` e confia cegamente na URL do env (`REACT_APP_RPC_MAINNET`, `src/config/contracts.ts:38`). Um RPC errado/comprometido (ou env trocado testnet↔mainnet) faz o usuário assinar transações para a rede errada sem nenhum aviso — em DEX isso é perda financeira direta.
**Fix:** após `ApiPromise.create`, comparar `api.genesisHash.toHex()` contra constante esperada por rede (hardcoded por ambiente); em mismatch, desconectar, bloquear signing e exibir banner "Wrong network". Exibir nome da rede conectada no header junto ao endereço.

**P1-2. Guard de URL de produção é contornável pelo build padrão + fallback `localhost:4000` espalhado em runtime.**
`lunes-dex-main/package.json`: `"build": "tsc --noEmit && vite build"` NÃO executa `check-production-env.cjs`; apenas `"build:prod"` executa. Em paralelo, o fallback `process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'` está duplicado em ≥12 arquivos (`src/hooks/usePools.ts:97`, `src/pages/header/modals/walletModal/index.tsx:397`, `src/services/strategyService.ts:6`, `src/services/marginService.ts:2`, `src/services/socialService.ts:9`, `src/services/agentService.ts:1`, `src/pages/agent/index.tsx:540,744,780`, `src/pages/affiliates/index.tsx:9`, `src/pages/listing/index.tsx:9`, `src/utils/getTokenLogo.ts:10`...). Um deploy feito com `npm run build` produz um bundle apontando silenciosamente para localhost.
**Fix:** (a) fazer `build` chamar o check (ou renomear para `build:dev` e tornar `build` = `build:prod`); (b) centralizar a base da API em um único módulo `src/config/api.ts` que lança erro quando `import.meta.env.PROD && !REACT_APP_SPOT_API_URL` e eliminar os 12 fallbacks; (c) adicionar regra ao `check-frontend-regressions.cjs` proibindo o literal `localhost:4000` em `src/`.

**P1-3. Zero testes automatizados de frontend; o guard anti-auto-signing é apenas regex estático e estreito.**
`STATE.md:26` confirma "Frontend automated tests 0/0 (target ≥10 smoke)"; `STATE.md:70/79` admite "Playwright browser-level coverage still needed". O `check-frontend-regressions.cjs:100-113` só detecta `signRaw(`/`signMessage` textualmente dentro do corpo de `useEffect(` — signing dentro de uma função chamada pelo effect, dentro de custom hook, ou via `signAndSend` (não coberto pelo regex de useEffect) escapa do guard. A garantia "no-auto-signing" hoje depende de disciplina de código, não de teste comportamental.
**Fix:** implementar os ≥10 smoke tests planejados (Playwright com extensão mock): conexão de wallet, swap quote, ausência de popup de signing em navegação/remount de todas as abas, 404, e login/RBAC do admin. Expandir o regex para incluir `signAndSend` em useEffect.

### P2 — Corrigir no próximo sprint

**P2-1. Admin: sessão JWT sem `maxAge` e middleware sem gate de role.**
`lunex-admin/src/auth.ts` define `session: { strategy: 'jwt' }` sem `maxAge` (default NextAuth: 30 dias) e sem rotação. `middleware.ts` só checa `!!req.auth` — qualquer VIEWER logado alcança todas as rotas de página; a proteção por role existe apenas nas server actions (`requireRole` em `listings/actions.ts:17,77,109`, `emergency/actions.ts:29,48,85`, `team/actions.ts:10` — correto) e na página `emergency/page.tsx:8`. Páginas de leitura sensível ficam visíveis a VIEWER por design implícito, não documentado.
**Fix:** `session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }`; documentar a matriz página×role e adicionar `requireRole` explícito nas páginas que não devem ser visíveis a VIEWER.

**P2-2. Admin: `ADMIN_SECRET || ''` e `SPOT_API_URL || 'http://localhost:4000'` em server action — fail-open de configuração.**
`lunex-admin/src/app/(admin)/listings/actions.ts:8-9`. Com env ausente em produção, o admin envia `Authorization: Bearer ` (vazio) para `http://localhost:4000`. O spot-api rejeitará, mas o erro será confuso e, se houver qualquer serviço local na porta 4000 do host do admin, a requisição vaza o payload.
**Fix:** lançar erro no module-load (ou num helper `requireEnv`) quando `NODE_ENV === 'production'` e `ADMIN_SECRET`/`SPOT_API_URL` estiverem ausentes.

**P2-3. Fallback de decimals errado em metadata de token.**
`lunes-dex-main/src/services/contractService.ts:331` — `decimals: Number(extract(decimalsQ) ?? 12)`. O ecossistema Lunes usa 8 (LUNES/WLUNES/LBTC/LETH/GMC/LUP) e 6 (LUSDT) — ver `chooseToken/mock.ts`. Se a query de metadata falhar, saldos/valores são exibidos com erro de 10⁴–10⁶×. Isso reintroduz "dado financeiro falso" por um caminho lateral.
**Fix:** falhar fechado (exibir "Unavailable" quando decimals não puder ser lido) ou usar os decimals configurados por token no catálogo, nunca um default numérico.

**P2-4. i18n inexistente e a11y mínima (pendência da auditoria anterior — ainda aberta).**
Nenhuma lib de i18n (`grep i18next|react-intl|useTranslation` = vazio em `lunes-dex-main`); strings hardcoded em inglês no DEX e em português no admin (`login/actions.ts`: "Email ou senha incorretos."). Apenas **6** atributos `aria-*` em todo o `lunes-dex-main/src`. Sem `lang` dinâmico, sem foco gerenciado em modais.
**Fix:** decisão de produto: ou declarar EN-only para o launch (e normalizar o admin), ou introduzir i18next com extração incremental. Para a11y: aria-labels em botões de ícone, foco preso em modais (wallet modal, chooseToken), roles em tabelas de orderbook.

**P2-5. TVL/valores agregados calculados com float sobre planck cru.**
`lunes-dex-main/src/hooks/usePools.ts:213-215` — `2 * (Number(reserves.reserve0) / Math.pow(10, LUSDT_DECIMALS))`. `Number()` sobre reservas > 2⁵³ planck perde precisão. Display-only (não-autoritativo, ok pelo AGENTS.md), mas é exibição financeira.
**Fix:** dividir em BigInt primeiro (`reserve / 10n**BigInt(decimals)`) e só então converter o quociente + 2-4 dígitos de fração para Number. Mesmo padrão em `PriceHeader/index.tsx:166` e `OrderBook/index.tsx:231`.

### P3 — Melhorias

**P3-1.** `vite.config.ts` `drop: ['console']` remove também `console.error` em produção — o `ErrorBoundary` (`src/components/ErrorBoundary.tsx:74`) perde o único registro de crash. Trocar por `pure: ['console.log','console.debug']` ou manter `console.error` e ligar telemetria. (Nota positiva: `src/index.tsx:13-16` já faz noop de log/debug — mitigação dupla.)

**P3-2.** `BigInt(10 ** decimals)` em `SDKContext.tsx:913` é exato só até decimals ≤ 22 (float intermediário). Funciona para 6/8/12, mas trocar por `BigInt(10) ** BigInt(decimals)` elimina a classe de bug.

**P3-3.** Arquivos nomeados `mock.ts` (`pages/home/modals/chooseToken/mock.ts`, `transactionSetting/mock.ts`) são na verdade catálogo estático dirigido por env — renomear para `tokenCatalog.ts` / `slippagePresets.ts` para não disparar falso-positivo em auditorias e greps de "mock em produção".

**P3-4.** UX de transação: vários fluxos resolvem sucesso em `isInBlock || isFinalized` (`contractService.ts:378,1045,1091,1133,1258,1328`) enquanto outros exigem `isFinalized` (`contractService.ts:736,856,938`; `asymmetricContractService.ts:140,302,350,391,432`). Inconsistente com o padrão fail-closed-on-finality do backend. Unificar: feedback em dois estágios ("incluída" → "finalizada") no toast. WS do spot tem reconnect com backoff exponencial capped (`spotService.ts:240-247`), mas após `maxReconnectAttempts` para silenciosamente — exibir indicador "dados desatualizados".

---

## Pontos positivos (manter)

- **Signing sempre explícito:** todas as mutações usam `web3FromAddress(account.address)` + `{ signer: injector.signer }` no momento da ação do usuário (`contractService.ts:356,687,769`; `asymmetricContractService.ts:85,243,323,369,410`). Restore de wallet não restaura signer (`SDKContext.tsx:243-251`).
- **Matemática de valores em BigInt string-based, sem float:** `parseAmount`/`formatAmount` (`SDKContext.tsx:909-945`) fazem split decimal manual + BigInt — correto, sem precision bugs. `calculateMinAmount` idem.
- **Admin com baseline sólida:** bcrypt + Credentials, rate limit de login 5/15min com log de IP (`login/actions.ts`), RBAC em 100% das server actions auditadas, audit log (`logAudit`), emergency restrito a SUPER_ADMIN, **zero** `NEXT_PUBLIC_*` no código, middleware default-deny, script `create-admin.ts` exige senha ≥16 chars.
- **Higiene de build:** ErrorBoundary global (`App.tsx:24`), catch-all 404 real, manualChunks, tsconfig `strict: true` nos dois projetos, lint zero-warnings, dead-code gates (`ts-prune`/`depcheck`) no script `quality`.

## Melhorias APROVADAS para implementação imediata

1. P1-2(a): tornar `npm run build` fail-closed (incluir `check-production-env.cjs`) — 1 linha no package.json.
2. P1-2(b)/(c): módulo único `src/config/api.ts` + regra anti-`localhost:4000` no guard.
3. P2-1: `maxAge: 8h` na sessão NextAuth — 1 linha.
4. P2-2: `requireEnv` fail-closed em `listings/actions.ts` (e demais actions com fetch externo).
5. P2-3: remover fallback `?? 12` de decimals (exibir Unavailable).
6. P3-1, P3-2, P3-3 — triviais e sem risco.

## Resultado real de builds/lint (executados em 2026-06-12)

| Comando | Resultado |
|---|---|
| `lunes-dex-main: npx tsc --noEmit` | **0 erros** (saída vazia, exit 0) |
| `lunex-admin: npx tsc --noEmit` | **0 erros** (saída vazia, exit 0) |
| `lunes-dex-main: npm run lint` (`eslint --max-warnings=0`) | **PASS** (exit 0) |
| `lunex-admin: npm run lint` | **PASS** (exit 0) |
| Testes automatizados de frontend | **Inexistentes** (0 testes nos dois projetos) |
