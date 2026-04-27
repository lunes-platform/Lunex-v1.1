# TASKS — Production Readiness V1

## Status Geral

- Status comercial: **NO-GO enquanto houver P0 aberto**.
- Status local/testnet: permitido para QA com aviso explícito de risco.
- Estratégia: fechar P0 por fatias pequenas com TDD, sem misturar redesenho de contratos com hardening de API.

## P0 — Bloqueia Produção Comercial

### 1. Nonce Redis atômico e fail-closed

- Status: Done
- Files: `spot-api/src/middleware/auth.ts`, `spot-api/src/__tests__/redisNonce.test.ts`, `spot-api/src/__tests__/auth/verifyWalletActionSignature.test.ts`
- Acceptance: ações assinadas consomem nonce com `SET NX`; replay simultâneo aceita no máximo uma chamada; erro de Redis em produção retorna indisponibilidade em vez de permitir ação.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='redisNonce|auth-attack-simulation|verifyWalletActionSignature'`
- Boundary: autenticação backend; não altera contrato público de rotas além da mensagem de erro em falha de nonce store.
- Risk: ambientes dev podem usar fallback em memória; produção precisa Redis saudável.

### 2. API key não pode escalar permissões

- Status: Done
- Files: `spot-api/src/routes/agents.ts`, `spot-api/src/__tests__/e2e/auth-attack-simulation.e2e.test.ts`
- Acceptance: uma API key autenticada só cria nova API key com subconjunto das próprias permissões; tentativa de adicionar `TRADE_SPOT`, `TRADE_MARGIN`, `COPYTRADE_SIGNAL` ou `MANAGE_ASYMMETRIC` sem possuir escopo retorna 403.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='redisNonce|auth-attack-simulation|verifyWalletActionSignature'`
- Boundary: rota de agents; bootstrap por wallet continua permitido apenas para primeira chave.
- Risk: futura permissão `MANAGE_API_KEYS` pode substituir a regra de subconjunto, mas exigiria migration.

### 3. Settlement não pode ficar opcional em produção

- Status: Done
- Files: `spot-api/src/utils/productionGuards.ts`, `spot-api/src/index.ts`, `spot-api/src/__tests__/productionGuards.test.ts`
- Acceptance: `NODE_ENV=production` falha startup quando contrato de settlement obrigatório estiver ausente ou inválido; trades não entram silenciosamente em `SKIPPED`.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='productionGuards'`, `cd spot-api && npm run build`
- Boundary: configuração e bootstrap da API.
- Risk: ambientes públicos precisam injetar `RELAYER_SEED`, `SPOT_CONTRACT_ADDRESS` e `SPOT_CONTRACT_METADATA_PATH`.

### 4. Assinatura de ordem e settlement devem usar a mesma mensagem

- Status: Done
- Files: `spot-api/prisma/schema.prisma`, `spot-api/prisma/migrations/20260427134000_add_order_signature_timestamp/migration.sql`, `spot-api/src/services/settlementService.ts`, `spot-api/src/services/orderService.ts`, `spot-api/src/services/tradeService.ts`, `spot-api/src/services/tradeSettlementService.ts`, `spot-api/src/__tests__/settlementSignatureMessage.test.ts`
- Acceptance: settlement revalida exatamente a mensagem assinada pelo usuário, incluindo `timestamp`, ou passa a persistir canonical message/hash imutável.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='settlementSignatureMessage|tradeSettlementService|tradeService|orderService'`
- Boundary: spot order signing e settlement orchestration.
- Risk: ordens antigas sem `signatureTimestamp` e assinatura sr25519 real não devem ser liquidadas sem backfill/canonical payload confiável.

### 5. Slippage antes de persistir execução de market/route

