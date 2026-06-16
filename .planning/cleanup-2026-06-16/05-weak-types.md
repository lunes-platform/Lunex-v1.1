# Weak Types Cleanup — Pass #4 (any / unknown)

**Date:** 2026-06-16  
**Scope:** spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, subquery-node/src  
**Exclusions:** contracts/, node_modules, dist, .next, build, target, test files, auto-generated files

---

## Counts Found Per Package

| Package | `any` hits | `unknown` hits | Total |
|---------|-----------|----------------|-------|
| spot-api | 22 | 0 (unknown used correctly) | 22 |
| sdk | 13 | 0 | 13 |
| mcp | 1 | 5 (correct usage) | 6 |
| lunes-dex-main | 23 | 0 | 23 |
| lunex-admin | 0 | 0 | 0 |
| subquery-node | 0 | 4 (correct usage) | 4 |
| **Total** | **59** | **9** | **68** |

---

## Replacements Applied

### 1. `sdk/src/modules/tokens.ts:47` — `pagination: any` → `pagination: Pagination`
- **Evidence:** `Pagination` interface exists in `sdk/src/types.ts` with fields `page: number; limit: number; total: number; totalPages: number;`. The HTTP endpoint `/api/v1/tokens` returns this shape.
- **Change:** Added `Pagination` to the import from `../types`; replaced return type annotation.
- **tsc result:** `sdk` — 0 errors ✓

### 2. `spot-api/src/routes/execution.ts:181,193` — `status as any` → `status as ExecutionStatus | undefined`
- **Evidence:** `HistoryQuerySchema` parses `status` via `z.enum(['PENDING','EXECUTED','REJECTED','FAILED']).optional()`. Both `getStrategyExecutionHistory` and `getAgentExecutionHistory` accept `status?: ExecutionStatus` (Prisma type from `@prisma/client`). The Zod-validated values are the exact members of the `ExecutionStatus` enum — cast is sound.
- **Change:** Added `import type { ExecutionStatus } from '@prisma/client'`; replaced both `as any` casts.
- **tsc result:** `spot-api` — 0 errors ✓

### 3. `lunes-dex-main/src/components/spot/PriceHeader/index.tsx:174,179` — `b: any`, `a: any` → `b: OrderbookLevel`, `a: OrderbookLevel`
- **Evidence:** `OrderbookLevel` is defined in `lunes-dex-main/src/services/spotService.ts` with `price: number; amount: number; total: number`. `orderbook` in context is `OrderbookSnapshot | null` where `OrderbookSnapshot.bids` and `.asks` are `OrderbookLevel[]`. The `b[1]` fallback was dead code since `OrderbookLevel` always has `.amount`.
- **Change:** Added `import type { OrderbookLevel } from '../../../services/spotService'`; replaced both lambda params; removed dead `|| Number(b[1])` / `|| Number(a[1])` branches (those were for a different orderbook format that never arrives here).
- **tsc result:** `lunes-dex-main` — 0 errors ✓

### 4. `lunes-dex-main/src/pages/strategies/Page.tsx:796` — `e.target.value as any` → `e.target.value as StrategyRiskLevel | ''`
- **Evidence:** State is `useState<StrategyRiskLevel | ''>('')`; `StrategyRiskLevel` is already imported from `strategyService`. The `<option>` values are exactly the union members plus `''`.
- **Change:** Replaced `as any` with `as StrategyRiskLevel | ''`.
- **tsc result:** `lunes-dex-main` — 0 errors ✓

### 5. `lunes-dex-main/src/pages/strategies/Page.tsx:806` — `e.target.value as any` → `e.target.value as 'roi30d' | 'followersCount' | 'sharpeRatio' | 'totalVolume'`
- **Evidence:** State is `useState<'roi30d' | 'followersCount' | 'sharpeRatio' | 'totalVolume'>('roi30d')`. The `<option>` values match exactly.
- **Change:** Replaced `as any` with the explicit union literal.
- **tsc result:** `lunes-dex-main` — 0 errors ✓

