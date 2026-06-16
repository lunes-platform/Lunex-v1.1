# Circular Dependency Audit — 2026-06-16

Tool: madge 8.0.0 (`npx madge --circular --extensions ts,tsx <pkg>/src`)

---

## Package Results

| Package | Files Scanned | Cycles Reported | Real Runtime Cycles |
|---|---|---|---|
| spot-api/src | 140 | 0 | 0 |
| sdk/src | 26 | 0 | 0 |
| mcp/ | 4 | 0 | 0 |
| lunes-dex-main/src | 156 | 4 | **0** (see below) |
| lunex-admin/src | 58 | 0 | 0 |
| faucet/ | 0 TS files (index.js only) | 0 | 0 |
| subquery-node/src | 23 | 0 | 0 |

---

## lunes-dex-main — 4 Reported Cycles (All False Positives)

Madge 8.0.0 includes `import type` declarations in its dependency graph. It does not distinguish between value imports and type-only imports when computing cycles. All 4 reported cycles have the same structure:

```
index.tsx  --[value import: * as S]--> styles.ts
styles.ts  --[import type: XxxProps]--> index.tsx   ← TYPE-ONLY, erased at compile time
```

Because the `styles.ts → index.tsx` edge is `import type`, TypeScript erases it entirely at emit. No runtime cycle exists. The JavaScript module loader never sees a cycle.

### Cycle 1: button

- `components/bases/button/index.tsx` imports `* as S from './styles'` (value — styled-components)
- `components/bases/button/styles.ts` line 2: `import type { ButtonProps } from '.'` ← already `import type`

**Status: FALSE POSITIVE. No action needed.**

### Cycle 2: loading

- `components/bases/loading/index.tsx` imports `* as S from './styles'` (value)
- `components/bases/loading/styles.ts` line 2: `import type { LoadingProps } from '.'` ← already `import type`

**Status: FALSE POSITIVE. No action needed.**

### Cycle 3: checkbox

- `components/bases/checkbox/index.tsx` imports `* as S from './styles'` (value)
- `components/bases/checkbox/styles.ts` line 2: `import type { CheckboxProps } from '.'` ← already `import type`

**Status: FALSE POSITIVE. No action needed.**

### Cycle 4: modal

- `components/modal/index.tsx` imports `* as S from './styles'` (value)
- `components/modal/styles.ts` line 2: `import type { ModalProps } from '.'` ← already `import type`

**Status: FALSE POSITIVE. No action needed.**

---

## Why Madge Reports These

Madge 8.x builds a single undirected-equivalent graph from all `import` and `import type` statements. It has no `--no-type-imports` flag. This is a known limitation: [madge issue tracker](https://github.com/pahen/madge/issues). The correct tool to rule out runtime cycles is `tsc --noEmit` (which enforces `isolatedModules` type import rules) or inspection of the compiled JS output.

The TypeScript compiler itself enforces the correctness of `import type`: it will error if a `import type` reference is used as a value, and it strips all type imports before emitting JS.

---

## Fixes Applied

**None.** All 4 reported cycles were already correctly resolved by the existing `import type` annotations in the styles files. Changing these to value imports would introduce real runtime cycles. No additional changes were made.

---

## Recommendations

### Optional: Suppress Madge False Positives

To make future CI `madge --circular` checks accurate, add a `.madgerc.json` at `lunes-dex-main/` root:

```json
{
  "fileExtensions": ["ts", "tsx"],
  "detectiveOptions": {
    "ts": {
      "skipTypeImports": true
    }
  }
}
```

This uses madge's underlying `detective-typescript` option to skip `import type` edges. With this config, `npx madge --circular --extensions ts,tsx src` would report 0 cycles.

**Risk:** Zero — config file only, no source code change.

### Optional: Move Props Types to Shared Leaf Files

A cleaner architectural pattern (eliminates the bidirectional dependency entirely):

```
components/bases/button/types.ts   ← ButtonProps interface (new leaf file)
components/bases/button/index.tsx  ← imports from './types', imports * as S from './styles'
components/bases/button/styles.ts  ← imports type { ButtonProps } from './types' (not from '.')
```

This eliminates even the perceived cycle. However, this requires moving runtime `export type` declarations — it is pure type refactoring with zero behavior change. Flagged here as a recommendation rather than auto-applied because it involves creating new files and editing 3 files per component (8 files total for 4 components), which exceeds the minimal-touch policy for a cleanup pass.

**Risk if applied:** Zero runtime risk (type-only change). Recommend doing as a dedicated micro-refactor.

---

## No Runtime Logic Moved

Confirmed: no runtime logic was touched, moved, or modified in this pass. All source files remain byte-for-byte identical to the state left by cleanup pass #1.
