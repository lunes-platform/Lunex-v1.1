# Testing Patterns

**Analysis Date:** 2026-05-21

## Test Stacks (one per language layer)

Lunex has **three distinct test stacks**. Pick the right one based on what you are testing.

| Stack                          | Tool                                | Location                                                                                 | Run command                                                          |
|--------------------------------|-------------------------------------|------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| ink! contract unit tests       | `cargo test` + `ink::test`          | `Lunex/contracts/<contract>/lib.rs` (`#[cfg(test)] mod tests`)                            | `cargo test --workspace --exclude fuzz`                              |
| Native simulation / integration / security / stress | `cargo test --test <name>` | `tests/*.rs`                                                                              | `npm run test:integration` / `test:e2e` / `test:security` / `test:stress` |
| Smart-contract fuzz            | `cargo fuzz` (libFuzzer)            | `fuzz/fuzz_targets/*.rs`                                                                  | `cd fuzz && cargo fuzz run <target>`                                 |
| Typechain end-to-end (Polkadot)| Jest + `ts-jest`                    | `tests/*.spec.ts` (root)                                                                  | `npm run test:typechain`                                             |
| `spot-api` unit tests          | Jest + `ts-jest` + `supertest`      | `spot-api/src/__tests__/*.test.ts`                                                        | `cd spot-api && npm run test:unit`                                   |
| `spot-api` e2e tests           | Jest + `supertest`                  | `spot-api/__tests__/*.e2e.test.ts`                                                        | `cd spot-api && npm run test:e2e`                                    |
| MCP unit                       | Jest                                | `mcp/lunex-agent-mcp/src/*.test.ts`                                                       | (package-local)                                                      |

## Root Jest config

`/jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 20000,
  globalSetup: './tests/globalSetup.ts',
  globalTeardown: './tests/globalTeardown.ts',
};
```

- `globalSetup` (`tests/globalSetup.ts`) connects to a local Polkadot node (`ws://127.0.0.1:9944`), creates `ApiPromise`, and seeds the keyring with `//Alice` and `//Bob`. Exposes them via `globalThis.setup = { api, alice, bob }`.
- `globalTeardown` (`tests/globalTeardown.ts`) calls `globalThis.setup.api.disconnect()`.
- 20-second per-test timeout (chain calls are slow).
- Used by `npm run test:typechain` which matches `.spec.ts$` and runs `--runInBand` (serial — they share the same chain node).

## spot-api Jest config

`spot-api/jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 15000,
}
```

Note: `roots: ['<rootDir>/src']` — this **only picks up unit tests under `src/__tests__/`**. The e2e suites under top-level `spot-api/__tests__/` (e.g. `tradeApi.e2e.test.ts`, `agent.e2e.test.ts`, `governance.e2e.test.ts`, `affiliate.test.ts`) are NOT matched by this config and are run via the script-level Jest invocations (`npm run test:e2e` uses `--testPathPattern e2e`).

## Test file naming

### TypeScript

| File pattern             | Meaning                                                     | Example                                                                 |
|--------------------------|-------------------------------------------------------------|-------------------------------------------------------------------------|
| `*.spec.ts`              | Root typechain integration spec (uses Polkadot node)        | `tests/Dex.spec.ts`                                                     |
| `*.test.ts`              | spot-api **unit** test (co-located in `src/__tests__/`)     | `spot-api/src/__tests__/tradeService.test.ts`                           |
| `*.e2e.test.ts`          | spot-api **e2e** test (top-level `__tests__/` with HTTP)    | `spot-api/__tests__/tradeApi.e2e.test.ts`                               |
| `*.test.ts` (top-level)  | spot-api integration test that bypasses unit `roots` filter | `spot-api/__tests__/affiliate.test.ts`, `botSandbox.test.ts`             |

189 `.test.ts`/`.spec.ts` files in spot-api alone; 45 distinct `.test.ts` paths excluding node_modules.

### Rust

- Unit tests: `#[cfg(test)] mod tests { ... }` at bottom of each contract's `lib.rs`. Use `#[ink::test]` for ink-aware tests (provides default accounts, block timestamp, caller mocking).
- Integration tests: free files under `tests/<name>.rs` at workspace root. Each file becomes its own test binary callable via `cargo test --test <name>`.
- Fuzz targets: `fuzz/fuzz_targets/<name>.rs`, declared as `[[bin]]` in `fuzz/Cargo.toml`.

