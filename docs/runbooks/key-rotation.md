# Runbook: Relayer And Admin Key Rotation

## Alerts

- Manual security incident
- Relayer balance/key compromise investigation

## Impact

Relayer/admin key compromise can affect settlement, bridge operations, rewards, emergency controls, and user trust.

## Triage

1. Identify the key, scope, and permissions.
2. Determine whether any unauthorized transactions finalized.
3. Pause affected workflows before rotating if the old key can still act.

## Mitigation

1. Generate a new key through the approved secret-management process.
2. Update Doppler/production secret store; never commit seeds.
3. Deploy/restart only affected services.
4. Transfer required permissions on-chain and revoke old permissions.
5. Reconcile all transactions from the suspected compromise window.

## Evidence To Capture

- old/new public addresses
- permission transfer transaction hashes
- services restarted
- reconciliation report

