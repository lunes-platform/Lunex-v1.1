# QA — liquidez assimétrica/híbrida e Spot

Status: rodada de análise, correções e testes concluída em2026-10-18. Spot aprovado nos cenários executados; protocolo assimétrico/híbrido não atende a proposta financeira. Ambiente preservado da rodada anterior, detalhado em `../local-browser-qa-v1/QA.md`.

## Registro de evidências

Evidências abaixo distinguem o protótipo assimétrico dos trades Spot liquidados no vault real.

## Análise matemática inicial

Matriz de 540 cenários: gamma 1..5, fees 0/30/100/1000 bps, volumes iniciais/intermediários/próximos da capacidade e entradas mínimas até acima de x0. Referência independente com Decimal de 70 dígitos versus a aritmética inteira atual do contrato. Artefatos: `/private/tmp/lunex-asymmetric-math.py`, `lunex-asymmetric-math-results.json` e `.csv`.

Com k=1000, x0=10000, gamma=3, volume=0:

- Entrada 10: saída com fee zero = 2,998; com fee 100 bps = 3,098. O desconto da fee em y vira aumento na diferença y(antes)-y(depois).
- Entrada de uma unidade normalizada bruta (1e-12): saída inteira calculada = 0,003; referência contínua ≈ 3,03e-13. A escala fracionária de 1e6 introduz salto discreto no primeiro microtrade.
- Entrada acima da capacidade recebe cotação positiva de todo k, embora o swap imponha rejeições.
- Curva contínua apresentou impacto de preço não zero; a continuidade não justifica `priceImpactBps: 0`.

Esses resultados foram reproduzidos no contrato on-chain isolado, conforme a seção de prova abaixo. Não demonstram transferência de ativos reais nem garantem que a fórmula econômica pretendida esteja definida como equação de preço.

## Compilação

Build AsymmetricPair atual aprovado após compatibilidade de lint das macros ink4 com cargo-contract5; WASM otimizado de aproximadamente 13,7 KB. Testes ink do módulo: 7 aprovados. A mudança de compatibilidade não altera parâmetros, matemática ou ABI.

## Comparação com a proposta

| Item | Implementação observada | Conclusão |
|---|---|---|
| gamma 1..5 | Inteiro validado no construtor e updates | Faixa V1 implementada; concentração não garante impacto zero |
| k / depósito | `deploy_liquidity` grava números | Não representa depósito real de PSP22 |
| x0 / capacidade | Swap rejeita excesso, query não aplica as mesmas condições | Quote não garante execução |
| t / fee | `y` desconta fee, output usa diferença de y | Aumentar fee aumenta saída calculada |
| Fração em ponto fixo | Escala 1e6 para curvas em unidades 1e12 | Microentradas produzem saltos de arredondamento |
| L, c, r | UI simula; contrato simplifica para k | Alavancagem/juros completos são non-goals explícitos da V1 |
| Custody / entrega | Swap não chama tokens | Não há negociação financeira assimétrica executada |
| Proteção de derrapagem | Método on-chain não recebe mínimo de saída/deadline; router declara impacto zero | Objetivo não comprovado nem enforçado ponta a ponta |
| Router híbrido | AMM com 997/1000 e reservas opcionais do banco; execução AMM não implementada; assimétrico retorna intenção | Não equivale a execução ótima entre três fontes de liquidez reais |
| Templates | Seleção não copia k e deploy divide sell k por dois | Parâmetros de template, gráfico e contrato podem divergir; reprodução UI em andamento |

## Prova on-chain assimétrica

Contrato isolado `5F7X4RJqd9DEh542Vu21fqTcmFnRa45j4KUPTmXnEydMXPdZ`, code hash `0x9899949e53985b1e00c024410675a1e0e2a94f4420eb0991b9ba63c675b526a8`. Fonte atual recompilada.

