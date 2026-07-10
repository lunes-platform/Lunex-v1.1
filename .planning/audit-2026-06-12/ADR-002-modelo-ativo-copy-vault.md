# ADR-002 — Modelo de ativo e contabilidade do `copy_vault`

- **Status:** PROPOSTO (aguardando decisão do time)
- **Data:** 2026-06-12
- **Origem:** Auditoria de produção, achado **P0-3** (`.planning/audit-2026-06-12/01-contratos.md`); relacionado ao P0-2 (ABI do router)
- **Decisores:** Time de contratos + produto (copy-trading) + segurança
- **Escopo:** `Lunex/contracts/copy_vault/lib.rs` — NÃO implementar junto com o fix do P0-2 sem antes fechar esta decisão (ambos tocam `swap_through_router`)

---

## Contexto

O `copy_vault` é internamente incoerente quanto ao ativo que custodia:

- `deposit`/`withdraw` operam em **nativo LUNES** (`payable` / `transfer` nativo — l.350, 450).
- `get_vault_equity_internal()` (l.1167) retorna **apenas** `self.env().balance()` — só o saldo nativo.
- `swap_through_router` (l.781+) tenta trocar **tokens PSP22** com `transferred_value(0)`.

Consequências (P0-3): o vault não possui o `token_in` PSP22 que tenta vender (swaps revertem); qualquer `token_out` PSP22 adquirido fica **invisível ao equity** — não compõe o preço da cota (`get_share_price_internal`) nem o valor sacável → **fundos presos** e cotas mal precificadas (depositante que entra depois de um swap compra cota descontada; quem sai antes do unwind realiza perda fictícia). Além disso o P0-2 mostra que a chamada de swap usa um seletor inexistente — copy-trading hoje é não-funcional on-chain e o redesenho do modelo de ativo precisa vir **antes** de re-escrever a chamada de swap.

Premissas do ecossistema:
- O `router` expõe `get_amounts_out(amount_in, path) -> Result<Vec<Balance>, RouterError>` e `swap_exact_tokens_for_tokens(...)`; swaps de/para nativo passam por `wnative` (wrap do LUNES).
- O produto copy-trading (frontend + spot-api `copytradeService`) é parte central da proposta de valor da milestone.

---

## Opções consideradas

### Opção (a) — Vault nativo-only (swaps proibidos)

Remover `swap_through_router`; o vault só custodia LUNES. Equity = `env().balance()` (passa a ser correto por construção).

| Dimensão | Avaliação |
|---|---|
| **Correção contábil** | Trivialmente correta — um único ativo, equity = saldo. |
| **Produto** | **Mata o copy-trading on-chain**: um vault que não pode trocar ativos não copia trade nenhum. Restaria copy-trading puramente off-chain (espelhamento de ordens no spot off-chain), que não usa o vault. |
| **Esforço** | Dias (remoção de código + testes). |
| **Risco** | Zero técnico; alto de produto (feature anunciada deixa de existir on-chain). |

### Opção (b) — Multi-ativo com valuation on-chain via router

O vault custodia LUNES (ativo-base de depósito/saque) **e** uma lista **bounded** de tokens PSP22 rastreados. Equity passa a ser:

```
equity = saldo_nativo
       + Σ (para cada token rastreado com balance > 0)
           router.get_amounts_out(balance_of(vault, token), [token, wnative])
             .map(|v| *v.last())          // cotação spot no momento da leitura
```

Swaps usam a ABI real do router (`swap_exact_tokens_for_tokens`, corrigindo o P0-2), com wrap/unwrap via `wnative` quando uma ponta é o nativo.

| Dimensão | Avaliação |
|---|---|
| **Correção contábil** | Correta e completa: todo ativo que o vault pode possuir entra no equity. |
| **Produto** | Preserva o copy-trading on-chain integral (multi-par). |
| **Esforço** | ~2-3 semanas (storage, valuation, fluxo de withdraw, eventos, testes, e2e). |
| **Risco** | Cotação spot do AMM é **manipulável intra-bloco** (sanduíche no preço da cota em deposit/withdraw). Mitigável (ver desenho). Custo de gas de leitura cresce com nº de tokens (bounded resolve). Withdraw pode exceder a liquidez nativa disponível (precisa de fluxo explícito). |

### Opção (c) — Single-asset PSP22 base (ex.: LUSDT) com wrap

Depósito/saque e denominação da cota em um PSP22 estável (LUSDT). Nativo nunca entra; trades só `LUSDT → token → LUSDT`.

