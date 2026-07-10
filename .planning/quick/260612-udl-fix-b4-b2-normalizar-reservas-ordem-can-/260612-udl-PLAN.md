---
phase: quick-260612-udl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lunes-dex-main/src/utils/reserveUtils.ts
  - lunes-dex-main/src/hooks/useLiquidity.tsx
  - lunes-dex-main/src/context/SDKContext.tsx
autonomous: true
requirements:
  - B4-pool-price-display
  - B2-price-impact-getquote
must_haves:
  truths:
    - 'Pool page "Price" exibe 1 WLUNES = ~1.063,39 LUSDT (não ~10,63)'
    - 'getQuote retorna price impact > 0% para swap que representa ~10% das reservas'
    - 'Em pares com decimais iguais o comportamento não muda'
  artifacts:
    - path: 'lunes-dex-main/src/utils/reserveUtils.ts'
      provides: 'Helper puro: normalizeReservesForPath + humanPrice'
      exports: ['normalizeReservesForPath', 'humanPrice']
    - path: 'lunes-dex-main/src/hooks/useLiquidity.tsx'
      provides: 'token0Price calculado com ajuste de decimais'
      contains: 'humanPrice'
    - path: 'lunes-dex-main/src/context/SDKContext.tsx'
      provides: 'reserveIn/reserveOut alinhados ao path[0]'
      contains: 'normalizeReservesForPath'
  key_links:
    - from: 'useLiquidity.tsx:refreshPoolInfo'
      to: 'reserveUtils.humanPrice'
      via: 'pairToken0 address + tokenA/tokenB decimals'
    - from: 'SDKContext.tsx:getQuote'
      to: 'reserveUtils.normalizeReservesForPath'
      via: 'contractService.getPairToken0(pairAddress)'
---

<objective>
Fix dois bugs de display financeiro no frontend lunes-dex-main causados por reservas on-chain
não normalizadas:

- B4: Pool page mostra "1 WLUNES = 10.633919 LUSDT" quando o preço real é 1.063,39 — ratio
  calculado sobre valores raw sem ajuste de decimais (fator 10^(8-6)=100 ausente).
- B2: getQuote exibe price impact 0,00% para swaps grandes porque reserve0/reserve1 são usados
  como reserveIn/reserveOut sem verificar qual token é token_0 no par canônico.

Solução: um helper puro `reserveUtils.ts` encapsula ambos os ajustes; os dois callsites
consomem o helper sem mudar mais nada.

Purpose: Corrigir display financeiro enganoso antes do mainnet — price impact errado causa
rejeição silenciosa pelo contrato (PriceImpactTooHigh) sem aviso ao usuário.

Output: reserveUtils.ts (novo), useLiquidity.tsx e SDKContext.tsx (cirúrgicos).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@lunes-dex-main/src/services/contractService.ts
@lunes-dex-main/src/hooks/useLiquidity.tsx
@lunes-dex-main/src/context/SDKContext.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Criar reserveUtils.ts — helper puro de normalização</name>
  <files>lunes-dex-main/src/utils/reserveUtils.ts</files>
  <action>
Criar `lunes-dex-main/src/utils/reserveUtils.ts` com duas funções exportadas puras
(sem efeitos colaterais, sem imports de runtime — apenas lógica):

**`normalizeReservesForPath`**

Assinatura:
  normalizeReservesForPath(
    pairToken0: string,
    pathToken0: string,
    reserve0Raw: string,
    reserve1Raw: string
  ): { reserveIn: bigint; reserveOut: bigint }

Semântica: `reserve0`/`reserve1` vêm do contrato em ordem canônica (token_0 < token_1).
`pathToken0` é o token de entrada do swap (path[0]).
Se `pathToken0 === pairToken0` (comparação case-insensitive `.toLowerCase()`): reserveIn=reserve0, reserveOut=reserve1.
Senão: reserveIn=reserve1, reserveOut=reserve0 (path[0] é o token_1 canônico).
Retorna bigints — nunca strings.

**`humanPrice`**

Assinatura:
  humanPrice(
    pairToken0: string,
    displayToken: string,
    reserve0Raw: string,
    reserve1Raw: string,
    decimals0: number,
    decimals1: number
  ): number

Semântica: retorna o preço de 1 unidade humana de `displayToken` expresso na outra unidade.
`decimals0`/`decimals1` são os decimais do token_0 e token_1 canônicos do par.
`displayToken` é o token cujo preço queremos (ex.: tokenA selecionado na UI).

