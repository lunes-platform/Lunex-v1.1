# Exchange Auth Contract Alignment V1 PRD

**Status:** completed  
**Owner:** Core Protocol / Exchange Platform  
**Date:** 2026-04-13  
**Related docs:** [`../../prd/PROJECT_PRD.md`](../../prd/PROJECT_PRD.md), [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md)

## Context

As rotas da exchange passaram por um endurecimento importante de segurança:

- leituras user-scoped deixaram de ser públicas e passaram a exigir assinatura de wallet;
- endpoints operacionais passaram a exigir bearer admin;
- proteções contra replay, TTL e spoofing foram incorporadas ao backend.

Esse endurecimento está correto no código, mas a camada de validação ainda ficou parcialmente presa ao contrato antigo. Hoje isso aparece principalmente em suítes E2E que ainda assumem reads públicas para `orders`, `trades`, `margin`, `social`, `copytrade` e `affiliate`.

## Problem

Sem alinhar specs e testes ao contrato atual:

- a saúde da exchange parece pior do que realmente está;
- existe risco de regressão por alguém “consertar” testes afrouxando rotas protegidas;
- integradores e times internos perdem uma fonte de verdade clara sobre quem autentica o quê.

## Users / Stakeholders

- **Backend / exchange:** precisa de testes coerentes com o contrato real.
- **AppSec / QA:** precisa garantir que hardening não seja revertido por acidente.
- **Frontend / SDK / MCP:** precisa integrar reads privadas e endpoints operacionais com as credenciais certas.
- **Operação:** precisa de endpoints admin estáveis e explicitamente privados.

## Goals

- Registrar o contrato transversal de auth/read da exchange em um pacote SDD dedicado.
- Alinhar as suítes E2E de `orders`, `trades`, `margin`, `social`, `copytrade` e `affiliate`.
- Manter o hardening atual, sem reabrir superfícies públicas.
- Reduzir ruídos de execução dos testes, incluindo o timer aberto em `orders`.

## Non-Goals

- Não redesenhar o modelo de autenticação do produto.
- Não relaxar reads privadas para recuperar compatibilidade legada.
- Não reescrever toda a documentação histórica da exchange nesta fase.
- Não introduzir nova camada de sessão além do contrato já existente.

## User Outcomes

- As specs deixam claro quando a leitura exige assinatura de wallet.
- Endpoints operacionais ficam explicitamente modelados como admin-only.
- As suítes passam a validar o contrato endurecido, em vez do comportamento legado.
- O status dos módulos da exchange volta a refletir funcionamento real, não drift de teste.

## Functional Requirements

- **FR1:** Leituras user-scoped de `orders`, `trades`, `margin`, `social`, `copytrade` e `affiliate` devem ser documentadas e testadas como signed reads.
- **FR2:** Endpoints operacionais de `margin`, `trades` e `affiliate` devem ser documentados e testados como admin-only.
- **FR3:** Testes E2E devem usar helpers explícitos para signed reads e auth admin.
- **FR4:** Nenhuma correção pode afrouxar autenticação já endurecida no backend.
- **FR5:** O pacote SDD deve listar módulos impactados, critérios de aceite e follow-ups.

## Success Metrics

- As suítes E2E afetadas deixam de falhar por contrato antigo.
- O contrato de segurança fica rastreável em `PRD.md`, `SPEC.md` e `TASKS.md`.
- O backend continua compilando e os módulos endurecidos permanecem privados.
- O status por módulo da exchange pode ser reportado com confiança.

## Risks and Open Questions

- Parte da documentação legada ainda pode mencionar reads públicas.
- Alguns consumidores internos podem depender implicitamente do contrato antigo.
- Uma futura fase pode substituir reads assinadas por sessão assinada curta para melhorar UX, mas isso fica fora deste ciclo.

## Acceptance Signals

- Existe um pacote SDD dedicado para o alinhamento de auth/read da exchange.
- As suítes de `orders`, `trades`, `margin`, `social`, `copytrade` e `affiliate` refletem o contrato atual.
- O hardening de reads privadas e admin routes não é revertido.
- O status de validação da exchange melhora sem comprometer segurança.
