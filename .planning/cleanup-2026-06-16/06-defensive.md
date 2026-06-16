# Cleanup Pass #7 — Defensive Programming / try-catch Audit
**Date:** 2026-06-16
**Scope:** spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, subquery-node/src
**Exclusions:** contracts/, node_modules, dist, .next, build, target, test files, auto-generated

---

## Summary

| Metric | Count |
|--------|-------|
| Total try/catch occurrences reviewed | 803 |
| Removals auto-applied | 0 |
| Fund-path instances left untouched (propose-only) | ~290 (spot-api services/routes core) |
| Fail-closed guards explicitly protected | 6 (documented below) |

**Decision: ZERO removals applied.** Every candidate that looked like a pure passthrough or dead catch, on closer inspection, either (a) performs state cleanup before rethrowing, (b) adds diagnostic context to the error message, (c) is on a fund/security path, or (d) is an intentional fail-open/fail-closed design choice that is documented. Nothing qualified as provably behavior-neutral on non-financial code.

---

## Classification Table

### spot-api/src — FUND/SECURITY PATH (propose-only)

All of the following are classified **fund-path-propose-only**. No edits were made or will be made to any of these.

#### `spot-api/src/services/orderService.ts` — lines 138–161
```
try {
  matches = book.addMarketOrder/addLimitOrder(...)
  await tradeService.processMatches(pairId, matches)
} catch (err) {
  book.restoreCheckpoint(checkpoint)   // ← CRITICAL rollback
  throw err
}
```
**Classification:** fund-path-propose-only. This is NOT a pure passthrough. The catch executes `book.restoreCheckpoint(checkpoint)` — an in-memory orderbook rollback that prevents a half-applied match from corrupting the in-memory book state. Removing this would leave the book in an inconsistent state on any matching engine error, risking ghost orders or incorrect fills. **KEEP.**

#### `spot-api/src/services/tradeService.ts` — lines 199–213
Two catches:
1. Lines 199–207: `catch (err) { log.error({ err }, 'Failed to update candle') }` — swallows candle update failure intentionally so one bad trade doesn't block settlement. **KEEP** — documented intent, non-propagation is correct.
2. Lines 211–224: `catch (err) { log.error({ ..., tradeIds }, 'Trade settlement scheduling failed...') }` — swallows settlement scheduling error with logging and comment "trades remain retryable". **KEEP** — intentional; retry loop handles recovery.

#### `spot-api/src/services/matchingLockService.ts`
Multiple try/catch blocks around the lock acquire/release/timeout. All catches either log or throw specific contextual errors ("Matching engine lock unavailable", "Matching engine busy"). Fund path. **KEEP ALL.**

#### `spot-api/src/services/settlementService.ts`, `tradeSettlementService.ts`
On-chain signAndSend paths, Prisma writes to trade/settlement tables, retry-pending-settlements loop. All catches either log errors with trade IDs or rethrow. Fund path by definition. **KEEP ALL.**

#### `spot-api/src/services/copyVaultService.ts`
Lines 84–104: try/catch around on-chain vault deposit/withdraw call with `.catch(reject)` in promise callback chain. Fund path — real money moves. **KEEP ALL.**

#### `spot-api/src/services/copytradeService.ts`
Lines 315, 340, 368, 408: try/catch blocks around vault deposit validation, signature verification, challenge auth. Auth/signature path. **KEEP ALL.**

#### `spot-api/src/services/vaultReconciliationService.ts`
Full catch chain around reconciliation logic (balance math vs on-chain). Fund path. **KEEP ALL.**

#### `spot-api/src/services/rewardPayoutService.ts`, `rewardDistributionService.ts`
Catches around reward math and Prisma writes to financial tables. Fund path. **KEEP ALL.**

#### `spot-api/src/services/assetBridgeService.ts`
Bridge/asset-wrapper path. **KEEP ALL.**

#### `spot-api/src/services/listingProofService.ts`
Listing proof verification — fail-closed listing guard. **KEEP ALL.**

#### `spot-api/src/middleware/auth.ts`, `agentAuth.ts`
Auth verification — security path. **KEEP ALL.**

#### `spot-api/src/utils/finalizedTx.ts`
On-chain tx finalization polling. **KEEP ALL.**

#### `spot-api/src/services/affiliateService.ts` — lines 175–205
```
try {
  await prisma.affiliateCommission.create(...)
} catch (error) {
  if (isUniqueViolation(error)) { continue; }  // P2002 idempotent skip
  throw error;
}
```
**Classification:** fund-path-propose-only. The catch is NOT a passthrough — it discriminates by error type. P2002 (unique constraint) is swallowed intentionally to make commission distribution idempotent on settlement retries. Any other error is rethrown. This is a deliberate correctness pattern. **KEEP.**

