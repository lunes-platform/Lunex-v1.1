# Coesão 5/6 — MCP / Agentes AI ↔ spot-api

**Auditor:** Validador de Coesão 5/6 (somente leitura)
**Data:** 2026-06-12
**Escopo:** `mcp/lunex-agent-mcp/src/{index.ts, routerTools.ts, smokeRouter.ts}` confrontado com `spot-api/src/index.ts` (mounts) + routers + `middleware/agentAuth.ts` + `services/agentService.ts`. spot-api validado AO VIVO em `http://localhost:4000`.

---

## VEREDITO

**TESE: VALIDADA.**

Um agente AI conectado via MCP tem paridade funcional com um usuário humano. Os 54 tools despachados pelo MCP server mapeiam para endpoints **REAIS e existentes** do spot-api. **Zero tools dão 404 por rota inexistente** — ao contrário do bug do SDK (6 módulos chamando rotas fantasma), o MCP **NÃO replica esse problema**. Auth por API key (`X-API-Key lnx_*`) com gating por tier de staking é real e enforçado no backend. Os builders de mensagem assinada canônica são **byte-a-byte idênticos** entre MCP, SDK e spot-api — não há drift de assinatura. O modelo híbrido (server-side vs wallet-assisted) é coerente.

> Nota de contagem: o prompt cita "67 tools". A contagem real de handlers despachados no `switch` é **54** (mais 3 prompts `openclaw_*` que são guias, não chamadas HTTP). A divergência é nomenclatura/marketing, não funcional.

---

## 1. Tabela tool → endpoint → existe?

Legenda status live: `200/400/401/422` = rota existe (auth/validação/lógica respondendo). `404` ⚠️ só foi observado com **IDs falsos** (entidade inexistente), nunca por rota não-montada — confirmado re-testando com símbolo real `GMC/LUSDT` (todos 200).

### Tools de leitura de mercado (públicas)
| Tool | Método+Path | Existe? | Evidência |
|---|---|---|---|
| get_lunex_health | GET /health | ✅ | 200 |
| list_pairs | GET /api/v1/pairs | ✅ | 200 |
| get_pair_ticker | GET /api/v1/pairs/:symbol/ticker | ✅ | 200 (GMC%2FLUSDT); pairs.ts:26 |
| get_orderbook | GET /api/v1/orderbook/:symbol | ✅ | 200 |
| get_recent_trades | GET /api/v1/trades/:symbol | ✅ | 200 (GMC%2FLUSDT); trades.ts:51 |
| get_candles | GET /api/v1/candles/:symbol | ✅ | 200 (GMC%2FLUSDT); candles.ts:28 |
| get_router_quote | GET /api/v1/route/quote | ✅ | rota existe; 500 = "No liquidity" (lógica viva, não rota) |

### Tools de trade / swap / ordens (auth)
| Tool | Método+Path | Existe? | Evidência |
|---|---|---|---|
| agent_router_swap | POST /api/v1/route/swap | ✅ | 401 (auth) |
| create_spot_order | POST /api/v1/orders | ✅ | 400 (validação) |
| cancel_spot_order | DELETE /api/v1/orders/:id | ✅ | 400 |
| get_user_orders | GET /api/v1/orders | ✅ | 400/200 |
| get_user_trade_history | GET /api/v1/trades | ✅ | 400/200 |
| agent_swap | POST /api/v1/trade/swap | ✅ | 401; tradeApi.ts:143 |
| agent_limit_order | POST /api/v1/trade/limit | ✅ | 401; tradeApi.ts:241 |
| agent_portfolio | GET /api/v1/trade/portfolio | ✅ | 401; tradeApi.ts:399 |
| prepare_spot_order_signature | (local — buildSpotOrderSignMessage) | ✅ | não chama HTTP; gera msg canônica |
| prepare_spot_cancel_signature | (local — buildSpotCancelSignMessage) | ✅ | não chama HTTP |

### Tools de agente / staking
| Tool | Path | Existe? | Evidência |
|---|---|---|---|
| register_agent | POST /api/v1/agents/register | ✅ | 400 (validação); agents.ts:99 |
| create_agent_api_key | POST /api/v1/agents/:id/api-keys | ✅ | 401 |
| list_agents | GET /api/v1/agents | ✅ | 200 |
| (agent_portfolio usa) GET /api/v1/agents/me | ✅ | 401 |