- Status: Done
- Files: `spot-api/src/services/routerService.ts`, `spot-api/src/services/copytradeService.ts`, `spot-api/src/__tests__/routerService.test.ts`
- Acceptance: market route rejeita antes de mutar DB/book quando `amountOut` estimado ou executável fica abaixo de `amountOutMin`.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='routerService|orderService'`
- Boundary: spot routing.
- Done nesta fatia: router revalida a profundidade atual do ORDERBOOK antes de criar ordem e rejeita book stale abaixo de `amountOutMin` ou do mínimo derivado de `maxSlippageBps` sem chamar `orderService.createOrder`.
- Done adicional: `AMM_V1` não é mais executado por market order no book; enquanto não houver executor AMM real, a rota falha antes de mutar DB/book.
- Risk: execução AMM real segue bloqueada até implementação própria e testes de liquidez/settlement; ORDERBOOK usa revalidação fresca + lock de par do P0 #7.

### 6. Consistência book/DB/settlement

- Status: Done
- Files: `spot-api/src/utils/orderbook.ts`, `spot-api/src/services/orderService.ts`, `spot-api/src/services/tradeService.ts`, `spot-api/src/__tests__/orderbook.test.ts`, `spot-api/src/__tests__/orderService.test.ts`, `spot-api/src/__tests__/tradeService.test.ts`
- Acceptance: mutações do book são transacionais ou compensáveis; falha de DB/settlement não deixa book divergente.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='orderbook|orderService|tradeService|routerService'`
- Boundary: matching engine.
- Done nesta fatia: orderbook ganhou checkpoint/restore; `orderService` restaura o book se a persistência de matches falhar; `tradeService.processMatches` grava todos os matches em uma única transação DB; falha no processamento imediato de settlement não desfaz trade já persistido com payload retryable.
- Risk: consistência multi-instância depende do lock Redis/reidratação descritos no P0 #7 e de Redis compartilhado saudável.

### 7. Multi-instância do order book

- Status: Done
- Files: `spot-api/src/services/matchingLockService.ts`, `spot-api/src/services/orderbookBootstrapService.ts`, `spot-api/src/services/orderService.ts`, `spot-api/src/config.ts`, `spot-api/src/utils/productionGuards.ts`, `spot-api/src/__tests__/matchingLockService.test.ts`, `spot-api/src/__tests__/orderbookBootstrapService.test.ts`, `spot-api/src/__tests__/orderService.test.ts`
- Acceptance: produção documenta e implementa single-writer ou estado compartilhado; múltiplos pods não processam books independentes.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='productionGuards|matchingLockService|orderbookBootstrapService|orderService'`
- Boundary: SRE + matching.
- Done nesta fatia: produção usa lock distribuído Redis por par com renovação de TTL; fora de produção usa fila local por par; `orderService` reidrata o book do par a partir do banco dentro do lock antes de mutar matching; guard de produção valida Redis e parâmetros de lock.
- Risk: exige Redis compartilhado e tuning de TTL/wait; o book continua em memória, mas cada mutação produtiva passa por single-writer + reidratação canônica do banco.

### 8. Cancelamento com nonce/timestamp e sincronização chain

- Status: Done
- Files: `spot-api/src/routes/orders.ts`, `spot-api/src/services/orderService.ts`, `spot-api/src/__tests__/e2e/orders.e2e.test.ts`, `spot-api/src/__tests__/orderService.test.ts`
- Acceptance: cancelamento usa mensagem assinada com nonce e timestamp; replay é bloqueado; DB/book/chain convergem.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='orders.e2e|orderService|matchingLockService|orderbookBootstrapService'`
- Boundary: spot cancel.
- Done nesta fatia: cancelamento exige nonce/timestamp assinado e bloqueia replay; `orderService.cancelOrder` agora roda dentro do lock do par, reidrata o book, revalida a ordem e só muta DB/book depois de `cancel_order_for` concluir; falha ou indisponibilidade de cancelamento on-chain não remove a ordem do book nem altera o DB.
- Risk: se a chain confirmar e o banco ficar indisponível exatamente depois, ainda é necessário reconciliador operacional; o caminho normal e a falha de `cancel_order_for` agora estão protegidos.