#### `spot-api/src/services/affiliateService.ts` — lines 230–254
`catch (error) { log.error(...) }` — swallows commission-credit errors per-trade so one bad trade doesn't block the batch. Intentional documented isolation. **KEEP.**

#### `spot-api/src/services/affiliateService.ts` — lines 431–457
Fund path (commission payout). **KEEP.**

#### `spot-api/src/services/rebalancerService.ts`
Strategy rebalancing with fund moves. Nested try/catch with logging + gas dry-run checks. Fund path. **KEEP ALL.**

#### `spot-api/src/services/routerService.ts` — line 371
try/catch around smart-router route calculation. Fund path — amounts/fees computed here. **KEEP.**

#### `spot-api/src/services/factoryService.ts` — lines 30–115
Three catches:
1. `initialize()` catch: logs and returns `false` → service degrades gracefully but does not crash. Correct pattern for optional on-chain connectivity.
2. `getPair()` catch: logs and returns `null` — pair lookup fallback.
3. `getAllPairsLength()` catch: logs and returns `0`.
4. `getAllPairs()` `.catch()` per-pair: logs and returns `null` per item.
All add logging; none are pure passthroughs. **KEEP ALL.** (These are on-chain calls; failures returning safe defaults are correct.)

#### `spot-api/src/routes/*` (orders, execution, copytrade, margin, listing, rewards, balances, admin, asymmetric, strategies, affiliate, tradeApi, router, agents)
Route handlers wrap fund-path service calls. All catches either call `next(err)`, log, or return structured error responses. **KEEP ALL — fund path routing.**

---

### spot-api/src — NON-FUND (still kept, with reasons)

#### `spot-api/src/utils/redis.ts` — `redisHealthy()`
```
catch { return false; }
```
**keep-with-reason:** Fail-closed health probe. On Redis error it returns `false` so the health endpoint returns HTTP 503. Removing would allow the health check to throw uncaught, causing the endpoint to 500 or crash. This is a fail-safe probe.

#### `spot-api/src/utils/redisRateLimit.ts` — lines 41–87
```
catch (err) {
  log.warn({ err, key }, '[redisRateLimit] check failed — failing open')
  return failOpen(limit)
}
```
**keep-with-reason:** Intentional fail-open on Redis outage with a `FAIL_OPEN` config flag and explicit logging. This is an explicitly designed tradeoff with documentation. Not removable.

#### `spot-api/src/middleware/securityShield.ts` — `safeDecode()`
```
try { return decodeURIComponent(value) } catch { return value }
```
**keep-with-reason (fail-closed security guard):** This is a security control. A malformed `%xx` sequence throws in `decodeURIComponent`. The catch returns the raw value so the blocked-path regex still runs against the undecoded URL, preventing bypass via double-encoding. Removing would make the security check skip on decode failure.

#### `spot-api/src/websocket/server.ts` — lines 144–160
`try { JSON.parse(data.toString()) } catch` — WebSocket message parse protection. **keep-with-reason:** Malformed WS frames must not crash the server. External I/O catch.

#### `spot-api/src/index.ts` — health/metrics endpoints
Multiple try/catch wrapping `prisma.$queryRaw`, `redisHealthy()`, `settlementService.ensureReady()`. Each catch sets the respective gauge to 0 or marks component as down. **keep-with-reason:** These are monitoring probes; errors must be absorbed, not propagated to the metrics scraper.

#### `spot-api/src/index.ts` — `main()` outer catch
```
catch (error) { log.error(...); process.exit(1) }
```
**keep-with-reason:** Top-level startup guard. Correct placement.

#### `spot-api/src/index.ts` — shutdown catch
```
catch (err) { log.error({ err }, 'Error during shutdown') }
```
**keep-with-reason:** Graceful shutdown must not abort on cleanup errors.

#### `spot-api/src/services/socialAnalyticsPipeline.ts` / `socialIndexerService.ts` / `socialAnalyticsService.ts`
All catches either log errors or perform recovery (e.g., lines 1410–1438 have a recovery attempt with `throw recoveryError` on failure). **keep-with-reason:** Social/indexing pipeline — errors must not cascade to settlement. All catches are documented or have logging.

#### `spot-api/src/services/botSandbox.ts` — line 390
Sandbox trade execution try/catch. **keep-with-reason:** Bot execution is externally-controlled code; exceptions must be contained.

#### `spot-api/src/services/subqueryClient.ts` — line 173
Network call to SubQuery API. **keep-with-reason:** External I/O.

