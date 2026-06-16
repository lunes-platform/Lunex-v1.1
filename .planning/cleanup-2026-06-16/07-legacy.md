# Cleanup Pass #8 — Legacy / Deprecated / Fallback

**Date:** 2026-06-16  
**Scope:** spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, faucet, subquery-node/src  
**Exclusions:** contracts/, node_modules, dist, .next, build, target, test files, auto-generated  
**Result:** 0 removals applied. All items are intentional-deprecated-API, security-controls, or financial paths.

---

## 1. SDK — Intentional `@deprecated` API Surface (keep-intentional-deprecated-API)

**Files:**
- `sdk/src/modules/auth.ts` — `getNonce`, `login`, `refreshToken`
- `sdk/src/modules/staking.ts` — 13 methods (stake, unstake, getStake, getRewards, claimRewards, getPool, getValidators, delegate, undelegate, redelegate, getEpoch, getSlashings, getHistoricalAPY)
- `sdk/src/modules/tokens.ts` — `getNativeAssets`, `getNativeAsset`, `wrapToken`, `unwrapToken`, `getBalance`, `getTokenBalance`, `getPrice`
- `sdk/src/modules/router.ts` — `getQuote`, `addLiquidity`, `removeLiquidity`, `swapExactTokensForTokens`, `swapTokensForExactTokens`
- `sdk/src/modules/factory.ts` — `getAllPairs`, `getPairByTokens`, `createPair`, `getStats`
- `sdk/src/modules/pair.ts` — `getInfo`, `getReserves`, `getHistory`, `getLPBalance`
- `sdk/src/modules/wnative.ts` — `wrap`, `unwrap`, `getInfo`, `getBalance`, `isHealthy`
- `sdk/src/errors.ts` — `EndpointNotAvailableError` class

**Classification: keep-intentional-deprecated-API**

These are the deliberate public API surface decided in a prior semver reconciliation. Each method:
- Bears a `@deprecated` JSDoc tag explaining why the endpoint never existed
- Throws `EndpointNotAvailableError` with a clear diagnostic message pointing to the correct alternative
- Is kept for signature compatibility so existing SDK consumers get a fast, informative failure instead of an opaque HTTP 404

Zero callers found outside the SDK modules themselves (grep confirmed no `auth.getNonce`, `auth.login`, `auth.refreshToken`, `factory.getAllPairs`, `factory.getPairByTokens`, `router.getQuote`, `router.swapExact`, etc. in spot-api, mcp, lunes-dex-main, or lunex-admin). But removal is still blocked by the explicit semver decision — these exist for the public API contract, not for internal use.

---

## 2. `spot-api/src/middleware/auth.ts` — In-Memory Nonce Fallback (keep-security-control)

**Lines:** 10–80  
`fallbackNonces: Map<string, number>` + `getNonceState` / `consumeNonce` logic

**Classification: keep-security-control**

The in-memory `fallbackNonces` store is a deliberate anti-replay control for Redis outages. The comment at line 27–30 explains exactly why it cannot be removed: a nonce written to the fallback while Redis was down would become invisible once Redis recovers, enabling replay attacks. The prod branch (`config.isProd`) returns `'unavailable'` on Redis failure (fail-closed). The dev branch falls back to in-memory (fail-open, intentional for local dev). This is an active, correct design — not dead code.

---

## 3. `spot-api/src/middleware/auth.ts:91` — `timestamp?: number` Optional Field (keep-security-control)

**Comment:** "Required for new orders; omit only when re-verifying legacy stored orders."

**Classification: keep-security-control**

The optional `timestamp` field on `SpotOrderMessageInput` exists to allow the system to re-verify signatures on historical orders that were stored before the timestamp field was added to the message format. Removing the optionality would break re-verification of those orders. The `buildSpotOrderMessage` function handles both branches. No caller outside the middleware itself was found using the "no timestamp" path, but this is a financial-path message construction function — propose-only by rule, and the field serves a documented purpose.

---

## 4. `spot-api/src/services/affiliateService.ts:479–497` — Eligibility Guard (fund-path-propose-only)

**Comment:** "Eligibility guard (protects legacy rows created before the post-SETTLED credit fix)"

**Classification: fund-path-propose-only**

This guard filters `AffiliateCommission` rows with `sourceType === 'SPOT'` to only pay ones whose underlying trade is `SETTLED`. The "legacy rows" reference means there exist rows in production created before a bug-fix that added the SETTLED check. The guard is still load-bearing: removing it would cause those historical rows (and any future rows with `sourceTradeId === null`) to be paid without settlement verification. This is a financial Prisma write path (payout batch) — do not remove.

