# Dead Code Audit — Pass 1 (DEAD CODE)
Date: 2026-06-16

## Tooling Used

| Package | Tool | How invoked |
|---|---|---|
| `lunes-dex-main` | ts-prune (via `scripts/check-ts-prune.cjs`) | `node ./scripts/check-ts-prune.cjs` |
| `lunes-dex-main` | depcheck (via `scripts/check-depcheck.cjs`) | `node ./scripts/check-depcheck.cjs` |
| `spot-api` | ts-prune (via `scripts/check-ts-prune.cjs`) | `node ./scripts/check-ts-prune.cjs` |
| `spot-api` | depcheck (via `scripts/check-depcheck.cjs`) | `node ./scripts/check-depcheck.cjs` |
| `sdk` | ts-prune | `npx ts-prune -p tsconfig.json -i 'src/index\.ts'` |
| All | ripgrep | `grep -rl '<symbol>' ... --exclude-dir=node_modules --exclude-dir=dist` for every candidate |

`sdk depcheck`, `lunex-admin`, `subquery-node`, `mcp`, `faucet` have no built-in deadcode scripts; analyzed manually via export grep + ripgrep.

---

## High-Confidence Removals Applied

### 1. `CopyRiskConfigInput` — `spot-api/src/utils/validation.ts:135`

**What it was:** A `type` alias derived from `CopyRiskConfigSchema`:
```ts
export type CopyRiskConfigInput = z.infer<typeof CopyRiskConfigSchema>;
```

**Evidence of zero usage:**
- ts-prune (via `spot-api/scripts/check-ts-prune.cjs`) explicitly flagged it:
  `src/utils/validation.ts:135 - CopyRiskConfigInput`
- `grep -r 'CopyRiskConfigInput' spot-api --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist` → returned only the definition file itself
- `grep -r 'CopyRiskConfigInput' <entire-monorepo> --include='*.ts' --include='*.tsx' --include='*.js' --exclude-dir=node_modules --exclude-dir=dist` → no output (zero matches outside definition)
- The schema `CopyRiskConfigSchema` itself IS used (inline fields are repeated in `FollowLeaderSchema`, `CopyVaultDepositSchema`, etc.) — only the derived type alias was dead
- No test files reference it

**Action:** Removed line 135 (`export type CopyRiskConfigInput = z.infer<typeof CopyRiskConfigSchema>;`) plus the trailing blank line.

**File edited:** `spot-api/src/utils/validation.ts`

---

## Candidates Investigated and LEFT (with reasons)

### `spot-api/src/utils/validation.ts` — other type aliases
All remaining `export type ...` aliases (lines 225–239 in original) are used:
- `CreateOrderInput` → `spot-api/src/services/orderService.ts`
- `SocialLeadersQuery` → `spot-api/src/services/socialService.ts`
- `UpsertLeaderProfileInput` → `spot-api/src/services/socialService.ts`
- `CopyVaultDepositInput` → `spot-api/src/services/copytradeService.ts`
- `CopyVaultWithdrawInput` → `spot-api/src/services/copytradeService.ts`
- `CopyTradeSignalInput` → `spot-api/src/services/copytradeService.ts`
- `CopyTradeSignalWalletConfirmationInput` → `spot-api/src/services/copytradeService.ts`
- `CopyTradeApiKeyChallengeInput` → `spot-api/src/services/copytradeService.ts`
- `CopyTradeApiKeyInput` → `spot-api/src/services/copytradeService.ts`

### `spot-api/src/services/asymmetricService.ts` — `isCoolingDown`, `isProfitableToRebalance`
Both exported functions are referenced in `spot-api/src/services/rebalancerService.ts` and their tests. USED.

### `spot-api/src/services/assetBridgeService.ts` — `createBridgeFromEnv`
Referenced in `spot-api/src/__tests__/assetBridgeService.test.ts`. Tests count as real usage per task rules (do not delete tests, do not count test-only usage as "dead"). Function is also test infrastructure. LEFT.

### `spot-api/src/services/agentService.ts` — `setStakeChainVerifier`, `StakeChainVerifier`
`setStakeChainVerifier` is called at startup from `spot-api/src/index.ts:416`. `StakeChainVerifier` interface is implemented by `stakeChainVerifier.ts`. Both are runtime-critical. USED.

