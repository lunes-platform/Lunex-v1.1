# Auditoria de Produção — Especialista 1: Smart Contracts ink!

**Projeto:** Lunex DEX — Milestone "Lunex Production Readiness"
**Escopo:** `Lunex/contracts/*` (13 contratos), `tests/`, `fuzz/`
**Data:** 2026-06-12
**Toolchain:** ink! 4.2.1 (pinned) — ⚠️ ink! oficialmente descontinuado em jan/2026

---

## VEREDITO: **REPROVADO para mainnet**

Três bloqueadores P0 permanecem **ABERTOS** no código (não apenas na doc): o verificador de assinatura do `spot_settlement` é um no-op (risco de custódia total), o `copy_vault::swap_through_router` chama um seletor/ABI de router que não existe (copy-trading inoperante on-chain), e a contabilidade do `copy_vault` é incoerente (nativo vs PSP22 → fundos presos). Toda a lógica de movimentação de fundos cross-contract está atrás de `#[cfg(not(test))]`, ou seja, **sem cobertura de teste unitário** — foi exatamente isso que permitiu o ABI mismatch passar despercebido. Isto confirma o NO-GO anterior e o `STATE.md` ("contract redesign and lifecycle e2e still pending").

Pontos positivos: o núcleo AMM (`pair`, `router`) está correto — fórmula Uniswap V2 com checked math, K-invariant com fee, MINIMUM_LIQUIDITY travado no endereço zero (first-deposit attack mitigado), reentrancy guard (`lock/unlock`) em mint/burn/swap/sync, slippage (`amount_out_min`) e deadline no router, fee router==pair (995/1000). `staking::claim_rewards` e `liquidity_lock::withdraw` aplicam ordenação efeitos-antes-de-interação com rollback. Estes não são o problema.

---

## ACHADOS

### P0 — Bloqueadores (custódia / funcionalidade core)

**P0-1 — `spot_settlement::verify_order_signature` é um NO-OP — risco de drenagem de fundos custodiais**
`contracts/spot_settlement/lib.rs:1138-1148`. A função só rejeita assinatura toda-zero e computa/descarta a mensagem canônica (`build_order_message`, l.1081). **Não há verificação criptográfica.** O próprio comentário admite (l.1122-1137): falta `seal_sr25519_verify`. `settle_trade` (l.549) move saldos custodiais reais (depositados via `deposit_native`/`deposit_psp22`) entre contas. Um relayer comprometido/malicioso — ou qualquer chamador com privilégio de relayer — pode forjar qualquer assinatura não-zero e liquidar trades arbitrários, drenando todos os depósitos. O modelo de segurança reduz-se a "confie no relayer", inaceitável para custódia em mainnet.
**Fix:** bloquear `settle_trade` até existir (a) `seal_sr25519_verify` on-chain + migração de payload canônico versionado, ou (b) desenho de order-commitment on-chain (assinatura validada na submissão do depósito/ordem). Não habilitar settlement em mainnet sem uma das duas. Alinhar com EXT-CRYPTO em `.planning/decisions.md`.

**P0-2 — `copy_vault::swap_through_router` chama ABI de Router inexistente**
`contracts/copy_vault/lib.rs:847-873`. Usa `Selector::new(selector_bytes!("Router::swap"))` com args `(token_in, token_out, amount_in, min_amount_out, recipient)` e retorno `Result<Balance, u8>`. O `router` **não tem mensagem `swap`** — a API real é `swap_exact_tokens_for_tokens(amount_in, amount_out_min, path: Vec<AccountId>, to, deadline) -> Result<Vec<Balance>, RouterError>` (`router/lib.rs:838`). Seletor, layout de argumentos e tipo de retorno estão todos errados → toda chamada reverte (`SwapFailed`). Copy-trading é não-funcional on-chain. A falha é mascarada pelo branch `#[cfg(test)]` (l.874-875) que retorna `min_amount_out`.
**Fix:** reescrever a chamada para `swap_exact_tokens_for_tokens` com `path = vec![token_in, token_out]`, decodificar `Result<Vec<Balance>, RouterError>` e pegar o último elemento; aprovar `token_in` ao router antes do swap. Adicionar teste de integração e2e on-chain.

