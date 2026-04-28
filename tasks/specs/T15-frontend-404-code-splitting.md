# Spec T15 — Rota 404 + Code Splitting Vite

**Fase:** 4 — Frontend e Infraestrutura  
**Esforço:** S (~2h)  
**Prioridade:** ALTA

---

## Problema

1. **Sem rota 404**: `lunes-dex-main/src/routers/index.tsx` sem `path="*"`. URLs inválidas = tela em branco.
2. **Bundle monolítico**: `@polkadot/api` (~2-3MB não minificado) no chunk principal. LCP alto para novos usuários.

---

## Mudanças Necessárias

### 1. `lunes-dex-main/src/routers/index.tsx`

```diff
+ import { lazy, Suspense } from 'react'

  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/spot" element={<Spot />} />
    {/* ... rotas existentes ... */}
+   <Route path="*" element={<NotFound />} />
  </Routes>
```

### 2. Criar `lunes-dex-main/src/pages/NotFound.tsx`

```tsx
import { Link } from 'react-router-dom'
import styled from 'styled-components'

export function NotFound() {
  return (
    <Container>
      <Code>404</Code>
      <Message>Page not found</Message>
      <Link to="/">← Back to trading</Link>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
`
const Code = styled.h1`font-size: 96px; margin: 0;`
const Message = styled.p`font-size: 24px; color: var(--text-secondary);`
```

### 3. `lunes-dex-main/vite.config.ts`

```diff
  build: {
+   rollupOptions: {
+     output: {
+       manualChunks: {
+         'polkadot': [
+           '@polkadot/api',
+           '@polkadot/api-contract',
+           '@polkadot/extension-dapp',
+           '@polkadot/keyring',
+         ],
+         'charts': ['lightweight-charts', 'recharts'],
+         'vendor': ['react', 'react-dom', 'react-router-dom', 'styled-components'],
+       }
+     }
+   },
    sourcemap: false,
```

---

## Critérios de Aceitação

- [ ] `/qualquer-coisa-invalida` → página 404 com link para home
- [ ] Build de produção gera chunk `polkadot-*.js` separado do `index-*.js`
- [ ] Chunk `polkadot` não é carregado na rota `/` (verificar DevTools Network)
- [ ] `npm run build` sem warnings de chunk size

---

## Verificação

```bash
# Build e checar chunks
cd lunes-dex-main && npm run build
ls -lah dist/assets/*.js | grep polkadot
# Esperado: arquivo polkadot-[hash].js separado

# Verificar rota 404
npm run preview
# Navegar para http://localhost:4173/rota-que-nao-existe
# Esperado: página 404 com link
```
