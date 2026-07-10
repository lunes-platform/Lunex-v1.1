# Validação de Coesão Cross-Protocol — Modelo Híbrido Lunex (2026-06-12)

Pergunta de origem: "os protocolos estão coesos e conversando? as teses estão validadas?"
Método: 6 validadores de fluxo end-to-end (contrato → spot-api → SDK/MCP → frontend), cada um testando a tese de design do fluxo.

## Placar de teses (preenchido conforme validadores reportam)

| # | Fluxo | Veredito | Tese |
|---|---|---|---|
| 1 | Trade híbrido (AMM/orderbook/settlement) | 🟡 COM RESSALVAS | **PARCIAL** |
| 2 | Copy-trade + vault | 🟡 COM RESSALVAS | **PARCIAL** |
| 3 | Staking + rewards + governança | 🟡 COM RESSALVAS | **PARCIAL** |
| 4 | Afiliado + social + strategy | 🟡 COM RESSALVAS | **PARCIAL** |
| 5 | MCP / agentes AI | ✅ COESO | **VALIDADA** |
| 6 | Listing + bridge | 🟡 COM RESSALVAS | **PARCIAL** |

## Achados de coesão por fluxo

### Fluxo 4 — Afiliado + Social + Strategy (TESE PARCIAL) — `coesao-04`
- **ALTA** — Comissão de afiliado creditada no trade CASADO/PENDING (`tradeService.ts:225-251`), antes da settlement on-chain (assíncrona, pode falhar em `tradeSettlementService.ts:174`) e SEM estorno. Cliente recebe comissão por trade que pode reverter.
- **ALTA** — `SocialIndexedEvent` sem `@@unique` + `create()` puro (não upsert) em live e backfill (`socialIndexerService.ts:1036/1119/1170/1219`) → duplicação de eventos → double-count de PnL/volume → roi/sharpe inflados.
- **ALTA** — `processPayoutBatch` sem lock/transação englobante (`affiliateService.ts:326-340`) → pagamento duplo em cron concorrente.
- **MÉDIA** — `socialAnalyticsService.ts:368-373` grava roi/sharpe/maxDrawdown inexistentes no modelo Agent via `prisma as any`, erro engolido por `catch {}` → métricas do Agent NUNCA persistem (a UI "—" de hoje mascara o gap de backend).
- **MÉDIA** — Indexer social sem finality/confirmation depth (`socialIndexerService.ts:925-943`); reorg corrompe métricas — contrasta com settlement que respeita finality.

### Fluxo 6 — Listing + Bridge (TESE PARCIAL) — `coesao-06`
- ✅ Fail-closed confirmado: relayer/bridge só usam finalized heads; `listingProofService` exige evento finalizado SubQuery (TOKEN_LISTED + LIQUIDITY_LOCKED) antes de ativar.
- ✅ Relayer durável robusto: cursor avança só após `Promise.allSettled` ok; saveState atômico (.tmp+rename); backfill de gaps.
- ✅ Bridge: contas batem (deposit→mint com deposit_ref anti-double-mint; withdraw queima antes de emitir evento + balance check pré-release). Logging pino confirmado.
- **LACUNA** — Bridge sem indexação SubQuery (eventos Mint/WithdrawRequest do asset_wrapper sem handler/entidade) → auditoria de wrap/unwrap depende só de state file local.
- **LACUNA** — `assetBridgeService` sem métricas Prometheus (lag/lastProcessedBlock); sem alerta de lag do indexer.
- **Ressalva contrato** — `listing_manager::list_token` ativa síncrono (estado `Pending` do enum ignorado).