**P0-3 — Contabilidade incoerente do `copy_vault` (nativo vs PSP22) → fundos presos**
`contracts/copy_vault/lib.rs:1167-1170` (`get_vault_equity_internal` = `self.env().balance()`, só saldo nativo) vs `deposit`/`withdraw` em nativo (l.350, 450) vs `swap_through_router` que troca tokens PSP22 com `transferred_value(0)` (l.781). O vault não possui o `token_in` PSP22 para negociar, e qualquer `token_out` PSP22 adquirido é invisível ao equity (que só conta nativo). Resultado: swaps revertem por falta de saldo, ou tokens PSP22 obtidos ficam presos e não compõem o valor sacável. O desenho do vault de copy-trading é incoerente.
**Fix:** decidir o modelo de ativo (nativo OU PSP22 wrapped) e unificar equity, depósito, saque e swap sobre o mesmo ativo; se multi-ativo, equity deve somar holdings PSP22 via `balance_of`. Requer redesign — não é patch pontual.

### P1 — Alto

**P1-1 — Caminhos de movimentação de fundos escondidos atrás de `#[cfg(not(test))]` (zero cobertura unitária)**
`staking/lib.rs:1137-1172` (refund/treasury split de `execute_proposal`), `copy_vault/lib.rs:847` (swap), `liquidity_lock/src/lib.rs:224-248` (PSP22 transfer do `withdraw`). A lógica que de fato move dinheiro nunca executa em testes unitários — o build de teste toma outro branch. Foi isto que deixou o P0-2 passar. Item da Phase 5 do roadmap.
**Fix:** substituir gates por mocks de cross-contract (ink e2e ou ambiente mock com contas pré-fundadas) e cobrir explicitamente cada transfer.

**P1-2 — 8 testes de matemática do router marcados `#[ignore]`**
`contracts/router/lib.rs` (8 ocorrências). O cálculo central de `get_amounts_out`/`get_amount_out` e roteamento de path não é validado pela suíte. Phase 5.
**Fix:** des-ignorar, corrigir expectativas, manter no CI.

**P1-3 — `asymmetric_pair::asymmetric_swap` não move tokens nem protege slippage**
`contracts/asymmetric_pair/lib.rs:396-449`. Só muta `curve.current_volume` e emite evento — **nenhuma transferência PSP22 de entrada/saída** e **nenhum parâmetro `min_amount_out`**. É um esqueleto de pricing, não um swap funcional. Se roteado com fundos reais, o usuário não recebe tokens.
**Fix:** implementar custódia/transferência real + proteção de slippage, ou marcar explicitamente como não-deployável e removê-lo do path de produção.

**P1-4 — `liquidity_lock::create_lock` não verifica o depósito de LP**
`contracts/liquidity_lock/src/lib.rs:136-189`. Registra `lp_amount` sem `transfer_from` nem checagem de `balance_of` do próprio contrato. Confia integralmente no `ListingManager`. Se o manager tiver bug ou a transferência de LP não for atômica, locks podem sobre-reivindicar um pool de tokens compartilhado e o `withdraw` drena LP de outros locks.
**Fix:** verificar saldo de LP recebido (ou puxar via `transfer_from` dentro de `create_lock`) antes de gravar o registro.

### P2 — Médio

**P2-1 — `pair::collect_protocol_fees` não re-sincroniza reserves → drift reserve/balance**
`contracts/pair/lib.rs:1375-1418`. Transfere fees acumuladas para fora mas não chama `update()`/`sync()`. Após a coleta, `reserve_0/1 > balance` real; o próximo `swap` calcula `amount_in` a partir de reserves inflados e pode reverter espuriamente ou precificar errado até alguém chamar `sync()`.
**Fix:** chamar `self.update(balance_0_real, balance_1_real)` ao final de `collect_protocol_fees`, ou não contar fees acumuladas dentro de reserve.

**P2-2 — Transferência de propriedade inconsistente (single-step em contratos com fundos)**
`staking/lib.rs:1528` e `asset_wrapper/src/lib.rs` usam reassignment imediato (só checagem de zero-address). Apenas `spot_settlement` tem two-step (`transfer_ownership`+`accept_ownership`). Erro de digitação para endereço errado em `staking` = perda permanente de admin sobre fundos e governança. A afirmação do PATHFINDER de "two-step ownership" só é parcialmente verdadeira.
**Fix:** padronizar two-step (pending_owner + accept) em `staking` e `asset_wrapper`.