- Deploy: tx `0xcecb09c1df1f1c4635cf012400d11bb633a2e7c4f87580c907f69e64610d4384`.
- `deploy_liquidity(1000,500)`: tx `0x1677da6877a1f3a2d42d96379f4db5146c1ada2bb7383502fbd248ab701117f4`; saldos PSP22 do owner, Bob e contrato inalterados; contrato com zero dos dois tokens.
- Bob executou swap de 10 unidades normalizadas: tx `0x0efa6140b9957df6f8c32e9951b17674ffa36180b276a80b452b8a21f2c6bd6b`. Volume passou para 10; cotação 3,028; todos os saldos PSP22 permaneceram iguais. Bob continuou com zero WLUNES e 47,700482 LUSDT.
- Query de uma unidade bruta retornou 3.000.000.000 unidades brutas (0,003), confirmando o salto de arredondamento.
- Query de 10001 unidades retornou k inteiro; dry-run do swap retornou `InsufficientLiquidity`.
- Após volume 10, cotação de nova entrada 10: fee zero → 2,991; fee 100 bps → 3,091.
- Manager Bob foi impedido de usar gamma 4 fora do guardrail 1..3; gamma 2 autorizado no dry-run.
- Saque acima de k retornou `Ok(())` no dry-run por subtração saturada; não demonstra retirada real de tokens.

Artefatos: `/private/tmp/lunex-asymmetric-chain-qa.cjs`, `lunex-asymmetric-chain.log`, `lunex-asymmetric-chain-results.json`. Os testes caracterizam defeitos do protótipo; não aprovam o protocolo financeiro para execução.

## Ambiente de QA adicional

Banco `lunex_qa_spot_20261017` criado e todas as migrations aplicadas. API em 4100/4101, frontend em 3100; health confirma DB/Redis conectados. Configuração temporária em `/private/tmp/lunex-advanced-qa.env` com permissão 0600, Redis DB9 e hash oficial assimétrico configurado. Contrato SpotSettlement atual recompilado; vault, pares e depósitos de QA preparados e usados nas provas abaixo.

## Correções e provas da rodada avançada

- F2: signer agora recebe bytes UTF-8 codificados em hexadecimal, preservando validação sr25519. Regressão Unicode/newline e registro pelo Chromium passaram.
- F3: template Stablecoin Range aplica k=5000 nas duas curvas; preview, modal e deploy iguais. Contrato Bob `5GYZ255U3qDFRYcnBxpFkGJ5EzNwr42Jaemi9ABrnSs7aATw`, tx de configuração `0x3c7395332b5b8dea648448cdaabe7de91488a8a2e781e8920d91564353c0323f`. Readback: k=5e15 bruto, gamma5, x0=2000e12, fee10bps nos dois lados. Registro HTTP201, estratégia `e9085d3e-3192-4179-83df-829d310604b4`. Cinco testes frontend F2/F3 aprovados. A designação stablecoin não impõe peg/range0,99–1,01 no contrato.
- F4: Eve conseguia registrar contrato de Alice com assinatura própria válida. Após validação de owner via RPC, repetição retorna403; sete testes do verifier +cinco de rotas aprovados. Sem bypass de assinatura/code hash. O registro inválido criado antes da correção é fixture isolada de QA.
- F5: saldo/nonce on-chain estavam encapsulados em MessageResult; a primeira venda falhou500 ao converter `{ok:50000000000}` para BigInt. Parser estrito corrigido;11 regressões aprovadas. Venda com fundos reais passou a ser aceita e liquidada.
- F6: trade1QAX8dec@2QUSD6dec inicialmente debitou200,5QUSD e creditou199,8QUSD. Prova negativa tx `0x2d4f1203d597b668fbb134a79b970074cadec6bb8894b450f5861eae471bb9a8`; saldos preservados como evidência, sem reset. Corrigida conversão de humanPrice para `priceRaw=price*10^(8+quoteDecimals-baseDecimals)`, inclusive limites assinados. Snapshot legado sem quoteDecimals falha fechado. Repetição: comprador paga2,005QUSD, vendedor recebe1,998QUSD; tx `0x4436cc68727306499c4ef8776e357e6091832f120e3956dead4f5d8232ae9248`, trade `87104b15-efc9-4491-a8ef-0af103606f6d`, SETTLED. Conjunto conversão/gas/attestor/pipeline26/26 aprovado; build API aprovado.

Artefatos temporários: `lunex-asymmetric-browser-results.json`, `lunex-asymmetric-ui-readback.json`, `lunex-asymmetric-owner-results.json`, `lunex-spot-live-smoke-codec-red.json`, `lunex-spot-live-smoke-price-red.json`, `lunex-spot-live-smoke-results.json` em `/private/tmp/`.

## Spot — matriz em execução

Pares QAX/QUSD(base8/quote6) e LUNES/QUSD(nativo8/quote6) registrados via admin autenticado, conferidos na Factory. Vault novo `5D4xv6SAZ6hgjhRu21MyLDZE7nHk4n47CMXWs174TqjijbPS`, settlement habilitado e verificação de assinatura on-chain ativa. Eve/Ferdie possuem depósitos reais de QA. A matriz aguarda status final de settlement antes de comparar deltas de vault e fees com referência independente Decimal80; FILLED isolado não é aprovação financeira. Primeira tentativa interrompida para corrigir uma espera insuficiente no harness (SETTLING não é falha do produto).

