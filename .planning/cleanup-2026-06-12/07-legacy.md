# 07 — Código Legacy / Deprecated / Fallback

**Agente:** 7/8 — limpeza de código | **Data:** 2026-06-12 | **Fase:** A (somente leitura)

**Escopo:** rotas deprecated, versões paralelas, flags mortas, branches `if (legacy)`, código comentado em massa, arquivos `.old`/`mock`/`-v2`, build commitado, pastas duplicadas, examples e docs mortos.

**Resumo:** 3 achados ALTA, 4 MÉDIA, 2 BAIXA + 8 falsos positivos descartados (documentados ao final para evitar retrabalho dos outros agentes).

---

## ALTA confiança (remoção segura)

### A1. Scripts de debug descartáveis commitados na raiz do frontend
- **Arquivos:** `lunes-dex-main/test.js`, `test-debug.js`, `test-pointer.js`, `test-radius.js`, `test-script.js`
- **Evidência:** cada um tem 39–68 bytes e contém apenas um `console.log` de sessão de debug ("Testing why connect wallet is unclickable...", "Testing border radius issue..."). Datados de 10/Mar. **Estão rastreados no git** (`git ls-files` confirma os 5).
- **Por que é seguro:** zero referências em `lunes-dex-main/package.json` e `lunes-dex-main/scripts/` (grep vazio). Não são testes reais — o suite de testes do projeto vive em outro lugar. São restos de uma sessão de debug de UI de março.
- **Ação:** `git rm` dos 5 arquivos.
- **Confiança:** ALTA

### A2. Backups de `.env` locais (possíveis secrets em disco)
- **Arquivos:** `spot-api/.env.backup-2026-06-12`, `lunes-dex-main/.env.backup-2026-06-12`
- **Evidência:** ambos aparecem como `??` (untracked) no `git status` — **não estão no repositório**, mas estão no disco e NÃO são cobertos por nenhuma regra do `.gitignore` (o `git check-ignore` só casou `build/`, `node_modules` e `*.tsbuildinfo`). Risco de commit acidental de secrets.
- **Por que é seguro:** são cópias de segurança de uma migração de env do próprio dia 2026-06-12; os `.env` ativos existem separadamente.
- **Ação:** deletar localmente após confirmar que os `.env` ativos estão corretos; adicionar padrão `*.env.backup*` / `.env.backup-*` ao `.gitignore` raiz.
- **Confiança:** ALTA (com a ressalva de confirmar a migração de env antes de apagar)

### A3. `lunes-dex-main/build/` — NÃO está commitado (mito desfeito), mas é artefato local obsoleto
- **Arquivo:** `lunes-dex-main/build/` (assets, index.html, polkadot-CoBH_PKt.js minificado de ~580KB etc.)
- **Evidência:** `git check-ignore -v` → coberto por `lunes-dex-main/.gitignore:16` (`/build`). `git ls-files lunes-dex-main/build` → vazio. A suspeita da Fase 0 de "build commitado" **não procede**.
- **Por que é seguro:** é só saída do Vite local; regenerável com `npm run build`. Único efeito colateral: polui greps locais (este agente foi vítima — o minificado dominou 1.4MB de saída de grep).
- **Ação:** `rm -rf lunes-dex-main/build` localmente (higiene; nenhum impacto no repo). Idem `tsconfig.tsbuildinfo`.
- **Confiança:** ALTA

---

## MÉDIA confiança (janela de deprecação / coordenação necessária)

### M1. Rotas 410 deprecated em social.ts — corretas, mas com prazo a definir
- **Arquivos:** `spot-api/src/routes/social.ts:23` (`COPYTRADE_DEPRECATION_RESPONSE`), `social.ts:521` e `social.ts:525` (handlers deposit/withdraw retornando 410)
- **Evidência:** vault deposit/withdraw foram movidos para `/api/v1/copytrade/vaults/:leaderId/*`; as rotas antigas retornam `410 Gone` com payload `replacement` apontando as novas. Coberto por e2e (`spot-api/src/__tests__/e2e/social.e2e.test.ts:251-267`).
- **Por que NÃO remover agora:** constraint da API pública — consumidores externos. O padrão atual (410 + replacement) é o correto durante a janela. A remoção física dos handlers (e dos testes e2e correspondentes) só após janela de deprecação formal documentada em `docs/PUBLIC_API_SPECIFICATION.md`.
- **Ação:** definir/registrar data de fim da janela; remover handlers + testes nessa data.
- **Confiança:** MÉDIA (máximo permitido pela constraint)

