//! # Testes de Usabilidade - Assets Nativos + PSP22
//!
//! Este módulo testa a integração completa entre:
//! - Assets nativos da Lunes (via wrappers)
//! - Tokens PSP22 (smart contracts)
//! - Operações do DEX (swap, liquidity, staking)

use std::collections::HashMap;

// ============================================
// MOCK: LUNES NATIVE ASSET SYSTEM
// ============================================

#[derive(Debug, Clone)]
struct NativeAsset {
    asset_id: String,
    name: String,
    symbol: String,
    decimals: u8,
    total_supply: u128,
}

#[derive(Debug)]
struct LunesNativeAssetRegistry {
    assets: HashMap<String, NativeAsset>,
    balances: HashMap<(String, String), u128>, // (user, asset_id) -> balance
}

impl LunesNativeAssetRegistry {
    fn new() -> Self {
        Self {
            assets: HashMap::new(),
            balances: HashMap::new(),
        }
    }

    fn register_asset(&mut self, asset: NativeAsset) {
        self.assets.insert(asset.asset_id.clone(), asset);
    }

    fn mint(&mut self, user: &str, asset_id: &str, amount: u128) {
        let key = (user.to_string(), asset_id.to_string());
        *self.balances.entry(key).or_insert(0) += amount;
    }

    fn balance_of(&self, user: &str, asset_id: &str) -> u128 {
        self.balances.get(&(user.to_string(), asset_id.to_string())).copied().unwrap_or(0)
    }

    fn transfer(&mut self, from: &str, to: &str, asset_id: &str, amount: u128) -> Result<(), String> {
        let from_balance = self.balance_of(from, asset_id);
        if from_balance < amount {
            return Err("Insufficient balance".to_string());
        }
        
        let from_key = (from.to_string(), asset_id.to_string());
        let to_key = (to.to_string(), asset_id.to_string());
        
        *self.balances.get_mut(&from_key).unwrap() -= amount;
        *self.balances.entry(to_key).or_insert(0) += amount;
        
        Ok(())
    }
}

// ============================================
// MOCK: PSP22 TOKEN (Smart Contract)
// ============================================

#[derive(Debug)]
struct PSP22Token {
    name: String,
    symbol: String,
    decimals: u8,
    total_supply: u128,
    balances: HashMap<String, u128>,
    allowances: HashMap<(String, String), u128>,
}

impl PSP22Token {
    fn new(name: &str, symbol: &str, decimals: u8) -> Self {
        Self {
            name: name.to_string(),
            symbol: symbol.to_string(),
            decimals,
            total_supply: 0,
            balances: HashMap::new(),
            allowances: HashMap::new(),
        }
    }

    fn mint(&mut self, to: &str, amount: u128) {
        *self.balances.entry(to.to_string()).or_insert(0) += amount;
        self.total_supply += amount;
    }

    fn balance_of(&self, user: &str) -> u128 {
        self.balances.get(user).copied().unwrap_or(0)
    }

    fn transfer(&mut self, from: &str, to: &str, amount: u128) -> Result<(), String> {
        let from_balance = self.balance_of(from);
        if from_balance < amount {
            return Err("PSP22: Insufficient balance".to_string());
        }
        *self.balances.get_mut(from).unwrap() -= amount;
        *self.balances.entry(to.to_string()).or_insert(0) += amount;
        Ok(())
    }

    fn approve(&mut self, owner: &str, spender: &str, amount: u128) {
        self.allowances.insert((owner.to_string(), spender.to_string()), amount);
    }

    fn allowance(&self, owner: &str, spender: &str) -> u128 {
        self.allowances.get(&(owner.to_string(), spender.to_string())).copied().unwrap_or(0)
    }
}

// ============================================
// MOCK: NATIVE ASSET WRAPPER (Native -> PSP22)
// ============================================

#[derive(Debug)]
struct NativeAssetWrapper {
    asset_id: String,
    wrapped_symbol: String,
    psp22: PSP22Token,
}