### Primeira matriz válida: 12/23 aprovados

Resultados completos preservados em `/private/tmp/lunex-spot-matrix-red.json`. Passaram abertura/cancelamento/auth, partial/full LIMIT, prioridade de preço, MARKET SELL, FOK com profundidade, STOP SELL, STOP_LIMIT BUY/SELL, cancelpending, replay/tamper, histórico assinado e par nativo. Falharam prioridade temporal/marketpartial por nonce outdated; MARKET/STOP BUY por limite0; IOC/FOK parcial; criação expirada; dust decimal; balances sem vault; WS sem update. São defeitos reais com settlement final aguardado pelo harness. Trades FAILED de QA tiveram retry agendado removido para não interferir em cenários posteriores; registros e estados on-chain preservados.

### Matriz corrigida: 23/23 aprovados

Todos os23 cenários passaram em repetição serial, com settlement final e conservação de vault/fees. Evidência completa `/private/tmp/lunex-spot-matrix-green.json`. Inclui prioridade preço/tempo, limite parcial/total, MARKET BUY em2 níveis, MARKET SELL/parcial, IOC parcial/sem match, FOK insuficiente sem trades/FOK completo, STOP BUY/SELL, STOP_LIMIT BUY/SELL, cancelpending, assinatura/replay, expiração passada400, decimal0,1+0,2=0,3 sem sobra, balances reais, histórico assinado sem secrets, publicaçãoWS e LUNES/QUSD nativo. Não comprova atomicidade on-chain entre vários fills de uma FOK, nem valida a economia assimétrica.

Frontend: suíte completa89/89 em18 arquivos aprovada. API:468 passaram e1 falhou de469 na primeira suíte completa avançada; falha era fixture de gas do manager sem result e com endereço inválido, ajustada para MessageResult None realista. Repetição do teste/gate ainda pendente. Builds e quality API aprovados; quality frontend encontrou dois imports unused e alias utils detectado como dependência: corrigidos, repetição pendente. Novos testes de termos assinados em preparação F16; gates finais serão repetidos após a mudança de assinatura.

### Manager e assinatura

Readback real repetido após indisponibilidade transitória do PostgreSQL: HTTP200, liveState.managerAddress=null igual ao RPC; k5000/gamma5/x02000/fee10 nos dois lados. F7 aprovado. A primeira tentativa HTTP500 foi indisponibilidade de DB, sem mudança de delegação.

F16 reproduziu4 regressões: mensagens iguais ao alterar IOC/FOK ou remover/estender expiry; valor1.00 não reconstrói1 persistido. Backend corrigido passou19/19 nos testes de termos, assinatura de settlement, gas e rota de ordens. Frontend passou2/2 com vetor canônico v2; SDK4/4 e build aprovados. MCP e prova real de tamper/settlement da mensagem nova pendentes.

## Resultado final

| Verificação | Resultado |
|---|---|
| Matriz Spot com assinatura v2 | 27/27 aprovados; deltas reais do vault e fees conferidos |
| Rejeição de ordens sem saldo | 3/3 aprovadas: SELL QAX, BUY QUSD, SELL LUNES →400; zero trades e saldos iguais |
| Navegador com Eve e Ferdie | Criar/cancelar, book atualizado no outro cliente, click no preço, venda LIMIT + compra MARKET e históricos assinados aprovados |
| Trade do navegador | 10QAX a2QUSD; vendedor recebe19,98QUSD; comprador paga20,05QUSD; fees0,07QUSD |
| Mobile390×844 | Sem overflow horizontal; botão de ordem alcançável por rolagem (y757,5,h44) |
| Saque/redepósito Spot | 1QAX e0,1LUNES;5extrinsics finalizadas, custódia restaurada;5negativas de saque rejeitadas |
| API | 475/475 testes em60 suítes; build e quality aprovados |
| Frontend | 91/91 testes em20 arquivos;8 checks finais dos componentes; build e quality aprovados |
| SDK / MCP | SDK4/4, MCP6/6; builds e quality aprovados |
| Rust | Rodada inicial:349 aprovados/8ignorados; módulo assimétrico avançado7/7 e buildWASM aprovados |

