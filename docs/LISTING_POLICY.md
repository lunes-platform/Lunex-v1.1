# Manual de Listagem de Tokens na Lunex DEX

**Versão 1.0.0**  
**Ink! Version:** 4.2.1  
**Rede Alvo:** Lunes Network (`wss://ws.lunes.io`)  
**Última Atualização:** Dezembro de 2025

Bem-vindo ao guia oficial para listagem de tokens na Lunex DEX. Este documento detalha as políticas, os requisitos e os processos para que seu projeto possa ser negociado em nossa plataforma de forma segura e transparente.

**📋 Especificações Técnicas:**
- **Framework:** ink! 4.2.1 (Polkadot Smart Contracts)
- **Padrão de Token:** PSP22 (Polkadot Standard Proposal)
- **Arquitetura:** Baseada em Uniswap V2 (AMM - Automated Market Maker)
- **Segurança:** Implementa reentrancy guards, input validation e checked arithmetic

A Lunex adota um modelo de listagem híbrido, combinando a agilidade da listagem administrativa para projetos parceiros com a descentralização da governança comunitária para novos projetos.

---

## 🚀 Filosofia de Listagem

Nossa arquitetura é baseada no padrão industrial estabelecido pelo Uniswap V2, o que significa que **não utilizamos "tokens wrapper" ou "tokens avatar"**. O token `PSP22` original do seu projeto é o ativo negociado diretamente na DEX, garantindo eficiência, transparência e segurança.

- **Eficiência de Gás:** Sem a necessidade de criar tokens "clone", as operações são mais baratas.
- **Transparência:** Os usuários negociam o token real que conhecem e confiam.
- **Compatibilidade:** Suporte nativo para tokens `PSP22`, incluindo aqueles com taxas sobre transferência (fee-on-transfer).

---

## 📋 Modelos de Listagem

Existem duas maneiras de ter um token listado na Lunex DEX:

### **1. Listagem Direta via Admin (Fast Track)**

- **Para quem se destina:** Projetos estratégicos, parceiros oficiais do ecossistema Lunes e tokens essenciais para a saúde do mercado (ex: stablecoins, WLUNES).
- **Processo:** A equipe principal da Lunex avalia o projeto e, se aprovado, utiliza a função `admin_list_token` para listar o token imediatamente.
- **Vantagens:** Rápido, sem custo de proposta, ideal para lançamentos coordenados.

### **2. Listagem via Governança Comunitária**

- **Para quem se destina:** Qualquer projeto da comunidade que cumpra os requisitos mínimos e deseje ser listado de forma descentralizada.
- **Processo:** Envolve a criação de uma proposta de listagem, um período de votação pela comunidade de stakers de LUNES e, se aprovada, a listagem automática do token.
- **Vantagens:** Processo permissionless, democrático e que aumenta o engajamento da comunidade.

---

## 📝 Requisitos para Todos os Tokens

Antes de iniciar qualquer processo de listagem, garanta que seu token:

1.  **Seja Compatível com PSP22:** O contrato do token deve implementar a interface padrão `PSP22`.
2.  **Tenha o Código-Fonte Verificado:** O código-fonte do contrato do token deve ser público e verificado em um explorador de blocos compatível.
3.  **Possua Liquidez Inicial:** O proponente (seja a equipe do projeto ou a comunidade) deve estar preparado para fornecer liquidez inicial para o par assim que for criado. A DEX não funciona sem liquidez.
4.  **Não Seja Malicioso:** Contratos com códigos ofuscados, funções de honeypot, ou que possam prejudicar os usuários serão rejeitados e colocados em uma lista de bloqueio.

---
## 🛠️ Guia Passo a Passo: Listagem via Admin (Fast Track)

Este processo é conduzido pela equipe da Lunex após uma análise e parceria com o projeto.

1.  **Contato e Análise:** A equipe do projeto entra em contato com a equipe da Lunex. Uma análise de segurança, tokenomics e propósito do projeto é realizada.
2.  **Acordo de Parceria:** Se aprovado, os detalhes da listagem e marketing conjunto são acordados.
3.  **Execução da Listagem:**
    *   **Ação:** Um administrador da Lunex chama a função `admin_list_token` no contrato `Staking`.
    *   **Parâmetros:**
        *   `token_address`: O endereço do contrato do token `PSP22`.
        *   `reason`: Uma breve descrição justificando a listagem (ex: "Parceria Estratégica com Projeto X").
