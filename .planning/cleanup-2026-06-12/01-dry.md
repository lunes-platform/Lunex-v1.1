# 01 — Deduplicação e Consolidação (DRY)

**Agente:** 1/8 (tema: DRY) · **Data:** 2026-06-12 · **Fase:** A (somente leitura)
**Escopo analisado:** spot-api, lunes-dex-main, lunex-admin, sdk, mcp/lunex-agent-mcp, subquery-node, scripts/ (407 arquivos TS/TSX, excluídos node_modules/dist/build/.next/target/artifacts/types/.planning/PATHFINDER/backups)

**Método:** hash normalizado de arquivos, extração de definições de função em 2+ arquivos, comparação byte-a-byte (whitespace-normalizado) dos corpos, verificação de wiring entre pacotes (não há npm workspaces — pacotes NÃO se referenciam via package.json).

**Guardrails respeitados:** nenhuma recomendação toca fallbackNonces (spot-api/src/middleware/auth.ts), #[cfg(not(test))] dos contratos, productionGuards, responseSanitizer, gating isFinalized, nem propõe unificar os dois schemas Prisma (deliberadamente duplicados/sincronizados).

---

## Resumo

| Confiança | Qtde |
|---|---|
| ALTA | 10 |
| MÉDIA | 8 |
| BAIXA | 4 |
| **Total** | **22** |

Ganho estimado total (ALTA apenas): **~350–420 linhas removidas** + eliminação de 3 pontos de drift já existentes.

---

## ALTA — seguras, sem mudança de comportamento, verificáveis por tsc/testes existentes

### A1. socialService duplica utils/signing.ts dentro do próprio lunes-dex-main
- **Arquivos:**
  - `lunes-dex-main/src/services/socialService.ts:311` (normalizeSignedValue) — duplica `lunes-dex-main/src/utils/signing.ts:33`
  - `lunes-dex-main/src/services/socialService.ts:333` (buildWalletActionMessage) — duplica `lunes-dex-main/src/utils/signing.ts:55`
  - `lunes-dex-main/src/services/socialService.ts:325` (createSignedActionMetadata) — duplica `lunes-dex-main/src/utils/signing.ts:47`
- **Evidência:** corpos byte-idênticos (diferem apenas em ponto-e-vírgula). Mesmo pacote, mesmo tsconfig.
- **Ação:** apagar as 3 cópias em socialService e importar de `../utils/signing`.
- **Risco:** mínimo. São funções de construção de mensagem de assinatura — manter o formato é trivial pois os corpos são idênticos. tsc + testes de assinatura existentes verificam.
- **Ganho:** ~45 linhas; elimina risco futuro de drift em código crítico de assinatura.

### A2. signedAuthHeaders definido 5× em lunes-dex-main/services
- **Arquivos:** `lunes-dex-main/src/services/strategyService.ts:94`, `marginService.ts:10`, `socialService.ts:603`, `rewardsService.ts:145`, `spotService.ts:142`
- **Evidência:** corpos idênticos (retornam os mesmos 3 headers `X-Lunex-Nonce/Timestamp/Signature`); única diferença é o tipo do parâmetro (inline vs alias `SignedReadAuth` — mesmo shape).
- **Ação:** mover uma única versão para `lunes-dex-main/src/utils/signing.ts` (arquivo já existe) e importar nos 5 services.
- **Risco:** mínimo; verificável por tsc.
- **Ganho:** ~45 linhas; um único ponto de verdade para o protocolo de headers assinados.

### A3. Base URL da API definida 6× com 6 nomes diferentes em lunes-dex-main
- **Arquivos:** `lunes-dex-main/src/services/agentService.ts:1` (API_BASE), `strategyService.ts:6` (API_BASE), `marginService.ts:1` (MARGIN_API_URL), `rewardsService.ts:6` (REWARDS_API_URL), `socialService.ts:8` (SOCIAL_API_URL), `spotService.ts:5` (SPOT_API_URL)
- **Evidência:** todas resolvem para exatamente `process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'`.
- **Ação:** exportar `SPOT_API_URL` de um único módulo (ex.: `src/config/api.ts` ou o próprio `utils/signing.ts`) e importar.
- **Risco:** zero (mesmo valor em todos). Os nomes diferentes hoje sugerem falsamente APIs distintas — consolidar AUMENTA clareza.
- **Ganho:** ~12 linhas + clareza significativa.

