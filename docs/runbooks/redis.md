# Runbook: Redis Down Or Saturated

## Alerts

- `RedisDown`
- `RedisHighMemory`

## Impact

Nonce replay protection, rate limiting, queue coordination, and cache-backed workflows can degrade. In production, nonce store unavailability must reject wallet signatures rather than fail open.

## Triage

1. Confirm Redis health and memory usage.
2. Check API logs for nonce store unavailable or replay detection failures.
3. Confirm `REDIS_URL` is not localhost in production.
4. Check whether memory pressure is caused by queues, nonce keys, or cache keys.

## Mitigation

1. Restart Redis only after checking persistence configuration.
2. If nonce validation is affected, keep signed actions rejected until Redis is healthy.
3. If memory is high, identify large key namespaces before deleting anything.
4. Scale or raise memory only with a post-incident capacity note.

## Evidence To Capture

- Redis info output
- affected key namespaces
- API nonce/auth errors
- mitigation and restart timestamps