### Tools asymmetric (modelo híbrido)
| Tool | Path | Existe? | Evidência |
|---|---|---|---|
| agent_get_strategy_status | GET /api/v1/asymmetric/agent/strategy-status/:id | ✅ | 401 |
| agent_update_curve_parameters | POST /api/v1/asymmetric/agent/update-curve | ✅ | 401; asymmetric.ts:689 |
| agent_get_asymmetric_delegation_context | GET /api/v1/asymmetric/agent/delegation-context | ✅ | 401; asymmetric.ts:579 |
| agent_link_asymmetric_strategy | POST /api/v1/asymmetric/agent/link-strategy | ✅ | 401; asymmetric.ts:603 |
| agent_create_asymmetric_strategy | POST /api/v1/asymmetric/agent/create-strategy | ✅ | 401; asymmetric.ts:641 |

### Tools execution / strategies / social / copytrade
| Tool | Path | Existe? | Evidência |
|---|---|---|---|
| validate_trade | POST /api/v1/execution/validate | ✅ | 401 |
| get_execution_history / daily-summary / risk-params | GET /api/v1/execution/* | ✅ | 401 |
| list_strategies_marketplace | GET /api/v1/strategies/marketplace | ✅ | 200 |
| get_strategy / performance / follow / register / update | /api/v1/strategies/* | ✅ | 200/400/401 |
| get_followed_strategies | GET /api/v1/strategies/followed/:wallet | ✅ | 400 |
| list_social_leaders / get_leader_profile | GET /api/v1/social/leaders[/...] | ✅ | 200 |
| list/get copytrade vaults, positions, activity, executions | /api/v1/copytrade/* | ✅ | 200/400/401 |
| create_leader_api_key_challenge | POST /api/v1/copytrade/leaders/:id/api-key/challenge | ✅ | copytrade.ts:32 |
| rotate_leader_api_key | POST /api/v1/copytrade/leaders/:id/api-key | ✅ | copytrade.ts:189 |
| submit_copytrade_signal | POST /api/v1/copytrade/vaults/:id/signals | ✅ | copytrade.ts:276 |
| list_pending_copytrade_wallet_signals | GET .../signals/pending-wallet | ✅ | copytrade.ts:163 |
| confirm_copytrade_wallet_signal | POST .../signals/:sid/wallet-confirmation | ✅ | copytrade.ts:384 |

### Prompts (não-HTTP, guias)
| Tool | Tipo |
|---|---|
| openclaw_scope_guard / openclaw_authenticated_spot_trade / openclaw_social_copytrade_scan | Prompt builders locais (buildScopeGuardPrompt etc.) — orientam o agente, não chamam o backend. Legítimos. |

**Tools que dão 404 por rota inexistente: 0.**

---

## 2. agentAuth — gating por tier é real?

**SIM, é real e enforçado no backend.** Não é confiança cega no MCP.

- `agentAuth(['PERMISSION'])` (middleware) extrai `X-API-Key`, chama `agentService.verifyApiKey()`, anexa `req.agent` com `stakingTier, dailyTradeLimit, maxPositionSize, maxOpenOrders`. Rejeita 401 se ausente/inválida e verifica permissões requeridas.
- `tradeApi.ts` aplica `router.use(agentAuth(['TRADE_SPOT']))` globalmente + `validateTradeLimits(agent, amount)` antes de cada trade:
  - `amount > agent.maxPositionSize` → erro (`tradeApi.ts:60`).
  - limite de trades verificado contra `totalTrades` (`tradeApi.ts:71`).
- `agentService` define tiers fixos (`STAKING_TIERS`): tier0 `{daily:10, maxPos:100, maxOpen:5}` … tier3 `{daily:2000, maxPos:100k, maxOpen:200}`. **Tier só sobe via `verifyStake()` após verificação on-chain** (`agentService.ts:289` — stake fica `PENDING_VERIFICATION`, não credita tier antes da prova on-chain).

**Um agente PODE exceder limites do tier?** Não no `maxPositionSize` (checado por trade). **Limitação observada (não-bloqueante):** o "daily trade limit" é um proxy frouxo — usa `totalTrades` (contagem vitalícia) × 365 como teto, não uma janela deslizante diária real (`tradeApi.ts:71-78`, comentado como "rough daily limit proxy"). Na prática o limite diário nunca é atingido por uso normal; é mais um teto anti-abuso vitalício. Endpoints asymmetric exigem permissão distinta `MANAGE_ASYMMETRIC`.

---

## 3. Contratos de payload / assinatura canônica — há drift?

**NÃO HÁ DRIFT. Builders byte-a-byte idênticos** entre MCP, SDK e spot-api server:

**Ordem spot:**
- MCP `index.ts:176`, SDK `spot-utils.ts:67`, server `auth.ts:96` (`buildSpotOrderMessage`) — todos produzem:
  `lunex-order:{pairSymbol}:{side}:{type}:{price||0}:{stopPrice||0}:{amount}:{nonce}:{timestamp}`
- Servidor verifica assinatura **sr25519** (`orderService.ts:5`, `orders.ts:64` "Invalid signature", `auth.ts:verifyAddressSignature` via `signatureVerify`).

**Cancel / wallet-action:**
- MCP `buildWalletActionSignMessage` (`index.ts:2155`) e server `buildWalletActionMessage` (`auth.ts:140`) são **idênticos linha-a-linha**: prefixo `lunex-auth:{action}`, `address:`, campos ordenados por `localeCompare`, depois `nonce:` e `timestamp:`. Cancel usa `action: 'orders.cancel'` em ambos (server confirma em `orders.ts:117`). SDK delega ao mesmo `buildWalletActionSignMessage`.

O MCP **gera localmente** a mensagem canônica (não confia em endpoint) e devolve ao agente para assinatura externa — o que é o design correto (chave do usuário nunca toca o MCP).

---

## 4. agent_router_swap / agent_swap / asymmetric — on-chain vs REST

Coerente com o modelo híbrido documentado:

- **agent_router_swap** (`routerTools.ts`): POST `/api/v1/route/swap`. Se a melhor rota resolve para ASYMMETRIC, o backend devolve `requiresWalletSignature:true` e o tool marca `executionMode:'wallet-assisted'` com `nextStep` instruindo `contractCallIntent` com a carteira do usuário. Caso contrário, `server-side`. Modelo híbrido REST→on-chain explícito e honesto.
- **agent_swap** (`/api/v1/trade/swap`): server-side via `orderService.createOrder` com `signature:'agent:{id}'` (sintética). **Guard real:** se `settlementService.isEnabled()`, retorna **409 SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED** — assinatura sintética é bloqueada de liquidação on-chain até autorização de settlement delegado. Não é larp: é uma trava de segurança consciente.
- **asymmetric/agent/***: REST autenticado (`MANAGE_ASYMMETRIC`) para gestão de estratégia/curva; a execução on-chain segue o caminho wallet-assisted do router. Coerente.

---

## 5. Larp / stub / promessas não cumpridas

Nenhum tool promete função que o backend não entrega. Observações menores:

- `openclaw_*` são prompts/guias (não chamam HTTP) — corretamente declarados como prompts, sem fingir execução.
- `agent_swap` com assinatura sintética é **explicitamente travado** (409) quando settlement está ligado — transparente, não enganoso.
- "Daily trade limit" é proxy frouxo (não-bloqueante; item 2).
- Contagem "67 tools" vs 54 handlers reais — divergência de rótulo, não de função.

---

## Top 5 (impacto)
1. **Paridade total de rotas: 0 tools dão 404 por rota inexistente** — o MCP NÃO replica o bug do SDK (6 módulos fantasma).
2. **Builders de assinatura byte-a-byte idênticos** (MCP=SDK=server) para ordem e wallet-action — zero drift de assinatura.
3. **Gating por tier de staking é real no backend** (agentAuth + validateTradeLimits + STAKING_TIERS; tier só sobe pós-verificação on-chain).
4. **Modelo híbrido honesto**: router_swap sinaliza wallet-assisted vs server-side; agent_swap trava assinatura sintética com 409 quando settlement ativo.
5. **Limite diário é proxy frouxo** (totalTrades vitalício × 365), não janela deslizante — único ponto de atenção, não-bloqueante.

**Tools que dão 404 (rota inexistente): 0.**