## Directory structure

```
/                              workspace root
├── jest.config.js             root Jest (typechain spec runner)
├── tests/                     root test suite
│   ├── globalSetup.ts         Polkadot WS connect + keyring
│   ├── globalTeardown.ts      api.disconnect()
│   ├── testHelpers.ts         emit(), revertedWith(), parseUnits(),
│   │                          changeTokenBalances()
│   ├── Dex.spec.ts            typechain end-to-end (factory + pair + router + tokens)
│   ├── integration_e2e.rs     Rust integration suite
│   ├── e2e_flow_simulation.rs
│   ├── lunex_complete_integration_test.rs
│   ├── staking_integration_tests.rs
│   ├── complete_staking_rewards_integration.rs
│   ├── usability_native_psp22_tests.rs
│   ├── property_security_invariants.rs   handwritten property/invariant suite
│   ├── openzeppelin_security_validation.rs
│   ├── security_tests.rs
│   └── stress_tests.rs
├── fuzz/                      cargo-fuzz workspace (isolated, NOT in root workspace)
│   ├── Cargo.toml             three [[bin]] targets, libfuzzer-sys = "0.4"
│   ├── fuzz_targets/
│   │   ├── pair_invariant.rs              k*x invariant on swaps
│   │   ├── copy_vault_accounting.rs       copy-vault share accounting
│   │   └── spot_settlement_replay.rs      settlement replay attack
│   └── corpus/                seed inputs (per-target subdirs)
├── spot-api/
│   ├── jest.config.js
│   ├── __tests__/             e2e / integration (matched by --testPathPattern)
│   │   ├── tradeApi.e2e.test.ts
│   │   ├── agent.e2e.test.ts
│   │   ├── governance.e2e.test.ts
│   │   ├── affiliate.test.ts
│   │   └── botSandbox.test.ts
│   └── src/
│       └── __tests__/         unit tests (matched by roots: src)
│           ├── tradeService.test.ts
│           ├── orderbook.test.ts
│           ├── copytradeService.test.ts
│           ├── walletRiskService.test.ts
│           ├── ...            (~40 unit files)
└── mcp/lunex-agent-mcp/src/
    └── routerTools.test.ts    MCP tool unit test
```

## Test commands (canonical reference)

From root `package.json`:

```bash
npm run test:typechain      # jest --testPathPattern ".spec.ts$" --runInBand  (root Jest)
npm run test:single         # jest                                            (root Jest, single file)
npm run test:unit           # cargo test                                      (Rust workspace unit)
npm run test:integration    # cargo test --test integration_tests
npm run test:e2e            # cargo test --test e2e_tests
npm run test:security       # cargo test --test security_tests
npm run test:stress         # cargo test --test stress_tests
```

From `spot-api/package.json`:

```bash
cd spot-api
npm test                  # jest --forceExit --detectOpenHandles
npm run test:unit         # jest --testPathIgnorePatterns /__tests__/e2e/ --forceExit --detectOpenHandles
npm run test:e2e          # jest --testPathPattern e2e --forceExit --detectOpenHandles
npm run test:watch        # jest --watch
```

Fuzz (manual):

```bash
cd fuzz
cargo +nightly fuzz run pair_invariant -- -max_total_time=60 -print_final_stats=1 -detect_leaks=0
cargo +nightly fuzz run copy_vault_accounting
cargo +nightly fuzz run spot_settlement_replay
```

`cargo-fuzz` requires **nightly Rust** (the root toolchain is `1.85.0` stable; fuzz workflow installs `nightly` explicitly with `llvm-tools-preview`).

## CI test pipeline (`.github/workflows/ci.yml`)

Triggered on push/PR to `main` and `develop`.