4.  **Criação do Par de Liquidez:**
    *   **Ação:** A equipe do projeto (ou a Lunex, conforme acordado) chama a função `add_liquidity` no contrato `Router` para criar o par (ex: `TOKEN`/`WLUNES`).
    *   **Resultado:** O par é criado pelo `Factory`, e o token está oficialmente disponível para negociação.

---

##🗳️ Guia Passo a Passo: Listagem via Governança

Qualquer membro da comunidade com poder de voto suficiente pode iniciar este processo.

### **Fase 1: Criação da Proposta**

1.  **Requisitos do Proponente:**
    *   Possuir uma quantidade mínima de LUNES em stake para ter poder de voto (`MIN_PROPOSAL_POWER`).
    *   Pagar uma taxa de proposta em LUNES para evitar spam. Esta taxa é **reembolsável se a proposta for aprovada**.

2.  **Ação: Chamar `create_proposal`**
    *   **Contrato:** `Staking`
    *   **Função:** `create_proposal`
    *   **Parâmetros:**
        *   `name`: Nome do projeto/token (ex: "Awesome Project Token").
        *   `description`: Uma descrição detalhada do projeto, seus objetivos e por que deve ser listado.
        *   `token_address`: O endereço do contrato do token `PSP22`.
    *   **Valor Enviado:** A taxa de proposta (`current_proposal_fee`) deve ser enviada junto com a transação.

### **Fase 2: Votação da Comunidade**

1.  **Período de Votação:** Uma vez criada, a proposta fica aberta para votação por um período determinado (ex: 7 dias).
2.  **Quem Pode Votar:** Qualquer usuário que tenha LUNES em stake no contrato `Staking` no momento da votação. O poder de voto é proporcional à quantidade de LUNES em stake.
3.  **Ação: Chamar `vote`**
    *   **Contrato:** `Staking`
    *   **Função:** `vote`
    *   **Parâmetros:**
        *   `proposal_id`: O ID da proposta que você deseja votar.
        *   `in_favor`: Um booleano (`true` para votar A FAVOR, `false` para votar CONTRA).

### **Fase 3: Execução da Proposta**

1.  **Após o Fim da Votação:** Qualquer pessoa pode chamar a função de execução.
2.  **Ação: Chamar `execute_proposal`**
    *   **Contrato:** `Staking`
    *   **Função:** `execute_proposal`
    *   **Parâmetros:**
        *   `proposal_id`: O ID da proposta a ser finalizada.
3.  **Resultado:**
    *   **Se `votos_for` > `votos_against`:**
        *   A proposta é **APROVADA**.
        *   O endereço do token é adicionado à lista de permissão da DEX (`approved_projects`).
        *   A taxa de proposta é reembolsada ao criador da proposta.
    *   **Se `votos_for` <= `votos_against`:**
        *   A proposta é **REJEITADA**.
        *   A taxa de proposta é enviada para a tesouraria da DEX ou para o pool de recompensas dos stakers.

### **Fase 4: Criação do Par de Liquidez**

Após uma proposta ser aprovada, o processo é o mesmo da listagem via admin:

*   **Ação:** O proponente ou qualquer membro da comunidade chama `add_liquidity` no `Router` para o token recém-aprovado.
*   **Resultado:** O par é criado e a negociação é habilitada.

---
## ❓ FAQ - Perguntas Frequentes

**P: Como o $LUNES é negociado se não é um token PSP22?**  
R: Utilizamos o contrato `Wnative` (Wrapped LUNES), que "embrulha" o $LUNES nativo em um token PSP22 totalmente compatível (`WLUNES`). Todas as negociações de $LUNES na DEX são, na verdade, negociações de `WLUNES`. A interface do usuário (UI) geralmente faz o processo de wrap/unwrap de forma transparente para o usuário.

**P: Meu token tem uma taxa sobre transferência. Ele é compatível?**  
R: Sim. A arquitetura da Lunex foi projetada para ser compatível com tokens `fee-on-transfer`. Utilize as funções de swap que incluem `...supporting_fee_on_transfer_tokens` no nome para garantir que os cálculos de liquidez e swap funcionem corretamente.

**P: O que acontece se ninguém fornecer liquidez após a listagem de um token?**  
R: O token estará "listado" (aprovado para negociação), mas não será possível negociá-lo até que alguém crie o primeiro pool de liquidez através da função `add_liquidity`.

**P: Posso remover a listagem de um token?**  
R: Apenas administradores da DEX podem remover a listagem de um token (`admin_delist_token`), uma ação reservada para casos extremos, como a descoberta de uma vulnerabilidade grave no contrato do token listado.
