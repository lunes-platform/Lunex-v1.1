# Runbook: Security Alerts

## Alerts

- `SuspiciousOrderVolume`
- `MultipleFailedAuthAttempts`

## Impact

Could indicate abuse, replay attempts, bot activity, credential probing, or a live exploit attempt.

## Triage

1. Preserve logs before blocking traffic.
2. Identify source IPs, wallets, API keys, user agents, routes, and order symbols.
3. Check nonce replay logs and signature rejection reasons.
4. Determine if the traffic moved funds, created orders, or only probed endpoints.

## Mitigation

1. Apply targeted blocks or stricter rate limits.
2. Disable affected agent/API keys if compromised.
3. Pause risky trading or settlement paths if abuse affects fund safety.
4. Escalate critical findings through `SECURITY.md` incident process.

## Evidence To Capture

- raw request samples with secrets redacted
- wallet addresses and order ids involved
- rate-limit/auth metrics
- mitigation rules applied

