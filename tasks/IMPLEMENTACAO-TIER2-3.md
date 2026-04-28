# Implementação Tier 2 + 3 — Hardening Adicional
**Data:** 2026-04-28  
**Status:** ✅ 11 itens adicionais completos

---

## Verificação Final

```
spot-api    TypeScript:  ✓
spot-api    Tests:       323/323 (40 suites)
sdk         TypeScript:  ✓
lunex-admin TypeScript:  ✓
lunes-dex-main TypeScript: ✓
subquery    codegen:     ✓

Contratos Rust (87/87 testes — 6 contratos):
  copy_vault       11/11 ✓
  liquidity_lock    5/5  ✓
  spot_settlement  42/42 ✓ (+1 two-step ownership, +1 cancel)
  staking          12/12 ✓
  asymmetric_pair   7/7  ✓ (+ reentrancy guard)
  factory          10/10 ✓ (constructor → Result)
```

---

## Itens Tier 2 — Hardening de Segurança

### Backend / API
- **Body limit reduzido**: `express.json({ limit: '5mb' })` global → `100kb` global, `2mb` apenas em `/api/v1/listing` (única rota legítima com payload grande). Reduz amplificação de DoS via payload inflation
- **`requireAdminOrInternal` X-Forwarded-For defense**: bypass de IP privado agora rejeita se qualquer header de proxy estiver presente (`X-Forwarded-For`, `X-Forwarded-Host`, `Forwarded`). Spoofing via XFF no longer concede acesso ao `/metrics`

### Smart Contracts
- **`spot_settlement::transfer_ownership` two-step**: novo storage field `pending_owner: Option<AccountId>`; `transfer_ownership` agora seta pending; `accept_ownership` (callable apenas pelo pending) finaliza; `cancel_ownership_transfer` para desfazer. **Typos não bloqueiam mais o contrato.** +2 novos testes
- **`asymmetric_pair` reentrancy guard**: `locked: bool` no storage + `Error::Reentrancy`. Aplicado em `asymmetric_swap` em todos os caminhos de retorno

### Infraestrutura
- **nginx-exporter wired**: novo `server` block na porta 8888 com `stub_status` (acesso restrito a docker network); `nginx-exporter` service no compose; job `nginx` descomentado no `prometheus.yml`
- **Node.js padronizado**: `Dockerfile.api` migrado de `node:18-alpine` → `node:20-alpine`. Alinhado com frontend e admin
- **CI typecheck rigoroso**: `|| true` removido dos `tsc --noEmit` do frontend e admin no `deploy.yml`. Erros de tipo agora bloqueiam deploy

### Smart Contracts (Tier 3)
- **`factory::new` fallible**: `assert!` panic → `Result<Self, FactoryError>`. Construtor com fee_to_setter zero retorna `FactoryError::ZeroAddress`. Ink! 4.x: panicking constructors deixam storage parcialmente inicializado — a versão `Result` é segura. Tests atualizados.

### Frontend
- **Limpeza de duplicatas**: removidos `src/components/common/ErrorBoundary.tsx` (não importado, duplicado do `components/ErrorBoundary.tsx`) e `src/pages/header/modals/connectWallet/mock.ts` (não importado em produção)
- **TODO de pools resolvido**: tab "My Pools" removida até integração com LP balance API. Mais honesto que mostrar uma aba que sempre retorna vazio. Tipo `PoolFilter` reduzido de 4 para 3 valores

---

## Resumo Total — Todas as Fases

| Fase | Tarefas | Status |
|------|---------|--------|
| 1 — Emergência Segurança | T01–T03 | ✓ |
| 2 — Estabilidade Processo | T04–T08 | ✓ |
| 3 — Integridade Dados | T09–T13 | ✓ |
| 4 — Frontend e Infra | T14–T20 | ✓ |
| 5 — Smart Contracts | T21–T26 | ✓ |
| Tier 2 — Hardening | 7 itens | ✓ |
| Tier 3 — Cleanup | 4 itens | ✓ |
| **Total** | **37 itens** | **✓** |

---

## Pré-Lançamento Mainnet (fora de escopo de código)

### 🔴 BLOQUEADOR
- [ ] **Auditoria externa** ink!/Substrate (Halborn / Trail of Bits / OpenZeppelin / CertiK) — 4–8 semanas
- [ ] Deploy + integration tests em testnet Lunes (swap real, withdraw real, claim real, two-step ownership transfer real)

### 🟡 DEVOPS — secrets a configurar via secrets manager
- [ ] `RELAYER_SEED` (mainnet, KMS/HSM preferível)
- [ ] `AUTH_SECRET` = `openssl rand -base64 32`
- [ ] `ADMIN_SECRET` ≥32 chars
- [ ] `NATIVE_TOKEN_ADDRESS`, `LUNES_CHAIN_ID`, `LUNES_WS_URL`
- [ ] `BACKUP_S3_BUCKET` + AWS credentials
- [ ] `ADMIN_PASSWORD` ≥16 chars (gerado randomicamente)

### 🟢 PÓS-DEPLOY
- [ ] `copy_vault::set_router(<router_addr>)` em cada vault
- [ ] `spot_settlement::add_relayer(<relayer>)` configurando relayers
- [ ] Validar SSL alerts disparam dentro do prazo no Grafana
- [ ] Test Emergency Controls em staging (pause/unpause spot_settlement com audit log)

### Limitações Conhecidas (documentadas no código)
- **`verify_order_signature`** é no-op até a Lunes chain expor `seal_sr25519_verify`. Mitigação: relayer multisig + monitoring real-time
- **`cfg(not(test))` bypasses** em cross-contract calls de `liquidity_lock`, `staking::execute_proposal` e `copy_vault::swap_through_router`. Tests cobrem state machine; integration tests em testnet exercitam os transfers
- **Admin rate limiter in-memory**: reseta a cada deploy. Aceitável single-node; migrar para Redis se escalar
- **Emergency Controls UI**: copy_vault/staking pause não wired (UI honestamente comunica). Pause via polkadot.js explorer com chave do owner por enquanto

---

## i18n e Acessibilidade (não implementados)
Esses 2 itens da auditoria são esforços de larga escala (semanas de UX work) que não cabem em hardening. Documentados como roadmap pós-lançamento:
- **i18n**: instrumentar `react-intl`/`i18next` com locale provider e extrair strings — toda a UI atual está em inglês hardcoded
- **Acessibilidade WCAG**: aria-labels em todos os botões críticos, focus order, color contrast verification — pode ser feito incrementalmente
