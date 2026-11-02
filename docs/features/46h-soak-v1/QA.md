# QA — execução contínua de 46 horas

Status: canário aprovado; janela46h iniciada em2026-10-18T20:21:36.576Z, deadline2026-10-20T18:21:36.576Z. EmBrasília:18/10 às17:21:36 →20/10 às15:21:36. A execução longa está em andamento; não há resultado de46h concluídas.

## Ambiente conferido

- Run persistente: `/Users/lucas/.local/state/lunex-soak/run-20261018`.
- NóDevelopment107, decimals8, genesis `0x8fca3505cdb04ad26b28d9429fcefc9cab9a3687c2919ac8b97e7184b12ab192`.
- Banco `lunex_soak_20261018`, migrations aprovadas, Prisma4conexões por processo; RedisDB10 estava vazio antes de começar.
- Frontend3200, API4200/WS4201 realmente vinculados a127.0.0.1. SupervisorLaunchAgent ativo; health confirma API/DB/Redis/nó e avanço da finalização.
- Snapshotfrontend compilou em28,45s; cópias da API/ABIs/scripts e hashes no manifesto. WarningsRollupPolkadot/chunks não impediram build.
-14testes do controlador aprovados, incluindo CLIstart/stop e rejeição de renovação da deadline; syntaxcheck de todos os scripts e plutil doLaunchAgent aprovados. Nenhuma nova mudança de produto; gates anteriores em `../asymmetric-spot-qa-v1/QA.md`.

## Fundos reais de desenvolvimento

Vault `5GauK8wwAkST5Ngh7s4xsWUszKuSY6Spr9VdHXqM44Eb5g9o`, assinaturas on-chain obrigatórias e relayer/attestor próprios. BASE8dec `5CJUWWXAbw1vXbSd71YZPPsguNSknfaBbJjAwzmUf1bYT3kG`; USD6dec `5EW9jmNiYoRoXv4Pvb8AsCx1AgVPnEUrCoGkvdwi944fAvjz`.

PoolBASE/USD `5Gf68q2bUqVZALrtAT1PML1oYkZedLfdZTtwT78BLZtG7aZM`,100MBASE/200MUSD. Poolnativo próprio criado para os swaps pelo Chromium. Fundingreadback confirmou para cada um dos4traders: wallet5MBASE/20MUSD; vault10MBASE/100MUSD/1LUNES; gas inicialmente1000LUNES. Supply sintético sem valor externo. Sete carteiras aleatórias; chaves fora do Git e dos relatórios.

## Canário

Matriz serial planejada:13receitas de book; swap nos2sentidos; wrap/unwrap; saque/redepósito PSP22 e nativo; add/removeLP; leituras públicas/privadas; HTTP/WS contínuos; criar/cancelar e swap real por UI; desktop/mobile. Sucesso exige finalização e deltas/fees/custody conferidos. Evidências locais: `events.jsonl`, `canary.json`, `browser-latest.json`, `funding-readback.json` e screenshots.

| Gate do canário | Resultado |
|---|---|
|13receitas de book|Aprovadas,49ordens e23tradesSETTLED com conservação de ledger/custody/fees|
|Negativas|5rejeições esperadas: replay, tamper deTIF, expiry, saldo insuficiente, cancelamento por outra carteira|
|SwapsAMM|2sentidos finalizados, deltas/reservas/produto e fee995/1000 conferidos|
|Wrap/unwrap|Ciclo0,1LUNES aprovado|
|Vault|5extrinsics: saque/redepósito100BASE e0,1LUNES, holdings eledger restaurados|
|LP|2ciclos de add/remove; verificação adicional exata de `LP*holding/totalSupply`, saldos do usuário e do pool aprovada às20:18:49Z|
|Navegador|Criar/cancelar1000BASE, swap nativo0,01LUNES com saída exata19894rawUSD, finalização e dispatchsuccess; desktop/mobile aprovados|
|HTTP/WS|Leituras públicas/privadas e streamdebook aprovados; zeroerrosHTTP/pageerror na rodadaChromium final|
|Supervisão|LaunchAgent reiniciado e API/frontend recuperados; nó originalPID8585 preservado; DB/Redis saudáveis|

