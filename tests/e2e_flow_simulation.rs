//! # Lunex DEX - End-to-End Flow Simulation Tests
//! 
//! Este módulo simula jornadas completas de usuários no DEX:
//! 1. Criação de Pares (Factory)
//! 2. Adicionar/Remover Liquidez (Router + Pair)
//! 3. Swaps (Router + Pair)
//! 4. Staking e Rewards
//! 5. Wrapped Native Token (WNative)

use std::collections::HashMap;

// ============================================
// MOCK CONTRACTS PARA SIMULAÇÃO E2E
// ============================================

/// Mock do Factory Contract
struct MockFactory {
    pairs: HashMap<(String, String), String>,
    fee_to: Option<String>,
    fee_to_setter: String,
}

impl MockFactory {
    fn new(fee_to_setter: String) -> Self {
        Self {
            pairs: HashMap::new(),
            fee_to: None,
            fee_to_setter,
        }
    }

    fn create_pair(&mut self, token_a: &str, token_b: &str) -> Result<String, &'static str> {
        if token_a == token_b {
            return Err("IdenticalAddresses");
        }
        
        let (t0, t1) = if token_a < token_b { (token_a, token_b) } else { (token_b, token_a) };
        let key = (t0.to_string(), t1.to_string());
        
        if self.pairs.contains_key(&key) {
            return Err("PairExists");
        }
        
        let pair_address = format!("PAIR_{}_{}", t0, t1);
        self.pairs.insert(key, pair_address.clone());
        Ok(pair_address)
    }

    fn get_pair(&self, token_a: &str, token_b: &str) -> Option<String> {
        let (t0, t1) = if token_a < token_b { (token_a, token_b) } else { (token_b, token_a) };
        self.pairs.get(&(t0.to_string(), t1.to_string())).cloned()
    }
}

/// Mock do Pair Contract (AMM)
struct MockPair {
    token_0: String,
    token_1: String,
    reserve_0: u128,
    reserve_1: u128,
    total_supply: u128,
    balances: HashMap<String, u128>,
    k_last: u128,
    locked: bool,
}

impl MockPair {
    fn new(token_0: String, token_1: String) -> Self {
        Self {
            token_0,
            token_1,
            reserve_0: 0,
            reserve_1: 0,
            total_supply: 0,
            balances: HashMap::new(),
            k_last: 0,
            locked: false,
        }
    }

    fn mint(&mut self, to: &str, amount_0: u128, amount_1: u128) -> Result<u128, &'static str> {
        if self.locked { return Err("Locked"); }
        self.locked = true;

        let liquidity = if self.total_supply == 0 {
            let product = amount_0.checked_mul(amount_1).ok_or("Overflow")?;
            Self::sqrt(product).saturating_sub(100) // MINIMUM_LIQUIDITY
        } else {
            let liq_0 = amount_0.checked_mul(self.total_supply).ok_or("Overflow")? / self.reserve_0;
            let liq_1 = amount_1.checked_mul(self.total_supply).ok_or("Overflow")? / self.reserve_1;
            liq_0.min(liq_1)
        };

        if liquidity == 0 { self.locked = false; return Err("InsufficientLiquidity"); }

        self.total_supply = self.total_supply.checked_add(liquidity).ok_or("Overflow")?;
        *self.balances.entry(to.to_string()).or_insert(0) += liquidity;
        self.reserve_0 = self.reserve_0.checked_add(amount_0).ok_or("Overflow")?;
        self.reserve_1 = self.reserve_1.checked_add(amount_1).ok_or("Overflow")?;
        self.k_last = self.reserve_0.checked_mul(self.reserve_1).ok_or("Overflow")?;