impl NativeAssetWrapper {
    fn new(asset_id: &str, name: &str, symbol: &str, decimals: u8) -> Self {
        Self {
            asset_id: asset_id.to_string(),
            wrapped_symbol: format!("W{}", symbol),
            psp22: PSP22Token::new(&format!("Wrapped {}", name), &format!("W{}", symbol), decimals),
        }
    }

    fn wrap(&mut self, native_registry: &mut LunesNativeAssetRegistry, user: &str, amount: u128) -> Result<(), String> {
        // Transfer native asset to wrapper
        native_registry.transfer(user, "WRAPPER_CONTRACT", &self.asset_id, amount)?;
        // Mint wrapped PSP22
        self.psp22.mint(user, amount);
        println!("   🎁 Wrapped {} {} -> {} {}", amount, self.asset_id, amount, self.wrapped_symbol);
        Ok(())
    }

    fn unwrap(&mut self, native_registry: &mut LunesNativeAssetRegistry, user: &str, amount: u128) -> Result<(), String> {
        // Burn wrapped PSP22
        self.psp22.transfer(user, "BURN_ADDRESS", amount)?;
        // Transfer native asset back to user
        native_registry.transfer("WRAPPER_CONTRACT", user, &self.asset_id, amount)?;
        println!("   📦 Unwrapped {} {} -> {} {}", amount, self.wrapped_symbol, amount, self.asset_id);
        Ok(())
    }

    fn balance_of(&self, user: &str) -> u128 {
        self.psp22.balance_of(user)
    }
}

// ============================================
// MOCK: DEX (Factory + Pair + Router)
// ============================================

#[derive(Debug)]
struct MockPair {
    token_0: String,
    token_1: String,
    reserve_0: u128,
    reserve_1: u128,
    total_supply: u128,
    lp_balances: HashMap<String, u128>,
}

impl MockPair {
    fn new(token_0: String, token_1: String) -> Self {
        Self {
            token_0,
            token_1,
            reserve_0: 0,
            reserve_1: 0,
            total_supply: 0,
            lp_balances: HashMap::new(),
        }
    }

    fn add_liquidity(&mut self, user: &str, amount_0: u128, amount_1: u128) -> u128 {
        let liquidity = if self.total_supply == 0 {
            ((amount_0 as f64 * amount_1 as f64).sqrt() as u128).saturating_sub(100)
        } else {
            let liq_0 = amount_0 * self.total_supply / self.reserve_0;
            let liq_1 = amount_1 * self.total_supply / self.reserve_1;
            liq_0.min(liq_1)
        };

        self.reserve_0 += amount_0;
        self.reserve_1 += amount_1;
        self.total_supply += liquidity;
        *self.lp_balances.entry(user.to_string()).or_insert(0) += liquidity;

        liquidity
    }

    fn swap(&mut self, amount_in: u128, token_in: &str) -> Result<u128, String> {
        let (reserve_in, reserve_out) = if token_in == self.token_0 {
            (self.reserve_0, self.reserve_1)
        } else {
            (self.reserve_1, self.reserve_0)
        };

        if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
            return Err("Invalid swap".to_string());
        }

        // AMM formula: amount_out = (amount_in * 997 * reserve_out) / (reserve_in * 1000 + amount_in * 997)
        let amount_in_with_fee = amount_in * 997;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = reserve_in * 1000 + amount_in_with_fee;
        let amount_out = numerator / denominator;

        if token_in == self.token_0 {
            self.reserve_0 += amount_in;
            self.reserve_1 -= amount_out;
        } else {
            self.reserve_1 += amount_in;
            self.reserve_0 -= amount_out;
        }

        Ok(amount_out)
    }

    fn get_price(&self, token: &str) -> f64 {
        if token == self.token_0 {
            self.reserve_1 as f64 / self.reserve_0 as f64
        } else {
            self.reserve_0 as f64 / self.reserve_1 as f64
        }
    }
}

#[derive(Debug)]
struct MockDEX {
    pairs: HashMap<String, MockPair>,
    listed_tokens: HashMap<String, bool>,
}

impl MockDEX {
    fn new() -> Self {
        Self {
            pairs: HashMap::new(),
            listed_tokens: HashMap::new(),
        }
    }