### 9. Contratos ink! sem dependência de rollback implícito

- Status: Partial
- Files: `Lunex/contracts/asymmetric_pair/lib.rs`, `Lunex/contracts/pair/lib.rs`, `Lunex/contracts/spot_settlement/lib.rs`, `Lunex/contracts/router/lib.rs`, `Lunex/contracts/wnative/lib.rs`, `Lunex/contracts/asset_wrapper/src/lib.rs`, `Lunex/contracts/psp22/lib.rs`, `Lunex/contracts/**/lib.rs`, contract tests
- Acceptance: todo caminho que retorna `Err` não deixa estado parcial indevido; efeitos externos vêm depois de validações ou possuem compensação explícita.
- Verify: `cargo test --manifest-path Lunex/contracts/asymmetric_pair/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/pair/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/spot_settlement/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/router/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/wnative/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/asset_wrapper/Cargo.toml`, `cargo test --manifest-path Lunex/contracts/psp22/Cargo.toml`
- Boundary: contratos.
- Done nesta fatia: `AsymmetricPair::update_curve_parameters` agora valida o próximo estado inteiro antes de aplicar `gamma`, capacidade ou fee; teste RED/GREEN cobre falha com `InvalidFee` sem alteração parcial da curva. `PairContract::transfer_from`, `WnativeContract::transfer_from`, `AssetWrapper::transfer_from` e `PSP22Token::transfer_from` agora só consomem allowance após a transferência interna concluir; testes RED/GREEN cobrem falha de saldo sem redução de allowance. `AssetWrapper::mint`, `AssetWrapper::mint_with_ref`, `AssetWrapper::request_withdraw` e `AssetWrapper::burn_for` validam overflow dos audit counters antes de alterar saldo/supply ou marcar referência; regressões cobrem falha sem mint/burn parcial. `PairContract::update` ganhou regressão para falha de TWAP sem escrita parcial de cumulative price/reserves. `SpotSettlement::settle_trade` calcula todos os saldos e fees antes de escrever em storage; regressão cobre overflow tardio sem alterar balances, fees ou nonces. `SpotSettlement::withdraw_fees` calcula o crédito do treasury antes de zerar fees; regressão cobre overflow sem apagar `collected_fees`. `SpotSettlement::deposit_psp22` valida overflow do crédito interno antes do `transfer_from`, evitando chamada externa sem capacidade de registrar saldo. `RouterContract` valida token/path em wrappers native antes de `WNativeRef::deposit`, evitando wrap quando `add_liquidity_native` ou `swap_exact_native_for_tokens` falhariam por input inválido. O router também rejeita desired abaixo de min/zero, native abaixo de min, input zero para token->native e max input zero para exact-output antes de consultar Factory/Pair/WNative.
- Risk: ainda exige revisão profunda de sequências cross-contract do `router` com LP transfer/burn/swap e compensação real em harness/on-chain test; o off-chain env ainda mantém 8 testes ignorados por não simular Factory/Pair/WNative.

### 10. SpotSettlement com verificação on-chain de assinatura e fills