**P2-3 — Drift de versão ink! (4.3 vs 4.2.1)**
`asymmetric_pair/Cargo.toml` e `spot_settlement/Cargo.toml` pinam `ink = 4.3`/`4.3.0`; os outros 11 contratos pinam `4.2.1`. A constraint exige 4.2.1. Versões menores mistas alteram codegen/metadata e quebram reprodutibilidade de build.
**Fix:** pinar uniformemente em 4.2.1.

**P2-4 — Comentário "CEI" impreciso em `staking::claim_rewards`**
`contracts/staking/lib.rs:847-868`. O comentário diz CEI mas a ordem é Interação-antes-de-Efeito (transfere, depois zera `pending_rewards`). Hoje é seguro (reentrancy lock + transfer nativo do substrate não dispara callback), mas é frágil se migrar para rewards PSP22.
**Fix:** corrigir o comentário e, se houver migração para PSP22, reordenar para efeitos-antes-de-interação.

### P3 — Baixo

**P3-1 — `factory::create_pair` usa `.instantiate()` (trap) em vez de `.try_instantiate()`**
`contracts/factory/lib.rs:290-295`. Falha de instanciação faz trap em vez de retornar `FactoryError`. O construtor `new` (l.92) já é falível corretamente.
**Fix:** usar `try_instantiate()` e mapear o erro.

**P3-2 — Bypass parcial de cooldown no `copy_vault::withdraw`**
`contracts/copy_vault/lib.rs:462-485`. O `shares` do `WithdrawalRequest` armazenado não é comparado ao `shares` da segunda chamada — pode-se solicitar um valor e sacar outro (também grande) após o cooldown.
**Fix:** validar que o `shares` sacado ≤ `request.shares`.

---

## RISCOS ESTRUTURAIS

- **ink! descontinuado (jan/2026):** os 13 contratos dependem de um framework sem manutenção/patches de segurança futuros. Curto prazo 4.2.1 é aceitável, mas é beco sem saída — orçar migração (ink! 5 / pallet-revive / alternativa) ou aceitar toolchain congelado. Risco estratégico P1 de longo prazo.
- **Upgradeability:** não há padrão de proxy/migração. Bugs como P0-1 e P0-2 não são hotfixáveis sem redeploy + migração de estado. Definir a estratégia de upgrade/migração **antes** da mainnet.
- **Eventos:** `pair`/`router`/`staking`/`spot_settlement` emitem eventos adequados para indexação. `copy_vault` emite `TradeExecuted`, mas como o swap reverte on-chain (P0-2), indexadores nunca verão trades reais — o evento é enganoso até o ABI ser corrigido.

---

## MELHORIAS QUE APROVO PARA IMPLEMENTAÇÃO IMEDIATA

Baixo risco, claramente corretas, não exigem redesign:

1. **P2-3** — Pinar `ink = 4.2.1` em `asymmetric_pair` e `spot_settlement`.
2. **P2-2** — Two-step ownership em `staking` e `asset_wrapper` (espelhar `spot_settlement`).
3. **P2-1** — `collect_protocol_fees`: chamar `update()` com saldos reais após transferir fees.
4. **P3-1** — `create_pair`: usar `try_instantiate()` + mapear erro.
5. **P1-2** — Des-ignorar e corrigir os 8 testes de matemática do router; manter no CI.
6. **P1-4** — `create_lock`: verificar saldo de LP recebido antes de gravar.
7. **P3-2** — `withdraw`: validar `shares ≤ request.shares`.
8. **P2-4** — Corrigir comentário CEI em `claim_rewards`.

**NÃO aprovo como "imediato"** os P0 (1-3) nem o P1-3: exigem redesign (verificação de assinatura via host-function ou order-commitment; correção de ABI + modelo de ativo do vault; implementação real do asymmetric_pair) e devem ser tratados como bloqueadores de milestone com plano dedicado + auditoria externa (EXT-AUDIT) após corrigidos.
