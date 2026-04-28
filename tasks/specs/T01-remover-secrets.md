# Spec T01 — Remover Secrets Comprometidos do Repositório

**Fase:** 1 — Emergência de Segurança  
**Esforço:** XS (~2h)  
**Prioridade:** BLOQUEADOR CRÍTICO

---

## Problema

Três exposições de segurança críticas no repositório:

1. `docker/.env.docker:24` — `RELAYER_SEED=//Alice` (chave dev pública do Substrate)
2. `lunex-admin/.next/standalone/lunex-admin/.env` — `AUTH_SECRET="lunex-admin-dev-secret-change-in-production"` (commitado no repo)
3. `lunex-admin/.env:4` — mesmo AUTH_SECRET fraco

Se qualquer um desses valores chegar ao servidor de produção, um atacante pode:
- Drenar todos os fundos do settlement contract usando a chave //Alice
- Forjar tokens JWT de admin com role `SUPER_ADMIN`

---

## Mudanças Necessárias

### 1. `docker/.env.docker`
```diff
- RELAYER_SEED=//Alice
+ RELAYER_SEED=REPLACE_WITH_PRODUCTION_RELAYER_SEED_FROM_SECRETS_MANAGER
```

Adicionar comentário:
```
# NUNCA commitar o seed real. Usar Docker Secrets ou AWS Secrets Manager em produção.
```

### 2. `lunex-admin/.gitignore` (ou `.gitignore` raiz)
```diff
+ .next/
+ .next/standalone/
```

### 3. Remover `lunex-admin/.next/` do working tree
```bash
git rm -r --cached lunex-admin/.next/
```

### 4. `lunex-admin/.env`
```diff
- AUTH_SECRET="lunex-admin-dev-secret-change-in-production"
+ AUTH_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32
```

### 5. `lunex-admin/.env` — ADMIN_SECRET
```diff
- ADMIN_SECRET=""
+ ADMIN_SECRET=REPLACE_WITH_SECURE_ADMIN_SECRET
```

---

## Critérios de Aceitação

- [ ] `grep -r "//Alice\|//Bob\|//Charlie" . --include="*.env*" --include="*.docker*"` — zero resultados
- [ ] `grep -r "lunex-admin-dev-secret" . --include="*.env*"` — zero resultados  
- [ ] `lunex-admin/.next/` está no `.gitignore`
- [ ] `lunex-admin/.next/standalone/` não existe no working tree
- [ ] `docker/.env.docker` contém apenas placeholders, nunca valores reais

---

## Verificação

```bash
# Verificar que nenhum secret real está rastreado pelo git
git ls-files | xargs grep -l "//Alice\|//Bob\|Admin@Lunex"

# Verificar .gitignore cobre .next
echo ".next/test" | git check-ignore -v --stdin

# Verificar que .next não está staged
git status lunex-admin/.next/
```

---

## Notas de Deploy

Após esta mudança, o time de ops precisa:
1. Gerar novo `AUTH_SECRET`: `openssl rand -base64 32`
2. Configurar `RELAYER_SEED` real via Docker Secrets ou AWS Secrets Manager
3. Configurar `ADMIN_SECRET` real no ambiente de produção
4. **Não usar o arquivo `.env` commitado** — apenas os valores do secrets manager
