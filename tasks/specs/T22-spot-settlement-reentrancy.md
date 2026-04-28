# Spec T22 — Reentrancy Guard no spot_settlement (Rust/ink!)

**Fase:** 5 — Smart Contracts  
**Esforço:** S (~4h)  
**Prioridade:** ALTA

---

## Problema

`Lunex/contracts/spot_settlement/lib.rs` — sem reentrancy guard. `deposit_psp22` e `withdraw_psp22` fazem cross-contract calls PSP22. Um token PSP22 malicioso com callback pode re-entrar enquanto o estado interno ainda está em transição.

O `copy_vault` já implementa o padrão correto (`VaultError::Reentrancy` + `locked: bool` no storage).

---

## Mudança Necessária

### `Lunex/contracts/spot_settlement/lib.rs`

**1. Adicionar ao struct de storage:**
```rust
#[ink(storage)]
pub struct SpotSettlement {
    // ... campos existentes ...
    reentrancy_lock: bool,
}
```

**2. Adicionar helper methods:**
```rust
fn acquire_lock(&mut self) -> Result<(), SpotError> {
    if self.reentrancy_lock {
        return Err(SpotError::Reentrancy)
    }
    self.reentrancy_lock = true;
    Ok(())
}

fn release_lock(&mut self) {
    self.reentrancy_lock = false;
}
```

**3. Aplicar em deposit_psp22 e withdraw_psp22:**
```rust
#[ink(message)]
pub fn deposit_psp22(&mut self, token: AccountId, amount: Balance) -> Result<(), SpotError> {
    self.acquire_lock()?;  // ← NOVO
    
    // ... lógica existente ...
    
    self.release_lock();   // ← NOVO (antes do return Ok)
    Ok(())
}

#[ink(message)]
pub fn withdraw_psp22(&mut self, token: AccountId, amount: Balance) -> Result<(), SpotError> {
    self.acquire_lock()?;  // ← NOVO
    
    // ... lógica existente ...
    
    self.release_lock();   // ← NOVO
    Ok(())
}
```

**4. Inicializar no constructor:**
```rust
Self {
    // ... campos existentes ...
    reentrancy_lock: false,
}
```

---

## Critérios de Aceitação

- [ ] `reentrancy_lock: bool` no storage do contrato
- [ ] `acquire_lock()` retorna `Err(SpotError::Reentrancy)` se lock já adquirido
- [ ] `deposit_psp22` e `withdraw_psp22` adquirem e liberam o lock
- [ ] Lock liberado em todos os caminhos de retorno (incluindo erros)
- [ ] `SpotError::Reentrancy` adicionado ao enum de erros
- [ ] Teste: tentativa de reentrância retorna `Err(SpotError::Reentrancy)`

---

## Verificação

```rust
#[ink::test]
fn deposit_prevents_reentrancy() {
    // Simular token PSP22 malicioso que tenta re-entrar no deposit
    // deposit_psp22 → token.transfer_from callback → deposit_psp22 novamente
    // Segunda chamada deve retornar Err(SpotError::Reentrancy)
}
```

```bash
cd Lunex && cargo test -p spot_settlement -- reentrancy
```
