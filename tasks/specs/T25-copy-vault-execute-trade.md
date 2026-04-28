# Spec T25 — copy_vault::execute_trade com Cross-Contract Call Real

**Fase:** 5 — Smart Contracts (Sprint 3 semanas)  
**Esforço:** XL — quebrar em sub-tasks durante o sprint  
**Prioridade:** BLOQUEADOR ABSOLUTO

---

## Problema

`Lunex/contracts/copy_vault/lib.rs:667-760` — `execute_trade` é um stub:
```rust
// NOTE: In production this would be called as a callback after the router executes the swap.
// For now we track the intent.
// Equity updates happen via update_equity called by the backend.
```

O backend pode chamar `update_equity` arbitrariamente, sem verificação on-chain. Copy trading não move fundos reais.

---

## Arquitetura da Solução

```
CopyVault::execute_trade(pair, amount_in, min_amount_out)
    │
    ├── Verificações:
    │   - Caller é o leader do vault
    │   - Vault não está pausado
    │   - amount_in ≤ vault balance
    │   - Lock de reentrância adquirido
    │
    ├── Cross-contract call ao Router:
    │   router::swap(token_in, token_out, amount_in, min_amount_out, vault_address)
    │   │
    │   └── Router executa swap e retorna amount_out
    │
    ├── Atualizar equity baseado no resultado real:
    │   novo_equity = vault_balance_atual (lido do contrato de token)
    │
    └── Emitir evento TradeExecuted com amount_in, amount_out, mark_price
```

**Remover `update_equity`** (ou restringir a apenas o próprio contrato, nunca chamável externamente).

---

## Sub-tasks do Sprint

### Sub-task A (Dia 1–2): Interface cross-contract com Router
```rust
// Trait para chamar o Router
#[ink::trait_definition]
pub trait RouterRef {
    #[ink(message)]
    fn swap(
        &mut self,
        token_in: AccountId,
        token_out: AccountId,
        amount_in: Balance,
        min_amount_out: Balance,
        recipient: AccountId,
    ) -> Result<Balance, RouterError>;
}
```

### Sub-task B (Dia 3–5): Implementar execute_trade com call real
```rust
#[ink(message)]
pub fn execute_trade(
    &mut self,
    token_in: AccountId,
    token_out: AccountId,
    amount_in: Balance,
    min_amount_out: Balance,
) -> Result<Balance, VaultError> {
    let caller = self.env().caller();
    
    // Verificações
    self.ensure_leader(caller)?;
    self.ensure_not_paused()?;
    self.acquire_lock()?;
    
    // Verificar saldo suficiente
    let vault_balance = self.get_token_balance(token_in)?;
    if amount_in > vault_balance {
        self.release_lock();
        return Err(VaultError::InsufficientBalance);
    }
    
    // Cross-contract call ao Router
    let router_ref: ink::contract_ref!(RouterRef) = self.router.into();
    let amount_out = router_ref
        .call_mut()
        .swap(token_in, token_out, amount_in, min_amount_out, self.env().account_id())
        .try_invoke()
        .map_err(|_| VaultError::SwapFailed)?
        .map_err(|_| VaultError::SwapFailed)?;
    
    // Calcular novo equity (leitura do saldo real, não cálculo interno)
    let new_equity = self.calculate_total_equity()?;
    self.equity = new_equity;
    
    // Registrar trade no histórico
    self.trade_history.push(TradeRecord {
        timestamp: self.env().block_timestamp(),
        token_in, token_out, amount_in, amount_out,
    });
    
    self.env().emit_event(TradeExecuted {
        leader: caller,
        token_in, token_out, amount_in, amount_out,
        new_equity,
    });
    
    self.release_lock();
    Ok(amount_out)
}
```

### Sub-task C (Dia 6–8): Remover update_equity
```rust
// Remover o método público update_equity
// Ou restringir a apenas o próprio contrato:
fn update_equity_internal(&mut self) -> Result<(), VaultError> {
    self.equity = self.calculate_total_equity()?;
    Ok(())
}
```

### Sub-task D (Dia 9–12): Testes
- Teste: trade executado → equity atualizado corretamente
- Teste: swap falha → estado rollback
- Teste: balance insuficiente → erro sem side effects
- Fuzz test: invariante `total_shares * share_price ≈ vault_equity` mantida

### Sub-task E (Dia 13–15): Integração com Backend
- Backend para de chamar `update_equity` diretamente
- Backend lê equity do evento `TradeExecuted` (via SubQuery)
- Atualizar `copyVaultService.ts` para usar `execute_trade` com `isFinalized`

---

## Critérios de Aceitação

- [ ] `execute_trade` faz cross-contract call real ao Router
- [ ] Equity é calculado do saldo real de tokens, não de um campo interno arbitrário
- [ ] `update_equity` removido da ABI pública ou restrito ao próprio contrato
- [ ] Falha do Router → estado do vault não é modificado
- [ ] Invariante `total_shares * share_price ≈ vault_equity` mantida após trades
- [ ] Fuzz test verifica a invariante com inputs aleatórios
- [ ] Backend atualizado para não chamar `update_equity`
- [ ] Testes de integração: deposit → trade → withdraw → follower recebe proporção correta

---

## Perguntas em Aberto para o Sprint

1. **Router address**: como o vault sabe o endereço do Router? Configurado no construtor ou storage mutável?
2. **Token PSP22 do vault**: o vault tem seus próprios tokens de share (PSP22) ou usa um mecanismo interno?
3. **Slippage**: `min_amount_out` é calculado pelo leader off-chain ou existe oracle on-chain?
4. **Performance fee**: calculada sobre PnL do trade ou sobre equity total? Quando é coletada?

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Cross-contract call excede gas limit | Testar com posições grandes; ajustar gas forwarding |
| Router pode ser atualizado/substituído | Adicionar `set_router` restrito ao admin com timelock |
| Followers podem sacar durante trade | Lock de reentrância já previne isso |
| Cálculo de equity incorreto com múltiplos tokens | Usar preços do oracle para conversão, não apenas balances |