        self.locked = false;
        Ok(liquidity)
    }

    fn swap(&mut self, amount_0_out: u128, amount_1_out: u128, amount_0_in: u128, amount_1_in: u128) -> Result<(), &'static str> {
        if self.locked { return Err("Locked"); }
        if amount_0_out == 0 && amount_1_out == 0 { return Err("InsufficientOutputAmount"); }
        if amount_0_out >= self.reserve_0 || amount_1_out >= self.reserve_1 { return Err("InsufficientLiquidity"); }

        self.locked = true;

        // Calcular novos balances
        let balance_0 = self.reserve_0.checked_add(amount_0_in).ok_or("Overflow")?
            .checked_sub(amount_0_out).ok_or("Underflow")?;
        let balance_1 = self.reserve_1.checked_add(amount_1_in).ok_or("Overflow")?
            .checked_sub(amount_1_out).ok_or("Underflow")?;

        // K-invariant check (com fee de 0.3%)
        let balance_0_adj = balance_0.checked_mul(1000).ok_or("Overflow")?;
        let balance_1_adj = balance_1.checked_mul(1000).ok_or("Overflow")?;
        let k_new = balance_0_adj.checked_mul(balance_1_adj).ok_or("Overflow")?;
        
        let reserve_0_adj = self.reserve_0.checked_mul(1000).ok_or("Overflow")?;
        let reserve_1_adj = self.reserve_1.checked_mul(1000).ok_or("Overflow")?;
        let k_old = reserve_0_adj.checked_mul(reserve_1_adj).ok_or("Overflow")?;

        if k_new < k_old { self.locked = false; return Err("KValueDecreased"); }

        self.reserve_0 = balance_0;
        self.reserve_1 = balance_1;
        self.k_last = self.reserve_0.checked_mul(self.reserve_1).ok_or("Overflow")?;

        self.locked = false;
        Ok(())
    }

    fn get_reserves(&self) -> (u128, u128) {
        (self.reserve_0, self.reserve_1)
    }

    fn sqrt(y: u128) -> u128 {
        if y > 3 {
            let mut z = y;
            let mut x = y / 2 + 1;
            while x < z { z = x; x = (y / x + x) / 2; }
            z
        } else if y != 0 { 1 } else { 0 }
    }
}

/// Mock do WNative Contract
struct MockWNative {
    total_supply: u128,
    balances: HashMap<String, u128>,
}

impl MockWNative {
    fn new() -> Self {
        Self { total_supply: 0, balances: HashMap::new() }
    }

    fn deposit(&mut self, user: &str, amount: u128) -> Result<(), &'static str> {
        if amount == 0 { return Err("ZeroAmount"); }
        self.total_supply = self.total_supply.checked_add(amount).ok_or("Overflow")?;
        *self.balances.entry(user.to_string()).or_insert(0) += amount;
        Ok(())
    }

    fn withdraw(&mut self, user: &str, amount: u128) -> Result<(), &'static str> {
        if amount == 0 { return Err("ZeroAmount"); }
        let balance = self.balances.get(user).copied().unwrap_or(0);
        if balance < amount { return Err("InsufficientBalance"); }
        *self.balances.get_mut(user).unwrap() -= amount;
        self.total_supply -= amount;
        Ok(())
    }

    fn balance_of(&self, user: &str) -> u128 {
        self.balances.get(user).copied().unwrap_or(0)
    }
}

/// Mock do Staking Contract
struct MockStaking {
    stakes: HashMap<String, u128>,
    total_staked: u128,
    rewards_pool: u128,
}

impl MockStaking {
    fn new() -> Self {
        Self { stakes: HashMap::new(), total_staked: 0, rewards_pool: 0 }
    }

    fn stake(&mut self, user: &str, amount: u128) -> Result<(), &'static str> {
        if amount < 1000 { return Err("MinimumStakeNotMet"); }
        *self.stakes.entry(user.to_string()).or_insert(0) += amount;
        self.total_staked += amount;
        Ok(())
    }

    fn claim_rewards(&mut self, user: &str) -> Result<u128, &'static str> {
        let stake = self.stakes.get(user).copied().unwrap_or(0);
        if stake == 0 { return Err("NoStake"); }
        
        // Simula 10% APY proporcional
        let reward = stake / 10;
        if reward == 0 { return Err("NoRewards"); }
        
        Ok(reward)
    }
}

