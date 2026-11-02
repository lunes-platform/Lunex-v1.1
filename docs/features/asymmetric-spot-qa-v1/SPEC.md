# SPEC — análise e testes assimétricos/híbridos e Spot

## Discovery inicial

Leitura da proposta original, PRD/SPEC/TASKS assimétricos, arquitetura canônica, `asymmetric_pair/lib.rs`, `routerService.ts` e serviços frontend. O pacote V1 ainda registra validação wallet-driven de deploy/registro/update como pendente.

Observações a confirmar por execução:

1. O contrato assimétrico calcula estado de curva; `deploy_liquidity`, `withdraw` e `asymmetric_swap` não mostram transferências PSP22. Confirmar com deltas de saldos antes de tratar como liquidez executável.
2. A fórmula de liquidez remanescente subtrai `t*x`; o output usa diferença entre liquidez antes/depois. Verificar se aumentar fee indevidamente aumenta o output.
3. `get_quote` não aplica os mesmos limites/rejeições de `asymmetric_swap`; testar capacidade, liquidez e zero.
4. O roteador declara `priceImpactBps: 0` para ASYMMETRIC por continuidade; comparar com preço marginal e execução por tamanhos crescentes.
5. O roteador AMM ainda usa 997/1000 e reservas opcionais no banco; comparar com Pair 995/1000 e estado on-chain real. Não presumir disponibilidade de execução só por uma simulação.
6. Comparar fee maker/taker, BUY/SELL, profundidade e outputs líquidos das rotas.
7. A escala normalizada de curvas deve ser rastreada ponta a ponta; `1e12` não deve ser confundido com os 8 decimals nativos ou os decimals PSP22.
8. Verificar isolamento de ownership, manager/guardrails, atualização parcial, registro e rebalance; leverage/juros completos são non-goals da V1 existente e serão classificados como tal.

## Plano de testes

- Matriz matemática para gamma 1..5, fee 0..1000 bps, volumes próximos de zero/exaustão e diferentes k/x0; comparar implementação com referência independente.
- Deploy assimétrico isolado na rede local usando artefato compatível e conferir owner, curvas, alterações, eventos e saldos reais.
- Chromium com carteira de desenvolvimento, deploy/registro/consulta/update quando disponíveis; nenhuma simulação substitui evidência de custody/settlement.
- Book Spot com múltiplos usuários públicos de desenvolvimento e par QA dedicado; conferir API, PostgreSQL, WebSocket e UI.
- Invariantes: conservação de saldos/fees, nunca negativo, restante+preenchido=total, cancellation libera somente restante, FOK sem parcial, IOC não deixa restante aberto, replay não executa novamente.
- Quando settlement estiver disponível, conferir depósitos/saques e fills no vault on-chain; indisponibilidade será evidência explícita, sem afirmar liquidação real a partir do banco.

### Ambiente de negociação

Preparar banco PostgreSQL próprio de QA a partir das migrations canônicas, API em 4100/4101 e frontend em 3100 com overrides locais. O banco atual contém histórico e retries anteriores; habilitar settlement nele poderia processar operações fora da matriz. O ambiente de QA usará tokens/pares e usuários de desenvolvimento identificados, um SpotSettlement novo, relayer e attestor locais, com verificação de assinatura on-chain habilitada. As configurações sensíveis ficarão somente em arquivo temporário com permissão 0600. Os serviços originais continuam em 3000/4000/4001/3030.

## Fronteiras de implementação

Esta fase começa somente com análise e testes. Cada bug confirmado terá complemento nesta SPEC e tarefa com arquivos/aceitação/verificação antes de mudanças de produção. Não transformar a curva de liquidez remanescente em uma nova equação de preço sem contrato econômico definido. Não alterar schemas/contratos públicos silenciosamente.

Gates dos módulos efetivamente alterados seguem `AGENTS.md`. Preservar as alterações do QA anterior e do usuário. Operações financeiras locais serão sequenciais para evitar disputa de nonce.

## F1 — Compatibilidade de lint do build AsymmetricPair