### A4. lunex-admin: readApiError copiado 3× byte-idêntico
- **Arquivos:** `lunex-admin/src/app/(admin)/listings/actions.ts:11`, `lunex-admin/src/app/(admin)/emergency/actions.ts:23`, `lunex-admin/src/app/(admin)/dex-users/actions.ts:10`
- **Evidência:** corpos 100% idênticos (verificado).
- **Ação:** mover para `lunex-admin/src/lib/` (ex.: `lib/api.ts`) e importar nas 3 actions.
- **Risco:** mínimo; tsc verifica.
- **Ganho:** ~30 linhas.

### A5. scripts/check_balances2.ts é cópia 91% de check_balances.ts
- **Arquivos:** `scripts/check_balances.ts` (36L) vs `scripts/check_balances2.ts` (34L)
- **Evidência:** diff de 4 linhas — check_balances2 só difere em (a) chamar `c.query['balanceOf']` em vez de `(c.query as any)['psp22::balanceOf']`, (b) `toJSON()` vs `toString()`, (c) endereço WLUNES a mais no v1.
- **Ação:** manter UM script (o que funciona contra a ABI atual), deletar o outro. Se ambos os seletores forem necessários, unificar com fallback de seletor.
- **Risco:** zero para produção (script de debug local, não referenciado por package.json/CI — confirmar referência antes de apagar).
- **Ganho:** ~34 linhas + remove a confusão "qual dos dois usar".

### A6. spot-api: hashApiKey reimplementado em agentService
- **Arquivos:** `spot-api/src/services/agentService.ts:65` duplica `spot-api/src/utils/copytrade.ts:125`
- **Evidência:** ambos `sha256(...).digest('hex')` — semanticamente idênticos (diferem só no nome do parâmetro e import `createHash` vs `crypto.createHash`).
- **Ação:** importar `hashApiKey` de `../utils/copytrade` em agentService (ou mover para um `utils/crypto.ts` neutro, já que o nome "copytrade" não descreve o uso por agents).
- **Risco:** mínimo — hashes idênticos garantidos; testes de agents/copytrade existentes cobrem.
- **Ganho:** ~5 linhas + um único ponto de verdade para o formato de hash de API key (crítico: dois formatos divergentes quebrariam autenticação).

### A7. spot-api: normalizeMethodKey idêntico em 3 services
- **Arquivos:** `spot-api/src/services/emergencyService.ts:20`, `spot-api/src/services/settlementService.ts:78`, `spot-api/src/services/rewardPayoutService.ts:33`
- **Evidência:** corpos byte-idênticos (3 linhas cada, verificado).
- **Ação:** extrair para `spot-api/src/utils/contractMethods.ts` e importar. (NÃO mover os `resolveMethodKey` junto — esses divergem de verdade entre services, ver M7.)
- **Risco:** mínimo; tsc + testes de settlement/emergency existentes.
- **Ganho:** ~8 linhas; prepara terreno para M7.

### A8. lunes-dex-main: helpers de avatar idênticos em TraderCard e Profile
- **Arquivos:** `lunes-dex-main/src/pages/social/components/TraderCard/index.tsx:317,327,336` (getInitials, isImageAvatar, getAvatarContent) duplicam `lunes-dex-main/src/pages/social/Profile/index.tsx:790,819,828`
- **Evidência:** getInitials byte-idêntico (verificado); demais mesma origem copy-paste.
- **Ação:** extrair para `lunes-dex-main/src/pages/social/utils/avatar.ts` (ou `src/utils/`).
- **Risco:** mínimo; UI pura, tsc verifica.
- **Ganho:** ~50 linhas.

