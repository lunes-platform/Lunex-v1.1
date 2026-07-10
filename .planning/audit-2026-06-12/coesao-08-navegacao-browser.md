# Navegação Browser — Todos os Módulos (2026-06-12)

Validação visual/runtime de cada módulo do DEX no navegador (Playwright) contra a stack local (node dev :9944, spot-api :4000, DEX :3000).

## Bug crítico corrigido nesta rodada
**Swap quote quebrado** (`Cannot convert [object Object] to a BigInt`, SDKContext.tsx:417) — causa-raiz: `get_amount_out` do router retorna `Result<Balance,Err>` com **dupla camada** de Result no `toJSON` (`{ok:{ok:N}}`); `contractService.getAmountsOut` desempacotava só uma camada e fazia `.toString()` num objeto → `"[object Object]"` → `BigInt` explodia. **Fix:** helper `unwrapResult` que desce os Results aninhados e trata `Err`. **Validado no browser:** 10 WLUNES → 14.915,81 LUSDT exibido corretamente.

## Estado por módulo

| Módulo | Rota | Render | Integração | Observação |
|--------|------|--------|-----------|------------|
| Swap | /swap | ✅ | ✅ quote on-chain real | fix do quote aplicado |
| Liquidity Pool | /pools | ✅ | ✅ TVL on-chain ($188,73K) | volume 24h $0 (AMM não passa pelo orderbook indexado) |
| Staking | /staking | ✅ | ✅ lê contrato (lock 7d, total staked) | |
| Spot | /spot | ✅ | ✅ fail-closed | ordens desabilitadas sem ticker (correto) |
| Social Trade | /social | ✅ | ✅ | |
| Strategies | /strategies | ✅ | ✅ marketplace | |
| Agent | /agent | ✅ | ✅ dashboard | |
| Rewards | /rewards | ✅ | ✅ trading rewards | |
| Affiliates | /affiliates | ✅ | ✅ | rota é plural; /affiliate (singular) → NotFound (correto) |

## Erros de console (padrão único, não-bloqueante)
Em todas as páginas de trading: `404 /api/v1/pairs/WLUNES%2FLUSDT/ticker` e `/api/v1/trades/WLUNES%2FLUSDT`. Causa: o par WLUNES/LUSDT existe **on-chain no AMM** (pools o mostra) mas **não está cadastrado no spot-api** como par de orderbook/spot. É a desconexão AMM↔orderbook já registrada na validação de coesão — para o /spot funcionar plenamente, o par precisa ser registrado no spot-api (via listing flow ou seed).

## Warnings não-bloqueantes (qualidade)
- `@polkadot/util has multiple versions` (13.5.9 vs 14.0.x duplicados no bundle Vite) — dedupe pendente; polui console, não quebra.
- `validateDOMNesting: <button> cannot appear as descendant of <button>` no ConnectWallet — markup a corrigir.
- `Module "buffer" externalized` / React Router v7 future flags — cosméticos.

## Limite do teste por browser
Operações que movem fundo (swap real, add liquidity, stake) exigem assinatura via extensão de wallet, indisponível no Playwright headless. Essas são cobertas pelo **simulador de volume on-chain multi-conta** (`simulate-volume.ts`, ver `coesao-07`).