O build atual falhou em quatro casts `usize -> u8` gerados pelas macros de eventos ink! 4.3, apontando os nomes dos eventos. Aplicar `allow(clippy::cast_possible_truncation)` ao módulo gerado em `Lunex/contracts/asymmetric_pair/lib.rs`, com comentário explicando a compatibilidade, seguindo o tratamento já existente nos demais contratos. Nenhuma regra matemática, parâmetro, ABI ou transferência será alterada nesta tarefa. Verificação: `cargo contract build --release` deve gerar WASM/metadata do código atual; depois testes ink do módulo. Os demais warnings ficam registrados.

## F2 — Assinatura de mensagens via carteira

O fluxo UI instancia e configura o contrato, mas o registro recebe `401 Invalid signature`. `SDKContext.signMessage` passa texto puro em `signRaw.data`; o tipo oficial instalado `SignerPayloadRawBase` exige dados hex-encoded. Corrigir `lunes-dex-main/src/context/SDKContext.tsx` para codificar UTF-8 com `stringToHex` antes do signer, mantendo import lazy. Regressão em `context/walletConnection.test.tsx` cobre Unicode, newline e identidade. Verificar o registro real no navegador e respostas autenticadas; não flexibilizar validação de assinatura no backend.

## F3 — Parâmetros de template, gráfico e deploy

Screenshot do Builder após selecionar Stablecoin Range mostrou k de compra=1000 e venda=500, embora o template declare 5000/5000. A seleção copia somente gamma/x0/fee. Além disso, `handleDeploy` e o modal dividem sell k por dois, divergindo do gráfico. Em `pages/pool/asymmetric/index.tsx`, aplicar integralmente `buyParams`/`sellParams` do template sobre os defaults e enviar/exibir o mesmo sell k, sem redução implícita. Regressões de componente em `pages/pool/asymmetric/parameters.test.tsx`: template completo no preview e valores do preview iguais aos enviados no deploy. Essa correção não valida a curva como mercado de stablecoin; seu modelo econômico segue sob análise.

## F4 — Ownership no registro assimétrico

Prova com assinatura válida de Eve registrou o contrato de Alice e recebeu 201 (artefato `lunex-asymmetric-owner-results.json`), embora o hash oficial esteja configurado. O código confere somente code hash. Extrair a verificação para `spot-api/src/services/asymmetricContractVerifier.ts`: exigir hash em produção, existência/code hash do contrato, consultar `get_owner` pela ABI oficial, desempacotar MessageResult e comparar AccountId sem depender do prefixo SS58. Indisponibilidade retorna 503; não-owner ou hash divergente, 403. Sempre desconectar a conexão RPC. `routes/asymmetric.ts` deve passar a identidade da wallet assinada ou `req.agent.walletAddress`, sem aceitar identidade alternativa. Testes em `src/__tests__/asymmetricContractVerifier.test.ts` e prova API repetida; não desabilitar autenticação nem depender de chave de relayer para consulta pública.

## F5 — Decodificação das leituras Spot

Primeira ordem SELL real com 500 QAX depositados falhou com HTTP500: `Cannot convert {"ok":50000000000} to a BigInt`. `settlementService.getVaultBalance` usa `output.toString()` sem desempacotar MessageResult. As leituras de nonce usam comparação literal com `'true'`, que também falha para `{ok:true}`. Criar `utils/contractResult.ts` com leitura estrita de Balance/boolean, suporte aos envelopes Result e erro explícito em Err/tipo inválido/precisão perdida; atualizar esses três métodos em `settlementService.ts`. Testes em `__tests__/contractResult.test.ts`, seguidos da ordem real. Sem converter indisponibilidade em saldo zero/nonce livre. O endpoint de balances baseado só no banco é outra falha e não será mascarado neste item.

## F6 — Preço de settlement em unidades dos tokens