| Job                  | Runs                                                            | Notes                                                                       |
|----------------------|-----------------------------------------------------------------|-----------------------------------------------------------------------------|
| `validate`           | `npx tsc --noEmit` + `npm run lint --if-present` per TS package | Matrix: `spot-api`, `lunes-dex-main`, `sdk`, `mcp/lunex-agent-mcp`          |
| `build-ts`           | `npm run build` per TS package; uploads dist/build artifacts    | Depends on `validate`                                                       |
| `test-api`           | `npx jest --testPathIgnorePatterns="e2e" --forceExit --no-coverage --ci` in `spot-api/` | Postgres 15-alpine + Redis 7-alpine services; runs Prisma migrate before tests |
| `validate-subquery`  | `npx subql codegen && npx subql build` in `subquery-node/`      | Depends on `validate`                                                       |
| `build-contracts`    | `cargo contract build --release` per ink! contract              | Matrix of 9 contracts; uploads `target/ink/` artifacts (30-day retention)   |
| `test-contracts`     | `cargo test --workspace --exclude fuzz`                          | Runs all Rust unit + integration tests; explicitly excludes the fuzz crate  |
| `smoke-test`         | Boots `spot-api` against Postgres/Redis, hits `/health`, `/api/v1/strategies/marketplace`, `/api/v1/strategies`, `/api/v1/pairs` | Curl-based smoke check; PORT 4000 |
| `ci-status`          | Gate job: requires `build-ts`, `test-api`, `validate-subquery`, `smoke-test` all green | Exit 1 otherwise                                                     |

**Fuzz pipeline (`fuzz.yml`)** — separate workflow:

- Triggered on push/PR to `main`/`develop` when `Lunex/contracts/**`, `contracts/**`, or `fuzz/**` change.
- Also nightly at `0 2 * * *` UTC.
- Matrix runs each fuzz target on **nightly Rust** for `60` seconds (configurable via `workflow_dispatch.fuzz_duration`).
- `cargo fuzz run <target> -- -max_total_time=${DURATION} -print_final_stats=1 -detect_leaks=0`.
- On failure, uploads `fuzz/artifacts/<target>/` crash inputs (30-day retention).
- Companion `property-tests` job runs:
  ```bash
  cargo test --test property_security_invariants -- --test-threads=4
  cargo test --test integration_e2e               -- --test-threads=1
  cargo test --test security_tests                -- --test-threads=4
  ```

Other CI workflows present (out of scope for testing but adjacent): `contracts.yml`, `deploy.yml`, `gitleaks.yml`, `manual-fuzz-security.yml`, `prelaunch-security.yml`, `pr-check.yml`, `pr-checks.yaml`, `release.yml`, `security-audit.yml`.

## Coverage targets

- **No enforced numeric coverage threshold.** CI runs Jest with `--no-coverage` for `test-api`; spot-api does not publish a coverage gate.
- Optional artifact: `test-api` uploads `spot-api/coverage` only if it exists (`if-no-files-found: ignore`).
- The contract `test-contracts` job runs the full workspace; CONTRIBUTING.md merely requires "all tests pass" and "new service functions must have unit tests" / "new API endpoints must have at minimum a happy-path + invalid-input test".
- Dead-code as a coverage proxy: `cd spot-api && npm run deadcode:exports` (`ts-prune`) and `npm run deadcode:deps` (`depcheck`) run as part of `npm run quality`.

## Test structure patterns

### TypeScript — spot-api unit (`tradeService.test.ts`)

Mock-first; module-level `jest.mock()` replaces `../db` before any imports. Pattern:

```typescript
const mockPrisma = {
  $transaction: jest.fn(),
  pair:  { findUnique: jest.fn() },
  order: { findUnique: jest.fn(), update: jest.fn() },
  trade: { create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
};

const mockTradeSettlementService = {
  processNewTradeSettlements: jest.fn(),
  retryPendingSettlements: jest.fn(),
};

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));

import { tradeService } from '../services/tradeService';
import { Decimal } from '@prisma/client/runtime/library';
```

- Manual mock objects declared before the `jest.mock()` call (hoisting-safe).
- `__esModule: true` for default-exported singletons.
- Use Prisma's `Decimal` for numeric assertions.

### TypeScript — spot-api e2e (`tradeApi.e2e.test.ts`)

Uses `supertest` + the real Express app:

