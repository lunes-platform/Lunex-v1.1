---
phase: quick-260616-juv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lunes-dex-main/src/pages/home/index.tsx
  - lunes-dex-main/src/pages/home/modals/confirmSwap/index.tsx
autonomous: true
requirements:
  - DISPLAY-QUOTE-VALUES-IN-CONFIRM-MODAL
must_haves:
  truths:
    - "Confirm Swap modal shows real Minimum received value with output token acronym"
    - "Confirm Swap modal shows real Price impact percentage"
    - "Confirm Swap modal shows LP fee computed as 0.3% of the input amount with input token acronym"
    - "Confirm Swap button is disabled when quote values are absent (minimumReceived missing or '0')"
    - "The caveat copy reflects reality: present when no quote, updated when quote is live"
  artifacts:
    - path: "lunes-dex-main/src/pages/home/modals/confirmSwap/index.tsx"
      provides: "Modal accepting ConfirmSwapProps with quote values; renders real fields; gates confirm button"
      exports: [ConfirmSwap]
    - path: "lunes-dex-main/src/pages/home/index.tsx"
      provides: "Parent passing minimumReceived, priceImpact, inputValue1, selectedOption1, selectedOption2 to modal"
  key_links:
    - from: "home/index.tsx (modal render at line 395)"
      to: "confirmSwap/index.tsx"
      via: "ConfirmSwapProps prop extension"
      pattern: "minimumReceived|priceImpact|lpFee"
---

<objective>
Wire the real quote values — Minimum received, Price impact, and LP fee — into
the Confirm Swap modal, and gate the confirm button until those values are
populated.

Purpose: The modal currently renders literal "Unavailable" for all three quote
rows, giving the user no actionable information before approving a swap. The
data already exists in the parent's local state after `getQuote` resolves.
This plan threads the props, computes LP fee locally, and enforces the
quote-ready gate.

Output:
- `confirmSwap/index.tsx` — extended props, real renders, gated button
- `home/index.tsx` — passes quote state down to modal
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/lucas/Documents/Projetos_DEV/Lunex/.planning/STATE.md
@/Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main/src/pages/home/modals/confirmSwap/index.tsx
@/Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main/src/pages/home/index.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend ConfirmSwapProps and render real quote values with quote-ready gate</name>
  <files>lunes-dex-main/src/pages/home/modals/confirmSwap/index.tsx</files>
  <behavior>
    - computeLpFee('100', 8): result equals (100 * 0.003).toFixed(8) trimmed of trailing zeros — i.e. '0.3'
    - computeLpFee('0', 8): returns '0'
    - computeLpFee('', 8): returns '0'
    - isQuoteReady('0.00040321', '0'): false (minimumReceived present but priceImpact '0' does not block — only minimumReceived matters)
    - isQuoteReady('0.00040321', '1.2'): true
    - isQuoteReady('', '1.2'): false
    - isQuoteReady('0', '1.2'): false
    - isQuoteReady(undefined, '1.2'): false
  </behavior>
  <action>
Extract two pure functions to a sibling utility file
`lunes-dex-main/src/pages/home/modals/confirmSwap/quoteUtils.ts`:

  `computeLpFee(inputAmount: string, decimals: number): string`
  — parses inputAmount as a float, multiplies by 0.003, formats to `decimals`
    significant decimal places (use `parseFloat(...).toFixed(decimals)` then
    strip trailing zeros with `.replace(/\.?0+$/, '')`). Returns '0' if
    inputAmount is empty, '0', or NaN.

  `isQuoteReady(minimumReceived: string | undefined, _priceImpact: string | undefined): boolean`
  — returns true when minimumReceived is a non-empty string that is not '0'.
    The second param is accepted for symmetry but does not affect the result
    (price impact of '0' is a valid live quote for same-block, zero-impact
    trades).

Add unit tests in
`lunes-dex-main/src/pages/home/modals/confirmSwap/quoteUtils.test.ts`
covering all behavior cases above. Use Vitest `describe/it/expect` (no
@testing-library needed).

Then update `confirmSwap/index.tsx`:

1. Extend `ConfirmSwapProps`:
   ```
   type ConfirmSwapProps = {
     close: () => void
     confirm: () => void
     minimumReceived?: string
     priceImpact?: string
     inputValue1?: string
     inputAcronym?: string
     outputAcronym?: string
   }
   ```

2. Inside the component, derive:
   ```
   const quoteReady = isQuoteReady(props.minimumReceived, props.priceImpact)
   const lpFee = computeLpFee(props.inputValue1 ?? '', 8)
   ```

3. Replace the three `<B.Span>Unavailable</B.Span>` lines (currently lines
   89-91) with:
   - Minimum received: `{props.minimumReceived || '—'} {props.outputAcronym || ''}`
   - Price impact: `{props.priceImpact || '—'}%`
   - Liquidity Provider Fee: `{lpFee} {props.inputAcronym || ''}`

   The label "Liquidity Provider Fee" stays as-is (no rename).

4. Update the caveat `<B.Span>` (currently lines 63-66):
   Replace the full existing text with:
   ```
   {quoteReady
     ? 'Output is estimated. You will receive at least the minimum shown, or the transaction will revert.'
     : 'Output is estimated from the current quote. Minimum received is unavailable until the router returns a live quote.'}
   ```

5. Update the button disabled condition (line 108):
   ```
   disabled={!isChecked || !quoteReady}
   ```