Após F5, trade real de 1 QAX (8 casas) a 2 QUSD (6 casas) foi SETTLED, mas debitou 200,5 QUSD e creditou 199,8 QUSD (deveria 2,005 / 1,998). Tx `0x2d4f1203d597b668fbb134a79b970074cadec6bb8894b450f5861eae471bb9a8`. Contrato define `quoteRaw = baseRaw * priceRaw / 1e8`, portanto `priceRaw = humanPrice * 10^(8 + quoteDecimals - baseDecimals)`. O adapter usava sempre humanPrice*1e8.

Adicionar conversão exata sem floating point em `utils/settlementUnits.ts`, aplicá-la ao fill e aos limites assinados em `settlementService.ts`, e incluir quoteDecimals no snapshot criado em `tradeService.ts`. Snapshot legado sem quoteDecimals deve falhar explicitamente, sem assumir 8. Não arredondar preço não representável nem aceitar overflow u128. Testes de pares 8/6, 6/8, 8/8, notação decimal/científica e limites. Ajustar fixtures de gas e pipeline com quoteDecimals8 para preservar a semântica original, e testar que payload legado incompleto não gera extrinsic. Este item não altera ABI, fórmula do contrato ou política de ordens MARKET.

## F7 — Manager assimétrico decodificado e comparado por AccountId

Readback real retornou chain `get_manager=None`, mas API expôs managerAddress igual ao texto `{"ok":null}`. Em `services/rebalancerService.ts`, ler MessageResult/Option corretamente e rejeitar erro RPC/codec, sem inventar manager. Comparar manager/relayer pelo AccountId (prefixos SS58 equivalentes) para preservar delegação válida. Compartilhar leitura estrita em `utils/contractResult.ts` e cobrir None/Some/nestedErr/dispatchError e identidade com prefixos em `__tests__/rebalancerManagerCodec.test.ts`. Não delegar manager nem ativar rebalance nesta tarefa; somente estado/autorização existente. Repetir readback real após restart isolado quando a matriz terminar.

## F8 — Limites canônicos de MARKET/STOP no settlement

Matriz real: MARKET BUY com dois fills e STOP BUY falham on-chain; SELL equivalente passa. Ordens a mercado são persistidas com preço0; o contrato exige fill_price <= buyer.price. Adapter deve representar ausência de limite BUY por u128MAX e SELL por0, exclusivamente para tipos MARKET/STOP verificados na assinatura original. O valor canônico permanece igual em todos os fills do nonce, antes de atestar; nunca usar preço específico de cada fill como limite, pois alteraria o hash de uma ordem parcialmente preenchida. Arquivos: utils/settlementUnits.ts, services/settlementService.ts e __tests__/settlementUnits.test.ts. Não alterar formato da mensagem assinada/ABI nem afirmar proteção de derrapagem para MARKET sem limite.

## F9 — Nonce do relayer entre cancelamento e trade

Matriz real reproduziu `1010 Transaction is outdated` após cancelamentos: settle_trade usa contador explícito e cancel_order_for usa nonce automático sem avançar o contador compartilhado. Atualizar cancelOrderFor para adquirir nextNonce e enviar explicitamente, invalidando cache em erro como settlement. Arquivos: services/settlementService.ts e __tests__/settlementGas.test.ts. Regressão exige sequência trade/cancel/trade com nonces distintos, além de concorrência já coberta no pipeline. Não coordenar serviços externos que compartilhem a mesma chave nesta tarefa; uso de chave por processo continua requisito operacional.

## F10 — IOC/FOK no lifecycle

IOC deixou PARTIAL/OPEN no book; FOK insuficiente produziu parcial. Em services/orderService.ts, receber timeInForce do registro persistido, simular matching no checkpoint e, para FOK sem preenchimento integral, restaurar livro e cancelar ordem sem trades. IOC remove restante do book e marca CANCELLED se parcial/zero. GTC e tipos stop seguem semântica após ativação. Arquivos: orderService.ts e __tests__/orderService.test.ts. FOK assegura matching integral em transação DB; vários fills continuam extrinsics separados, sem garantia de atomicidade financeira entre eles. Não declarar batch atômico inexistente.

