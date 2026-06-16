# Cleanup Pass #6 — AI Slop / Comments
Date: 2026-06-16

## Scope scanned
spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, faucet, subquery-node/src

---

## Categories Found

### 1. Restate-code comments (redundant inline `//`)
Comments that name exactly what the next line of code does.

**Removed (13):**
| File | Line | Removed comment |
|------|------|-----------------|
| `spot-api/src/middleware/agentAuth.ts` | 5 | `// Extend Express Request to include agent context` |
| `spot-api/src/middleware/agentAuth.ts` | 43 | `// Check required permissions` |
| `spot-api/src/routes/tradeApi.ts` | 205 | `// Update execution log with order id` |
| `spot-api/src/routes/tradeApi.ts` | 307 | `// Update execution log with order id` |
| `spot-api/src/services/botSandbox.ts` | 96 | `// Check minute window` |
| `spot-api/src/services/botSandbox.ts` | 104 | `// Check hour window` |
| `spot-api/src/services/botSandbox.ts` | 381 | `// Log anomalies (in production, persist to DB)` |
| `spot-api/src/services/rebalancerService.ts` | 272 | `// Log success` |
| `spot-api/src/services/rewardScheduler.ts` | 27 | `// Check every hour if it's time to distribute` |
| `spot-api/src/services/strategyService.ts` | 431 | `// Update strategy performance fields + Agent reputation` |

### 2. In-motion / fix-marker comments
Comments carrying transitional labels (`B1 FIX:`, `// Changed from...`).

**Rewritten (2):**
| File | Before | After |
|------|--------|-------|
| `spot-api/src/services/affiliateService.ts:340` | `// B1 FIX: Batch all counts and earnings in 2 queries instead of 2×N` | `// Batch all counts and earnings in 2 queries to avoid N+1 over referees.` |
| `lunes-dex-main/src/pages/header/modals/connectWallet/index.tsx:149` | `// Changed from styled.button to styled.div to avoid invalid <button> nesting: ...` | `// Outer element is a div, not a button, to avoid invalid nested <button> elements. ...` |

### 3. Noise single-word catch comments
`// ignore` in catch blocks that swallow errors without context.

**Rewritten (2):**
| File | Before | After |
|------|--------|-------|
| `lunes-dex-main/src/context/SpotContext.tsx:366` | `// ignore` | `// silently skip — stale orders are non-critical; UI retains previous state` |
| `lunes-dex-main/src/context/SpotContext.tsx:380` | `// ignore` | `// silently skip — stale trades are non-critical; UI retains previous state` |

### 4. Trivial JSDoc that restates param names
`@param amount - Amount` / `@param multiplier - Multiplier` — param names are self-documenting.

**Rewritten (1 block):**
| File | Action |
|------|--------|
| `sdk/src/utils.ts:95-100` | Collapsed 6-line JSDoc block to a single-line `/** ... */` that actually explains what the function does (BigInt-string × float). |

### 5. Pure unlabelled section dividers
Closing `// ─────────...` lines with no label — they terminate a labelled opening banner but add no information.

**Removed (2):**
| File | Description |
|------|-------------|
| `spot-api/src/routes/tradeApi.ts` (swap route) | Closing divider after execution-layer validation block |
| `spot-api/src/routes/tradeApi.ts` (limit route) | Closing divider after execution-layer validation block |

### 6. "Instead of" transitional phrase
Comment described the historical motivation rather than the current design.

**Rewritten (1):**
| File | Before | After |
|------|--------|-------|
| `spot-api/src/services/socialIndexerService.ts:1089` | `// instead of polling the blockchain directly. Much faster and more reliable.` | `// rather than polling the chain directly via Polkadot.js.` |

---

## Totals
- Removed: 14 comment lines
- Rewritten/improved: 6 comments (affiliateService, connectWallet, SpotContext ×2, sdk/utils, socialIndexerService)
- Left untouched (intentional): all TODO(types), TODO(ADR-*), license headers, eslint-disable, @ts-expect-error, disabled-safeguard comments, deep technical explanations (settlementService nonce pipeline, vaultReconciliation source-of-truth, rewardDistribution idempotency block, agentService state machine, pairs.ts DB-aggregate rationale, contractEvents.ts SCALE decode rationale, subqueryClient file header).

---

## Code-level stubs / LARP flagged — NOT touched

These are logic-level issues (not comment noise). Flagged for the backlog:

| File | Line | Issue |
|------|------|-------|
| `lunes-dex-main/src/pages/social/BotRegistry/index.tsx:792-799` | `RevokeBtn` onClick calls `showToast('Use CLI or SDK to revoke keys')` — the revoke button is present but does nothing except display a toast. The comment "Revoke would need stored API key — simplified for now" documents the limitation. The UI presents a revoke affordance it cannot fulfill. **Flag:** UI larp — button appears functional but is a stub. No logic was removed. |

---

## tsc result
All four checked packages (spot-api, sdk, lunes-dex-main, lunex-admin) returned zero TypeScript errors after edits.

## Zero logic changes confirmed
All edits removed or rewrote `//` comment text only. No executable code was added, removed, or reordered.