---

## 5. `spot-api/src/services/settlementService.ts:289` — `attestorSeed || ''` (fund-path-propose-only)

**Line 289:** `const raw = (config.settlement.attestorSeed || '').trim();`  
**Line 583:** `parseInt(process.env.MAX_SETTLE_CONCURRENCY || '8', 10)`

**Classification: fund-path-propose-only**

- `attestorSeed || ''` — defensive empty-string default before `.trim()`. If seed is undefined/null, the downstream `resolveAttestorSeed()` (line 420–423) conditionally skips keypair init. Not a fallback to a live value — it's a guard against crashing on trim of undefined. Financial signing path; do not edit.
- `MAX_SETTLE_CONCURRENCY || '8'` — runtime config with documented safe default ([1, 64] clamp, comment explains purpose). Not dead code — the default of 8 is the documented operational value. Financial relayer; do not edit.

---

## 6. `lunex-admin/src` — `SPOT_API_URL || 'http://localhost:4000'` (keep-security-control / active-dev-default)

**Files (4 actions.ts + 1 page.tsx):**
- `app/(admin)/emergency/actions.ts:7`
- `app/(admin)/listings/actions.ts:8`
- `app/(admin)/listings/pending/actions.ts:7`
- `app/(admin)/listings/pending/page.tsx:26`
- `app/(admin)/dex-users/actions.ts:7`

**Classification: keep-security-control (for emergency), active-dev-default (for others)**

The `SPOT_API_URL` env var is the production config path. The `|| 'http://localhost:4000'` default is a standard Next.js Server Action development convenience — when `SPOT_API_URL` is set (production), localhost is unreachable. The emergency actions file in particular controls `spot_settlement` / `copy_vault` pause/unpause — the localhost default would simply fail to connect in prod (not a financial risk from the default itself), but the pattern is consistent and expected across Next.js server-side admin apps.

Removing the defaults would make local development harder with no production safety gain (prod always has `SPOT_API_URL` set via environment). Leave as-is.

---

## 7. `lunes-dex-main/src` — `REACT_APP_SPOT_API_URL || 'http://localhost:4000'` (active-dev-default)

**Files:**
- `src/config/api.ts:8`
- `src/utils/getTokenLogo.ts:10`
- `src/hooks/useAsymmetricDeploy.ts:24–26`
- `src/hooks/usePools.ts:97`
- `src/pages/agent/index.tsx:540,744,780`
- `src/pages/header/modals/walletModal/index.tsx:397`
- `src/pages/affiliates/index.tsx:9`
- `src/pages/listing/index.tsx:9`

**Classification: active-dev-default**

All `process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'` patterns are standard CRA/Vite dev defaults. The env var is set in production builds. These are not dead code — they enable local development without a `.env` file. Not removable.

**Special case — `src/pages/pool/asymmetric/index.tsx:479`:**  
`process.env.REACT_APP_SPOT_API_URL || process.env.REACT_APP_API_URL` — falls back to `/api/v1/asymmetric` if both are absent (relative path). This is the most correct form in the codebase and a reasonable pattern.

---

## 8. `lunes-dex-main/src/pages/docs/index.tsx:1726,1814–1815,2379` — Hardcoded `localhost:4000` in Doc Strings (borderline)

**Lines:**
- 1726: `fetch('http://localhost:4000/api/v1/orders', ...` — inside a JSX `<Code>` string block (documentation example)
- 1814–1815: `baseURL: 'http://localhost:4000'`, `wsURL: 'ws://localhost:4000'` — SDK example in docs
- 2379: `new LunexSDK({ baseURL: 'http://localhost:4000' })` — SDK example

**Classification: borderline — left as-is**

