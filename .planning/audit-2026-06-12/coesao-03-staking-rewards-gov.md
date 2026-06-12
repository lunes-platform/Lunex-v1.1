# Coesão 03 — Staking + Rewards + Governança

**Validador**: 3/6 — Lunex DEX
**Data**: 2026-06-12
**Escopo**: Como o staking tier atravessa o sistema (contrato → spot-api → mcp → frontend); distribuição de rewards reais; governança on-chain.

---

## VEREDITO

**TESE: PARCIAL** (validada na espinha dorsal, refutada em pontos críticos de coesão e segurança)

A tese — "staking concede tiers que governam limites, o sistema distribui rewards reais com contabilidade correta, e staking dá poder de governança que executa efeitos on-chain" — é verdadeira em arquitetura mas tem **três fraturas de coesão** que a tornam parcial:

1. **NÃO existe uma fonte única de verdade de "tier"**. Há TRÊS sistemas de tier independentes e desconexos, com semânticas diferentes (duração vs volume vs valor stakado), sem reconciliação.
2. **A ponte "stake on-chain → tier off-chain" não verifica a cadeia**. O spot-api credita tier confiando num txHash que nunca é validado contra o contrato.
3. **A idempotência de rewards é aplicacional (findFirst+create), sem constraint de banco** — janela de corrida e double-pay possível em retry pós-crash.

A governança (voto off-chain assinado + execute_proposal on-chain) é a camada **mais sólida**, mas o caminho de fundos do `execute_proposal` permanece sob `#[cfg(not(test))]` (zero cobertura de teste no movimento real de tesouraria).

---

## TABELA DE HANDOFFS (camada → camada)

| # | Handoff | Origem (file:line) | Destino | Acoplamento | Veredito |
|---|---------|--------------------|---------|-------------|----------|
| H1 | Duração do stake → StakingTier (rewards APY) | `contracts/staking/lib.rs:1948` `calculate_staking_tier` | `:1900` tier_multipliers (APY) + `:2044` multiplier bônus | Interno ao contrato, coeso | OK |
| H2 | Volume mensal → TradingTier (peso de reward) | `contracts/rewards/lib.rs:996` `calculate_tier` | `:1061` `calculate_tier_weight` | Interno ao contrato, coeso | OK |
| H3 | Valor stakado → tier de AGENTE (limites) | `spot-api/services/agentService.ts:42` `resolveTier` | `:304` grava `stakingTier/dailyTradeLimit/...` no Agent | **Tabela própria**, sem relação com H1/H2 | DIVERGE |
| H4 | Stake on-chain → crédito de tier off-chain | `agentService.ts:269` recordStake (PENDING_VERIFICATION) | `:291` `verifyStake` credita tier | **Não consulta a cadeia**; confia em txHash + admin | GAP CRÍTICO |
| H5 | Agente (MCP/API) → enforcement de limite | `routes/tradeApi.ts:21` `agentAuth(['TRADE_SPOT'])` | `:54` `validateTradeLimits` (linhas 154, 252) | Server-side real, não só frontend | OK (parcial) |
| H6 | Cálculo de reward → payout on-chain | `rewardDistributionService.ts:891` transferNative | `rewardPayoutService.ts:405` `transferNative`→`waitForFinalizedTx` | Acoplado, com isFinalized | OK |
| H7 | Idempotência de reward (não pagar 2x) | `rewardDistributionService.ts:869/989` findFirst | `:911/1030` create | **Sem unique constraint no DB** | GAP |
| H8 | Voto off-chain (assinado) → registro | `routes/governance.ts:121` POST vote + verifyWalletActionSignature | `:156` `governanceVote.create` (unique walletAddress+proposalId+voteType) | Assinatura verificada, unique OK | OK |
| H9 | Voto/aprovação → efeito on-chain (tesouraria) | `contracts/staking/lib.rs:1077` `execute_proposal` | `:1137` `#[cfg(not(test))]` transfer refund/treasury | On-chain real, mas **0 cobertura de teste no path de fundos** | GAP |
| H10 | Spot-api ↔ execute_proposal | (inexistente) | — | spot-api só **registra** votos; nunca chama execute_proposal | GAP |

---

## ANÁLISE POR PERGUNTA

### 1. "Staking tier" é fonte única de verdade? — **NÃO. Três sistemas paralelos.**

Existem **três conceitos de tier completamente independentes**, sem nenhuma reconciliação:

