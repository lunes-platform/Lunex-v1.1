# 🚀 Plano de Refatoração Lunex DEX - Upgrade para INK 4.2.1

## 📋 Resumo Executivo

Este documento detalha o plano completo de refatoração e atualização do Lunex DEX da versão INK 4.0 para INK 4.2.1, com foco em:
- **Segurança máxima** em todos os contratos
- **Compatibilidade PSP22** aprimorada
- **Metodologia TDD** (Test-Driven Development)
- **Substituição do OpenBrush** (descontinuado)
- **Integração com a rede Lunes**

---

## 🎯 Objetivos Principais

### 1. **Migração Técnica**
- ✅ Upgrade INK 4.0 → INK 4.2.1
- ✅ Substituir OpenBrush por Cardinal-Cryptography/PSP22 v2.0
- ✅ Atualizar dependências e toolchain
- ✅ Modernizar estrutura de código

### 2. **Segurança**
- 🔒 Implementar auditorias de segurança em cada contrato
- 🔒 Adicionar proteções contra reentrância
- 🔒 Validações rigorosas de entrada
- 🔒 Controles de acesso aprimorados

### 3. **Compatibilidade PSP22**
- 🪙 Implementação completa do padrão PSP22 v2.0
- 🪙 Suporte a metadados de tokens
- 🪙 Extensões Burnable e Mintable
- 🪙 Processo de listagem aprimorado

---

## 📊 Análise de Impacto

### **Contratos Afetados:**
1. **Factory Contract** - Migração completa
2. **Pair Contract** - Refatoração major
3. **Router Contract** - Atualização de APIs
4. **PSP22 Contract** - Substituição total
5. **WNative Contract** - Modernização

### **Dependências a Atualizar:**
```toml
# Antes (INK 4.0)
ink = { version = "4.0.0", default-features = false }
openbrush = { git = "https://github.com/727-Ventures/openbrush-contracts", version = "3.0.0" }

# Depois (INK 4.2.1)
ink = { version = "4.2.1", default-features = false }
psp22 = { version = "2.0", default-features = false, features = ["ink-as-dependency"] }
```

---

## 🗓️ Cronograma de Execução

### **Fase 1: Preparação e Setup (Semana 1-2)**
- [ ] Configurar ambiente INK 4.2.1
- [ ] Atualizar cargo-contract para versão 4.x
- [ ] Criar branch de desenvolvimento
- [ ] Configurar CI/CD para INK 4.2.1

### **Fase 2: Migração Base (Semana 3-4)**
- [ ] Migrar estrutura básica dos contratos
- [ ] Implementar PSP22 v2.0
- [ ] Atualizar imports e dependências
- [ ] Testes básicos de compilação

### **Fase 3: Refatoração de Segurança (Semana 5-6)**
- [ ] Implementar proteções de reentrância
- [ ] Adicionar validações de entrada
- [ ] Auditoria de controles de acesso
- [ ] Testes de segurança

### **Fase 4: Testes e Validação (Semana 7-8)**
- [ ] Implementar suite completa de testes TDD
- [ ] Testes de integração
- [ ] Testes de stress e performance
- [ ] Validação na rede Lunes testnet

### **Fase 5: Deploy e Monitoramento (Semana 9-10)**
- [ ] Deploy na rede Lunes testnet
- [ ] Testes finais de integração
- [ ] Deploy na mainnet
- [ ] Monitoramento e otimizações

---

## 🔧 Detalhes Técnicos da Migração

### **1. Estrutura de Dependências Atualizada**

```toml
[dependencies]
ink = { version = "4.2.1", default-features = false }
scale = { package = "parity-scale-codec", version = "3", default-features = false, features = ["derive"] }
scale-info = { version = "2.10", default-features = false, features = ["derive"], optional = true }
psp22 = { version = "2.0", default-features = false, features = ["ink-as-dependency"] }

[features]
default = ["std"]
std = [
    "ink/std",
    "scale/std",
    "scale-info/std",
    "psp22/std"
]
```

