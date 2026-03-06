# 🚀 **LUNEX DEX - DEPLOY NO BLOCKCHAIN LUNES**

## 📋 **Guia Completo de Deploy e Listagem de Tokens**

### 🌟 **Visão Geral**

A **Lunex DEX** é um protocolo DeFi completo construído com ink! 4.2.1 para o ecossistema Substrate, especificamente otimizado para o blockchain **Lunes**. Este guia fornece instruções passo-a-passo para deploy e configuração.

---

## 🔧 **PRÉ-REQUISITOS**

### **1. Ferramentas Necessárias:**
```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup target add wasm32-unknown-unknown

# Cargo contract CLI
cargo install cargo-contract --force --locked

# Substrate contracts node (para testes locais)
cargo install contracts-node --git https://github.com/paritytech/substrate-contracts-node.git --tag v0.32.0 --force --locked
```

### **2. Configuração do Ambiente:**
```bash
# Clone do projeto
git clone <your-repo-url>
cd Lunex

# Verificar versões
rustc --version  # >= 1.70.0
cargo-contract --version  # >= 4.0.0
```

---

## 🌐 **CONFIGURAÇÃO DE REDE LUNES**

### **📡 Endpoints da Rede Lunes:**

#### **🧪 TESTNET:**
```
WebSocket: wss://ws-test.lunes.io
```

#### **🏭 MAINNET:**
```
Primary:   wss://ws.lunes.io
Node 1:    wss://ws-lunes-main-01.lunes.io  
Node 2:    wss://ws-lunes-main-02.lunes.io
Archive:   wss://ws-archive.lunes.io
```

### **💰 Token Nativo:**
- **Nome:** LUNES
- **Símbolo:** $LUNES
- **Decimais:** 8
- **Uso:** Gas fees, staking, governança

---

## 🏗️ **COMPILAÇÃO DOS CONTRATOS**

### **1. Compilar Todos os Contratos:**
```bash
# Limpar builds anteriores
cargo clean

# Factory Contract
cd uniswap-v2/contracts/factory
cargo contract build --release

# Pair Contract  
cd ../pair
cargo contract build --release

# Router Contract
cd ../router
cargo contract build --release

# Trading Rewards Contract
cd ../rewards
cargo contract build --release

# Staking Contract
cd ../staking
cargo contract build --release

# WNative Contract
cd ../wnative
cargo contract build --release
```

### **2. Verificar Artefatos:**
```bash
# Verificar se todos os .contract foram gerados
find . -name "*.contract" -type f
```

**Saída esperada:**
```
./uniswap-v2/contracts/factory/target/ink/factory_contract.contract
./uniswap-v2/contracts/pair/target/ink/pair_contract.contract
./uniswap-v2/contracts/router/target/ink/router_contract.contract
./uniswap-v2/contracts/rewards/target/ink/trading_rewards_contract.contract
./uniswap-v2/contracts/staking/target/ink/staking_contract.contract
./uniswap-v2/contracts/wnative/target/ink/wnative_contract.contract
```

---

## 🌐 **DEPLOY NA REDE LUNES**

### **🧪 TESTNET DEPLOYMENT**

