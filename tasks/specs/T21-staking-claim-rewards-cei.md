# Spec T21 — Corrigir CEI em staking::claim_rewards (Rust/ink!)

**Fase:** 5 — Smart Contracts  
**Esforço:** S (~4h)  
**Prioridade:** BLOQUEADOR

---

## Problema

`Lunex/contracts/staking/lib.rs:850-858`:

```rust
// PROBLEMA: estado atualizado ANTES do transfer
stake.pending_rewards = 0;
stakes.insert(&caller, &stake);  // L850 — rewards zerados
// ...
let transfer_result = self.env().transfer(caller, reward_amount);  // L858
if transfer_result.is_err() {
    self.release_lock();
    return Err(StakingError::TransferFailed);
    // ❌ Rewards zerados mas não pagos — estado corrompido
}
```

O Checks-Effects-Interactions (CEI) correto: verificações → efeitos de estado → interações externas.

---

## Mudança Necessária

### `Lunex/contracts/staking/lib.rs`

```rust
// CORRETO: transfer ANTES de atualizar o estado
let transfer_result = self.env().transfer(caller, reward_amount);
if transfer_result.is_err() {
    self.release_lock();
    return Err(StakingError::TransferFailed);
    // ✅ Transfer falhou — estado não foi modificado, rewards ainda disponíveis
}

// Só atualiza o estado APÓS o transfer bem-sucedido
stake.pending_rewards = 0;
stake.last_claim_timestamp = self.env().block_timestamp();
stakes.insert(&caller, &stake);
```

---

## Critérios de Aceitação

- [ ] `stakes.insert` (com `pending_rewards = 0`) ocorre **após** `transfer` bem-sucedido
- [ ] Em falha de `transfer` → função retorna `Err` sem modificar `stake.pending_rewards`
- [ ] Evento `RewardClaimed` emitido apenas após sucesso
- [ ] Teste cobrindo: transfer falha → rewards ainda disponíveis para claim posterior

---

## Verificação

```rust
// Teste ink!
#[ink::test]
fn claim_rewards_preserves_on_transfer_failure() {
    let mut contract = Staking::new(/* ... */);
    // Setup: staker com 100 LUNES em pending_rewards
    // Simular contrato sem saldo suficiente para pagar
    // Tentar claim → deve falhar
    let result = contract.claim_rewards();
    assert!(result.is_err());
    // Verificar que pending_rewards ainda é 100
    let stake = contract.get_stake(caller);
    assert_eq!(stake.pending_rewards, 100);
}
```

```bash
cd Lunex && cargo test -p staking -- claim_rewards
```