Lógica:
  const isDisplayToken0 = displayToken.toLowerCase() === pairToken0.toLowerCase()
  if (isDisplayToken0):
    // preço de 1 token_0 em token_1 = (reserve1_human / reserve0_human)
    // = (reserve1 / 10^decimals1) / (reserve0 / 10^decimals0)
    // = (reserve1 * 10^decimals0) / (reserve0 * 10^decimals1)
    numerator   = BigInt(reserve1Raw) * BigInt(10 ** decimals0)
    denominator = BigInt(reserve0Raw) * BigInt(10 ** decimals1)
  else:
    // preço de 1 token_1 em token_0
    numerator   = BigInt(reserve0Raw) * BigInt(10 ** decimals1)
    denominator = BigInt(reserve1Raw) * BigInt(10 ** decimals0)

  return denominator === 0n ? 0 : Number(numerator) / Number(denominator)

Prevenção de overflow: os valores raw de reservas são no máximo ~10^18 (u128 ink!) e
10^decimals é no máximo 10^18 — portanto Number() de um bigint de até ~10^36 pode perder
precisão. Para evitar, antes de converter dividir numerator/denominator em bigint com
escala intermediária de 10^9 para manter 9 casas decimais:

  const SCALE = BigInt(1_000_000_000) // 9 casas decimais
  const scaledNum = (BigInt(reserve1Raw) * BigInt(10 ** decimals0) * SCALE) /
                    (BigInt(reserve0Raw) * BigInt(10 ** decimals1))
  return Number(scaledNum) / 1e9

(Aplicar a mesma lógica para a branch "else".)

Não usar `any`. Não usar `Math.*` — apenas aritmética bigint. Usar single quotes,
trailing comma, 80 col (Prettier do projeto).
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main && npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo 0</automated>
  </verify>
  <done>
Arquivo existe com as duas funções exportadas. `npx tsc --noEmit` retorna 0 erros de TS.
Teste mental: par WLUNES(8dec)/LUSDT(6dec), reserve0=7679233508, reserve1=81660345758,
pairToken0=WLUNES_addr, displayToken=WLUNES_addr →
humanPrice = (81660345758 * 10^8 * 1e9) / (7679233508 * 10^6) / 1e9
           = 81660345758 * 100 / 7679233508 = ~1063.39 ✓
  </done>
</task>

<task type="auto">
  <name>Task 2: Corrigir B4 — display "Price" em useLiquidity.tsx</name>
  <files>lunes-dex-main/src/hooks/useLiquidity.tsx</files>
  <action>
Alterar `refreshPoolInfo` em `useLiquidity.tsx` para:

1. Após obter `pairInfo`, chamar `sdk.getPairToken0(pairInfo.address)` para obter o
   endereço canônico do token_0 do par. `getPairToken0` já existe em `contractService.ts`
   (linha ~570) e está exposto no SDK via `SDKContext`.

   Verificar se `sdk.getPairToken0` está exposto em `SDKContext.tsx`. Se não estiver,
   adicionar o wrapper lá também (padrão igual aos outros — ver getPairInfo em ~linha 864).

2. Substituir o cálculo de `token0Price` e `token1Price` (linhas 93-98 atuais):

   Atual (ERRADO):
     token0Price = (Number(reserve1) / Number(reserve0)).toString()
     token1Price = (Number(reserve0) / Number(reserve1)).toString()

   Novo (com decimais):
     import { humanPrice } from '../utils/reserveUtils'
     ...
     const pairToken0 = await sdk.getPairToken0(pairInfo.address) ?? tokenA.address
     // decimals do token canônico token_0
     const decimals0 = pairToken0.toLowerCase() === tokenA.address.toLowerCase()
       ? tokenA.decimals
       : tokenB.decimals
     const decimals1 = pairToken0.toLowerCase() === tokenA.address.toLowerCase()
       ? tokenB.decimals
       : tokenA.decimals

     token0Price = humanPrice(
       pairToken0,
       tokenA.address,
       pairInfo.reserve0,
       pairInfo.reserve1,
       decimals0,
       decimals1,
     ).toString()
     token1Price = humanPrice(
       pairToken0,
       tokenB.address,
       pairInfo.reserve0,
       pairInfo.reserve1,
       decimals0,
       decimals1,
     ).toString()

3. `token0Price` e `token1Price` continuam sendo strings no `PoolInfo` — sem mudança
   de tipo ou de interface. O callsite em `pool/index.tsx:591` (`Number(...).toFixed(6)`)
   continua funcionando.

4. Não alterar nenhuma outra lógica de `useLiquidity.tsx` (amountB derivation,
   addLiquidity, removeLiquidity). Mudança cirúrgica apenas em `refreshPoolInfo`.

Convenções: single quotes, trailing comma, sem `any` novo. `await` novo dentro de
`try` já existente em `refreshPoolInfo`.
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main && npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo 0</automated>
  </verify>
  <done>