## F11 — Aritmética decimal do matching

Compra0,3 contra0,1+0,2 produziu filled0,29999999999999998/restante2e-17 e fill não representável em tokens8dec. Usar Decimal para subtrações e agregações em utils/orderbook.ts, mantendo contratos numéricos atuais de entrada/saída e comparação de prioridade. Em tradeService.ts calcular quote/fees com Decimal em vez multiplicação JS, truncando fees em unidades mínimas da quote como on-chain. Arquivos: orderbook.ts, tradeService.ts e respectivos testes. Cobrir BUY/SELL, LIMIT/MARKET e snapshots sem dust; não arredondar saldos para esconder erro.

## F12 — Expiração no lifecycle

Ordem com expiresAt passado foi aceita201. Rejeitar na criação sob lock e impedir ordens/pending stops expiradas de participar de matching e rehydration. Arquivos: orderService.ts, orderbookBootstrapService.ts e testes respectivos. Ordens expiradas tornam-se CANCELLED no banco, sem novo enum/migração; contrato continua conferindo expiry como barreira financeira. Não executar cancel on-chain somente para marcar expiração temporal, pois já não há autorização para fill após expiry.

## F13 — Saldos Spot autoritativos

API `/balances` retornou lista vazia apesar de depósitos comprovados no vault; atual serviço só lê UserBalance. Quando settlement habilitado, obter totais do vault para tokens dos pares cadastrados e reservas reais do usuário; falha de RPC não vira saldozero/ledgerfallback. Identificar nativo por sentinel de32byteszero para distinguir WLUNES do mesmo baseToken com isNativeBase. Reservas BUY incluem fee máxima configurada; compartilhar cálculo de unidades/reservas com admissão de ordens para não exibir saldo diferente da regra autoritativa. Implementar em tarefas separadas backend (balanceService.ts, orderService.ts, novo helper de reservas, testes) e frontend (services/spotService.ts, OrderForm e testes) antes da UI. Schema inalterado, ledger preservado apenas no modo settlementdesabilitado.

## F14 — Publicação do book e trades

WS enviou snapshot inicial mas nenhuma atualização após novaordem. Implementar publisher em websocket/server.ts com profundidade por conexão e whitelist existente; publicar book após mutação commitada de create/cancel, e trades públicos sanitizados após commit. Arquivos: server.ts, orderService.ts, tradeService.ts e testes. Canal privado continua proibido; não incluir assinatura/nonce/payload ou dados internos. Testar criação/cancel/fill e privacidade/depth no WS real.

### F13b — Leitura assinada dos saldos no formulário

OrderForm atualmente consulta wallet LUSDT/nativo hardcoded, embora ordens usem depósitos no vault de qualquer par. Adicionar cliente getBalances em services/spotService.ts e botão explícito Load/Refresh Spot balances em OrderForm; a assinatura de leitura só ocorre pela ação do usuário, sem prompts em polling. Mapear disponíveis pela metadata do par e sentinel nativo. Limpar saldo em troca de carteira e após ordem aceita; impedir resposta antiga de aparecer na carteira nova. Testar par QAX/QUSD e troca de par/nativo. Nenhuma regra financeira final migra ao frontend; backend continua conferindo saldo/reserva.

## F15 — Par válido e canais permitidos no contexto Spot

Contexto inicia sempre WLUNES/LUSDT, gerando404 em QA com outros pares. Após catálogo carregar, selecionar símbolo existente; não consultar/subscrever símbolo vazio. Contexto também tenta canaluser que WS proíbe por privacidade: manter limpeza local ao trocar carteira, com leituras privadas explícitas/assinadas, sem subscrição proibida. Arquivos context/SpotContext.tsx, components/spot/ChartPanel/index.tsx e teste. Chart deve aguardar símbolo válido antes de pedir candles; browser reproduziu HTTP400 em /candles/ durante catálogo vazio. Quando receber trade público, atualizar ticker pela API existente, evitando inventar estatísticas no frontend; ignorar resposta de par antigo no cleanup.