### **2. Mudanças na Estrutura de Imports**

```rust
// Antes (INK 4.0)
use ink_lang as ink;
use ink_env;
use ink_storage;

// Depois (INK 4.2.1)
use ink;
use ink::env;
use ink::storage;
```

### **3. Nova Implementação PSP22**

```rust
// Implementação usando Cardinal-Cryptography/PSP22
use psp22::{PSP22, PSP22Data, PSP22Error, PSP22Event};

#[ink(storage)]
pub struct Token {
    psp22: PSP22Data,
}

impl PSP22 for Token {
    // Implementação dos métodos PSP22
}
```

---

## 🛡️ Melhorias de Segurança

### **1. Proteção contra Reentrância**
```rust
use ink::storage::Mapping;

#[ink(storage)]
pub struct SecurePair {
    locked: bool,
    // outros campos...
}

impl SecurePair {
    fn non_reentrant(&mut self) -> Result<(), PairError> {
        if self.locked {
            return Err(PairError::ReentrancyGuard);
        }
        self.locked = true;
        Ok(())
    }
    
    fn unlock(&mut self) {
        self.locked = false;
    }
}
```

### **2. Validações Rigorosas**
```rust
fn validate_swap_params(
    amount_in: Balance,
    amount_out_min: Balance,
    path: Vec<AccountId>,
) -> Result<(), RouterError> {
    if amount_in == 0 {
        return Err(RouterError::InsufficientAmount);
    }
    if path.len() < 2 {
        return Err(RouterError::InvalidPath);
    }
    if amount_out_min > amount_in {
        return Err(RouterError::InvalidSlippage);
    }
    Ok(())
}
```

### **3. Controles de Acesso**
```rust
#[ink(storage)]
pub struct Factory {
    owner: AccountId,
    fee_to_setter: AccountId,
    // outros campos...
}

impl Factory {
    fn only_owner(&self) -> Result<(), FactoryError> {
        if self.env().caller() != self.owner {
            return Err(FactoryError::Unauthorized);
        }
        Ok(())
    }
}
```

---

## 🧪 Estratégia TDD (Test-Driven Development)

### **1. Estrutura de Testes**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use ink::env::test;
    use psp22::tests;

    // Testes PSP22 automáticos
    psp22::tests!(Token, (|total_supply| Token::new(total_supply)));

    #[ink::test]
    fn test_factory_create_pair() {
        // Arrange
        let mut factory = Factory::new(AccountId::from([0x01; 32]));
        let token_a = AccountId::from([0x02; 32]);
        let token_b = AccountId::from([0x03; 32]);

        // Act
        let result = factory.create_pair(token_a, token_b);

        // Assert
        assert!(result.is_ok());
    }

    #[ink::test]
    fn test_pair_swap_security() {
        // Testes de segurança para swaps
    }
}
```

### **2. Testes de Integração**
```rust
// tests/integration_tests.rs
#[cfg(test)]
mod integration_tests {
    use super::*;

    #[ink::test]
    fn test_full_swap_flow() {
        // Teste completo do fluxo de swap
        // Factory -> Pair -> Router
    }

    #[ink::test]
    fn test_liquidity_provision() {
        // Teste de provisão de liquidez
    }
}
```

---

## 🌐 Configuração para Rede Lunes

### **1. Endpoints de Rede**
```rust
// config/network.rs
pub struct LunesConfig {
    pub testnet_ws: &'static str,
    pub mainnet_ws: Vec<&'static str>,
}

impl LunesConfig {
    pub const fn new() -> Self {
        Self {
            testnet_ws: "wss://ws-test.lunes.io",
            mainnet_ws: vec![
                "wss://ws.lunes.io",
                "wss://ws-lunes-main-01.lunes.io",
                "wss://ws-lunes-main-02.lunes.io",
                "wss://ws-archive.lunes.io"
            ],
        }
    }
}
```

### **2. Scripts de Deploy**
```typescript
// scripts/deploy-lunes.ts
import { LunesConfig } from '../config/network';

