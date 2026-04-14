# Exchange Auth Contract Alignment V1 TASKS

**Owner:** Core Protocol / Exchange Platform  
**SPEC:** [`./SPEC.md`](./SPEC.md)  
**Status:** completed

## Definition of Done

- O contrato de auth/read da exchange está mapeado em SDD.
- As suítes E2E deixam de assumir reads públicas onde hoje existe signed read.
- Endpoints admin são testados com bearer explícito.
- O backend continua protegido e com validação verde nos módulos afetados.

## Phase 1 — SDD Baseline

- [x] Criar `PRD.md` da feature.
- [x] Criar `SPEC.md` da feature.
- [x] Criar `TASKS.md` da feature.
- [x] Atualizar a `PROJECT_SPEC.md` com o contrato transversal de signed reads/admin routes.
- [x] Registrar a feature no mapa canônico de docs.

## Phase 2 — Test Contract Alignment

- [x] Adicionar helper reutilizável para signed read/admin auth nos testes E2E.
- [x] Alinhar `orders.e2e.test.ts` ao contrato de `orders.list`.
- [x] Alinhar `trades.e2e.test.ts` ao contrato de `trades.list` e admin settlement.
- [x] Alinhar `margin.e2e.test.ts` ao contrato de `margin.overview` e admin health.
- [x] Alinhar `social.e2e.test.ts` ao contrato de `social.following`.
- [x] Alinhar `copytrade.e2e.test.ts` ao contrato de reads privadas.
- [x] Alinhar `affiliate.e2e.test.ts` ao contrato de reads privadas e payout admin.
- [x] Garantir que `orders.ts` não deixe open handle no Jest.

## Phase 3 — Validation

- [x] Rodar as seis suítes afetadas.
- [x] Rodar a suíte completa do `spot-api`.
- [x] Rodar `npm run build` do `spot-api`.
- [x] Consolidar o status por módulo da exchange após o alinhamento.

## Risks / Follow-ups

- Documentação legada ainda pode citar contratos antigos fora da estrutura SDD.
- Uma fase futura pode trocar signed reads por sessão assinada curta, mas isso não faz parte deste ciclo.