### Fluxo 5 — MCP / Agentes AI (TESE VALIDADA) — `coesao-05`
- ✅ 54 tools despachados, **0 com rota inexistente** (validado ao vivo em :4000); MCP NÃO replica o bug do SDK.
- ✅ Builders de assinatura byte-a-byte idênticos entre MCP (`index.ts:176/2155`), SDK (`spot-utils.ts:67`) e spot-api (`auth.ts:96/140`) — zero drift; servidor verifica sr25519.
- ✅ Gating por tier de staking REAL no backend (`agentAuth` + `validateTradeLimits` tradeApi.ts:60); tier só sobe via `verifyStake()` pós-prova on-chain.
- ✅ Modelo híbrido honesto: `agent_router_swap` sinaliza wallet-assisted vs server-side; `agent_swap` retorna 409 `SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED` quando settlement ativo (coerente com gate fail-closed P0-1).
- **MÉDIA (não-bloqueante)** — "daily trade limit" usa `totalTrades` vitalício × 365 como proxy, não janela deslizante real.

### Fluxo 1 — Trade híbrido (TESE PARCIAL) — `coesao-01`
- ✅ Núcleo coeso e fail-closed: `isFinalized` em 100% dos pontos de fundo (settle `settlementService.ts:528`, cancel `:648`); `isInBlock` nunca é gatilho. Settlement fiel: fillPrice/fillAmount casados fluem idênticos ao trade record e payload.
- ✅ Gate fail-closed P0-1 honrado: contrato retorna `SignatureVerificationUnavailable`, spot-api marca trade FAILED com retry (não liquida cego). SDK `router.*` deprecado coerente.
- **P1** — `routerService.executeViaRouter:498` lança "AMM_V1 execution is not implemented": se a melhor rota é AMM no caminho SERVER-SIDE (copytrade/MCP), falha sem rotear para 2ª melhor. Fail-closed, mas funcionalidade incompleta. (Swap direto do usuário NÃO é afetado — usa contractService on-chain.)
- **P1** — Float a montante da fronteira planck: `tradeService.ts:106` (`fillAmount*fillPrice` em float antes do Decimal) e routerService inteiro em number/parseFloat.
- ❌ **FALSO POSITIVO do validador** (corrigido nesta consolidação): "frontend swap quebrado / sdk.getQuote inexistente" — `useSDK()` retorna o `SDKContext` LOCAL (define getQuote/executeSwap/parseAmount/walletAddress e delega a contractService on-chain), NÃO o pacote @lunex/sdk. Swap do usuário funciona (confirmado no browser).

### Fluxo 3 — Staking + rewards + governança (TESE PARCIAL) — `coesao-03`
- **ALTA** — NÃO há fonte única de tier: 3 sistemas paralelos desconexos — `StakingTier` (duração, staking/lib.rs:160), `TradingTier` (volume, rewards/lib.rs:41), Agent tier (valor, agentService.ts:20) — sem reconciliação. **Refuta a parte "tier como fonte única" da tese.**
- **ALTA (segurança)** — `verifyStake` (agentService.ts:291) NÃO consulta a cadeia: credita tier a partir de `stake.amount` (valor do usuário) e txHash nunca validado on-chain. Confiança implícita no admin/relayer chamador, não codificada. (O validador de MCP assumiu erroneamente que validava on-chain — resolvido: o validador 3 está correto.)
- **ALTA** — Double-pay de reward: transfer (`rewardDistributionService.ts:891`) ANTES de `userReward.create` (:911) e `UserReward` sem unique constraint → crash entre os dois repaga no retry.
- **MÉDIA** — `execute_proposal` move tesouraria sob `#[cfg(not(test))]` (lógica correta CEI+idempotente, mas zero cobertura); ponte voto→execução é manual/externa (spot-api nunca chama execute_proposal).
- **MÉDIA** — `dailyTradeLimit` usa total vitalício × 365 (não janela diária); `maxOpenOrders` nunca enforçado.

