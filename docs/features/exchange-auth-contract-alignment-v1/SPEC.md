# Exchange Auth Contract Alignment V1 SPEC

**Status:** completed  
**Owner:** Core Protocol / Exchange Platform  
**PRD:** [`./PRD.md`](./PRD.md)  
**Related docs:** [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Summary

Esta feature formaliza o contrato de autenticação transversal da exchange e alinha a validação automatizada ao backend já endurecido.

O objetivo não é mudar regras de negócio de trading. O objetivo é impedir que testes legados tratem rotas privadas como públicas e rotas operacionais como abertas.

## Current Implementation Snapshot

### Contrato real já existente

- `orders` exige signed read em `GET /api/v1/orders`.
- `trades` exige signed read em `GET /api/v1/trades` quando a leitura é por carteira.
- `margin` exige signed read em `GET /api/v1/margin` e bearer admin em `price-health`.
- `social` exige signed read em `GET /api/v1/social/following`.
- `copytrade` exige signed read em `GET /positions` e `GET /activity`.
- `affiliate` exige signed read para endpoints user-scoped e bearer admin para payout/process.

### Gaps observados

1. As suítes E2E ainda assumem reads públicas nos módulos acima.
2. Rotas admin continuam corretas no código, mas os testes não enviam `Authorization: Bearer`.
3. O timer de limpeza de cancelamentos em `orders` mantém handle aberto durante Jest.
4. A SPEC principal ainda descreve autenticação de forma genérica demais para esse contrato transversal.

### Atualização aplicada (2026-04-14)

- SDK foi alinhado com o contrato de signed reads em `orders`, `trades`, `copytrade`, `agents.by-wallet` e rotas assimétricas.
- Assinatura de ordem spot no SDK passou a incluir `timestamp` no payload `lunex-order:*`, compatível com validação anti-replay do backend.
- Endpoints SDK de agente foram normalizados para prefixo canônico `/api/v1/...`.

## Scope

- Registrar a feature em SDD.
- Atualizar a SPEC principal com o padrão de reads assinadas e admin-only.
- Alinhar helpers e suítes E2E de `orders`, `trades`, `margin`, `social`, `copytrade` e `affiliate`.
- Melhorar a higiene operacional do timer em `orders`.

## Out of Scope

- Redesenho do modelo de sessão do usuário.
- Relaxamento de auth para compatibilidade retroativa.
- Refactor amplo de todos os testes da exchange fora dos módulos listados.

## Impacted Modules

| Módulo | Arquivos principais | Papel |
|---|---|---|
| Orders | [`spot-api/src/routes/orders.ts`](../../../spot-api/src/routes/orders.ts), [`spot-api/src/__tests__/e2e/orders.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/orders.e2e.test.ts) | Order creation, cancel e leitura privada |
| Trades | [`spot-api/src/routes/trades.ts`](../../../spot-api/src/routes/trades.ts), [`spot-api/src/__tests__/e2e/trades.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/trades.e2e.test.ts) | Histórico privado e endpoints operacionais |
| Margin | [`spot-api/src/routes/margin.ts`](../../../spot-api/src/routes/margin.ts), [`spot-api/src/__tests__/e2e/margin.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/margin.e2e.test.ts) | Overview assinado e health admin |
| Social | [`spot-api/src/routes/social.ts`](../../../spot-api/src/routes/social.ts), [`spot-api/src/__tests__/e2e/social.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/social.e2e.test.ts) | Following privado |
| Copytrade | [`spot-api/src/routes/copytrade.ts`](../../../spot-api/src/routes/copytrade.ts), [`spot-api/src/__tests__/e2e/copytrade.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/copytrade.e2e.test.ts) | Posições e activity privadas |
| Affiliate | [`spot-api/src/routes/affiliate.ts`](../../../spot-api/src/routes/affiliate.ts), [`spot-api/src/__tests__/e2e/affiliate.e2e.test.ts`](../../../spot-api/src/__tests__/e2e/affiliate.e2e.test.ts) | Reads privadas e payout admin |
| Test helpers | `spot-api/src/__tests__/e2e/*` | Contratos reutilizáveis para signed read/admin auth |

## Design

### 1. Signed Read Contract

As leituras user-scoped passam a seguir o mesmo padrão mínimo:

- `address` ou identificador equivalente;
- `nonce`;
- `timestamp`;
- `signature`.

Actions usadas atualmente:

- `orders.list`
- `trades.list`
- `margin.overview`
- `social.following`
- `copytrade.positions`
- `copytrade.activity`
- `affiliate.code`
- `affiliate.dashboard`
- `affiliate.tree`
- `affiliate.payouts`

O backend continua sendo a fonte de verdade do payload assinado.

### 2. Admin Contract

Endpoints operacionais continuam privados por bearer admin:

- `GET /api/v1/trades/settlement/status`
- `POST /api/v1/trades/settlement/retry`
- `GET /api/v1/margin/price-health`
- `POST /api/v1/margin/price-health/reset`
- `POST /api/v1/affiliate/payout/process`

Nos testes, isso deve ser exercitado explicitamente via header, não por bypass implícito.

### 3. Test Strategy

Os testes E2E devem:

- mockar `verifyWalletReadSignature` e `verifyWalletActionSignature` quando a criptografia não é o foco do caso;
- enviar query/body com shape real de signed read/action;
- enviar bearer admin nas rotas operacionais;
- preservar asserts de validação e shape de resposta do módulo.

Não é aceitável “corrigir” os testes removendo auth das rotas.

### 4. Operational Hygiene

O cleanup interval de `orders` deve parar de prender o event loop do Jest. A solução desejada é manter o cleanup em runtime normal, mas permitir que o processo de teste finalize sem handle pendente.

## Interfaces and Contracts

### Signed read query shape

```json
{
  "address": "wallet-123",
  "nonce": "nonce-12345678",
  "timestamp": 1760000000000,
  "signature": "signed-payload"
}
```

### Admin header shape

```http
Authorization: Bearer <ADMIN_SECRET>
```

## Security and Failure Modes

- Falta de signed read continua retornando `400` por falha de validação.
- Signed read inválida continua retornando `401`.
- Bearer admin ausente ou inválido continua retornando `401`.
- O alinhamento desta feature não pode reabrir IDORs nem reads públicas por endereço.

## Rollout and Migration

- Sem migration de banco.
- Sem mudança de contrato público além de documentação e testes.
- Mudança compatível com o backend atual.

## Test Plan

- Atualizar `orders.e2e.test.ts`.
- Atualizar `trades.e2e.test.ts`.
- Atualizar `margin.e2e.test.ts`.
- Atualizar `social.e2e.test.ts`.
- Atualizar `copytrade.e2e.test.ts`.
- Atualizar `affiliate.e2e.test.ts`.
- Rodar as suítes afetadas.
- Rodar `npm test` do `spot-api`.
- Rodar `npm run build` do `spot-api`.

## Acceptance Criteria

- As seis suítes E2E afetadas passam com o contrato atual.
- A SPEC principal registra explicitamente signed reads e admin routes.
- O timer em `orders` não deixa mais handle aberto em Jest.
- O hardening atual da exchange é mantido intacto.