#### **1. Configurar Polkadot.js Apps:**
1. Acesse: [polkadot.js.org/apps](https://polkadot.js.org/apps)
2. Settings → Developer → Custom endpoint
3. Digite: `wss://ws-test.lunes.io`
4. Save & Reload

#### **2. Deploy Order (CRÍTICO - seguir ordem):**

```bash
# Ordem correta de deploy:
# 1. WNative (base currency wrapper)
# 2. Factory (cria pares)
# 3. Staking (governance and rewards)
# 4. Trading Rewards (fee distribution)
# 5. Router (user interface)
# 6. Pair (criado via Factory)
```

#### **3. Deploy Step-by-Step:**

##### **📦 Step 1: WNative Contract**
```json
Constructor: new()
Parameters: {}
Gas Limit: 1,000,000,000 (10 LUNES)
Storage Deposit: 1,000,000,000 (10 LUNES)
```

##### **📦 Step 2: Factory Contract**
```json
Constructor: new(fee_to_setter: AccountId)
Parameters: {
  "fee_to_setter": "YOUR_ADMIN_ACCOUNT_ID"
}
Gas Limit: 1,200,000,000 (12 LUNES)
Storage Deposit: 1,500,000,000 (15 LUNES)
```

##### **📦 Step 3: Staking Contract**
```json
Constructor: new()
Parameters: {}
Gas Limit: 1,100,000,000 (11 LUNES)
Storage Deposit: 1,200,000,000 (12 LUNES)
```

##### **📦 Step 4: Trading Rewards Contract**
```json
Constructor: new(admin: AccountId, router: AccountId)
Parameters: {
  "admin": "YOUR_ADMIN_ACCOUNT_ID",
  "router": "ROUTER_CONTRACT_ADDRESS_FROM_STEP_5"
}
Note: Deploy after Router (Step 5)
Gas Limit: 900,000,000 (9 LUNES)
Storage Deposit: 1,000,000,000 (10 LUNES)
```

##### **📦 Step 5: Router Contract**
```json
Constructor: new(factory: AccountId, wnative: AccountId)
Parameters: {
  "factory": "FACTORY_CONTRACT_ADDRESS_FROM_STEP_2",
  "wnative": "WNATIVE_CONTRACT_ADDRESS_FROM_STEP_1"
}
Gas Limit: 1,300,000,000 (13 LUNES)
Storage Deposit: 1,800,000,000 (18 LUNES)
```

##### **🔗 Step 6: Configurar Integrações**
Após todos os deploys, execute:

```javascript
// 1. Configurar fee distribution no Factory
factory.set_fee_to(PROTOCOL_FEE_RECEIVER_ADDRESS);

// 2. Conectar Trading Rewards ao Router
tradingRewards.set_authorized_router(ROUTER_ADDRESS);

// 3. Conectar Staking ao Trading Rewards
staking.set_trading_rewards_contract(TRADING_REWARDS_ADDRESS);
tradingRewards.set_staking_contract(STAKING_ADDRESS);

// 4. Configurar endereços no Router para fees
// (Isso será feito via governance ou admin calls)
```

---

## 🏭 **MAINNET DEPLOYMENT**

### **⚠️ CHECKLIST PRÉ-MAINNET:**
- [ ] ✅ Todos os contratos testados na testnet
- [ ] ✅ Auditoria de segurança completa
- [ ] ✅ Stress testing realizado
- [ ] ✅ Gas limits otimizados
- [ ] ✅ Admin keys configuradas
- [ ] ✅ Multi-sig setup (recomendado)
- [ ] ✅ Emergency pause mechanisms testados

### **🚀 Deploy Mainnet:**
```bash
# Usar mesma sequência da testnet
# Endpoints mainnet: wss://ws.lunes.io

# ATENÇÃO: Mainnet costs reais!
# Estimar ~100 LUNES para deploy completo
```

---

## 💎 **LISTAGEM DE TOKENS - SISTEMA HÍBRIDO**

A Lunex DEX implementa um **sistema híbrido** que combina:
- **🔧 Listagem por Admin** - Para tokens iniciais e casos especiais
- **🗳️ Listagem por Governança** - Para decisões da comunidade

### **🔧 LISTAGEM POR ADMIN (Team do Projeto):**

#### **Para o Lançamento Inicial:**
```javascript
// Durante o deploy, configure tokens essenciais
const initialTokens = [
  {
    address: "USDT_CONTRACT_ADDRESS",
    reason: "USDT - Stablecoin principal do ecossistema"
  },
  {
    address: "WBTC_CONTRACT_ADDRESS", 
    reason: "Wrapped Bitcoin para trading cross-chain"
  },
  {
    address: "WETH_CONTRACT_ADDRESS",
    reason: "Wrapped Ethereum para diversificação"
  }
];
```

#### **Comandos de Admin:**
```javascript
// Listar token individual
staking.admin_list_token(
  token_address,
  "Razão para listagem"
);

// Listar múltiplos tokens (batch)
staking.admin_batch_list_tokens([
  [token1_address, "Razão 1"],
  [token2_address, "Razão 2"],
  // ... até 50 tokens
]);

// Remover token (emergência)
staking.admin_delist_token(
  token_address,
  "Razão para remoção"
);
```

### **🗳️ LISTAGEM POR GOVERNANÇA (Comunidade):**

#### **1. Proposta de Listagem:**
```javascript
// Através do contrato de Staking (Governance)
staking.create_proposal(
  "LIST_TOKEN_XYZ",           // title
  "List XYZ token on Lunex",  // description  
  XYZ_TOKEN_ADDRESS,          // project_address
  86400 * 7                   // voting_period (7 days)
);
```

#### **2. Votação da Comunidade:**
```javascript
// Usuários com stake podem votar
staking.vote(
  proposal_id,    // ID da proposta
  true           // support (true = sim, false = não)
);
```

#### **3. Execução da Proposta:**
```javascript
// Após período de votação e quorum atingido
staking.execute_proposal(proposal_id);
```

### **📋 Critérios para Listagem:**

#### **✅ Requisitos Técnicos:**
- **Contrato PSP22 compatível**
- **Auditoria de segurança**
- **Liquidez inicial mínima: 10,000 LUNES**
- **Verificação de código**

#### **🏛️ Requisitos de Governança:**
- **Poder de voto mínimo:** 10,000 LUNES staked
- **Quorum mínimo:** 1,000,000 LUNES
- **Aprovação:** >50% dos votos
- **Período de votação:** 7 dias

#### **💰 Taxas de Listagem:**
- **Taxa de proposta:** 1,000 LUNES (reembolsável se aprovado)
- **Taxa de implementação:** 5,000 LUNES
- **Liquidez inicial obrigatória:** 10,000 LUNES

---

## 🔧 **CONFIGURAÇÃO PÓS-DEPLOY**

### **1. Criar Primeiro Par de Trading:**
```javascript
// Via Router contract
router.add_liquidity_lunes(
  token_address,        // Token para pareamento
  token_amount_desired, // Quantidade do token
  token_amount_min,     // Quantidade mínima do token
  lunes_amount_min,     // Quantidade mínima de LUNES
  to_address,          // Recebedor dos LP tokens
  deadline             // Timestamp limite
);
```

### **2. Configurar Fee Distribution:**
```javascript
// No Factory contract
factory.set_fee_to(PROTOCOL_TREASURY_ADDRESS);

// No Pair contract (via Factory)
pair.set_protocol_fee_to(PROTOCOL_FEE_ADDRESS);
pair.set_trading_rewards_contract(TRADING_REWARDS_ADDRESS);
```

### **3. Inicializar Staking Rewards:**
```javascript
// Configurar multipliers de tier
staking.set_tier_multipliers();

// Configurar early adopter bonuses
staking.configure_early_adopter_tiers();
```

---

## 🧪 **TESTES E VALIDAÇÃO**

### **📋 Checklist de Testes:**

#### **1. Testes Funcionais:**
```bash
# Rodar testes unitários
cargo test

# Testes de integração
cargo test --test integration_tests

# Testes E2E
cargo test --test e2e_tests
```

#### **2. Testes de Interface:**
```javascript
// Via Polkadot.js
// 1. Testar deploy de cada contrato
// 2. Testar add liquidity
// 3. Testar swaps
// 4. Testar staking
// 5. Testar governance
```

#### **3. Stress Tests:**
```bash
# Simular alta carga
npm run stress-test

# Verificar limites de gas
npm run gas-analysis
```

---

## 🔐 **SEGURANÇA E MELHORES PRÁTICAS**

### **🛡️ Segurança Operacional:**

#### **1. Admin Keys Management:**
```json
{
  "admin_accounts": {
    "primary": "MULTI_SIG_ADDRESS",
    "emergency": "EMERGENCY_PAUSE_ADDRESS", 
    "upgrade": "UPGRADE_AUTHORITY_ADDRESS"
  },
  "timelock": "48_hours",
  "multi_sig_threshold": "3_of_5"
}
```

#### **2. Emergency Procedures:**
```javascript
// Pausar contratos em emergência
staking.pause_contract();        // Para staking
tradingRewards.pause_contract(); // Para rewards
factory.pause_pair_creation();   // Para novos pares
```

#### **3. Monitoring Setup:**
```yaml
monitoring:
  alerts:
    - large_swaps: "> 100,000 LUNES"
    - suspicious_activity: "multiple_fails"
    - low_liquidity: "< 1,000 LUNES"
  dashboards:
    - tvl_tracking
    - volume_24h
    - active_users
```

---

## 📊 **MONITORAMENTO E MÉTRICAS**

### **🔍 KPIs Importantes:**

#### **💰 Financeiros:**
- **TVL (Total Value Locked)**
- **Volume diário/mensal**
- **Fees coletadas**
- **LUNES em staking**

#### **👥 Usuários:**
- **Usuários ativos diários**
- **Novos usuários**
- **Retention rate**
- **Trading frequency**

#### **🏛️ Governança:**
- **Proposals ativas**
- **Participação em votações**
- **Tokens listados**
- **Poder de voto distribuído**
- **Taxa atual de propostas** (ajustável via governança)

### **📈 Dashboard Sugerido:**
```javascript
// Metrics endpoints
GET /api/v1/metrics/tvl
GET /api/v1/metrics/volume/24h
GET /api/v1/metrics/users/active
GET /api/v1/metrics/governance/proposals
GET /api/v1/metrics/staking/apy
```

---

## 🎯 **ROADMAP PÓS-LAUNCH**

### **🚀 Fase 1: Launch (Semanas 1-4)**
- ✅ Deploy na mainnet
- ✅ Primeiros pares de liquidez
- ✅ Sistema de staking ativo
- ✅ Governance operacional

### **📈 Fase 2: Growth (Semanas 5-12)**
- 🔄 Programa de incentivos
- 🔄 Parcerias com projetos
- 🔄 Listagem de tokens populares
- 🔄 Marketing e adoção

### **🏗️ Fase 3: Expansion (Semanas 13-24)**
- 🔄 Novos produtos DeFi
- 🔄 Cross-chain bridges
- 🔄 Advanced trading features
- 🔄 Mobile app

### **🌐 Fase 4: Ecosystem (Semanas 25+)**
- 🔄 DEX aggregation
- 🔄 Yield farming
- 🔄 NFT marketplace integration
- 🔄 DAO treasury management

---

## 📚 **RECURSOS ADICIONAIS**

### **📖 Documentação:**
- [Ink! Documentation](https://use.ink/)
- [Substrate Documentation](https://docs.substrate.io/)
- [Polkadot.js Documentation](https://polkadot.js.org/docs/)

### **🛠️ Ferramentas:**
- [Polkadot.js Apps](https://polkadot.js.org/apps/)
- [Substrate Contracts UI](https://contracts-ui.substrate.io/)
- [Canvas UI](https://canvas.substrate.io/) (se aplicável)

### **🔗 Links Úteis:**
- **Lunes Network:** [lunes.io](https://lunes.io)
- **Block Explorer:** [explorer.lunes.io](https://explorer.lunes.io)
- **Testnet Faucet:** [faucet-test.lunes.io](https://faucet-test.lunes.io)

---

## 🆘 **TROUBLESHOOTING**

### **❌ Problemas Comuns:**

#### **1. "Out of Gas" durante deploy:**
```bash
# Solução: Aumentar gas limit
Gas Limit: 2,000,000,000 # (20 LUNES)
```

#### **2. "Storage deposit insufficient":**
```bash
# Solução: Aumentar storage deposit
Storage Deposit: 2,000,000,000 # (20 LUNES)
```

#### **3. "Contract already exists":**
```bash
# Solução: Usar salt diferente ou account diferente
Constructor Salt: "unique_salt_string"
```

#### **4. "Endpoint connection failed":**
```bash
# Solução: Testar endpoints alternativos
wss://ws-lunes-main-01.lunes.io
wss://ws-lunes-main-02.lunes.io
```

### **🔧 Debug Commands:**
```bash
# Verificar status da rede
curl -H "Content-Type: application/json" -d '{"id":1, "jsonrpc":"2.0", "method": "system_health", "params":[]}' wss://ws.lunes.io

# Verificar balance
# Via Polkadot.js Developer tab

# Logs de contrato
# Via browser console no Polkadot.js
```

---

## 📞 **SUPORTE**

### **🤝 Canais de Suporte:**
- **GitHub Issues:** Para bugs e features
- **Discord:** Para discussões da comunidade  
- **Telegram:** Para suporte rápido
- **Email:** Para questões comerciais

### **🏥 Emergency Contacts:**
- **Security Issues:** security@lunex.io
- **Technical Support:** dev@lunex.io
- **Business Inquiries:** business@lunex.io

---

## ⚖️ **LEGAL E COMPLIANCE**

### **📜 Disclaimer:**
- Este software é fornecido "como está"
- Use por sua própria conta e risco
- Não somos responsáveis por perdas financeiras
- Verifique regulamentações locais antes do uso

### **🔒 Licença:**
- MIT License
- Open source e auditável
- Contribuições bem-vindas

---

**🌟 LUNEX DEX - O FUTURO DAS FINANÇAS DESCENTRALIZADAS NO LUNES! 🚀**

**Construído com ❤️ pela comunidade, para a comunidade!**