These are inside rendered documentation code snippets (JSX template literals displayed to users). They show the API URL a developer would use locally. They are not runtime API calls — they never execute. Changing them to a production URL in the docs would be misleading (you wouldn't point an SDK example at prod). Left as-is. If a `REACT_APP_DOCS_API_URL` env var is ever wired through for live-docs playgrounds, these would need updating, but that's a feature, not cleanup.

---

## 9. `lunes-dex-main/src/routers/index.tsx` — `<Suspense fallback={<RouteFallback />}>` (active-React-pattern)

**Classification: active-React-pattern — not legacy**

This is a React Suspense boundary with a loading spinner fallback component. Standard React pattern; `fallback` here is the Suspense prop name, not a legacy code path.

---

## 10. `lunex-admin/src/app/(admin)/emergency/actions.ts:23–26` — `readApiError` Helper (active-utility)

```ts
async function readApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}))
  return body.error || body.message || fallback
}
```

**Classification: active-utility — not legacy**

Used inline throughout the file for error message extraction from API responses. `fallback` here is a parameter name (the caller-supplied default message string). Not a legacy code path — the function is called 4+ times in the same file.

---

## 11. `spot-api/src/middleware/auth.ts` — `config.isProd` Guards (keep-security-control)

`config.isProd ? 'unavailable' : 'unused'` (line 35) and `if (config.isProd) { log.error... }` (line 65) are fail-closed security controls. In production, Redis unavailability causes nonce rejection. Outside production, it falls back to in-memory (dev convenience). These are correct and must not be removed.

---

## 12. `subquery-node/src/mappings/contractEvents.ts` — No Legacy Found

The grep flagged a comment mentioning "pollute their table with rows from foreign" — this is a documentation comment in the file header explaining the SubQuery contract architecture, not a dead code path. No legacy or deprecated code found in subquery-node.

---

## 13. `faucet/` — No Legacy Found

No deprecated, legacy, fallback, or backward-compat patterns found in faucet sources.

---

## Summary

| # | Item | File(s) | Classification | Action |
|---|------|---------|----------------|--------|
| 1 | SDK `@deprecated` throw-only methods (auth, staking, tokens, router, factory, pair, wnative) | `sdk/src/modules/*.ts` | keep-intentional-deprecated-API | None — semver surface |
| 2 | In-memory nonce fallback on Redis outage | `spot-api/src/middleware/auth.ts:10–80` | keep-security-control | None — anti-replay guard |
| 3 | Optional `timestamp` field for legacy stored order re-verification | `spot-api/src/middleware/auth.ts:91` | fund-path-propose-only | None — financial signing path |
| 4 | Affiliate eligibility guard for pre-fix rows | `spot-api/src/services/affiliateService.ts:479–497` | fund-path-propose-only | None — financial Prisma write |
| 5 | `attestorSeed \|\| ''` and `MAX_SETTLE_CONCURRENCY \|\| '8'` | `spot-api/src/services/settlementService.ts:289,583` | fund-path-propose-only | None — settlement signing path |
| 6 | `SPOT_API_URL \|\| 'http://localhost:4000'` (admin, 5 files) | `lunex-admin/src/app/**` | active-dev-default | None |
| 7 | `REACT_APP_SPOT_API_URL \|\| 'http://localhost:4000'` (DEX, 8 files) | `lunes-dex-main/src/**` | active-dev-default | None |
| 8 | Hardcoded `localhost:4000` in doc code snippets | `lunes-dex-main/src/pages/docs/index.tsx:1726,1814,2379` | borderline-left | None — display-only strings |
| 9 | `<Suspense fallback=...>` | `lunes-dex-main/src/routers/index.tsx` | active-React-pattern | None |
| 10 | `readApiError(..., fallback)` helper | `lunex-admin/src/app/(admin)/emergency/actions.ts:23` | active-utility | None |
| 11 | `config.isProd` nonce/auth guards | `spot-api/src/middleware/auth.ts:35,65` | keep-security-control | None |
| 12 | subquery-node comment (architecture note) | `subquery-node/src/mappings/contractEvents.ts` | false-positive | None |
| 13 | faucet | `faucet/**` | no-legacy-found | None |

**Removals applied: 0**  
**tsc run: not required (no edits made)**

---

## Genuinely Dead Code — Borderline, Left

**`lunes-dex-main/src/pages/docs/index.tsx` localhost strings (item 8):** Technically these are static strings inside JSX template literals rendered as documentation examples. They never execute as network calls. If the docs page were ever enhanced to a "live sandbox" that actually executes the code, they'd need to be env-var-driven. As documentation illustrations, `localhost:4000` is the correct value to show a developer. Left intentionally.

**`spot-api/src/middleware/auth.ts:91` timestamp optionality (item 3):** The `/** omit only when re-verifying legacy stored orders */` comment is a documentation note. The actual optional field is still needed because the verification function handles both old (no-timestamp) and new (with-timestamp) message formats. If a migration were run to retroactively re-sign all stored orders with the timestamp format, this optionality could be removed — but that is a data migration, not a code cleanup, and is out of scope for this pass.
