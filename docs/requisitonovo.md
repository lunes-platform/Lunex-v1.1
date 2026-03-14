
---

### 1. Teste de Mesa: Curva de Liquidez Paramétrica

A equação base do seu modelo para calcular a liquidez disponível ($y$) em um determinado ponto é:

$$y = (k + c \cdot L) \cdot \left(1 - \frac{x}{x_{0}'}\right)^{\gamma} - t \cdot x - r \cdot L$$



Vamos extrair os dados da sua Prova de Conceito (PoC) em Python para simular um cenário real de um provedor de liquidez:

**Parâmetros Iniciais (Curva de Compra LNS/USDC):**

* 
**$k$ (Liquidez Inicial):** 100 USDC 


* 
**$L$ (Valor Emprestado):** 50 USDC (Tomando margem) 


* 
**$c$ (Proporção alocada):** 0.5 (50% do empréstimo vai para a curva) 


* 
**$x_{0}'$ (Capacidade Máxima):** 500 USDC 


* **$\gamma$ (Curvatura):** 2 (Vamos usar quadrática para simular uma curva que concentra mais liquidez perto do preço atual e afunila nas extremidades).
* 
**$t$ (Taxa de negociação):** 0.003 (0.3% de fee) 


* 
**$r$ (Taxa de juros):** 0.01 (1% diário, para o teste) 



**Evento de Mercado:** Um trader compra **$x = 10$ USDC** de LNS passando por esta curva.

**Cálculo Passo a Passo:**

1. **Base Alavancada:** O capital real exposto na curva.

$$(k + c \cdot L) = 100 + (0.5 \cdot 50) = 125$$


2. **Fator de Exaustão e Curvatura:** Como a liquidez se comporta à medida que o volume se aproxima da capacidade máxima.

$$\left(1 - \frac{10}{500}\right)^2 = (1 - 0.02)^2 = (0.98)^2 = 0.9604$$


3. **Liquidez Bruta Restante:**

$$125 \cdot 0.9604 = 120.05 \text{ USDC}$$


4. **Desconto da Taxa de Swap (Fee):**

$$t \cdot x = 0.003 \cdot 10 = 0.03 \text{ USDC}$$


5. **Desconto dos Juros do Empréstimo:**

$$r \cdot L = 0.01 \cdot 50 = 0.50 \text{ USDC}$$


6. **Liquidez Disponível Atualizada ($y$):**

$$y = 120.05 - 0.03 - 0.50 = 119.52 \text{ USDC}$$



**Conclusão do Teste:** A matemática é sólida. Ela permite que a pool desconte simultaneamente o impacto de preço (pela curva $\gamma$), a taxa administrativa ($t$) e o custo do empréstimo ($r$) de forma atômica. Se implementarmos isso em Substrate (ink! 4.x), precisaremos garantir precisão de fixed-point (ponto fixo) para evitar erros de arredondamento no cálculo das potências fracionárias.

---

### 2. Documento de Requisitos: Implementação de Liquidez Assimétrica (Lunex V2)

Este documento complementa a arquitetura atual sem substituir os motores já existentes (AMM V1 e Orderbook Híbrido).

#### 2.1. Visão Geral

A plataforma Lunex permitirá que provedores de liquidez (LPs) criem posições assimétricas avançadas usando equações paramétricas. O controle desses parâmetros será garantido de duas formas: (1) Interface gráfica avançada (Human-First) e (2) Delegação de chaves via API para gerenciamento dinâmico por agentes de IA (AI-Ready).

#### 2.2. Requisitos de Frontend (`/pool` e `/spot`)

* **Modo LP Básico vs. Pro:** A interface de adição de liquidez deve permitir a seleção do modo padrão ($x \cdot y = k$) ou "Assimétrico/Paramétrico".
* **Visualizador de Curvas Gráficas:** Implementar um componente gráfico (ex: ECharts ou D3.js) que plote as curvas de compra e venda lado a lado, atualizando-se em tempo real conforme o usuário ajusta os "sliders" dos parâmetros ($\gamma$, capacidade máxima $x_{0}'$, preço inicial/final).
* **Painel de Delegação de IA:** A interface deve ter uma aba onde o usuário gera uma *API Key restrita* (via MCP sandbox existente) que só tem permissão para chamar o método `update_curve_parameters` daquele pool específico, sem permissão para sacar fundos.

#### 2.3. Requisitos de Backend (`spot-api`) e Roteamento

* **Smart Router V2:** O algoritmo de roteamento `spot-api/services/router` deve ser atualizado para simular a rota ótima entre: (1) AMM V1, (2) Orderbook e (3) Asymmetric Pools.
* 
**Relayer de Rebalanceamento:** Um worker no backend deve escutar eventos on-chain de liquidações ou execuções na "curva de compra" e acionar (se configurado pelo LP) o realocamento do colateral liberado para alimentar a "curva de venda" correspondente. 



#### 2.4. Requisitos de Smart Contracts (ink! 4.x)

* 
**Novo Contrato `AsymmetricPair`:** Deve herdar as funcionalidades do padrão PSP22 e implementar a lógica da equação paramétrica testada. 


* **Biblioteca Matemática (Fixed Point):** Como WebAssembly em ink! não lida bem com floating points diretos para operações financeiras sensíveis, deve-se usar bibliotecas seguras (como `sp-arithmetic` adaptadas ou crates de fixed-point do ecossistema Polkadot) para o cálculo de potências ($\gamma$).
* **Controle de Acesso Granular:** O contrato deve distinguir o `owner` (que pode sacar e depositar) de um `manager` (o agente de IA ou script automatizado), que só tem permissão para ajustar os parâmetros de formatação da curva (preços, gammas e taxas alvo) dentro de limites preestabelecidos pelo `owner`.

---

A base conceitual e matemática está perfeitamente alinhada. O maior desafio técnico aqui será a implementação do cálculo da curva com expoentes $\gamma$ dentro das limitações matemáticas do WASM no ink! 4.x.



A. Os Controles Paramétricos (<ParametricControls />)Em vez de pedir para o usuário digitar números soltos, usaremos componentes de "Range Slider" para os parâmetros matemáticos:Agressividade da Curva ($\gamma$): Um slider que vai de 1 (Linear) a 5 (Altamente exponencial). O texto de apoio pode ser: "O quão rápido a liquidez deve ser liberada?"Capacidade Máxima ($x_0'$): Um input atrelado ao preço alvo. "Até qual volume de preço essa curva deve atuar?"Alavancagem / Margin ($L$): Um toggle "Habilitar Alavancagem" que se conecta com o seu módulo atual de /margin, permitindo que o usuário use LUSDT emprestado para inflar a base da curva.B. O Visualizador Gráfico (<CurveChart />)Para renderizar a equação paramétrica em tempo real no React, bibliotecas como Recharts ou Apache ECharts são ideais por serem otimizadas.Eixo X: Representa o Preço do Ativo ou o Volume Negociado.Eixo Y: Representa a Liquidez Disponível ($y$).Comportamento: Conforme o usuário mexe no slider do $\gamma$ na coluna esquerda, a curva no gráfico "entorta" em tempo real, fornecendo feedback visual imediato de como o dinheiro dele será distribuído no orderbook/pool. Teremos duas linhas no gráfico: uma verde (curva de compra) e uma vermelha (curva de venda), operando independentemente.C. Painel de Delegação para IA (<AgentDelegationPanel />)Aqui é onde conectamos o frontend com a sua API de agentes /agents/register.O Conceito: O usuário cria um "Job" para a IA. Ele diz: "Mantenha minha curva de compra acompanhando o suporte do LUNES, com spread de 2%."O Fluxo na UI:O usuário clica em "Delegar Estratégia para IA".Abre um modal onde ele define os limites (Guardrails): "A IA pode alterar o $\gamma$ apenas entre 1 e 3, e não pode alterar a Capacidade Máxima."O Frontend chama o backend (POST /api-keys ou /agents/register).É gerada uma API Key restrita (Escopo manager no smart contract que definimos no prompt anterior).O usuário copia essa chave e insere no agente dele (OpenClaw, Phidata, etc.), ou a própria Lunex já injeta isso direto se o agente estiver hospedado internamente pelo Sandbox.

Para o usuário humano, que não tem (ou não quer usar) um Agente OpenClaw ou Phidata, a complexidade matemática deve ser totalmente abstraída pela interface. Ele usará a plataforma através de três pilares de usabilidade:1. Templates de Estratégia (O "One-Click")O usuário não verá campos para preencher "$\gamma$" ou "Capacidade Máxima". Em vez disso, a interface /pool oferecerá "Cards de Estratégia" pré-configurados que definem a matemática por baixo dos panos.Card "Acumulador (Buy the Dip)": O usuário escolhe esse card se acredita que o ativo vai cair e quer acumular. O frontend automaticamente configura uma curva exponencial que compra poucas frações no preço atual, mas compra volumes massivos se o preço cair 20%.Card "Realizador de Lucros (Take Profit Lento)": Configura uma curva de venda que vai despejando o token gradativamente no mercado conforme o preço sobe, sem vender tudo de uma vez.Card "Range de Stablecoin": Uma curva extremamente curvada (altos valores de $\gamma$) focada em coletar taxas em faixas minúsculas de variação (ex: LUSDT/USDC entre 0.99 e 1.01).2. O Construtor Visual Gráfico (Arraste e Solte)Para o usuário intermediário/Pro que quer customizar sem usar IA, a interação será visual, não numérica.No gráfico <CurveChart /> que discutimos, ele verá a curva de liquidez dele desenhada sobre o gráfico de preços (como no TradingView).Se ele quiser que a curva seja mais agressiva, ele clica na linha do gráfico e arrasta ela. Ao arrastar a curva no frontend, o React recalcula o $\gamma$ em tempo real e atualiza o estado. Ele "molda" a liquidez com o mouse.3. Automação Nativa do Protocolo (O Compartilhamento de Liquidez)O documento de requisitos original trazia um conceito brilhante: o compartilhamento transparente de liquidez entre curvas vinculadas. Isso significa que o próprio smart contract e o relayer da Lunex farão o trabalho pesado, agindo como um "robô interno" e gratuito para o usuário:Quando a curva de compra do usuário acumula uma posição em um ativo, essa liquidez fica imediatamente disponível para a curva de venda correspondente.Como o usuário usa isso: Ele simplesmente ativa um toggle na interface chamado "Reinvestimento Automático". O protocolo se encarrega de pegar o LUNES que ele comprou na queda e criar automaticamente a ordem de venda paramétrica para quando o preço subir, sem que ele precise estar logado ou ter uma IA conectada.4. O Fallback: Orderbook HíbridoE para o usuário iniciante que achar as curvas paramétricas muito complexas, a Lunex já possui a resposta perfeita operando: o Order Book Híbrido. Ele simplesmente vai na rota /spot e cria uma ordem LIMIT clássica e estática. A Liquidez Assimétrica fica como uma aba "Pro" para quem quer otimizar ganhos e taxas como provedor de liquidez.A estratégia é: Simples por padrão, complexo por escolha. O motor on-chain é o mesmo, mas o frontend traduz a matemática em botões visuais para o humano e em parâmetros crus para a IA.

Focar no backend é a decisão correta para garantir escalabilidade e uma experiência "Web2" sem atrito para o usuário Web3. Se o usuário comum não tem um robô, **o seu backend será o robô dele**.

Na arquitetura atual da Lunex, você já possui um `Indexer` que escuta blocos e um `Relayer` no `Settlement Engine` que paga o gás para o Orderbook. Nós vamos reaproveitar essa exata infraestrutura para criar o **Motor de Rebalanceamento Automático (Auto-Rebalancer)**.

Aqui está o design de como o backend (`spot-api` em Express + Prisma + PostgreSQL ) vai orquestrar o compartilhamento de liquidez entre curvas.

### 1. O Fluxo de Compartilhamento de Liquidez (Backend como Manager)

A lógica central descrita na sua tese determina que quando uma curva de compra acumula uma posição, essa liquidez deve ficar imediatamente disponível para a curva de venda correspondente.

**O Ciclo de Vida do Rebalanceamento:**

1. **Setup Inicial:** O usuário cria a estratégia no frontend e assina a transação on-chain para depositar a liquidez inicial (ex: LUSDT). No backend, vinculamos a curva de compra à curva de venda no banco de dados.
2. **O Gatilho (On-chain):** Um trader qualquer no mercado faz um swap que passa pela curva de compra do nosso usuário. O smart contract executa a compra (ex: converte LUSDT em LUNES).


3. 
**Escuta (Indexer):** O seu `Social Indexer`, que já faz o "Poll on-chain blocks" e "Decode contract events", capta o novo evento `AsymmetricSwapExecuted`.


4. **Cálculo (Motor de Rebalanceamento):** O backend identifica que o usuário ativou o "Reinvestimento Automático". Ele calcula matematicamente como os LUNES recém-adquiridos  devem ser posicionados na curva de venda, ajustando a Capacidade Máxima ($x_0'$) e a nova base de liquidez.


5. 
**Execução Zero-Gas (Relayer):** O Relayer da Lunex pega a sua "Relayer Seed"  e envia uma transação para o smart contract chamando `update_curve_parameters()`. Como o Relayer está registrado como `manager` daquela curva específica, a transação é aceita, a curva de venda é inflada com os novos LUNES, e **o usuário não paga taxa de gás por esse reajuste**.



---

### 2. Atualização do Banco de Dados (Prisma Schema)

Para que o backend saiba quem está conectado a qual estratégia, precisaremos de um novo modelo no seu Prisma ORM.

```prisma
model AsymmetricStrategy {
  id              String   @id @default(uuid())
  userAddress     String   // Identidade = wallet address (sr25519)
  pairAddress     String   // Endereço do AsymmetricPair no ink!
  
  // Controle de Automação
  isAutoRebalance Boolean  @default(true) // O backend atua como manager?
  agentId         String?  // Se for nulo, o backend cuida. Se tiver ID, a IA (OpenClaw) cuida.
  
  // Parâmetros da Curva de Compra (Base)
  buyK            Float
  buyGamma        Int
  buyMaxCapacity  Float
  
  // Parâmetros da Curva de Venda (Alvo)
  sellGamma       Int
  sellProfitTarget Float   // % de lucro esperado para iniciar a venda

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

```

---

### 3. O Worker de Rebalanceamento (TypeScript/Express)

Dentro do seu `spot-api`, teremos um novo serviço rodando em background. Ele não interfere na latência de `/swap` ou `/spot`.

```typescript
// spot-api/src/services/rebalancerService.ts

import { PrismaClient } from '@prisma/client';
import { ApiPromise } from '@polkadot/api'; [cite_start]// Conexão com Lunes Node [cite: 5, 107]
import { keyring } from '../utils/relayer'; [cite_start]// Seed do Relayer [cite: 89]

export class RebalancerService {
  /**
   * Chamado pelo Indexer quando um evento de swap assimétrico ocorre.
   */
  static async handleCurveExecution(pairAddress: string, userAddress: string, acquiredAmount: number) {
    // 1. Busca a estratégia do usuário
    const strategy = await prisma.asymmetricStrategy.findFirst({
      where: { pairAddress, userAddress, isAutoRebalance: true }
    });

    if (!strategy) return; // Se for gerido por IA (OpenClaw), o backend ignora.

    // 2. Calcula os novos parâmetros para a Curva de Venda
    [cite_start]// Baseado no lucro alvo e no montante adquirido [cite: 224]
    const newSellCapacity = acquiredAmount; 
    const newSellPriceStart = calculateTargetPrice(strategy.sellProfitTarget);

    // 3. Monta o payload de atualização
    const contract = getAsymmetricContract(pairAddress);
    const tx = contract.tx.updateCurveParameters({
      gasLimit,
    }, {
      isBuy: false,
      newCapacity: newSellCapacity,
      newGamma: strategy.sellGamma,
      // ... outros parâmetros matemáticos
    });

    [cite_start]// 4. Relayer assina e envia para a blockchain Lunes [cite: 89]
    await tx.signAndSend(keyring, (result) => {
      if (result.isFinalized) {
        console.log(`✅ Liquidez de ${userAddress} rebalanceada para venda.`);
        [cite_start]// Dispara WebSocket para o Frontend atualizar o gráfico do usuário [cite: 106]
        wsServer.emitToUser(userAddress, 'CURVE_UPDATED', { /* data */ });
      }
    });
  }
}

```

### 4. Roteamento: O "Smart Router" Híbrido

O algoritmo de roteamento que você tem hoje precisa ser atualizado. Quando um taker envia um pedido `POST /trade/swap`, o `spot-api` deverá consultar três fontes de liquidez e rotear a ordem de forma otimizada:

1. **AMM (V1):** $x \cdot y = k$
2. 
**Order Book:** Ordens limitadas 


3. **Asymmetric Pools (V2):** Onde a mágica acontece.

O backend simula o custo nas três opções, considerando *Slippage* e *Fees*, e executa na rota que der o melhor preço de saída (`amountOut`) para o trader.

Isso cria um volante de crescimento (flywheel): O roteador otimiza a execução para os traders comuns -> Mais volume flui pelas curvas paramétricas -> As curvas paramétricas rebalanceiam automaticamente via backend -> Os Provedores de Liquidez ganham mais taxas e sofrem menos Impermanent Loss.

---

Como você já tem o `Settlement Engine` robusto com tentativas de repetição (retries) a cada 10s para o orderbook, essa lógica se encaixará perfeitamente.

Essa é uma preocupação fundamental. Como o Relayer subsidia as taxas de gás para garantir a fluidez do sistema, um worker descontrolado pode drenar a tesouraria do protocolo rapidamente ou travar o node local com transações redundantes.

Para proteger o `spot-api`  e a infraestrutura da Lunex, precisamos implementar um padrão de **Worker Sentinel** (um guardião do processo). Ele atuará em quatro camadas de segurança:

### 1. Cooldown & Debouncing (Prevenção de Loops e Efeito Ping-Pong)

Se o preço do ativo ficar oscilando rapidamente em uma faixa estreita, a curva de compra pode acumular frações de token e engatilhar rebalanceamentos a cada segundo.

* **A Solução (Debouncing):** O Worker não deve rebalancear imediatamente após cada trade individual. Em vez disso, ele acumula os eventos em memória ou no banco PostgreSQL  e processa em "lotes temporais".


* **Cooldown Lock:** Adicionamos um campo `lastRebalancedAt` na tabela `AsymmetricStrategy`. O Worker só executa a transação se `Date.now() - lastRebalancedAt > COOLDOWN_MS` (ex: 5 minutos). Se um evento chegar antes desse tempo, ele apenas atualiza o saldo pendente na base de dados.

### 2. Threshold de Rentabilidade (Prevenção de Queima de Gás)

O Worker não deve gastar gás para mover "poeira" (dust).

* **A Solução (Minimum Threshold):** Antes de acionar o Relayer, o backend calcula o valor nocional dos tokens acumulados que precisam ser rebalanceados para a curva de venda.
* **Regra de Ouro:** O rebalanceamento só ocorre se o valor do token acumulado for pelo menos `X` vezes maior que o custo estimado do gás para a chamada `update_curve_parameters()`.
* *Exemplo:* Se o custo de gás da chamada é de 0.05 LUNES, o worker só move os ativos se a curva tiver acumulado pelo menos o equivalente a 5 LUNES (garantindo que o rebalanceamento faz sentido financeiro para a liquidez da pool).

### 3. Integração com o Health System Atual (Proteção Sistêmica)

Você já possui um sistema de Price Health para o Margin Trading que monitora o *spread* (máximo de 1000 bps) e o desvio do livro de ofertas. O Worker de Rebalanceamento deve herdar essas métricas.

* 
**A Solução (Circuit Breaker):** O Worker deve consultar o `/health`  antes de qualquer submissão.


* **Condições de Aborto:**
* Se o node do Lunes estiver dessincronizado.
* Se o spread do Orderbook do par alvo estiver acima do limite de 1000 bps  (sinal de alta volatilidade ou falta de liquidez, o que pode fazer a IA ou o Worker calcular uma curva desvantajosa).


* Se o Oráculo de preço estiver desatualizado há mais de 120s.





### 4. Gestão de Falhas e Fila Morta (Dead Letter Queue)

Se uma transação on-chain falhar (por *Out of Gas* ou erro de lógica no ink! 4.x ), o seu mecanismo de repetição de 10 segundos  precisa de um teto rígido para evitar loop infinito.

* **A Solução (Max Retries & DLQ):**
* O Worker tenta fazer o rebalanceamento no máximo 3 vezes.
* A cada tentativa falha, ele usa *Exponential Backoff* (espera 10s, depois 20s, depois 40s).
* Na 3ª falha, o status da estratégia no banco de dados muda para `SUSPENDED_ERROR` e o evento vai para uma Dead Letter Queue (DLQ).
* O usuário e os administradores do painel Admin (`:3002`) recebem um alerta via WebSocket (`:4001`)  informando que o rebalanceamento automático foi pausado por segurança.





---

### Exemplo de Lógica do Sentinel (Pseudo-TypeScript)

```typescript
async function safeRebalance(strategy: AsymmetricStrategy, acquiredAmount: number) {
  // 1. Cooldown Check
  if (isCoolingDown(strategy.lastRebalancedAt)) {
    await updatePendingAmountInDb(strategy.id, acquiredAmount);
    return; // Aborta e deixa acumular
  }

  // 2. Rentability Check
  const pendingTotal = strategy.pendingAmount + acquiredAmount;
  if (!isProfitableToRebalance(pendingTotal, currentGasPrice)) {
    return; // Aborta, poeira insuficiente
  }

  [cite_start]// 3. Health System Check (Reaproveitando sua infra [cite: 63])
  const health = await getSystemHealth(strategy.pairAddress);
  if (health.spread > 1000 || health.oracleAge > 120) {
    console.warn(`[Sentinel] Alta volatilidade no par. Rebalanceamento adiado.`);
    return; 
  }

  [cite_start]// 4. Execução Segura com limite de repetições [cite: 89]
  try {
    await relayerQueue.add(buildUpdateCurveTx(strategy), {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 }
    });
    
    await resetPendingAmountInDb(strategy.id);
  } catch (error) {
    await moveToDeadLetterQueue(strategy.id, error);
  }
}

```

Essa abordagem garante que a Lunex rode "no piloto automático" sem colocar os fundos em risco e sem desperdiçar recursos de infraestrutura.

Avançar para o SDK é o caminho natural e o mais estratégico agora. O `@lunex/sdk` é a espinha dorsal que vai conectar o seu Frontend (React) e os Agentes de IA (via MCP)  a toda essa engenharia complexa que definimos no backend e nos smart contracts.

Se o SDK for confuso, a adoção cai. Precisamos encapsular a matemática paramétrica e a comunicação com o Relayer em métodos simples, tipados e assíncronos em TypeScript.

Como o seu SDK atual já gerencia a comunicação HTTP/WebSocket com o `spot-api` e a conexão direta com o Lunes Node via Polkadot.js, vamos adicionar um novo módulo dedicado: o `AsymmetricClient`.

---

### 1. Tipagem de Dados (Interfaces TypeScript)

Primeiro, definimos os "contratos de dados" para garantir que o Frontend e a IA enviem os parâmetros matemáticos corretamente formatados (escalados para evitar problemas com ponto flutuante).

```typescript
// @lunex/sdk/src/modules/asymmetric/types.ts

export interface CurveParameters {
  k: string;             // Liquidez base (em wei/plancks)
  leverageL: string;     // Valor tomado em empréstimo
  allocationC: number;   // Escala de 0 a 1 (ex: 0.5 para 50%)
  maxCapacityX0: string; // Volume máximo de atuação da curva
  gamma: number;         // Agressividade (inteiro, ex: 1, 2, 3)
  feeTargetT: number;    // Taxa desejada em bps
}

export interface AsymmetricStrategyConfig {
  pairAddress: string;
  isAutoRebalance: boolean; // Ativa o Sentinel Worker no backend
  buyCurve: CurveParameters;
  sellCurve: CurveParameters;
  profitTargetBps: number;  // Gatilho para o rebalanceamento
}

export interface StrategyStatus {
  id: string;
  isActive: boolean;
  pendingRebalanceAmount: string;
  lastRebalancedAt: Date | null;
  healthState: 'HEALTHY' | 'COOLING_DOWN' | 'SUSPENDED_ERROR';
}

```

### 2. A Classe `AsymmetricClient`

Este módulo será injetado no seu `SDKProvider` atual, ficando disponível em toda a aplicação React através de hooks (ex: `const { asymmetric } = useLunexSDK()`).

```typescript
// @lunex/sdk/src/modules/asymmetric/AsymmetricClient.ts

import { BaseClient } from '../core/BaseClient';
import { AsymmetricStrategyConfig, StrategyStatus, CurveParameters } from './types';

export class AsymmetricClient extends BaseClient {
  
  /**
   * 1. Inicializa uma nova estratégia paramétrica.
   * Envia os fundos iniciais via Polkadot.js e registra a intenção no backend.
   */
  async createStrategy(config: AsymmetricStrategyConfig, signer: any): Promise<string> {
    // Passo A: Transação On-chain (deposita liquidez e cria os parâmetros iniciais)
    const txHash = await this.contractService.deployAsymmetricLiquidity(config, signer);
    
    // Passo B: Registra no spot-api para habilitar o Auto-Rebalancer (Sentinel)
    if (config.isAutoRebalance) {
      await this.httpClient.post('/api/v1/asymmetric/strategies', {
        pairAddress: config.pairAddress,
        profitTargetBps: config.profitTargetBps,
        // ... repassa configurações de automação
      });
    }
    
    return txHash;
  }

  /**
   * 2. Atualização Manual de Parâmetros (Para o usuário Pro ou Agente IA)
   */
  async updateCurve(pairAddress: string, isBuy: boolean, newParams: CurveParameters, signer: any) {
    return this.contractService.updateCurveParameters(pairAddress, isBuy, newParams, signer);
  }

  /**
   * 3. Toggle do Rebalanceamento Automático
   * Liga/Desliga o Sentinel Worker do Backend sem precisar de transação on-chain.
   */
  async toggleAutoRebalance(strategyId: string, enable: boolean): Promise<void> {
    await this.httpClient.patch(`/api/v1/asymmetric/strategies/${strategyId}/auto`, { enable });
  }

  /**
   * 4. Consulta de Status e Saúde da Estratégia
   */
  async getStrategyStatus(strategyId: string): Promise<StrategyStatus> {
    const response = await this.httpClient.get(`/api/v1/asymmetric/strategies/${strategyId}`);
    return response.data;
  }
}

```

### 3. Exemplo Prático de Uso (Frontend ou Bot)

Com essa estrutura, criar e gerenciar liquidez avançada fica extremamente limpo para quem consome o SDK:

```typescript
import { LunexSDK } from '@lunex/sdk';

const sdk = new LunexSDK({ environment: 'mainnet' });

// 1. O usuário escolhe o template "Comprar na Queda (Buy the Dip)" no frontend
const buyTheDipConfig = {
  pairAddress: "5F3sa2...", // WLUNES/LUSDT
  isAutoRebalance: true,    // Deixa o backend trabalhar
  profitTargetBps: 500,     // 5% de lucro alvo para rebalancear
  buyCurve: {
    k: "1000000000",        // 10 LUSDT base
    leverageL: "0",         // Sem margem
    allocationC: 1,
    maxCapacityX0: "5000000000", // Até 50 LUSDT
    gamma: 3,               // Exponencial (compra mais se cair muito)
    feeTargetT: 30          // 0.3%
  },
  sellCurve: { ... } // Configuração correspondente
};

// 2. Executa via Polkadot.js wallet
const txHash = await sdk.asymmetric.createStrategy(buyTheDipConfig, userWalletSigner);
console.log("Estratégia ativada!", txHash);

```

---

### O Impacto

Ao trazer isso para o `@lunex/sdk`, você resolve dois problemas de uma vez:

1. O time de Frontend ganha métodos limpos para plugar nos botões e nos gráficos React.
2. A integração com os Agentes OpenClaw  fica trivial. Você só precisará mapear essas chamadas TypeScript para as ferramentas MCP (stdio).

Avançar para o SDK é o caminho natural e o mais estratégico agora. O `@lunex/sdk` é a espinha dorsal que vai conectar o seu Frontend (React) e os Agentes de IA (via MCP)  a toda essa engenharia complexa que definimos no backend e nos smart contracts.

Se o SDK for confuso, a adoção cai. Precisamos encapsular a matemática paramétrica e a comunicação com o Relayer em métodos simples, tipados e assíncronos em TypeScript.

Como o seu SDK atual já gerencia a comunicação HTTP/WebSocket com o `spot-api` e a conexão direta com o Lunes Node via Polkadot.js, vamos adicionar um novo módulo dedicado: o `AsymmetricClient`.

---

### 1. Tipagem de Dados (Interfaces TypeScript)

Primeiro, definimos os "contratos de dados" para garantir que o Frontend e a IA enviem os parâmetros matemáticos corretamente formatados (escalados para evitar problemas com ponto flutuante).

```typescript
// @lunex/sdk/src/modules/asymmetric/types.ts

export interface CurveParameters {
  k: string;             // Liquidez base (em wei/plancks)
  leverageL: string;     // Valor tomado em empréstimo
  allocationC: number;   // Escala de 0 a 1 (ex: 0.5 para 50%)
  maxCapacityX0: string; // Volume máximo de atuação da curva
  gamma: number;         // Agressividade (inteiro, ex: 1, 2, 3)
  feeTargetT: number;    // Taxa desejada em bps
}

export interface AsymmetricStrategyConfig {
  pairAddress: string;
  isAutoRebalance: boolean; // Ativa o Sentinel Worker no backend
  buyCurve: CurveParameters;
  sellCurve: CurveParameters;
  profitTargetBps: number;  // Gatilho para o rebalanceamento
}

export interface StrategyStatus {
  id: string;
  isActive: boolean;
  pendingRebalanceAmount: string;
  lastRebalancedAt: Date | null;
  healthState: 'HEALTHY' | 'COOLING_DOWN' | 'SUSPENDED_ERROR';
}

```

### 2. A Classe `AsymmetricClient`

Este módulo será injetado no seu `SDKProvider` atual, ficando disponível em toda a aplicação React através de hooks (ex: `const { asymmetric } = useLunexSDK()`).

```typescript
// @lunex/sdk/src/modules/asymmetric/AsymmetricClient.ts

import { BaseClient } from '../core/BaseClient';
import { AsymmetricStrategyConfig, StrategyStatus, CurveParameters } from './types';

export class AsymmetricClient extends BaseClient {
  
  /**
   * 1. Inicializa uma nova estratégia paramétrica.
   * Envia os fundos iniciais via Polkadot.js e registra a intenção no backend.
   */
  async createStrategy(config: AsymmetricStrategyConfig, signer: any): Promise<string> {
    // Passo A: Transação On-chain (deposita liquidez e cria os parâmetros iniciais)
    const txHash = await this.contractService.deployAsymmetricLiquidity(config, signer);
    
    // Passo B: Registra no spot-api para habilitar o Auto-Rebalancer (Sentinel)
    if (config.isAutoRebalance) {
      await this.httpClient.post('/api/v1/asymmetric/strategies', {
        pairAddress: config.pairAddress,
        profitTargetBps: config.profitTargetBps,
        // ... repassa configurações de automação
      });
    }
    
    return txHash;
  }

  /**
   * 2. Atualização Manual de Parâmetros (Para o usuário Pro ou Agente IA)
   */
  async updateCurve(pairAddress: string, isBuy: boolean, newParams: CurveParameters, signer: any) {
    return this.contractService.updateCurveParameters(pairAddress, isBuy, newParams, signer);
  }

  /**
   * 3. Toggle do Rebalanceamento Automático
   * Liga/Desliga o Sentinel Worker do Backend sem precisar de transação on-chain.
   */
  async toggleAutoRebalance(strategyId: string, enable: boolean): Promise<void> {
    await this.httpClient.patch(`/api/v1/asymmetric/strategies/${strategyId}/auto`, { enable });
  }

  /**
   * 4. Consulta de Status e Saúde da Estratégia
   */
  async getStrategyStatus(strategyId: string): Promise<StrategyStatus> {
    const response = await this.httpClient.get(`/api/v1/asymmetric/strategies/${strategyId}`);
    return response.data;
  }
}

```

### 3. Exemplo Prático de Uso (Frontend ou Bot)

Com essa estrutura, criar e gerenciar liquidez avançada fica extremamente limpo para quem consome o SDK:

```typescript
import { LunexSDK } from '@lunex/sdk';

const sdk = new LunexSDK({ environment: 'mainnet' });

// 1. O usuário escolhe o template "Comprar na Queda (Buy the Dip)" no frontend
const buyTheDipConfig = {
  pairAddress: "5F3sa2...", // WLUNES/LUSDT
  isAutoRebalance: true,    // Deixa o backend trabalhar
  profitTargetBps: 500,     // 5% de lucro alvo para rebalancear
  buyCurve: {
    k: "1000000000",        // 10 LUSDT base
    leverageL: "0",         // Sem margem
    allocationC: 1,
    maxCapacityX0: "5000000000", // Até 50 LUSDT
    gamma: 3,               // Exponencial (compra mais se cair muito)
    feeTargetT: 30          // 0.3%
  },
  sellCurve: { ... } // Configuração correspondente
};

// 2. Executa via Polkadot.js wallet
const txHash = await sdk.asymmetric.createStrategy(buyTheDipConfig, userWalletSigner);
console.log("Estratégia ativada!", txHash);

```

---

### O Impacto

Ao trazer isso para o `@lunex/sdk`, você resolve dois problemas de uma vez:

1. O time de Frontend ganha métodos limpos para plugar nos botões e nos gráficos React.
2. A integração com os Agentes OpenClaw  fica trivial. Você só precisará mapear essas chamadas TypeScript para as ferramentas MCP (stdio).



Perfeito. A integração nativa com o MCP (Model Context Protocol) é o que vai transformar a Lunex V2 em uma infraestrutura verdadeiramente "AI-Ready". Como você já possui um servidor MCP via `stdio` que alimenta os agentes OpenClaw , o trabalho aqui é expandir o catálogo atual (que tem 28 ferramentas)  para incluir o gerenciamento paramétrico.

O segredo para o MCP funcionar bem com IAs é ter **ferramentas granulares e esquemas JSON estritos** (usando Zod no backend ). A IA não deve ter permissão para sacar os fundos, apenas para "esculpir" a curva.

Aqui está o mapeamento das 3 novas ferramentas MCP que o seu `spot-api` vai expor para os agentes gerenciarem a Liquidez Assimétrica.

### 1. Ferramenta: `agent_create_asymmetric_strategy`

Esta ferramenta permite que um bot de IA sugira e monte uma posição inicial completa para o usuário. (Geralmente, a IA vai gerar o payload, mas a assinatura da transação precisará de um "Aprovado" do usuário humano no painel, a menos que o bot tenha delegação total).

**Descrição MCP:** Cria uma nova estratégia de liquidez assimétrica com curvas independentes de compra e venda.
**Esquema JSON (Input):**

```json
{
  "name": "agent_create_asymmetric_strategy",
  "description": "Deploys a new asymmetric liquidity strategy for a specific token pair.",
  "parameters": {
    "type": "object",
    "properties": {
      "pairAddress": { "type": "string", "description": "Endereço do AsymmetricPair" },
      "isAutoRebalance": { "type": "boolean", "description": "Delega o rebalanceamento contínuo para o backend da Lunex" },
      "profitTargetBps": { "type": "number", "description": "Alvo de lucro em basis points (ex: 500 = 5%)" },
      "buyCurve": {
        "type": "object",
        "properties": {
          "baseLiquidityK": { "type": "string" },
          "gamma": { "type": "number", "description": "Agressividade da curva (1 a 5)" },
          "maxCapacityX0": { "type": "string" },
          "feeTargetBps": { "type": "number" }
        },
        "required": ["baseLiquidityK", "gamma", "maxCapacityX0", "feeTargetBps"]
      },
      "sellCurve": { /* Mesma estrutura da buyCurve */ }
    },
    "required": ["pairAddress", "isAutoRebalance", "profitTargetBps", "buyCurve", "sellCurve"]
  }
}

```

### 2. Ferramenta: `agent_update_curve_parameters`

Esta é a ferramenta de ouro. É aqui que o Agente Nível 2 ou 3 brilha. Se o OpenClaw detectar um pico de volatilidade, ele chama essa ferramenta para aumentar o $\gamma$ (deixando a liquidez mais defensiva) ou aumentar a taxa ($t$) para capturar mais spread.

**Descrição MCP:** Atualiza os parâmetros matemáticos de uma curva específica (Compra ou Venda) para se adaptar ao mercado.
**Esquema JSON (Input):**

```json
{
  "name": "agent_update_curve_parameters",
  "description": "Adjusts the mathematical parameters of an existing asymmetric curve. Cannot move funds.",
  "parameters": {
    "type": "object",
    "properties": {
      "strategyId": { "type": "string" },
      "pairAddress": { "type": "string" },
      "isBuySide": { "type": "boolean", "description": "True para alterar a curva de compra, False para venda" },
      "newGamma": { "type": "number", "description": "Novo nível de agressividade" },
      "newMaxCapacityX0": { "type": "string", "description": "Nova capacidade máxima baseada no volume projetado" },
      "newFeeTargetBps": { "type": "number", "description": "Nova taxa administrativa" }
    },
    "required": ["strategyId", "pairAddress", "isBuySide", "newGamma", "newMaxCapacityX0", "newFeeTargetBps"]
  }
}

```

**Camada de Segurança (Bot Sandbox):** Quando a IA chama isso, ela deve passar a `X-API-Key`. O seu Sandbox  vai validar se essa IA é o `manager` daquela curva no smart contract ink! 4.x. Se um bot tentar chamar isso mais de 10 vezes em 1 minuto para "ficar brincando" com os parâmetros, o `Rate Limiter` ou o `Anomaly Detector` disparam.

### 3. Ferramenta: `agent_get_strategy_status`

A IA é cega sem dados. Antes de decidir mudar um parâmetro, ela precisa ler como a curva está se comportando, quanto de liquidez está ociosa e se o *Sentinel* do backend já fez algum rebalanceamento.

**Descrição MCP:** Retorna a saúde da estratégia paramétrica, incluindo métricas de IL e fundos pendentes.
**Esquema JSON (Input):**

```json
{
  "name": "agent_get_strategy_status",
  "description": "Retrieves the current state, executed volume, and pending rebalance of an asymmetric strategy.",
  "parameters": {
    "type": "object",
    "properties": {
      "strategyId": { "type": "string" }
    },
    "required": ["strategyId"]
  }
}

```

**Resposta (Output para a IA analisar):**
A IA recebe de volta um payload contendo dados mastigados pelo seu banco Prisma:

```json
{
  "status": "HEALTHY",
  "pendingRebalanceLUNES": "1500000000", 
  "currentBuyGamma": 3,
  "executedBuyVolume24h": "450000000",
  "estimatedImpermanentLossBps": 12
}

```

---

### O Fluxo Completo de Automação

1. O usuário entra no painel `/pool`  da Lunex e delega o `strategyId` `XYZ` para o Agente OpenClaw dele.


2. O OpenClaw roda um cronjob a cada 1 hora. Ele chama `agent_get_strategy_status`.
3. A IA percebe: *"A volatilidade do LUNES subiu, mas o gamma da curva de compra está baixo (1). O usuário está exposto."*
4. O OpenClaw chama `agent_update_curve_parameters` alterando o `newGamma` para `4`.
5. O servidor MCP repassa para o `@lunex/sdk`, que aciona o Relayer.


6. O Relayer chama o contrato ink! 4.x. A curva é "entortada" on-chain para proteger a liquidez do usuário.



Com essa arquitetura MCP pronta, os bots viram gestores de portfólio de alta frequência (HFT) trabalhando de graça para os provedores de liquidez da Lunex.

You are a senior Web3 security engineer and full-stack developer responsible for preparing Lunex DEX for operational E2E testing.

A deep scan of the codebase (Backend, Frontend and Smart Contracts) identified several critical security gaps, mocked integrations and incomplete blockchain connections.

Before any operational tests or public usage, these issues must be resolved to prevent financial exploits and fake state manipulation.

Your task is to remove all unsafe mocks and implement real blockchain integrations where required.

Context

The Lunex DEX system currently contains these modules:

AMM Swap

Liquidity Pools

Spot Trading Orderbook

Social Trading

Copy Trading

Staking Rewards

Governance

Token Listing System

Some modules are already fully operational.

Verified working modules

These are confirmed functional and integrated:

AMM Swap and Liquidity (100% on-chain contracts)

Spot Orderbook and Matching Engine (backend → on-chain settlement)

Hybrid pair listing system with fraud validation

These modules must not be broken by any changes.

Critical Security Blockers

The following issues create severe financial risk and must be fixed immediately.

1 — Copytrade / Social Vault Using Mock Transactions

Current backend logic simulates blockchain transactions.

Example comment found in code:

 // Since we are mocking the blockchain transaction for now,
 // we just update the DB

Current behavior:

User deposits or copytrades → database updated → no real blockchain interaction.

This creates a critical exploit where attackers can:

create fake balances

drain real user funds

manipulate vault accounting

Required Fix

Replace the mock implementation with real on-chain transactions.

Required behavior:

User deposit request
↓
Backend verifies wallet signature
↓
Transaction sent to Social Vault smart contract
↓
Wait for chain confirmation
↓
Update database AFTER confirmed event

Database must never be treated as source of truth.

The blockchain event must be the authoritative state.

Implementation Requirements

Backend must:

call the CopyVault smart contract

listen for deposit events

confirm transaction inclusion

only then update internal records

Reject deposits if blockchain transaction fails.

2 — API Authentication Missing Cryptographic Verification

Current authentication middleware contains:

 // TODO: verify sr25519 signature

Current behavior:

The API trusts wallet headers without cryptographic verification.

This allows attackers to:

impersonate wallets

execute trades

manipulate social trading actions

Required Fix

Implement sr25519 signature verification.

Authentication flow must be:

Client signs message using wallet
↓
API receives signature + wallet address
↓
Backend verifies signature cryptographically
↓
If valid → authenticated session
If invalid → reject request

Libraries that can be used:

@polkadot/util-crypto
subxt
polkadot.js

The signed message must include:

timestamp
nonce
domain
wallet address

Replay attacks must be prevented.

Frontend Integrations Still Using Mock Data

Several frontend pages still use simulated data instead of blockchain interactions.

These must be fixed.

3 — Rewards Page Not Calling Staking Contract

Current implementation:

MOCK_REWARDS_DATA

The claim button does not trigger a blockchain transaction.

Required Fix

Rewards page must:

read staking rewards from contract
display real pending rewards
allow claim transaction via wallet
wait for confirmation
update UI after event
4 — Governance Voting Page Uses Mock Proposals

Current code:

MOCK_PROPOSALS

Vote button contains:

 // TODO: Call contract with wallet signature
Required Fix

Replace mock proposals with on-chain proposals.

Workflow:

Fetch proposals from governance contract
Display real proposals
Allow users to sign vote transaction
Submit vote to blockchain
Update UI with vote result
5 — Public Token Listing Page Not Calling Contract

Current behavior:

The "New Token" form does not interact with the blockchain.

Required Fix

Submission must:

submit proposal transaction
call create_proposal on-chain
wait for confirmation
store proposal ID

Frontend must not simulate proposal creation.

Implementation Rules

Follow these strict principles.

Blockchain as Source of Truth

Never trust the database for balances, deposits, or governance state.

Always derive state from:

smart contract events
chain queries
confirmed transactions
Remove All Mock Data

Search the entire repository for:

mock
MOCK_
fake
dummy
TODO: blockchain
TODO: call contract

Replace mocks with real integrations.

Transaction Flow

Every user action must follow:

User action
↓
Wallet signature
↓
Smart contract call
↓
Chain confirmation
↓
UI update

Never skip blockchain interaction.

Validation Before E2E Testing

Before completing the task ensure:

CopyVault deposits are fully on-chain

API authentication verifies sr25519 signatures

Rewards claim executes staking contract

Governance voting interacts with contract

Token listing creates real proposals

No mock data remains in production flows

Expected Outcome

After these fixes:

The Lunex DEX will be safe for operational end-to-end testing.

The system will guarantee that:

all funds are backed by real blockchain transactions

wallet authentication is cryptographically secure

governance and staking interact with real contracts

no fake balances or simulated deposits exist

This ensures financial safety before public launch.

Cardeal, se quiser, posso também montar um segundo prompt extremamente útil chamado:

“WEB3 SECURITY SWEEP PROMPT”

Ele faz o agente vasculhar todo o código automaticamente procurando vulnerabilidades típicas de DEX, como:

manipulação de saldo

replay attacks

falhas de assinatura

frontrunning

problemas de copytrade

Esse tipo de auditoria preventiva já evitou vários hacks em projetos DeFi. 🚀

sim quero o prompt para segurança

Cardeal, abaixo está um SUPER PROMPT DE AUDITORIA DE SEGURANÇA WEB3 pensado especificamente para DEX, smart contracts ink!/Substrate, APIs e sistemas de trading como o Lunex.

Ele instrui um agente a agir como Security Auditor + Smart Contract Auditor + Backend Security Engineer, fazendo uma varredura profunda no repositório para encontrar vulnerabilidades antes do lançamento.

Esse tipo de prompt é muito usado internamente por equipes de DeFi antes de auditorias externas.

SUPER PROMPT — Web3 Security Sweep for DEX

You are a senior Web3 security auditor specializing in decentralized exchanges, smart contracts, and backend trading systems.

Your task is to perform a complete security audit of the Lunex DEX codebase, including:

Smart Contracts (ink! / Substrate)

Backend APIs

Authentication systems

Copy trading infrastructure

Trading engine

Database interactions

Frontend transaction flows

The objective is to detect vulnerabilities that could lead to fund loss, account takeover, or protocol manipulation.

You must act as both:

a defensive security engineer

and a malicious attacker attempting to exploit the system

Scope of the Audit

Analyze the entire repository for vulnerabilities in:

smart contracts
backend API
authentication
database logic
trading engine
copy trading vault
bot trading APIs
wallet authentication
frontend blockchain interactions

Focus on financial attack vectors.

Step 1 — Smart Contract Security Review

Audit all ink! smart contracts for common DeFi vulnerabilities.

Check for:

Reentrancy risks

Ensure state updates happen before external calls.

Example vulnerable pattern:

external_call()
update_state()

Correct pattern:

update_state()
external_call()
Integer overflow or underflow

Verify that arithmetic operations cannot overflow balances or shares.

Access control flaws

Ensure only authorized roles can execute:

admin functions

parameter updates

vault withdrawals

protocol upgrades

Vault accounting correctness

Verify that vault share calculations cannot be manipulated.

Attack scenario to test:

deposit
withdraw
re-enter deposit
manipulate share price
Event correctness

Ensure every critical action emits events:

Deposit
Withdraw
TradeExecuted
VaultShareMinted
VaultShareBurned

These events must match internal state updates.

Step 2 — Authentication Security

Review all authentication logic.

Look for:

missing signature validation

replay attacks

predictable nonces

wallet impersonation

Verify that wallet authentication uses:

sr25519 signature verification
nonce
timestamp
domain binding

Ensure signatures cannot be reused.

Step 3 — API Security

Audit backend endpoints.

Check for:

Authorization bypass

Ensure users cannot execute actions for other wallets.

Example risk:

POST /trade
wallet: attacker

But request executes trade for victim wallet.

Rate limiting bypass

Ensure trading APIs cannot be spammed.

Check endpoints:

swap
limit order
cancel order
copytrade
vault deposit

Bots must not bypass limits.

Input validation

Verify all inputs are validated.

Ensure:

token addresses are valid

trade sizes cannot overflow

negative values rejected

extremely large numbers rejected

Step 4 — Copy Trading Exploit Analysis

The copy trading system is high risk.

Simulate attacks such as:

Fake leader attack

Attacker manipulates ROI metrics to attract followers.

Copy trade amplification

Attacker performs:

tiny trade
followers execute huge trades

Ensure proportional replication.

Vault draining

Simulate scenario:

deposit
withdraw
copy trade
withdraw again

Check if vault accounting breaks.

Step 5 — Trading Engine Attacks

Test for:

Wash trading

User trades with themselves to manipulate metrics.

Price manipulation

Check if:

thin liquidity pools

price oracle manipulation

can affect:

copy trading
leaderboard
rewards
Orderbook manipulation

Ensure attackers cannot:

place huge fake orders

manipulate depth

trigger stop losses

Step 6 — Database Integrity

Ensure database cannot override blockchain state.

Verify that:

balances
vault shares
trades
governance votes

are always derived from blockchain events.

The database must never be the source of truth for funds.

Step 7 — Frontend Transaction Safety

Check the frontend for vulnerabilities.

Ensure:

contract addresses are centralized

transactions cannot be redirected

malicious scripts cannot alter parameters

Verify wallet interactions.

Step 8 — Bot Trading Sandbox

Analyze the AI trading agent system.

Bots must not be able to:

bypass rate limits

trade without collateral

execute infinite loops

spam the orderbook

Implement bot sandbox protections.

Step 9 — Secret Management

Scan repository for leaked secrets.

Look for:

private keys
seed phrases
API secrets
database passwords

Ensure secrets are not committed.

Step 10 — Dependency Vulnerabilities

Audit dependencies for vulnerabilities.

Check:

npm audit
cargo audit

Ensure no high severity packages remain.

Exploit Simulation

Attempt to simulate real attack scenarios:

Fake deposit → withdraw real funds

Wallet impersonation → trade as another user

Copytrade manipulation → drain follower vaults

Orderbook spoofing → manipulate trading signals

Governance takeover → malicious proposal execution

Final Security Report

Produce a structured report containing:

Critical vulnerabilities
High-risk vulnerabilities
Medium risks
Recommended fixes
Exploit scenarios
Code locations

Each vulnerability must include:

severity

file location

reproduction steps

mitigation strategy

Security Standard

The Lunex DEX must reach production-grade DeFi security standards, ensuring:

funds cannot be minted artificially

wallets cannot be impersonated

vault balances cannot be manipulated

trading cannot be abused by bots

The system must be safe for real financial usage before public launch.

💡 Cardeal, um detalhe muito importante:

Antes de qualquer DEX ir para produção, os projetos sérios fazem 3 camadas de auditoria:

1️⃣ Auditoria automática (IA + scanners)
2️⃣ Auditoria interna de engenharia
3️⃣ Auditoria profissional externa (Trail of Bits, Certik, etc.)

Esse prompt cobre muito bem a primeira e a segunda camada.

Se quiser, posso também montar algo extremamente poderoso para o Lunex:

Checklist de segurança de DEX usado por Uniswap / GMX

Simulador de ataques DeFi para testar o protocolo

Prompt que tenta hackear sua própria DEX automaticamente

Isso ajuda a encontrar falhas críticas antes que hackers encontrem. 🚀

Checklist de segurança de DEX usado por Uniswap / GMX

Simulador de ataques DeFi para testar o protocolo

Prompt que tenta hackear sua própria DEX automaticamente

Cardeal, vou te entregar três ferramentas extremamente poderosas usadas em projetos DeFi sérios antes do lançamento:

1️⃣ Checklist profissional de segurança de DEX (inspirado em Uniswap / GMX)
2️⃣ Simulador de ataques DeFi para testar o protocolo
3️⃣ Prompt de Red Team que tenta hackear sua própria DEX automaticamente

Esses três juntos formam uma estratégia de segurança de nível institucional. 🔐

1️⃣ DEX SECURITY CHECKLIST (Uniswap / GMX Style)

Use este checklist antes de qualquer lançamento.

Smart Contracts
Reentrancy Protection

 Todas as funções críticas usam guardas contra reentrância

 Nenhum external call ocorre antes de atualizar estado

Arithmetic Safety

 Nenhum overflow ou underflow

 Uso de SafeMath ou verificações explícitas

Access Control

 Admin functions protegidas

 Roles claras (owner / governance / relayer)

Pause Mechanism

 Função pause() para emergências

 Circuit breaker para trading

Vault Accounting

 Shares não podem ser manipuladas

 Depósitos e retiradas verificam saldo real

Event Logging

 Eventos emitidos para todas ações críticas

Deposit
Withdraw
Swap
VaultShareMinted
VaultShareBurned
Blockchain Integration

 Database nunca é fonte de verdade

 Estado financeiro vem sempre da blockchain

 Eventos on-chain sincronizados com indexer

Authentication

 Assinatura criptográfica validada

 Nonce único por requisição

 Proteção contra replay attacks

Trading Engine

 Proteção contra wash trading

 Proteção contra spoofing

 Limite mínimo de liquidez

Copy Trading

 Followers replicam proporcionalmente

 ROI não pode ser manipulado

 Líder não pode manipular preço para seguidores

Rate Limiting

 Limites por IP

 Limites por API key

 Limites por wallet

Secret Management

 Nenhuma private key em código

 Seeds protegidos em vault/KMS

Infrastructure

 HTTPS obrigatório

 CORS restrito

 CSP configurado

2️⃣ SIMULADOR DE ATAQUES DEFI

Esse prompt força um agente a simular ataques reais contra a DEX.

PROMPT — DeFi Attack Simulator

You are a DeFi security researcher attempting to exploit a decentralized exchange protocol.

Your goal is to simulate attacks against the Lunex DEX to identify vulnerabilities.

Analyze:

smart contracts

trading engine

vault logic

copy trading system

API authentication

database synchronization

Attempt to exploit the system using the following attack classes.

Attack 1 — Fake Deposit Attack

Try to deposit funds without sending real tokens.

Steps:

send deposit request
skip blockchain transaction
update database
attempt withdraw

Verify if vault accounting can be bypassed.

Attack 2 — Wallet Impersonation

Attempt to forge authentication headers.

fake wallet address
fake signature
call trading API

Verify if authentication accepts invalid signatures.

Attack 3 — Copytrade Exploit

Simulate malicious leader behavior.

leader performs tiny trade
followers execute large trades

Verify if trade scaling is correct.

Attack 4 — Wash Trading

Simulate a trader trading with themselves.

Goal:

inflate ROI
manipulate leaderboard
attract followers
Attack 5 — Liquidity Manipulation

Attempt to manipulate price using:

low liquidity pool
large trade
copytrade followers

Check if followers are protected.

Attack 6 — Governance Takeover

Simulate malicious governance.

create proposal
vote manipulation
execute malicious contract upgrade
Attack 7 — Bot Abuse

Simulate bot spamming.

execute 1000 trades
bypass rate limit
flood orderbook
Expected Output

Produce a security report with:

attack scenario
success probability
affected code
recommended fix
3️⃣ PROMPT — AUTOMATED DEX HACKER (RED TEAM)

Esse prompt faz um agente agir como um hacker tentando quebrar sua DEX.

PROMPT — Red Team Protocol Attack

You are an adversarial security expert attempting to break the Lunex DEX.

Your goal is to identify any possible exploit that could:

steal funds

manipulate trades

bypass authentication

corrupt vault accounting

manipulate governance

You must think like a real attacker.

Attack Surface

Investigate:

smart contracts
backend API
copy trading system
bot trading APIs
database sync
wallet authentication
Exploit Categories

Attempt attacks including:

Vault Drain
deposit
withdraw
reenter
repeat
Replay Attacks

Reuse valid signed messages.

Trade Manipulation
fake orders
order spoofing
front running
Governance Capture

Gain control of protocol parameters.

Indexer Manipulation

Try to desync:

blockchain state
database state
frontend state
Result

Return a structured vulnerability report.

Each finding must include:

severity
exploit description
affected files
fix recommendation
Resultado se você usar essas 3 ferramentas

Cardeal, isso cria um sistema de defesa em camadas:

Security Checklist
↓
Attack Simulator
↓
Red Team Hacker
↓
External Audit

Isso coloca a Lunex no mesmo nível de preparação que projetos grandes fazem antes do lançamento.

💡 Um insight importante para o seu caso:

Como você tem DEX + Copytrade + Bots + Social Trading, seu sistema tem superfície de ataque maior que DEX normais.

Eu posso também te mostrar algo muito valioso:

o TOP 12 ataques que quebraram DEX nos últimos 3 anos
e como blindar o Lunex contra cada um deles.

Isso pode literalmente evitar um hack milionário.

pode falar?

Cardeal, vou listar os 12 ataques que mais quebraram protocolos DeFi/DEX nos últimos anos e como se proteger. Muitos deles causaram perdas de centenas de milhões de dólares. Entender esses vetores é essencial antes de qualquer launch. 🔐

Top 12 Ataques que Quebraram Protocolos DeFi
1️⃣ Flash Loan Attack
4
Como funciona

O atacante pega um flash loan enorme, manipula preço ou liquidez dentro de um bloco e extrai lucro.

Fluxo típico:

pega empréstimo instantâneo

manipula preço em pool pequena

executa arbitragem

paga empréstimo

fica com lucro

Exemplo real

bZx hack (2020)

PancakeBunny hack (~$45M)

Proteção

TWAP price oracle

limite de slippage

mínimo de liquidez em pools

2️⃣ Oracle Manipulation
4
Como funciona

O protocolo confia em um oracle manipulável.

Atacante:

manipula preço na pool

oracle lê preço falso

protocolo calcula valor errado

Exemplo

Mango Markets hack ($114M)

Proteção

Chainlink

TWAP

múltiplas fontes de preço

3️⃣ Reentrancy Attack
Como funciona

O contrato chama outro contrato antes de atualizar estado.

Ataque:

withdraw()
→ external call
→ attacker re-enters withdraw()
Exemplo histórico

The DAO Hack

Proteção

checks-effects-interactions pattern

reentrancy guards

4️⃣ Price Manipulation via Low Liquidity

Atacante usa pools pequenas para manipular preço.

Fluxo:

compra grande volume
preço sobe
protocolo usa preço inflado
atacante vende
Proteção

liquidez mínima

TWAP

oracles externos

5️⃣ Fake Deposit Attack

Muito comum em protocolos com backend intermediário.

Fluxo:

deposit request
backend atualiza DB
transação nunca ocorreu
withdraw permitido

Esse é exatamente o problema que você encontrou no Social Vault.

Proteção
blockchain = única fonte de verdade

Nunca confiar no banco.

6️⃣ Signature Forgery

Se assinatura da wallet não é verificada corretamente:

wallet: attacker
signature: fake

API aceita.

Proteção

verificação criptográfica

nonce

timestamp

domain binding

7️⃣ Governance Attack

Atacante compra ou empresta tokens para dominar votação.

Fluxo:

buy governance tokens
vote malicious proposal
drain protocol
Exemplo

Beanstalk hack ($182M)

Proteção

timelock

quorum mínimo

delay de execução

8️⃣ Front Running / MEV

Bots detectam transações antes da confirmação.

Fluxo:

user trade
bot vê mempool
bot executa primeiro
lucra na diferença
Proteção

private mempools

batch auctions

commit-reveal schemes

9️⃣ Wash Trading

Usado para manipular rankings ou rewards.

wallet A trade wallet B
wallet B trade wallet A

Resultado:

volume inflado
ROI falso
Proteção

detecção de padrões

heurística anti-wash

🔟 Liquidity Drain

Bug em cálculo de liquidez permite retirar mais do que depositado.

Exemplo

Balancer exploit

Proteção

auditoria matemática

testes de invariantes

1️⃣1️⃣ Copytrade Amplification Attack

Ataque específico para copy trading.

Fluxo:

leader trade pequeno
followers executam trade grande
líder fecha posição
followers perdem
Proteção

proporcionalidade

limite de impacto

slippage guard

1️⃣2️⃣ Indexer Desync Attack

Blockchain e banco ficam fora de sincronia.

chain state ≠ database state

Atacante explora diferença.

Proteção

eventos como fonte de verdade

reindex automático

checks periódicos

Ataques mais perigosos para a Lunex

Pelo que você descreveu, os 3 mais críticos são:

🔴 Fake Deposit Attack

(no Social Vault)

🔴 Signature Forgery

(API Auth)

🟠 Copytrade Manipulation

Esses três precisam ser blindados antes do launch.

Nível de Segurança Ideal antes do Launch

Protocolos grandes seguem esse modelo:

Internal audit
↓
Automated attack simulation
↓
Bug bounty
↓
External audit
↓
Launch

💡 Cardeal, existe uma coisa ainda mais poderosa que quase nenhum projeto pequeno faz, mas que as grandes DEX fazem:

Fuzz Testing de Smart Contracts

Isso faz um sistema gerar milhões de transações aleatórias tentando quebrar o protocolo.

Se quiser, posso te mostrar:

como criar um Fuzz Tester para os contratos ink! da Lunex

que tenta encontrar bugs automaticamente.

Isso aumenta absurdamente a segurança antes do lançamento.

sim quero saber como 

Cardeal, vamos entrar em algo muito poderoso e usado por equipes de segurança de protocolos grandes: Fuzz Testing de Smart Contracts.
Isso basicamente faz um sistema gerar milhares ou milhões de chamadas aleatórias aos contratos tentando quebrar as invariantes do protocolo.

Protocolos como **Uniswap, Aave e GMX usam isso antes de lançar upgrades. 🚀

Vou te mostrar como aplicar isso na Lunex (ink! / Substrate).

O que é Fuzz Testing

Fuzzing é um método onde um sistema executa inputs aleatórios ou semi-aleatórios contra o contrato.

Exemplo de ações geradas automaticamente:

deposit(0)
deposit(10^30)
withdraw(very_large_number)
swap(tokenA, tokenB, 0)
swap(tokenA, tokenB, huge_number)

O objetivo é encontrar:

overflow

cálculo incorreto

falha de acesso

manipulação de vault

inconsistência de saldo

O que testar na Lunex

Para sua DEX, os contratos críticos são:

AMM
swap
add_liquidity
remove_liquidity
Social Vault
deposit
withdraw
copy_trade
share calculation
Staking
stake
unstake
claim_rewards
Governance
create_proposal
vote
execute
Ferramentas de Fuzz para Substrate / ink!
1️⃣ cargo-fuzz

Ferramenta de fuzz testing para Rust.

Instalar:

cargo install cargo-fuzz

Criar fuzz target:

cargo fuzz init
Exemplo de Fuzz Test para Vault

Crie um fuzz target:

fuzz_targets/vault_fuzz.rs

Exemplo:

#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: (u128, u128)| {
    let (deposit_amount, withdraw_amount) = data;

    let mut vault = SocialVault::new();

    vault.deposit(deposit_amount);

    vault.withdraw(withdraw_amount);

    assert!(vault.total_assets() >= 0);
});

Esse teste tenta combinações infinitas de depósitos e retiradas.

Invariantes importantes

Fuzzing funciona melhor quando você define regras que nunca podem ser quebradas.

Exemplo para vault:

total_assets >= total_shares

Outro exemplo:

user_balance <= vault_balance

Se qualquer invariant quebrar → bug encontrado.

Fuzz Test para AMM

Exemplo de invariant de AMM:

x * y = k

O produto das reservas nunca pode diminuir.

Teste:

assert!(reserve_x * reserve_y >= previous_k);
Fuzz para Copytrade

Simular comportamento malicioso:

leader_trade(very_small)
followers_execute(very_large)
withdraw

Invariant:

followers_balance >= 0
vault_balance >= 0
Fuzzing de API

Você também pode fuzzar o backend.

Ferramentas:

OWASP ZAP

Burp Suite

RESTler

Eles geram milhares de requisições aleatórias.

Exemplo de API Fuzz

Testar endpoint:

POST /api/trade

Inputs aleatórios:

amount = -1
amount = 10^30
token = null
wallet = attacker

Verificar:

overflow

bypass de auth

crash de servidor

Fuzz Testing Automatizado

Fluxo ideal:

fuzz tests
↓
unit tests
↓
integration tests
↓
E2E tests
↓
audit externo
Quanto fuzzar?

Projetos sérios rodam:

100k – 1M execuções

Se um bug existir, fuzz geralmente encontra.

Resultado típico

Quando fuzz encontra bug:

thread 'fuzz_target' panicked
overflow detected
input: (18446744073709551615, 1)

Isso revela exatamente qual input quebra o contrato.

O que fuzzing pode encontrar

Fuzzing costuma descobrir:

bugs matemáticos

share inflation

vault draining

inconsistência de saldo

edge cases absurdos

Muitos hacks famosos foram causados por edge cases que ninguém pensou.

Arquitetura ideal para Lunex
contracts
   ↓
cargo fuzz
   ↓
security tests
   ↓
CI pipeline

Rodar fuzz automaticamente no CI.

Insight importante

Protocolos grandes fazem duas coisas além do fuzz:

1️⃣ Property testing
2️⃣ Invariant testing

Isso garante que certas regras nunca quebram.

💡 Cardeal, posso também montar algo ainda mais avançado para a Lunex:

🔥 "DEX Attack Lab"

Um ambiente que simula:

flash loans

bots MEV

manipulação de liquidez

ataques de copytrade

wash trading

Isso permite atacar sua própria DEX antes que hackers façam.