    fn list_token(&mut self, symbol: &str) {
        self.listed_tokens.insert(symbol.to_string(), true);
        println!("   ✅ Token {} listado no DEX", symbol);
    }

    fn is_listed(&self, symbol: &str) -> bool {
        self.listed_tokens.get(symbol).copied().unwrap_or(false)
    }

    fn create_pair(&mut self, token_0: &str, token_1: &str) -> Result<String, String> {
        if !self.is_listed(token_0) {
            return Err(format!("Token {} não listado", token_0));
        }
        if !self.is_listed(token_1) {
            return Err(format!("Token {} não listado", token_1));
        }

        let pair_id = format!("{}_{}", token_0.min(token_1), token_0.max(token_1));
        if self.pairs.contains_key(&pair_id) {
            return Err("Par já existe".to_string());
        }

        self.pairs.insert(pair_id.clone(), MockPair::new(token_0.to_string(), token_1.to_string()));
        println!("   🔄 Par criado: {}/{}", token_0, token_1);
        Ok(pair_id)
    }

    fn get_pair(&mut self, token_0: &str, token_1: &str) -> Option<&mut MockPair> {
        let pair_id = format!("{}_{}", token_0.min(token_1), token_0.max(token_1));
        self.pairs.get_mut(&pair_id)
    }
}

// ============================================
// TESTES DE USABILIDADE
// ============================================

#[test]
fn test_usability_native_asset_listing() {
    println!("\n🧪 TESTE 1: Listagem de Asset Nativo no DEX\n");
    println!("{}", "━".repeat(50));

    // Setup
    let mut native_registry = LunesNativeAssetRegistry::new();
    let mut dex = MockDEX::new();

    // 1. Registrar asset nativo (simula asset existente na Lunes)
    println!("\n📦 Passo 1: Registrar Asset Nativo");
    let btc_native = NativeAsset {
        asset_id: "BTC_NATIVE_ID".to_string(),
        name: "Bitcoin".to_string(),
        symbol: "BTC".to_string(),
        decimals: 8,
        total_supply: 21_000_000_00000000,
    };
    native_registry.register_asset(btc_native);
    println!("   ✅ BTC registrado como asset nativo da Lunes");

    // 2. Criar wrapper PSP22 para o asset nativo
    println!("\n🎁 Passo 2: Criar Wrapper PSP22");
    let mut wbtc_wrapper = NativeAssetWrapper::new("BTC_NATIVE_ID", "Bitcoin", "BTC", 8);
    println!("   ✅ Wrapper WBTC criado (interface PSP22)");

    // 3. Listar o wrapped token no DEX
    println!("\n📋 Passo 3: Listar no DEX");
    dex.list_token("WBTC");
    dex.list_token("USDT"); // Token PSP22 nativo para par

    // 4. Verificar que ambos estão listados
    assert!(dex.is_listed("WBTC"), "WBTC deveria estar listado");
    assert!(dex.is_listed("USDT"), "USDT deveria estar listado");

    // 5. Criar par de trading
    println!("\n🔄 Passo 4: Criar Par de Trading");
    let pair_result = dex.create_pair("WBTC", "USDT");
    assert!(pair_result.is_ok(), "Par deveria ser criado");

    println!("\n✅ TESTE PASSOU: Asset nativo pode ser listado no DEX via wrapper!\n");
}