### A9. mcp/lunex-agent-mcp: asObject e assertEnum duplicados entre index.ts e routerTools.ts
- **Arquivos:** `mcp/lunex-agent-mcp/src/index.ts:2017` (asObject) e `:2125` (assertEnum) duplicam `mcp/lunex-agent-mcp/src/routerTools.ts:11` e `:44`
- **Evidência:** corpos byte-idênticos (verificado). Mesmo pacote.
- **Ação:** exportar de routerTools.ts (ou novo `src/args.ts`) e importar em index.ts. ATENÇÃO: getRequiredString/getOptionalNumber/toQuery também estão duplicados mas com semântica DIFERENTE — ver M6; consolidar apenas os 2 idênticos nesta recomendação.
- **Risco:** mínimo para os 2 idênticos.
- **Ganho:** ~20 linhas.

### A10. asContractApi idêntico em 5 scripts/ + 1 service
- **Arquivos:** `scripts/verify-deployment.ts:23`, `scripts/deploy-lunes.ts:20`, `scripts/list-token.ts:17`, `scripts/admin-list-token.ts:17`, `scripts/deploy-asset-wrappers.ts:22` (e `spot-api/src/services/assetBridgeService.ts:56`)
- **Evidência:** 6 cópias byte-idênticas (verificado), 3 linhas cada; `asCodeApi` igualmente duplicado em `scripts/deploy-lunes.ts:24` e `scripts/deploy-asset-wrappers.ts:26`.
- **Ação:** criar `scripts/lib/contract-utils.ts` com asContractApi/asCodeApi e importar nos 5 scripts. Deixar a cópia do assetBridgeService como está (cross-package sem workspace — ver M2).
- **Risco:** mínimo (cast helpers de 3 linhas, idênticos).
- **Ganho:** ~15 linhas + ponto único para os futuros helpers de script (ver M1).

---

## MÉDIA — consolidações valiosas, mas exigem decisão/verificação além de tsc

### M1. spot-api/scripts: harness de deploy/QA copiado em 5–8 scripts (~250 linhas)
- **Arquivos (definições repetidas):**
  - `sendTx`: `spot-api/scripts/test-liquidity-pool.ts:61`, `setup-local-tokens.ts:42`, `generate-social-analytics-activity.ts:92`, `deploy-additional-tokens.ts:107`, `deploy-tokens.ts:59` — corpos ~idênticos (diferem só na string de log "— in block")
  - `makeGas`/`makeDryGas`: 6 e 5 cópias (mesmos arquivos + `deploy-contracts.ts:25`)
  - `query`: 5 cópias; `loadAbi`: 3 cópias (`test-liquidity-pool.ts:42`, `generate-social-analytics-activity.ts:27`, `qa-blockchain.ts:38`)
  - `ok/fail/log/section/warn/info`: 6–8 cópias (qa-*.ts, deploy-*.ts, simulate-*.ts)
  - `updateEnvFile`: `setup-local-tokens.ts:112`, `deploy-additional-tokens.ts:182`, `deploy-tokens.ts:138` (3 cópias quase iguais dentro de spot-api/scripts)
  - `get/post/del`: `simulate-volume.ts`, `simulate-all-modules.ts`, `qa-api.ts`, `qa-security.ts`
- **Ação:** criar `spot-api/scripts/_lib.ts` com {log helpers, makeGas, makeDryGas, sendTx, query, loadAbi, updateEnvFile, http helpers} e importar.
- **Por que MÉDIA e não ALTA:** scripts não têm testes; a verificação é execução manual contra chain local. As cópias têm micro-variações (mensagens de log, `isInBlock` vs `isFinalized` em alguns) que precisam ser reconciliadas conscientemente — NÃO padronizar o critério de finalização sem revisar caso a caso (guardrail isFinalized).
- **Ganho:** ~200–300 linhas; manutenção dos scripts deixa de exigir 6 edições paralelas.

### M2. Builders de mensagem de assinatura duplicados entre 4 pacotes (formato wire definido em 3+ lugares)
- **Arquivos:**
  - `buildSpotOrderSignMessage`: `lunes-dex-main/src/utils/signing.ts:1`, `sdk/src/spot-utils.ts:57`, `mcp/lunex-agent-mcp/src/index.ts:166` (+ verificação em `spot-api/src/middleware/auth.ts` via buildSpotOrderMessage)
  - `buildSpotCancelSignMessage`: `signing.ts:14`, `spot-utils.ts:70`, `mcp index.ts:179`
  - `buildAgentRegisterSignMessage`/`buildAgentCreateApiKeySignMessage`: `signing.ts:100,123`, `spot-utils.ts:206,229`
  - `normalizeSignedValue`: `spot-api/src/middleware/auth.ts:126`, `signing.ts:33`, `mcp index.ts:2143`
  - `generateNonce`: `spot-utils.ts:3`, `mcp index.ts:160`
