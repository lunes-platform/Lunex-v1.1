# Agente 6/8 — Programação Defensiva Sem Propósito

Fase A (somente leitura). Varredura: spot-api/src, lunes-dex-main/src, lunex-admin/src, sdk/src, mcp/src (305 arquivos, ~364 blocos catch analisados).

Metodologia: extração e classificação automática de todos os blocos `catch` (vazio / console-only / return-falsy / propagação) + grep de fallbacks `?? 0` / `|| '0'` em campos financeiros, com leitura de contexto dos candidatos.

**Resumo**: 10 ALTA, 13 MÉDIA, 4 BAIXA. Nenhum `catch {}` totalmente vazio em fluxo crítico do backend; o anti-padrão dominante é **falha → dado financeiro falso ('0'/null/0)**, concentrado em `lunes-dex-main/src/services/contractService.ts` e `SDKContext.tsx` (frontend DEX) e em pontos do copytrade no spot-api.

---

## ALTA confiança

### A1. contractService.getTokenInfo — metadados de token fabricados
- **Arquivo**: `lunes-dex-main/src/services/contractService.ts:329-337`
- **Anti-padrão**: `decimals: Number(extract(decimalsQ) ?? 12)`, `symbol: '???'`, `totalSupply: '0'` quando a query dry-run falha parcialmente; catch externo → `console.error` + `return null`.
- **Perigo em produção**: decimals default 12 para um token que tem 8 (padrão Lunes) ou 18 → TODOS os valores exibidos e parseados desse token errados em ordens de magnitude (10^4–10^6). É exatamente o vetor do achado "fake financial display". Usuário pode assinar swap com quantia real diferente da exibida.
- **Proposta**: se `decimals` não puder ser lido, **lançar/retornar null para o token inteiro** — nunca default numérico. `symbol`/`name` podem ter placeholder, `decimals` não.
- **Confiança**: ALTA

### A2. contractService — saldos e allowance viram '0' em erro
- **Arquivo**: `lunes-dex-main/src/services/contractService.ts:214` (getNativeBalance), `:260` (getTokenBalance), `:293` (getAllowance) — todos `console.error` + `return '0'`.
- **Perigo**: RPC instável → usuário com fundos vê saldo 0 (pânico, suporte, re-depósito); allowance 0 falsa dispara `approve` desnecessário (gas gasto à toa) ou esconde allowance ilimitada existente.
- **Proposta**: retornar `null` (tipo `string | null`) e a UI exibir "—"/estado de erro; nunca '0'.
- **Confiança**: ALTA

### A3. SDKContext — balances/voting power '0' silenciosos + parseAmount '0'
- **Arquivo**: `lunes-dex-main/src/context/SDKContext.tsx:846-849` (getVotingPower → `'0'`), `:902`, `:925` (getTokenBalance/variantes → `'0'`), `:941` (parseAmount: input inválido → `'0'`).
- **Perigo**: mesma classe do A2 na camada de contexto — a UI consome esses valores diretamente. `parseAmount` retornando `'0'` em erro é pior: input malformado do usuário vira quantia zero silenciosamente, podendo montar tx com amount 0 em vez de rejeitar o input.
- **Proposta**: propagar `null`/throw; `parseAmount` deve lançar (ou retornar resultado discriminado) — erro de parse é erro de validação, não valor.
- **Confiança**: ALTA

### A4. contractService.getAmountsOut — quote de swap pode virar '0'
- **Arquivo**: `lunes-dex-main/src/services/contractService.ts:659` (`(json?.ok ?? json ?? '0')`) e `:663-666` (catch → null).
- **Perigo**: `amountOut '0'` propaga para `SDKContext.tsx:443-445` onde `minimumReceived = amountOut * 995/1000` → **mínimo recebido 0 = swap sem proteção de slippage** se algum caller usar o quote sem validar > 0. Em DEX isso é perda direta de fundos via sandwich.
- **Proposta**: se `result.isOk` mas `ok` ausente → retornar null (já há caminho para isso); remover o `?? '0'`. Callers devem tratar quote nulo como "sem rota", nunca como 0.
- **Confiança**: ALTA