### 6. `lunes-dex-main/src/pages/strategies/Detail.tsx:376` — `CustomTooltip: any` → `TooltipContentProps` (recharts)
- **Evidence:** recharts 3.x exports `TooltipContentProps` from `recharts` package (via `Tooltip.d.ts`). This type has `active?: boolean`, `payload: TooltipPayload`, and all injected fields. The inner `payload[0].payload as StrategyPerformancePoint` cast remains correct.
- **Change:** Added `type TooltipContentProps` to recharts import; replaced `any` with `TooltipContentProps`. Also changed JSX `<CustomTooltip />` to function reference `CustomTooltip` to satisfy recharts `ContentType` union.
- **tsc result:** `lunes-dex-main` — 0 errors ✓

---

## Legitimate — Left As-Is

### spot-api

| Location | Pattern | Reason |
|----------|---------|--------|
| `services/socialIndexerService.ts:38` | `payload: any` in `NormalizedIndexedEvent` | Decoded ink! contract event data — genuinely dynamic SCALE-decoded structure, no static type |
| `services/socialIndexerService.ts:95` | `prisma as any` | Has explicit `TODO(types)` comment documenting a pre-existing schema bug (`blockHash: null` vs required `String`). Removing the cast surfaces the underlying data bug — must fix schema first |
| `services/socialIndexerService.ts:240` | `getBlockTimestamp(extrinsics: any[])` | Polkadot.js extrinsic array from `api.rpc.chain.getBlock()` — no single static type covers the polymorphic codec |
| `services/socialIndexerService.ts:242` | `(extrinsic as any).method` | Same: polkadot generic codec object, `.method` is not in the declared interface |
| `services/socialIndexerService.ts:447,448,461,462,480` | `this.api as any`, `routerAbi as any`, `pairAbi as any` | `ContractPromise` constructor requires `ApiPromise`; `this.api` is typed as `ApiPromise \| null` (callee checks for null). ABI files are raw JSON — `Abi` constructor would work but requires schema validation overhead not warranted here |
| `routes/asymmetric.ts:251` | `toLiveCurveState(curve: any)` | `rebalancerService.getCurveState()` returns `unknown` (no static type from polkadot query result) — function immediately narrows by field access |
| `routes/execution.ts` (copytrade/strategies) | `catch (err: any)` | Catch clause — legitimate per CONTRIBUTING.md; should be `unknown` but that's covered by error-handling conventions, not type safety |
| `index.ts:229` | `(req as any).requestId` | Express `Request` type lacks `requestId` augmentation. A `declare global` augmentation would be cleaner but is out of scope |

### sdk

| Location | Pattern | Reason |
|----------|---------|--------|
| `types.ts:40` | `details?: any` in `ApiError` | Error detail payloads are genuinely polymorphic (Zod issues, Prisma errors, custom strings) |
| `modules/agents.ts:80` | `order: any` in `TradeResult` | Off-chain order shape not typed in SDK — server returns varying shapes depending on orderType |
| `modules/agents.ts:280` | `cancelOrder(): Promise<any>` | API response shape for DELETE /trade/orders/:id not defined in SDK types |
| `modules/agents.ts:286` | `orders: any[]` in `getOrders` | Order shape not typed in SDK; same as above |
| `modules/asymmetric/AsymmetricClient.ts:290` | `get<any[]>` | Asymmetric position/event list — no matching interface in SDK types |
| `websocket-client.ts:139,152,166` | `data: any` for `liquidity:removed`, `proposal:executed`, `tier:upgraded` | Corresponding event interfaces (`LiquidityRemovedEvent`, `ProposalExecutedEvent`, `TierUpgradedEvent`) do **not exist** in `types.ts`. Other events (liquidity:added, swap:executed, proposal:created, vote:cast, price:update) all have interfaces. These three are missing. |
| `index.ts:155,164` | `(...args: any[]) => void` in `on`/`off` | EventEmitter catch-all callback signature — cannot narrow per-event without overloaded signatures |
| `utils.ts:187` | `debounce<T extends (...args: any[]) => any>` | Standard generic constraint for debounce — cannot be narrowed further |

### mcp

