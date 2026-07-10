# Security Policy

## Supported Scope

This policy covers the Lunex production candidate repository, including:

- ink! smart contracts under `Lunex/contracts/`
- `spot-api`
- `lunes-dex-main`
- `lunex-admin`
- SDK and MCP packages
- Docker, deployment, monitoring, and operational scripts
- SubQuery/indexer and faucet components

Testnet-only examples, archived reports, and local bootstrap scripts are in scope when they can influence production configuration, keys, user funds, or public documentation.

## Reporting A Vulnerability

Report vulnerabilities privately to:

- Email: `security@lunes.io`
- Subject prefix: `[Lunex Security]`

Include:

- affected component and commit SHA
- severity estimate
- reproduction steps or proof of concept
- expected impact on funds, signing, privacy, availability, or compliance
- logs, transaction hashes, screenshots, or traces when available

Do not disclose publicly until Lunex confirms remediation or agrees on a disclosure date.

## Response Targets

| Severity | Examples | First response | Target remediation |
|---|---|---:|---:|
| Critical | fund loss, signature bypass, private key exposure, production auth bypass | 24h | immediate mitigation, patch target within 72h |
| High | privilege escalation, replayable signed actions, settlement integrity failure | 48h | 7 days |
| Medium | data leak, rate-limit bypass, operational control weakness | 5 business days | 30 days |
| Low | hardening issue, missing header, documentation safety issue | 10 business days | next planned release |

If a fix requires chain/runtime support or external audit retest, the mitigation plan must document interim controls and whether public launch remains blocked.

## Safe Harbor

Good-faith research is authorized when it:

- avoids theft, extortion, data destruction, privacy invasion, and service disruption;
- uses the minimum proof needed to demonstrate impact;
- does not move or lock user funds;
- does not publish sensitive details before coordinated disclosure;
- stops testing and reports immediately after identifying a vulnerability.

Testing against production with real user funds, social engineering, phishing, spam, physical attacks, and denial-of-service attempts are not authorized.

## Production Launch Security Gates

Public mainnet with real funds is blocked unless:

- all P0 items in `.planning/PRODUCTION_GSD_EXECUTION_PLAN_2026-06-03.md` are closed;
- fund-moving code waits for finalized chain status;
- production boot rejects dev seeds, placeholders, localhost, and empty critical envs;
- `SpotSettlement` has an accepted on-chain signature or commitment design implemented;
- signed reads do not leak signature material in query strings;
- user signing is explicit and not triggered by navigation, remount, or tab changes;
- runbooks, restore drill evidence, threat model, and alert links are current;
- launch candidate artifacts are reproducible and audit handoff evidence is archived.

## Incident Handling

Use `docs/runbooks/` for active incidents. Every critical or warning alert in `docker/alert-rules.yml` must link to a local runbook. Security incidents must preserve:

- alert name and timestamp;
- impacted services, wallets, contracts, or orders;
- exact release SHA and deployed artifact hashes;
- mitigation performed;
- user impact and disclosure decision;
- follow-up tasks and owners.

