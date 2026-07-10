# Runbook: Deploy Rollback

## Alerts

- Any production regression after deploy

## Impact

Bad deploys can affect trading, signing, settlement, admin actions, API clients, and public docs.

## Triage

1. Identify deployed SHA, image tags, migrations, and config changes.
2. Determine whether DB migrations are backward-compatible.
3. Check health, logs, and user impact.

## Mitigation

1. Roll back application image to the previous known-good immutable SHA.
2. Do not roll back DB schema unless a tested reverse migration exists.
3. Restart services and verify health checks.
4. Run smoke checks for API, DEX, SDK/MCP-critical routes, and settlement safety.

## Evidence To Capture

- failed SHA and rollback SHA
- migration status
- smoke-check output
- user impact window

