# Coding Conventions

**Analysis Date:** 2026-05-21

## Overview

Lunex is a multi-language monorepo: Rust (ink! smart contracts + native simulation crates) plus several TypeScript packages (`spot-api`, `lunes-dex-main`, `sdk`, `mcp/lunex-agent-mcp`, `subquery-node`, `lunex-admin`). Conventions split into:

- **Root TypeScript** (typechain integration tests, deploy scripts): strict, governed by `/.eslintrc.js` (TS-strict).
- **Per-package TypeScript** (`spot-api`, frontend, sdk, mcp): permissive, each owns a local `.eslintrc.cjs`.
- **Rust** (workspace + ink! contracts): governed by `.rustfmt.toml` and `rust-toolchain.toml` (channel `1.85.0`).
- **Tooling**: Prettier (TS) and `cargo fmt` (Rust), Conventional Commits, SDD docs flow.

## Linting & Formatting

### Prettier (root `.prettierrc`)

```json
{
  "printWidth": 80,
  "semi": true,
  "singleQuote": true,
  "quoteProps": "consistent",
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

- 80-column hard wrap.
- Semicolons required.
- Single quotes for strings; consistent quoting for object keys.
- Trailing comma everywhere (`"all"`).
- Always parenthesize arrow params: `(x) => ...`.

`.prettierignore`: `node_modules`, `artifacts`, `types`, `target`, `.github`.

### ESLint — Root (`/.eslintrc.js`) — strict mode

Applies to typechain integration tests under `tests/` and root deploy scripts.

- Extends: `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `plugin:prettier/recommended`, `plugin:jest/recommended`.
- Parser project: `./tsconfig.json` (type-aware linting).
- **Naming convention enforced via `@typescript-eslint/naming-convention`:**
  - `variableLike` / `memberLike` / `property` / `method` / `parameter`: `strictCamelCase`.
  - `variable`: `strictCamelCase` or `UPPER_CASE` (for constants).
  - `enumMember` / `typeLike` / `typeParameter`: `StrictPascalCase`.
  - Unused parameters must start with `_` (`leadingUnderscore: 'require'`).
- **Hard rules:**
  - `@typescript-eslint/explicit-function-return-type`: `error` — public functions must declare return types.
  - `@typescript-eslint/explicit-module-boundary-types`: `error` — exported functions must declare all input/output types.
  - `@typescript-eslint/no-explicit-any`: `error` — no `any` (use `unknown`).
  - `@typescript-eslint/require-await`: `error` — `async fn` must contain `await`.
  - `dot-notation`: enforced (with snake_case allowance for foreign keys).
- `@typescript-eslint/ban-ts-comment`: off (test helpers may suppress).

`.eslintignore`: `node_modules`, `target`, `types`.

### ESLint — Per-package (`*/.eslintrc.cjs`) — permissive mode

`spot-api/.eslintrc.cjs`, `lunes-dex-main/.eslintrc.cjs`, `sdk/.eslintrc.cjs`, `mcp/lunex-agent-mcp/.eslintrc.cjs`:

- Extends `eslint:recommended` only (no `@typescript-eslint/recommended`).
- `@typescript-eslint/no-explicit-any`: **off** (relaxed for product code).
- `@typescript-eslint/no-unused-vars`: error, with `argsIgnorePattern: '^_'` / `varsIgnorePattern: '^_'`.
- No naming-convention enforcement at package level (relies on Prettier + reviewer discipline).
- `lunes-dex-main` also loads `react-hooks` plugin and `env: { browser: true }`.

**Implication for new code:**

- Code in `tests/*.spec.ts`, `scripts/*.ts`: write to root strict ruleset (camelCase, no `any`, explicit return types).
- Code in `spot-api/src/**`, frontend, sdk, mcp: still write strict by hand — root ESLint will NOT lint these files, but CONTRIBUTING.md requires "no `any` except documented exceptions" and TypeScript strict mode.

### Rustfmt (`.rustfmt.toml`) — uses unstable features

Key settings (`unstable_features = true`, edition `2021`):