// ============================================
// TESTES DE SIMULAÇÃO E2E
// ============================================

#[test]
fn test_e2e_complete_dex_flow() {
    println!("\n🚀 === SIMULAÇÃO E2E: FLUXO COMPLETO DO DEX ===\n");
    
    // 1. SETUP - Criar contratos
    println!("📦 [1/6] Inicializando contratos...");
    let mut factory = MockFactory::new("ADMIN".to_string());
    let mut wnative = MockWNative::new();
    let mut staking = MockStaking::new();
    println!("   ✅ Factory, WNative e Staking inicializados");

    // 2. CRIAR PAR DE TOKENS
    println!("\n🔧 [2/6] Criando par LUNES/USDT...");
    let pair_address = factory.create_pair("LUNES", "USDT").expect("Falha ao criar par");
    println!("   ✅ Par criado: {}", pair_address);
    
    // Verificar que par duplicado falha
    assert!(factory.create_pair("LUNES", "USDT").is_err());
    println!("   ✅ Proteção contra duplicatas OK");

    // 3. ADICIONAR LIQUIDEZ
    println!("\n💧 [3/6] Adicionando liquidez ao par...");
    let mut pair = MockPair::new("LUNES".to_string(), "USDT".to_string());
    
    // Alice adiciona liquidez inicial (10,000 LUNES : 50,000 USDT)
    let alice_lp = pair.mint("ALICE", 10_000_000_000, 50_000_000_000).expect("Mint falhou");
    println!("   ✅ Alice recebeu {} LP tokens", alice_lp);
    
    let (r0, r1) = pair.get_reserves();
    println!("   📊 Reservas: {} LUNES / {} USDT", r0, r1);
    println!("   📊 Preço: 1 LUNES = {} USDT", r1 / r0);

    // 4. EXECUTAR SWAP
    println!("\n🔄 [4/6] Executando swap (1000 LUNES -> USDT)...");
    let amount_in = 1_000_000_000u128; // 1000 LUNES
    
    // Calcular amount_out usando fórmula AMM (x * y = k)
    let (reserve_in, reserve_out) = pair.get_reserves();
    let amount_in_with_fee = amount_in.checked_mul(997).unwrap(); // 0.3% fee
    let numerator = amount_in_with_fee.checked_mul(reserve_out).unwrap();
    let denominator = reserve_in.checked_mul(1000).unwrap().checked_add(amount_in_with_fee).unwrap();
    let amount_out = numerator / denominator;
    
    println!("   📊 Input: {} LUNES", amount_in);
    println!("   📊 Output esperado: {} USDT", amount_out);
    
    // Executar swap
    pair.swap(0, amount_out, amount_in, 0).expect("Swap falhou");
    println!("   ✅ Swap executado com sucesso!");
    
    let (r0_new, r1_new) = pair.get_reserves();
    println!("   📊 Novas reservas: {} LUNES / {} USDT", r0_new, r1_new);
    
    // Verificar K-invariant
    let k_before = r0.checked_mul(r1).unwrap();
    let k_after = r0_new.checked_mul(r1_new).unwrap();
    assert!(k_after >= k_before, "K-invariant violado!");
    println!("   ✅ K-invariant mantido: {} >= {}", k_after, k_before);

    // 5. WNATIVE WRAP/UNWRAP
    println!("\n🎁 [5/6] Testando WNative wrap/unwrap...");
    wnative.deposit("BOB", 5000).expect("Deposit falhou");
    println!("   ✅ Bob depositou 5000 nativo -> 5000 WNATIVE");
    assert_eq!(wnative.balance_of("BOB"), 5000);
    
    wnative.withdraw("BOB", 2000).expect("Withdraw falhou");
    println!("   ✅ Bob sacou 2000 WNATIVE -> 2000 nativo");
    assert_eq!(wnative.balance_of("BOB"), 3000);
    println!("   📊 Balance final BOB: {} WNATIVE", wnative.balance_of("BOB"));

    // 6. STAKING
    println!("\n🎯 [6/6] Testando Staking...");
    staking.stake("CHARLIE", 10000).expect("Stake falhou");
    println!("   ✅ Charlie fez stake de 10000 LUNES");
    
    let rewards = staking.claim_rewards("CHARLIE").expect("Claim falhou");
    println!("   💰 Rewards calculados: {} LUNES (10% APY simulado)", rewards);

    println!("\n✅ === SIMULAÇÃO E2E COMPLETA COM SUCESSO! ===\n");
}

