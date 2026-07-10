# Auditoria de Segurança Cross-Layer — Lunex DEX (2026-06-12)

> Especialista 2 de 5 — Segurança transversal (auth, relayer, segredos, fail-closed, superfície externa)
> Nota: relatório resumido persistido pelo orquestrador; o agente auditor teve a escrita direta bloqueada por hook.

## Veredito: **APROVADO COM RESSALVAS** (mainnet)

O núcleo custody-grade está sólido e verificado: todos os fund paths de produção gateiam em `isFinalized`, não há `//Alice` alcançável em codepath de produção do spot-api, nonce dual-layer é fail-closed em prod, e os boot guards abortam o startup com segredo dev/placeholder/CORS wildcard. Ressalvas são hardening; nenhuma bloqueante isolada, mas o CVE HIGH de dependência e a ausência de anti-brute-force no login admin devem cair antes do anúncio.

## Contagem por severidade

| P0 | P1 | P2 | P3 |
|----|----|----|----|
| 0  | 0  | 3  | 5  |

## Achados

### P2
1. `spot-api` com CVE HIGH ReDoS (`path-to-regexp <0.1.13` via Express 4.21) + moderados (`ws` 8.16 mem-disclosure, `qs`, `body-parser`) — **fix:** `npm update express ws`.
2. Login admin NextAuth sem rate-limit/lockout/MFA (`lunex-admin/src/auth.ts:13-31`); zona nginx `api_auth` não cobre o domínio admin.
3. `lunex-admin/middleware.ts:4-22` só checa `isLoggedIn`, nunca `role` — sem RBAC na borda para treasury/emergency/payouts.

### P3
4. Scripts de deploy com fallback `RELAYER_SEED || '//Alice'` (`deploy-remaining-contracts.ts:37`, `deploy-asset-wrappers.ts:128`, `deploy-listing-contracts.ts:219`) — trocar por erro fatal.
5. CSP com `unsafe-inline`+`unsafe-eval` (`nginx.prod.conf:128`); `responseSanitizer` raso (`responseSanitizer.ts:6` só faz strip em erros >=400, sem deny-list de chaves sensíveis em 2xx).
6-8. (Demais P3 de hardening registrados na sessão de auditoria.)

## Melhorias aprovadas para implementação imediata
- `npm update express ws` no spot-api (CVE HIGH).
- Rate-limit/lockout no login do lunex-admin (nginx zone ou middleware).
- Checagem de `role` no `lunex-admin/middleware.ts`.
- Remover fallback `|| '//Alice'` dos scripts de deploy (erro fatal quando `RELAYER_SEED` ausente).