- `max_width = 100`, `comment_width = 80`, `tab_spaces = 4`, block indent.
- `imports_layout = "Vertical"`, `imports_granularity = "Crate"` — one import per line, grouped by crate root.
- `reorder_imports = true`, `reorder_modules = true`.
- `trailing_comma = "Vertical"`, `trailing_semicolon = false`, `match_block_trailing_comma = false`.
- `combine_control_expr = false`, `force_multiline_blocks = true`, `control_brace_style = "AlwaysSameLine"`.
- `use_try_shorthand = true`, `use_field_init_shorthand = true`, `merge_derives = true`.
- `format_strings = false`, `format_code_in_doc_comments = false`, `wrap_comments = false`.
- `format_macro_bodies = true`, `format_macro_matchers = false`.
- `blank_lines_upper_bound = 1`, `force_explicit_abi = true`.

Run with `cargo +nightly fmt --all` (unstable options require nightly) OR via `npm run lint:fix` which calls `cargo fmt --all`.

### Lint commands

```bash
# Root (validates everything)
npm run lint        # prettier --check . && eslint . && cargo check
npm run lint:fix    # prettier --write . && eslint . --fix && cargo fmt --all

# spot-api
cd spot-api && npm run lint            # eslint "src/**/*.ts"
cd spot-api && npm run lint:fix
cd spot-api && npm run quality         # lint + deadcode (ts-prune, depcheck) + prettier --check
cd spot-api && npm run format:check
cd spot-api && npm run format:write
```

CI (`/.github/workflows/ci.yml`) runs `npx tsc --noEmit` and `npm run lint --if-present` per TS package.

## Naming Conventions

### TypeScript

- **Files:** `camelCase.ts` for modules (`tradeService.ts`, `walletRiskService.ts`); `PascalCase.tsx` for React components in `lunes-dex-main`.
- **Test files:** `*.test.ts` (unit, co-located in `src/__tests__/`) and `*.e2e.test.ts` (top-level `__tests__/` in `spot-api`); root typechain integration uses `*.spec.ts`.
- **Variables / functions / methods / properties:** `strictCamelCase` (root rule). Examples: `orderbookBootstrapService`, `processNewTradeSettlements`.
- **Module-level constants:** `UPPER_CASE` (e.g. `MINIMUM_LIQUIDITY`, `MOCK_API_KEY`).
- **Types / interfaces / classes / enums / type parameters:** `StrictPascalCase` — `OrderStatus`, `PairModel`, `WalletRiskService`.
- **Enum members:** `StrictPascalCase` (NOT `UPPER_CASE`).
- **Unused params:** prefix with `_` (`_req`, `_ctx`).
- **Imports:** use generated Prisma types and typechain types directly — never cast DB results to `any` (CONTRIBUTING.md).

### Rust (ink! contracts + simulation crates)

- **Crate names:** snake_case matching directory (`asymmetric_pair`, `copy_vault`, `liquidity_lock`, `listing_manager`, `spot_settlement`, `wnative`). Listed in root `Cargo.toml [workspace] members`.
- **Modules / functions / variables:** `snake_case` — `swap_token_1_for_token_0`, `price_0_cumulative_last`, `get_amount_out`.
- **Types / enums / traits:** `PascalCase` — `PairContract`, `PairModel`, `PSP22Error`.
- **Constants / statics:** `SCREAMING_SNAKE_CASE`.
- **Test modules:** `mod tests { ... }` inside `#[cfg(test)]` blocks at the bottom of each `lib.rs`.
- **Fuzz target binaries:** `snake_case` matching `fuzz/fuzz_targets/<name>.rs` (`pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay`).

### Directory & file organization

- Contracts: `Lunex/contracts/<contract-name>/lib.rs` plus `Cargo.toml`. One `lib.rs` per contract (some exceed 60KB — e.g. pair `lib.rs` is ~70KB).
- TS service layer: `spot-api/src/services/<thing>Service.ts`.
- TS routes: `spot-api/src/routes/<resource>.ts` (singular file, plural route nouns).
- TS middleware: `spot-api/src/middleware/<name>.ts`.
- Generated typechain types in `types/` (gitignored from lint).
- Build artifacts in `target/`, `dist/`, `build/`, `artifacts/` (all ignored by linters/formatters).

## Import Organization

### TypeScript

Observed pattern in `spot-api/src/index.ts`:

1. Node/runtime built-ins (`crypto`, `path`).
2. Third-party packages (`express`, `cors`, `helmet`, `@polkadot/...`, `@prisma/client`).
3. Internal config / db (`./config`, `./db`).
4. Internal infrastructure (`./websocket/...`, `./middleware/...`, `./utils/...`).
5. Route modules (`./routes/<resource>`).

Use `import` (ESM-style) with single quotes; semicolons required. `import type { ... }` for type-only imports where strict mode requires it. No barrel files observed at the package root — explicit per-module imports.

