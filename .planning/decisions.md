# Lunex Decisions

## 2026-06-03 — CRYPTO-02 SpotSettlement Signature Strategy

**Status:** Accepted for production planning
**Decision owner:** Engineering
**Scope:** `spot_settlement`, spot-api settlement relayer, frontend/SDK/MCP order signing, mainnet launch gates

### Decision

Lunex must not launch public mainnet settlement with the current `spot_settlement.verify_order_signature()` no-op trust model.

Public mainnet is blocked until one of these production-grade authorization models is implemented and tested:

1. **On-chain sr25519 verification:** Lunes runtime exposes a production-usable contract host function for sr25519 verification, and Lunex migrates every consumer to a single versioned canonical order message shared by contract, API, SDK, frontend, and MCP.
2. **On-chain order commitment fallback:** users authorize orders by submitting on-chain order commitments; `settle_trade` only settles against committed hashes, and cancellation/nonce invalidation are user-authorized on-chain.

The current relayer-only/off-chain verification model may be used only for testnet, sandbox, or closed beta with explicit risk disclosure and no claim that the contract verifies user order signatures on-chain.

### Rationale

- `verify_order_signature()` currently only rejects an all-zero signature and otherwise returns `Ok(())`.
- The contract's canonical binary order message is not the same protocol as the ASCII wallet message used by API, frontend, SDK, and MCP. Even if `seal_sr25519_verify` becomes available, a simple function-body swap would reject existing client signatures.
- A compromised relayer/API can submit unauthorized settlements directly to the contract while signature verification is absent.
- Pure Rust sr25519 verification inside the ink! contract is not an acceptable near-term path because it expands Wasm size, `no_std` crypto risk, gas/weight uncertainty, and audit surface.
- ECDSA migration is a new authentication architecture, not a compatibility fix.

### Acceptance Criteria

For the on-chain sr25519 path:

- One canonical signed order payload is specified and implemented identically in Rust and TypeScript.
- Invalid maker signatures are rejected on-chain.
- Replay, tampered payload, partial-fill mutation, and cancel/nonce invalidation tests pass.
- Testnet rehearsal proves real wallet signatures can be settled and forged relayer submissions fail.

For the on-chain commitment fallback:

- `place_order_commitment` and `cancel_order_commitment` or equivalent user-authorized messages exist on-chain.
- `settle_trade` proves every settled order matches a committed hash.
- Commitment schema is versioned and shared across API, frontend, SDK, MCP, and contract tests.
- Synthetic `agent:` / `manual:` orders cannot enter the settlement path unless a separate delegated-authorization design is implemented and audited.

### Launch Gates

- Human wallet order create/cancel signing contracts must be aligned across frontend, API, SDK, MCP, and docs.
- Numeric nonce semantics must be consistent across all order producers.
- Synthetic order paths must be disabled for launch or converted to an audited delegated authorization model.
- Relayer custody still requires KMS/HSM or equivalent multi-operator controls, but that is a secondary defense, not a replacement for on-chain authorization.

