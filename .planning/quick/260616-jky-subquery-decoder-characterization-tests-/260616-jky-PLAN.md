---
phase: 260616-jky
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - subquery-node/package.json
  - subquery-node/src/__tests__/contractEvents.decoder.test.ts
  - .planning/PRODUCTION-CODE-GAPS-2026-06-16.md
autonomous: true
requirements:
  - characterization-test-subquery-decoders

must_haves:
  truths:
    - "`npm test` inside subquery-node runs green with zero changes to contractEvents.ts"
    - "decodeLiquidityUnlocked correctly returns lockId/owner/lpAmount from a crafted payload with lpAmount at offset 41"
    - "decodeLiquidityLocked correctly reads all 6 fields with lpAmount at offset 73"
    - "The gaps-doc line ~48 is annotated FALSE POSITIVE with byte-layout reasoning"
  artifacts:
    - path: "subquery-node/src/__tests__/contractEvents.decoder.test.ts"
      provides: "characterization tests for ink! event decoders"
    - path: "subquery-node/package.json"
      provides: "test script + vitest + @types/node devDependencies"
  key_links:
    - from: "subquery-node/src/__tests__/contractEvents.decoder.test.ts"
      to: "subquery-node/src/mappings/contractEvents.ts"
      via: "direct import of decodeLiquidityUnlocked, decodeLiquidityLocked"
      pattern: "from.*mappings/contractEvents"
---

<objective>
Add characterization tests for the SubQuery ink! event byte-decoders, proving
`decodeLiquidityUnlocked` is already correct (lpAmount at offset 41), and annotate
the gaps-doc false-positive claim so it is not acted on.

Purpose: Lock in proof that the decode is correct before any future change touches it.
Output: Green test suite + annotated gaps doc. contractEvents.ts is NOT modified.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260616-jky-subquery-decoder-characterization-tests-/260616-jky-PLAN.md
@subquery-node/src/mappings/contractEvents.ts
@subquery-node/package.json
@subquery-node/tsconfig.json
</context>

<tasks>

<task type="auto">
  <name>Task A: Add Vitest test infra to subquery-node</name>
  <files>subquery-node/package.json</files>
  <action>
Add devDependencies and a `test` script to subquery-node/package.json. Mirror the
lunes-dex-main pinned versions exactly: `vitest: "^3.2.6"` and
`@types/node: "^18.11.18"`.

Add the following to package.json:

- Under `"scripts"`: add `"test": "vitest run"` (one-shot CI mode; no watch).
- Under `"devDependencies"`: add `"vitest": "^3.2.6"` and `"@types/node": "^18.11.18"`.

Do NOT touch `tsconfig.json` in any way — the existing `"include": ["src/**/*"]`
and `"module": "commonjs"` must stay untouched so `subql build` keeps working.

Vitest is a native ESM runner but can handle TypeScript/CJS via its own transform
pipeline; `skipLibCheck: true` in the existing tsconfig means polkadot type conflicts
won't surface at build time.

After editing package.json, run `cd /Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node && npm install` to lock the additions.
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node && node -e "const p=require('./package.json'); console.log(p.scripts.test, p.devDependencies.vitest, p.devDependencies['@types/node'])"</automated>
  </verify>
  <done>"vitest run" appears in scripts.test; vitest ^3.2.6 and @types/node ^18.11.18 are in devDependencies; node_modules/vitest exists.</done>
</task>

<task type="auto">
  <name>Task B: Write characterization tests for the decoders</name>
  <files>subquery-node/src/__tests__/contractEvents.decoder.test.ts</files>
  <action>
Create `subquery-node/src/__tests__/contractEvents.decoder.test.ts`.

The file must import only from `../mappings/contractEvents` and from Node builtins
(Buffer). Do NOT import `@subql/types` (requires sandbox VM) or
`@polkadot/util-crypto` (requires WASM/TextEncoder). The helpers `readU64LE` and
`readU128LE` are internal; build payloads using raw Buffer arithmetic.

Helper: write a local `le64(n: bigint): Buffer` and `le128(n: bigint): Buffer`
in-test to produce little-endian bytes, plus a 32-byte accountId constant.

--- PAYLOAD CONSTRUCTION RULES (from verified facts) ---

LiquidityUnlocked payload (57 bytes total):
  [0]     = 0x02  (variant byte — any single byte works)
  [1..9]  = lock_id as u64 LE
  [9..41] = owner as 32-byte AccountId
  [41..57]= lp_amount as u128 LE

LiquidityLocked payload (98 bytes total):
  [0]     = 0x01  (variant byte)
  [1..9]  = lock_id as u64 LE
  [9..41] = owner as 32-byte AccountId
  [41..73]= pair_address as 32-byte AccountId
  [73..89]= lp_amount as u128 LE
  [89..97]= unlock_timestamp as u64 LE
  [97]    = tier as u8

--- TESTS TO WRITE ---

describe("decodeLiquidityUnlocked — characterization") with:

1. "decodes lockId, owner, lpAmount from minimal payload" — construct the 57-byte
   payload above with known values (e.g. lockId=42n, lp_amount=1_000_000n, owner=
   a 32-byte address of all 0xAB). Assert the returned object matches exactly.

