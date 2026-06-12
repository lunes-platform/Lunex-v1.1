# Coesão 01 — Trade Híbrido (roteamento AMM ↔ Spot Orderbook ↔ Asymmetric + settlement on-chain)

**Validador:** Coesão 1/6 — Tese Central do modelo híbrido de negociação
**Data:** 2026-06-12
**Escopo:** contratos ink! → spot-api → SDK/MCP → frontend (somente leitura)

---

## VEREDITO DE COESÃO: **COESO COM RESSALVAS**

A espinha dorsal back-end ↔ contrato é **coesa e fail-closed por design**: o matching off-chain é autoritativo, o preço/quantidade casado flui fielmente até o payload de settlement, e a finalidade on-chain (`isFinalized`) é respeitada em todos os pontos que movem fundo neste fluxo. As ressalvas são reais e priorizadas: (a) o frontend de swap está cabeado a uma API-fantasma do SDK (métodos inexistentes), (b) AMM_V1 não tem caminho de execução real em lugar nenhum, e (c) o caminho monetário usa `float` JS em vários pontos antes da fronteira BigInt.

## STATUS DA TESE: **PARCIAL**

> "O Lunex roteia cada trade pela melhor fonte de liquidez (AMM/orderbook/assimétrico), e o settlement fecha o ciclo movendo fundos custodiais com finalidade (isFinalized), sem perder/duplicar valor."

- **VALIDADO (back-end + contrato):** roteamento por melhor `amountOut`, matching autoritativo, settlement fiel ao casado, finalidade garantida, gate fail-closed honrado.
- **REFUTADO (rota AMM_V1):** "roteia cada trade pela **melhor** fonte" é falso na prática — se AMM_V1 vence a cotação, a execução **lança erro** (`'AMM_V1 execution is not implemented by the backend router'`, `routerService.ts:~498`). Não há fallback para 2ª melhor rota: fail-closed, mas significa que trades cuja melhor fonte é o AMM **não executam de jeito nenhum** pelo back-end.
- **PARCIAL (frontend):** o usuário final do swap não tem caminho real — ver ressalva crítica abaixo.

---

## TABELA DE HANDOFFS ENTRE CAMADAS

| # | Handoff | Origem → Destino | Status | Evidência |
|---|---------|------------------|--------|-----------|
| 1 | Decisão de rota | `routerService.getQuote` → melhor `amountOut` net of fees | **OK** | `routerService.ts` §5 `availableRoutes.filter(r=>r.available).sort((a,b)=>b.amountOut-a.amountOut)`; lança se nenhuma disponível |
| 2 | Execução AMM_V1 | router → (nada) | **QUEBRADO** | `routerService.ts:~498` `throw 'AMM_V1 execution is not implemented'` — vencedor AMM não executa, sem fallback |
| 3 | Execução ORDERBOOK | router → `orderService` | **OK (com gate)** | bloqueia se `settlementService.isEnabled()` sem ordem assinada por wallet; revalida frescor (`assertFreshOrderbookExecution`) |
| 4 | Execução ASYMMETRIC | router → intent p/ wallet | **OK** | retorna `requiresWalletSignature:true` + `contractCallIntent`; não move fundo do lado server |
| 5 | Matching → trade record | `tradeService.processMatches` → `trade.create` | **OK** | `tradeService.ts:162-167` `price=Decimal(match.fillPrice)`, `amount=Decimal(match.fillAmount)`, `settlementStatus:'PENDING'` |
| 6 | Trade casado → payload settlement | `tradeService` → `TradeSettlementInput` | **OK (fiel)** | `tradeService.ts:149-150` `fillAmount/fillPrice` = exatamente os valores casados; `serializeSettlementInput` persiste |
| 7 | Payload → contrato `settle_trade` | `settlementService.submitSettlement` | **OK** | `decimalToUnits(price,8)`, `decimalToUnits(amount,baseDecimals)` → planck via BigInt; `signAndSend` espera `isFinalized` |
| 8 | Gate fail-closed do contrato | `spot_settlement.settle_trade` | **OK (consistente)** | contrato `verify_order_signature` retorna `SignatureVerificationUnavailable` se `signature_verification_enforced` (default `true`) sem attestor; spot-api propaga como `FAILED` + retry |
| 9 | SDK `router.*` (deprecado) | SDK → spot-api | **OK (coerente)** | `sdk/src/modules/router.ts` todos métodos `@deprecated` lançam `EndpointNotAvailableError`, apontam p/ `GET /api/v1/route/quote` |
| 10 | Frontend swap → SDK | `useSwap.tsx` / `home/index.tsx` → SDK | **QUEBRADO** | chamam `sdk.getQuote/executeSwap/parseAmount/walletAddress` — **inexistentes** em `LunexSDK` (só há `sdk.router`, `sdk.orders`, etc.) |
| 11 | Frontend spot → orderbook/orders | `pages/spot` → spot-api REST | **OK (não auditado em profundidade)** | páginas spot existem (`OrderForm`, `OrderBook`, `OrderHistory`) e consomem REST real |