### A5. copytradeService — minAmountOut ?? 0 em intent de execução
- **Arquivo**: `spot-api/src/services/copytradeService.ts:507-509` — `minAmountOut: Number((intent).minAmountOut ?? 0)`.
- **Perigo**: se o campo faltar no `contractCallIntent`, a continuação wallet-assisted é montada com `minAmountOut: 0` → **tx de copy-trade sem proteção de slippage**, assinada pelo seguidor. Em produção, MEV/sandwich contra vaults de copytrade.
- **Proposta**: se `minAmountOut` ausente → rejeitar o intent (erro explícito) ou derivar do `maxSlippageBps` do vault; jamais 0.
- **Confiança**: ALTA (perigo); MÉDIA quanto a ocorrer (campo pode ser sempre populado upstream — verificar na Fase B).

### A6. copytradeService — executionPrice sintético gravado como real
- **Arquivo**: `spot-api/src/services/copytradeService.ts:1244-1253` — cascata `liveExecution?.executionPrice ?? 0` → `input.executionPrice` → `requestedAmountIn / Math.max(requestedAmountOutMin, 1)`.
- **Perigo**: o último degrau **fabrica** um preço (razão amountIn/amountOutMin, que é um teto de slippage, não um preço) e o grava como preço de execução → PnL, histórico e cobrança de performance fee dos copiados calculados sobre número inventado. Produto cobra por isso.
- **Proposta**: se não há preço real, gravar `executionPrice: null` + estado `PRICE_UNKNOWN`, e logar com pino. Nunca derivar preço de `amountOutMin`.
- **Confiança**: ALTA

### A7. assetBridgeService — falhas CRÍTICAS de bridge só em console.error, e saldo → BN(0)
- **Arquivo**: `spot-api/src/services/assetBridgeService.ts:105` (falha ao persistir state), `:273` (falha de mint de depósito), `:366` (falha de withdrawal), `:391` (`checkAssetBalance` catch → `new BN(0)` silencioso), `:184`, `:89`, `:516`.
- **Perigo**: é uma BRIDGE de ativos. Mint/withdrawal falhando aparece só em `console.error` (fora do pino estruturado → invisível em agregadores de log/alerta). `:391` retornando BN(0) em erro de RPC faz o check da linha 351 reter o saque ("insufficient bridge balance") — fail-closed, ok — mas sem nenhum sinal estruturado: **fundos de usuários presos sem alerta**. Falha ao salvar state (`:105`) + crash = reprocessamento/duplo-mint em cenários de borda.
- **Proposta**: trocar todos os `console.*` por `log.error/log.warn` (pino) com contexto (`depositKey`, `withdrawKey`, `assetId`) + métrica/gauge de falhas da bridge; em `:391`, logar o erro e distinguir "RPC falhou" de "saldo 0".
- **Confiança**: ALTA

### A8. tradeApi — sinal de copy-trade perdido sem nenhum rastro
- **Arquivo**: `spot-api/src/routes/tradeApi.ts:130-133` — `catch { return null }` (sem log algum).
- **Perigo**: "best-effort" é decisão legítima (não bloquear o trade principal), mas falha 100% silenciosa: se a criação de sinais quebrar (schema, Redis, bug), seguidores param de copiar e ninguém detecta — receita do produto cai sem alarme.
- **Proposta**: manter best-effort, adicionar `log.warn({ err, leaderId, pairSymbol }, '[CopyTrade] signal emission failed')` + counter Prometheus.
- **Confiança**: ALTA

### A9. usePools — volume 24h falso em falha de fetch
- **Arquivo**: `lunes-dex-main/src/hooks/usePools.ts:113-115` — `catch { return 0 }` (e `:103` `if (!res.ok) return 0`).
- **Perigo**: spot-api fora → todos os pools exibem volume 24h = 0. Dado financeiro falso exibido como real (mesmo cluster do achado fake financial display); afeta decisão de LP/trader.
- **Proposta**: retornar `null` e exibir "—" na UI; opcional `console.warn` único.
- **Confiança**: ALTA

### A10. staking — LP balance silenciosamente '0'
- **Arquivo**: `lunes-dex-main/src/pages/staking/index.tsx:424-427` — catch só com `console.error`; comentário admite: "Silently fail — LP balance stays at '0'".
- **Perigo**: usuário com LP tokens vê 0 e conclui que perdeu os fundos, ou não consegue stakar e não sabe por quê.
- **Proposta**: estado `lpBalanceError` explícito na UI (banner/retry), em vez de 0.
- **Confiança**: ALTA

---

## MÉDIA confiança

