# Análise dos 3 sistemas de tier (SUB-ITEM 3 do staking) — 2026-06-12

**Pergunta do handoff**: os 3 sistemas de tier são distintos por design, ou devem ser unificados?

## VEREDITO: distintos por design — manter semânticas separadas, corrigir nomes/copy/docs e 1 inconsistência de threshold

Os três sistemas medem **dimensões econômicas ortogonais** e governam efeitos diferentes. Unificá-los num único mecanismo quebraria o desenho de incentivos (ex.: lock-up longo não deve elevar limite de posição de agente AI; volume alto não deve elevar APY). A fratura apontada no coesao-03 ("não há fonte única de verdade de tier") é real, mas a correção certa é **desambiguar**, não unificar.

| Sistema | Onde | Input (dimensão) | Output | Camada |
|---|---|---|---|---|
| `StakingTier` | `contracts/staking/lib.rs:160` | **duração** do stake (blocos) | APY 8→15% (basis points em constants) | on-chain |
| `TradingTier` | `contracts/rewards/lib.rs:41` | **volume** mensal (10k/50k/200k LUNES) | peso na pool de trading rewards (1.0x→2.0x) | on-chain |
| Agent tier | `spot-api/agentService.ts:20` | **valor stakado** (0/100/1k/10k LUNES) | limites operacionais do agente AI | off-chain (input chain-verified pós-Task-18) |
| (Listing tier) | domínio listing | BASIC/VERIFIED/FEATURED | vitrine de listagem | off-chain — domínio separado, sem colisão semântica, só de vocabulário |

Pós-Task-18 o Agent tier deixou de ser o elo fraco: `verifyStake` é fail-closed, deriva o valor do saldo **on-chain** (plancks→LUNES correto, 8 dec) e rejeita amount forjado. O que resta são problemas de nomenclatura, política e copy.

## Achados

### T1 — Tier 1 de agente (100 LUNES) é INALCANÇÁVEL via stake on-chain (P2, bug de reconciliação)
`contracts/staking/lib.rs:409`: `MIN_STAKE = 1000 LUNES` — o contrato **rejeita** qualquer stake abaixo de 1000. A tabela de agente (`agentService.ts:22`) define tier 1 em `minStake: 100`. Como o tier agora só é creditado com verificação on-chain (Task 18), nenhum agente jamais terá tier 1: stake real ≥ 1000 → cai direto no tier 2. Efeito: a faixa 100–999 LUNES da tabela (e do `docs/API.md` "Staking Tiers") é letra morta e promete um degrau que não existe. **Fix**: alinhar a tabela aos thresholds possíveis on-chain (ex.: 0 / 1.000 / 10.000 / 100.000) ou reduzir MIN_STAKE — decisão de produto.

### T2 — Colisão de nome: "stakingTier" significa duas coisas diferentes (P2)
O campo `Agent.stakingTier` (Prisma, rotas `/agents`, `/permissions`, `tradeApi`, docs) é o tier **de limites de agente** (0–3, por valor), mas o nome colide com o `StakingTier` do contrato (Bronze–Platinum, por duração). `execution.ts:240` já chama de `agentTier` — terceira variação. **Fix**: padronizar `agentTier` na API com janela de deprecação (constraint do projeto: SDK consumers podem existir; expor ambos os campos por 1 ciclo, documentar deprecação de `stakingTier` nas respostas de agente).

### T3 — Copy da página Rewards mistura conceitos (P3)
`lunes-dex-main/src/pages/rewards/index.tsx:64`: o TradingTier Bronze (volume) é descrito como "Starting tier for all stakers". Usuário lê "staker", sistema mede volume. **Fix**: rotular cada tier com sua dimensão ("Trading tier — volume mensal"; "Staking tier — duração"; "Agent tier — valor stakado").

### T4 — docs/API.md intitula a tabela de agente como "Staking Tiers" (P3)
`docs/API.md:649` documenta os limites de agente sob o título "Staking Tiers" — mesmo nome do sistema on-chain de APY. **Fix**: renomear seção para "Agent Trading Tiers" e corrigir a linha do tier 1 conforme T1.

### T5 — Thresholds de agente hardcoded em TS (P3, política)
`STAKING_TIERS` (`agentService.ts:20-40`) é política operacional off-chain — aceitável (não precisa morar on-chain), mas deveria ser configurável (env/DB) e documentada como política, não como espelho do contrato. Hoje, mudar regra exige deploy do spot-api.

### T6 — Tiers por duração assumem block-time fixo de 2s (P3, fragilidade)
`calculate_staking_tier` e `MIN/MAX_DURATION` medem duração em **blocos** com `24*60*30` blocos/dia (~2s/bloco hardcoded em comentário). Se o block-time real da Lunes mainnet divergir (ex.: 6s), todos os prazos reais escalam 3× (Platinum = 543 dias). **Verificar block-time de produção**; considerar migrar para `block_timestamp` (ms) se houver redesign do contrato (conecta com ADR-001/redeploy já planejado).

### Já conhecidos (coesao-03, backlog P1 — não duplicar)
- `dailyTradeLimit` comparado a total vitalício ×365 (`tradeApi.ts:71-79`) — limite "diário" não limita por dia.
- `maxOpenOrders` definido em todos os tiers e nunca enforçado (limite morto).

## Recomendação de execução (quando aprovada)

1. **T1** é o único que mexe em comportamento — decisão de produto (alinhar tabela vs reduzir MIN_STAKE) antes de codar.
2. T2+T4 juntos (rename com deprecação + docs) — escopo pequeno, sem mudança de comportamento.
3. T3 copy fix — trivial, junto com qualquer passada no frontend.
4. T5/T6 — registrar como P3 no backlog; T6 entra na conversa do redeploy de contratos (ADR-001).
