# Runbook: Settlement Backlog

## Alerts

- `OrderSettlementBacklog`

## Impact

Trades may be persisted before settlement completes. User balances and contract state must be treated as pending until finalized on-chain.

## Triage

1. Confirm backlog size and duration.
2. Check Lunes RPC connectivity and finality lag.
3. Check settlement worker/API logs for rejected payloads, relayer balance, nonce errors, or contract reverts.
4. Sample pending settlement records and compare with finalized chain transactions.

## Mitigation

1. Stop new risky settlement paths if backlog keeps growing.
2. Keep synthetic `agent:` and `manual:` order paths blocked when settlement is enabled.
3. Top up or rotate relayer only through the approved key-rotation process.
4. Requeue only idempotent settlement jobs with known nonce state.

## Evidence To Capture

- backlog metric and queue samples
- failed transaction hashes or dispatch errors
- reconciliation result
- user impact and pending order count