### M1. copytradeService — fallback Redis→Map em challenges de API key
- **Arquivo**: `spot-api/src/services/copytradeService.ts:204-206` — Redis falhou → `apiKeyChallenges.set(...)` (mapa em memória), sem log.
- **Perigo**: esconde outage de Redis; em deploy multi-instância o challenge gravado em memória numa instância não valida na outra → falhas intermitentes de autenticação impossíveis de depurar. Difere do `fallbackNonces` (intocável) por NÃO ser documentado como feature e não logar.
- **Proposta**: `log.warn` no fallback + documentar a intenção, ou remover o fallback e falhar explícito. Confiança MÉDIA (pode ser deliberado espelhando fallbackNonces).

### M2. copytradeService — outage de Redis vira "challenge inválido" (401)
- **Arquivo**: `spot-api/src/services/copytradeService.ts:243-245` — `catch { return null }` na leitura do challenge.
- **Perigo**: erro de infra é apresentado ao usuário como assinatura/challenge inválido; sem log, sem como distinguir.
- **Proposta**: logar `log.warn` e/ou propagar erro 503 quando a causa é Redis. Fail-closed está correto; a invisibilidade não.

### M3. botSandbox — slash on-chain falhou sem nenhum log
- **Arquivo**: `spot-api/src/services/botSandbox.ts:408-410` — `catch { /* Slash failed — still block the trade */ }`.
- **Perigo**: trade é bloqueado (fail-closed, correto), mas a punição econômica do agente anômalo silenciosamente nunca acontece — agentes maliciosos não são slashed e ninguém sabe.
- **Proposta**: `log.error({ err, agentId }, '[BotSandbox] slash failed')` + métrica.

### M4. lunex-admin audit — perda de trilha de auditoria invisível
- **Arquivo**: `lunex-admin/src/lib/audit.ts:31-34` — falha do `adminAuditLog.create` só `console.error` sem o `err`.
- **Perigo**: não quebrar o fluxo principal é correto, mas perder auditoria de ação administrativa sem alerta é risco de compliance; o erro nem é incluído no log.
- **Proposta**: incluir `err` no log + contador/alerta de falhas de auditoria.

### M5. subqueryClient.getMetadata — saúde do indexer cega
- **Arquivo**: `spot-api/src/services/subqueryClient.ts:189-191` — `catch { return null }`.
- **Perigo**: é o endpoint de _health_ do indexer; engolir o erro significa que o monitoramento não distingue "indexer atrasado" de "GraphQL fora". 
- **Proposta**: `log.warn` (rate-limited) antes do `return null`.

### M6. SDKContext.initBlockchain/updateBalance — falha de conexão invisível na UI
- **Arquivo**: `lunes-dex-main/src/context/SDKContext.tsx:233`, `:264` — console-only, sem `setError`.
- **Perigo**: app fica em estado "conectando para sempre" / saldo desatualizado sem qualquer feedback.
- **Proposta**: `setError`/estado de conexão explícito (ErrorBoundary/banner já são padrão do repo).

### M7. Páginas DEX com loads silenciosos (grupo)
- **Arquivos**: `lunes-dex-main/src/pages/home/index.tsx:98` (fetchQuote), `:177` (handleConfirmSwap), `strategies/Page.tsx:584,600,666`, `rewards/index.tsx:813`, `governance/index.tsx:709,849`, `affiliates/index.tsx:562,579,594` — catch só com console, sem setError/toast.
- **Perigo**: páginas ficam vazias/0 sem estado de erro; em `home:177` uma falha de swap confirmado sem feedback é grave para UX de DEX.
- **Proposta**: estado de erro explícito por página (o repo já considera estados de erro desejáveis no frontend).

### M8. contractService — reads de governança/staking console-only
- **Arquivo**: `lunes-dex-main/src/services/contractService.ts:1002` (getStakingUserInfo), `:1189` (getProposal), `:1213` (getVotingPower → `'0'`), `:1366` (getListingStats); espelhados em `SDKContext.tsx:760,773,857`.
- **Perigo**: votação com poder '0' falso pode fazer usuário acreditar que não pode votar; propostas "inexistentes" quando o RPC caiu.
- **Proposta**: `null` + estado de erro na UI; `'0'` apenas quando a chain respondeu 0 de verdade.