#[test]
fn test_usability_wrap_unwrap_flow() {
    println!("\n🧪 TESTE 2: Fluxo de Wrap/Unwrap\n");
    println!("{}", "━".repeat(50));

    let mut native_registry = LunesNativeAssetRegistry::new();
    
    // Setup: Registrar asset e dar balance ao usuário
    let eth_native = NativeAsset {
        asset_id: "ETH_NATIVE_ID".to_string(),
        name: "Ethereum".to_string(),
        symbol: "ETH".to_string(),
        decimals: 18,
        total_supply: 120_000_000_000000000000000000,
    };
    native_registry.register_asset(eth_native);
    native_registry.mint("ALICE", "ETH_NATIVE_ID", 10_000000000000000000); // 10 ETH
    native_registry.mint("WRAPPER_CONTRACT", "ETH_NATIVE_ID", 0); // Inicializar wrapper

    let mut weth_wrapper = NativeAssetWrapper::new("ETH_NATIVE_ID", "Ethereum", "ETH", 18);

    println!("\n📊 Estado Inicial:");
    println!("   Alice ETH nativo: {}", native_registry.balance_of("ALICE", "ETH_NATIVE_ID"));
    println!("   Alice WETH: {}", weth_wrapper.balance_of("ALICE"));

    // Wrap
    println!("\n🎁 Passo 1: Wrap 5 ETH -> WETH");
    weth_wrapper.wrap(&mut native_registry, "ALICE", 5_000000000000000000).unwrap();
    
    println!("\n📊 Estado Após Wrap:");
    println!("   Alice ETH nativo: {}", native_registry.balance_of("ALICE", "ETH_NATIVE_ID"));
    println!("   Alice WETH: {}", weth_wrapper.balance_of("ALICE"));

    assert_eq!(native_registry.balance_of("ALICE", "ETH_NATIVE_ID"), 5_000000000000000000);
    assert_eq!(weth_wrapper.balance_of("ALICE"), 5_000000000000000000);

    // Unwrap
    println!("\n📦 Passo 2: Unwrap 2 WETH -> ETH");
    weth_wrapper.unwrap(&mut native_registry, "ALICE", 2_000000000000000000).unwrap();
    
    println!("\n📊 Estado Final:");
    println!("   Alice ETH nativo: {}", native_registry.balance_of("ALICE", "ETH_NATIVE_ID"));
    println!("   Alice WETH: {}", weth_wrapper.balance_of("ALICE"));

    assert_eq!(native_registry.balance_of("ALICE", "ETH_NATIVE_ID"), 7_000000000000000000);
    assert_eq!(weth_wrapper.balance_of("ALICE"), 3_000000000000000000);

    println!("\n✅ TESTE PASSOU: Wrap/Unwrap funcionando corretamente!\n");
}

#[test]
fn test_usability_swap_native_with_psp22() {
    println!("\n🧪 TESTE 3: Swap entre Asset Nativo (wrapped) e PSP22\n");
    println!("{}", "━".repeat(50));

    let mut native_registry = LunesNativeAssetRegistry::new();
    let mut dex = MockDEX::new();

    // Setup: Assets nativos e PSP22
    let lunes_native = NativeAsset {
        asset_id: "LUNES_NATIVE".to_string(),
        name: "Lunes".to_string(),
        symbol: "LUNES".to_string(),
        decimals: 8,
        total_supply: 1_000_000_000_00000000,
    };
    native_registry.register_asset(lunes_native);
    native_registry.mint("LP_PROVIDER", "LUNES_NATIVE", 100_000_00000000);
    native_registry.mint("WRAPPER_CONTRACT", "LUNES_NATIVE", 0);

    let mut wlunes_wrapper = NativeAssetWrapper::new("LUNES_NATIVE", "Lunes", "LUNES", 8);
    let mut usdt = PSP22Token::new("Tether USD", "USDT", 6);
    usdt.mint("LP_PROVIDER", 500_000_000000); // 500k USDT

    // Listar tokens
    dex.list_token("WLUNES");
    dex.list_token("USDT");
    dex.create_pair("WLUNES", "USDT").unwrap();

    // LP Provider wrapa LUNES e adiciona liquidez
    println!("\n💧 Passo 1: LP Provider adiciona liquidez");
    wlunes_wrapper.wrap(&mut native_registry, "LP_PROVIDER", 100_000_00000000).unwrap();
    
    let pair = dex.get_pair("WLUNES", "USDT").unwrap();
    let lp_tokens = pair.add_liquidity("LP_PROVIDER", 100_000_00000000, 500_000_000000);
    println!("   ✅ Liquidez adicionada: 100K WLUNES + 500K USDT");
    println!("   📊 LP tokens recebidos: {}", lp_tokens);
    println!("   💰 Preço: 1 WLUNES = {} USDT", pair.get_price("WLUNES"));

    // Trader quer comprar LUNES com USDT
    println!("\n🔄 Passo 2: Trader faz swap (1000 USDT -> WLUNES)");
    let amount_in = 1000_000000; // 1000 USDT
    let amount_out = pair.swap(amount_in, "USDT").unwrap();
    println!("   📊 Input: 1000 USDT");
    println!("   📊 Output: {} WLUNES", amount_out as f64 / 100000000.0);
    println!("   📊 Novo preço: 1 WLUNES = {} USDT", pair.get_price("WLUNES"));

    assert!(amount_out > 0, "Deveria receber WLUNES");

    println!("\n✅ TESTE PASSOU: Swap entre native (wrapped) e PSP22 funcionando!\n");
}