### `spot-api/src/utils/productionGuards.ts` — `isDevSeed`, `isPlaceholder`
Both referenced in `spot-api/src/services/assetBridgeService.ts`. USED.

### `spot-api/src/utils/copytrade.ts` — `planTwapSlices`
Referenced in `spot-api/src/services/copytradeService.ts` and `spot-api/src/__tests__/copytrade.test.ts`. USED.

### `sdk/src/modules/*` — `EndpointNotAvailableError` throwing stubs
Per task HARD EXCLUSION: these are deliberate public API surface (deprecated methods that throw `EndpointNotAvailableError`). Left untouched. The error class is exported from `sdk/src/index.ts:232` and used by `pair.ts`, `router.ts`, `factory.ts`.

### `subquery-node/src/mappings/contractEvents.ts`
Not re-exported from `subquery-node/src/index.ts`, but consumed directly by all 5 mapping files via relative imports:
- `copyVault.ts`, `router.ts`, `listing.ts`, `staking.ts`, `spotSettlement.ts` all `import { ... } from './contractEvents'`
Entire file is a shared decoder library. USED by all mapping handlers.

### `lunes-dex-main` — all exports
`node ./scripts/check-ts-prune.cjs` returned: `"ts-prune: nenhum export morto encontrado no frontend (após filtros)."` — zero dead exports detected. Nothing to remove.

### `lunes-dex-main` — deps
`node ./scripts/check-depcheck.cjs` returned: `"depcheck: nenhuma dependência morta/faltante no frontend (após filtros)."` — no unused or missing deps.

### `lunex-admin` — all exports
Exports are Next.js App Router `default export`s (page, layout, action functions) consumed by the framework's file-system router, not by explicit import statements. ts-prune would report all of these as "unused" because the framework resolves them by convention — safe to treat all as USED.

### `mcp/lunex-agent-mcp` — `routerTools.ts`, `smokeRouter.ts`
`routerTools.ts` exports `agentRouterSwapTool` and `getRouterQuoteTool`, both imported in `mcp/lunex-agent-mcp/src/index.ts:13`. USED.
`smokeRouter.ts` — smoke test helper; not imported by `index.ts` but co-located for manual invocation/debugging. Candidate but uncertain — listed below for human review.

### `faucet`
`faucet/index.js` is a plain JavaScript single-file service (no TypeScript exports). Not in scope for ts-prune. No dead internal exports found.

---

## Candidates Left for Human Confirm

| Symbol / File | Location | Reason for uncertainty |
|---|---|---|
| `smokeRouter.ts` | `mcp/lunex-agent-mcp/src/smokeRouter.ts` | Not imported by `index.ts`; appears to be a standalone manual smoke-test runner. Has its own `dist/smokeRouter.js` build artifact. Not referenced anywhere else in the monorepo. Could be deleted if it's no longer used for manual spot-checks — but "no import" is expected for a runner script, so this needs human confirmation before deletion. |

---

## Unused npm Dependencies Found (Recommendation Only — do NOT touch package.json)

### `spot-api` — `depcheck` findings
depcheck reported **missing** (used in code but not listed in package.json):
- `@polkadot/wasm-crypto` — likely pulled transitively; explicit declaration in devDependencies would silence warnings
- `@polkadot/types` — same as above, transitive via `@polkadot/api`
- `@noble/curves` — transitive crypto dependency

These are **missing** declarations, not unused packages. No unused production deps were flagged by depcheck for spot-api.

### `sdk` — depcheck
Timed out during batch execution. Run manually: `cd sdk && npx depcheck . --json --ignore-dirs=dist,examples --ignores='@types/jest,@types/node'`

### `lunex-admin`, `mcp`, `subquery-node`, `faucet`
No depcheck tooling present in these packages. Manual analysis not performed in this pass (out of scope for code-level dead code removal).

---

## Summary

- **High-confidence removals applied:** 1
- **Files edited:** 1 (`spot-api/src/utils/validation.ts`, removed 2 lines)
- **Candidates left for human confirm:** 1 (`mcp/lunex-agent-mcp/src/smokeRouter.ts`)
- **Unused npm dep recommendations:** 3 missing declarations in `spot-api` (transitive, non-urgent)
