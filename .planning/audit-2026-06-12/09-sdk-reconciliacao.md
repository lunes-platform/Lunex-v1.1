# 09 — Reconciliação SDK ↔ spot-api (P1: SDK chama endpoints inexistentes)

**Data:** 2026-06-12
**Escopo:** `sdk/src/modules/*` + `sdk/src/http-client.ts` vs mounts reais em `spot-api/src/index.ts` e routers em `spot-api/src/routes/*.ts`.
**Validação ao vivo:** spot-api rodando em `http://localhost:4000` (curl).

## Resumo executivo

- O achado do Especialista 3 foi **confirmado**: os módulos `auth`, `factory`, `router`, `staking`, `wnative` e parte de `tokens` chamavam paths que **nunca existiram** no spot-api (todos retornavam 404 — verificado por curl). O módulo `pair` tem **o mesmo bug** (`/pair/*`) e foi incluído no tratamento (adição de escopo justificada: mesma classe de defeito P1).
- **3 métodos tinham correspondente real** e foram corrigidos (módulo `tokens` → token registry `/api/v1/tokens`).
- **Os demais não têm correspondente REST compatível**: são interações on-chain (contratos factory/router/staking/wnative/pair via `@polkadot/api-contract`) ou endpoints com contrato de payload incompatível com a assinatura pública do método (ex.: `GET /api/v1/route/quote` usa `pairSymbol/side`, não `path[]` de endereços). Esses métodos foram **mantidos** (compat de assinatura preservada), marcados com `@deprecated` e agora lançam `EndpointNotAvailableError` (novo, exportado em `sdk/src/errors.ts`) com mensagem clara em vez de 404 opaco.
- Nenhum método público foi renomeado ou removido. Nenhum commit foi feito.

## Mounts reais do spot-api (referência)

`/health`, `/metrics`, e sob `/api/v1`: `listing`, `orders`, `trade`, `agents`, `execution`, `pairs`, `trades`, `candles`, `orderbook`, `social`, `copytrade`, `margin`, `affiliate`, `strategies`, `asymmetric`, **`route`** (não `router`), `governance`, **`tokens`** (token registry), `user`, `markets`, `rewards`, `admin`.

## Tabela de reconciliação

Legenda ação: **FIX** = path/payload corrigido; **DEPRECATED** = `@deprecated` + `EndpointNotAvailableError`; **OK** = já correto; **LOCAL** = método sem HTTP, mantido.