SwapChromium aprovado: `0x70163385ce15bef8d4dea571d2dc54273d1c2a29e5a35a5a3268bd95a387ab2e`, bloco17754. O canário movimentou210580BASE e400620USD noSpot, exclusivamente sintéticos.

### Interrupções do harness e reconciliação

Quatro interrupções do testeChromium foram corrigidas: reconexãoSDK após navegação completa; assertion de texto contíguo do par; seletorPrice ambíguo; captura de hash por console que é desabilitado no buildproduction. As três primeiras pararam antes de enviar swap. Banco conferido com zeroordens abertas e zero trades pendentes; ordem de navegador existente estavaCANCELLED. Nenhum trade foi reenviado nem banco alterado para esconder falhas.

A quarta enviou swap antes da falha de coleta. Foi localizado no bloco finalizado16227, tx `0xc4cbbffd0d4dcdb22df667628c0d3b027c236eedaf341f8fd79e778d2dc3d5fa`; wallet e reservas tiveram deltas exatos de0,01LUNES/19898rawUSD. O estado histórico de eventos já estava podado após o intervalo de sessão; isso foi registrado como reconciliação econômica, sem declarar esse testeChromium aprovado. Captura mudou para o hash dos bytes efetivamente enviados em `author_submitAndWatchExtrinsic`; uma nova operação distinta foi validada com finalização, eventoExtrinsicSuccess e saída exata, conforme a tx17754 acima. Incidentes preservados em `canary-incidents.jsonl` e `reconciled-frontend-swap.json`.

Relatório final da janela será gerado automaticamente em `report.json`, com gaps e interrupções separados de sucesso financeiro. Contadores da janela descontam setup/canário; snapshots dos serviços/scripts estão fixados no manifesto. A deadline não foi alterada durante a preparação: foi criada apenas após todos os gates.

## Primeira verificação da janela ativa

Em2026-10-18T20:30:45Z:7ciclos completos,12tradesSpotSETTLED e7swaps verificados,27ordens criadas e3canceladas; nenhum bloqueio financeiro. NotionalSpot94520BASE/200300USD sintéticos, inputsAMM22000BASE e30000USD. HTTP171leituras contínuas200,31framesbook e8lotes de leituras assinadas; healthfrontend/API/DB/Redis/nó aprovado. NovoSTOPSELL em execução no momento do snapshot.

SupervisorPID60323 comPPID1; API60324, worker60473 e caffeinate60472 filhos do supervisor. RSSaproximado:67MB supervisor,165MBAPI,143MBworker,326MBnó compartilhado; prioridade baixa e heaps limitados. Não depende de sessão do terminal/Codex. Os resultados podem evoluir após o snapshot.

Evidências públicas: [início da janela](evidence/startup.json), [canário](evidence/canary.json), [funding](evidence/funding-readback.json), [navegador](evidence/browser-latest.json), [resgate exatoLP](evidence/liquidity-precise.json). Logs completos, journal e relatório automático permanecem no diretório privado do run. Chaves/seeds/env não foram copiados para as evidências.

Rastreabilidade: PRD/SPEC/TASKS criados antes dos scripts; alterações restritas ao harness/documentação e configuração localLaunchAgent. Frontend/backend/contratos de produção não foram alterados nesta feature. Nenhum commit, push ou deploy externo. Gates anteriores da aplicação preservados;14testes específicos do controlador e canário financeiro real cobrem esta mudança.

## Operação

Controles, recursos e limitações em [README](README.md). A máquina deve permanecer ligada/acordada; caffeinate evita idle sleep durante a janela. Em resultado financeiro incerto, o circuito bloqueia novos envios e preserva o journal, mantendo os serviços disponíveis.