| Sistema | Onde | Base do tier | Tiers | Governa |
|---------|------|--------------|-------|---------|
| `StakingTier` | `contracts/staking/lib.rs:160` | **duração** do stake | Bronze/Silver/Gold/Platinum | APY de staking rewards (8–15%) |
| `TradingTier` | `contracts/rewards/lib.rs:41` | **volume** mensal | Bronze/Silver/Gold/Platinum | peso na pool de trading rewards |
| Agent tier | `spot-api/services/agentService.ts:20` `STAKING_TIERS` | **valor LUNES stakado** (0/100/1k/10k) | 0–3 | limites de trading do agente AI |

Os três usam nomes/níveis parecidos ("tier 0-3", "Bronze..Platinum") mas medem coisas diferentes e **nunca se consultam**. O Agent tier (off-chain, valor-baseado) é o que governa os limites de IA, e ele é calculado por `resolveTier` numa tabela hardcoded no TypeScript (`agentService.ts:20-40`) — totalmente desacoplado dos thresholds on-chain do contrato de staking. Risco de divergência: mudar a regra de tier no contrato não propaga para os limites de agente, e vice-versa.

### 2. rewardDistribution → rewardPayout: acoplamento e idempotência — **Acoplado, mas idempotência frágil.**

- **Cálculo → chain bem acoplado**: `rewardDistributionService.ts:891/1015` chama `rewardPayoutService.transferNative`, que em `rewardPayoutService.ts:405-446` usa `waitForFinalizedTx` (espera finalização real, não só inclusão). `isFinalized` efetivamente coberto via `waitForFinalizedTx` (`utils/finalizedTx`).
- **Idempotência por-destinatário existe** (`:869` leader, `:989` trader): faz `findFirst` por `(rewardWeekId, walletAddress, rewardType)` e pula se já existe. Week-level também protegido (`:597` `status === 'DISTRIBUTED'` → ALREADY_DISTRIBUTED, e `:614` LOCK_HELD).
- **GAP**: `UserReward` (schema.prisma:1238) **não tem unique constraint** em `(rewardWeekId, walletAddress, rewardType)` — só `@@index`. A garantia é puramente aplicacional (read-then-write). Sob concorrência (duas execuções do scheduler, ou retry) há janela de corrida.
- **GAP de ordering (double-pay em crash)**: o fluxo é `transferNative` (linha 891) **e depois** `userReward.create` (linha 911). Se o processo crashar **entre** o transfer confirmado e o create, o registro de idempotência nunca é gravado → o próximo run não encontra `existing` → **paga de novo**. O comentário em `tradeSettlementService.ts:170` reconhece esse padrão noutro contexto. Aqui o reward não tem o mesmo nível de proteção.
- **Pode ser calculado e nunca pago**: sim, por design quando `rewardPayoutService.isEnabled()` é false (`:725/890/983/1010`) — grava `payoutStatus: PENDING`, txHash null. Há `retryFailedPayouts` (`:1277`) para FAILED, mas **não** há retry para PENDING que nunca chegou a tentar (ex.: payout desabilitado e depois nunca reprocessado). Staker pool é "on-chain claim mode" (`:1049 recordStakerFunding`) — fundos vão pro contrato, usuários reclamam direto; per-user nunca materializado no DB (assimetria intencional, mas significa que a contabilidade de staker rewards vive só on-chain).

### 3. Governança off-chain ↔ on-chain — **Concordam parcialmente; há gap de execução.**

- Off-chain (`routes/governance.ts`): registra votos com assinatura verificada (`verifyWalletActionSignature`, `:122`), unique `(walletAddress, proposalId, voteType)` (schema:1192), rate-limit por janela (`:139-148`). É puramente **tracking** — o cabeçalho do arquivo declara "The smart contract handles on-chain enforcement" (`:4`).
- On-chain (`contracts/staking/lib.rs:968 vote`, `:1077 execute_proposal`): voting power = stake, aprovação por `MIN_VOTES_FOR_APPROVAL` (10.000), timelock de 48h (`:1094`), e movimento de fundos.
- **Concordam sobre quem pode executar?** `execute_proposal` é **permissionless** (qualquer um pode chamar pós-timelock; sem checagem de owner/voter), o que é aceitável dado que os efeitos são determinados pelo estado de votação. Off-chain não tem conceito de "executor".
- **GAP H10**: o spot-api **nunca chama `execute_proposal`**. Não há serviço/rota que faça a ponte voto-registrado → execução on-chain. O grep por `executeProposal/execute_proposal` no spot-api não retorna nenhuma chamada. Logo, entre "voto registrado off-chain" e "efeito executado on-chain" existe um **gap operacional manual** — alguém precisa chamar o contrato fora do sistema. O off-chain pode mostrar um voto/aprovação que o on-chain nunca executou (ou divergir se a contagem on-chain difere da off-chain, já que são fontes separadas de contagem de votos).