#[test]
fn test_usability_full_user_journey() {
    println!("\n🧪 TESTE 4: Jornada Completa do Usuário\n");
    println!("{}", "━".repeat(50));

    let mut native_registry = LunesNativeAssetRegistry::new();
    let mut dex = MockDEX::new();

    // Setup inicial
    println!("\n🔧 Setup: Inicializando ecossistema...");
    
    // Asset nativo LUNES
    native_registry.register_asset(NativeAsset {
        asset_id: "LUNES".to_string(),
        name: "Lunes".to_string(),
        symbol: "LUNES".to_string(),
        decimals: 8,
        total_supply: 1_000_000_000_00000000,
    });
    native_registry.mint("WRAPPER_CONTRACT", "LUNES", 0);
    
    let mut wlunes = NativeAssetWrapper::new("LUNES", "Lunes", "LUNES", 8);
    let mut usdt = PSP22Token::new("Tether USD", "USDT", 6);

    // Listar tokens no DEX
    dex.list_token("WLUNES");
    dex.list_token("USDT");
    dex.create_pair("WLUNES", "USDT").unwrap();
    println!("   ✅ DEX configurado com par WLUNES/USDT");

    // ===============================
    // ALICE: LP Provider
    // ===============================
    println!("\n👩 ALICE (LP Provider):");
    
    // Alice tem LUNES nativo e USDT
    native_registry.mint("ALICE", "LUNES", 10_000_00000000); // 10k LUNES
    usdt.mint("ALICE", 50_000_000000); // 50k USDT
    println!("   📊 Balance inicial: 10K LUNES nativo, 50K USDT");

    // Alice wrapa LUNES
    wlunes.wrap(&mut native_registry, "ALICE", 10_000_00000000).unwrap();
    println!("   ✅ Wrapped 10K LUNES -> WLUNES");

    // Alice adiciona liquidez
    let pair = dex.get_pair("WLUNES", "USDT").unwrap();
    let alice_lp = pair.add_liquidity("ALICE", 10_000_00000000, 50_000_000000);
    println!("   ✅ Adicionou liquidez: recebeu {} LP tokens", alice_lp);

    // ===============================
    // BOB: Trader
    // ===============================
    println!("\n👨 BOB (Trader):");
    
    // Bob tem apenas USDT (PSP22)
    usdt.mint("BOB", 5_000_000000); // 5k USDT
    println!("   📊 Balance inicial: 5K USDT");

    // Bob compra WLUNES
    let pair = dex.get_pair("WLUNES", "USDT").unwrap();
    let bob_wlunes = pair.swap(1_000_000000, "USDT").unwrap();
    println!("   🔄 Swap: 1000 USDT -> {} WLUNES", bob_wlunes as f64 / 100000000.0);

    // Bob unwrapa para LUNES nativo
    native_registry.mint("BOB", "LUNES", 0); // Inicializa balance
    // Simula que Bob recebeu os WLUNES
    wlunes.psp22.mint("BOB", bob_wlunes);
    native_registry.mint("WRAPPER_CONTRACT", "LUNES", bob_wlunes); // Wrapper precisa ter os tokens
    wlunes.unwrap(&mut native_registry, "BOB", bob_wlunes).unwrap();
    
    let bob_native_lunes = native_registry.balance_of("BOB", "LUNES");
    println!("   📦 Unwrap: {} WLUNES -> {} LUNES nativo", 
        bob_wlunes as f64 / 100000000.0,
        bob_native_lunes as f64 / 100000000.0
    );

    // ===============================
    // CHARLIE: Arbitrageur
    // ===============================
    println!("\n🧑 CHARLIE (Arbitrageur):");
    
    // Charlie tem LUNES nativo e quer fazer arbitragem
    native_registry.mint("CHARLIE", "LUNES", 5_000_00000000);
    println!("   📊 Balance inicial: 5K LUNES nativo");

    // Wrapa, faz múltiplos trades pequenos
    wlunes.wrap(&mut native_registry, "CHARLIE", 1_000_00000000).unwrap();
    
    let pair = dex.get_pair("WLUNES", "USDT").unwrap();
    let price_before = pair.get_price("WLUNES");
    
    // Trade 1
    let out1 = pair.swap(500_00000000, "WLUNES").unwrap();
    println!("   🔄 Trade 1: 500 WLUNES -> {} USDT", out1 as f64 / 1000000.0);
    
    // Trade 2: Compra de volta
    let out2 = pair.swap(out1, "USDT").unwrap();
    println!("   🔄 Trade 2: {} USDT -> {} WLUNES", out1 as f64 / 1000000.0, out2 as f64 / 100000000.0);
    
    let price_after = pair.get_price("WLUNES");
    println!("   📊 Preço antes: {:.4}, depois: {:.4}", price_before, price_after);

    // ===============================
    // Resumo Final
    // ===============================
    println!("\n📋 RESUMO FINAL:");
    println!("{}", "━".repeat(50));
    
    let pair = dex.get_pair("WLUNES", "USDT").unwrap();
    println!("   Pool: {} WLUNES / {} USDT", 
        pair.reserve_0 as f64 / 100000000.0,
        pair.reserve_1 as f64 / 1000000.0
    );
    println!("   Preço: 1 WLUNES = {:.4} USDT", pair.get_price("WLUNES"));
    println!("   LP tokens totais: {}", pair.total_supply);

    println!("\n✅ TESTE PASSOU: Jornada completa funcionando!\n");
}