- **Evidência:** formatos wire (`lunex-order:...`) idênticos hoje, mas JÁ HÁ drift leve: a versão do sdk normaliza `timestamp` via `normalizeWalletActionValue` e aceita `number | string`; as outras aceitam só `number`. Para timestamps numéricos a saída é igual — mas é exatamente assim que regressões de assinatura nascem.
- **Ação (curto prazo, segura):** criar teste de paridade "golden" no spot-api que fixa as strings esperadas (`lunex-order:PAIR:BUY:LIMIT:...`) — qualquer divergência futura quebra CI. **(médio prazo):** wiring npm workspaces e consumir `@lunex/sdk/spot-utils` como fonte única em lunes-dex-main e mcp.
- **Por que MÉDIA:** não há workspaces hoje (verificado nos package.json — nenhum pacote depende de outro); consolidar exige mudança de build/infra, fora do escopo "sem mudança de comportamento". NÃO tocar no lado verificador em `spot-api/src/middleware/auth.ts` (guardrail fallbackNonces no mesmo arquivo).
- **Ganho:** clareza/segurança >> linhas (~80 linhas no médio prazo); elimina a classe de bug "assinatura inválida por drift de formato".

### M3. AsymmetricClient: frontend embute cópia desatualizada do SDK
- **Arquivos:** `lunes-dex-main/src/sdk/AsymmetricClient.ts` (289L) vs `sdk/src/modules/asymmetric/AsymmetricClient.ts` (302L)
- **Evidência:** mesma classe/API (listStrategies, createStrategy, getStrategyStatus, updateCurve, toggleAutoRebalance, getRebalanceLogs), mas a cópia do frontend NÃO tem `simulateLiquidity` — drift confirmado.
- **Ação:** sincronizar a cópia do frontend com a do SDK agora (diff manual) e marcar com comentário `// VENDORED FROM sdk/src/modules/asymmetric — keep in sync`; médio prazo: consumir via workspace (junto com M2).
- **Risco:** médio — comportamento do frontend pode depender da versão antiga; exige diff cuidadoso antes de sincronizar.
- **Ganho:** elimina segundo ponto de drift ativo; ~290 linhas no médio prazo (workspace).

### M4. lunes-dex-main: fetchApi reimplementado 4× com tratamento de erro divergente
- **Arquivos:** `lunes-dex-main/src/services/marginService.ts:107`, `socialService.ts:277`, `rewardsService.ts:73`, `spotService.ts:295` (+ `apiRequest` em `strategyService.ts:79` e `agentService.ts:84`)
- **Evidência:** todas fazem fetch(`${BASE}${path}`) com Content-Type JSON; a do rewardsService é a mais robusta (checa content-type antes de `.json()`, inclui status na mensagem); as outras chamam `response.json()` incondicionalmente (quebram com corpo não-JSON, ex.: 502 de proxy).
- **Ação:** consolidar em `lunes-dex-main/src/services/httpClient.ts` adotando a variante robusta do rewardsService; manter mensagens de erro específicas por chamada via parâmetro.
- **Por que MÉDIA:** muda comportamento de erro de 3 services (para melhor, mas é mudança observável). Verificar testes de service existentes.
- **Ganho:** ~60 linhas + correção implícita de robustez.

### M5. Formatadores numéricos de UI copiados em 10+ páginas (admin + dex)
- **Arquivos:**
  - lunex-admin `fmt`: `app/(admin)/rewards/page.tsx:20`, `agents/page.tsx:20`, `copytrade/page.tsx:20`, `affiliates/page.tsx:20`, `margin/page.tsx:20`, `volume/page.tsx:19` — quase idênticos (volume adiciona tier "B" e usa 2 casas; rewards usa 4)
  - lunex-admin `formatNumber`: `dex-users/page.tsx:60`, `users/page.tsx:12`, `treasury/page.tsx:12`, `page.tsx:12`; `pct`: copytrade:28, margin:28
  - lunes-dex-main `formatVolume`: `components/spot/PairSelector/index.tsx:198`, `PriceHeader/index.tsx:125`, `PriceHeader/AnalyticsModal.tsx:198`, `PriceHeader/PairInfoModal.tsx:168`; `formatPrice`: 3 cópias; `fmtRoi`/`fmtUSD`: 3 cópias cada (strategies/Page.tsx:477, strategies/Detail.tsx:344, agent/index.tsx:427, protocolStats/index.tsx:350)
