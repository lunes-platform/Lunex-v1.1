# Spec T09 — rewardDistributionService: $transaction + Idempotência + Redis Lock

**Fase:** 3 — Integridade de Dados  
**Esforço:** L (~8h)  
**Prioridade:** BLOQUEADOR

---

## Problema

`spot-api/src/services/rewardDistributionService.ts:535` — `runWeeklyDistribution`:

1. **Sem transação DB**: 15+ writes sequenciais sem `prisma.$transaction`. Crash parcial → semana marcada como DISTRIBUTED mas rewards individuais ausentes.
2. **Sem idempotência**: Retry reexecuta tudo, podendo pagar duplo.
3. **Sem Redis lock**: Duas instâncias simultâneas podem executar a mesma distribuição.
4. **On-chain call misturada com DB writes**: Call on-chain enviada no meio do fluxo — se DB falha depois, estado off-chain ≠ on-chain.

---

## Arquitetura da Solução

```
1. Adquirir Redis lock (TTL 10min) → falhar se não conseguir
2. Verificar idempotência: rewardWeek.txHash já existe? → pular
3. prisma.$transaction {
     a. Calcular todos os valores (sem side effects)
     b. rewardWeek.update({ status: 'PROCESSING' })
     c. Criar todos os userReward records
     d. rewardWeek.update({ status: 'PENDING_ON_CHAIN' })
   }
4. Executar on-chain call (fora da tx)
5. prisma.$transaction {
     a. rewardWeek.update({ status: 'DISTRIBUTED', txHash })
   }
6. Liberar Redis lock
```

---

## Mudanças Necessárias

### `spot-api/src/services/rewardDistributionService.ts`

```ts
async runWeeklyDistribution(weekId: string): Promise<void> {
  const lockKey = `reward-distribution-lock:${weekId}`
  const lockTTL = 10 * 60 // 10 minutos

  // 1. Adquirir lock distribuído
  const lockAcquired = await redis.set(lockKey, '1', 'EX', lockTTL, 'NX')
  if (!lockAcquired) {
    log.warn({ weekId }, 'Distribution already in progress — skipping')
    return
  }

  try {
    // 2. Verificar idempotência
    const week = await prisma.rewardWeek.findUnique({ where: { id: weekId } })
    if (!week) throw new Error(`Week ${weekId} not found`)
    if (week.status === 'DISTRIBUTED') {
      log.info({ weekId }, 'Week already distributed — skipping')
      return
    }
    if (week.txHash) {
      log.warn({ weekId, txHash: week.txHash }, 'Week has txHash but not DISTRIBUTED — checking on-chain')
      // Verificar confirmação on-chain e atualizar status
      await this.finalizeDistribution(week)
      return
    }

    // 3. Calcular todos os valores ANTES da transação (sem side effects)
    const distributionPlan = await this.calculateDistributionPlan(weekId)

    // 4. DB transaction — apenas writes, sem calls externas
    await prisma.$transaction(async (tx) => {
      await tx.rewardWeek.update({
        where: { id: weekId },
        data: { status: 'PROCESSING' }
      })

      // Criar todos os userReward records
      await tx.userReward.createMany({
        data: distributionPlan.userRewards,
        skipDuplicates: true,
      })

      await tx.rewardWeek.update({
        where: { id: weekId },
        data: { status: 'PENDING_ON_CHAIN' }
      })
    })

    // 5. On-chain call (fora da transação)
    const txHash = await rewardPayoutService.fundStakingRewards(distributionPlan)

    // 6. Confirmar distribuição
    await prisma.rewardWeek.update({
      where: { id: weekId },
      data: { status: 'DISTRIBUTED', txHash }
    })

  } finally {
    // 7. Sempre liberar o lock
    await redis.del(lockKey)
  }
}
```

---

## Critérios de Aceitação

- [ ] `runWeeklyDistribution` adquire Redis lock com TTL 10min antes de qualquer operação
- [ ] Se lock não adquirido → log + return (sem erro)
- [ ] Se `rewardWeek.txHash` já existe → verificar on-chain e finalizar (sem re-executar)
- [ ] Todos os `userReward.create` dentro de `prisma.$transaction`
- [ ] On-chain call fora da transação, após tx confirmar
- [ ] `txHash` salvo apenas após on-chain confirmar
- [ ] Lock sempre liberado no `finally`
- [ ] Crash no passo 4 (on-chain) → status `PENDING_ON_CHAIN` → retry verifica txHash

---

## Verificação

```bash
# Testes unitários
npm test -- --grep "rewardDistribution"

# Teste de idempotência: chamar duas vezes com mesmo weekId
# Esperado: segunda chamada retorna imediatamente (lock ou txHash existente)

# Simular crash: interromper depois da tx DB mas antes do on-chain
# Esperado: retry verifica status PENDING_ON_CHAIN e finaliza
```