### Fluxo 2 — Copy-trade + vault (TESE PARCIAL) — `coesao-02`
- ✅ `copy_vault` JÁ implementa o modelo-alvo ADR-002 (equity multi-ativo = nativo + wnative 1:1 + Σ valuation on-chain; falha de cotação fail-explícito) — P0-3 aplicado no código.
- ✅ Fixes da sessão confirmados: slippage fail-closed; executionPrice nunca fabricado. Idempotência do scheduler e cota sem diluição OK.
- **ALTA** — Saque não fecha: contrato falha `InsufficientNativeLiquidity` mas o saque em 2 fases (request/claim do ADR-002) é TODO → seguidor preso com posição PSP22 aberta até unwind manual do leader.
- **ALTA** — `vaultReconciliationService` reconcilia DB-vs-fórmula-off-chain (não vs equity on-chain), ignora PnL não-realizado, auto-repair float sem teto.
- **MÉDIA** — `swap_through_router` real sob `#[cfg(not(test))]` (mesma classe de masking do P0-2); só E2E cobre. ADR pedia trait injetável (não adotado).

## VEREDITO FINAL DE COESÃO DO MODELO HÍBRIDO

**Os protocolos CONVERSAM, mas nem todas as teses se sustentam: 1 VALIDADA, 5 PARCIAIS, 0 refutadas integralmente.**

O modelo híbrido é **coeso no núcleo** — o eixo crítico de custódia (matching off-chain autoritativo → settlement on-chain → finality → gate fail-closed → paridade MCP) está validado e honesto. As rotas existem (0 endpoints fantasma no MCP), as assinaturas batem byte-a-byte entre os 3 clientes, e o gate de assinatura novo é respeitado em toda a cadeia.

As fraturas são reais mas **periféricas ao core de custódia** e concentram-se em DOIS padrões transversais:

1. **Fronteira "off-chain casado → on-chain finalizado" aplicada de forma não-uniforme.** O settlement respeita finality (custody-grade), mas afiliado (comissão pré-settlement sem estorno) e indexador social (sem confirmation depth, sem `@@unique`) agem sobre eventos não-finalizados → comissão/métricas sobre trades que podem reverter, e double-count por reorg/duplicação. É a regra de design central do projeto ("nada que move valor age sobre não-finalizado") não propagada às camadas sociais/de incentivo.

2. **Fragmentação de "tier" e de verificação on-chain.** "Tier de staking" não é fonte única (3 sistemas desconexos), e `verifyStake` credita tier sem provar on-chain. Combinado com double-pay de reward (sem unique constraint) e execução de governança manual, a camada de incentivos tem coesão mais fraca que a de trading.

**Resposta direta:** sim, os protocolos estão conversando (integração estrutural coesa); a tese central do modelo híbrido (roteamento + settlement custody-grade) se sustenta no caminho do usuário; mas as teses das camadas de incentivo (afiliado, staking-tier, reward, copy-vault withdraw) são PARCIAIS — funcionam no caminho feliz e falham fechado, porém têm lacunas de integridade que precisam fechar antes de mainnet.

### Backlog priorizado de coesão (P0/P1 para fechar antes de mainnet)
- **P1** Afiliado: creditar comissão só após settlement FINALIZED + estorno em FAILED; lock/transação no `processPayoutBatch`.
- **P1** Social indexer: `@@unique` em SocialIndexedEvent + upsert (live e backfill) + confirmation depth/finality.
- **P1** Staking: unificar tier numa fonte única; `verifyStake` validar a stake on-chain de fato (ou bloquear até validação); `UserReward` unique + transfer-após-create idempotente.
- **P1** Copy-vault: implementar saque 2-fases (request/claim) do ADR-002; reconciliar contra equity on-chain (não fórmula off-chain); tirar swap real de trás do `#[cfg(not(test))]`.
- **P1** Trade: implementar execução AMM_V1 server-side (ou rotear para 2ª melhor); float→BigInt a montante.
- **P2** Bridge: indexação SubQuery dos eventos Mint/WithdrawRequest + métricas Prometheus de lag.
