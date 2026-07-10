# Adendo ao Consolidado — Achados de auditoria emergidos da varredura de limpeza (2026-06-12)

Durante a análise de qualidade de código (8 avaliadores, relatórios em `.planning/cleanup-2026-06-12/`), surgiram achados que são de **auditoria de produção**, não apenas limpeza. Devem ser tratados junto com os P1 do consolidado:

## Novos achados (severidade sugerida)

1. **P1 — Copy-trade sem proteção de slippage** — `spot-api/src/services/copytradeService.ts:508`: intent montado com `minAmountOut ?? 0`. Seguidores ficam expostos a sandwich/MEV. Fix: derivar minAmountOut do slippage configurado do seguidor; rejeitar intent sem limite.
2. **P1 — Preço de execução fabricado** — `copytradeService.ts:1253`: `executionPrice` calculado de `amountIn/amountOutMin` e gravado como preço real; PnL e performance fee são cobrados sobre número inventado. Fix: usar preço efetivo do settlement finalizado.
3. **P1 — Falhas do bridge invisíveis** — `spot-api/src/services/assetBridgeService.ts:273,366,391`: mint/withdrawal falhando só com `console.error` (fora do pino → fora de Loki/alertas) e saldo caindo para `BN(0)` silenciosamente. Fix: logger estruturado + métrica + alerta.
4. **P2 — Monitor de segurança fictício** — `scripts/security/sentinel_bot.ts:38-44`: corpo do detector de swaps suspeitos é pseudo-código comentado; só reporta `ExtrinsicFailed`. Se a operação assume essa cobertura, ela não existe. Fix: implementar ou remover da documentação de segurança.
5. **P2 — Métricas de trader sempre zero** — `lunes-dex-main/src/pages/.../agentService.ts:66-68`: UI exibe `roi/sharpe/maxDrawdown` com `?? 0` sobre campos que a API não retorna — dado financeiro falso por via lateral (tema recorrente). Fix: ou a API passa a retornar, ou a UI exibe "—".
6. **P2 — `decimals ?? 12` fabrica metadados de token** — `lunes-dex-main/src/services/contractService.ts:331` (já apontado pelo Especialista 4; confirmado pela varredura defensiva como padrão sistêmico: balance/allowance/parse retornando `'0'` em erro em `contractService.ts:214,260,293` e `SDKContext.tsx:902,925,941`).
7. **P3 — Evento `TradeExecuted` sem execução** — `Lunex/contracts/copy_vault/lib.rs:749-752`: `execute_trade` emite evento mas só registra intenção ("For now we track the intent"); indexers/UI podem interpretar intenção como execução. Relacionado ao P0-2 do consolidado (copy_vault). Fix: renomear evento (TradeIntended) ou ligar ao caminho real.

## Drifts estruturais confirmados (alimentam Fases 3 e 6 do roadmap)
- 16 tipos duplicados à mão entre `lunes-dex-main` e `sdk` com drift ativo (`AgentProfile`, `SpotOrder`, `SpotPair`...); `lunes-dex-main/src/sdk/AsymmetricClient.ts` é fork desatualizado do SDK (falta `simulateLiquidity`); `CurveParameters` significa coisas diferentes em cada lado.
- Builders de mensagem de assinatura duplicados em 3 pacotes (dex, sdk, mcp) com drift leve — recomendado teste golden de paridade imediato.
- Triplicação de specs de API (`docs/API.md`, `API_SPECIFICATION.md`, `PUBLIC_API_SPECIFICATION.md`) com referências cruzadas inconsistentes (~14 a corrigir).
- Gate de dead code do DEX (`check-ts-prune.cjs`) com filtros em bloco que escondem ~580 LOC mortas.

## Limpezas já aplicadas nesta sessão (working tree, sem commits)
- 4 ciclos de import resolvidos com `import type` (lunes-dex-main/components) — tsc verde.
- 5 scripts `test*.js` de debug removidos (lunes-dex-main raiz).
- `.gitignore`: padrão `.env.backup*` adicionado.
- `spot-api/scripts/deploy-tokens.ts`: guarda resiliente para ABI sem `balanceOf` (destravou setup E2E local).
- Fase B em andamento (3 agentes): dedupe de signing/headers no DEX, remoção de ~115 `any` ALTA no spot-api, generics do sdk, dead code ALTA (~580 LOC).
