# Frontends Production Readiness Audit

**Audit date:** 2026-05-21
**Methodology:** Phase 1 docs → Phase 2 SPEC derivation → Phase 3 lint/typecheck/build → Phase 4 code verification → Phase 5 matrix.

Status legend: `COVERED` (verified file:line) · `PARTIAL` (implemented but incomplete or weak) · `MISSING` (no implementation found) · `DRIFTED` (code disagrees with docs or env templates).

---

## lunex-admin (Next.js 16.1.6 + React 19.2.3 + NextAuth v5 beta.30)

### Verification Matrix

| ID | Specification | Status | Evidence |
|----|---|---|---|
| SPEC-ADMIN-001 | NextAuth Credentials login validates against `adminUser` table with bcrypt | COVERED | `src/auth.ts:6-32` — `Credentials` provider, `bcryptjs.compare` against `passwordHash`, filters on `isActive: true`. |
| SPEC-ADMIN-002 | Session uses JWT strategy with role claim | COVERED | `src/auth.ts:34-55` — `session.strategy: 'jwt'`, `jwt`/`session` callbacks propagate `role`. |
| SPEC-ADMIN-002b | Session TTL configured | MISSING | `src/auth.ts` declares no `session.maxAge` or `jwt.maxAge`. Falls back to NextAuth default (30 days) for an admin panel that grants emergency-pause authority. |
| SPEC-ADMIN-003 | Admin routes reject unauthenticated requests | COVERED | Two gates: `middleware.ts:13-15` redirects unauth to `/login`; `src/app/(admin)/layout.tsx:12-13` server-side `auth()` + `redirect('/login')`. |
| SPEC-ADMIN-004 | Login throttled per IP and per email | COVERED | `src/app/login/actions.ts:28-41` — `checkRateLimit('login:ip:…')` AND `checkRateLimit('login:email:…')` at 5 attempts / 15 min. `src/lib/rateLimit.ts` is in-memory sliding window — single-node only; horizontal scale loses the rate limit (noted in code comment). |
| SPEC-ADMIN-005 | Login client IP derivation respects proxy headers safely | PARTIAL | `actions.ts:14-20` reads first `x-forwarded-for` token unconditionally. No `TRUST_PROXY` allowlist; if the admin is reachable directly (not only behind nginx), a client can spoof `XFF` and exhaust someone else's rate-limit bucket. spot-api has hardened `requireAdminOrInternal` against XFF spoofing — admin login does not. |
| SPEC-ADMIN-006 | Emergency page restricted to SUPER_ADMIN | COVERED | `src/app/(admin)/emergency/page.tsx:8` — `await requireRole('SUPER_ADMIN')`. |
| SPEC-ADMIN-007 | Emergency actions audited | COVERED per docs | Claimed by PRODUCTION-READINESS.md; matches `requireRole` + actions in `emergency/actions.ts`. |
| SPEC-ADMIN-010 | CSP / security headers configured at the Next layer | MISSING | `next.config.ts` is 5 lines: only `output: 'standalone'`. No `headers()` block, no CSP, no HSTS, no X-Frame, no Referrer-Policy. Headers exist only at the outer `docker/nginx.prod.conf:122-128`. Any deployment that does not front the admin with that exact nginx config (e.g. Vercel, direct Node serve) ships zero security headers. |
| SPEC-ADMIN-011 | CSP without `unsafe-inline` / `unsafe-eval` | DRIFTED | Even when the outer nginx is used, CSP allows `'unsafe-inline' 'unsafe-eval'` for `script-src` and `'unsafe-inline'` for `style-src` (`docker/nginx.prod.conf:128`). PRODUCTION-READINESS lists this as a "non-blocking polish" — for an admin panel controlling emergency pause, it is a Tier 2 weakness. |
| SPEC-ADMIN-012 | HTTPS-only / Secure cookies | PARTIAL | NextAuth v5 sets `__Secure-` cookie prefix automatically in production builds. Not explicitly verified — no `cookies` override in `auth.ts` to inspect. |
| SPEC-ADMIN-013 | Environment variable templates match code | DRIFTED | `.env.example` documents `NEXTAUTH_SECRET`, `NEXT_PUBLIC_API_URL`, `ADMIN_API_SECRET`. Code reads `AUTH_SECRET` (NextAuth v5 contract), `SPOT_API_URL`, `ADMIN_SECRET` (`src/app/(admin)/listings/actions.ts:8-9`, `emergency/actions.ts:7-8`, `dex-users/actions.ts:8`, ...). `.env.production.example` matches code; `.env.example` does not. A fresh developer copying `.env.example` to `.env.local` will have a broken login (`AUTH_SECRET` missing) and broken admin actions (`ADMIN_SECRET` missing). |
| SPEC-ADMIN-014 | Standalone build does not ship any `.env` baked in | PARTIAL | `lunex-admin/.next/standalone/lunex-admin/.env` exists and is copied into the container by `docker/Dockerfile.admin` (line `COPY --from=builder /app/.next/standalone ./`). The current value is a placeholder (`AUTH_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32`, `ADMIN_SECRET=REPLACE_…`) — better than the "weak dev secret" CONCERNS.md described — but the **bundling behavior** the CONCERNS finding called out is unchanged: the build still emits a `.env` and the Dockerfile still ships it. CONCERNS' fix ("Make the Dockerfile copy the `.env` template, not a built version") has not been applied. If any future build happens to bake a real value or a developer commits a stronger placeholder by accident, it ships. |
| SPEC-ADMIN-015 | NextAuth on a stable major | DRIFTED | `next-auth ^5.0.0-beta.30` is a pre-release on production admin code. v5 has been in beta for 18+ months but breaking changes between beta cuts are non-trivial. Either pin exactly or wait for GA. |
| SPEC-ADMIN-020 | Production lint passes | DRIFTED | `npm run lint` reports **3 errors + 2 warnings** across 3 files (`react-hooks/purity` 2× in `(admin)/margin/page.tsx`, `@typescript-eslint/no-unused-vars` 2× in `(admin)/listings/pending/page.tsx`, `@next/next/no-html-link-for-pages` in `components/app-sidebar.tsx`) **and exits 0**. Verified with `npm run lint; echo "exit=$?"` → `exit=0`. Same result with `npx eslint` directly. Either `eslint-config-next` rule levels are demoted to warn-equivalent at runtime, or the Next 16 / ESLint v9 flat-config combo has a bug — either way CI grepping `lint` exit code will not catch these. Add explicit `--max-warnings=0` to the npm script. |
| SPEC-ADMIN-021 | Production typecheck passes | COVERED | `npx tsc --noEmit` — "No errors found". |
| SPEC-ADMIN-022 | Production build succeeds | COVERED | `npm run build` (Next 16.1.6 Turbopack) compiles in 34.4s; 10 static + 8 dynamic routes generated. **Warning emitted:** multiple lockfiles (root `yarn.lock` + `lunex-admin/package-lock.json`) cause Turbopack to mis-detect workspace root. Fix with `turbopack.root` in `next.config.ts`. |
| SPEC-ADMIN-023 | Parent CI builds lunex-admin | MISSING — CRITICAL | `lunex-admin/.git/` exists (nested git repo) and `lunex-admin/` is in the parent `.gitignore`. Parent CI sees an empty directory. PRODUCTION-READINESS.md's `lunex-admin TypeScript: ✓` claim was produced from inside the nested repo manually — parent CI has never verified it. Re-confirms `.planning/codebase/CONCERNS.md` maintainability finding. |
| SPEC-ADMIN-030 | Unit / integration tests | MISSING | `find lunex-admin/src -name '*.test.*' -o -name '*.spec.*'` → 0 files. No Jest, no Vitest, no Playwright, no Cypress configured in `package.json`. The credentials flow, rate limiter, and emergency role gate have no automated coverage. |
| SPEC-ADMIN-031 | Accessibility primitives | PARTIAL | shadcn/`@base-ui/react` provide Radix-derived primitives with built-in ARIA. ~14 ARIA attributes in custom components. No WCAG audit performed; PRODUCTION-READINESS explicitly defers a11y. |
| SPEC-ADMIN-032 | i18n | MISSING | No `react-intl`/`i18next`/`next-intl` in `package.json`. Strings are hardcoded mixed pt-BR/English (e.g. `login/page.tsx:29` "Acesso Restrito" alongside "Connect Wallet"). PRODUCTION-READINESS defers as backlog. |

