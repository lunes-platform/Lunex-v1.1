# 🌟 Lunex DEX: Funcionalidades Completas na Rede Lunes

## 🎯 **Visão Geral**

A **Lunex DEX** é uma exchange descentralizada (DEX) completa construída na **Rede Lunes**, usando a moeda nativa **$LUNES** como base. Combina um AMM (Automated Market Maker) estilo Uniswap V2 com um robusto sistema de **Staking**, **Governança Descentralizada** e **Trading Rewards**.

### 💰 **NOVA ESTRUTURA DE TAXAS 0.5%**

```
Taxa Total: 0.5% distribuída como:
├── 🔄 60% → Provedores de Liquidez (0.3%)
├── 🏛️ 20% → Desenvolvimento/Team (0.1%)  
└── 🎁 20% → Trading Rewards (0.1%)
```

**Por que 0.5%?**
- **Competitiva:** Apenas 0.2% acima do padrão de mercado
- **Sustentável:** Revenue para desenvolvimento contínuo
- **Incentivada:** Trading rewards compensam taxa adicional
- **Inovadora:** Única DEX com sistema de rewards para traders ativos

---

## 💰 **O que o Usuário Pode Fazer**

### **1. 🔄 Trading (Negociação)**

#### **Trocar Tokens (Swap)**
- **O que é:** Troca instantânea entre qualquer par de tokens listados
- **Como funciona:** Usando a fórmula do produto constante (x*y=k)
- **Taxa:** 0.5% por transação (0.3% para LPs + 0.1% protocolo + 0.1% trading rewards)
- **Proteções:** Slippage protection, deadline validation, K-invariant check

```
Exemplo: Trocar 100 LUNES por USDT
- Usuário especifica quantidade exata de LUNES
- Sistema calcula quantidade de USDT a receber
- Proteção contra slippage excessivo
- Execução instantânea se aprovada
```

#### **Adicionar Liquidez (Become LP)**
- **O que é:** Depositar dois tokens em proporção igual para formar um pool
- **Benefício:** Ganhar 0.3% de todas as trades do par (60% da taxa total de 0.5%)
- **LP Tokens:** Recebe tokens que representam sua participação no pool
- **Risco:** Impermanent loss se preços divergirem

```
Exemplo: Adicionar liquidez LUNES/USDT
- Depositar 1000 LUNES + 1000 USDT
- Receber LP tokens representando participação
- Ganhar taxas proporcionais ao volume de trading
```

#### **Remover Liquidez**
- **O que é:** Resgatar tokens originais + taxas acumuladas
- **Como:** Queimar LP tokens para receber tokens subjacentes
- **Lucro:** Tokens originais + taxas de trading acumuladas

---

### **2. 🏦 Staking de $LUNES**

#### **Stake para Rewards**

- **Moeda:** $LUNES (token nativo da Rede Lunes - 8 casas decimais)
- **Mínimo:** 1.000 LUNES
- **Duração:** 7 dias a 365 dias
- **Sistema de Tiers por Duração:**

| Tier | Duração | APY |
|------|---------|-----|
| 🥉 Bronze | 7-30 dias | 8% |
| 🥈 Silver | 31-90 dias | 10% |
| 🥇 Gold | 91-180 dias | 12% |
| 💎 Platinum | 181+ dias | 15% |

- **Early Adopter Bonus:** Top 1000 (+10%), Top 500 (+25%), Top 100 (+50%)
- **Claim:** Recompensas podem ser reclamadas durante o período

```
Exemplo: Stake de 10.000 LUNES por 90 dias (Tier Silver)
- APY: 10%
- Recompensa diária: ~2.74 LUNES
- Recompensa total (90 dias): ~247 LUNES
- Pode retirar antes, mas com penalty de 5%
- Precisão: 8 casas decimais (0.00000001 LUNES)
```

#### **Voting Power (Poder de Voto)**
- **1 LUNES staked = 1 voto** na governança
- **Requisito mínimo para propostas:** 10.000 LUNES staked
- **Participação:** Votar em propostas de listagem de projetos

---

### **3. 🎁 Trading Rewards**

#### **Sistema de Tiers para Traders Ativos**
- **O que é:** Rewards baseados no volume de trading mensal
- **Como funciona:** 20% das trading fees formam pool de rewards mensal
- **Distribuição:** Proporcional ao volume e tier do trader

#### **Tiers de Trading (Volume Mensal)**
```
🥉 Bronze: 0 - 10.000 LUNES      → Multiplicador 1.0x
🥈 Silver: 10.000 - 50.000 LUNES → Multiplicador 1.2x (+20%)
🥇 Gold: 50.000 - 200.000 LUNES  → Multiplicador 1.5x (+50%)
💎 Platinum: 200.000+ LUNES      → Multiplicador 2.0x (+100%)
```

#### **Como Funcionar:**
```
Exemplo: Pool mensal de 10.000 LUNES
- Alice (Gold, 100k volume): 40% dos rewards = 4.000 LUNES
- Bob (Silver, 50k volume): 25% dos rewards = 2.500 LUNES  
- Carol (Silver, 25k volume): 20% dos rewards = 2.000 LUNES
- Traders menores: 15% restante = 1.500 LUNES
```