| Módulo SDK | Método | Path atual (antes) | Existe? | Path real correspondente | Ação |
|---|---|---|---|---|---|
| auth | `getNonce` | `POST /auth/nonce` | Não | — (auth é por requisição: assinatura sr25519 + nonce no payload, ou `X-API-Key`) | DEPRECATED |
| auth | `login` | `POST /auth/login` | Não | — (spot-api não emite tokens de sessão) | DEPRECATED |
| auth | `refreshToken` | `POST /auth/refresh` | Não | — | DEPRECATED |
| auth | `logout` | — (local) | — | — | LOCAL |
| factory | `getAllPairs` | `GET /factory/pairs` | Não | parcial: `GET /api/v1/pairs` (registro spot, shape diferente; `GET /api/v1/pairs/on-chain` é admin-only) → on-chain | DEPRECATED |
| factory | `getPairByTokens` | `GET /factory/pair/:a/:b` | Não | — (leitura on-chain `get_pair`) | DEPRECATED |
| factory | `createPair` | `POST /factory/pair` | Não | — (tx on-chain `create_pair`) | DEPRECATED |
| factory | `getStats` | `GET /factory/stats` | Não | — (leitura on-chain) | DEPRECATED |
| factory | `pairExists` | (via getPairByTokens) | Não | — | DEPRECATED |
| router | `getQuote` | `GET /router/quote` | Não | `GET /api/v1/route/quote` existe, mas contrato incompatível (`pairSymbol`/`side`/`amountIn` vs `amountIn`+`path[]`) | DEPRECATED (msg aponta endpoint REST) |
| router | `addLiquidity` | `POST /router/add-liquidity` | Não | — (tx on-chain `add_liquidity`) | DEPRECATED |
| router | `removeLiquidity` | `POST /router/remove-liquidity` | Não | — (tx on-chain) | DEPRECATED |
| router | `swapExactTokensForTokens` | `POST /router/swap-exact-in` | Não | `POST /api/v1/route/swap` existe, mas exige agent API key + payload `pairSymbol/side` (incompatível) | DEPRECATED (msg aponta `sdk.agents`) |
| router | `swapTokensForExactTokens` | `POST /router/swap-exact-out` | Não | idem acima | DEPRECATED |
| router | `calculateMinAmount` / `calculatePriceImpact` | — (local) | — | — | LOCAL |
| staking | `stake` | `POST /staking/stake` | Não | — (tx on-chain no contrato de staking) | DEPRECATED |
| staking | `unstake` | `POST /staking/unstake` | Não | — | DEPRECATED |
| staking | `claimRewards` | `POST /staking/claim` | Não | — (rewards off-chain ficam em `/api/v1/rewards/*` via `sdk.rewards`) | DEPRECATED |
| staking | `getPosition` | `GET /staking/position/:addr` | Não | — | DEPRECATED |
| staking | `getStats` | `GET /staking/stats` | Não | — | DEPRECATED |
| staking | `createProposal` | `POST /staking/proposal` | Não | — | DEPRECATED |
| staking | `vote` | `POST /staking/vote` | Não | `POST /api/v1/governance/vote/record` é só *tracking* e exige payload assinado sr25519 (incompatível) | DEPRECATED |
| staking | `executeProposal` | `POST /staking/proposal/:id/execute` | Não | — | DEPRECATED |
| staking | `getAllProposals` | `GET /staking/proposals` | Não | — | DEPRECATED |
| staking | `getProposal` | `GET /staking/proposal/:id` | Não | — | DEPRECATED |
| staking | `isTokenApproved` | `GET /staking/token/:addr/approved` | Não | fluxo de listing REST fica em `/api/v1/listing/*` | DEPRECATED |
| staking | `adminListToken` | `POST /staking/admin/list-token` | Não | `POST /api/v1/tokens` (admin) cobre só registro de token | DEPRECATED |
| tokens | `getTokens` | `GET /public/tokens` | Não | `GET /api/v1/tokens` (200 ✓) | **FIX** |
| tokens | `getToken` | `GET /public/token/:addr` | Não | `GET /api/v1/tokens/:address` (rota existe ✓; 404 só p/ token desconhecido, body próprio da rota) | **FIX** |
| tokens | `getTokenDecimals` | `GET /public/token/:addr/decimals` | Não | derivado de `GET /api/v1/tokens/:address` (registry inclui `decimals`) | **FIX** (payload) |
| tokens | `getNativeAssets` | `GET /public/native-assets` | Não | — (leitura chain-level via `@polkadot/api`) | DEPRECATED |
| tokens | `getNativeAsset` | `GET /public/native-asset/:id` | Não | — | DEPRECATED |
| tokens | `wrapNativeAsset` | `POST /tokens/wrap` | Não | — (tx on-chain no wrapper) | DEPRECATED |
| tokens | `unwrapToNative` | `POST /tokens/unwrap` | Não | — | DEPRECATED |
| tokens | `getBalance` | `GET /balances/:addr/:token` | Não | — (PSP22 `balance_of` on-chain; agentes: `GET /api/v1/trade/portfolio`) | DEPRECATED |
| tokens | `getAllBalances` | `GET /balances/:addr` | Não | — | DEPRECATED |
| tokens | `getPrice` | `GET /public/price/:addr` | Não | preço é por símbolo de par: `GET /api/v1/pairs/:symbol/ticker` (chave incompatível) | DEPRECATED |
| tokens | `getPrices` | `GET /public/prices` | Não | idem | DEPRECATED |
| wnative | `wrap` | `POST /wnative/deposit` | Não | — (tx on-chain `deposit`) | DEPRECATED |
| wnative | `unwrap` | `POST /wnative/withdraw` | Não | — (tx on-chain `withdraw`) | DEPRECATED |
| wnative | `getInfo` | `GET /wnative/info` | Não | — | DEPRECATED |
| wnative | `getBalance` | `GET /wnative/balance/:addr` | Não | — | DEPRECATED |
| wnative | `isHealthy` | (via getInfo) | Não | — | DEPRECATED |
| pair *(extra, mesmo bug)* | `getInfo` | `GET /pair/:addr` | Não | — (estado AMM on-chain; pares spot: `sdk.market.getPairs()`) | DEPRECATED |
| pair | `getReserves` | `GET /pair/:addr/reserves` | Não | — (`get_reserves` on-chain) | DEPRECATED |
| pair | `getHistory` | `GET /pair/:addr/history` | Não | `GET /api/v1/candles/:symbol` (chave símbolo, não endereço — incompatível) | DEPRECATED |
| pair | `getLPBalance` | `GET /pair/:addr/balance/:owner` | Não | — (PSP22 on-chain) | DEPRECATED |
| pair | `calculatePrice` / `calculateShare` | — (local) | — | — | LOCAL |