async function deployToLunes() {
    const config = new LunesConfig();
    
    // Deploy na testnet primeiro
    await deployContracts(config.testnet_ws);
    
    // Após validação, deploy na mainnet
    await deployContracts(config.mainnet_ws[0]);
}
```

---

## 📈 Melhorias no Processo de Listagem

### **1. Validação Automática de Tokens**
```rust
#[ink(message)]
pub fn validate_token_for_listing(
    &self,
    token: AccountId,
) -> Result<TokenInfo, FactoryError> {
    // Verificar se implementa PSP22
    let psp22_ref: PSP22Ref = token.into();
    
    // Validar metadados
    let name = psp22_ref.token_name()?;
    let symbol = psp22_ref.token_symbol()?;
    let decimals = psp22_ref.token_decimals()?;
    
    // Verificações de segurança
    self.validate_token_security(&token)?;
    
    Ok(TokenInfo { name, symbol, decimals })
}
```

### **2. Sistema de Aprovação**
```rust
#[ink(storage)]
pub struct TokenRegistry {
    approved_tokens: Mapping<AccountId, TokenInfo>,
    pending_tokens: Mapping<AccountId, TokenInfo>,
    admin: AccountId,
}

#[ink(message)]
pub fn approve_token(&mut self, token: AccountId) -> Result<(), RegistryError> {
    self.only_admin()?;
    
    let token_info = self.pending_tokens.get(&token)
        .ok_or(RegistryError::TokenNotFound)?;
    
    self.approved_tokens.insert(&token, &token_info);
    self.pending_tokens.remove(&token);
    
    Ok(())
}
```

---

## ⚠️ Riscos e Mitigações

### **Riscos Identificados:**
1. **Incompatibilidade de contratos existentes**
   - *Mitigação:* Testes extensivos e deploy gradual

2. **Problemas de performance**
   - *Mitigação:* Benchmarks e otimizações

3. **Vulnerabilidades de segurança**
   - *Mitigação:* Auditorias e testes de penetração

4. **Problemas de liquidez durante migração**
   - *Mitigação:* Migração gradual com incentivos

---

## 📚 Documentação e Recursos

### **Recursos de Referência:**
- [INK 4.2.1 Documentation](https://use.ink/)
- [Cardinal-Cryptography PSP22](https://github.com/Cardinal-Cryptography/PSP22)
- [Substrate Contracts Pallet](https://docs.substrate.io/reference/frame-pallets/#contracts)
- [Lunes Network Documentation](https://docs.lunes.io/)

### **Ferramentas Necessárias:**
- Rust stable >= 1.70
- cargo-contract >= 4.0
- substrate-contracts-node >= 0.32.0
- Node.js >= 18 para scripts

---

## ✅ Checklist de Conclusão

### **Pré-Deploy:**
- [ ] Todos os testes passando (unit + integration)
- [ ] Auditoria de segurança completa
- [ ] Documentação atualizada
- [ ] Scripts de migração testados

### **Deploy:**
- [ ] Deploy na testnet Lunes
- [ ] Testes de stress na testnet
- [ ] Validação da comunidade
- [ ] Deploy na mainnet

### **Pós-Deploy:**
- [ ] Monitoramento ativo
- [ ] Suporte à migração de usuários
- [ ] Documentação para desenvolvedores
- [ ] Feedback e otimizações

---

## 🤝 Próximos Passos

1. **Revisar e aprovar este plano**
2. **Configurar ambiente de desenvolvimento**
3. **Iniciar Fase 1: Preparação e Setup**
4. **Estabelecer cronograma detalhado**
5. **Formar equipe de desenvolvimento e auditoria**

---

*Este documento será atualizado conforme o progresso do projeto. Todas as mudanças serão documentadas e versionadas.*

**Versão:** 1.0  
**Data:** 04 de Agosto de 2025  
**Status:** Aguardando Aprovação