### Build / Lint / Typecheck results

```
LINT      : 3 errors + 2 warnings (exit 0 — npm script lacks --max-warnings flag)
TYPECHECK : OK (tsc --noEmit, 0 errors)
BUILD     : OK (Next 16.1.6 Turbopack, 34.4s; 18 routes)
WARNINGS  : multiple lockfiles → Turbopack picked wrong workspace root
```

### Production Blockers (lunex-admin)

1. **CRITICAL — Parent CI does not verify the admin panel** (SPEC-ADMIN-023). Either fold `lunex-admin/` into the main tree or pin it as a submodule with the parent CI cloning it.
2. **HIGH — `.env.example` is drifted from code** (SPEC-ADMIN-013). Three variable names disagree; new developers cannot bring up a working admin from `.env.example`.
3. **HIGH — No `next.config.ts` security headers** (SPEC-ADMIN-010). Deployment that doesn't traverse `docker/nginx.prod.conf` ships an admin with no CSP/HSTS/X-Frame/Referrer-Policy.
4. **HIGH — Session has no explicit TTL** (SPEC-ADMIN-002b). An admin JWT lives 30 days by default; for an emergency-pause-capable panel this is too long.
5. **MEDIUM — XFF spoofing on login rate limit** (SPEC-ADMIN-005). Reads `x-forwarded-for[0]` without verifying the request actually came through a trusted proxy.
6. **MEDIUM — NextAuth pinned to a v5 beta** (SPEC-ADMIN-015). Pin exact version or migrate to GA.
7. **MEDIUM — Zero automated tests** (SPEC-ADMIN-030). Credentials, rate limiter, role gate untested.
8. **MEDIUM — Lint emits 3 errors + 2 warnings AND exits 0** (SPEC-ADMIN-020). CI cannot rely on exit code; add `--max-warnings=0` to the npm script and fix the underlying findings.
9. **MEDIUM — Standalone `.env` ships in the admin Docker image** (SPEC-ADMIN-014). Today the value is a placeholder; the *bundling* behavior is the risk (a future build could bake a real value). Fix per CONCERNS.md: copy the `.env` template at runtime, not the built `.next/standalone/.../.env`.