Trade Chromium `29f75e91-2abd-42d7-86ce-1040bde5b744`, tx `0xa3d152b6ff16f86200ea01902a0a279d5f5b4fd59ca2020df1a5280c4505119e`. Vendedor e comprador conferidos no RPC e histórico privado. A prova encontrou F18: o histórico usava o lado do taker para o maker e selecionava makerFee para ambos. Corrigido por identidade da carteira; leitura real repetida sem novo trade mostra Eve=Sell/0,0200 e Ferdie=Buy/0,0500. F15 também ganhou guard no gráfico para não pedir `/candles/` antes do catálogo fornecer um símbolo.

Saque PSP22: `0x37a347393e43251c5aa917632bd807d397e78259e4aa0352a74552fba30898e5`; redepósito `0xe6aedbedc0dfc4b0905df44119dcd2a1c58c6dd3e0918ec65566117050d94c93`. Saque nativo: `0x39ab811fa5b609aa7197c22b0380ee3c54645112ffa7d5ebd1d7d8aaf48493c6`; redepósito `0x3b544fae793b52fe8f375c73687a39e4bec1033d6cae44539aabba14fe153234`. Aprovação PSP22 consumida integralmente no redepósito. Total de holdings do contrato e ledger do usuário retornaram aos valores anteriores; o usuário pagou as taxas de rede separadamente.

F19: as3 ordens sem saldo eram barradas, mas com500; passaram a retornar400/BAD_REQUEST antes de persistir ordem ou trade. Assinatura/nonce e cálculo de saldo mantidos. Duas regressões adicionais na API cobrem BUY/SELL. A mesma correção foi carregada nas APIs locais.

### Evidências persistidas no repositório

- [Gates](evidence/gates.json)
- [27 cenários Spot e transações](evidence/spot-matrix-v2.json)
- [Negativas de saldo e conservação](evidence/spot-insufficient.json)
- [Navegador, fees e mobile](evidence/spot-browser.json)
- [Custódia: saques, redepósitos e rejeições](evidence/spot-vault.json)
- [Parâmetros assimétricos: RPC versus API](evidence/asymmetric-readback.json)

Scripts e logs completos ficam em `/private/tmp/lunex-*`; as evidências resumidas acima preservam os resultados sem depender da duração desses arquivos temporários.

## Conclusão sobre a proposta híbrida

**A implementação atual não comprova a redução de derrapagem pretendida e não executa liquidez assimétrica financeira.** As transferências PSP22 ausentes, o sinal da fee no output, os saltos de precisão e a divergência entre quote e capacidade foram demonstrados. Os parâmetrosgamma/k/x0/fee selecionados na UI agora coincidem com o contrato; isso não transforma a curva em um mercado com custódia, peg ou entrega de ativos.

O backend híbrido ainda anuncia impacto assimétrico zero, usa997/1000 no cálculo AMM enquanto Pair cobra995/1000 e não implementa a execução AMM nessa rota. A intenção assimétrica também não corresponde ao método/argumentos on-chain e não impõe mínimo de saída ou deadline. São lacunas de protocolo/integração registradas pela auditoria; uma implementação financeira exige SPEC econômica e de custódia própria. Não foi inventada uma equação nova nesta rodada.

As provas Spot verificam o book e a liquidação por fill. FOK garante matching integral no banco, mas seus vários fills são extrinsics separadas: não há atomicidade financeira global da ordem. Reservas off-chain não bloqueiam um saque externo do usuário no vault. Não foi demonstrada uma garantia de liquidação para ordens invalidadas por saque externo ou concorrência entre pares. Essas fronteiras precisam ser consideradas antes de tratar o sistema como pronto para produção.

## Estado local e rastreabilidade

- Nó Lunes permanece ativo em9944/9933; cadeia e dados preservados.
- Ambiente financeiro de QA: frontend `http://127.0.0.1:3100`, API4100/WS4101, banco próprio e assinatura on-chain habilitada.
- Frontend original3000 e preview3030 ativos. API principal4000/4001 atualizada com `SETTLEMENT_ENABLED=false` explícito para preservar os retries históricos sem executá-los.
- PostgreSQL/Redis e health das duas APIs verificados; nenhum deploy público, commit ou push.
- `git diff --check` aprovado. Alterações prévias do usuário preservadas.
- Clippy estrito mantém os bloqueios anteriores documentados na rodada inicial; warnings de bundlingPolkadot/tamanho de chunks não impediram o build.
- Contexto e resultados registrados no ai-memory, projeto `lunes-platform/Lunex-v1.1`.