`npx tsc --noEmit` retorna 0 erros. `token0Price` no PoolInfo reflete o ratio ajustado
por decimais. Para par WLUNES(8)/LUSDT(6): display "Price" = ~1063.39, não ~10.63.
  </done>
</task>

<task type="auto">
  <name>Task 3: Corrigir B2 — price impact em getQuote (SDKContext.tsx)</name>
  <files>lunes-dex-main/src/context/SDKContext.tsx</files>
  <action>
Alterar `getQuote` em `SDKContext.tsx` (função interna, ~linhas 386-463) para alinhar
`reserveIn`/`reserveOut` à ordenação canônica do par antes de calcular o price impact.

Mudança cirúrgica dentro do bloco `if (pairInfo) { ... }` (~linhas 413-435):

1. Adicionar import no topo do arquivo:
   `import { normalizeReservesForPath } from '../utils/reserveUtils'`

2. Dentro do bloco `if (pairInfo)`, antes de usar `reserveIn`/`reserveOut`:
   - Obter o endereço do par: `contractService.getPairAddress(path[0], path[1])` —
     verificar se esse método existe; se não existir usar `contractService.getPair(path[0], path[1])`.
   - Chamar `contractService.getPairToken0(pairAddress)` para obter o token_0 canônico.
   - Chamar `normalizeReservesForPath(pairToken0, path[0], pairInfo.reserve0, pairInfo.reserve1)`
     para obter `{reserveIn, reserveOut}` alinhados ao path[0].

   Código substituído (linhas 414-415 atuais):
     const reserveIn = BigInt(pairInfo.reserve0)    // ERRADO — ignora ordem canônica
     const reserveOut = BigInt(pairInfo.reserve1)   // ERRADO

   Código novo:
     const pairAddress = await contractService.getPair(path[0], path[1])
     const pairToken0 = pairAddress
       ? (await contractService.getPairToken0(pairAddress)) ?? path[0]
       : path[0]
     const { reserveIn, reserveOut } = normalizeReservesForPath(
       pairToken0,
       path[0],
       pairInfo.reserve0,
       pairInfo.reserve1,
     )

3. Manter o restante do cálculo de impacto idêntico (linhas 416-434) — apenas
   `reserveIn`/`reserveOut` mudam de origem.

4. `getPair` e `getPairToken0` são métodos de `contractService` (objeto da classe
   `ContractService` já disponível no escopo de `getQuote` como `contractService` via
   closure). Não criar nova instância.

Verificação de fallback: se `getPairToken0` retornar null (erro de rede ou par não
encontrado), usar `path[0]` como fallback (comportamento atual — não piora o caso de erro).

Convenções: sem `any` novo, single quotes, trailing comma, 80 col.
  </action>
  <verify>
    <automated>cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main && npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo 0</automated>
  </verify>
  <done>
`npx tsc --noEmit` retorna 0 erros. Para swap onde path[0] é token_1 canônico do par,
`normalizeReservesForPath` inverte reserve0/reserve1 antes do cálculo, produzindo
price impact > 0% para swaps que representam parcela significativa das reservas.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Descrição |
|----------|-----------|
| chain → frontend | Valores de reservas raw vêm do contrato via RPC; decimais vêm de config local |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-udl-01 | Information Disclosure | humanPrice display | accept | Arredondamento de display (toFixed(6)) não afeta execução on-chain; valores reais verificados pelo contrato |
| T-udl-02 | Tampering | normalizeReservesForPath fallback | mitigate | Fallback usa path[0] como pairToken0 quando getPairToken0 falha — price impact pode ser subestimado; protegido pela validação on-chain (PriceImpactTooHigh no contrato) |
</threat_model>

<verification>
Após execução das 3 tasks:

1. `cd lunes-dex-main && npx tsc --noEmit` → 0 erros
2. Browser (manual): abrir página Pool com par WLUNES/LUSDT → "Price" exibe ~1063,39 LUSDT/WLUNES
3. Browser (manual): swap de 5 WLUNES → price impact exibe > 0% (condizente com ~7-10% das reservas)
4. Browser (manual): par com decimais iguais (ex.: dois tokens de 18 dec) → comportamento inalterado
</verification>

<success_criteria>
- reserveUtils.ts existe com `normalizeReservesForPath` e `humanPrice` exportadas
- `npx tsc --noEmit` passa com 0 erros em lunes-dex-main
- Pool page mostra preço ajustado por decimais (~1063,39 para par atual)
- getQuote retorna price impact > 0% para swap com input representando ~10% das reservas
- Nenhuma alteração fora dos 3 arquivos listados em files_modified
</success_criteria>

<output>
Criar `.planning/quick/260612-udl-fix-b4-b2-normalizar-reservas-ordem-can-/260612-udl-01-SUMMARY.md` ao concluir
</output>
