# PRD — AppSec Hardening V1

## Problem

Public and user-scoped API surfaces need stricter protection against access-control drift, replay, sensitive response leakage, unsafe uploads, and frontend build exposure.

## Goals

- Block replay of signed read actions.
- Prevent owner listing enumeration without wallet authorization.
- Remove sensitive order/trade internals from client-facing API responses.
- Reject active-content logo uploads and validate uploaded image bytes.
- Enforce production-grade security headers, CORS guardrails, response sanitization, and basic application-shield checks.
- Reduce frontend production exposure by dropping app logs/debugger calls and disabling production sourcemaps.

## Non-Goals

- Replacing signed query authentication with header/body-based signatures.
- Adding an external managed WAF rule set.
- Refactoring every route contract in the API.

## Success Criteria

- Focused security tests pass.
- Backend and frontend builds pass.
- Production build does not emit sourcemap files.
- Public/client API reads do not return nonce/signature/order settlement internals.
