# Runbook: Emergency Pause

## Alerts

- Manual security incident
- Settlement, bridge, staking, copy-vault, or contract exploit suspicion

## Impact

Emergency pause can protect funds but may stop trading, withdrawals, copytrade execution, rewards, or staking actions.

## Triage

1. Identify affected contract and function class.
2. Confirm whether exploit is theoretical, attempted, or finalized.
3. Check current pause status from API/admin and direct chain read.
4. Decide whether partial pause is enough or global launch freeze is required.

## Mitigation

1. Require two-person approval for public mainnet pause/unpause.
2. Broadcast pause transaction and wait for finalization.
3. Verify paused state through chain read and API/admin status.
4. Announce user impact if production users are affected.
5. Do not unpause until root cause and remediation are reviewed.

## Evidence To Capture

- approval record
- transaction hashes
- before/after pause status
- affected users/orders/contracts

