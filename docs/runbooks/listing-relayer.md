# Runbook: Listing Relayer

## Alerts

- `ListingRelayerDown`
- `ListingRelayerCursorStale`
- `ListingRelayerBlockFailures`
- `ListingRelayerActivationFailures`
- `ListingRelayerWithdrawFailures`

## Impact

Token listing applications may remain pending even after finalized on-chain events exist. Liquidity-lock withdraws may also remain unfinalized in the API database. Do not manually activate listings unless finalized SubQuery evidence is present and the API proof verifier accepts it.

## Triage

1. Check `listing-relayer` container status and recent logs.
2. Query `http://listing-relayer:9471/metrics` from inside the Docker network.
3. Compare `lunex_listing_relayer_last_finalized_block` with the current chain finalized head.
4. Check `LISTING_RELAYER_STATE_FILE` contents in the `listingrelayerdata` volume.
5. Verify `ADMIN_SECRET`, `SPOT_API_URL`, `LISTING_MANAGER_CONTRACT_ADDRESS`, and `LIQUIDITY_LOCK_CONTRACT_ADDRESS`.
6. Check SubQuery readiness and GraphQL availability before restarting the relayer.

## Mitigation

1. If the container is down, restart only `listing-relayer`.
2. If activation failures are caused by missing indexed events, wait for SubQuery catch-up or repair/reindex SubQuery first.
3. If the cursor is stale but no API failures exist, inspect blockchain WS connectivity and restart the relayer.
4. If the cursor file is corrupt, preserve a copy, then restart with `LISTING_RELAYER_START_BLOCK` set to the last known safe finalized block.
5. After recovery, verify the listing remains `PENDING` until `TOKEN_LISTED` and `LIQUIDITY_LOCKED` proof is accepted.

## Evidence To Capture

- alert name and firing time
- relayer logs around the failed block
- relayer metrics snapshot
- cursor file contents
- relevant finalized block hash and extrinsic hash
- API response body for failed activation or withdraw finalization