### M2. Fallback de assinatura legacy no copytrade web3-signal
- **Arquivo:** `spot-api/src/routes/copytrade.ts:337-362` (bloco `legacyAuth`)
- **Evidência:** quando a verificação canônica falha E o payload não traz `positionEffect`/`signalMode` explícitos, há uma **segunda** chamada a `verifyWalletActionSignature` com o conjunto antigo de campos (incluindo `realizedPnlPct`). É um caminho de auth duplicado para assinaturas geradas por clientes antigos.
- **Por que NÃO remover agora:** mesma constraint de API pública — bots/leaders externos podem assinar no formato antigo. É compat deliberada, não bug. Porém é o tipo de fallback que tende a virar permanente: cada caminho extra de verificação de assinatura é superfície de auth adicional.
- **Ação:** instrumentar (logar/metricar quando `legacyAuth` é acionado); quando o uso zerar por N semanas, remover o bloco na mesma janela do M3.
- **Confiança:** MÉDIA

### M3. Campo `realizedPnlPct` deprecated no contrato de validação e no SDK
- **Arquivos:** `spot-api/src/utils/validation.ts:176` (`realizedPnlPct: z.string().optional(), // deprecated: ignored for execution semantics`) e `sdk/src/spot-types.ts:493` (mesmo comentário)
- **Evidência:** campo aceito mas ignorado pela semântica de execução; só sobrevive porque o fallback legacy do M2 o inclui no conjunto de campos assinados.
- **Por que NÃO remover agora:** acoplado ao M2 — remover o campo do schema quebraria a validação de payloads antigos antes do fim da janela. Remover **junto** com M2 (API + SDK no mesmo release, com bump de versão do SDK).
- **Confiança:** MÉDIA

### M4. Triplicação de specs de API em docs/ com referências cruzadas divergentes
- **Arquivos:** `docs/API.md` (17KB, 13/Abr — o mais recente), `docs/API_SPECIFICATION.md` (29.8KB, 10/Mar), `docs/PUBLIC_API_SPECIFICATION.md` (28.4KB, 10/Mar)
- **Evidência:** três documentos descrevendo a API REST, com o ecossistema apontando para canônicos diferentes:
  - `CONTRIBUTING.md:257` e `CLAUDE.md:249` exigem atualizar `docs/API.md` quando rotas mudam;
  - `docs/features/agent-smart-router-mcp-v1/SPEC.md:64` chama `docs/API.md` de "contrato canônico";
  - `docs/FRONTEND_IMPLEMENTATION_GUIDE.md:927` e `docs/SDK_COMPLETE_SUMMARY.md:6,105` apontam `API_SPECIFICATION.md`;
  - `docs/README.md:46-47` lista as duas SPECIFICATION como vivas (geral vs pública).
- **Por que MÉDIA e não ALTA:** `PUBLIC_API_SPECIFICATION.md` tem papel distinto (API pública/automação, referenciado por `AGENTS.md:27` — **o arquivo existe**, ver F3 abaixo). Mas `API.md` vs `API_SPECIFICATION.md` é redundância real: dois "contratos canônicos" com 1 mês de divergência entre si. Consolidar exige atualizar ~14 referências e decidir o canônico (provavelmente `API.md`, o mantido).
- **Ação:** eleger `API.md` como spec interna canônica, fundir conteúdo único de `API_SPECIFICATION.md` nele, deixar stub de redirect ou remover, atualizar as referências. Manter `PUBLIC_API_SPECIFICATION.md` separado (escopo distinto).
- **Confiança:** MÉDIA

---

## BAIXA confiança (higiene / renomear, não remover)

### B1. Arquivos `mock.ts` que são configuração de PRODUÇÃO (nome enganoso)
- **Arquivos:** `lunes-dex-main/src/pages/home/modals/chooseToken/mock.ts` (82 linhas) e `lunes-dex-main/src/pages/home/modals/transactionSetting/mock.ts` (32 linhas)
- **Evidência:** apesar do nome, NÃO são mocks de teste. `chooseToken/mock.ts` define `TOKEN_ADDRESSES` a partir de `process.env.REACT_APP_TOKEN_*` (lista real de tokens) e é importado por **4 arquivos de produção**: `context/useContext.tsx:2`, `pages/home/index.tsx:11`, `pages/header/modals/walletModal/index.tsx:4`; `transactionSetting/mock.ts` define os presets reais de slippage.
- **Por que NÃO remover:** quebraria swap, seleção de token e wallet modal. O problema é só o nome — induz agentes de limpeza (e humanos) a marcá-los para deleção.
- **Ação:** renomear para `tokens.ts` / `slippagePresets.ts` e atualizar os 4 imports. Mudança mecânica, mas toca caminho crítico do swap — fazer com os testes de regressão do frontend rodando.
- **Confiança:** BAIXA (como candidato a *remoção*; a *renomeação* em si é segura)