### Rust

`.rustfmt.toml` sets:

- `imports_granularity = "Crate"` — collapse multiple uses from same crate root.
- `imports_layout = "Vertical"` — one item per line.
- `reorder_imports = true` — sorted alphabetically within each block.
- `reorder_modules = true`.

`lib.rs` files commonly start with `#![cfg_attr(not(feature = "std"), no_std, no_main)]` plus contract-specific `#![allow]` / `#![warn]` lints, then `use ink::env::...`, then crate-local `use` statements.

## Code Comments & Documentation

### TypeScript

- JSDoc block above exported services / public functions (observed in `spot-api/__tests__/tradeApi.e2e.test.ts`, etc.):
  ```typescript
  /**
   * Trade API E2E Tests
   *
   * Tests agent trade execution: swap, limit order, cancel, portfolio.
   */
  ```
- Inline `//` comments allowed but kept short.
- Section banners with `// =====` blocks used in Rust; less common in TS.
- Comment language is **mixed** (English + Portuguese) — Rust contracts frequently use Portuguese banners (e.g. `// TESTES DE INICIALIZAÇÃO`, `// PSP22 ERROR TYPE (DEFINIDO LOCALMENTE)`); TS code is mostly English.

### Rust

- `///` doc comments on public items (functions, enums, structs).
- `//!` module-level docs at top of `lib.rs`.
- `// ========================================` ASCII banners delimit logical sections (init / swaps / LP / access control / tests). See `Lunex/contracts/pair/lib.rs:1515-1565`.
- `wrap_comments = false`, `format_code_in_doc_comments = false`, `normalize_comments = true` — keep comments raw and let the author wrap.
- Crate-level lint attributes belong at the very top of `lib.rs`:
  ```rust
  #![cfg_attr(not(feature = "std"), no_std, no_main)]
  #![allow(unexpected_cfgs)]
  #![allow(clippy::cast_possible_truncation)]
  #![warn(clippy::arithmetic_side_effects)]
  ```

## Error Handling Conventions

(Mirrored from `CONTRIBUTING.md` — these are enforced via review, not lint.)

### Backend (Express)

- Always use `next(err)` in catch blocks; never return inline 500 JSON.
- `catch (err: unknown)` (not `any`).
- Standard error response shape: `{ error, code, details? }`.

```typescript
router.get('/resource', async (req, res, next) => {
  try {
    const data = await service.getData()
    res.json(data)
  } catch (err) { next(err) }
})
```

### Frontend

```typescript
} catch (err: unknown) {
  setError((err as Error).message || 'Operation failed')
}
```

### Validation

All route handlers must validate input with **Zod** before use:

```typescript
const schema = z.object({ address: z.string().min(1), amount: z.coerce.number().positive() })
const parsed = schema.safeParse(req.body)
if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
```

### Database (Prisma)

- Use `Prisma.<Model>WhereInput` types; never `any`.
- Avoid N+1: batch with `groupBy` / `findMany({ where: { in: [...] } })`.

### Rust

- Custom error enums (e.g. `PSP22Error`) decorated with `#[derive(scale::Encode, scale::Decode)]` and `#[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]`.
- Functions return `Result<T, ContractError>` — `use_try_shorthand = true` so `?` propagation is preferred over `match`.
- Use `#[warn(clippy::arithmetic_side_effects)]` on contracts that do balance math; favour `checked_*` operations.

## Logging Conventions

- **`spot-api`**: structured logging via `pino` exported from `src/utils/logger.ts`.
  ```typescript
  import { log } from '../utils/logger'
  log.info({ orderId, pairSymbol }, '[Order] Created successfully')
  log.error({ err, orderId }, '[Order] Failed to create')
  ```
- Bracketed module tag prefix (`[Order]`, `[Trade]`) as the message; structured fields as the first argument.
- Dev-only `console.log` guarded with `if (process.env.NODE_ENV !== 'production')`.
- Frontend: `console.*` allowed (no enforcement).

## API Design Rules (from CONTRIBUTING.md §"API Design Rules")

1. Routes use nouns: `/orders` not `/createOrder`.
2. Every catch block routes through `next(err)`.
3. Always include radix in `parseInt(str, 10)`.
4. Cap pagination: `Math.min(parseInt(str, 10) || 50, 200)`.
5. `201` for resource-creating POST, `204` (or 200 + deleted body) for DELETE.
6. Error responses always include `{ error, code, details? }`.
7. Admin routes mount `requireAdmin` middleware; never echo `ADMIN_SECRET` in responses.

