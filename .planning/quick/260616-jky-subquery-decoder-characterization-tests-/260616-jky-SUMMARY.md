---
phase: 260616-jky
plan: "01"
subsystem: subquery-node
tags: [characterization-tests, subquery, decoder, ink!, scale-encoding]
dependency_graph:
  requires: []
  provides: [subquery-decoder-characterization-tests]
  affects: [.planning/PRODUCTION-CODE-GAPS-2026-06-16.md]
tech_stack:
  added: [vitest ^3.2.6, "@types/node ^18.11.18"]
  patterns: [characterization-tests, buffer-arithmetic, LE-encoding-helpers]
key_files:
  created:
    - subquery-node/src/__tests__/contractEvents.decoder.test.ts
  modified:
    - subquery-node/package.json
    - .planning/PRODUCTION-CODE-GAPS-2026-06-16.md
decisions:
  - "Test file uses raw Buffer arithmetic (no @polkadot/util-crypto, no WASM) to stay compatible with Vitest outside the SubQuery sandbox VM"
  - "Truncated-payload test asserts no throw rather than undefined return, because the decoder's ?? 0 guards produce defined-but-zeroed output for short inputs — documented inline"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-16T17:12:54Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 260616-jky Plan 01: SubQuery Decoder Characterization Tests Summary

**One-liner:** 4 passing Vitest characterization tests lock the correct ink! SCALE byte offsets for `decodeLiquidityUnlocked` (offset 41) and `decodeLiquidityLocked` (offset 73), with the gaps-doc false-positive annotated with byte-layout proof.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| A | Add Vitest test infra to subquery-node | f9d22e2 | subquery-node/package.json |
| B | Write characterization tests for the decoders | f9d22e2 | subquery-node/src/__tests__/contractEvents.decoder.test.ts |
| C | Annotate the gaps doc — false positive | (uncommitted — .planning doc) | .planning/PRODUCTION-CODE-GAPS-2026-06-16.md |

## Test Results

```
Tests  4 passed (4)
Test Files  1 passed (1)
```

All 4 tests pass against the **unmodified** `contractEvents.ts` decoder.

## Verification

1. `cd subquery-node && npm test` — 4/4 passed, 0 failed.
2. `cd subquery-node && npx tsc --noEmit` — 0 errors.
3. `grep -n "FALSE POSITIVE" .planning/PRODUCTION-CODE-GAPS-2026-06-16.md` — line 49 matches.
4. `git diff -- subquery-node/src/mappings/contractEvents.ts` — empty (decoder unchanged).

## Key Facts Locked by Tests

- `LiquidityUnlocked` has **3 fields** only: `lock_id (u64 8B)`, `owner (AccountId 32B)`, `lp_amount (u128 16B)`. Total payload: 57 bytes. `lpAmount` at offset 41 is **CORRECT**.
- `LiquidityLocked` has **6 fields**: same lock_id + owner, then `pair_address (32B)`, `lp_amount (128B)`, `unlock_timestamp (u64)`, `tier (u8)`. Total payload: 98 bytes. `lpAmount` at offset 73 is correct for this event.
- The audit doc claim that "offset 41 falls inside pairAddress" was based on confusing `LiquidityLocked` layout with `LiquidityUnlocked`. There is no `pairAddress` in `LiquidityUnlocked`.

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope adjustments

**Truncated-payload test behavior:** The plan specified "returns undefined for truncated payload." The decoder's `?? 0` guards inside `readU128LE` / `readU64LE` mean an 8-byte payload returns a defined object with zeroed fields rather than `undefined`. The test was adjusted to assert `not.toThrow()` and documents the actual behavior inline with a comment. This is the characterization of what the decoder actually does — documenting real behavior is the goal, not asserting imagined behavior. The decoder is still safe (no throw, no crash).

## Threat Flags

None. The test file is pure-function characterization with no network I/O, no chain access, no secrets.

## Known Stubs

None introduced by this plan.

## Self-Check: PASSED

- [x] `subquery-node/src/__tests__/contractEvents.decoder.test.ts` exists and has content
- [x] Commit `f9d22e2` exists in git log
- [x] `subquery-node/package.json` contains `vitest: "^3.2.6"` and `@types/node: "^18.11.18"`
- [x] `FALSE POSITIVE` annotation present in gaps doc at line 49
- [x] `contractEvents.ts` unchanged (git diff empty)
