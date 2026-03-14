//! # Lunes Native Assets Integration Module
//!
//! Este módulo permite integrar assets nativos da blockchain Lunes com a Lunex DEX.
//! A Lunes possui tokens nativos (não smart contracts), que podem ser:
//! - Issue/Reissue de tokens
//! - Transfer de assets
//! - Asset metadata (nome, descrição, decimais)
//!
//! ## Arquitetura de Integração:
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    LUNES BLOCKCHAIN                         │
//! ├─────────────────────────────────────────────────────────────┤
//! │  Native Assets (via REST API)    │  Smart Contracts (ink!)  │
//! │  ├── Issue Token                 │  ├── PSP22 Tokens        │
//! │  ├── Transfer Asset              │  ├── Factory             │
//! │  ├── Reissue Token               │  ├── Pair (AMM)          │
//! │  └── Asset Info                  │  └── Router              │
//! └─────────────────────────────────────────────────────────────┘
//!                         │
//!                         ▼
//! ┌─────────────────────────────────────────────────────────────┐
//! │               NATIVE ASSET WRAPPER (PSP22)                  │
//! │  Transforma assets nativos em tokens PSP22 para uso no DEX  │
//! └─────────────────────────────────────────────────────────────┘
//! ```

use std::collections::HashMap;

/// Representa um asset nativo da blockchain Lunes
#[derive(Debug, Clone)]
pub struct LunesNativeAsset {
    /// ID único do asset na blockchain
    pub asset_id: String,
    /// Nome do asset
    pub name: String,
    /// Símbolo do asset  
    pub symbol: String,
    /// Número de casas decimais
    pub decimals: u8,
    /// Supply total
    pub total_supply: u128,
    /// Se o asset é reissuable
    pub reissuable: bool,
    /// Descrição do asset
    pub description: String,
    /// Endereço do issuer
    pub issuer: String,
}

/// Tipos de assets suportados
#[derive(Debug, Clone, PartialEq)]
pub enum AssetType {
    /// Token nativo da Lunes (via REST API)
    NativeToken,
    /// Token PSP22 (smart contract)
    PSP22Token,
    /// Token nativo wrapeado como PSP22
    WrappedNativeToken,
}

/// Wrapper para converter assets nativos em interface PSP22
#[derive(Debug)]
pub struct NativeAssetWrapper {
    /// Asset nativo subjacente
    pub native_asset: LunesNativeAsset,
    /// Endereço do contrato wrapper PSP22
    pub wrapper_contract: String,
    /// Balances dos usuários no wrapper
    balances: HashMap<String, u128>,
    /// Total supply no wrapper
    wrapped_supply: u128,
}

impl NativeAssetWrapper {
    pub fn new(asset: LunesNativeAsset, wrapper_contract: String) -> Self {
        Self {
            native_asset: asset,
            wrapper_contract,
            balances: HashMap::new(),
            wrapped_supply: 0,
        }
    }

    /// Deposita asset nativo e recebe tokens PSP22
    pub fn wrap(&mut self, user: &str, amount: u128) -> Result<(), &'static str> {
        if amount == 0 { return Err("ZeroAmount"); }
        
        // Na implementação real, isso chamaria a API Lunes para verificar balance
        *self.balances.entry(user.to_string()).or_insert(0) += amount;
        self.wrapped_supply += amount;
        
        Ok(())
    }

    /// Queima tokens PSP22 e saca asset nativo
    pub fn unwrap(&mut self, user: &str, amount: u128) -> Result<(), &'static str> {
        if amount == 0 { return Err("ZeroAmount"); }
        
        let balance = self.balances.get(user).copied().unwrap_or(0);
        if balance < amount { return Err("InsufficientBalance"); }
        
        *self.balances.get_mut(user).unwrap() -= amount;
        self.wrapped_supply -= amount;
        
        Ok(())
    }

    pub fn balance_of(&self, user: &str) -> u128 {
        self.balances.get(user).copied().unwrap_or(0)
    }
}