### B2. `examples/` na raiz — válido porém mínimo e sem dono claro
- **Arquivos:** `examples/decimal-utilities-example.ts`, `admin-tokens.json`, `lunes-ecosystem-tokens.json`, `token-listing-config.json`; e `sdk/examples/simple-swap.ts`
- **Evidência:** o exemplo de decimais importa `convertDecimals`, `getTokenDecimals`, `validateSwapDecimals` etc. de `@lunex/sdk` — **todas existem** em `sdk/src/utils.ts:244,291,430,496` e são reexportadas por `sdk/src/index.ts:202` (`export * from './utils'`). Não está morto.
- **Por que BAIXA:** duplicidade estrutural (dois diretórios `examples/`: raiz e `sdk/examples/`) e ausência de CI que compile os exemplos — podem apodrecer silenciosamente. Hoje, porém, estão corretos.
- **Ação sugerida:** mover `examples/decimal-utilities-example.ts` para `sdk/examples/` (junto do consumidor natural) e avaliar se os 3 JSONs de tokens da raiz ainda alimentam algum script de listing.
- **Confiança:** BAIXA

---

## Falsos positivos descartados (verificados — NÃO mexer)

| # | Suspeita da Fase 0 | Veredito |
|---|---|---|
| F1 | "Pasta `Lunex/` vs raiz duplicada?" | **Não é duplicata.** `Lunex/contracts/` é a localização CANÔNICA dos 13 contratos ink! — `Cargo.toml` (raiz) lista os 13 como workspace members em `Lunex/contracts/*`. Não existe `contracts/` na raiz. Nome infeliz (`Lunex/Lunex`...), mas mover = retocar workspace, CI, scripts de build de contrato. Fora de escopo de limpeza. |
| F2 | "`lunes-dex-main/build/` commitado?" | **Não commitado** — gitignored (`lunes-dex-main/.gitignore:16`). Só artefato local (ver A3). |
| F3 | "AGENTS.md → PUBLIC_API_SPECIFICATION.md morto" | **O arquivo existe**: `docs/PUBLIC_API_SPECIFICATION.md` (28.4KB, atualizado 10/Mar, com seção Decimal Utilities adicionada conforme `docs/CHANGELOG_SDK_DECIMALS.md:28`). A referência em `AGENTS.md:27` é válida. O problema real é o M4 (triplicação), não link morto. |
| F4 | Rotas v0/v1 paralelas no spot-api | Não existem. Só `/api/v1/*` montado em `spot-api/src/index.ts:293-304`. Nenhum prefixo v0/v2. |
| F5 | `pages/pool` vs `pools`, `agent` vs `agents` (componentes velhos não removidos) | Todos os 4 são roteados e distintos em `lunes-dex-main/src/routers/index.tsx:4-6,23-24` (Pool=gestão de pool, Pools=lista, AgentDashboard, AgentGetStarted). Não são versões antigas. |
| F6 | Código comentado em massa | Único arquivo acima do threshold (60+ linhas `//`): `lunes-dex-main/src/context/SDKContext.tsx` (69 de 1015) — inspeção mostra que são comentários explicativos/seção (heurísticas de erro Substrate, passos do swap), não código morto comentado. |
| F7 | Flags de feature mortas | `feature_flags` em `tests/openzeppelin_security_validation.rs:25-63` é struct de simulação dentro do próprio teste. `legacyHeaders: false` em `spot-api/src/index.ts:255-285` é opção do express-rate-limit (4 limiters), não flag de feature. Nenhuma flag morta encontrada. |
| F8 | `@polkadot/api` 9.x vs 16.x e `patches/` | Conforme constraint: resolutions por pacote são deliberadas e `patches/` (patch-package) é necessário. Não auditados como legacy. |

**Nota lateral (fora do tema, repassar ao agente de docs/arquitetura):** os campos `legacy fields` preservados na resposta do asymmetric status (`spot-api/src/__tests__/asymmetricService.test.ts:128`, `e2e/asymmetric.e2e.test.ts:136`) seguem o mesmo padrão aditivo do M2/M3 — compat de resposta para consumidores. Mesma recomendação: registrar janela.