### M9. asymmetricContractService — getBuyCurve/getQuote/getOwner console-only
- **Arquivo**: `lunes-dex-main/src/services/asymmetricContractService.ts:178`, `:205`, `:226`.
- **Perigo**: quote assimétrico indisponível tratado como "sem rota" sem diferenciacão de erro; UI não consegue mostrar degradação.
- **Proposta**: retorno discriminado (null + razão) como já feito em `routerService.ts:408` (`asymReason = 'QUERY_ERROR'` — padrão bom).

### M10. agentService (dex) — getAgentByWallet: "não existe" vs "API fora"
- **Arquivo**: `lunes-dex-main/src/services/agentService.ts:142-144` — `catch { return null }`.
- **Perigo**: API fora → UI conclui que a wallet não tem agente e pode oferecer fluxo de registro duplicado.
- **Proposta**: deixar 404 → null e re-lançar os demais erros.

### M11. routerService — reservas '0' do banco
- **Arquivo**: `spot-api/src/services/routerService.ts:298-299` — `reserveBase/Quote?.toString() || '0'`.
- **Perigo**: par sem snapshot de reservas gera quote AMM com reserva 0. Mitigado parcialmente por `available = ammOut > 0` (linha 306). Risco residual: `effectivePrice: 0` no payload.
- **Proposta**: marcar rota `UNAVAILABLE` com razão quando reservas ausentes, em vez de calcular com 0.

### M12. marketInfo — degradação SubQuery sem log/métrica
- **Arquivo**: `spot-api/src/routes/marketInfo.ts:39-41` — catch vazio comentado ("SubQuery offline — continue with DB-only data").
- **Perigo**: degradação deliberada e razoável, mas invisível — sem counter, impossível saber com que frequência os clientes recebem dados DB-only.
- **Proposta**: `log.debug` rate-limited + métrica `subquery_fallback_total`. Manter o fallback.

### M13. agentAuth opcional — erros de DB mascarados como "sem agente"
- **Arquivo**: `spot-api/src/middleware/agentAuth.ts:100-102` — `catch { /* Silently continue */ }`.
- **Perigo**: auth opcional é intenção legítima, mas um outage de DB/Redis na validação de API key derruba silenciosamente todos os contextos de agente (rate limits/permissões deixam de aplicar contexto).
- **Proposta**: `log.debug`/`log.warn` com `err` (sem quebrar o fluxo).

---

## BAIXA confiança / verificados como LEGÍTIMOS (não tocar sem discussão)

- **B1.** `spot-api/src/services/orderService.ts:226` — `getReferencePrice(...) || 0`: **legítimo** — linha 229 lança erro se `<= 0`. O `|| 0` é só normalização antes do guard.
- **B2.** `spot-api/src/services/matchingLockService.ts:64-74` — `lastError = err; break` é seguido de `log.error` + `throw` fora do loop: **legítimo** (propaga).
- **B3.** `spot-api/src/services/copytradeService.ts:296-298` — `signatureVerify` catch → `isValid = false` → lança `unauthorized`: fail-closed correto; opcional `log.debug`. 
- **B4.** `spot-api/src/services/listingProofService.ts:30-32` — `BigInt(...)` catch → null em função de normalização de boundary: uso correto de catch como validação de parse.

**Legítimos confirmados (regras do repo, não tocados)**: `middleware/auth.ts` (fallbackNonces e logs SECURITY), `redisRateLimit.ts:85` (fail-open logado e deliberado), `index.ts` health/metrics catches, `emergencyService.ts:198` (retorna estado de erro explícito), `websocket/server.ts:221` (responde erro ao cliente), hooks `useSwap`/`useLiquidity` e writes do `SDKContext` (todos chamam `setError` — padrão desejável), `SpotContext.tsx:123` (offline mode com `console.warn` deliberado), `sdk/src/utils.ts:416` (retorna erro discriminado `DecimalError`).

---

## Contagem
- **ALTA**: 10 (A1–A10)
- **MÉDIA**: 13 (M1–M13)
- **BAIXA/legítimos documentados**: 4 (B1–B4)

## Padrão recomendado (Fase B)
1. Leituras financeiras (balance, allowance, reserves, quote, voting power): tipo de retorno `T | null`, **nunca** `'0'`/`0` em erro; UI mostra "—"/estado de erro.
2. Backend: trocar `console.*` remanescente (assetBridgeService) por pino estruturado + métricas.
3. Best-effort legítimo continua best-effort, mas **sempre com log estruturado + counter** (tradeApi signal, botSandbox slash, audit log).