---

## ACHADOS DETALHADOS (por pergunta)

### 1. Critério de decisão de rota + comportamento quando rota indisponível
- **Critério coerente:** sim. `getQuote` simula as 3 fontes e escolhe o maior `amountOut` líquido de fees, filtrando `available`. Cada rota marca `unavailableReason` (`NO_LIQUIDITY`, `PRICE_IMPACT_TOO_HIGH`, `INSUFFICIENT_DEPTH`, `LIVE_CURVE_UNAVAILABLE`, `PAIR_NOT_MAPPED`, `QUERY_ERROR`).
- **Indisponibilidade = fail-closed:** se nenhuma rota disponível, lança `No liquidity available`. Não há fallback silencioso. **PORÉM** não há fallback para a 2ª melhor rota quando a 1ª (AMM_V1) é estruturalmente inexecutável — o trade simplesmente falha (ver achado 2).
- Ressalva: AMM_V1 marca `available` na **cotação** mas é inexecutável na **execução** — incoerência entre o que o quote promete e o que o swap entrega.

### 2. Orderbook autoritativo + fidelidade do settlement
- **Autoritativo:** sim. DB é a verdade canônica; o book in-memory é "derived state" rehidratável (`orderService.ts` comentário explícito na linha ~513). Cancelamento atualiza DB primeiro.
- **Fidelidade:** **alta.** O `match.fillPrice`/`match.fillAmount` casados vão **idênticos** para (a) o `trade.create` (`Decimal`) e (b) o `TradeSettlementInput` (`fillPrice/fillAmount` string). Não há divergência preço/quantidade entre casado e liquidado. `settle_trade` no contrato ainda revalida hash de ordem (`ensure_order_hash_matches`) e `FillExceedsRemaining`.

### 3. isFinalized em TODOS os pontos que movem fundo (contraprova isInBlock)
- **CONFORME.** `settlementService.ts:528` (settle_trade) e `:648` (cancel_order_for) ambos resolvem **apenas** em `txResult.status.isFinalized`. O tipo declara `isInBlock` mas **nunca** o usa como gatilho.
- Mesma disciplina em `copyVaultService` (162, 242) e `assetBridgeService` (425, 462). Comentário in-code documenta o porquê ("forks can revert"). Nenhum ponto deste fluxo confirma em `isInBlock`.

### 4. Contrato com gate fail-closed `signature_verification_enforced` — spot-api lida?
- **SIM, lida graciosamente.** Default do contrato é `signature_verification_enforced: true` + `attestor_pubkey: None` → `settle_trade` retorna `SignatureVerificationUnavailable` (ADR-001/P0-1).
- spot-api **não liquida cegamente**: `submitSettlement` recebe o `dispatchError`, faz `reject`, e `settleTrades` captura → marca trade como `FAILED` com `nextSettlementRetryAt` (retry com backoff). O trade não é perdido nem duplicado; fica PENDING/FAILED até o attestor existir.
- Defesa em profundidade: spot-api **já recusa** assinaturas sintéticas (`agent:`/`manual:`) antes de chegar ao contrato (`assertOrderTrustedSource`, `signatureToBytes`), e exige sr25519 de 64 bytes.