- **Ação:** um `lib/format.ts` POR pacote (não compartilhado entre pacotes): `fmt(n, {decimals, tiers})`. Parametrizar as variações reais (casas decimais, tier B).
- **Por que MÉDIA:** variações pequenas mas reais entre cópias — precisa decidir o default por call-site; risco apenas visual, sem testes cobrindo.
- **Ganho:** ~120 linhas somando os dois pacotes; consistência visual de números (hoje a mesma métrica formata diferente em páginas distintas).

### M6. mcp: getRequiredString/getOptionalNumber/toQuery duplicados com semântica divergente entre index.ts e routerTools.ts
- **Arquivos:** `mcp/lunex-agent-mcp/src/index.ts:2024,2037,2283` vs `mcp/lunex-agent-mcp/src/routerTools.ts:18,29,53`
- **Evidência (verificada):** routerTools valida mais (mensagem de erro detalhada; getOptionalNumber coage string→number e lança em NaN; toQuery aceita `''`); index.ts silenciosamente descarta números em string e filtra `''`.
- **Ação:** unificar adotando a semântica MAIS ESTRITA (routerTools) — mas isso muda comportamento de tools do MCP (inputs antes ignorados passam a ser aceitos/rejeitados). Revisar call-sites de index.ts antes.
- **Por que MÉDIA:** divergência é semântica, não cosmética; pode até ser bug latente (getOptionalNumber do index.ts ignora `"5"`), mas a correção precisa de teste dirigido.
- **Ganho:** ~30 linhas + comportamento consistente entre tools do MCP.

### M7. spot-api: bloco de conexão chain (WsProvider→ApiPromise→Keyring→ContractPromise) repetido em ~8 services
- **Arquivos:** `spot-api/src/services/settlementService.ts:215-230`, `rewardPayoutService.ts:119-134`, `emergencyService.ts:88-103`, + rebalancerService, copyVaultService, assetBridgeService, factoryService, socialIndexerService (todos com `new WsProvider(config.blockchain.wsUrl)` + `ApiPromise.create` + `Keyring sr25519` + `addFromUri(relayerSeed)`)
- **Evidência:** mesmo bloco de ~12 linhas com pequenas variações (endereço do contrato, método resolvido).
- **Ação:** helper `utils/chainConnection.ts`: `connectRelayerContract({contractAddress, metadata}) → {api, relayer, contract}`. Cada service mantém seu próprio lifecycle/disconnect e seus resolveMethodKey próprios (esses divergem de verdade — confirmado settlement≠emergency).
- **Por que MÉDIA:** services têm lifecycles e tratamento de reconexão sutilmente diferentes; consolidar o create é seguro, mas exige revisão de cada call-site + testes de integração. NÃO tocar em gating isFinalized/waitForFinalizedTx.
- **Ganho:** ~80 linhas + um lugar único para política de conexão (timeout, retry futuro).

### M8. spot-api: helpers numéricos decimal/planck espalhados (5 variantes em 7 lugares)
- **Arquivos:** `spot-api/src/utils/helpers.ts:36` (decimalToNumber, frágil — `val: any`) vs `services/copytradeService.ts:38` (decimalToNumber robusto com null-check); `services/orderService.ts:41` e `services/settlementService.ts:105` (decimalToUnits — comparar antes); `services/marginService.ts:135` (toDecimal); `services/socialService.ts:9` e `rewardDistributionService.ts:77` (toFloat)
- **Ação:** consolidar em `spot-api/src/utils/decimal.ts` adotando as variantes mais robustas; deixar `unitsToPlancks` de fora (ver B1).
- **Por que MÉDIA:** corpos divergem (robustez, tipos de retorno BigInt vs number); escolher a variante certa por call-site exige revisão; coberto parcialmente por testes de order/settlement.
- **Ganho:** ~40 linhas + remove a variante frágil `any` de helpers.ts.

