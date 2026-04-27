# SPEC — Production Readiness V1

## Objetivo

Definir o conjunto mínimo de correções, testes e gates para o Lunex sair de testnet/local e chegar a uma liberação comercial auditável. A especificação cobre backend, contratos, frontend/Web3, SRE/deploy, admin, compliance e documentação.

## Tech Stack

- Backend: Node.js, TypeScript, Express, Prisma, PostgreSQL, Redis.
- Frontend: React, Vite, TypeScript, Polkadot.js.
- Contratos: Rust, ink!, cargo-contract.
- Chain local/testnet: Lunes/Substrate com `pallet_contracts` e `pallet_assets`.
- Testes: Jest/Supertest no backend, cargo test nos contratos, scripts TypeScript de QA.

## Comandos

- Backend unit/integration: `cd spot-api && npm test -- --runInBand`
- Backend E2E: `cd spot-api && npm run test:e2e -- --runInBand`
- Backend build: `cd spot-api && npm run build`
- Backend lint: `cd spot-api && npm run lint`
- Spot/orderbook focused: `cd spot-api && npm test -- --runInBand --testPathPattern='orderbook|orders|orderService|tradeService|tradeSettlementService|routerService'`
- Contratos workspace: `cargo test --workspace --exclude fuzz`
- Pair contract: `cargo test --manifest-path Lunex/contracts/pair/Cargo.toml`
- QA contratos: `cd spot-api && npx ts-node scripts/check-contracts-qa.ts`
- Simulação de liquidez: `cd spot-api && npx ts-node scripts/test-liquidity-pool.ts`
- Frontend build: `cd lunes-dex-main && npm run build`
- Frontend quality: `cd lunes-dex-main && npm run quality`

## Estrutura

- `docs/features/production-readiness-v1/` guarda PRD, SPEC e TASKS desta iniciativa.
- `spot-api/src/middleware/` guarda autenticação, nonce e autorização.
- `spot-api/src/routes/` guarda fronteiras HTTP e validações de entrada.
- `spot-api/src/services/` guarda regra de negócio off-chain.
- `spot-api/src/__tests__/` guarda regressões unitárias e E2E.
- `Lunex/contracts/` guarda invariantes on-chain.
- `lunes-dex-main/` guarda UX e integração Web3, sem regra financeira final.
- `docker-compose*.yml`, `Dockerfile*`, `.env.example` e scripts guardam operação/deploy.

## Regras de Negócio por Camada

- Contratos: custody, reservas, settlement final, locks, staking/rewards e invariantes que protegem fundos.
- `spot-api`: autenticação, autorização, validação de payload, rate limit, matching off-chain, orquestração de settlement, persistência, trilha de auditoria e integração chain.
- Frontend/sdk: construção de payloads, assinatura do usuário e exibição de estado. Não aprovam permissão, preço final, settlement ou saldo.
- Admin: operação e revisão. Não deve gravar estado financeiro crítico ignorando serviços do backend.

## Inventário de Achados

### Backend/API

- P0: assinatura de ordem inclui `timestamp` na API, mas revalidação de settlement pode reconstruir mensagem sem `timestamp`.
- P0: settlement pode iniciar desabilitado quando `SPOT_CONTRACT_ADDRESS` está ausente; trades ficam `SKIPPED`.
- P0: slippage/`amountOutMin` de rota é avaliado tarde demais, após execução/persistência de market order.
- P0: order book em memória não é seguro para múltiplas instâncias.
- P0: book pode mutar antes de garantia durável de banco/settlement.
- P0: cancelamento pode divergir book, banco e chain.
- P1: `TimeInForce` é aceito no schema, mas não possui semântica completa.
- P1: margin está majoritariamente DB-only.
- P1: CopyVault depende de journal DB em produção.
- P1: WebSocket não cobre resync incremental robusto.
- P1: `/health` não reflete Redis, PostgreSQL, blockchain RPC, settlement e filas.

### Contratos/Substrate

- P0: ink! `Result::Err` não faz rollback automático; contratos não podem assumir semântica EVM.
- P0: SpotSettlement não verifica assinatura on-chain do usuário.
- P0: fills parciais não são rastreados on-chain de forma suficiente contra relayer incorreto.
- P0: limites de preço/quantidade no settlement ainda são incompletos.
- P1: CopyVault, AsymmetricPair, LiquidityLock e Listing dependem de peças off-chain sem prova final.
- P1: Rewards possui risco de guarda de reentrância ficar travada em caminho de erro.
- P1: scripts de deploy/QA ainda validam presença de código mais do que comportamento real.

### AppSec/Compliance