### 5. Consistência de units (decimais/planck) na fronteira off-chain ↔ on-chain
- **Fronteira on-chain é segura:** `decimalToUnits` usa **BigInt** puro (`10n ** BigInt(decimals)`), trunca fração ao número de decimais — sem float na conversão para planck. Preço sempre escala 8 (`decimalToUnits(price, 8)`), amount em `baseDecimals` do par.
- **ACHADO DE FLOAT confirmado e com alcance neste fluxo:**
  - `routerService.ts`: **todo** o serviço é `number`/`parseFloat` — `ammV1AmountOut`, `asymmetricAmountOut`, comparação de rotas, `priceImpactBps`, `minAmountOut = bestAmountOut * (1 - bps/10_000)`. Reservas lidas via `parseFloat(reserveBase)`. Aceitável para *cotação/seleção*, arriscado se virar base de liquidação.
  - `tradeService.ts:106` `quoteAmount = match.fillAmount * match.fillPrice` — **multiplicação float JS no caminho monetário**, depois `makerFee/takerFee` derivam dela, e tudo é convertido para `Decimal(...toString())`. O float entra **antes** do Decimal; arredondamento de ponto flutuante pode contaminar `quoteAmount`, `makerFee`, `takerFee` persistidos. (`fillPrice`/`fillAmount` em si vêm do `MatchResult` — checar tipo na engine; se já forem float, o casamento herda imprecisão.)
- Veredito unit: **fronteira planck OK**, mas há **float upstream** no cálculo de quote/fee/quoteAmount que merece migração para Decimal/BigInt fim-a-fim.

### 6. Rota deprecada do SDK (router.*) deixa consumidor sem caminho AMM?
- O SDK `router.*` está **coerentemente** deprecado: lança `EndpointNotAvailableError` e aponta para `GET /api/v1/route/quote` (keyed por `pairSymbol`, não por path de tokens). Bom: nenhuma promessa falsa silenciosa no SDK.
- **MAS o frontend não migrou.** `useSwap.tsx` e `home/index.tsx:158` chamam `sdk.getQuote(amountInWei, [path])`, `sdk.executeSwap({path,...})`, `sdk.parseAmount`, `sdk.walletAddress`, `sdk.calculateMinAmount`, `sdk.formatAmount` — **nenhum desses existe** em `LunexSDK` (que só expõe módulos: `auth, factory, router, pair, ..., asymmetric, strategies, execution`). O swap do usuário final não tem caminho real para AMM (nem para rota nenhuma): cai em runtime error / `undefined is not a function`. A própria `docs/index.tsx` ainda ensina o padrão antigo `sdk.router.getQuote`.
- Resumo: a rota AMM está **sem consumidor funcional** ponta-a-ponta — back-end não executa AMM_V1, e o frontend chama uma API que não existe.

---

## LACUNAS DE INTEGRAÇÃO PRIORIZADAS

| Prio | Lacuna | Camada | Impacto |
|------|--------|--------|---------|
| **P0** | Frontend swap chama métodos inexistentes do SDK (`sdk.getQuote/executeSwap/parseAmount/walletAddress`) | frontend↔SDK | Swap do usuário final quebrado em runtime; tese de "rota a melhor fonte" não chega ao usuário |
| **P0** | AMM_V1 vence cotação mas execução lança erro sem fallback para 2ª melhor rota | spot-api | Trades cuja melhor fonte é AMM não executam; quote promete o que o swap não cumpre |
| **P1** | `float` no caminho monetário: `tradeService.ts:106` `quoteAmount = fillAmount*fillPrice` (e fees derivadas) antes do Decimal | spot-api | Risco de imprecisão em valores persistidos/cobrados; auditar tipo de `MatchResult.fillPrice/fillAmount` na engine |
| **P1** | `routerService` inteiramente float (reservas via `parseFloat`, `minAmountOut` float) | spot-api | Seguro p/ cotação, perigoso se virar base de liquidação; `amountOutMin`/slippage podem divergir do on-chain |
| **P2** | `docs/index.tsx` ainda documenta `sdk.router.getQuote(...)` (deprecado) | frontend/docs | Onboarding de devs/agentes para API morta |
| **P2** | Cotação AMM_V1 marca `available:true` mas é inexecutável — coerência quote↔execução | spot-api | Quote enganosa; deveria marcar AMM `available:false` no back-end ou implementar execução |

---

## RESUMO

O **núcleo crítico de segurança de fundos é coeso**: matching autoritativo → trade fiel → settlement com finalidade (`isFinalized`) → gate fail-closed do contrato respeitado pelo spot-api (sem liquidação cega). A tese "sem perder/duplicar valor com finalidade" se sustenta no back-end. As fraturas estão nas **bordas**: a rota AMM não tem execução em lugar nenhum, o frontend de swap está cabeado a uma fachada de SDK que não existe, e há `float` no caminho monetário a montante da fronteira BigInt. Daí: **COESO COM RESSALVAS / tese PARCIAL**.