```typescript
import request from 'supertest'
import app from '../src/index'

describe('Trade API Endpoints', () => {
  const MOCK_API_KEY = 'test-trade-api-key'

  describe('POST /api/v1/trade/swap', () => {
    it('should execute a swap order', async () => {
      const res = await request(app)
        .post('/api/v1/trade/swap')
        .set('X-API-Key', MOCK_API_KEY)
        .send({ pair: 'LBTC/LUSDT', side: 'BUY', amount: '100', slippage: 0.5 })

      // May fail due to no real chain, but should return structured response
      expect([200, 400, 401, 503]).toContain(res.status)
    })
  })
})
```

- Tests assert on **status-code sets** (`expect([200, 400, 401, 503]).toContain(res.status)`) — robust to "no chain available" in CI.
- API key carried via `X-API-Key` header.

### TypeScript — root typechain (`tests/Dex.spec.ts`)

Constructor-style typechain factories:

```typescript
import Factory_factory from '../types/constructors/factory_contract';
import Pair_factory from '../types/constructors/pair_contract';
import { emit, revertedWith } from './testHelpers';

describe('Dex spec', () => {
  async function setup(): Promise<void>     { /* deploy factory, router */ }
  async function setupPsp22(): Promise<void> { /* deploy token contracts */ }
  async function setupRouter(): Promise<void> { /* wire pair + router */ }

  it('...', async () => { /* on-chain assertions */ })
})
```

- Tests rely on `globalThis.setup.{api, alice, bob}` populated by root `globalSetup`.
- Custom helpers (`emit`, `revertedWith`, `changeTokenBalances`, `parseUnits`) live in `tests/testHelpers.ts`.

### Rust — ink! unit (`Lunex/contracts/pair/lib.rs:1517+`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use ink::env::test;

    fn default_accounts() -> test::DefaultAccounts<ink::env::DefaultEnvironment> {
        test::default_accounts::<ink::env::DefaultEnvironment>()
    }

    fn set_sender(sender: AccountId) {
        test::set_caller::<ink::env::DefaultEnvironment>(sender);
    }

    fn set_timestamp(timestamp: Timestamp) {
        test::set_block_timestamp::<ink::env::DefaultEnvironment>(timestamp);
    }

    #[ink::test]
    fn test_new_pair_initializes_correctly() {
        let accounts = default_accounts();
        set_sender(accounts.alice);
        let pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);
        assert_eq!(pair.factory(), accounts.bob);
        assert_eq!(pair.get_reserves(), (0, 0, 0));
    }
}
```

Per-contract helpers (`default_accounts`, `set_sender`, `set_timestamp`) are duplicated across contract crates (no shared test-utils crate yet).

### Rust — fuzz target (`fuzz/fuzz_targets/pair_invariant.rs`)

```rust
#![no_main]

use libfuzzer_sys::fuzz_target;

#[derive(Clone, Copy, Debug)]
struct PairModel { reserve_0: u128, reserve_1: u128 }

impl PairModel {
    fn new(reserve_0: u128, reserve_1: u128) -> Self { /* ... */ }
    fn get_amount_out(amount_in: u128, reserve_in: u128, reserve_out: u128) -> Option<u128> { /* ... */ }
    fn swap_token_1_for_token_0(&mut self, amount_1_in: u128) -> Option<u128> { /* ... */ }
    fn invariant(&self) -> Option<u128> { /* k = reserve_0 * reserve_1 */ }
}

fuzz_target!(|data: &[u8]| {
    /* derive reserves + swap inputs from data, assert invariant non-decreasing */
});
```

Each target is its own `[[bin]]` in `fuzz/Cargo.toml`. The fuzz crate has `[workspace] members = []` — it is **not** part of the root workspace (so `cargo test --workspace` does not touch it; CI uses `--exclude fuzz` defensively).

## Mocking & fixtures

### spot-api

- **Prisma:** manual mock object passed via `jest.mock('../db', ...)`. Each model method is `jest.fn()`. No `@prisma/client` mocking library — explicit hand-rolled.
- **Services:** mocked via `jest.mock('../services/<name>')` or by injecting a mock object.
- **HTTP:** `supertest` against `app` from `src/index.ts`.
- **External chain (Polkadot):** real WS for typechain integration; spot-api e2e tolerates "chain unavailable" by accepting `503` in the status-code set.
- **Auth:** test API key (`X-API-Key: test-trade-api-key`); admin endpoints exercised with `ADMIN_SECRET` from env.
- **DB cleanup:** CONTRIBUTING.md mandates `beforeAll` / `afterAll` cleanup with an `isTestData: true` flag:
  ```typescript
  beforeAll(async () => {
    await prisma.myModel.deleteMany({ where: { isTestData: true } })
  })
  afterAll(async () => {
    await prisma.myModel.deleteMany({ where: { isTestData: true } })
    await prisma.$disconnect()
  })
  ```

### Typechain integration

- Shared `setup`, `setupPsp22`, `setupRouter` async helpers inside each `describe`.
- Local node assumed at `ws://127.0.0.1:9944` (Substrate dev node — `polkadot-launch`, `substrate-contracts-node`, or `swanky-node`).
- Keyring: `Keyring({ type: 'sr25519' })` with `//Alice` / `//Bob`.
- Custom assertion helpers: `emit(result, name, args, index)`, `revertedWith(result, errorTitle)`, `changeTokenBalances(txThunk, token, actors, expectedChanges)`, `parseUnits(amount, decimals = 18)`.

