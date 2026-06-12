# Runbook: Indexer Lag

## Alerts

- `SubQueryNodeDown`
- `SubQueryQueryDown`
- Future `IndexerLag`

## Impact

SubQuery-backed reads can become stale. Do not use indexer state as the source of truth for fund-moving decisions.

## Triage

1. Compare chain head with SubQuery last processed height.
2. Check SubQuery node/query logs and Postgres health.
3. Check recent schema or mapping changes.

## Mitigation

1. Restart SubQuery only after preserving logs.
2. Reindex from the last known-good block if mappings are corrupted.
3. Keep user-facing stale-data indicators visible until caught up.

## Evidence To Capture

- chain height, indexed height, lag duration
- failed mappings or DB errors
- recovery time
