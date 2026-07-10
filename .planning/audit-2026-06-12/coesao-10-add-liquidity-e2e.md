# Add Liquidity E2E com carteira real pela UI (2026-06-12, sessão noturna)

## ✅ ADD LIQUIDITY 100% VALIDADO END-TO-END PELA UI

Operação real executada pela interface (`/pool`) com a carteira `5HYVGH...FfBb`, assinada na extensão Lunes Wallet e confirmada por delta on-chain em **quatro** medições independentes:

| Verificação | Antes | Depois | Δ |
|---|---|---|---|
| Reserva WLUNES do par (on-chain) | 75,79233508 | 76,79233508 | **+1,00000000** (exato) |
| Reserva LUSDT do par (on-chain) | 80.596,953876 | 81.660,345758 | **+1.063,391882** (exato = quote) |
| Saldo WLUNES da conta (UI fresca) | 10 | 9 | −1,0 ✓ |
| Saldo LUSDT da conta (UI fresca) | 5.000 | 3.936,608118 | −1.063,391882 ✓ |
| LP tokens da conta | 0 | **3,25611619** | mintados ✓ |
| Pool Share | 0,00% | 1,30% | ✓ |
| LUNES nativo | 100,0000 | 99,9926 | fees de gás ✓ |

Fluxo exercitado: seleção de tokens → auto-quote (1 WLUNES → 1.063,391882 LUSDT) → Add Liquidity → allowance check → approve(s) → dry-run do router → `add_liquidity` assinado → tx incluída → alert "Liquidity added successfully!" → LP balance e pool share atualizados.

Ferramenta de verificação criada: `spot-api/scripts/query-pair-reserves.ts` (consulta read-only de reservas + ordem de tokens do par, com ajuste de decimais).

## Resolução da suspeita da sessão anterior (obs "1 WLUNES auto-quota 1063,39 — possível bug")

A interpretação estava **invertida**: o auto-quote (1.063,39 LUSDT/WLUNES) é **correto**; o bug é no display "Price".

Prova on-chain: reservas 75,79 WLUNES ↔ 80.596,95 LUSDT → ratio humano (com decimais WLUNES=8, LUSDT=6) = **1.063,3918824**; ratio raw (sem decimais) = 10,6339188. O display "Price" da página Pool exibe o ratio **raw** — errado por fator 100 = 10^(8−6).

## Bugs encontrados

### B4 — Display "Price" da página Pool ignora decimais dos tokens (P2)
`1 WLUNES = 10.633919 LUSDT` exibido quando o preço real é 1.063,39. Mesmo padrão de causa do B2 (price impact do swap, coesao-09): cálculo sobre reservas raw sem normalizar `10^(decimalsA−decimalsB)`. Em par com decimais iguais o bug fica invisível — por isso passou. Corrigir junto com B2 num único helper de normalização de reservas.

### B5 — Saldos de token ficam stale após add liquidity (P3)
Pós-transação, `refreshPoolInfo()` atualiza LP balance e pool share, mas os saldos de WLUNES/LUSDT continuam exibindo os valores pré-tx (10/5.000 em vez de 9/3.936,61). Só atualizam ao re-selecionar o token ou recarregar. Fix: incluir refresh de balances no pós-sucesso de `addLiquidity`/`removeLiquidity`.

### B6 — Float math no valor do input (reforço do P1 float→BigInt)
O campo Token B carrega `value="1063.391845703125"` — artefato de precisão float visível no DOM. Instância concreta do P1 já mapeado (float→BigInt na camada de quote).

### B7 — Allowance check + approve duplicados em duas camadas (P3, code smell)
`SDKContext.addLiquidity` (linhas ~547-573) faz getAllowance+approve de A e B, e `contractService.addLiquidity` (linhas ~813-832) repete exatamente a mesma checagem. Custo: 2× queries de allowance por operação e lógica de approve em dois lugares para manter. Consolidar no contractService.

## Achado de produção (backend, encontrado ao subir o stack)

### P1 — Boot do spot-api bloqueia indefinidamente no primeiro run do social analytics
`spot-api/src/index.ts:421` faz `await socialAnalyticsPipeline.start()`, que executa `runOnce()` completo (sync do indexer desde `SOCIAL_ANALYTICS_START_BLOCK=0`) **antes** de `app.listen()`. Com o node dev acumulando ~21h de blocos, o processo ficou 24 min sem bindar a porta, sem log e sem erro. Em produção isso é risco de liveness (deploy nunca fica healthy; restart loop no orchestrator). Fix sugerido: subir o HTTP server antes do primeiro sync, ou tornar o primeiro `runOnce()` fire-and-forget com timeout. Workaround local aplicado: `SOCIAL_ANALYTICS_ENABLED=false` no `.env` (não rastreado).

## Notas operacionais

- Reload da página não persiste conexão da wallet (coerente com postura no-auto-signing; reconectar é 1 clique).
- A extensão auto-assinou as 3 transações dentro da janela "extend period" — mesma mecânica do swap E2E (coesao-09).
- lunex-admin dev (`next dev`) tenta porta 3000, encontra ocupada e cai na 3001 — funciona, mas é por acaso; fixar `--port 3001` no script `dev` do lunex-admin.

## Veredito

O fluxo Add Liquidity está **funcional e integrado end-to-end** (UI → extensão → router → pair → LP mint). Os bugs são de camada de apresentação (B4/B5/B6) e higiene de código (B7) — nenhum bloqueia a operação. Prioridade 1 do handoff de 2026-06-12: **concluída**.
