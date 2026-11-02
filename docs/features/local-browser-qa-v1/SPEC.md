# SPEC — QA local e correções verificadas

## Arquitetura estudada

- `lunes-dex-main`: React/Vite; `SDKContext` conecta carteira externa; `contractService` consulta/assina contratos ink! por Polkadot.js. Swap envia diretamente ao Router/WNative.
- `spot-api`: Express, autenticação sr25519, matching e orquestração; PostgreSQL/Prisma e Redis; WebSocket em 4001.
- `Lunex/contracts`: fonte autoritativa para AMM, transferências, staking e custody.
- Rede local: checkout existente de `lunes-nightly`, binário `4.0.0-dev-97440ba0fff`, runtime 107, portas 9944/9933; estado persistido em `/private/tmp/lunex-qa-lunes-20261017`.

## Baseline antes das alterações

62 testes frontend e 411 testes API passaram. Build da API passou. Identificadas alterações anteriores em 11 manifests de contratos e 3 arquivos Docker, preservadas. Gates existentes: frontend falha em Prettier (25 arquivos); API falha no export não utilizado `CopyRiskConfigSchema`.

## Correções previstas e fronteiras

1. `lunes-dex-main/src/pages/home/index.tsx`: invalidar cotações ao mudar input/tokens, ignorar respostas antigas e limpar output inválido; carregar WLUNES pela lista completa; preview de slippage igual ao mínimo enviado. Sem mudar o pricing autoritativo do Router.
2. `lunes-dex-main/src/context/SDKContext.tsx`: só publicar conexão da carteira depois de a blockchain e o saldo estarem prontos; falhar explicitamente se a RPC não conectar.
3. `lunes-dex-main/src/components/bases/input/index.tsx`: atributos HTML e eventos pertencem ao input; wrapper recebe apenas layout. IDs duplicados e eventos propagados prejudicam formulários e acessibilidade.
4. `spot-api/scripts/deploy-additional-tokens.ts`: conferir o saldo necessário de LUSDT antes de criar pools; completar déficit somente no wrapper de teste local identificado pelo deploy atual.
5. `spot-api/scripts/seedPairs.ts` e `lunes-dex-main/src/hooks/usePools.ts`: alinhar decimals de LETH local com o token de 8 casas implantado pelo script, preferindo metadata on-chain para os pools.
6. Higiene: reutilizar o schema de risco já existente em follow/deposit e torná-lo interno; formatar os 25 arquivos frontend previamente reprovados e os arquivos alterados, sem mudança de comportamento. Declarar no `spot-api/package.json` as dependências diretas já importadas (`@polkadot/types` 16.5.3, `@polkadot/wasm-crypto` 7.5.4 e `@noble/curves` 1.9.7 somente para testes), mantendo as versões já instaladas. O gate `depcheck` revelou essas ausências depois de resolver o export morto.
7. `lunes-dex-main/src/services/contractService.ts`: `getPair` deve decodificar `Ok(None)` como ausência de par. A reprodução LUNES/LBTC retornou `[object Object]` como endereço e erro de base58; validar o AccountId antes de construir o contrato.
8. `lunes-dex-main/src/hooks/useLiquidity.tsx`: representar as reservas de `poolInfo` na ordem selecionada A/B, pois o cálculo de aporte, os mínimos de remoção e a página usam essa ordem. A ordem canônica token0/token1 do contrato pode ser inversa. `pages/pool/index.tsx`: MAX deve formatar o saldo LP em unidades humanas antes de colocá-lo no input; o hook já converte esse input novamente para plancks.
9. Falha on-chain reproduzida pelo navegador com Bob: `add_liquidity_native` deposita WLUNES no Router, mas chama o fluxo PSP22 que tenta debitar WLUNES do usuário. Bob tem LUNES e LUSDT, zero WLUNES; o aporte reverte com `InsufficientBAmount`. Corrigir `Lunex/contracts/router/lib.rs`: calcular aporte proporcional, transferir o PSP22 do usuário, envolver apenas o nativo necessário, transferir WLUNES do próprio Router ao Pair e devolver excesso de LUNES ao usuário. Não exigir approval de WLUNES. Validar com conta sem WLUNES e confirmar saldo LP e deltas reais. Rebuild e novo deploy apenas do Router na rede local; manter Factory e pools.
10. `pages/protocolStats/index.tsx`: o simulador deve apresentar o split AMM existente no Pair (0,3% LP, 0,1% protocolo, 0,1% Trading Rewards). O texto atual 0,4/0,05/0,05 e a alegação de futura atualização on-chain divergem do código fonte. Corrigir os parâmetros de simulação e seus rótulos, mantendo-os explicitamente como projeções, sem alterar distribuição autoritativa.
11. `contractService.addLiquidityNative` deve recusar o envio quando o dry-run retorna erro do pallet ou `MessageResult<Result<...>>` com Err interno. Reprodução confirmou que o código só verificava o Err externo e enviava transações já destinadas a reverter, gastando gas. Teste garante que `tx.addLiquidityNative` não é chamado nesses casos.
12. Atualizar `useLiquidity.poolInfo` ao conectar/desconectar ou trocar a carteira. Reprodução no navegador: on-chain Bob tinha 7.897.953 unidades LP, mas a página aberta antes da conexão continuava mostrando zero. O efeito atual depende apenas dos tokens, portanto não atualiza posições ao conectar.
13. `src/config/contracts.ts`: remover acesso dinâmico `process.env[key]`; o Vite substitui apenas os acessos estáticos definidos no config. Bundle inspecionado tinha `var Vn={}; const Z=e=>Vn[e]||''` e todos os endereços de contratos/tokens vazios apesar do `.env` correto. Usar acessos explícitos às variáveis públicas e testar o transform de produção com esbuild, além de abrir o build via `vite preview` e verificar descoberta real dos pools.
14. O teste de produção revelou nomes `[object Object]` em LBTC/LETH/GMC/LUP. RPC confirmou que essas strings foram gravadas no contrato: o bootstrap enviava `{ some: string }`, enquanto o encoder Option<String> do SDK aceita diretamente string/null. `spot-api/scripts/deploy-additional-tokens.ts`: passar strings e validar nome/símbolo/decimals on-chain antes de criar/aportar no par. `hooks/usePools.ts`: para endereços presentes no registro local, usar nome/símbolo do registro; sempre usar decimals reais do contrato. Tokens desconhecidos mantêm seus metadados on-chain. Testar registro conhecido e token desconhecido, e validar o construtor corrigido na rede local sem substituir pools/saldos existentes. Os metadados imutáveis dos mocks antigos permanecem registrados como limitação do ambiente.

Cada item tem tarefa separada. Novas falhas devem ser documentadas aqui antes da correção.

Complemento do item 14: a busca pelo mesmo padrão encontrou `{ some: name }` também em `spot-api/scripts/deploy-tokens.ts`. Aplicar strings/null e verificação dos metadados antes de envolver/fundir tokens nesse segundo bootstrap, mantendo o mesmo comportamento e o limite de arquivos da tarefa.

Complemento do item 10: a inspeção visual do build encontrou `fee: '0.3%'` em `usePools.ts`, usado como taxa do pool. Exibir o total de 0,5% cobrado pelo Pair; manter a projeção LP `fees24h` em 0,3% do volume. Cobrir ambos em `usePools.test.tsx`; nenhuma mudança de taxa no contrato.

## Testes

Regressões React/jsdom para cotações, saldo WLUNES, estado de conexão e input. Navegador Chromium desktop/mobile com extensão de teste injetada que assina usando Bob e RPC local; sem bypass de contratos. Verificar saldos, LP e finalização. Executar testes frontend/API, build/quality dos módulos alterados e testes Rust disponíveis. Registrar quaisquer gates bloqueados e seus motivos.