| Dimensão | Avaliação |
|---|---|
| **Correção contábil** | Só é trivial se o vault **nunca** mantiver posição aberta entre blocos. Como copy-trading mantém posições (esse é o ponto), a valuation dos tokens em carteira continua necessária → herda quase toda a complexidade da (b), mais o fluxo de `approve`+`transfer_from` no depósito (pior UX que `payable` nativo) e dependência da liquidez/estabilidade do LUSDT na DEX. |
| **Produto** | Cota em "dólar" é mais legível para P&L; porém exige que o usuário possua LUSDT antes de depositar. |
| **Esforço** | ~3 semanas (igual à (b) + migração do fluxo de depósito + bridge LUSDT como dependência dura). |
| **Risco** | Os mesmos da (b) (valuation spot) **mais** risco de depeg/baixa liquidez do par LUSDT/wnative contaminando o preço da cota; acopla o copy-vault ao roadmap do bridge LUSDT. |

---

## Decisão proposta (recomendação)

**Adotar a Opção (b) — multi-ativo com ativo-base nativo (LUNES) e equity somando valuations via `router.get_amounts_out` — com lista de tokens rastreados bounded e fluxo de withdraw fail-explícito.** Justificativa:

1. (a) cancela o produto; só é aceitável como fallback se o time decidir adiar copy-trading on-chain para outra milestone.
2. (c) não elimina o problema de valuation (posições abertas existem do mesmo jeito) e adiciona dependências (LUSDT, approve-flow) e risco de depeg. Não paga sua complexidade extra.
3. (b) é o único desenho que mantém o produto e fecha o P0-3 pela raiz: **o conjunto de ativos que o vault pode possuir é exatamente o conjunto que o equity enxerga** (invariante central). A manipulação de cotação spot é mitigável com mecanismos simples na v1 (abaixo) e TWAP na v2.

### Desenho detalhado (Opção b)

#### Storage (novo/alterado)

```rust
/// Tokens PSP22 que o vault pode possuir e que compõem o equity.
/// BOUNDED: índice denso para iteração determinística.
tracked_tokens: Mapping<u32, AccountId>,
tracked_token_index: Mapping<AccountId, u32>,  // reverso, para O(1) em is_tracked
tracked_token_count: u32,                      // <= MAX_TRACKED_TOKENS (sugestão: 8)
/// Endereços de infraestrutura para valuation/swap.
router: AccountId,        // já existe
wnative: AccountId,       // NOVO — ponta de path para cotação token -> wnative
/// Fila de saques que excedem a liquidez nativa disponível (duas fases).
withdrawal_requests: Mapping<u64, WithdrawalRequest>,  // já existe parcialmente (P3-2)
```

Constantes: `MAX_TRACKED_TOKENS: u32 = 8` (limite de gas de leitura: 8 × `get_amounts_out` ≈ aceitável; medir no e2e e ajustar).

#### Mensagens novas/alteradas

```rust
// Governança da lista (owner/strategy_manager; emite evento):
add_tracked_token(token: AccountId)    -> Result<(), VaultError>  // falha se count == MAX
remove_tracked_token(token: AccountId) -> Result<(), VaultError>  // falha se balance_of(vault, token) > 0 (nunca des-rastrear com posição aberta!)

// Leitura:
get_tracked_tokens() -> Vec<AccountId>
get_token_valuation(token: AccountId) -> Result<Balance, VaultError>  // get_amounts_out(balance, [token, wnative])
get_vault_equity() -> Result<Balance, VaultError>  // substitui o atual; ERRO explícito se alguma cotação falhar (não silenciar para 0!)

// Saque em duas fases (quando falta liquidez nativa):
request_withdrawal(shares: Balance) -> Result<u64, VaultError>   // registra pedido, emite WithdrawalRequested
claim_withdrawal(request_id: u64)  -> Result<(), VaultError>     // paga quando houver nativo; preço da cota fixado no request
```

`swap_through_router` é reescrito (fix do P0-2) usando `swap_exact_tokens_for_tokens` com `path = [token_in, token_out]` (ou via wnative), `approve` do `token_in` ao router antes, decodificação de `Result<Vec<Balance>, RouterError>`, e **pré-condições**: `token_in`/`token_out` ∈ tracked ∪ {nativo}; saldo suficiente verificado via `balance_of` real, não via equity.

#### Equity e preço da cota

- `get_vault_equity_internal()` → soma: `env().balance()` + Σ valuation dos tracked tokens com `balance_of > 0`.
- **Falha de cotação é falha da operação** (deposit/withdraw/swap revertem com `ValuationUnavailable`), nunca "vale 0" — valuation silenciosamente zerada é exatamente o bug P0-3 com outra roupa.
- Mitigação de manipulação spot na v1 (documentar como limitação aceita + monitoramento):
  - `min_liquidity_for_tracking`: só rastrear tokens cujo par com wnative tenha reservas mínimas (checado em `add_tracked_token`).
  - Cooldown depósito→saque (ex.: N blocos) para encarecer sanduíche de preço de cota no mesmo bloco.
  - v2: TWAP via oráculo `price_0_cumulative_last` dos pairs (já existe no pair).

