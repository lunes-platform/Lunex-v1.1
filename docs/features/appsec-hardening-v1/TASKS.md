# TASKS — AppSec Hardening V1

## 1. Replay Protection for Signed Reads

- Files: `spot-api/src/middleware/auth.ts`, `spot-api/src/__tests__/redisNonce.test.ts`
- Acceptance: reused signed-read nonce returns `Signature nonce already used`.
- Verify: `npx jest src/__tests__/redisNonce.test.ts --runInBand`
- Boundary: backend authentication middleware only.
- Risk: blocks replay but does not remove query-string signature leakage.

## 2. Client Response Sanitization

- Files: `spot-api/src/services/orderService.ts`, `spot-api/src/services/tradeService.ts`, related tests.
- Acceptance: user/public reads omit signatures, nonces, order hashes, settlement payloads, settlement errors, retry metadata, and internal order IDs.
- Verify: `npx jest src/__tests__/orderService.test.ts src/__tests__/tradeService.test.ts --runInBand`
- Boundary: service response layer only.
- Risk: admin settlement views remain intentionally privileged.

## 3. Listing Route and Upload Hardening

- Files: `spot-api/src/routes/listing.ts`
- Acceptance: owner listing reads require signed wallet read; SVG uploads are rejected; PNG/WebP bytes are validated; failed uploads are removed.
- Verify: `npm run build`
- Boundary: listing route only.
- Risk: client must send signed read params for owner listing views.

## 4. Server Shield, Headers, CORS, Error Sanitization

- Files: `spot-api/src/index.ts`, `spot-api/src/middleware/securityShield.ts`, `spot-api/src/middleware/responseSanitizer.ts`, `spot-api/src/__tests__/responseSanitizer.test.ts`
- Acceptance: production wildcard CORS fails startup; Helmet has explicit HSTS/CSP/frame/no-sniff/referrer policy; shield blocks suspicious request paths; production errors omit internal details.
- Verify: `npx jest src/__tests__/responseSanitizer.test.ts --runInBand`, `npm run build`
- Boundary: Express middleware only.
- Risk: managed WAF still recommended at edge.

## 5. Frontend Build Exposure

- Files: `lunes-dex-main/vite.config.ts`
- Acceptance: production build drops app `console`/`debugger` and emits no `.map` files.
- Verify: `npm run build`, `find lunes-dex-main/build/assets -name '*.map' -print`
- Boundary: build configuration only; frontend still cannot enforce business rules.
- Risk: vendor bundles may contain non-sensitive internal warning strings.