- Status: Partial
- Files: `Lunex/contracts/spot_settlement/lib.rs`, `spot-api/src/services/settlementService.ts`, `spot-api/src/__tests__/settlementSignatureMessage.test.ts`, API settlement, tests ink!/E2E
- Acceptance: contrato valida assinatura/nonce/fill parcial/limites de preço; relayer não consegue liquidar fill inválido.
- Verify: `cargo test --manifest-path Lunex/contracts/spot_settlement/Cargo.toml`, `cd spot-api && npm test -- --runInBand --testPathPattern='settlementSignatureMessage|tradeSettlementService|tradeService|orderService'`, `cd spot-api && npm run lint`, `cd spot-api && npm run build`
- Boundary: contrato + relayer.
- Done nesta fatia: `settle_trade` agora valida o preço de execução contra os limites assinados dos dois lados; relayer não pode liquidar acima do limite do comprador nem abaixo do mínimo do vendedor. O contrato também rejeita assinatura all-zero em todos os builds. O contrato persiste `filled_amounts` por `(maker, nonce)` e usa esse estado como fonte canônica para partial fills, impedindo que o relayer repita uma execução parcial com `filled_amount=0` para ultrapassar o tamanho da ordem. Além disso, grava um hash Blake2x256 dos campos imutáveis da ordem por `(maker, nonce)` e rejeita partial fills posteriores que alterem amount/price/token/side/expiry do mesmo nonce. Testes ink! cobrem fill malicioso acima do buyer limit, assinatura em branco, overfill parcial repetido, alteração de ordem entre partial fills e preservação de balances/nonces. O backend de settlement não converte mais assinaturas sintéticas `agent:`/`manual:` em sentinela on-chain; payload de contrato exige assinatura sr25519 real de 64 bytes.
- Risk: verificação sr25519 completa on-chain segue pendente porque o contrato ainda não implementa recuperação/validação criptográfica real no runtime ink! atual; mudança final ainda impacta ABI, API settlement e scripts de deploy.

### 11. Admin sem bypass financeiro direto

