# Agente 8/8 — AI Slop, Stubs e Comentários Inúteis

**Data:** 2026-06-12 · **Fase:** A (somente leitura) · **Escopo:** spot-api/src, lunes-dex-main/src, lunex-admin/src, sdk/src, mcp/lunex-agent-mcp, Lunex/contracts/*/lib.rs, scripts/

**Resumo:** 6 ALTA · 5 MÉDIA · 5 BAIXA · 6 TODOs avaliados como ainda válidos (manter). Nenhum stub retornando dado fake **silencioso** em caminho de swap/settlement foi encontrado — os caminhos críticos lançam erro explícito (ex.: `routerService.ts:500` lança `'AMM_V1 execution is not implemented'` em vez de fingir executar). Há, porém, 3 achados com relevância de auditoria (marcados ⚠ AUDIT).

---

## 1. Stubs / LARP (funções que fingem fazer algo)

### ⚠ AUDIT — `scripts/security/sentinel_bot.ts:38-44` — bot de monitoramento que não monitora swaps — **ALTA**
A seção "1. Monitorar Swaps Grandes ou Suspeitos" detecta `ContractEmitted` mas o corpo inteiro é pseudo-código comentado:
```ts
// Decodificar evento (pseudo-código, precisaria da ABI real)
// const decoded = decodeEvent(event.data);
// Exemplo: Detectar atividade intensa
// console.log(`📝 Contrato emitiu evento: ${event.data}`);
```
E na linha 53: `// Here we would implement detailed decoding logic based on Lunex ABI`. O bot só reporta de fato `ExtrinsicFailed` (linha 47-50). Se o sentinel consta no runbook de segurança como cobertura de monitoramento de swaps, é cobertura fictícia. **Vira achado de auditoria operacional, não só limpeza.**

### ⚠ AUDIT — `Lunex/contracts/copy_vault/lib.rs:749-752` — `execute_trade` emite `TradeExecuted` sem executar swap — **MÉDIA**
```rust
// NOTE: In production this would be called as a callback after
// the router executes the swap. For now we track the intent.
// Equity updates happen via `update_equity` called by the backend.
```
O método registra o trade no histórico e emite o evento `TradeExecuted` sem nenhum swap on-chain. É **documentado** (não silencioso) e existe o caminho real `swap_through_router` (linha ~780, T25) que faz cross-contract call de verdade. Ação de auditoria: confirmar que indexers/SubQuery e o frontend distinguem `TradeExecuted` de `execute_trade` (intenção) vs swap real, e avaliar restringir/deprecar `execute_trade` no mainnet.

### `lunes-dex-main/src/pages/social/BotRegistry/index.tsx:791-794` — botão "Revoke" que não revoga — **MÉDIA**
```ts
// Revoke would need stored API key — simplified for now
showToast('Use CLI or SDK to revoke keys')
```
Botão de revogação de API key em UI de produção que apenas mostra um toast. Não é silencioso (informa o usuário), mas é UI que finge ter a capacidade. Implementar ou remover o botão.

### `spot-api/src/services/routerService.ts:498-502` — **não é achado** (anti-slop correto)
`AMM_V1` lança erro explícito em vez de fingir executar. Mesmo padrão correto em `PairSelector/index.tsx:233,250` ("never shows fake pairs"). Citado aqui como evidência de que os caminhos críticos do DEX não retornam dado fake silencioso.

---

## 2. "mock" em caminho de produção

### `lunes-dex-main/src/pages/home/modals/chooseToken/mock.ts` — registry de produção com nome de mock — **ALTA**
O arquivo se chama `mock.ts` mas é o **registro real de tokens do DEX**: endereços vêm de env vars (`REACT_APP_TOKEN_WLUNES`, `REACT_APP_TOKEN_LUSDT`, etc.). É importado em 3 caminhos de produção:
- `lunes-dex-main/src/pages/home/index.tsx:11` (página de swap)
- `lunes-dex-main/src/context/useContext.tsx:2` (estado global, `selectedOption1: tokens[0]`)
- `lunes-dex-main/src/pages/header/modals/walletModal/index.tsx:4`

Recomendação: renomear para `tokenRegistry.ts` (4 imports a ajustar).
⚠ AUDIT (secundário, **MÉDIA**): cada endereço tem fallback `|| ''` — se a env var faltar, o token aparece na UI de swap com `address: ''` **silenciosamente**. Falta um guard tipo o `isPlaceholder` do spot-api.

### `lunes-dex-main/src/pages/home/modals/transactionSetting/mock.ts` + comentário `//Mocks` — **MÉDIA**
Presets reais de slippage/deadline (0.1%/0.5%/1%/Auto) usados em produção, com nome `mock.ts` e comentários `//Mocks` em `transactionSetting/index.tsx:7` e `home/index.tsx:10`. Renomear para `slippagePresets.ts` e remover os comentários `//Mocks`.

### Falsos positivos descartados
- ~120 hits de `placeholder` = atributo HTML de inputs (UI legítima).
- `spot-api/src/utils/productionGuards.ts:55` `isPlaceholder()` e usos em `assetBridgeService.ts:485` = **guards corretos** contra seeds placeholder em produção (manter).
- `scripts/deploy-listing-contracts.ts:116` / `deploy-remaining-contracts.ts:103` — endereços fake só em modo DRY RUN, logados em voz alta (OK).
- `staking/lib.rs:1133`, `liquidity_lock/src/lib.rs:220,222,350` — comentários sobre o mock env do ink! em `#[cfg(test)]` (OK).

---

## 3. Código comentado morto (blocos)

| Local | Detalhe | Confiança |
|---|---|---|
| `lunes-dex-main/src/components/bases/index.ts:7,9,11,13,14,24,26,28,30,31` | imports/exports comentados de `logo`, `radio`, `strong`, `switch`, `title` — **os arquivos não existem mais** no diretório. 10 linhas mortas. | **ALTA** |
| `lunes-dex-main/src/pages/header/modals/account/index.tsx:52-54, 62-65` | dois blocos `if (status...)` comentados dentro do `setTimeout`, mais comentário de processo `// para efeitos visuais` (linha 51). | **ALTA** |
| `lunes-dex-main/src/pages/home/modals/chooseToken/index.tsx:27` | `// console.log('token', token)` — debug comentado esquecido. | **ALTA** |
| `Lunex/contracts/factory/lib.rs:451` | linha comentada `// if self.get_pair...` — está dentro de `mod tests` (`#[cfg(test)]` na linha 361) → fora do escopo (testes). | BAIXA (ignorar) |
| `lunes-dex-main/src/components/devices/devices.ts:25-34` | bloco "Modo de uso" comentado — é **exemplo de uso/documentação**, não código morto. Manter. | BAIXA (manter) |

---

## 4. console.log fora de guard

### Contexto importante: `lunes-dex-main/src/index.tsx:11-18` neutraliza `console.*` quando `import.meta.env.PROD` — os logs do frontend **não vazam em produção**.

| Local | Detalhe | Confiança |
|---|---|---|
| `spot-api/src/services/assetBridgeService.ts` (13 ocorrências: 122, 127, 146, 156, 193, 209, 246, 254, 270, 314, 342, 363, 545) | Backend **sem** guard de PROD e o projeto tem logger estruturado (`spot-api/src/utils/logger.ts`) usado nos demais serviços. Migrar para `logger.*` — bridge é componente crítico que precisa de log estruturado/nível. | **MÉDIA** |
| `lunes-dex-main/src/context/SDKContext.tsx` (231, 492, 513, 590, 653, 687, 714, 741, 798, 830), `services/spotService.ts:201,227`, `services/contractService.ts:87`, `services/asymmetricContractService.ts:137` | Suprimidos em PROD pelo guard global; ruído só em dev. Limpeza opcional. | BAIXA |
| `mcp/lunex-agent-mcp/src/smokeRouter.ts` (126, 233, 254, 259, 260) | Script de smoke test — saída CLI legítima. O servidor MCP em si (`src/index.ts`) só usa `console.error` (stderr — seguro p/ stdio MCP). OK. | BAIXA (manter) |
| `scripts/**` (~340 ocorrências) | Scripts CLI de deploy/exploração — saída para operador é o propósito. Manter. | — (manter) |

Nota cruzada (fora do tema, registrar p/ agente de UI): `alert()` cru em 8 pontos do DEX (`pool/index.tsx:462,470`, `governance/index.tsx:851`, `strategies/Detail.tsx:459,486`, `strategies/Page.tsx:628`, `social/settings/index.tsx:791`, `lunex-admin .../pair-actions.tsx:25`) sendo que existe `ToastProvider`.

---

## 5. Comentários óbvios / narração

| Local | Detalhe | Confiança |
|---|---|---|
| `lunes-dex-main/src/services/contractService.ts:1373` | `// Export singleton instance` — repete o código da linha seguinte. | BAIXA |
| `sdk/src/index.ts:199` | `// Export everything` — idem. | BAIXA |
| `lunes-dex-main/src/context/SDKContext.tsx:194` | `// Return formatted or slice the huge string` — narra o `return` da linha seguinte. | BAIXA |
| `lunes-dex-main/src/pages/header/modals/account/index.tsx:51` | `// para efeitos visuais` — narração de processo (junto com o bloco morto do item 3). | ALTA (sai junto) |

Não foram encontrados: "FIXED:", "NEW:", "CHANGED:", "agora vamos", "foi corrigido", "substituído por" em código (varredura A retornou apenas 2 falsos positivos: `passwordChanged` em team/actions.ts e texto legítimo em setup-vps.sh).

---

## 6. TODOs avaliados — **ainda válidos, manter e rastrear**

| Local | TODO | Veredito |
|---|---|---|
| `spot-api/src/services/emergencyService.ts:132-133` | "wire copy_vault and staking pause status once their metadata paths are configured" | **Válido** — o código retorna `available: false` com mensagem operacional honesta (como pausar via polkadot.js). Manter; idealmente virar issue do milestone mainnet (pausa de emergência incompleta no admin é relevante p/ runbook). |
| `Lunex/contracts/staking/lib.rs:1732, 1776, 1802` | `// Por enquanto apenas admin, depois será o contrato de governança` | **Válido** — decisão de fase documentada (governança futura). Manter. |
| `Lunex/contracts/staking/lib.rs:987` | `// For now, allow one vote per proposal per user` | **Válido** — descreve regra vigente. Manter. |
| `Lunex/contracts/copy_vault/lib.rs:751` | NOTE "For now we track the intent" | **Válido como doc**, mas ver achado ⚠ AUDIT na seção 1. |
| `lunes-dex-main/src/pages/social/BotRegistry/index.tsx:793` | "simplified for now" | Ver achado seção 1 (MÉDIA) — implementar ou remover botão. |
| `lunes-dex-main/src/pages/staking/index.tsx` "Coming Soon" (597, 762, 782) | Banner deliberado de feature desativada — comunicação honesta ao usuário, não stub. Manter. | — |

---

## Contagem final

- **ALTA (6):** sentinel_bot stub de monitoramento; mock.ts = registry de produção (rename); bases/index.ts imports mortos; account/index.tsx blocos mortos + "para efeitos visuais"; chooseToken/index.tsx:27 debug comentado; (agregado) comentários `//Mocks` nos imports.
- **MÉDIA (5):** copy_vault execute_trade emite evento sem swap (⚠ audit); fallback `|| ''` silencioso no token registry (⚠ audit); botão Revoke fake no BotRegistry; assetBridgeService console.log vs logger; transactionSetting/mock.ts rename.
- **BAIXA (5):** comentários óbvios (contractService:1373, sdk/index:199, SDKContext:194); console.log do frontend (suprimidos em PROD); devices.ts exemplo de uso (manter).
- **⚠ AUDIT (3):** sentinel_bot sem decode real; copy_vault TradeExecuted sem swap; tokens com address vazio silencioso.