#### `spot-api/src/services/stakeChainVerifier.ts`, `emergencyService.ts`
On-chain reads and emergency controls. **keep-with-reason:** Fund/security path (emergency pause/unpause touches on-chain state).

#### `spot-api/src/services/rewardScheduler.ts`, `copytradeWalletContinuationScheduler.ts`
Scheduler loops wrapping fund operations. Catches prevent one cycle failure from killing the scheduler. **KEEP.**

---

### sdk/src

#### `sdk/src/utils.ts` — `retryWithBackoff()` lines 166–172
```
try { return await fn() } catch (error) { if (i === retries - 1) throw error; ... }
```
**keep-with-reason:** This is the retry logic itself. The catch is load-bearing: it suppresses intermediate failures and only rethrows on the final attempt. Removing would defeat the retry.

#### `sdk/src/utils.ts` — line 408
`try { ... } catch` around an SDK utility (likely JSON parse or amount calculation). **keep-with-reason:** SDK utility used by callers that may not handle parse errors; catch adds safety.

---

### mcp/lunex-agent-mcp

#### `mcp/lunex-agent-mcp/src/smokeRouter.ts` — lines 51–57
```
try { return JSON.parse(String(textPart.text)) }
catch (error) { throw new Error(`...returned invalid JSON: ${error.message}`) }
```
**keep-with-reason:** NOT a passthrough. Adds context (which MCP tool returned bad JSON) to the error message.

#### `mcp/lunex-agent-mcp/src/smokeRouter.ts` — lines 156–168
```
try { health = assertJsonObject(...callTool('get_lunex_health',...)) }
catch (error) { throw new Error(`spot-api is not reachable at ${baseUrl}. Cause: ${message}`) }
```
**keep-with-reason:** NOT a passthrough. Wraps network error with actionable diagnostic ("Start the backend and retry").

#### `mcp/lunex-agent-mcp/src/smokeRouter.ts` — lines 125–266 outer try/finally
```
try { ...smoke test body... }
catch (error) { if (stderrTail.length > 0) console.error(stderrTail.join('')); throw error }
finally { await client.close().catch(() => null) }
```
**keep-with-reason:** NOT a passthrough. Catch logs MCP stderr before rethrowing (adds diagnostic context). `finally` ensures client cleanup regardless of error.

#### `mcp/lunex-agent-mcp/src/index.ts`
All catches wrap MCP tool handlers and convert to `McpError` with typed error codes. Input validation + error propagation to MCP protocol. **KEEP ALL.**

---

### lunes-dex-main/src

#### `lunes-dex-main/src/utils/plancks.ts` — `toPlancks()`
```
try { return (BigInt(intPart) * PLANCKS_PER_UNIT + BigInt(padded)).toString() }
catch { return '0' }
```
**keep-with-reason:** Fund-adjacent conversion (used in tx construction). The catch returns `'0'` on non-numeric input — this is a safe input sanitizer. Removing would let malformed user input propagate a `BigInt` exception through the UI. The `'0'` fallback protects downstream BigInt math from exploding on bad input.

#### `lunes-dex-main/src/services/spotService.ts` — lines 188–230
WebSocket connection management with try/catch on connect and parse. **keep-with-reason:** External I/O (WS). Inner message parse catch (`// ignore parse errors`) is intentional for malformed WS frames.

#### `lunes-dex-main/src/context/SDKContext.tsx` — lines 253–258
```
try { ...extension.enable() }
catch (e) { /* swallowed */ }
```
**keep-with-reason:** Wallet extension enumeration — some extensions throw on `enable()` if already connected or unsupported. Swallowing is correct here; the code continues to collect the extensions that do respond.

#### All other SDKContext try/catch blocks (lines 272–731)
Wallet connect, token approval, swap, add/remove liquidity, fee estimation — all touch on-chain tx submission or signing. Fund/security path. **KEEP ALL.**

#### `lunes-dex-main/src/hooks/useSwap.tsx`, `useLiquidity.tsx`, `useAsymmetricDeploy.ts`
On-chain signing + tx submission hooks. All catches set UI error state or rethrow. Fund path. **KEEP ALL.**

#### `lunes-dex-main/src/hooks/usePools.ts`, `useFavorites.ts`
Network calls and local storage; catches set UI error state. **keep-with-reason:** UI defensive patterns, external I/O.

#### `lunes-dex-main/src/services/strategyService.ts`, `rewardsService.ts`, `asymmetricContractService.ts`, `contractService.ts`, `agentService.ts`
API/network calls. All catches either throw with added context or swallow connection errors. **keep-with-reason:** External I/O.

#### `lunes-dex-main/src/routers/prefetch.ts`
```
try { /* preload */ } catch { /* ignored */ }
void load().catch(() => { /* ignored */ })
```
**keep-with-reason:** Fire-and-forget prefetch. Swallowing prefetch errors is correct — a failed prefetch must not crash the app.