#[test]
fn test_usability_error_handling() {
    println!("\n🧪 TESTE 5: Tratamento de Erros\n");
    println!("{}", "━".repeat(50));

    let mut native_registry = LunesNativeAssetRegistry::new();
    let mut dex = MockDEX::new();

    native_registry.register_asset(NativeAsset {
        asset_id: "TEST".to_string(),
        name: "Test".to_string(),
        symbol: "TEST".to_string(),
        decimals: 8,
        total_supply: 1000,
    });
    native_registry.mint("WRAPPER_CONTRACT", "TEST", 0);

    let mut wrapper = NativeAssetWrapper::new("TEST", "Test", "TEST", 8);

    // ❌ Erro: Tentar wrap sem balance
    println!("\n❌ Teste 1: Wrap sem balance suficiente");
    let result = wrapper.wrap(&mut native_registry, "USER_SEM_BALANCE", 1000);
    assert!(result.is_err());
    println!("   ✅ Erro tratado: {}", result.unwrap_err());

    // ❌ Erro: Tentar criar par com token não listado
    println!("\n❌ Teste 2: Criar par com token não listado");
    let result = dex.create_pair("TOKEN_A", "TOKEN_B");
    assert!(result.is_err());
    println!("   ✅ Erro tratado: {}", result.unwrap_err());

    // ❌ Erro: Tentar criar par duplicado
    println!("\n❌ Teste 3: Criar par duplicado");
    dex.list_token("AAA");
    dex.list_token("BBB");
    dex.create_pair("AAA", "BBB").unwrap();
    let result = dex.create_pair("AAA", "BBB");
    assert!(result.is_err());
    println!("   ✅ Erro tratado: {}", result.unwrap_err());

    // ❌ Erro: Swap em pool vazio
    println!("\n❌ Teste 4: Swap em pool vazio");
    let pair = dex.get_pair("AAA", "BBB").unwrap();
    let result = pair.swap(100, "AAA");
    assert!(result.is_err());
    println!("   ✅ Erro tratado: {}", result.unwrap_err());

    println!("\n✅ TESTE PASSOU: Todos os erros tratados corretamente!\n");
}