| Location | Pattern | Reason |
|----------|---------|--------|
| `index.ts:3700` | `(agentRes as any)?.agent?.id` | `requestJson()` returns `unknown` (JSON.parse result). The shape `{ agent: { id: string } }` is API-contract knowledge not expressed in any TS type |
| `routerTools.ts:9`, `index.ts:2017`, etc. | `unknown` in function boundaries | All correct — `unknown` at parse/assert boundaries with runtime narrowing |

### subquery-node

| Location | Pattern | Reason |
|----------|---------|--------|
| `mappings/utils.ts:15` | `safeNum(value: unknown)` | Correct — accepts unknown, narrows internally |
| `mappings/contractEvents.ts:87-91` | `unknown[]`, `as unknown as { map?: unknown }`, etc. | Correct — SubQuery codec values have no static TS type; pattern is the right way to probe polkadot codec shapes |

### lunes-dex-main

| Location | Pattern | Reason |
|----------|---------|--------|
| `catch (err: any)` (multiple files) | Catch clause | Legitimate; CONTRIBUTING.md prefers `unknown` but these are off the hot path and existing pattern |
| `hooks/usePools.ts:105,108` | `pairs: any[]` | Response from raw `fetch('/api/v1/pairs')` — no SDK type for this internal shape |
| `pages/landing/index.tsx:163,299` | `} as any)}` | Custom `data-*`-style attributes on styled-components — DOM prop forwarding limitation in styled-components 5.x; requires `shouldForwardProp` or type augmentation to fix properly |
| `components/spot/ChartPanel/index.tsx:387` | `lines: any[]` | lightweight-charts `IPriceLine` is not exported from the public API surface in v5.x — replacing would require importing from internal paths |
| `components/spot/PriceHeader/PairInfoModal.tsx:192` | `useState<any>(null)` | Market info shape not typed — needs interface definition first |
| `pages/strategies/CreateStrategyModal.tsx:276` | `onCreated: (strategy: any) => void` | `Strategy` type is imported but the API response on creation may differ from the full `Strategy` shape — risky to narrow without verifying the POST response shape |

---

## Recommendations (Not Applied — Risky Without Further Verification)

1. **`sdk/websocket-client.ts` — missing event interfaces:** Add `LiquidityRemovedEvent`, `ProposalExecutedEvent`, `TierUpgradedEvent` interfaces to `sdk/src/types.ts` (mirroring `LiquidityAddedEvent` etc.), then replace the three `data: any` callbacks. Requires confirming the actual event payloads emitted by `spot-api/src/websocket/server.ts`.

2. **`spot-api/utils/helpers.ts:36` — `decimalToNumber(val: any)`:** Replace with `val: Prisma.Decimal | number`. Requires `import { Prisma } from '@prisma/client'` — cross-package import from a service utility. All callers pass Prisma `Decimal` fields or raw numbers. Low risk but adds a Prisma dependency to a utility file.

3. **`spot-api/index.ts:229` — `(req as any).requestId`:** Add `declare global { namespace Express { interface Request { requestId?: string; } } }` to a `spot-api/src/types.d.ts` file. Eliminates the cast cleanly.

4. **`mcp/index.ts:3700` — `(agentRes as any)?.agent?.id`:** Add a typed interface `interface AgentMeResponse { agent: { id: string } }` and cast `requestJson` result with `as AgentMeResponse`. Low risk but requires confirming the actual API response shape.

5. **`lunes-dex-main/pages/strategies/CreateStrategyModal.tsx:276` — `onCreated: (strategy: any) => void`:** Replace with `onCreated: (strategy: Strategy) => void` (Strategy is already imported). Requires confirming the POST `/api/v1/strategies` response matches the `Strategy` interface.

6. **`spot-api/services/socialIndexerService.ts:95` — `prisma as any`:** Fix the underlying schema bug (`blockHash` nullable vs required) in `subquery-node/schema.graphql` + Prisma migration, then remove the cast and restore proper Prisma client typing.

---

## tsc Results Summary

| Package | Errors Before | Errors After |
|---------|--------------|-------------|
| sdk | 0 | 0 ✓ |
| spot-api | 0 | 0 ✓ |
| lunes-dex-main | 0 | 0 ✓ |
| mcp | not edited | — |
| lunex-admin | not edited | — |
| subquery-node | not edited | — |