2. "lpAmount reads from offset 41 (no pairAddress in LiquidityUnlocked)" — same
   payload, add a comment/assertion that documents why: the LiquidityUnlocked event
   has 3 fields (lock_id, owner, lp_amount); there is no pairAddress field.
   Assert decoder result is defined and lpAmount equals the value placed at [41..57].

3. "returns undefined for truncated payload" — pass an 8-byte payload. Assert result
   is undefined (error swallowed per try/catch in decoder).

describe("decodeLiquidityLocked — contrast characterization") with:

4. "decodes all 6 fields with lpAmount at offset 73" — construct the 98-byte payload
   above with known values. Assert lockId, owner, pairAddress, lpAmount,
   unlockTimestamp, tier all match. Include inline comment: "pairAddress occupies
   [41..73], so lpAmount starts at 73 here — contrast with LiquidityUnlocked which
   has no pairAddress and reads lpAmount at 41".

These are GREEN-by-construction tests. They must pass against the unmodified decoder.
If any test FAILS, STOP execution and surface the discrepancy — do NOT edit the decoder.

Add a file-level comment block at the top:
  // Characterization tests for contractEvents.ts decoders.
  // These tests document and lock the CORRECT current behavior.
  // The PRODUCTION-CODE-GAPS-2026-06-16.md item at ~line 48 claimed
  // lpAmount should be at offset 73 in LiquidityUnlocked — that claim is a
  // FALSE POSITIVE. LiquidityUnlocked has 3 fields (no pairAddress), so
  // the 57-byte payload ends at offset 57 and lpAmount is correctly at offset 41.

After writing the file, run:
  cd /Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node && npm test

All 4 tests (or more) must pass. Report the pass count.
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node && npm test 2>&1 | tail -20</automated>
  </verify>
  <done>All tests pass (vitest shows 0 failed). contractEvents.ts byte-count is unchanged (no edits to it).</done>
</task>

<task type="auto">
  <name>Task C: Annotate the gaps doc — false positive</name>
  <files>.planning/PRODUCTION-CODE-GAPS-2026-06-16.md</files>
  <action>
Edit `.planning/PRODUCTION-CODE-GAPS-2026-06-16.md` at the SubQuery indexer block
(currently line ~48). The current text starts with:
  "decodeLiquidityUnlocked lê lpAmount no byte offset 41, que cai dentro do campo
  pairAddress..."

Prepend the following annotation block immediately before that bullet (or inline as
a leading sub-sentence). The annotation must be clearly marked:

  > **[FALSE POSITIVE — 2026-06-16 characterization tests]** `LiquidityUnlocked`
  > has EXACTLY 3 fields: `lock_id (u64)`, `owner (AccountId)`, `lp_amount (u128)`.
  > There is NO `pairAddress` in this event (pairAddress only exists in
  > `LiquidityLocked`, a different 6-field event). The payload is 57 bytes:
  > [0]=variant, [1..9]=lock_id, [9..41]=owner, [41..57]=lp_amount. Offset 41 is
  > CORRECT. Applying the suggested "fix" (move lpAmount to 73, add pairAddress)
  > would read past the 57-byte payload boundary → readU128LE returns 0 → corrupts
  > the withdraw-finalization gate. DO NOT apply this fix.
  > Verified by: `subquery-node/src/__tests__/contractEvents.decoder.test.ts`.

Keep the original text in place below the annotation for historical reference (do
not delete it; it serves as a record of what the audit claimed).
  </action>
  <verify>
    <automated>grep -n "FALSE POSITIVE" /Users/lucas/Documents/Projetos_DEV/Lunex/.planning/PRODUCTION-CODE-GAPS-2026-06-16.md</automated>
  </verify>
  <done>The gaps doc contains the FALSE POSITIVE annotation block referencing the test file. The original audit text is preserved below it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test file → decoder | Pure-function import; no external I/O, no chain access |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260616jky-01 | Tampering | contractEvents.ts decoder | accept | Tests are read-only characterization — they assert, not mutate |
| T-260616jky-SC | Tampering | npm install (vitest, @types/node) | mitigate | Both packages are well-known (npmjs.com verified); slopcheck before install |
</threat_model>

<verification>
1. `cd subquery-node && npm test` → all pass, 0 failures.
2. `cd subquery-node && npx tsc --noEmit` → 0 errors (existing typecheck baseline preserved).
3. `grep -n "FALSE POSITIVE" .planning/PRODUCTION-CODE-GAPS-2026-06-16.md` → returns the annotation line.
4. `git diff --name-only subquery-node/src/mappings/contractEvents.ts` → empty (decoder not touched).
</verification>

<success_criteria>
- Vitest runs inside subquery-node with `npm test`.
- 4+ characterization tests pass green against the unmodified contractEvents.ts.
- The test file documents (via comment + assertion shape) that offset 41 is correct for LiquidityUnlocked and offset 73 is correct for LiquidityLocked.
- The gaps-doc false-positive is annotated with byte-layout proof.
- `subql build` (tsc compilation) stays clean.
</success_criteria>

<output>
Create `.planning/quick/260616-jky-subquery-decoder-characterization-tests-/260616-jky-01-SUMMARY.md` when done.
</output>