- Status: Done
- Files: `lunex-admin/src/app/(admin)/listings/actions.ts`, `lunex-admin/src/app/(admin)/dex-users/actions.ts`, `spot-api/src/routes/pairs.ts`, `spot-api/src/routes/admin.ts`, `spot-api/src/services/walletRiskService.ts`, `spot-api/prisma/schema.prisma`, `spot-api/prisma/migrations/20260427150000_add_banned_wallet_registry/migration.sql`, `spot-api/src/__tests__/e2e/pairs-admin.e2e.test.ts`, `spot-api/src/__tests__/e2e/admin-wallet-risk.e2e.test.ts`, `spot-api/src/__tests__/walletRiskService.test.ts`
- Acceptance: ações administrativas críticas chamam endpoints/serviços auditados; escrita direta Prisma não altera saldo, status de trade, lock, stake ou listing sem regra de negócio.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='admin-wallet-risk|walletRiskService|verifyWalletActionSignature|orderService|pairs-admin'`, `cd spot-api && npm run lint`, `cd spot-api && npm run build`, `cd lunex-admin && npm run build`
- Boundary: admin + backend.
- Done nesta fatia: criação/status/delete de pares no admin passam pelo `spot-api` protegido por `requireAdmin`; delete de par recusa trades existentes ou ordens abertas; ban/unban de wallet passam por endpoint backend transacional que atualiza `BannedWallet` e `Agent.isBanned`; `walletRiskService` bloqueia ações financeiras usando a mesma registry que o admin altera.
- Risk: o admin ainda usa `ADMIN_SECRET` compartilhado para chamadas internas; rotação/substituição por credencial auditável por usuário permanece P1. `lunex-admin` ainda tem falhas de lint pré-existentes fora deste recorte (`margin/page.tsx` e `app-sidebar.tsx`), embora o build passe.

### 12. Wallet ban aplicado em ações financeiras

- Status: Done
- Files: `spot-api/src/services/walletRiskService.ts`, `spot-api/src/middleware/auth.ts`, `spot-api/src/services/orderService.ts`, `spot-api/src/__tests__/walletRiskService.test.ts`, `spot-api/src/__tests__/auth/verifyWalletActionSignature.test.ts`, `spot-api/src/__tests__/orderService.test.ts`
- Acceptance: wallet ban bloqueia orders, cancels, copytrade, margin, listing, rewards e agent actions relacionadas.
- Verify: `cd spot-api && npm test -- --runInBand --testPathPattern='walletRiskService|verifyWalletActionSignature|orderService'`
- Boundary: authz backend.
- Risk: a fonte operacional agora combina `BannedWallet.address` com `Agent.walletAddress/isBanned`; integração externa de sanções/KYC permanece P1.

### 13. Deploy prod/testnet sem localhost/falta de segredo

- Status: Done
- Files: `docker/docker-compose.prod.yml`, `docker/docker-compose.testnet.yml`, `docker/Dockerfile.frontend`, `lunes-dex-main/nginx.spa.conf`, `spot-api/.env.example`, `spot-api/src/config.ts`, `spot-api/src/websocket/server.ts`, `spot-api/src/utils/productionGuards.ts`
- Acceptance: prod/testnet exigem `ADMIN_SECRET`, `ALLOWED_ORIGINS`, `ALLOWED_WS_ORIGINS`, URLs públicas e health checks corretos.
- Verify: `docker compose -f docker/docker-compose.prod.yml config`, `docker compose -f docker/docker-compose.testnet.yml config`, `cd spot-api && npm test -- --runInBand --testPathPattern='productionGuards'`
- Boundary: SRE.
- Risk: os manifests agora falham cedo sem settlement/admin/WS config; backup/durabilidade/restore drill permanecem P1.

### 14. ABI/frontend/SDK alinhados

- Status: Done
- Files: `lunes-dex-main/src/services/contractService.ts`, `lunes-dex-main/src/context/SpotContext.tsx`, `lunes-dex-main/src/hooks/useFavorites.ts`, `lunes-dex-main/src/services/rewardsService.ts`, `lunes-dex-main/src/pages/home/modals/chooseToken/mock.ts`, `lunes-dex-main/scripts/check-contract-abi-alignment.cjs`, `lunes-dex-main/package.json`, `lunes-dex-main/src/components/bases/checkbox/index.tsx`, `lunes-dex-main/src/pages/pool/asymmetric/index.tsx`
- Acceptance: frontend não chama métodos ausentes dos artifacts; assinaturas de read não são cacheadas; `LUNES` nativo não aparece como rota real sem implementação.
- Verify: `cd lunes-dex-main && npm run contract:check`, `cd lunes-dex-main && npm run build`, `cd lunes-dex-main && npm run quality`
- Boundary: frontend + SDK.
- Done nesta fatia: `contract:check` valida chamadas `.query/.tx` contra os ABIs importados, bloqueia cache de signed-read e bloqueia `address: 'native'`; signed reads em spot/favorites/rewards sempre geram nonce/assinatura frescos; token picker usa `WLUNES` em vez de `LUNES` nativo; `SpotContext` inicia em `WLUNES/LUSDT`; staking read trocou `getUserInfo` inexistente por `getStake`/`getStats`; `npm run quality` passou.
- Risk: o frontend ainda expõe textos/documentação sobre LUNES nativo em páginas informativas; isto não cria path executável. UX de native wrap/unwrap real segue dependente de implementação e testes dedicados.

## P1 — Necessário Antes de Escala Pública

- [ ] Implementar semântica real para `TimeInForce`.
- [ ] Fortalecer margin além de DB-only, com liquidação e provas adequadas.
- [ ] Reforçar CopyVault com settlement/auditoria final.
- [ ] Completar WebSocket com resync incremental e gaps.
- [ ] Expandir `/health` para Redis, Postgres, chain RPC, settlement e filas.
- [ ] Rotacionar `ADMIN_SECRET` e substituir bearer compartilhado por credenciais auditáveis.
- [ ] Remover bootstrap admin inseguro e logs de senha.
- [ ] Definir KYC/AML/sanctions e retenção de logs.
- [ ] Corrigir backup S3, Redis persistence, Postgres durability e restore drill.
- [ ] Fazer CI bloquear typecheck, testes, audit/Trivy e quality gates.
- [ ] Corrigir Prettier/quality do frontend.
- [ ] Remover fallback de preço fixo de fluxos financeiros.
- [ ] Trocar `Number` por aritmética segura em valores tokenizados no frontend.
- [ ] Adicionar confirmações de risco para margin actions.

## P2 — Hardening Operacional

- [ ] Runbooks para incidentes de Redis, chain RPC, settlement, DB e WebSocket.
- [ ] Dashboards de latência, erro, fila de settlement, replay, cancels e divergência de book.
- [ ] Auditoria externa de contratos após P0 on-chain.
- [ ] Load test com volume de ordens, cancelamento e WS fanout.
- [ ] Chaos test de restart de API, Redis e node chain.

## Já Validado Nesta Rodada

- [x] Runtime `lunes-nightly` possui `pallet_contracts`, `pallet_assets`, `ContractsApi` e chain extension de assets.
- [x] Scripts `check-contracts-qa.ts`, `setup-local-tokens.ts` e `test-liquidity-pool.ts` foram ajustados para ambiente local.
- [x] Pair contract passou `cargo test --manifest-path Lunex/contracts/pair/Cargo.toml`.
- [x] SpotSettlement passou `cargo test --manifest-path Lunex/contracts/spot_settlement/Cargo.toml` com 41 testes.
- [x] SpotSettlement bloqueia assinatura em branco, fill acima do limite do comprador, overfill parcial repetido, alteração de campos imutáveis no mesmo nonce e mutação parcial em overflow tardio de settlement/fee withdrawal/PSP22 deposit.
- [x] WNative, AssetWrapper e PSP22 passaram suas suítes completas após regressões de allowance em `transfer_from`; AssetWrapper passou com 29 testes incluindo overflow sem mint/burn parcial.
- [x] Router passou `cargo test --manifest-path Lunex/contracts/router/Cargo.toml` com 27 testes ativos / 8 ignorados; wrappers native e prechecks de liquidity/swap rejeitam input inválido antes de chamadas cross-contract.
- [x] Settlement API passou `npm test -- --runInBand --testPathPattern='settlementSignatureMessage|tradeSettlementService|tradeService|orderService'`, `npm run lint` e `npm run build`; `agent:`/`manual:` não entram mais em payload on-chain.
- [x] Workspace de contratos passou `cargo test --workspace --exclude fuzz`.
- [x] Spot/orderbook focado passou 9 suites / 57 testes.
- [x] Backend passou `npm test -- --runInBand` com 39 suites / 305 testes.
- [x] Backend passou `npm run test:e2e -- --runInBand` com 16 suites / 124 testes.
- [x] Backend passou `npm run build`, `npm run lint` e Prettier nos arquivos alterados.
- [x] README e spec de bootstrap local documentam como subir projeto/testnet local.
- [x] RED/GREEN registrado para nonce atômico/fail-closed e anti-escalada de API key.
- [x] RED/GREEN registrado para production guards, timestamp assinado no settlement, cancel replay e wallet ban.
- [x] RED/GREEN registrado para checkpoint/rollback do orderbook, transação única de matches e revalidação stale do ORDERBOOK no router.
- [x] RED/GREEN registrado para admin sem bypass financeiro direto: pares e wallet bans passam por endpoints backend protegidos e testes focados somam 5 suites / 23 testes.
- [x] RED/GREEN registrado para ABI/frontend/SDK: `contract:check` falhou em cache de signed-read, `address: 'native'` e método ausente `getUserInfo`, depois passou junto com `npm run build` e `npm run quality`.
- [x] RED/GREEN parcial para contratos sem rollback implícito: `asymmetric_pair` não aplica atualização parcial de curva quando validação posterior falha; `pair.transfer_from` não consome allowance quando a transferência falha.
- [x] RED/GREEN registrado para lock distribuído Redis do matching e reidratação do book por par antes de mutação.
- [x] RED/GREEN registrado para cancelamento fail-closed quando `cancel_order_for` falha ou fica indisponível.
- [x] Backend focado passou `npm test -- --runInBand --testPathPattern='productionGuards|matchingLockService|orderbookBootstrapService|orderService|orderbook|tradeService|routerService'` com 9 suites / 64 testes.
- [x] `docker compose config` passou para prod e testnet com variáveis dummy obrigatórias.