Do NOT add any styled-component variants, new components, or imports beyond
`isQuoteReady` and `computeLpFee` from `./quoteUtils`.
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main && npx vitest run src/pages/home/modals/confirmSwap/quoteUtils.test.ts 2>&1</automated>
  </verify>
  <done>
    - `quoteUtils.test.ts` passes all behavior cases (computeLpFee + isQuoteReady)
    - `confirmSwap/index.tsx` renders minimumReceived, priceImpact, lpFee from props
    - Button disabled when `!isChecked || !quoteReady`
    - Caveat text is conditional on quoteReady
    - No TypeScript errors on the file (`npx tsc --noEmit` clean)
  </done>
</task>

<task type="auto">
  <name>Task 2: Pass quote values from home/index.tsx to ConfirmSwap modal</name>
  <files>lunes-dex-main/src/pages/home/index.tsx</files>
  <action>
Locate the modal render block for `confirmSwap` (currently lines 395-400):

```tsx
{modal === 'confirmSwap' && (
  <M.ConfirmSwap
    close={() => setModal('null')}
    confirm={() => setModal('waitingConfirmation')}
  />
)}
```

Add the five new props sourced from existing local state (all variables already
exist in scope at this render site):

```tsx
{modal === 'confirmSwap' && (
  <M.ConfirmSwap
    close={() => setModal('null')}
    confirm={() => setModal('waitingConfirmation')}
    minimumReceived={minimumReceived}
    priceImpact={priceImpact}
    inputValue1={inputValue1}
    inputAcronym={selectedOption1?.acronym}
    outputAcronym={selectedOption2?.acronym}
  />
)}
```

No other changes to `home/index.tsx`. The variables `minimumReceived`,
`priceImpact`, `inputValue1`, `selectedOption1`, `selectedOption2` are all
already declared in the component's local state and are in scope at line 395.

NOTE: `handleConfirmSwap` at line 137 opens the `waitingConfirmation` modal
directly (not `confirmSwap`). The `confirmSwap` modal is not yet wired to the
main Swap button (that button calls `handleConfirmSwap` directly). This plan
does NOT change that wiring — it is out of scope. This task only ensures the
modal receives correct data when it IS opened (e.g. via a future "Review"
step or direct modal trigger).
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main && npx tsc --noEmit 2>&1 | head -40</automated>
  </verify>
  <done>
    - `M.ConfirmSwap` render in `home/index.tsx` passes all five new props
    - `npx tsc --noEmit` exits 0 (no type errors on changed files)
    - `npx eslint src/pages/home/index.tsx src/pages/home/modals/confirmSwap/index.tsx --max-warnings=0` exits 0
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| SDK → component props | `minimumReceived` and `priceImpact` arrive from `getQuote` response; malformed strings (NaN, negative) are display-only — no fund movement occurs in the modal |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-juv-01 | Tampering | LP fee display (0.3% calc) | accept | Display-only; actual swap fee enforced on-chain by the pair contract. Frontend showing wrong fee cannot affect on-chain outcome. |
| T-juv-02 | Information Disclosure | minimumReceived prop | accept | Value sourced from public AMM quote; no PII or secrets. |
| T-juv-03 | Denial of Service | isQuoteReady gate | mitigate | Gate ensures confirm button stays disabled if minimumReceived is empty/zero, preventing user confirmation with stale state. Covered by unit tests. |
</threat_model>

<verification>
Full verification sequence (run in order after both tasks):

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main

# 1. Unit tests for pure functions
npx vitest run src/pages/home/modals/confirmSwap/quoteUtils.test.ts

# 2. TypeScript — whole project
npx tsc --noEmit

# 3. ESLint — changed files only
npx eslint \
  src/pages/home/index.tsx \
  src/pages/home/modals/confirmSwap/index.tsx \
  src/pages/home/modals/confirmSwap/quoteUtils.ts \
  src/pages/home/modals/confirmSwap/quoteUtils.test.ts \
  --max-warnings=0

# 4. Build smoke (catches tree-shake / import errors)
npm run build 2>&1 | tail -20
```

DEFERRED — browser verification NOT available this session (spot-api/postgres
DOWN per STATE.md). Manual check required when stack is up:
- Open the DEX, select two tokens, enter an amount, wait for quote.
- Trigger the Confirm Swap modal (may require temporarily opening it via
  `setModal('confirmSwap')` in DevTools or wiring the main Swap button to
  open it first).
- Verify Minimum received shows the formatted amount + output acronym.
- Verify Price impact shows percentage.
- Verify LP fee shows 0.3% of input + input acronym.
- Verify Confirm Swap button is disabled until checkbox is checked AND quote
  values are populated.
- Dismiss quote (clear input) and reopen: verify button stays disabled and
  caveat shows the "unavailable" copy.
</verification>

<success_criteria>
- `quoteUtils.test.ts` passes: computeLpFee and isQuoteReady cover all edge cases
- `npx tsc --noEmit` exits 0 across the lunes-dex-main project
- ESLint exits 0 on changed files (--max-warnings=0)
- `npm run build` completes without errors
- Modal code no longer contains any literal "Unavailable" strings in the three quote rows
- Confirm button `disabled` prop includes `!quoteReady` in addition to `!isChecked`
</success_criteria>

<output>
Create `.planning/quick/260616-juv-confirmswap-mostrar-minimumreceived-pric/260616-juv-SUMMARY.md` when done.
</output>