## Function & Module Design

- Functions: explicit return types required (root strict ESLint); per-package code follows convention by inference.
- Modules: prefer per-feature service files (`src/services/<thing>Service.ts`) over multi-export barrels.
- Prefer `type` over `interface` for plain data shapes (CONTRIBUTING.md).
- Use `unknown` instead of `any` in catch blocks.

## Git Workflow

### Branch naming

```bash
feature/<description-or-ticket>     # e.g. feature/ink-5.1.1-migration
dependabot/<ecosystem>/<package>    # auto-generated dependency PRs
```

Active branches observed in repo: `main`, `feature/ink-5.1.1-migration`, plus 24 `dependabot/*` remote branches (`dependabot/cargo/ink-5.1.1`, `dependabot/github_actions/actions/cache-5`, `dependabot/npm_and_yarn/...`, etc.). Default trunk is `main`; CI also runs on `develop` (`.github/workflows/ci.yml:5`).

CONTRIBUTING.md prescribes `feature/TICKET-description`.

### Commit message convention — Conventional Commits

Format: `type(scope): subject`.

Allowed types: `feat | fix | docs | refactor | test | chore | perf | security | ci`.

Recent examples from `git log`:

```text
feat(infra): sandbox testnet deploy + VPS setup scripts + token distribution
fix(frontend): restore original connect wallet modal design
fix(asymmetric): auto-instantiate contract — remove manual address input
chore: remove dead code and unused imports
ci: fix incorrect paths for contracts and rust test workspace
docs: rewrite README with full local/production setup guide
feat(ui): refine wallet integration, spot trading API, and standardise DEX frontend UX
```

**Historical noise to avoid:** the log contains legacy entries that violate the rule (`add fiz marge`, `marge`, `up`, emoji-prefixed all-caps headlines like `🎉 ATUALIZAÇÃO FINAL DO PROJETO`). New work must follow Conventional Commits — no emoji-only or short non-typed messages.

### PR gate (CONTRIBUTING.md §"Before Opening a PR")

- [ ] `yarn typecheck` → 0 errors
- [ ] `yarn lint` → 0 warnings on changed files
- [ ] `yarn test` → all pass
- [ ] Admin endpoints have `requireAdmin`
- [ ] All catch blocks use `next(err)`
- [ ] New env vars added to `.env.example`
- [ ] `docs/API.md` updated when routes change

## SDD Workflow (feature documentation)

CONTRIBUTING.md §"SDD Workflow" requires for non-trivial features:

1. `docs/features/<feature-slug>/PRD.md`
2. `docs/features/<feature-slug>/SPEC.md`
3. `docs/features/<feature-slug>/TASKS.md`
4. Update `docs/prd/PROJECT_PRD.md` / `docs/specs/PROJECT_SPEC.md` when cross-cutting.

Templates live in `docs/sdd/templates/`. Bug fixes can skip the full PRD but still need a minimal spec/test plan.

## Authentication Conventions Matrix

| Operation               | Auth                 | Pattern                               |
|-------------------------|----------------------|---------------------------------------|
| Read public data        | None                 | —                                     |
| Wallet-signed mutations | sr25519 sig + nonce  | `verifyWalletActionSignature()`       |
| Admin ops               | Bearer token         | `requireAdmin` middleware             |
| AI agent trades         | API key              | `agentAuth(['TRADE_SPOT'])`           |

## Where Strict vs. Permissive Applies (quick lookup)

| Location                                   | ESLint config                          | `no-explicit-any` |
|--------------------------------------------|----------------------------------------|-------------------|
| `tests/**/*.spec.ts`, root `scripts/`      | `/.eslintrc.js` (strict)              | `error`           |
| `spot-api/src/**`                          | `spot-api/.eslintrc.cjs`              | off               |
| `lunes-dex-main/src/**`                    | `lunes-dex-main/.eslintrc.cjs`        | off               |
| `sdk/src/**`                               | `sdk/.eslintrc.cjs`                   | off               |
| `mcp/lunex-agent-mcp/src/**`               | `mcp/lunex-agent-mcp/.eslintrc.cjs`   | off               |

When adding new shared/root-level TS (e.g. another integration spec under `tests/`), inherit the strict ruleset; when adding code inside a sub-package, you may locally pragma — but CONTRIBUTING.md still bans `any` by convention.

---

*Convention analysis: 2026-05-21*
