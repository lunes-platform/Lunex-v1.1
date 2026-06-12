# Sprint P0 — Resultado (2026-06-12)

Status dos 4 bloqueadores + P1s aprovados. Tudo na working tree, sem commits.

## P0 — Bloqueadores

| # | Item | Status | Prova |
|---|---|---|---|
| P0-1 | `verify_order_signature` no-op | ✅ **Gate fail-closed implementado** + ADR-001 para o redesign definitivo | `spot_settlement`: `signature_verification_enforced` default true → `settle_trade` falha com `SignatureVerificationUnavailable` antes de mover saldo; owner-only + evento `SignatureEnforcementChanged`. cargo test 46/46; build verde (wasm 30.3K) |
| P0-2 | `copy_vault::swap_through_router` seletor inexistente | ✅ **Corrigido e provado on-chain** | Approve PSP22 (`0xb20f1bbd`) + `swap_exact_tokens_for_tokens` (`0xa0ac73cf`), path/to/deadline corretos, decode `Result<Vec<Balance>, RouterErrorMirror>`. cargo test 20/20; build verde (29.5K). **E2E no node local: Δ WLUNES −1,0 / Δ LUSDT +1.951,17** (`spot-api/scripts/e2e-copy-vault-swap.ts`) |
| P0-3 | Contabilidade do copy_vault | 📐 **ADR-002 entregue** (recomenda multi-ativo com equity cotada via `router.get_amounts_out`; redesign de milestone, conforme painel) | `.planning/audit-2026-06-12/ADR-002-modelo-ativo-copy-vault.md` |
| P0-4 | Alertmanager `${ENV}` não expande | ✅ **Corrigido e validado** | Template + sed no entrypoint + guard fail-closed; `amtool check-config SUCCESS` na imagem `prom/alertmanager:v0.27.0`; compose validado |

## P1/P2/P3 aprovados aplicados nesta rodada (todos com gate verde)

- **CVE HIGH + 8 vulns** spot-api: `npm audit fix` → 0 vulnerabilidades; 212/212 testes.
- **Bridge invisível**: 23 `console.*` → pino estruturado (`err`, `depositKey`, `blockNumber`); testes 4/4.
- **Copy-trade sem slippage** (`minAmountOut ?? 0`): fail-closed — intent sem proteção não vira continuation; TDD 12/12.
- **`executionPrice` fabricado** de `amountIn/amountOutMin`: removido — sem fonte real de preço o sinal é rejeitado com erro explícito; TDD; regressão copytrade 64/64.
- **Admin RBAC na borda**: role fail-closed + `/team` só SUPER_ADMIN + sessão JWT 8h (era 30d); validado ao vivo.
- **`|| '//Alice'` removido** dos deploy scripts (opt-in `ALLOW_DEV_ALICE` / default só `--network local`); exit=1 comprovado.

## Rodada 4 — implementação dos redesigns P0 (ADR-001 e ADR-002)

- **P0-3 FECHADO (ADR-002, copy_vault multi-ativo):** equity = nativo + wnative(1:1) + Σ cotação on-chain dos tracked tokens (via factory→pair.get_reserves→router.get_amount_out, fee do AMM como fonte de verdade); falha de cotação = erro explícito (`ValuationUnavailable`), nunca "vale 0"; token auto-rastreado antes do swap (vault nunca adquire ativo invisível ao equity); withdraw fail-explícito (`InsufficientNativeLiquidity`); lista bounded (MAX=8). 10 erros + 4 eventos novos, 5 invariantes documentadas para o fuzz. **45/45 testes, build OK (42.8K), E2E on-chain provou decomposição de equity + withdraw fail-closed.** Saque 2-fases (request/claim) ficou como TODO documentado.
- **P0-1 implementado (ADR-001, atestação ECDSA 2-de-2):** `verify_order_signature` agora exige, em modo enforced + attestor configurado, `ecdsa_recover` da atestação sobre `blake2_256(payload_v2)` comparado à pubkey do attestor (`AttestationInvalid` se falhar); sem attestor → `SignatureVerificationUnavailable` (gate fail-closed preservado). Payload canônico v2 documentado (165 bytes, ordem fixa). Ataque agora exige comprometer relayer E attestor. **52/52 testes (46+6); build WASM em finalização.** ABI break: campo `attestation: [u8;65]` em SignedOrder exige regen de typechain.
- **2 bugs de build corrigidos** (revelados pelo rebuild): `asymmetric_pair` clippy `checked_div` (build verde); `pair` crate-type removido (build verde, **31 mensagens** vs 10 do artifact obsoleto).

