# Spec T10 — Corrigir Race Condition em liquidatePosition

**Fase:** 3 — Integridade de Dados  
**Esforço:** M (~4h)  
**Prioridade:** BLOQUEADOR

---

## Problema

`spot-api/src/services/marginService.ts:1062` — `liquidatePosition`:

O PostgreSQL padrão usa `READ COMMITTED`. Dois workers podem simultaneamente:
1. Ler `position.status === 'OPEN'`
2. Ambos passarem no check `isLiquidatable`
3. Ambos commitarem → dois registros de `marginLiquidation` + `collateralLocked` decrementado duas vezes (negativo)

---

## Solução: Check-and-Set Atômico

Usar `updateMany` como operação atômica de "claim" da posição antes de qualquer processamento:

```ts
async liquidatePosition(positionId: string, markPrice: number): Promise<void> {
  // 1. Atomic claim — apenas um worker ganha essa posição
  const claimed = await prisma.marginPosition.updateMany({
    where: {
      id: positionId,
      status: 'OPEN',  // Só atualiza se ainda OPEN
    },
    data: { status: 'LIQUIDATING' }
  })

  // Se count === 0, outra instância já iniciou a liquidação
  if (claimed.count === 0) {
    log.info({ positionId }, 'Position already being liquidated — skipping')
    return
  }

  try {
    // 2. A partir daqui, somos os únicos processando essa posição
    await prisma.$transaction(async (tx) => {
      const position = await tx.marginPosition.findUniqueOrThrow({
        where: { id: positionId }
      })

      // Verificação dupla dentro da tx (status já é LIQUIDATING, garantido pelo updateMany)
      const isStillLiquidatable = await this.isLiquidatable(position, markPrice)
      if (!isStillLiquidatable) {
        // Mark price mudou — restaurar para OPEN
        await tx.marginPosition.update({
          where: { id: positionId },
          data: { status: 'OPEN' }
        })
        return
      }

      // 3. Executar liquidação
      const pnl = this.calculatePnL(position, markPrice)
      await tx.marginPosition.update({
        where: { id: positionId },
        data: {
          status: 'LIQUIDATED',
          closedAt: new Date(),
          closingPrice: markPrice,
          realizedPnl: pnl,
        }
      })

      await tx.marginLiquidation.create({
        data: {
          positionId,
          markPrice,
          pnl,
          liquidatedAt: new Date(),
        }
      })

      // 4. Liberar collateral (nunca pode ficar negativo)
      await tx.walletMarginAccount.update({
        where: { walletAddress: position.walletAddress },
        data: {
          collateralLocked: {
            decrement: position.collateral  // Prisma valida que não fica negativo
          }
        }
      })
    })

  } catch (error) {
    // Se a transação falhar, restaurar LIQUIDATING → OPEN para retry
    await prisma.marginPosition.updateMany({
      where: { id: positionId, status: 'LIQUIDATING' },
      data: { status: 'OPEN' }
    })
    throw error
  }
}
```

---

## Critérios de Aceitação

- [ ] `updateMany({ where: { id, status: 'OPEN' } })` como primeiro passo atômico
- [ ] Se `count === 0` → log + return sem erro
- [ ] Dentro da tx: verificação dupla de liquidabilidade com mark price atual
- [ ] `collateralLocked` nunca fica negativo
- [ ] Em falha da tx: `LIQUIDATING` restaurado para `OPEN`
- [ ] Nunca existem dois `marginLiquidation` para o mesmo `positionId`

---

## Verificação

```ts
// Teste de concorrência
const results = await Promise.all([
  liquidatePosition('pos-123', 1500),
  liquidatePosition('pos-123', 1500),
  liquidatePosition('pos-123', 1500),
])

const liquidations = await prisma.marginLiquidation.count({
  where: { positionId: 'pos-123' }
})
expect(liquidations).toBe(1) // Apenas uma liquidação
```

```bash
npm test -- --grep "liquidatePosition concurrent"
```