---

## lunes-dex-main (Vite 6.3.5 + React 18.2.0)

### Verification Matrix

| ID | Specification | Status | Evidence |
|----|---|---|---|
| SPEC-DEX-001 | Wallet connect supports multiple Substrate extensions (Polkadot.js, SubWallet, Talisman, Nova) | PARTIAL | `src/context/SDKContext.tsx:271-307` calls `web3Enable('Lunex DEX')` and `web3Accounts()`. Any installed extension that responds is acceptable. **No UI provider chooser** in `src/components/wallet/ConnectWallet.tsx` (the file has no Talisman/SubWallet/Nova references). User cannot pick which extension to use; the code defaults to the first account of the first non-empty source. `connectWallet(walletSource?)` argument is never wired to a UI. |
| SPEC-DEX-002 | Pre-broadcast surface includes slippage | COVERED | `src/pages/home/index.tsx:49,156,184,297,399` — slippage state, calc via `sdk.calculateMinAmount`, settings modal, tooltip explanation. Default 0.5%. |
| SPEC-DEX-003 | Pre-broadcast surface includes fee estimate | MISSING | No `paymentInfo` / `partialFee` / `estimatedFee` callers anywhere in `src/`. Users sign without seeing chain fee. For a DEX this is a UX gap (acceptable for now if fees are sub-cent and capped, but explicitly missing). |
| SPEC-DEX-004 | Transaction signing flow uses extension injector | COVERED | `src/context/SDKContext.tsx:342-346` resolves `web3FromSource` per account; `signAndSend` invoked 9 times in `contractService.ts:371…1323`. |
| SPEC-DEX-005 | Last wallet address persisted across reloads | COVERED | `SDKContext.tsx:304-308` writes `lunex_last_wallet_address` and `lunex_last_wallet_source` to `localStorage`. |
| SPEC-DEX-006 | 404 catch-all wired | COVERED | `src/routers/index.tsx:57` — `<Route path="*" element={<NotFound />} />`. Matches PRODUCTION-READINESS claim. |
| SPEC-DEX-007 | Error boundary present | COVERED | `src/components/ErrorBoundary.tsx` exists; wraps `<AppRoutes />` in `src/App.tsx:22`. Note: PRODUCTION-READINESS reported removal of a *duplicate* `components/common/ErrorBoundary.tsx` — only the top-level one remains. |
| SPEC-DEX-008 | Wallet balance display does not invent prices | DRIFTED | `ConnectWallet.tsx:131-133` hardcodes a $0.045 LUNES price; `:140-149` hardcodes an lUSDT balance of 0.00. Misleading UX — a user looking at the wallet modal sees a fake USD number and a fake zero lUSDT balance regardless of their real on-chain holdings. |
| SPEC-DEX-009 | Spot-api offline state surfaced | COVERED per docs | README.md:1776 documents banner "Chart data unavailable — spot-api offline"; not re-verified in code in this audit. |
| SPEC-DEX-010 | Bundle splitting for heavy deps | COVERED | `vite.config.ts:52-67` — `manualChunks` for `polkadot`, `charts`, `vendor`. Confirmed in build output: `polkadot-CoBH_PKt.js 1052 kB / 388 kB gzip`, `charts 519 kB / 158 kB gzip`, `vendor 200 kB / 67 kB gzip`, `index 882 kB / 203 kB gzip`. |
| SPEC-DEX-011 | Main entry bundle within budget | DRIFTED | `index-yhxUtIxx.js` is **882 kB raw / 203 kB gzip** — past Vite's 800 kB warning threshold (which the config bumps from 500 to 800, partially hiding the warning). More importantly, **first-paint payload for any swap page = index + vendor + polkadot + charts ≈ 2.65 MB raw / 816 kB gzip** — that is the LCP number that matters on mobile. `pages/docs/index.tsx` alone is 3417 lines and is statically imported by `routers/index.tsx:18`; route-splitting it would cut a large chunk off cold-load. |
| SPEC-DEX-012 | Console drops in prod build | COVERED | `vite.config.ts:71-73` — `esbuild.drop: ['console','debugger']` when mode=production. |
| SPEC-DEX-013 | env template documents all required vars | COVERED | `lunes-dex-main/.env.production.example` (1.7 KB) enumerates network, RPC, API URL, 9 contract addresses, 7 token addresses, 5 LP pair addresses, feature flags. |
| SPEC-DEX-013b | `DISABLE_ESLINT_PLUGIN=true` in prod env | DRIFTED | `.env.production.example:54` carries the CRA-era escape hatch. Vite does not consume it (no `eslint-plugin` is configured in `vite.config.ts`). The variable is dead but its presence signals an unfinished migration from CRA. |
| SPEC-DEX-020 | Production lint passes | COVERED | `eslint 'src/**/*.{ts,tsx}' --max-warnings=0` returns exit 0 with no output. Note: running `npm run lint` via the RTK proxy surfaces parsing errors on root `test-debug.js`, `test-pointer.js`, `test-radius.js`, `test-script.js` — these are dev scratch files (each is a 1-line `console.log`) that the configured glob excludes but tooling sometimes picks up. They should be deleted, not left at the repo root. |
| SPEC-DEX-021 | Production build succeeds | COVERED | `tsc --noEmit && vite build` succeeds in 42.6s; 5912 modules transformed. Build emits non-fatal Rollup warnings about `/*#__PURE__*/` comment positions in 14 `@polkadot/x-global` copies — cosmetic. |
| SPEC-DEX-022 | No duplicate @polkadot/x-global resolution | DRIFTED | The Rollup warning surfaces because **multiple `@polkadot/x-global` copies** ship in the bundle (each polkadot sub-package has nested `node_modules/@polkadot/x-global`). Bundle bloat; resolvable via `npm dedupe` or root `resolutions`. |
| SPEC-DEX-023 | Parent CI builds lunes-dex-main | COVERED | `lunes-dex-main/.git` does not exist; the directory is tracked by the parent repo (unlike lunex-admin). |
| SPEC-DEX-030 | Unit / integration / E2E tests | MISSING | `find lunes-dex-main/src -name '*.test.*' -o -name '*.spec.*'` → 0 files. No Jest, no Vitest, no Playwright, no Cypress in `package.json`. README.md:1752 only documents "TypeScript check" as the test for the frontend. Wallet flow, swap flow, slippage calculation, contract-call retry — none covered. |
| SPEC-DEX-031 | Accessibility primitives | MISSING | `grep aria-/role=` in `src/components/wallet` and `src/pages/home` → 0 hits. Modal in `ConnectWallet.tsx:88-166` uses a `div` overlay with no `role="dialog"`, no `aria-modal`, no focus trap. PRODUCTION-READINESS explicitly defers full a11y. |
| SPEC-DEX-032 | i18n | MISSING | No `react-intl`/`i18next` in `package.json`. Strings are mixed pt-BR ("A quantia mínima garantida que você receberá…" `pages/home/index.tsx:297`) and English ("Connect Wallet", "Disconnect Wallet"). PRODUCTION-READINESS lists as backlog. |
| SPEC-DEX-033 | Mobile responsive | PARTIAL | styled-components throughout; no central responsive token system surfaced. Not exercised in this audit. |
| SPEC-DEX-034 | Service files within maintainability ceiling | DRIFTED | `pages/docs/index.tsx` **3417 LOC**, `services/contractService.ts` **1376 LOC**, `context/SDKContext.tsx` **1005 LOC**. CONCERNS.md flags both as performance/maintainability hotspots. Any single mistake in `contractService.ts` impacts every contract call. |
| SPEC-DEX-035 | CSP headers on internal nginx | MISSING | `lunes-dex-main/nginx.spa.conf` (19 lines) sets gzip + cache-control only — no `Content-Security-Policy`, no `X-Frame-Options`, no HSTS. Security comes only from the outer `docker/nginx.prod.conf` proxy. As with admin, any deployment that doesn't traverse that proxy ships unprotected. |
| SPEC-DEX-036 | CSP without `unsafe-inline` / `unsafe-eval` | DRIFTED | Same as SPEC-ADMIN-011 — outer nginx CSP still allows both. |
| SPEC-DEX-037 | Dev-only scratch files removed | MISSING | `test-debug.js`, `test-pointer.js`, `test-radius.js`, `test-script.js`, `test.js` at the project root are all 1-line `console.log` scratch from "debugging why connect wallet is unclickable". They are not in `.gitignore`. Either delete or move to a `scripts/` dir. |

