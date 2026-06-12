# Runbook: Host Resources

## Alerts

- `HighCPUUsage`
- `HighMemoryUsage`
- `DiskSpaceLow`
- `DiskSpaceCritical`

## Impact

Resource exhaustion can crash API, DB, Redis, SubQuery, Grafana, or backup processes and can corrupt local-only operational evidence.

## Triage

1. Identify the host and container consuming CPU, memory, or disk.
2. Check recent deploys, log growth, backup files, and SubQuery/Postgres storage.
3. For disk critical, stop nonessential log growth before restarting services.

## Mitigation

1. Prune safe temporary files and old local backups only after confirming S3 backup freshness.
2. Rotate or compress logs.
3. Scale resources or split services if pressure recurs.
4. Treat disk critical during DB writes as a data-integrity incident.

## Evidence To Capture

- `df -h`, container stats, top processes
- files removed or rotated
- backup freshness proof
- recurrence prevention task