/// Registry de assets nativos disponíveis para trading
#[derive(Debug)]
pub struct NativeAssetRegistry {
    /// Assets registrados por asset_id
    assets: HashMap<String, LunesNativeAsset>,
    /// Wrappers criados por asset_id
    wrappers: HashMap<String, NativeAssetWrapper>,
    /// Assets aprovados para listing no DEX
    approved_for_dex: HashMap<String, bool>,
}

impl NativeAssetRegistry {
    pub fn new() -> Self {
        Self {
            assets: HashMap::new(),
            wrappers: HashMap::new(),
            approved_for_dex: HashMap::new(),
        }
    }

    /// Registra um asset nativo da Lunes
    pub fn register_asset(&mut self, asset: LunesNativeAsset) -> Result<(), &'static str> {
        if self.assets.contains_key(&asset.asset_id) {
            return Err("AssetAlreadyRegistered");
        }
        self.assets.insert(asset.asset_id.clone(), asset);
        Ok(())
    }

    /// Cria um wrapper PSP22 para um asset nativo
    pub fn create_wrapper(&mut self, asset_id: &str) -> Result<String, &'static str> {
        let asset = self.assets.get(asset_id).ok_or("AssetNotFound")?.clone();
        
        if self.wrappers.contains_key(asset_id) {
            return Err("WrapperAlreadyExists");
        }

        let wrapper_address = format!("WRAPPER_{}", asset_id);
        let wrapper = NativeAssetWrapper::new(asset, wrapper_address.clone());
        self.wrappers.insert(asset_id.to_string(), wrapper);
        
        Ok(wrapper_address)
    }

    /// Aprova asset nativo para listing no DEX
    pub fn approve_for_dex(&mut self, asset_id: &str) -> Result<(), &'static str> {
        if !self.wrappers.contains_key(asset_id) {
            return Err("WrapperNotCreated");
        }
        self.approved_for_dex.insert(asset_id.to_string(), true);
        Ok(())
    }

    /// Verifica se asset está aprovado para DEX
    pub fn is_approved(&self, asset_id: &str) -> bool {
        self.approved_for_dex.get(asset_id).copied().unwrap_or(false)
    }

    /// Lista todos os assets aprovados
    pub fn list_approved_assets(&self) -> Vec<&LunesNativeAsset> {
        self.approved_for_dex.keys()
            .filter_map(|id| self.assets.get(id))
            .collect()
    }
}

// ============================================
// INTEGRAÇÃO COM API REST LUNES
// ============================================

/// Cliente para API REST da Lunes (para assets nativos)
#[derive(Debug)]
pub struct LunesNodeApiClient {
    pub node_url: String,
    pub api_key: Option<String>,
}

impl LunesNodeApiClient {
    pub fn new(node_url: &str) -> Self {
        Self {
            node_url: node_url.to_string(),
            api_key: None,
        }
    }

    /// Busca informações de um asset nativo
    pub fn get_asset_info(&self, asset_id: &str) -> Result<LunesNativeAsset, &'static str> {
        // Na implementação real, isso faria uma chamada HTTP:
        // GET {node_url}/assets/details/{asset_id}
        
        // Mock para demonstração
        Ok(LunesNativeAsset {
            asset_id: asset_id.to_string(),
            name: format!("Lunes Asset {}", asset_id),
            symbol: format!("LA{}", &asset_id[0..3].to_uppercase()),
            decimals: 8,
            total_supply: 1_000_000_000_000_000,
            reissuable: false,
            description: "Native Lunes blockchain asset".to_string(),
            issuer: "3P...".to_string(),
        })
    }

    /// Busca balance de um asset para um endereço
    pub fn get_asset_balance(&self, address: &str, asset_id: &str) -> Result<u128, &'static str> {
        // Na implementação real:
        // GET {node_url}/assets/balance/{address}/{asset_id}
        
        // Mock
        Ok(100_000_000_000) // 1000 tokens (8 decimals)
    }

    /// Lista todos os assets de um endereço
    pub fn list_assets(&self, address: &str) -> Result<Vec<(String, u128)>, &'static str> {
        // Na implementação real:
        // GET {node_url}/assets/balance/{address}
        
        // Mock
        Ok(vec![
            ("ASSET_USDT".to_string(), 50_000_000_000_000),
            ("ASSET_BTC".to_string(), 1_000_000_000),
            ("ASSET_ETH".to_string(), 10_000_000_000),
        ])
    }
}

