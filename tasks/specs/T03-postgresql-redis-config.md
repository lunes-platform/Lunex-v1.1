# Spec T03 — Corrigir Configuração Crítica PostgreSQL e Redis

**Fase:** 1 — Emergência de Segurança  
**Esforço:** XS (~30min)  
**Prioridade:** BLOQUEADOR CRÍTICO

---

## Problema

### PostgreSQL — `synchronous_commit=off`
`docker/docker-compose.prod.yml:21`:
```yaml
- "synchronous_commit=off"
```
Em crash do servidor, transações confirmadas ao cliente podem **não ter sido gravadas em disco**. Para um DEX financeiro (ordens, trades, liquidações), isso significa perda de dados real.

### Redis — persistência desabilitada
```yaml
command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save ""
```
Redis armazena nonces de transações e locks do matching engine. `--save ""` desabilita toda persistência. Restart = perda de todos os nonces ativos → replay de transações possível.

---

## Mudanças Necessárias

### `docker/docker-compose.prod.yml`

**PostgreSQL:**
```diff
  postgres:
    command: postgres
      -c max_connections=100
      -c shared_buffers=256MB
-     -c synchronous_commit=off
      -c effective_cache_size=1GB
```

**Redis:**
```diff
  redis:
    command: redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
-     --save ""
+     --appendonly yes
+     --appendfsync everysec
+     --auto-aof-rewrite-percentage 100
+     --auto-aof-rewrite-min-size 64mb
```

---

## Critérios de Aceitação

- [ ] `grep "synchronous_commit" docker/docker-compose.prod.yml` — zero resultados
- [ ] `grep -- "--save" docker/docker-compose.prod.yml` — zero resultados (ou sem `--save ""`)
- [ ] `grep "appendonly yes" docker/docker-compose.prod.yml` — retorna match
- [ ] `grep "appendfsync" docker/docker-compose.prod.yml` — retorna `everysec`

---

## Verificação

```bash
# Verificar PostgreSQL config
grep -A5 "postgres:" docker/docker-compose.prod.yml | grep "synchronous_commit"
# Esperado: zero output

# Verificar Redis config
grep "redis-server" docker/docker-compose.prod.yml
# Esperado: sem --save "", com --appendonly yes
```

---

## Impacto na Performance

- **PostgreSQL**: `synchronous_commit=on` (padrão) adiciona ~1-5ms de latência por commit. Aceitável para um DEX financeiro.
- **Redis AOF com `everysec`**: máximo 1 segundo de dados perdidos em crash. Latência de write marginal (~0.1ms).

---

## Notas

Volume `redisdata` já está configurado no compose — os arquivos AOF serão persistidos nesse volume.
