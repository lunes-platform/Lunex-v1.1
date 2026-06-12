# Runbook: SubQuery Listing Backfill

## Alerts

- `SubQueryNodeDown`
- `SubQueryQueryDown`
- `ListingRelayerCursorStale`
- `ListingRelayerActivationFailures`

## Impact

Listing activation and liquidity-lock withdraw finalization depend on finalized `ListingEvent` records. If the updated SubQuery schema is not deployed and backfilled, `spot-api` rejects listing proofs and listings remain pending even when the chain emitted valid events.

## Triage

1. Confirm the deployed code includes `ListingEvent.listingId` and `ListingEvent.lockId`.
2. Confirm `subquery-node` is running with `--unfinalized-blocks=false`.
3. Query SubQuery GraphQL for recent `TOKEN_LISTED`, `LIQUIDITY_LOCKED`, and `LIQUIDITY_UNLOCKED` records.
4. Compare the relayer cursor block with SubQuery `_metadata.lastProcessedHeight`.
5. Check `listing-relayer` logs for proof lookup or activation failures.

## Mitigation

1. Put public token-listing activation in maintenance mode if proof verification is failing broadly.
2. Stop `listing-relayer` before a destructive SubQuery reindex so it does not repeatedly submit missing-proof activations.
3. Deploy the updated `subquery-node` code and render `project.yaml` with the target `LUNES_CHAIN_ID`, `LUNES_WS_URL`, and `LUNES_START_BLOCK`.
4. For a full backfill, preserve a database backup, then clear only the `subquery` schema and restart `subquery-node`.
5. Wait until SubQuery catches up to the finalized chain head.
6. Set `LISTING_RELAYER_START_BLOCK` to the first block that may contain listing events missed during downtime, then restart `listing-relayer`.
7. Verify pending listings activate only after `TOKEN_LISTED` and `LIQUIDITY_LOCKED` events are indexed.

## Rollback

1. Stop `listing-relayer`.
2. Stop `subquery-node` and `subquery-query`.
3. Restore the latest database backup if the `subquery` schema was corrupted or partially migrated.
4. Redeploy the previous SubQuery code and restart `subquery-node` with the prior `LUNES_START_BLOCK`.
5. Keep listing activation disabled until proof verification is healthy again.

## Evidence To Capture

- deploy SHA and SubQuery schema hash
- `LUNES_START_BLOCK` and `LISTING_RELAYER_START_BLOCK`
- database backup identifier
- SubQuery `_metadata` before and after backfill
- sample GraphQL records for each listing event kind
- relayer metrics before and after restart
