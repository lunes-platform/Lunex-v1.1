# Spec T04 — Handlers de Processo Críticos (unhandledRejection + uncaughtException)

**Fase:** 2 — Estabilidade do Processo  
**Esforço:** XS (~30min)  
**Prioridade:** BLOQUEADOR

---

## Problema

`spot-api/src/index.ts` não tem handlers para erros não capturados. Node.js v15+ faz crash silencioso em `unhandledRejection`. Schedulers como `rewardScheduler`, `copytradeWalletContinuationScheduler` e `socialAnalyticsPipeline` usam `setInterval` com async callbacks — qualquer rejeição não tratada derruba o processo sem log estruturado.

---

## Mudança Necessária

### `spot-api/src/index.ts`

Adicionar **antes** da chamada `main()`:

```ts
process.on('unhandledRejection', (reason: unknown) => {
  log.fatal({ err: reason }, 'Unhandled promise rejection — shutting down')
  process.exit(1)
})

process.on('uncaughtException', (err: Error) => {
  log.fatal({ err }, 'Uncaught exception — shutting down')
  process.exit(1)
})
```

Onde `log` é o logger estruturado já existente no projeto (pino ou winston — verificar o import existente).

---

## Critérios de Aceitação

- [ ] `grep "unhandledRejection" spot-api/src/index.ts` retorna match
- [ ] `grep "uncaughtException" spot-api/src/index.ts` retorna match
- [ ] Ambos os handlers estão ANTES da chamada `main()`
- [ ] Ambos usam `log.fatal` (não `console.error`) para log estruturado
- [ ] Ambos chamam `process.exit(1)` após o log

---

## Verificação

```bash
# Verificar presença dos handlers
grep -n "unhandledRejection\|uncaughtException" spot-api/src/index.ts
```

Testar manualmente (ambiente de desenvolvimento):
```ts
// Adicionar temporariamente no código
setTimeout(() => { Promise.reject(new Error('test unhandled')) }, 100)
```
→ Processo deve logar `FATAL: Unhandled promise rejection` e sair com código 1.