## F16 — Integridade dos termos e representação canônica da assinatura

O formato atual assina somente par/lado/tipo/preço/stop/amount/nonce/timestamp; timeInForce e expiresAt não alteram a mensagem verificada. Isso permite alterar execução e validade sem nova assinatura. Além disso, números como amount1.00 tornam-se1 no Decimal persistido e quebram a revalidação de settlement. Regressões devem comprovar ambos antes do código.

Introduzir formato explícito `lunex-order-v2:{pair}:{side}:{type}:{canonicalPrice}:{canonicalStop}:{canonicalAmount}:{nonce}:{timestamp}:{timeInForce||GTC}:{expiryUnixMs||0}`. Canonical decimal exato por manipulação de dígitos, sem Number para valores financeiros. Novas assinaturas cobrem todos os termos; fallback v1 somente para GTC sem expiry, preservando clientes básicos antigos. IOC/FOK ou prazo com assinatura v1 exigem nova assinatura v2. Fonte persistida e retry precisam reconstruir TIF e expiry; snapshot novo inclui TIF. Payload antigo com prazo não pode usar fallback não autenticado. Sem mudar ABI/schema ou desabilitar verificação on-chain.

Tarefas por camada, máximo5 arquivos de produção cada: backend auth.ts/routes/orders.ts/services/settlementService.ts/services/tradeService.ts/utils/validation.ts + testes; frontend utils/signing.ts/context/SpotContext.tsx/services/spotService.ts + testes; SDK spot-utils.ts/modules/orders.ts + golden/tests; MCP src/index.ts + documentação/testes. Atualizar contrato público e exemplos. Verificar vetores iguais entre clientes, tamper de TIF/expiry rejeitado401 sem consumir ordem, decimais equivalentes liquidam e legado básico continua aceito. Manter matriz atual isolada na API compilada até terminar; reiniciar somente depois de gates da alteração.

## F17 — Unidades visuais do book

Chromium no par LUNES/QUSD mostrou Price(USDT) no book e turno24h em USDT; os labels são hardcoded. Em frontend components/spot/OrderBook/index.tsx, PriceHeader/index.tsx e PriceHeader/formatters.ts, usar símbolos do par selecionado. Turnover deve usar quoteVolume24h retornado pela API (soma efetiva), sem estimar volume*último preço. Valores positivos abaixo de1 não devem ser exibidos como0 no resumo. Verificação visual em QAX/QUSD e LUNES/QUSD durante o fluxo final; não alterar matching/fees ou inventar conversão FX.

## F18 — Lado e fee do próprio usuário no histórico

Prova Chromium de10QAX liquidou vendedor19,98/comprador20,05 corretamente, mas Trade History de Eve(vendedora maker) mostrouBuy e Ferdie(taker)exibiu fee maker0,02 emvez0,05. OrderHistory determina maker a partir de makerFee diferente de0, sem usar walletAddress; side é sempre o lado do taker. Em components/spot/OrderHistory/index.tsx, comparar carteira com makerAddress, inverter side para maker e usar fee correspondente. Dependência do memo inclui walletAddress para não reaproveitar identidade anterior. Regressão em OrderHistory/index.test.tsx renderiza as duas carteiras e confere Sell/0,0200 e Buy/0,0500. Repetir leitura do histórico real sem novo trade. Não alterar fees backend/settlement.

## F19 — Saldo insuficiente como rejeição de ordem

Negativas reais de SELL QAX, BUY QUSD e SELL LUNES sem saldo suficiente foram barradas antes de criar trade, mas retornaram500/INTERNAL_ERROR. É uma rejeição de negócio. Em services/orderService.ts, lançar ApiError.badRequest nos dois checks de insuficiência base/quote, preservando cálculo, assinatura, nonce e verificação on-chain. Regressão parametrizada em orderService.test.ts exige400 e nenhuma persistência/matching. Repetir as3 requisições assinadas e conferir saldos inalterados. Arquivos de produção: somente orderService.ts.