### Build / Lint results

```
LINT  : eslint 'src/**/*.{ts,tsx}' --max-warnings=0 → exit 0, no findings
BUILD : tsc --noEmit && vite build → exit 0, 42.58s, 5912 modules
  build/index.html                       1.18 kB  ─  0.58 kB gzip
  build/assets/vendor-Bg6aeXOC.js      200.52 kB  ─ 67.31 kB gzip
  build/assets/charts-SsldyP1G.js      519.15 kB  ─ 157.86 kB gzip
  build/assets/index-yhxUtIxx.js       881.77 kB  ─ 203.48 kB gzip
  build/assets/polkadot-CoBH_PKt.js  1,052.28 kB  ─ 388.21 kB gzip
WARNINGS: 14× @polkadot/x-global duplicate-copy pure-annotation warnings
WARNINGS: 1× chunk-size warning (raised limit, still triggered)
```

### Production Blockers (lunes-dex-main)

1. **HIGH — Wallet modal fakes balances and USD prices** (SPEC-DEX-008). `ConnectWallet.tsx:131,140-149` shows `$ balance × 0.045` and hardcodes lUSDT=0. Fix before any user interacts with mainnet.
2. **HIGH — Wallet provider chooser absent** (SPEC-DEX-001). README and INTEGRATIONS.md promise SubWallet/Talisman/Nova/Polkadot.js; the UI gives no way to pick. The `walletSource` parameter is dead.
3. **HIGH — Zero automated tests** (SPEC-DEX-030). Swap, slippage, signing, retry — uncovered.
4. **HIGH — Internal nginx ships zero security headers** (SPEC-DEX-035). Any deploy that bypasses the outer prod proxy is exposed.
5. **MEDIUM — Main bundle 882 kB raw / 203 kB gzip** (SPEC-DEX-011). Past warning threshold; primarily `pages/docs/index.tsx` (3417 LOC) — should be route-split.
6. **MEDIUM — Hardcoded mixed pt-BR / English strings** (SPEC-DEX-032). Inconsistent UX before any i18n work.
7. **MEDIUM — Transaction signing surface omits fee estimate** (SPEC-DEX-003). Users sign blind on gas.
8. **LOW — `DISABLE_ESLINT_PLUGIN=true` carried over from CRA** (SPEC-DEX-013b). Cosmetic but signals migration debris.
9. **LOW — `test-*.js` scratch files at repo root** (SPEC-DEX-037). Delete.
10. **LOW — Duplicated @polkadot/x-global copies** (SPEC-DEX-022). Bundle bloat; `npm dedupe`.

