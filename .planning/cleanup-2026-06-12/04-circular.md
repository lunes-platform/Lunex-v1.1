# 04 — Dependências Circulares

**Data:** 2026-06-12 | **Agente:** 4/8 (cleanup) | **Ferramenta:** `madge --circular --extensions ts,tsx --ts-config <pkg>/tsconfig.json`

## Resumo por pacote

| Pacote | Arquivos analisados | Ciclos | Observação |
|---|---|---|---|
| spot-api/src | 127 | **0** | Limpo |
| lunes-dex-main/src | 150 | **4** | Todos padrão `index.tsx ↔ styles.ts` |
| lunex-admin/src | 58 | **0** | Limpo (25 warnings de resolução do madge, sem ciclos) |
| sdk/src | 24 | **0** | Limpo |
| mcp/lunex-agent-mcp/src | 4 | **0** | Limpo |

**Total: 4 ciclos, todos em `lunes-dex-main`, todos do mesmo padrão e da mesma causa-raiz.**

## Padrão único identificado

Em todos os 4 casos:

- `index.tsx` importa `* as S from './styles'` — import **de runtime** (styled-components).
- `styles.ts` importa `{ XProps } from '.'` — usado **apenas em posição de tipo** (genéricos `styled.x<XProps>` / `css<...>`), mas escrito como import de valor.

Como o uso em `styles.ts` é exclusivamente de tipo, o TypeScript elide esse import na compilação — **não há ciclo real em runtime, nem side-effects de inicialização envolvidos**. O ciclo existe apenas no grafo estático de módulos.

**Gravidade de todos: LEVE** (ciclo só de tipos).

## Ciclos

### 1. `lunes-dex-main/src/components/bases/button/index.tsx` ↔ `styles.ts`
- **Detalhe:** `styles.ts` (87 linhas) importa `ButtonProps` de `index.tsx` para tipar variantes do styled-components.
- **Gravidade:** LEVE
- **Corte mínimo:** trocar em `styles.ts` para `import type { ButtonProps } from '.'`. Alternativa mais robusta: extrair `ButtonProps` para `components/bases/button/types.ts` (módulo folha) e importar dele em ambos.
- **Confiança:** ALTA

### 2. `lunes-dex-main/src/components/bases/loading/index.tsx` ↔ `styles.ts`
- **Detalhe:** `styles.ts` (22 linhas) importa `LoadingProps` de `index.tsx`.
- **Gravidade:** LEVE
- **Corte mínimo:** `import type { LoadingProps } from '.'` em `styles.ts`, ou extrair para `types.ts` folha.
- **Confiança:** ALTA

### 3. `lunes-dex-main/src/components/bases/checkbox/index.tsx` ↔ `styles.ts`
- **Detalhe:** `styles.ts` (49 linhas) importa `CheckboxProps` de `index.tsx`.
- **Gravidade:** LEVE
- **Corte mínimo:** `import type { CheckboxProps } from '.'` em `styles.ts`, ou extrair para `types.ts` folha.
- **Confiança:** ALTA

### 4. `lunes-dex-main/src/components/modal/index.tsx` ↔ `styles.ts`
- **Detalhe:** `styles.ts` (112 linhas) importa `ModalProps` de `index.tsx`. `index.tsx` também importa `components/bases` (barrel), mas isso não participa do ciclo.
- **Gravidade:** LEVE
- **Corte mínimo:** `import type { ModalProps } from '.'` em `styles.ts`, ou extrair para `types.ts` folha.
- **Confiança:** ALTA

## Recomendação consolidada

1. **Correção imediata (4 edits de 1 linha):** adicionar o modificador `type` nos 4 imports em `styles.ts`. Com `import type`, o madge (e o ESLint `import/no-cycle` com `allowTypeImports`) deixa de acusar ciclo, e fica explícito que não há dependência de runtime.
2. **Prevenção:** habilitar regra ESLint `@typescript-eslint/consistent-type-imports` (ou `import/no-cycle` com `maxDepth`) no `lunes-dex-main` para impedir reintrodução do padrão — outros componentes que vierem a exportar Props consumidas pelos seus `styles.ts` repetirão o ciclo.
3. **Opcional (padronização):** se o time preferir grafo 100% acíclico mesmo no nível de tipos, padronizar `types.ts` por componente como módulo folha. Custo maior (4 arquivos novos + ajustes de re-export), benefício marginal — só vale se for adotado como convenção.

**Nenhum ciclo grave encontrado** — não há ciclos entre services, stores ou módulos com side-effects de inicialização em nenhum dos 5 pacotes.