### Rust contracts

- `ink::env::test` is the only mocking surface: `default_accounts()`, `set_caller`, `set_block_timestamp`, `set_value_transferred`, `recorded_events()`.
- No external mocking framework (no `mockall`, no `mockito`). Cross-contract calls are tested through the integration suites in `tests/*.rs` rather than mocked.

## CONTRIBUTING.md testing requirements

- New service functions must have unit tests.
- New API endpoints need at minimum: a happy-path test + an invalid-input test.
- No `any` type in test files.
- `beforeAll` / `afterAll` for DB cleanup; never leave test data behind.
- Arrange / Act / Assert layout encouraged:
  ```typescript
  it('should do the thing', async () => {
    // Arrange
    const input = { ... }
    // Act
    const result = await myService.doThing(input)
    // Assert
    expect(result).toHaveProperty('id')
  })
  ```

## E2E surfaces

- **`spot-api/__tests__/*.e2e.test.ts`** — HTTP-level e2e against the running Express app via `supertest`. Hit real routes; tolerate chain-unavailable status codes (`503`).
- **`tests/Dex.spec.ts`** — full on-chain integration: deploys factory, pair, router, two PSP22 tokens, wnative; exercises swap/add-liquidity/remove-liquidity paths against a real Substrate node.
- **`tests/integration_e2e.rs` + `tests/e2e_flow_simulation.rs`** — Rust-side simulation of the cross-contract flow without a live chain (Substrate ink test environment).
- **`smoke-test` CI job** — black-box health-check curl loop after `spot-api` boots; checks `/health`, `/api/v1/strategies/marketplace`, `/api/v1/strategies`, `/api/v1/pairs`.
- **No browser-driven E2E** (no Playwright/Cypress/Selenium) detected in the repo. Frontend `lunes-dex-main` has no `.test.tsx`/`.spec.tsx` files outside `node_modules`.

## Quick "where do I put this test?" cheatsheet

| You are testing…                                                | Put the test in…                                            | Run with                                  |
|------------------------------------------------------------------|-------------------------------------------------------------|-------------------------------------------|
| A pure function or service in `spot-api/src/services/`           | `spot-api/src/__tests__/<service>.test.ts`                  | `cd spot-api && npm run test:unit`        |
| An Express route in `spot-api/src/routes/`                        | `spot-api/__tests__/<feature>.e2e.test.ts` (supertest)      | `cd spot-api && npm run test:e2e`         |
| ink! contract internal logic (no cross-contract)                  | `#[cfg(test)] mod tests` in `Lunex/contracts/<x>/lib.rs`    | `cargo test -p <crate>`                   |
| Multi-contract flow                                               | `tests/<name>_integration_tests.rs` or `tests/integration_e2e.rs` | `cargo test --test <name>`           |
| Security invariant / OZ pattern                                   | `tests/security_tests.rs` / `tests/openzeppelin_security_validation.rs` | `npm run test:security`         |
| Random-input invariant for contract math                          | `fuzz/fuzz_targets/<name>.rs` + register in `fuzz/Cargo.toml` | `cd fuzz && cargo +nightly fuzz run <name>` |
| End-to-end on a live Substrate node                               | `tests/<feature>.spec.ts` (typechain)                       | `npm run test:typechain`                  |

---

*Testing analysis: 2026-05-21*