### 4. `execute_proposal` sob `#[cfg(not(test))]` — **Path de fundos NÃO tem cobertura; lógica melhorou.**

- A **estrutura** está correta e segue Effects-before-Interactions: marca `executed=true/active=false` e seta `fee_refunded=true` **antes** do transfer (`:1114-1125`), com rollback de `fee_refunded` em falha de transfer (`:1158/1166`). Idempotência: `:1085` rejeita proposta já executada. Isso previne double-execute e double-refund **na lógica**.
- **GAP confirmado**: todo o movimento real de fundos (`:1137 #[cfg(not(test))]`: refund ao proposer, split 10% staking pool / 90% treasury) é **excluído da compilação de teste**. Sob `#[cfg(test)]` (`:1176`) só a contabilidade do `trading_rewards_pool` roda. Ou seja: **os transfers de tesouraria têm zero cobertura de teste unitário**; só "integration tests on testnet" (comentário `:1135`) — que não estão neste path. O caminho de fundos é confiável *por leitura de código*, não *por teste*.
- `isFinalized` no payout: aplicável ao spot-api (`waitForFinalizedTx`), não ao contrato. Coberto no lado off-chain (H6).

### 5. Agentes AI (MCP) respeitam limites de tier? — **Sim, server-side. Mas o MCP NÃO faz staking, e o enforcement tem bugs.**

- **O MCP explicitamente NÃO suporta staking**: `mcp/lunex-agent-mcp/src/index.ts:17` e `:102` (`unsupportedScopes = ['amm', 'staking', 'farming']`). A "tool staking" da tese **não existe**. O MCP faz apenas spot trading agent-autenticado, roteando para o spot-api com `LUNEX_AGENT_API_KEY` (`index.ts:128`).
- **Enforcement é real e server-side, não frontend**: `routes/tradeApi.ts:21` aplica `agentAuth(['TRADE_SPOT'])` a TODAS as rotas; `validateTradeLimits` (`:54`) roda antes de cada ordem (`:154, :252`). O `req.agent` vem do `agentApiKey` verificado (`agentAuth.ts:37/63`), então um agente via MCP **não consegue contornar** `maxPositionSize`. Gating NÃO é cosmético.
- **BUG de enforcement (dailyTradeLimit)**: `tradeApi.ts:71-79` compara o **total de trades vitalício** (`totalTrades`) contra `dailyTradeLimit * 365`. Comentário admite "sliding window on hold". Efeito: o limite "diário" é na prática um teto **vitalício ~365x mais frouxo** — não limita por dia de forma nenhuma.
- **`maxOpenOrders` nunca é enforçado**: definido em todos os tiers (`agentService.ts:21-38`) e exposto em `/permissions`, mas **nenhum call-site** o verifica. Limite morto.

---

## LACUNAS (priorizadas)

| Sev | Lacuna | Local |
|-----|--------|-------|
| ALTA | `verifyStake` credita tier sem consultar a cadeia; confia em txHash não-verificado e no `amount` enviado pelo usuário (não no valor on-chain) | `agentService.ts:291-323` |
| ALTA | Double-pay de reward possível: transfer antes do create de idempotência, sem unique constraint no DB | `rewardDistributionService.ts:891→911`, `schema.prisma:1238` |
| ALTA | Caminho de fundos de `execute_proposal` (refund/treasury) sem cobertura de teste (`#[cfg(not(test))]`) | `staking/lib.rs:1137-1172` |
| MÉDIA | Três sistemas de tier independentes sem reconciliação (duração/volume/valor) | `staking:160`, `rewards:41`, `agentService.ts:20` |
| MÉDIA | Gap H10: spot-api nunca chama `execute_proposal`; ponte voto→execução é manual/externa | `routes/governance.ts` (ausência) |
| MÉDIA | `dailyTradeLimit` efetivamente não limita por dia (usa total vitalício × 365) | `tradeApi.ts:71-79` |
| BAIXA | `maxOpenOrders` definido mas nunca enforçado | `agentService.ts` (sem call-site) |
| BAIXA | Staker rewards nunca materializados no DB (claim só on-chain) — contabilidade off-chain incompleta por design | `rewardDistributionService.ts:1049` |
