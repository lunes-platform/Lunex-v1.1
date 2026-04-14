# Asymmetric Liquidity V1 TASKS

**Owner:** Core Protocol / Trading  
**SPEC:** [`./SPEC.md`](./SPEC.md)  
**Status:** in-progress

## Definition of Done

- Fluxo de criação, update e consulta da estratégia funciona com contrato público consistente.
- Rotas e permissões ficam alinhadas com wallet signature e `MANAGE_ASYMMETRIC`.
- Eventos assimétricos podem acionar rebalance com logs consistentes.
- Quote `ASYMMETRIC` não depende de shape inválido no banco.
- Testes mínimos e docs principais atualizados.

## Baseline Already in Place

- [x] Contrato `AsymmetricPair` implementado e ABI disponível no frontend.
- [x] Página `/pool/asymmetric` com templates, builder e deploy modal.
- [x] Serviço frontend para instantiate/deploy/update do contrato.
- [x] Modelos Prisma para estratégia e logs de rebalance.
- [x] Rotas backend básicas para CRUD e endpoints de agente.
- [x] `AsymmetricClient` disponível para consumo typed.

## Phase 1 — Align Public Contract

- [x] Padronizar o payload canônico entre `useAsymmetricDeploy`, `AsymmetricClient` e `POST /api/v1/asymmetric/strategies`.
- [x] Revisar a resposta de status para separar claramente configuração persistida e estado vivo da curva.
- [x] Decidir se o banco deve armazenar mais campos da curva ou se o backend deve enriquecer o status via query on-chain.

## Phase 2 — Close Security Gaps

- [x] Proteger mutações de usuário com `verifyWalletActionSignature`.
- [x] Proteger endpoints de agente com `agentAuth(['MANAGE_ASYMMETRIC'])`.
- [x] Fazer endpoints de agente derivarem identidade principal de `req.agent`, não de `agentId`/`userAddress` enviados no body.
- [x] Garantir que updates de curva nunca dependam apenas de `address` enviado no body.
- [x] Endurecer validação de contrato oficial (`ASYMMETRIC_PAIR_CODE_HASH`) sem bypass silencioso em produção.
- [x] Mapear erros de domínio assimétrico para respostas `4xx` coerentes (evitar `500` para conflito/autorização).
- [x] Revisar logs de auditoria para ações manuais, automáticas e por agente.

## Phase 3 — Finish Event and Rebalance Pipeline

- [x] Registrar `asymmetric_pair` como contrato conhecido no `socialIndexerService`.
- [x] Decodificar `AsymmetricSwapExecuted` e mapear dados mínimos para o Sentinel.
- [x] Chamar `rebalancerService.handleCurveExecution(...)` a partir do pipeline de indexação.
- [x] Corrigir escala decimal/planck no `rebalancerService`.
- [x] Remover writes “`as any`” em logs quando possível e alinhar com o schema real.
- [x] Remover fallback de strategy por `pairAddress` sem vínculo de `userAddress` no rebalance automático.

## Phase 4 — Make Routing and UI Consistent

- [x] Corrigir a integração do `routerService` com o shape real de `AsymmetricStrategy`.
- [x] Garantir que a rota `ASYMMETRIC` só apareça quando houver capacidade real calculável.
- [x] Expor status e logs da estratégia na UI de forma consistente com o backend.
- [x] Fechar o fluxo de delegação para aplicar `set_manager` + guardrails no contrato.
- [x] Validar o fluxo de delegação com guardrails e escopo `MANAGE_ASYMMETRIC`.

## Phase 5 — Validation

- [x] Enforçar gate de qualidade no CI (`ESLint` + `ts-prune` + `depcheck` + `Prettier`) nos módulos impactados.
- [x] Adicionar testes unitários para `asymmetricService`, `rebalancerService` e math/normalização.
- [x] Adicionar testes de integração para rotas de estratégia e endpoints de agente.
- [ ] Validar deploy + registro + update em ambiente local/testnet.
- [x] Registrar gaps restantes ou follow-ups em docs/reports se algo ficar fora do ciclo.

### Validation Notes (2026-04-14)

- Sandbox operational check (DB + chain) executado com sucesso para `registro`, `toggle`, `update`, `link` e auditoria.
- Fluxo de update on-chain por relayer bloqueado de forma esperada enquanto `manager` do contrato alvo estiver `null` (`set_manager` ainda não aplicado no contrato sandbox).
- Query de `owner` no contrato sandbox configurado retornou `None` durante a validação, impedindo execução de `set_manager` no ciclo atual sem novo endereço/owner válido.
- A validação de deploy wallet-driven ponta a ponta segue pendente de execução manual via UI.

## Risks / Blockers

- A validação final de deploy + registro + update em ambiente local/testnet ainda precisa de execução operacional manual.
- O estado vivo continua vindo de consulta on-chain em tempo de leitura; indisponibilidade de nó degrada para `liveState.available=false`.