- P0: admin pode bypassar validação financeira/on-chain por escrita direta Prisma.
- P0: wallet ban precisa ser aplicado em todas as ações financeiras do `spot-api`.
- P0: API key autenticada não pode criar nova chave com permissões fora do próprio escopo.
- P0: nonce Redis deve ser atomicamente consumido e falhar fechado em produção.
- P1: `ADMIN_SECRET` estático precisa rotação, escopo e auditoria forte.
- P1: bootstrap admin com senha padrão/logs precisa ser removido do fluxo real.
- P1: upload deve validar tipo antes de gravar e manter trilha.
- P1: KYC/AML, sanções e retenção de logs precisam de integração definida.

### SRE/Deploy

- P0: build Docker frontend tem risco de contexto/lockfile inconsistente.
- P0: compose testnet/prod precisa declarar `ADMIN_SECRET` e segredos obrigatórios.
- P0: frontend prod/testnet não pode cair em `localhost`.
- P0: health checks precisam usar portas reais e dependências críticas.
- P1: `ALLOWED_WS_ORIGINS` deve ser obrigatório em ambientes públicos.
- P1: backup S3, Redis persistence, Postgres durability e restore drill precisam ser testados.
- P1: observabilidade/runbooks ainda estão incompletos.
- P1: CI deve bloquear typecheck, testes, Trivy/audit e quality gates aplicáveis.

### Frontend/Web3

- P0: frontend e ABIs/artifacts divergem em métodos como `getAmountOut` e PSP22 de Pair.
- P0: assinaturas de leitura não podem ser cacheadas quando backend consome nonce.
- P0: token nativo `LUNES` não pode aparecer como swap real sem rota nativa implementada.
- P1: `npm run quality` do frontend tem falhas Prettier conhecidas.
- P1: cancelamento precisa nonce/timestamp, não apenas assinatura estática do orderId.
- P1: fallback de preço fixo deve ser removido de fluxos financeiros.
- P1: margin actions precisam confirmação e limites claros de risco.
- P1: cálculos financeiros do frontend devem evitar `Number` para valores tokenizados.

## Decisões

1. Mudanças P0 pequenas e verificáveis podem ser executadas nesta iniciativa com TDD.
2. Mudanças que exigem migração, redesenho de settlement ou alteração on-chain ficam como tarefas P0 abertas até revisão dedicada.
3. Produção comercial permanece bloqueada enquanto qualquer P0 estiver aberto.
4. Testnet/local pode continuar desde que a documentação deixe claro que não é aprovação comercial.
5. Matching spot em uma única instância deve ser compensável: antes de mutar o book, o serviço cria checkpoint em memória; se a persistência de matches falhar, restaura o checkpoint e propaga erro.
6. Persistência de matches deve ocorrer em uma única transação de banco por lote de matches. Falha no processamento imediato de settlement não desfaz trade persistido com payload retryable; a fila de retry assume a recuperação.
7. Revalidação de `amountOutMin` no router deve acontecer novamente contra o book atual antes de chamar `orderService.createOrder` para evitar execução stale óbvia.
8. Produção multi-instância do matching deve usar Redis como lock distribuído por par, com renovação periódica de TTL durante a seção crítica. O processo que obtém o lock reidrata o book do par a partir do banco antes de aplicar qualquer mutação, fazendo do banco a visão canônica entre réplicas.
9. Cancelamento spot deve ser fail-closed contra a chain: o serviço só pode remover do book e marcar DB como `CANCELLED` depois de `cancel_order_for` concluir; se a chamada on-chain falhar ou estiver indisponível em settlement habilitado, a ordem permanece sem mutação local.
10. O router só pode executar fontes com executor implementado. `AMM_V1` pode aparecer como quote, mas não deve criar market order no book como substituto; sem executor AMM real, a rota falha antes de persistir ordem.

## Testing Strategy

- Toda alteração de autenticação/autorização deve ter teste unitário ou E2E que falha antes da correção.
- Toda alteração de order book/spot deve rodar testes focados de `orders`, `orderbook`, `orderService`, `tradeService`, `tradeSettlementService` e `routerService`.
- Toda alteração de contrato deve rodar cargo test do contrato impactado e, quando possível, E2E de ink!.
- Toda alteração de deploy deve ter build/compose validation ou checklist operacional reproduzível.

## Boundaries

- Always: atualizar `TASKS.md` quando um item muda de status; rodar teste focado; registrar gaps.
- Ask first: migrations de banco, mudança de ABI, alteração de CI/CD remoto, deploy em ambiente público.
- Never: lançar mainnet com P0 aberto, versionar segredo, remover teste falho sem correção, mover regra financeira para frontend.

## Success Criteria

- P0 documentados e rastreados.
- P0 corrigidos nesta rodada possuem teste de regressão.
- Pipeline local relevante passa.
- Riscos remanescentes estão explícitos e classificados.

## Open Questions

- Qual provedor KYC/AML e sanções será usado?
- Qual topologia de produção será adotada para o matching engine: single leader, fila central, Redis streams, Postgres lock ou serviço dedicado?
- Qual é o modelo final de settlement on-chain para fills parciais e assinatura do usuário?
- Qual política de limite financeiro define beta fechado versus produção comercial?