#### Fluxo de withdraw quando falta liquidez nativa (fail explícito)

1. `withdraw(shares)` calcula `value = shares × share_price`.
2. Se `env().balance() - reserva_operacional >= value` → paga imediatamente (caminho atual).
3. Senão → **`Err(InsufficientNativeLiquidity)`** — o erro reverte tudo (em ink!, `Err` em mensagem reverte estado, portanto **não há evento no caminho de erro**; o frontend/spot-api traduzem o erro para o usuário).
4. Alternativa não-bloqueante oferecida ao usuário: `request_withdrawal(shares)` — registra o pedido **com preço de cota congelado no request** (proteção contra o trader atrasar o unwind para diluir o sacador), emite `WithdrawalRequested{request_id, owner, shares, value}`. O keeper/`vaultReconciliationService` detecta o evento, o trader (ou liquidação automática v2) desfaz posições via swap, e o usuário chama `claim_withdrawal(request_id)`.
5. O vault **nunca** vende posições automaticamente dentro do `withdraw` na v1 (swap implícito em caminho de saque = superfície de manipulação e de gas griefing).

#### Eventos

```rust
TrackedTokenAdded   { token, by }
TrackedTokenRemoved { token, by }
VaultSwapExecuted   { token_in, token_out, amount_in, amount_out, executed_by }
WithdrawalRequested { request_id, owner, shares, value_at_request }
WithdrawalClaimed   { request_id, owner, amount }
EquitySnapshot      { native, tokens_value, total }   // emitido em deposit/withdraw para indexer/reconciliação
```

#### Invariantes (base para testes e fuzz `copy_vault_accounting`)

1. **Completude do equity:** todo ativo que qualquer codepath do vault pode adquirir está em `{nativo} ∪ tracked_tokens` (swap só permite essas pontas; `remove_tracked_token` exige balance 0).
2. `total_shares == 0 ⟺ equity atribuível a cotistas == 0` (módulo poeira/donations diretas — documentar tratamento de donation: entra no equity, diluindo a favor dos cotistas).
3. `share_price` nunca é lido com valuation parcial (cotação falhou ⇒ operação reverte).
4. Saque nunca paga mais que `shares/total_shares × equity` no momento do pagamento (ou do request, no fluxo em duas fases).
5. `tracked_token_count <= MAX_TRACKED_TOKENS` sempre.

#### Plano de testes

- Unit: add/remove tracked (limites, posição aberta, acesso); equity com mocks de cotação (incluindo falha de cotação ⇒ revert); withdraw caminho feliz, `InsufficientNativeLiquidity`, request/claim com preço congelado; swap com pré-condições violadas.
- O bloco `#[cfg(not(test))]` que hoje esconde as cross-contract calls deve ser substituído por um **trait `RouterRef`/`Psp22Ref` injetável** (mock em teste, chamada real em produção) — achado estrutural da auditoria: foi o `#[cfg(test)]` que mascarou o P0-2.
- E2E on-chain (ink_e2e/testnet): deposit → swap real via router → equity reflete token → unwind → withdraw; cenário de falta de liquidez nativa com request/claim.
- Fuzz: atualizar `fuzz/fuzz_targets/copy_vault_accounting` para o equity multi-ativo (invariantes 1-4).

#### Migração

- O vault atual em testnet não tem estado de produção a preservar → **redeploy limpo** (novo code hash, nova instância), atualizando `deployment-*.json`, spot-api (`copytradeService`), SubQuery mappings (novos eventos) e frontend.
- Se houver depósitos em testnet: drenar via `withdraw` antes do redeploy (script em `scripts/`), ou aceitar reset de testnet.
- Mainnet: contrato só entra no escopo do EXT-AUDIT já no modelo novo.

## Consequências

**Positivas:** P0-3 fechado pela raiz (equity completo por construção); copy-trading on-chain viável; pré-requisito limpo para o fix do P0-2; eventos novos dão observabilidade de reconciliação ao `vaultReconciliationService`.

**Negativas / dívidas:** equity depende da disponibilidade do router (cotação falhou ⇒ vault "pausado" de fato — aceitável, fail-closed); manipulação spot intra-bloco mitigada mas não eliminada até TWAP (v2); gas de leitura cresce com tokens rastreados; redeploy + atualização de toda a pilha off-chain.