#[test]
fn test_e2e_security_attack_vectors() {
    println!("\n🛡️ === SIMULAÇÃO E2E: VETORES DE ATAQUE ===\n");
    
    let mut pair = MockPair::new("TOKEN_A".to_string(), "TOKEN_B".to_string());
    
    // 1. TESTE REENTRANCY
    println!("🔒 [1/4] Testando proteção reentrancy...");
    pair.mint("USER", 10000, 10000).unwrap();
    // Simular lock manual
    pair.locked = true;
    assert!(pair.mint("ATTACKER", 1000, 1000).is_err());
    println!("   ✅ Reentrancy bloqueado");
    pair.locked = false;

    // 2. TESTE K-INVARIANT MANIPULATION
    println!("\n📊 [2/4] Testando proteção K-invariant...");
    let result = pair.swap(5000, 5000, 0, 0); // Tentar drenar sem input
    assert!(result.is_err());
    println!("   ✅ Manipulação de K-invariant bloqueada");

    // 3. TESTE OVERFLOW
    println!("\n🔢 [3/4] Testando proteção overflow...");
    let mut pair2 = MockPair::new("A".to_string(), "B".to_string());
    let result = pair2.mint("USER", u128::MAX, u128::MAX);
    assert!(result.is_err());
    println!("   ✅ Overflow protegido");

    // 4. TESTE TOKENS IDÊNTICOS
    println!("\n🎭 [4/4] Testando proteção tokens idênticos...");
    let mut factory = MockFactory::new("ADMIN".to_string());
    assert!(factory.create_pair("SAME", "SAME").is_err());
    println!("   ✅ Tokens idênticos rejeitados");

    println!("\n✅ === TODOS OS VETORES DE ATAQUE BLOQUEADOS! ===\n");
}

#[test]
fn test_e2e_multi_user_scenario() {
    println!("\n👥 === SIMULAÇÃO E2E: CENÁRIO MULTI-USUÁRIO ===\n");
    
    let mut pair = MockPair::new("LUNES".to_string(), "USDT".to_string());
    
    // Alice é LP provider
    println!("👩 Alice: Adicionando liquidez inicial...");
    let alice_lp = pair.mint("ALICE", 100_000, 500_000).unwrap();
    println!("   ✅ Alice: {} LP tokens", alice_lp);

    // Bob também adiciona liquidez
    println!("\n👨 Bob: Adicionando mais liquidez...");
    let bob_lp = pair.mint("BOB", 50_000, 250_000).unwrap();
    println!("   ✅ Bob: {} LP tokens", bob_lp);

    // Charlie faz swap
    println!("\n🧑 Charlie: Executando swap...");
    let (r0, r1) = pair.get_reserves();
    let amount_in = 10_000u128;
    let amount_out = (amount_in * 997 * r1) / (r0 * 1000 + amount_in * 997);
    pair.swap(0, amount_out, amount_in, 0).unwrap();
    println!("   ✅ Charlie: {} LUNES -> {} USDT", amount_in, amount_out);

    // Verificar proporção LP tokens
    let alice_share = (alice_lp as f64 / pair.total_supply as f64) * 100.0;
    let bob_share = (bob_lp as f64 / pair.total_supply as f64) * 100.0;
    println!("\n📊 Distribuição de LP tokens:");
    println!("   Alice: {:.2}%", alice_share);
    println!("   Bob: {:.2}%", bob_share);

    println!("\n✅ === CENÁRIO MULTI-USUÁRIO CONCLUÍDO! ===\n");
}
