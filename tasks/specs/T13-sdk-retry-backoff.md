# Spec T13 — Retry com Backoff no SDK HTTP Client

**Fase:** 3 — Integridade de Dados  
**Esforço:** S (~4h)  
**Prioridade:** ALTA

---

## Problema

`sdk/src/http-client.ts:62` — Response interceptor apenas mapeia erros e rejeita. Sem retry automático para erros transientes (429, 502, 503, 504). Em lançamento com alta carga, esses status codes são comuns.

---

## Mudança Necessária

### `sdk/src/http-client.ts`

```ts
import axios, { AxiosInstance, AxiosError } from 'axios'

const RETRYABLE_STATUS = [429, 502, 503, 504]
const MAX_RETRIES = 3

function withRetry(client: AxiosInstance): AxiosInstance {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as any
      if (!config) return Promise.reject(mapError(error))

      const status = error.response?.status
      const isRetryable =
        RETRYABLE_STATUS.includes(status ?? 0) ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ECONNRESET'

      config._retryCount = config._retryCount ?? 0

      if (!isRetryable || config._retryCount >= MAX_RETRIES) {
        return Promise.reject(mapError(error))
      }

      config._retryCount += 1

      // Respeitar Retry-After para 429
      let delayMs: number
      if (status === 429 && error.response?.headers['retry-after']) {
        delayMs = parseInt(error.response.headers['retry-after']) * 1000
      } else {
        // Exponential backoff: 500ms, 1000ms, 2000ms + jitter ±20%
        const base = 500 * Math.pow(2, config._retryCount - 1)
        const jitter = base * 0.2 * (Math.random() * 2 - 1)
        delayMs = Math.min(base + jitter, 30_000)
      }

      await new Promise(resolve => setTimeout(resolve, delayMs))
      return client.request(config)
    }
  )
  return client
}

export function createHttpClient(config: HttpClientConfig): AxiosInstance {
  const client = axios.create({ timeout: config.timeout ?? 30_000, ... })
  return withRetry(client)
}
```

---

## Critérios de Aceitação

- [ ] Retry automático para: 429, 502, 503, 504, `ECONNABORTED`, `ECONNRESET`
- [ ] Máximo 3 retries por request
- [ ] Backoff exponencial: ~500ms, ~1000ms, ~2000ms
- [ ] Jitter ±20% para evitar thundering herd
- [ ] Header `Retry-After` respeitado para 429
- [ ] **Sem retry** para: 400, 401, 403, 404, 409, 422
- [ ] `_retryCount` não vaza entre requests diferentes

---

## Verificação

```ts
// Mock de 503 que resolve na 3ª tentativa
let attempts = 0
mockServer.post('/api/orders').reply(() => {
  attempts++
  return attempts < 3 ? [503, { error: 'unavailable' }] : [200, { id: '123' }]
})

const result = await sdk.orders.create(...)
expect(result.id).toBe('123')
expect(attempts).toBe(3)
```

```bash
cd sdk && npm test -- --grep "retry"
```