---

## Cross-Cutting (both frontends)

### React 18 vs 19 skew
- `lunes-dex-main` pins `react@18.2.0`, `lunex-admin` pins `react@19.2.3`. They cannot share a component library cleanly; `useTransition`/`useActionState`/`use()` differ. Already flagged in CONCERNS.md maintainability section.

### ESLint / TypeScript ESLint skew
- Root `.eslintrc.js` uses `eslint ^7.26.0` + `@typescript-eslint ^4.8.2` (very old).
- `lunes-dex-main` uses `eslint ^8.57.1` + `@typescript-eslint ^8.39.0`.
- `lunex-admin` uses `eslint ^9` + `eslint-config-next 16.1.6`.
- Three lint rule sets, three upgrade paths. A change at the root level cannot enforce a rule across the two frontends.

### Test stack absent
- Neither frontend has Jest, Vitest, Playwright, Cypress, or Testing Library installed. README.md:1752 explicitly says the frontend "test" is `tsc --noEmit`. No protection against regressions in wallet, swap, sign, retry, route-guard logic.

### Submodule git isolation impact on CI
- `lunex-admin/.git/` is a nested repo; `.gitignore` excludes `lunex-admin/`. Parent CI cannot type-check, lint, build, or test the admin. PRODUCTION-READINESS.md's "lunex-admin TypeScript: ✓" line was produced from inside the nested repo. Two histories drift independently; a parent-repo rollback does not roll admin back. This is the single largest deployment-trust gap in the frontends.

