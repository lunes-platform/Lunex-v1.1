# Spec T07 — Rate Limiting no Admin Login

**Fase:** 2 — Estabilidade do Processo  
**Esforço:** S (~4h)  
**Prioridade:** ALTA

---

## Problema

`/api/auth/callback/credentials` (NextAuth) sem proteção de brute-force. O email do admin é público (`admin@lunex.fi` visível em `create-admin.ts`). Um atacante pode testar senhas indefinidamente via automação.

---

## Abordagem

Usar middleware Next.js com Upstash Ratelimit (Redis) ou implementação própria com `next-rate-limit`. O middleware existente em `lunex-admin/middleware.ts` já intercepta rotas — adicionar lógica de rate limit nele.

---

## Mudanças Necessárias

### Instalar dependência

```bash
cd lunex-admin && npm install @upstash/ratelimit @upstash/redis
```

Alternativa sem Upstash (usando Redis já existente via `ioredis`):
```bash
cd lunex-admin && npm install rate-limiter-flexible
```

### `lunex-admin/middleware.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

// Rate limiting state (usando headers de IP)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutos
const RATE_LIMIT_MAX = 5

export async function middleware(req: NextRequest) {
  const isLoginRoute = req.nextUrl.pathname === '/api/auth/callback/credentials'

  if (isLoginRoute && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.ip ?? 'unknown'
    const key = `login_attempts:${ip}`

    // Verificar rate limit via Redis (usando SPOT_API_URL como proxy)
    // Ou implementar diretamente com headers de cache
    const rateLimitResponse = await checkRateLimit(key)
    if (!rateLimitResponse.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many login attempts. Try again in 15 minutes.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(rateLimitResponse.resetIn / 1000)),
          },
        }
      )
    }
  }

  // Verificação de sessão existente
  const token = await getToken({ req })
  const isProtectedRoute = req.nextUrl.pathname.startsWith('/(admin)')

  if (isProtectedRoute && !token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}
```

### Endpoint de rate limit no spot-api (alternativa ao Upstash)

Criar `spot-api/src/routes/internal/rateLimit.ts`:
```ts
// POST /internal/check-rate-limit
// Body: { key: string, limit: number, windowMs: number }
// Response: { allowed: boolean, remaining: number, resetIn: number }
```

---

## Critérios de Aceitação

- [ ] 5 POSTs ao `/api/auth/callback/credentials` com senha errada → 6º retorna 429
- [ ] Header `Retry-After` presente no 429
- [ ] Log de tentativas falhas com IP (servidor-side)
- [ ] Rate limit reseta após a janela de 15 minutos
- [ ] Login bem-sucedido dentro do limite não é bloqueado
- [ ] IPs diferentes não compartilham limite

---

## Verificação

```bash
# Brute force simulado
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://admin.lunex.local/api/auth/callback/credentials \
    -d 'email=admin@lunex.fi&password=wrong'
  echo ""
done
# Esperado: 5× qualquer código + 1× 429
```

---

## Notas

- Considerar implementar lockout de conta (não apenas por IP) após 10 falhas
- Log deve incluir: timestamp, IP, email tentado (nunca a senha)
- Em produção, o IP real vem do header `X-Forwarded-For` configurado no Nginx
