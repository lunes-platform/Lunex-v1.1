# Evidências de QA local

## Ambiente

Checkout: `feature/native-lunes-swap-pools`, base `e5af0b0`. Rede: [lunes-nightly](https://github.com/lunes-platform/lunes-nightly), binário existente `4.0.0-dev-97440ba0fff`, runtime 107. Nó iniciado com estado persistente em `/private/tmp/lunex-qa-lunes-20261017` (sem reset do banco existente).

- Frontend: <http://127.0.0.1:3000>
- Preview do build de produção: <http://127.0.0.1:3030>
- API: <http://127.0.0.1:4000/health>, WebSocket `ws://localhost:4001`
- Blockchain: `ws://127.0.0.1:9944`, HTTP RPC `http://127.0.0.1:9933`
- PostgreSQL `lunex_spot`, Redis `127.0.0.1:6379`.
- Contas públicas de desenvolvimento Alice/Bob. Nenhuma chave real ou rede pública foi utilizada.

## Discovery antes do código

Lidos `AGENTS.md`, PRD/SPEC canônicos, workflow SDD, bootstrap local e código de integração React → SDKContext → ContractService → Router/Pair/WNative, além de inicialização/configuração/rotas da API e scripts de deploy/seed.

Alterações preexistentes preservadas: 11 manifests Cargo dos contratos e `docker-compose.dev.yml`, `docker/Dockerfile.admin`, `docker/nginx.dev.conf`. A execução dos scripts atualizou o estado local em `spot-api/deployed-addresses.json` e `.env` locais. Artefatos binários gerados em `target/` não entram na entrega.

## Falhas reproduzidas e correções

| Falha | Evidência antes | Correção / regressão |
|---|---|---|
| Cotação anterior habilitada para outro par | Navegador LUNES/LUSDT → LUNES/LBTC mostrava saída antiga e botão Swap ativo | Chave por input/tokens, invalidação imediata e descarte de respostas antigas |
| Output antigo após limpar input | Teste React RED | Output derivado da cotação atual; input de saída somente leitura |
| Mínimo recebido ignora slippage escolhido | 2% escolhido, preview continuava em 0,5% | Preview e tx usam o mesmo `calculateMinAmount` |
| WLUNES sem saldo na busca/wrap | Token fora da lista padrão também era excluído das consultas | Buscar saldos na lista completa, mantendo UX da lista padrão |
| Polling antes de conectar RPC | Browser `Not connected to blockchain`; teste RED | Publicar carteira conectada após RPC e saldo estarem prontos |
| IDs/eventos duplicados no input | Chromium encontrou dois elementos com o mesmo ID; teste RED | Wrapper recebe só layout; input recebe atributos e eventos |
| Factory `Ok(None)` vira endereço | Browser erro de base58 com `[object Object]` | Desempacotar Result/Option e validar endereço |
| Pools adicionais sem LUSDT | Script falhou ao aportar LBTC; só restavam 50k dos 850k necessários | Top-up verificado apenas para mock local com mesmo code hash de WNative |
| LETH com escala errada | Script local cria 8 casas, seed/cache assumiam 18 | Seed corrigido e pools consultam metadata on-chain |
| Aporte/retirada usam reservas invertidas | Dois testes React RED na ordem A=token1 | Reservas do hook normalizadas para A/B |
| MAX LP usa plancks no campo humano | Revisão do caminho input → parseAmount | Formatar LP para unidades humanas |
| Aporte nativo tenta debitar WLUNES do usuário | Bob sem WLUNES: browser revert; dry-run `InsufficientBAmount` | Router usa seu próprio wrapper; aporte e retirada MAX confirmados no navegador após novo deploy |
| Dry-run Err interno é ignorado | Teste mostrou chamada a `tx.addLiquidityNative` mesmo com `{ok:{err:...}}` | Recusar envio ao detectar erro do pallet ou contrato |
| Simulador AMM com split antigo | Página 0,4/0,05/0,05 versus Pair 0,3/0,1/0,1 | Parâmetros e rótulos de simulação alinhados ao Pair |
| Taxa do pool exibida como 0,3% | Screenshot do build mostrava a parcela LP como se fosse a taxa total | Rótulo total 0,5%; cálculo de rendimento LP permanece em 0,3% do volume, coberto por regressão |
| Saldo LP não atualiza ao conectar | UI mostrava zero, on-chain já existia posição LP | Atualizar o hook ao conectar/desconectar carteira; teste RED/GREEN e verificação no navegador |
| Endereços ausentes no bundle de produção | `process.env[key]` virava leitura em objeto vazio | Acessos estáticos às variáveis públicas, regressão do transform esbuild e conferência do endereço do Router no bundle |
| Nomes `[object Object]` nos pools de teste | Consulta RPC confirmou strings inválidas já gravadas em LBTC/LETH/GMC/LUP | Construtor recebe strings, bootstrap verifica metadata antes de financiar; nomes do registro por endereço e decimals on-chain na UI |

## Testes automatizados

| Verificação | Resultado |
|---|---|
| Baseline frontend | 62/62 |
| Frontend após regressões | 84/84 em 15 arquivos |
| API | 411/411 em 53 suítes, após ajuste do schema de risco |
| Rust workspace antes do último fix do Router | 346 aprovados, 8 ignorados, zero falhas |
| Rust workspace final | 349 aprovados, 8 ignorados, zero falhas; execução completa após as correções |
| Router após fix | 30 aprovados, 8 ignorados, zero falhas; inclui 3 novos testes |
| Build frontend/API | Aprovados; build final frontend inclui o endereço do Router novo |
| Quality frontend/API | Aprovados (ABI, guard, lint, exports, dependencies e formatação) |
| Typecheck dos scripts de tokens | Aprovado para `deploy-tokens.ts` e `deploy-additional-tokens.ts` |
| Clippy workspace `-D warnings` | Bloqueado por 5 problemas anteriores do simulador `src/native_assets_integration.rs`: 4 variáveis não usadas e `new_without_default` |
| Clippy Router `-D warnings` | Bloqueado por 32 lints existentes: constante sem uso, aridade das mensagens ABI e operações aritméticas; o lint básico do `cargo contract build` passou |

Os 8 testes ignorados do Router já existiam. Os testes de API usam fixtures/mocks de serviços; não substituem as transações reais abaixo.

## Navegador e blockchain

Chromium desktop 1440×1000: 16 rotas (`/`, `/swap`, `/pools`, `/spot`, `/pool`, `/staking`, `/rewards`, `/governance`, `/listing`, `/social`, `/spot/copytrade`, `/strategies`, `/agent`, `/affiliates`, `/protocol-stats`, `/docs`) sem pageerror, respostas HTTP de erro ou overflow na execução com API ativa.

Chromium mobile 390×844: 11 rotas (`/`, `/swap`, `/pools`, `/pool`, `/spot`, `/staking`, `/rewards`, `/listing`, `/social`, `/agent`, `/docs`) sem pageerror, respostas HTTP de erro ou overflow. Inspeção visual dos screenshots de swap desktop/mobile realizada.

Build de produção servido por `vite preview` em 3030: `/pools` carregou os cinco pares principais pela Factory, com WLUNES/LBTC/LETH/GMC/LUP e LUSDT identificados, taxa total 0,5% e nenhum `[object Object]` ou pageerror. Os dois pares temporários criados pelas provas independentes também permanecem na Factory. Screenshot inspecionado em `/private/tmp/lunex-production-pools.png`; assertions aprovadas em `/private/tmp/lunex-production-browser-final.log`. A origem 3030 foi adicionada somente ao `.env` local da API para o WebSocket aceitar o preview.

A extensão de teste injeta a interface Polkadot.js e assina payloads reais com Bob. Todas as operações passam pelos contratos reais na rede local.

| Operação pela UI | Prova |
|---|---|
| 0,1 LUNES → LUSDT | Tx `0x10d88dceb7de81127731493cfd70be2d24c85a3987816d61caa14af589dce5ff`; LUSDT aumentou de 24,862630 para 49,700485 |
| Wrap 1 LUNES | Tx `0xf9e1837354f697a9b0a8db378ca4da8b509f5e9dc1c54ebf7b7604b90a1a84eb`; WLUNES 0 → 1 |
| Unwrap 1 WLUNES | Tx `0x7d5cb6e94df5b07ed068c891b0e4088d1ca6ea65d5c8553a67560d792eee4a9d`; WLUNES 1 → 0 |
| 1 LUSDT → LUNES | Tx `0x21cf22b8af0b406bd1d586aad9794d3a4627a46dd2e8e21dfa95091ec4b15efb`; LUSDT diminuiu exatamente 1 |
| Par sem liquidez | Output limpo, mensagem de liquidez insuficiente e botão desabilitado |
| Contratos core + tokens/pairs | `check-contracts-qa.ts`: todos os 15 endereços existentes |
| Pool e swap independentes | `test-liquidity-pool.ts`: aprovado; USDT 2.500.000.000 → 2.548.779.292 unidades brutas |
| Aporte nativo sem WLUNES | Tx `0x4323c33df9c28c2a97266426476baf0fb04fcdca11ef2bcafbc06b177b27949b`; LP 7.897.953 → 15.795.906 unidades, LUSDT 36,224887 → 23,749289 |
| Retirada MAX nativa | Tx `0xff4f633fa7a4948dc1587acd7a1fe1d83895b8ff7f7353a53571216fc8afd887`; queimou 15.795.906 unidades LP, saldo LP final zero e LUSDT 48,700482; zero erros de console |
| Reembolso do excesso nativo | Tx `0xeea630cebb5a5a1fbcf8f955775a041b85cd27ff812b883dd39b2447de781935`; enviou 0,1 LUNES para aportar 1 LUSDT; custo nativo total 0,00885782 LUNES incluindo taxas; WLUNES do usuário inalterado e Router sem WLUNES retido |
| Saldo LP ao conectar | Página exibiu 0,00633071 LP, igual às 633.071 unidades verificadas on-chain após o pequeno aporte do teste de reembolso; zero erros de console |
| Construtor PSP22 com metadados corretos | Tx `0xc4ecf754f872f22d3305d09b9130754c188b6ab7886d347a5798605dbf838f50`; token isolado `5CFcMPwkhwzjWNXQjHXAkzr2YYxpAxnBVhM1Pmu6TaxmGbwo`: nome `Lunes Ethereum QA`, símbolo `LETHQA`, decimals 8, todos confirmados por RPC |

Durante a reinicialização planejada da API houve erros temporários de WebSocket; não ocorreram nos testes de navegação com os serviços ativos.

Router corrigido: `5DaJT6GxHfeQPRUkf4hvVsKW1TxgMHzdspaYopUBwD4VPT6y`, hash `0xcefcf3af27abe7159d67c2f13c032666a456aeb661b4da395aeded2684e2493f`. Compilado com Rust 1.85.0, release WASM de 41.596 bytes e metadata ink! v4. O cargo-contract 5.0.3 instalado emitiu aviso de compatibilidade com ink! 4, mas concluiu lint, compilação, otimização e metadata. Deploy e execução reais na Lunes local foram verificados. Factory e pools foram preservados.

O primeiro teste do novo aporte aguardava incorretamente o texto exato de um toast com ícone; a transação havia sido confirmada e o saldo LP tinha aumentado. A automação foi ajustada para verificar o estado final da UI e os saldos on-chain. O ciclo completo seguinte passou.

O teste de reembolso deixou intencionalmente uma pequena posição de desenvolvimento de Bob no pool; não houve reset de saldos. Os 40 arquivos adicionais de formatação foram comparados à base por sintaxe TypeScript; o arquivo de formulário Spot restante teve apenas quebra de linhas JSX e foi revisado no diff. As alterações funcionais estão listadas na SPEC. As dependências diretas adicionadas mantêm as versões já utilizadas no ambiente; o npm exigiu `--legacy-peer-deps` por resolução de peers do ecossistema Polkadot.

## Reprodução e artefatos locais

```sh
cd lunes-dex-main
npm run test:run
npm run build
npm run quality

cd ../spot-api
npm test -- --runInBand
npm run build
npm run quality
npx ts-node scripts/check-contracts-qa.ts
```

Logs e automações: `/private/tmp/lunex-browser-qa.cjs`, `/private/tmp/lunex-wallet-browser.cjs`, `/private/tmp/lunex-liquidity-browser.cjs`, `/private/tmp/lunex-*-final.log`, `/private/tmp/lunex-contract-tests.log`. Resultados estruturados: `/private/tmp/lunex-browser-results.json` e `/private/tmp/lunex-browser-results-mobile.json`. Screenshots: `/private/tmp/lunex-qa-*.png`, `/private/tmp/lunex-wallet-*.png`, `/private/tmp/lunex-liquidity-*.png`.

Scripts adicionais de validação: `/private/tmp/lunex-refund-browser.cjs` e `/private/tmp/lunex-pool-balance-browser.cjs`; ambos concluíram com assertions aprovadas.

O diagnóstico dos nomes está em `/private/tmp/lunex-token-metadata.log`; o teste do construtor corrigido em `/private/tmp/lunex-token-constructor-final.log`. Os nomes inválidos dos quatro mocks antigos são imutáveis e permanecem no estado local para preservar pools e saldos. A interface identifica esses endereços pelo registro configurado; tokens desconhecidos usam seus próprios metadados on-chain. O token isolado de QA não recebeu pool nem substituiu os tokens existentes.

## Limites

Esta verificação cobre navegação e os fluxos financeiros explicitamente testados. Não valida integralmente custody/settlement de Spot, copytrade, margem, listagem, governança, agentes ou indexador. Dados de demonstração preexistentes do banco foram preservados. Não houve publicação pública, migration destrutiva, commit ou push.

## Rastreabilidade para revisão

- [x] PRD, SPEC e tarefas em unidades pequenas documentados nesta pasta.
- [x] Arquivos funcionais alterados estão descritos na SPEC; formatação dos gates identificada separadamente.
- [x] Regressões reproduzidas antes da correção e verificações de UI/RPC registradas.
- [x] Frontend prepara inputs e previews; Router/Pair continuam autoritativos para movimentação e fees.
- [x] Mudança do Router compilada, implantada e exercitada somente na rede local.
- [x] Riscos residuais, lints anteriores e módulos sem validação financeira integral registrados.
