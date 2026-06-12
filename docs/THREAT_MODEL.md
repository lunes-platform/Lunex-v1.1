# Lunex Threat Model

**Status:** production-readiness baseline  
**Last updated:** 2026-06-04  
**Launch verdict:** NO-GO while P0 contract, ops, and compliance blockers remain open.

## Assets

| Asset | Security goal |
|---|---|
| User funds and LP positions | No unauthorized movement, loss, accounting drift, or settlement bypass |
| Wallet signatures | Explicit user intent, replay resistance, no leakage through URLs/logs |
| Contract state | Deterministic authorization, tested invariants, verifiable release artifacts |
| Order and settlement records | Finality-aware status, no premature success on `isInBlock` |
| Admin and relayer keys | No dev seeds, least privilege, rotation path, incident audit trail |
| User profile/copytrade data | Wallet-scoped access control, private reads require explicit signing |
| Backups and operational logs | Restoreable, tamper-evident enough for incident reconstruction |

## Trust Boundaries

| Boundary | Entry points | Primary risks | Current controls | Open gaps |
|---|---|---|---|---|
| Browser wallet to DEX UI | `signRaw`, extension injection, transaction signing | unwanted prompts, signing wrong payload, wallet spoofing | explicit-signing cleanup, `frontend:guard`, signed-read headers | browser Playwright wallet-mock coverage still needed |
| DEX UI to `spot-api` | REST, WebSocket | signature leakage, replay, CORS abuse, stale API URL | signed reads moved to headers, nonce checks, production URL guard | public docs still contain legacy localhost/dev examples |
| `spot-api` to chain | Polkadot API, relayer/fund services | premature finality, relayer key compromise, RPC spoofing | finalized-only helper, production guard expansion | contract-side order authorization still open |
| `spot-api` to database/Redis | Prisma, nonce store, orderbook recovery | nonce replay if Redis down, DB drift, data loss | production rejects Redis localhost, nonce store checks | restore drill proof still needed |
| Contracts to contracts | Router, Pair, CopyVault, Staking, Settlement | ABI mismatch, ignored tests, untested `#[cfg(not(test))]` paths | contract review recorded | `CopyVault`/Router ABI mismatch and ignored tests remain |
| Admin to emergency controls | admin UI/API, emergency service | unauthorized pause/unpause, weak session, missing audit | production guards, emergency service finality work | admin TTL/reauth and E2E still needed |
| MCP/SDK to public API | generated clients, AI agent tooling | stale endpoint contract, agent misuse, unsafe defaults | signed-read header migration, MCP updates | canonical OpenAPI/SDK route checker still needed |
| Observability/backup systems | Prometheus, Grafana, Loki, S3 backup | blind incidents, broken alert links, untested recovery | alert/runbook baseline added | restore drill and backup-age metric proof still needed |

## STRIDE Summary

| Threat | Relevant components | Mitigations | Remaining blocker |
|---|---|---|---|
| Spoofing | wallet auth, admin auth, relayer | sr25519 verification for API reads/actions, nonce TTL, admin secret guard | contract `SpotSettlement` still does not enforce real on-chain order signature verification |
| Tampering | order payloads, contract calls, DB state | canonical cancel payload, finality helper, settlement synthetic-order gate | create-order canonical payload alignment still open |
| Repudiation | signed reads/actions, admin operations | nonce/timestamp/signature logging without query leakage, alert runbooks | admin audit trail and reauth test coverage still open |
| Information disclosure | URLs, logs, profile reads | signed auth moved to headers, no signed reads on mount for mapped flows | public docs and legacy specs still need cleanup |
| Denial of service | API, Redis, DB, WebSocket, RPC | rate-limit alerting, Redis/DB health alerts, API down runbook | chaos test and resource-limit evidence still open |
| Elevation of privilege | admin, relayer, contract owner roles | production seed guards, disclosure policy, emergency runbooks | key rotation runbook needs a live drill; contract access control audit must be re-run after CRYPTO-02 |

## Known P0 Risks

1. `SpotSettlement` authorization is not mainnet-safe until on-chain sr25519 verification with a shared canonical payload or an on-chain order-commitment fallback is implemented.
2. `CopyVault` calls a router path that does not match the public router ABI.
3. Router hot-path tests remain ignored and several contracts still hide production behavior behind test-only gates.
4. Restore/PITR is not proven by a documented drill.
5. Public launch compliance posture, jurisdictional restrictions, terms, privacy/LGPD, and risk disclosures still need owner sign-off.

## Review Cadence

- Update this document on every P0 security, contract, or ops change.
- Re-run review before audit handoff and before the mainnet dress rehearsal.
- Treat stale threat model sections as release blockers for public mainnet.