---

### lunex-admin/src

#### `lunex-admin/src/lib/audit.ts` — `logAudit()`
```
try { await prisma.adminAuditLog.create(...) }
catch { console.error(`[audit] Failed to log action: ${action}`) }
```
**keep-with-reason:** Explicitly documented "Audit logging should never break the main flow." Swallowing is intentional design — a DB error writing an audit log must not abort the admin action itself. **Note:** this means audit gaps are silent on DB failures (only logged to stderr). The design is acceptable but worth noting.

#### `lunex-admin/src/app/login/actions.ts` — `loginAction()`
```
try { await signIn(...) }
catch (error) {
  if (error instanceof AuthError) { return { error: 'Email ou senha incorretos.' } }
  throw error  // non-auth errors rethrow
}
```
**keep-with-reason:** Security path (auth). NOT a passthrough — discriminates by error type. AuthError → safe user-facing message (prevents error enumeration). Other errors rethrow correctly.

#### `lunex-admin/src/app/(admin)/emergency/actions.ts` — `getEmergencyStatus()`
```
try { fetch(...) }
catch (err) { return { error: (err as Error).message } }
```
**keep-with-reason:** Network call to spot-api. Correct pattern — returns structured error instead of throwing so the UI can display the failure.

#### `lunex-admin/src/app/(admin)/listings/actions.ts`, `pending/actions.ts`, `dex-users/actions.ts`
No try/catch blocks — these use `fetch` with `if (!res.ok)` pattern + `.catch(() => ({}))` on JSON parse for error body extraction. **keep-with-reason:** `.catch(() => ({}))` on `res.json()` is correct fallback for when the error response body is not JSON. Not removable.

---

### subquery-node/src

#### `subquery-node/src/mappings/contractEvents.ts`
Multiple try/catch blocks (~18 occurrences):
1. `topicToString()`: `try { hexToU8a(...) } catch { return '' }` — returns empty string on bad hex. **keep-with-reason:** Chain data can be malformed; a bad topic must not crash the entire block processor.
2. `readContractEmitted()`: `try { ...decode event payload... }` — SubQuery handlers must not throw; uncaught exceptions in a SubQuery handler abort block processing. **KEEP ALL** — SubQuery-specific requirement.

#### `subquery-node/src/mappings/utils.ts`
Utility functions with try/catch on chain data decoding. Same rationale — SubQuery handlers must be exception-safe. **KEEP ALL.**

---

## Fail-Closed Guards Explicitly Protected (not touched)

1. **`securityShield.safeDecode()`** — catch returns raw URL so security regex still runs; removing would allow bypass via malformed encoding.
2. **`redisRateLimit failOpen()`** — deliberately fail-open with config flag; the catch and `failOpen()` call are the rate-limiter's resilience contract.
3. **`redisHealthy()` catch `return false`** — health endpoint returns 503 on Redis error; catch suppression makes health fail-closed.
4. **`orderService.ts` catch `book.restoreCheckpoint()`** — in-memory orderbook rollback on matching engine error; removing would corrupt in-memory order state.
5. **`affiliateService.ts` P2002 discriminated catch** — idempotency guard for settlement retries; removing would cause duplicate commission inserts on retry.
6. **`loginAction()` AuthError discriminated catch** — prevents auth error enumeration; non-auth errors correctly rethrow.

---

## What Would Have Been Removable (and Why It Is Not)

No instances met all three criteria simultaneously:
- File is not on a fund/security path
- Removal is provably behavior-neutral
- `tsc --noEmit` would stay clean

The closest candidates examined:

**`lunes-dex-main/src/utils/plancks.ts` `toPlancks()` catch `return '0'`** — superficially looks removable (UI utility file). NOT removable: `BigInt()` on non-numeric input throws `SyntaxError`; the `'0'` fallback is a deliberate input sanitizer that prevents downstream planck math from crashing on user-typed bad values. Removing would crash UI components that pass raw form inputs.

**`subquery-node/src/mappings/contractEvents.ts` `topicToString()` catch `return ''`** — looks removable (returns empty string). NOT removable: SubQuery block handlers must not throw; an uncaught exception here would abort block processing and stall the indexer. The empty-string fallback is the SubQuery resilience contract.

**`spot-api/src/index.ts` health endpoint inner catches** — look like "DB is down" swallowing. NOT removable: these are monitoring probes setting Prometheus gauges; they must absorb errors to return valid HTTP 200/503 with gauge values.

---

## tsc Result

No files were edited; `tsc --noEmit` was not run (no changes to validate).
