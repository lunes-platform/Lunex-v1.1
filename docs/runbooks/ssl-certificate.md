# Runbook: SSL Certificate

## Alerts

- `SSLCertificateExpiringSoon`
- `SSLCertificateCritical`

## Impact

Users may be unable to access the DEX/API securely, and wallets or browsers may block requests.

## Triage

1. Confirm certificate expiry from blackbox exporter and an external TLS check.
2. Check certbot logs and nginx reload status.
3. Confirm DNS points to the expected host.

## Mitigation

1. Run a certbot dry-run.
2. Renew certificate and reload nginx.
3. If renewal fails, fix DNS/challenge/firewall issues before expiry.
4. For critical expiry, prepare maintenance communication.

## Evidence To Capture

- certificate serial and expiry before/after
- certbot command output
- nginx reload result

