# SDD Operation Readiness Report (Asymmetric + Copytrade)

**Date:** 2026-04-14  
**Scope:** `asymmetric-liquidity-v1` (P0) + `social-copytrade-v1` Option B (P1 server-side)

## Executive Summary

The asymmetric operation path was upgraded to a canonical status contract with additive compatibility, uniform audit traces for manual/agent/auto actions, and UI/SDK alignment for persisted-vs-live visibility.

Copytrade Option B remains in the agreed scope: real aggregated execution for server-executable routes (`ORDERBOOK`, `AMM_V1`) and wallet-assisted continuation for `ASYMMETRIC`, with validation and tests consolidated.

## Implemented Changes

### 1. Canonical Asymmetric Status (Additive, Non-Breaking)

- `GET /api/v1/asymmetric/strategies/:id` now returns legacy fields **plus**:
  - `persistedConfig`
  - `liveState`
  - `delegation`
- `GET /api/v1/asymmetric/agent/strategy-status/:id` now uses the same canonical status aggregation path.
- Live state is enriched by on-chain reads (no schema migration required).

### 2. Asymmetric Audit and Delegation Hardening

- Manual actions (`toggle-auto`, user curve updates) now emit explicit audit records.
- Agent linkage emits agent-scoped audit record.
- `agent/link-strategy` delegation flow validated with explicit `409` when on-chain manager delegation is missing.
- Recent logs are normalized for trigger/status representation in API responses.

### 3. UI and SDK Alignment

- `/pool/asymmetric` now renders:
  - persisted operational status,
  - live on-chain curve availability/state,
  - delegation state (`manager`, relayer delegation),
  - recent audit logs.
- Frontend SDK and root SDK asymmetric types now support additive canonical fields while preserving legacy shape compatibility.

### 4. Copytrade Option B Consolidation

- Validation retained for real execution path on `ORDERBOOK`/`AMM_V1`.
- Wallet-assisted continuation retained for `ASYMMETRIC` with pending/confirmation lifecycle and floor checks.
- Follow-up status consolidated in SDD task artifacts.

## Validation Evidence

### Spot API

- `npx tsc --noEmit` (pass)
- `npm test -- src/__tests__/asymmetricService.test.ts src/__tests__/rebalancerService.test.ts src/__tests__/e2e/asymmetric.e2e.test.ts` (pass)
- `npm test -- src/__tests__/copytradeSignalExecution.test.ts src/__tests__/e2e/copytrade.e2e.test.ts` (pass)
- Operational sandbox check (real DB + real chain, no mocks):
  - chain connectivity: `wss://sandbox.lunes.io/ws` reachable (head `#208126` during check);
  - temporary strategy lifecycle validated with cleanup:
    - `createStrategy` (register) ✅
    - `toggleAutoRebalance` ✅
    - `updateCurveParams` ✅
    - `linkStrategyToAgent` ✅
    - audit logs generated (`MANUAL`, `AI_AGENT`) ✅
  - on-chain delegation state read:
    - `managerAddress: null`
    - `delegatedToRelayer: false`
    - `owner` query on target contract returned `None` in the sandbox address currently configured (`SANDBOX_ASYMMETRIC_PAIR_CONTRACT`), preventing owner-scoped `set_manager` execution in this check window.
  - expected block on relayer-driven on-chain update:
    - `executeAgentCurveUpdate` -> `Relayer is not delegated as manager on this AsymmetricPair`

### Frontend / SDK

- `cd lunes-dex-main && npx tsc --noEmit` (pass)
- `cd sdk && npx tsc --noEmit` (pass)

## Residual Risk / Pending Operational Check

- **Still pending (hard blocker):** manual wallet-driven `set_manager` delegation on the target `AsymmetricPair` contract in sandbox/testnet.
- **Still pending:** full wallet path `deploy -> register -> update -> delegation` from UI (`/pool/asymmetric`) with signed on-chain deployment txs.
- If chain RPC is unavailable, canonical response intentionally degrades to `liveState.available=false` with reason instead of returning inconsistent synthetic state.

## SDD Artifact Updates

- `docs/features/asymmetric-liquidity-v1/TASKS.md` updated with completed checklist items and residual blocker.
- `docs/features/social-copytrade-v1/TASKS.md` updated (`Status: completed`) with Option B scoped completion and follow-up consolidation.
