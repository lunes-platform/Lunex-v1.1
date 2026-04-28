# Spec T05 — Corrigir Production Guards (rewardSplitValid + NODE_ENV)

**Fase:** 2 — Estabilidade do Processo  
**Esforço:** S (~1h)  
**Prioridade:** BLOQUEADOR

---

## Problema

`spot-api/src/utils/productionGuards.ts` não valida dois cenários críticos:

1. **`rewardSplitValid`**: `config.ts` calcula `rewardSplitValid = (leaderPoolPct + traderPoolPct + stakerPoolPct) === 100`, mas o guard nunca verifica isso. O servidor sobe e distribui percentuais errados silenciosamente.

2. **`NODE_ENV`**: O matching engine usa lock distribuído (Redis) apenas quando `NODE_ENV === 'production'`. Se deploy não setar `NODE_ENV`, todas as instâncias usam lock em memória — sem proteção distribuída em escala horizontal.

---

## Mudanças Necessárias

### `spot-api/src/utils/productionGuards.ts`

Adicionar no array `collectProductionConfigErrors` (ou equivalente):

```ts
// Validação do split de rewards
if (!config.rewards.rewardSplitValid) {
  const { leaderPoolPct, traderPoolPct, stakerPoolPct } = config.rewards
  const total = leaderPoolPct + traderPoolPct + stakerPoolPct
  errors.push(
    `REWARD_SPLIT percentages must sum to 100, got ${total} ` +
    `(leader=${leaderPoolPct}%, trader=${traderPoolPct}%, staker=${stakerPoolPct}%)`
  )
}

// Validação de NODE_ENV explícito
if (process.env.NODE_ENV !== 'production') {
  errors.push(
    `NODE_ENV must be explicitly set to "production", got "${process.env.NODE_ENV}". ` +
    `Without this, distributed matching locks are disabled.`
  )
}
```

---

## Critérios de Aceitação

- [ ] Servidor não sobe com `leaderPoolPct + traderPoolPct + stakerPoolPct !== 100`
- [ ] Servidor não sobe sem `NODE_ENV=production` no ambiente de produção
- [ ] Mensagem de erro lista os percentuais específicos e a soma atual
- [ ] Mensagem de erro explica a consequência de NODE_ENV incorreto
- [ ] Guards existentes continuam funcionando (não quebrar validações existentes)

---

## Verificação

```bash
# Testar split inválido
LEADER_POOL_PCT=40 TRADER_POOL_PCT=40 STAKER_POOL_PCT=40 NODE_ENV=production \
  node dist/index.js
# Esperado: exit 1 + "REWARD_SPLIT percentages must sum to 100, got 120"

# Testar NODE_ENV ausente
NODE_ENV=development node dist/index.js
# Esperado: exit 1 + mensagem sobre NODE_ENV

# Testar configuração válida
LEADER_POOL_PCT=40 TRADER_POOL_PCT=40 STAKER_POOL_PCT=20 NODE_ENV=production \
  node dist/index.js
# Esperado: servidor sobe normalmente
```
