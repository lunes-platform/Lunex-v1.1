# 🛡️ SECURITY ROADMAP 2.0: O Próximo Nível de Segurança para Lunex DEX

> **Status Atual:** 🌟 EXCELENTE (Score 9.85/10)
> **Objetivo:** Atingir "Bank-Grade Security" e preparar para Escala Massiva

Este documento delineia os próximos passos para elevar a segurança da Lunex DEX de "Pronta para Produção" para "Estado da Arte", baseando-se nas últimas tendências de 2024/2025 para ecossistema Polkadot/Substrate e Ink!.

---

## 1. 🔍 Análise do Cenário Atual (Gap Analysis)

Embora nossos relatórios internos mostrem uma cobertura excepcional de testes unitários (100% de 76 testes) e mitigações robustas contra vetores conhecidos (Reentrancy, Overflow), identificamos uma camada superior de práticas de segurança que ainda pode ser explorada.

| Área | Status Atual | Próximo Nível (Onde queremos chegar) |
|------|--------------|--------------------------------------|
| **Testes** | ✅ Unitários & Integração | 🚀 **Fuzz Testing** & **Property-Based Testing** |
| **Análise** | ✅ Manual & Linter Básico | 🚀 **Static Analysis Avançada** (MIRAI, cargo-audit) |
| **Monitoramento** | ⚠️ Logs passivos | 🚀 **Monitoramento Ativo em Tempo Real** (Sentinelas) |
| **Upgrade** | ⚠️ Imutável (Padrão) | 🚀 **Estratégia de Upgrade Definida** (SetCode / Proxy) |
| **Dependências** | ⚠️ Checagem manual | 🚀 **Automated Dependency Scanning** |

---

## 2. 🚀 Plano de Ação: Tecnologias e Ferramentas

### 2.1. Implementação de Fuzz Testing (Prioridade ALTA)
Testes unitários testam o que *esperamos* que aconteça. Fuzzing testa o que *não esperamos*.
*   **Ferramenta:** `cargo-fuzz` ou `honggfuzz` adaptado para Ink!.
*   **O que testar:**
    *   Injetar inputs aleatórios em `swap`, `add_liquidity` e `remove_liquidity`.
    *   Tentar quebrar invariantes matemáticos (K constant) com valores extremos.
    *   **Meta:** Rodar fuzzing por 24h contínuas sem falhas.

### 2.2. Automated Dependency Security
Garantir que as fundações (crates Rust) sejam sólidas.
*   **Ferramenta:** `cargo-audit`
*   **Ação:** Criar um workflow de CI que roda verificação de vulnerabilidades em todas as dependências do `Cargo.lock`.
*   **Check:** Verificar vulnerabilidades conhecidas em crates como `scale-info` ou `ink_env`.

### 2.3. Monitoramento On-Chain (Sentinelas)
Segurança não acaba no deploy. Precisamos saber se algo estranho acontecer.
*   **Ferramenta:** Scripts Typescript com Polkadot JS API (Bot Sentinela).
*   **O que monitorar:**
    *   🚨 **Flash Loan Attacks:** Variações bruscas de preço/reservas no mesmo bloco.
    *   🚨 **Admin Abuse:** Mudanças de taxas frequentes ou suspeitas.
    *   🚨 **Whale Movement:** Retiradas de liquidez > 10% do pool.

---

## 3. 🛡️ Melhorias de Recomendações de Segurança (Best Practices 2025)

Baseado em pesquisa recente (Ink! Security Best Practices 2024+):

### 3.1. Validação "Strict" de PSP22
Atualmente checamos `total_supply` para validar se é um token.
*   **Improvimento:** Verificar compliance total via [PSP22 Interface ID](https://github.com/w3f/PSPs/blob/master/PSPs/psp-22.md) (ERC-165 style) se disponível, ou tentar simular transferências de 0 valor para garantir comportamento padrão.

### 3.2. Estratégia de Upgrade de Contratos (Análise Detalhada)
*   **Contexto:** O usuário solicitou especificamente uma análise sobre "como atualizar um sistema". Em Blockchain, a atualização é um vetor de risco crítico.
*   **Abordagens em Ink!:**

    **A. `set_code_hash` (Nativo do Ink!)**
    *   **Como funciona:** O contrato apenas aponta para um novo blob de Wasm na chain. O storage (dados) permanece no mesmo endereço.
    *   **Vantagens:** Mais simples, nativo, sem custo extra de gas por chamada (como no Proxy).
    *   **Riscos de Segurança:**
        *   **Storage Layout Clash:** Se o novo código mudar a ordem das variáveis, *todo* o dinheiro pode ser perdido ou corrompido.
        *   **Mitigação:** Usar ferramentas de verificação de storage layout antes do upgrade ou usar o padrão `Diamond Storage` (manual).

    **B. Proxy Pattern (Delegator)**
    *   **Como funciona:** Um contrato "Proxy" recebe as chamadas e as encaminha para um contrato "Lógica". Para atualizar, muda-se o endereço da Lógica.
    *   **Vantagens:** Separação clara de dados e lógica.
    *   **Riscos:**
        *   **Overhead de Gas:** Cada chamada custa mais devido ao `delegate_call`.
        *   **Complexidade:** Gerenciamento de inicialização e state.

    **Recomendação Lunex (Segurança Máxima):**
    Utilizar **`set_code_hash`** combinado com **Governança Timelock**.
    1.  Proposta de Upgrade é enviada On-Chain.
    2.  Espera-se **48 horas** (Timelock) para auditoria comunitária.
    3.  Se aprovada e não cancelada, a função `set_code_hash` é chamada.
    4.  **CRÍTICO:** O novo código DEVE ter exatamente o mesmo layout de storage do anterior (append-only para novas variáveis).

### 3.3. Proteção contra "Dust Attacks" em Rewards
*   **Cenário:** Atacantes criam milhares de contas com volume mínimo para ganhar rewards minúsculos que somados drenam o pool.
*   **Solução:** Aumentar `min_trade_volume` dinamicamente baseado no custo de gas vs reward potencial.

---

## 4. 📝 Checklist para Auditoria Externa (Pre-Audit Pack)

Antes de contratar uma firma (como a OpenZeppelin ou firmas especializadas em Substrate), devemos ter:

1.  [ ] **NatSpec Comments:** Documentação rica em cada função pública (já temos, mas revisar).
2.  [ ] **Invariants Documentation:** Um documento listando as "Verdades Absolutas" do sistema (ex: `K` nunca diminui, `total_supply` do LP == `sqrt(k)`).
3.  [ ] **Threat Model:** Documento explicando quem são os atores e o que eles *podem* tentar fazer.

---

## 5. 💡 Conclusão

O sistema Lunex já está no **top 1%** de qualidade para projetos Ink!. Implementar este roadmap nos colocará no patamar de **Institucional/Bank-Grade**, prontos para segurar milhões em TVL com confiança.
