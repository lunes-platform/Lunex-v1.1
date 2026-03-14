---
description: mandatory pre-launch security review for Lunex releases
---
1. Confirm the release scope before running any checks.
   - Record:
     - target branch or tag
     - affected packages and contracts
     - migration status
     - whether the release touches custody, settlement, copy trading, governance, or authentication

2. Run the manual pre-launch checklist using `docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md`.
   - Complete every section:
     - Smart Contracts
     - Vault Accounting
     - Blockchain Integration
     - Authentication
     - Trading Engine
     - Copy Trading
     - Rate Limiting
     - Secret Management
     - Infrastructure
   - Mark each item as:
     - `PASS`
     - `FAIL`
     - `N/A`

3. Run the DeFi attack simulation review.
   - Simulate and document:
     - Fake Deposit Attack
     - Wallet Impersonation
     - Copytrade Exploit
     - Wash Trading
     - Liquidity Manipulation
     - Governance Takeover
     - Bot Abuse
   - For each scenario record:
     - attack scenario
     - success probability
     - affected code
     - recommended fix

4. Run the red-team protocol review.
   - Evaluate:
     - Vault Drain
     - Replay Attacks
     - Trade Manipulation
     - Governance Capture
     - Indexer Manipulation
   - For each finding record:
     - severity
     - exploit description
     - affected files
     - fix recommendation

5. Execute the automated pre-launch CI workflow.
   - Run the GitHub Actions workflow:
     - `.github/workflows/prelaunch-security.yml`
   - Use the release branch or tag as the workflow input.
   - Provide the path to the completed review document.

6. Re-run local validation for the most sensitive packages.
   - Root scripts TypeScript:
     - `npx tsc --noEmit -p tsconfig.json`
   - Spot API targeted tests:
     - `npm test --prefix spot-api -- --runInBand src/__tests__/e2e/copytrade.e2e.test.ts src/__tests__/e2e/social.e2e.test.ts src/__tests__/tradeSettlementService.test.ts src/__tests__/tradeService.test.ts`
   - SDK build:
     - `npm run build --prefix sdk`
   - MCP build if the release touches MCP integrations:
     - `npm run build --prefix mcp/lunex-agent-mcp`

7. Validate on-chain and backend source-of-truth assumptions.
   - Confirm that:
     - database state is not treated as financial source of truth
     - deposits and withdrawals reconcile against blockchain balance
     - signed wallet actions use nonce and timestamp validation
     - copytrade WEB3 signals are bound to the real leader wallet
     - settlement validation still rejects untrusted order origin

8. Block the release if any critical item fails.
   - Do not deploy when any of the following is unresolved:
     - failed authentication checks
     - vault accounting mismatch
     - exploitable copy trading scaling issue
     - replay attack path
     - secret exposure
     - CI security workflow failure

9. Publish the final review summary.
   - Include:
     - overall status: `APPROVED` or `BLOCKED`
     - release ref
     - reviewer
     - unresolved risks
     - links to CI runs and supporting evidence
