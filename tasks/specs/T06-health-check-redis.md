# Spec T06 — Corrigir Health Check (Redis como Crítico)

**Fase:** 2 — Estabilidade do Processo  
**Esforço:** XS (~15min)  
**Prioridade:** ALTA

---

## Problema

`spot-api/src/index.ts` — endpoint `/health`:
```ts
const overallOk = dbOk  // Redis ignorado!
```

O health check retorna HTTP 200 mesmo com Redis offline. O load balancer mantém o pod em rotation. Porém sem Redis:
- `matchingLockService` lança exceção (sem distributed lock)
- Replay protection de nonces cai
- Cache do orderbook falha

→ Ordens processadas sem locking distribuído = race conditions e possível double-match.

---

## Mudança Necessária

### `spot-api/src/index.ts`

```diff
- const overallOk = dbOk
+ const overallOk = dbOk && redisOk
```

Adicionar `redis` ao response body:
```diff
  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    database: dbOk ? 'ok' : 'error',
+   redis: redisOk ? 'ok' : 'error',
    timestamp: new Date().toISOString()
  })
```

---

## Critérios de Aceitação

- [ ] Redis offline → `/health` retorna HTTP 503
- [ ] Response JSON inclui campo `redis` com status
- [ ] DB offline → `/health` retorna HTTP 503 (comportamento existente mantido)
- [ ] Ambos online → HTTP 200

---

## Verificação

```bash
# Redis online, DB online
curl http://localhost:4000/health
# Esperado: {"status":"ok","database":"ok","redis":"ok",...} 200

# Parar Redis
docker stop lunex-redis
curl http://localhost:4000/health
# Esperado: {"status":"degraded","database":"ok","redis":"error",...} 503
```