// ============================================
// TESTES
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_asset_registration() {
        let mut registry = NativeAssetRegistry::new();
        
        let asset = LunesNativeAsset {
            asset_id: "ABC123".to_string(),
            name: "Test Token".to_string(),
            symbol: "TEST".to_string(),
            decimals: 8,
            total_supply: 1_000_000_000_000_000,
            reissuable: false,
            description: "Test native asset".to_string(),
            issuer: "3P...".to_string(),
        };

        assert!(registry.register_asset(asset).is_ok());
        assert!(registry.register_asset(LunesNativeAsset {
            asset_id: "ABC123".to_string(),
            ..Default::default()
        }).is_err()); // Duplicata deve falhar
    }

    #[test]
    fn test_wrapper_creation_and_operations() {
        let mut registry = NativeAssetRegistry::new();
        
        let asset = LunesNativeAsset {
            asset_id: "USDT_NATIVE".to_string(),
            name: "USDT Native".to_string(),
            symbol: "USDT".to_string(),
            decimals: 8,
            total_supply: 1_000_000_000_000_000,
            reissuable: true,
            description: "USDT stablecoin on Lunes".to_string(),
            issuer: "3P...".to_string(),
        };

        registry.register_asset(asset).unwrap();
        let wrapper_addr = registry.create_wrapper("USDT_NATIVE").unwrap();
        
        println!("✅ Wrapper criado: {}", wrapper_addr);
        
        // Aprovar para DEX
        registry.approve_for_dex("USDT_NATIVE").unwrap();
        assert!(registry.is_approved("USDT_NATIVE"));
    }

    #[test]
    fn test_wrap_unwrap_flow() {
        let asset = LunesNativeAsset {
            asset_id: "BTC_NATIVE".to_string(),
            name: "Wrapped BTC".to_string(),
            symbol: "WBTC".to_string(),
            decimals: 8,
            total_supply: 21_000_000_000_000_000,
            reissuable: false,
            description: "Bitcoin on Lunes".to_string(),
            issuer: "3P...".to_string(),
        };

        let mut wrapper = NativeAssetWrapper::new(asset, "WRAPPER_BTC".to_string());
        
        // User wraps 1 BTC
        wrapper.wrap("USER_A", 100_000_000).unwrap();
        assert_eq!(wrapper.balance_of("USER_A"), 100_000_000);
        
        // User unwraps 0.5 BTC
        wrapper.unwrap("USER_A", 50_000_000).unwrap();
        assert_eq!(wrapper.balance_of("USER_A"), 50_000_000);
        
        // Cannot unwrap more than balance
        assert!(wrapper.unwrap("USER_A", 100_000_000).is_err());
    }

    #[test]
    fn test_lunes_api_client() {
        let client = LunesNodeApiClient::new("https://nodes.lunes.io");
        
        // Buscar info de asset
        let asset = client.get_asset_info("SOME_ASSET_ID").unwrap();
        println!("Asset: {} ({})", asset.name, asset.symbol);
        
        // Buscar balance
        let balance = client.get_asset_balance("3P...", "SOME_ASSET_ID").unwrap();
        println!("Balance: {}", balance);
        
        // Listar assets
        let assets = client.list_assets("3P...").unwrap();
        println!("User has {} different assets", assets.len());
    }
}

impl Default for LunesNativeAsset {
    fn default() -> Self {
        Self {
            asset_id: String::new(),
            name: String::new(),
            symbol: String::new(),
            decimals: 8,
            total_supply: 0,
            reissuable: false,
            description: String::new(),
            issuer: String::new(),
        }
    }
}
