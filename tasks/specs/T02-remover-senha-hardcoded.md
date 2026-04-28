# Spec T02 — Remover Senha Hardcoded do Script de Admin

**Fase:** 1 — Emergência de Segurança  
**Esforço:** XS (~30min)  
**Prioridade:** BLOQUEADOR CRÍTICO

---

## Problema

`lunex-admin/scripts/create-admin.ts:16`:
```ts
const password = process.env.ADMIN_PASSWORD || 'Admin@Lunex2026'
```

A string `Admin@Lunex2026` é agora pública. Qualquer pessoa com acesso ao painel admin (URL conhecida) pode tentar fazer login com essa senha.

Adicionalmente, `lunex-admin/src/app/(admin)/team/actions.ts:21`:
```ts
if (password.length < 8)
```
8 caracteres é insuficiente para contas admin privilegiadas.

---

## Mudanças Necessárias

### 1. `lunex-admin/scripts/create-admin.ts`

```diff
- const password = process.env.ADMIN_PASSWORD || 'Admin@Lunex2026'
+ const password = process.env.ADMIN_PASSWORD
+ if (!password) {
+   console.error('❌ ADMIN_PASSWORD environment variable is required')
+   console.error('   Generate one: openssl rand -base64 24')
+   process.exit(1)
+ }
+ if (password.length < 16) {
+   console.error('❌ ADMIN_PASSWORD must be at least 16 characters')
+   process.exit(1)
+ }
```

### 2. `lunex-admin/src/app/(admin)/team/actions.ts`

```diff
- if (password.length < 8)
+ if (password.length < 16)
```

Atualizar mensagem de erro:
```diff
- 'Password must be at least 8 characters'
+ 'Password must be at least 16 characters'
```

---

## Critérios de Aceitação

- [ ] `grep -r "Admin@Lunex2026" .` — zero resultados em todo o repositório
- [ ] Script falha com mensagem clara se `ADMIN_PASSWORD` não definido
- [ ] Script falha com mensagem clara se senha < 16 chars
- [ ] Validação de 16 chars aplicada também na criação de novos admins via UI

---

## Verificação

```bash
# Testar sem variável de ambiente
cd lunex-admin && node scripts/create-admin.js
# Esperado: exit code 1 + mensagem de erro

# Testar com senha curta
ADMIN_PASSWORD=short node scripts/create-admin.js
# Esperado: exit code 1 + mensagem de erro

# Testar com senha válida
ADMIN_PASSWORD=MySecureAdminPass2026! node scripts/create-admin.js
# Esperado: admin criado com sucesso
```
