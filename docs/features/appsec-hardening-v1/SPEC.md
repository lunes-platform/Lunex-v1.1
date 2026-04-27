# SPEC — AppSec Hardening V1

## Behavior

- Signed read requests consume a Redis nonce after successful validation and reject reused nonces.
- `GET /api/v1/listing/owner/:address` requires a signed wallet read for the requested owner address.
- Client order reads omit `signature`, `nonce`, and `orderHash`.
- Public/user trade reads omit settlement payloads, settlement errors, retry metadata, and internal order IDs.
- Logo upload accepts only PNG/WebP, validates magic bytes, randomizes filenames, and cleans up failed uploads.
- Production error responses remove internal `details`, `stack`, and `trace` fields.
- Production CORS rejects wildcard origins at startup.
- Production build disables sourcemaps and drops application `console`/`debugger`.

## Files

- `spot-api/src/middleware/auth.ts`
- `spot-api/src/middleware/responseSanitizer.ts`
- `spot-api/src/middleware/securityShield.ts`
- `spot-api/src/index.ts`
- `spot-api/src/routes/listing.ts`
- `spot-api/src/services/orderService.ts`
- `spot-api/src/services/tradeService.ts`
- `lunes-dex-main/vite.config.ts`

## Boundary

- Backend owns authorization, replay protection, upload validation, response sanitization, and business rules.
- Frontend owns only display/runtime behavior and build hardening. It must not be trusted for access control or financial decisions.

## OWASP Coverage

- A01 Broken Access Control: signed owner reads, sanitized user-scoped reads.
- A02 Cryptographic Failures: nonce replay prevention and secret-response minimization.
- A03 Injection: upload active-content reduction and shield path checks.
- A05 Security Misconfiguration: CORS, Helmet, CSP/HSTS, sourcemaps.
- A09 Security Logging and Monitoring Failures: security events for rejected signatures/shield blocks.
