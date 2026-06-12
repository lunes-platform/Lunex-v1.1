# Runbook: Blockchain RPC Down

## Alerts

- `BlockchainNodeUnreachable`

## Impact

Settlement, bridge, rewards, staking, margin, and contract reads can halt. Do not mark fund-moving transactions as successful without finalized chain status.

## Triage

1. Confirm `lunex_blockchain_connected == 0`.
2. Check the configured `LUNES_WS_URL` and whether it is production-safe.
3. Test RPC externally with a read-only system health request.
4. Compare against Lunes network status and other RPC endpoints approved for production.
5. Check settlement backlog and fund-moving service logs.

## Mitigation

1. Switch to a pre-approved production RPC endpoint if the primary endpoint is down.
2. Keep settlement queues paused if finality cannot be observed.
3. Do not use localhost, dev, or testnet RPC in production.
4. After recovery, reconcile pending settlements against finalized chain events.

## Evidence To Capture

- failing and recovered RPC endpoint
- backlog size before and after recovery
- reconciled transaction hashes
- any orders requiring manual review

