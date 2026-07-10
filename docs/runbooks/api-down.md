# Runbook: API Down Or Degraded

## Alerts

- `APIDown`
- `APIHighErrorRate`
- `APIHighLatency`
- `APIRateLimitHigh`

## Impact

Trading, signed reads, copytrade, rewards, listings, governance reads, and MCP/SDK clients may fail or return stale data.

## Triage

1. Confirm the alert in Prometheus/Grafana and record timestamp, service, release SHA, and affected routes.
2. Check API health: `curl -fsS "$SPOT_API_URL/health"`.
3. Check recent deployment, PM2/container status, and API logs.
4. Check dependencies: Postgres, Redis, Lunes RPC, SubQuery, and settlement queues.
5. If 5xx is route-specific, isolate by route label and compare with recent commits.

## Mitigation

1. If API is fully down, restart only the API service once and watch logs.
2. If errors continue after one restart, roll back to the previous known-good SHA.
3. If rate limiting is the source, confirm whether traffic is attack traffic before raising limits.
4. If writes may be inconsistent, pause fund-moving workflows and escalate to security/ops.

## Evidence To Capture

- alert screenshot or Prometheus query
- API logs for the first failure window
- dependency health results
- release SHA before and after mitigation
- user-facing impact window