### CSP / security headers only at the outer nginx
- Both frontends defer all security headers to `docker/nginx.prod.conf`. Inner `nginx.spa.conf` and `next.config.ts` set no CSP. Deployments that don't use the prod nginx (Vercel, direct Node, alt-reverse-proxy) ship unprotected.

### `unsafe-inline` and `unsafe-eval` in prod CSP
- Outer nginx CSP allows both `'unsafe-inline'` and `'unsafe-eval'` for `script-src`, and `'unsafe-inline'` for `style-src`. PRODUCTION-READINESS classifies this as "non-blocking polish". For an admin panel that holds emergency-pause authority and a DEX that signs financial transactions, this is at minimum Tier 2.

### No browser E2E coverage
- No Playwright, no Cypress, no Selenium anywhere in the repo. Wallet connect, swap quote, slippage rejection, settlement confirmation, emergency pause — none verified by an automated browser. Manual smoke testing only.

---

## Prioritized Production Blockers

1. **[CRITICAL] Parent CI cannot verify lunex-admin.** `lunex-admin/.git` + `.gitignore: lunex-admin/`. Either fold into the main tree or pin as a submodule with CI cloning. Today, every "✓" claim about the admin is unverifiable from the parent repo. (SPEC-ADMIN-023)
2. **[CRITICAL] Wallet modal shows fake balances and a hardcoded USD price.** `lunes-dex-main/src/components/wallet/ConnectWallet.tsx:131-149`. Ship before this is fixed and the first user thinks they have $X. (SPEC-DEX-008)
3. **[HIGH] Admin `.env.example` is drifted from code.** Three variable names disagree with what the source actually reads. Fresh developer cannot bring the admin up; ops cannot trust the template. (SPEC-ADMIN-013)
4. **[HIGH] No session TTL on admin JWT.** Defaults to 30 days for an emergency-pause-authority panel. Set `session.maxAge` to ≤ 8h with rolling refresh. (SPEC-ADMIN-002b)
5. **[HIGH] Wallet provider chooser missing in the DEX UI.** README/INTEGRATIONS promise SubWallet/Talisman/Nova/Polkadot.js. UI gives no way to pick. (SPEC-DEX-001)
6. **[HIGH] Security headers only at the outer nginx.** No `next.config.ts headers()` block, no headers in `nginx.spa.conf`. Any deployment that bypasses `docker/nginx.prod.conf` (Vercel, direct Node) ships an admin and DEX with zero CSP/HSTS/X-Frame. (SPEC-ADMIN-010, SPEC-DEX-035)
7. **[HIGH] Zero automated tests on either frontend.** No unit, no integration, no E2E. Credentials, rate limiter, role gate, wallet connect, swap, slippage, retry — uncovered. (SPEC-ADMIN-030, SPEC-DEX-030)
8. **[HIGH] CSP still allows `unsafe-inline` / `unsafe-eval`.** PRODUCTION-READINESS defers this; for an admin with emergency authority and a DEX signing financial txs it is Tier 2 at best. (SPEC-ADMIN-011, SPEC-DEX-036)
9. **[MEDIUM] Login rate limit reads spoofable `x-forwarded-for[0]`.** Add a trusted-proxy allowlist or use `request.ip` derived from a vetted source. (SPEC-ADMIN-005)
10. **[MEDIUM] NextAuth pinned to v5 beta.30.** Pin exact or wait for GA before mainnet. (SPEC-ADMIN-015)
11. **[MEDIUM] Transaction signing UI omits fee estimate.** Add `paymentInfo`/`partialFee` lookup before broadcast. (SPEC-DEX-003)
12. **[MEDIUM] Main DEX bundle 882 kB raw / 203 kB gzip.** Split `pages/docs/index.tsx` (3417 LOC) into a separate lazy route. (SPEC-DEX-011)
13. **[MEDIUM] Mixed pt-BR / English strings; no i18n library.** PRODUCTION-READINESS defers as backlog — flag for mainnet UX. (SPEC-ADMIN-032, SPEC-DEX-032)
14. **[MEDIUM] React 18 vs 19 skew + ESLint 7/8/9 skew across the two frontends.** Pick a target and converge. (Cross-cutting.)
15. **[MEDIUM] Admin lint emits 3 errors + 2 warnings AND exits 0.** Verified empirically. CI cannot rely on the exit code. Add `--max-warnings=0` to the npm script and fix the underlying findings. (SPEC-ADMIN-020)
16. **[MEDIUM] Admin standalone `.env` ships in the Docker image.** `Dockerfile.admin` copies `/app/.next/standalone ./` which includes the placeholder `.env`. Bundling behavior is the risk. (SPEC-ADMIN-014)
17. **[LOW] DEX repo root holds `test-*.js` scratch files** from past debugging. Delete. (SPEC-DEX-037)
18. **[LOW] DEX bundle has duplicated `@polkadot/x-global` copies.** `npm dedupe` or root `overrides`. (SPEC-DEX-022)
19. **[LOW] `DISABLE_ESLINT_PLUGIN=true` carried in Vite env.** CRA-era; dead. (SPEC-DEX-013b)

---

*Audit produced 2026-05-21. Builds + lint + typecheck re-run on this date.*