### Módulos já corretos (verificados, sem alteração)

`market` (`/health` 200 ✓, `/metrics`, `/api/v1/pairs*`, `/api/v1/orderbook/*`, `/api/v1/trades/*`, `/api/v1/candles/*`, `/api/v1/margin/*`), `orders` (`/api/v1/orders`, `/api/v1/trades`), `rewards` (`/api/v1/rewards/*`), `social` (`/api/v1/social/*`), `copytrade` (`/api/v1/copytrade/*`), `agents` (`/api/v1/agents/*`, `/api/v1/trade/*`), `strategy` (`/api/v1/strategies/*`), `execution` (`/api/v1/execution/*`), `asymmetric` (`/api/v1/asymmetric/*`). O `http-client` não prefixa path (baseURL é só o host) — nenhuma mudança necessária nele.

## Validação por curl (localhost:4000)

| Path | HTTP | Interpretação |
|---|---|---|
| `GET /api/v1/tokens` | **200** (`{"tokens":[]}`) | rota nova do fix existe ✓ |
| `GET /api/v1/tokens/search?q=lun` | **200** | ✓ |
| `GET /api/v1/tokens/5xxFakeAddr` | 404 (`{"error":"Token not found in registry"}`) | rota existe — 404 é semântica da própria rota, não do Express ✓ |
| `GET /api/v1/route/quote` | **400** (validação Zod) | rota existe ✓ (referenciada nas msgs de deprecation) |
| `GET /api/v1/pairs` | **200** | ✓ |
| `GET /health` | **200** | ✓ |
| `GET /factory/pairs`, `/staking/stats`, `/router/quote`, `/wnative/info`, `/public/tokens`, `/auth/nonce`, `/pair/...` | **404** | confirma o bug original (nenhuma dessas rotas existe) |

## Mudanças aplicadas (sem commit)

- **Novo:** `sdk/src/errors.ts` — `EndpointNotAvailableError` (`code: 'ENDPOINT_NOT_AVAILABLE'`, `operation`, mensagem explicando que a operação é on-chain e qual a alternativa). Exportado em `sdk/src/index.ts`.
- **Corrigidos (paths):** `sdk/src/modules/tokens.ts` — `getTokens`, `getToken`, `getTokenDecimals` agora usam o token registry real (`/api/v1/tokens`). Obs.: o registry não pagina; `pagination` retorna `undefined` (tipo era `any`, sem quebra). Helper privado morto `formatUserBalance` removido (não fazia parte da API pública).
- **Deprecados (assinaturas preservadas, lançam `EndpointNotAvailableError`):** todos os métodos HTTP de `auth` (exceto `logout`, local), `factory`, `router` (helpers locais mantidos), `staking`, `wnative`, `pair` (helpers locais mantidos) e os métodos native-assets/wrap/balances/prices de `tokens`.

## Gates

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erros |
| `npm run build` (tsc) | ✅ ok |
| `npm run lint` (eslint src, max-warnings=0) | ✅ arquivos alterados sem issues. ⚠️ falha **pré-existente** e não relacionada: `src/__tests__/spot-utils.golden.test.ts` dá *parsing error* porque `tsconfig.json` exclui `**/*.test.ts` do `parserOptions.project` (config, não código; arquivo não tocado nesta tarefa). |

## Observações / follow-ups sugeridos

1. **`removeComments: true` no `sdk/tsconfig.json`** remove os JSDoc `@deprecated` do output compilado (`.d.ts`/`.js`) — consumidores via npm podem não ver o strikethrough no editor. O erro em runtime cobre o caso, mas vale avaliar desligar `removeComments` (ou usar `tsc` com declarações comentadas).
2. O exemplo de uso no docblock de `LunexSDK` (`sdk/src/index.ts`) ainda demonstra `auth.getNonce`/`router.getQuote` (agora deprecados) — atualizar docs/README do SDK num passo de documentação.
3. Corrigir a config de lint dos testes (`parserOptions.project` vs exclude de `**/*.test.ts`) — falha pré-existente que mascara o gate `npm run lint`.
4. Se quoting/swap REST for desejado no SDK, adicionar **novos** métodos com o contrato real (`pairSymbol`/`side`) em `sdk.market` ou `sdk.router` (aditivo, sem quebrar assinaturas) — fora do escopo deste bugfix.