**Os 13 contratos buildam da árvore de fonte atual (ink! 4.3.0)** — confirmado às 14:41; substituem os artifacts commitados obsoletos (declaravam ink! 5.1.1, 6 de 13). Próximo passo de deploy: regenerar `artifacts/` a partir de `target/ink/` + registrar code hash por contrato.

### Próximos passos de backend exigidos pelo ADR-001 (lista objetiva)
1. Serviço attestor isolado (host/Doppler secret próprio): verifica sr25519 do maker → assina secp256k1 do payload v2.
2. spot-api relayer: pede atestação por ordem casada, anexa ao SignedOrder, fail-closed se attestor indisponível.
3. Regen typechain/ABI (spot-api, SDK, indexer) para o campo `attestation`.
4. `set_attestor_key` no deploy + runbook de rotação.
5. Alertas em `AttestorKeyChanged`, `SignatureEnforcementChanged`, settles `AttestationInvalid`.
6. Teste de paridade TS↔Rust do hash blake2-256 do payload v2.

## Decisões pendentes do time
1. **ADR-001**: aprovar atestação ECDSA 2-de-2 (recomendada) vs aguardar `sr25519_verify` vs order-commitment.
2. **ADR-002**: aprovar modelo multi-ativo do vault (recomendado) e priorizar implementação.
3. Rebuild + verificação de code hash de TODOS os artifacts antes de qualquer deploy (artifacts commitados estão desatualizados).

## Rodada 2 — testnet staging local + P2/P3 de frontend (todos validados)

- **Testnet de staging rodando localmente** (container `lunes-staging`, ws://localhost:9945, rpc :9934): conectada à rede real com 4 peers, sincronizando (~300bps) rumo ao head #11,2M; GRANDPA finalizando. Achados: (1) `wss://sandbox.lunes.io/ws` está **fora do ar** (endpoint do .env original inacessível); (2) specVersion 105 nos blocos históricos vs 106 no binário dev — confirmar runtime do head pós-sync; (3) typo no nome da chain no spec: "Lunes Nigthly".
- **`decimals ?? 12` eliminado** (`contractService.getTokenInfo`): sem decimals legível → `null` (recusa fabricar metadados). tsc+lint verdes.
- **Métricas fabricadas do AgentProfile**: `roi/sharpe/maxDrawdown` agora `number | null` (`?? null`), UI exibe "—" (BotRegistry). tsc+lint verdes.
- **Banner do ChartPanel**: só `TypeError` (falha de rede) = offline; erro HTTP = API online sem dados. Texto corrigido. **Validado no browser**: par 404 agora mostra "No trades yet" em vez de "spot-api offline".

## Rodada 3 — observabilidade viva + fuzz (validados fim-a-fim)

- **Alertas mortos ressuscitados**: `DatabaseBackupFailed` e `DatabaseConnectionPoolExhausted` referenciavam métricas que ninguém exportava. Implementado: `backup.sh` grava sucesso em `ops_backup_status` (criação idempotente + upsert pós-upload) → `docker/postgres-exporter-queries.yml` (novo) expõe `lunex_last_backup_timestamp_seconds`, `lunex_db_connections_{active,waiting}`, `lunex_db_max_connections` → alertas reescritos + novo `DatabaseBackupMetricMissing` (absent = cobertura cega também é incidente). **Provas:** promtool SUCCESS (28 rules); SQL validado no banco local (0 → epoch após upsert); postgres-exporter v0.15.0 real rodado contra o banco expôs exatamente os nomes esperados.
- **Fuzz nightly 60s → 600s** (`fuzz.yml`), conforme meta da Fase 10.
- Pendente (anotado, não implementado): alerta de lag do indexer SubQuery exige expor métricas do subql-node ao Prometheus — requer decisão de stack (scrape do endpoint meta do subql).
- 🔄 Em background: rebuild verificado dos 11 contratos restantes + relatório de drift vs artifacts commitados (`08-artifacts-rebuild.md`).

## Nota de ambiente (CI/onboarding)
cargo-contract 2.2.1 é incompatível com Rust ≥1.94 (Homebrew). Builds exigem rustup 1.85.0 (pinado no `rust-toolchain.toml`) na frente do PATH + cargo-contract 4.1.1 (instalado nesta sessão). Garantir no CI.