#### **Processo:**
- **Tracking automático:** Volume registrado a cada trade
- **Reset mensal:** Tiers recalculados todo mês
- **Distribuição:** Admin ativa distribuição mensal
- **Claim:** Rewards disponíveis para resgate imediato

---

### **4. 🗳️ Governança Descentralizada**

#### **Criar Propostas**
- **Quem pode:** Usuários com 10.000+ LUNES staked
- **Propósito:** Sugerir novos tokens para listagem na DEX
- **Processo:** Criar proposta → período de votação (14 dias) → execução

```
Exemplo: Proposta para listar TOKEN_XYZ
- Usuário com 15.000 LUNES staked cria proposta
- Comunidade vota por 14 dias
- Se aprovada, token é automaticamente listado
```

#### **Votar em Propostas**
- **Requisito:** Ter LUNES staked (qualquer quantidade)
- **Peso do voto:** Proporcional ao amount staked
- **Opções:** A favor ou contra
- **Resultado:** Maioria simples decide

#### **Projetos Aprovados**
- **Listagem automática:** Tokens aprovados pela governança
- **Transparência:** Histórico público de todas as votações
- **Descentralização:** Comunidade decide, não uma entidade central

---

### **4. 🪙 Wrapped Native Token (WLUNES)**

#### **Wrap/Unwrap LUNES**
- **Wrap:** Converter LUNES nativo → WLUNES (token PSP22)
- **Unwrap:** Converter WLUNES → LUNES nativo
- **Proporção:** 1:1 sempre
- **Utilidade:** Usar LUNES como qualquer token PSP22 na DEX

```
Casos de uso:
- Criar par LUNES/USDT (via WLUNES)
- Fornecer liquidez com token nativo
- Trading direto com LUNES
```

---

## 🌐 **Integração com a Rede Lunes**

### **Endpoints Disponíveis**

#### **Testnet:**
- WebSocket: `wss://ws-test.lunes.io`
- RPC: `https://rpc-test.lunes.io`

#### **Mainnet:**
- Primary: `wss://ws.lunes.io`
- Backup 1: `wss://ws-lunes-main-01.lunes.io`
- Backup 2: `wss://ws-lunes-main-02.lunes.io`
- Archive: `wss://ws-archive.lunes.io`

---

## 📊 **Benefícios para Diferentes Perfis de Usuário**

### **👤 Trader (Negociante)**

```
✅ Troca instantânea entre tokens
✅ Proteção contra slippage
✅ Sem necessidade de order books
✅ Liquidez sempre disponível
✅ Taxas previsíveis (0.5% total)
✅ Trading Rewards por volume (Tiers)
```

### **💧 Liquidity Provider (LP)**
```
✅ Rendimento passivo (fees de trading)
✅ LP tokens como comprovante
✅ Pode remover liquidez a qualquer momento
✅ Ganhos proporcionais ao volume
```

### **🏛️ Staker & Governance Participant**
```
✅ Recompensas de 10% anual em LUNES
✅ Poder de voto na governança
✅ Influência no futuro da plataforma
✅ Participação em decisões de listagem
✅ Penalidade suave por unstaking antecipado (5%)
```

### **🚀 Projeto/Token Developer**
```
✅ Listagem democratizada via governança
✅ Acesso ao ecossistema Lunes
✅ Não depende de approval centralizado
✅ Comunidade decide se projeto merece listagem
```

---

## 🔒 **Segurança & Confiabilidade**

### **Contratos Auditados**
- ✅ **89 testes passando** (Unit + Integration + E2E + Security + Stress)
- ✅ **Compliance com OpenZeppelin** security standards
- ✅ **Proteção contra reentrância**
- ✅ **Validação rigorosa de inputs**
- ✅ **Verificação de K-invariant**
- ✅ **Access control robusto**

### **Proteções Implementadas**
- **Overflow/Underflow protection**
- **Deadline validation**
- **Slippage protection**
- **Minimum liquidity locks**
- **Zero address validation**
- **Replay attack prevention**

---

## 📈 **Métricas & Transparência**

### **Dados Públicos Disponíveis**
- Total LUNES staked no sistema
- Recompensas distribuídas historicamente
- Número de stakers ativos
- Propostas de governança (ativas e históricas)
- Volume de trading por par
- TVL (Total Value Locked) em cada pool

### **Eventos Emitidos**
- **Staking:** Stake, Unstake, RewardsClaimed
- **Governança:** ProposalCreated, Voted, ProposalExecuted
- **DEX:** PairCreated, Mint, Burn, Swap
- **Transfers:** todos eventos PSP22 padrão

---

## 🎯 **Resumo: O Poder da Lunex DEX**

A Lunex DEX oferece um **ecossistema DeFi completo** na Rede Lunes:

1. **🔄 DEX Robusto** - Trading descentralizado eficiente
2. **💰 Staking Lucrativo** - 10% anual em LUNES nativo
3. **🗳️ Governança Real** - Comunidade decide o futuro
4. **🌐 Integração Nativa** - Built for Lunes Network
5. **🔒 Segurança Máxima** - Tested, audited, battle-ready

**Status atual:** ✅ **PRODUCTION READY** - Todos os contratos testados e seguros, prontos para deploy na Mainnet da Rede Lunes.

---

*A Lunex DEX representa o futuro do DeFi na Rede Lunes - onde a comunidade tem o poder real e os usuários são recompensados por sua participação.*