---

## BAIXA — não recomendadas neste milestone (custo/risco > ganho)

### B1. unitsToPlancks: rebalancerService vs copyVaultService
- `spot-api/src/services/rebalancerService.ts:27` retorna `BigInt`; `copyVaultService.ts:34` retorna `BN` E valida positividade com mensagem própria de domínio. São contratos de tipo diferentes usados downstream. Unificar exigiria adaptadores que AUMENTAM complexidade. Deixar.

### B2. Fusão dos scripts de deploy raiz (deploy-lunes vs deploy-remaining vs deploy-listing vs deploy-asset-wrappers)
- Similaridade real baixa (0.02–0.24, medida). Propósitos distintos e documentados: deploy-lunes = AMM completo; deploy-remaining = 6 contratos sandbox; deploy-listing = LiquidityLock+ListingManager; asset-wrappers = wrappers PSP22. `deployContract` e `updateEnvFile` divergem de verdade entre eles (verificado: 1308 vs 1233 chars; envs escritos diferentes). Fundir criaria um mega-script com flags — mais complexo, não menos. Apenas extrair helpers triviais idênticos (A10) se algum script for editado.

### B3. Button/Input: lunex-admin/components/ui vs lunes-dex-main/components/bases
- `lunex-admin/src/components/ui/button.tsx:45` (shadcn/cva) vs `lunes-dex-main/src/components/bases/button/index.tsx:25` (design system próprio). Design systems deliberadamente distintos (admin Next.js vs DEX Vite). Unificar = pacote UI compartilhado sem workspace — projeto inteiro, não cleanup.

### B4. getAnalyticsDb 3× em spot-api (socialIndexerService.ts:91, socialService.ts:78, socialAnalyticsService.ts:43)
- Divergentes entre si (verificado); envolvem lifecycle de conexão analytics. Consolidação exigiria entender qual variante é canônica — ganho pequeno (~20 linhas), risco em pipeline de analytics sem cobertura clara. Revisitar junto com M7.

---

## Itens menores observados (não contabilizados)
- `lunes-dex-main/src/pages/strategies/index.tsx` e `copytrade/index.tsx` são re-exports de 2 linhas byte-idênticos entre si — ok, padrão de roteamento, deixar.
- 75 definições de ícone SVG inline em lunes-dex-main, com ~15 nomes repetidos 2–3× (WalletIcon, UsersIcon, TwitterIcon, DiscordIcon, BotIcon, ShieldIcon, CopyIcon, SearchIcon… em `pages/social/*`, `pages/docs/index.tsx`, `pages/header/modals/settings`). Consolidar em `components/icons/` é seguro mas toca muitos arquivos — fazer oportunisticamente quando cada página for editada, ou como tarefa mecânica única (classificaria MÉDIA se priorizada; ~150 linhas).
- `shortenAddress` duplicado spot-api↔dex (socialService.ts:17 / PairInfoModal.tsx:181) — cross-package, cai na mesma limitação de M2.
- `checkRateLimit` em `spot-api/src/services/botSandbox.ts:90` e `lunex-admin/src/lib/rateLimit.ts:37` — mesmo nome, contextos diferentes (sandbox de bot vs rate limit de admin). NÃO é duplicação real.
- `activateListing`/`rejectListing`/`getListings` aparecem em spot-api e lunex-admin/scripts, mas o admin apenas chama a API via fetch (verificado em `lunex-admin/src/app/(admin)/listings/pending/actions.ts:57`) e `getListings` do admin é query Prisma própria — duplicação aparente, não real.

## Sequência sugerida de aplicação (Fase B)
1. A1–A4 (lunes-dex-main + lunex-admin, puro import-swap) → `tsc --noEmit` + testes de cada pacote
2. A6, A7 (spot-api utils) → testes spot-api
3. A9 (mcp idênticos) → build mcp
4. A5, A10 (scripts) → conferir que nada referencia check_balances2; smoke run opcional
5. M2 (teste golden de paridade de assinatura) — maior valor de segurança por linha escrita
6. M1, M4, M5 conforme orçamento de revisão
