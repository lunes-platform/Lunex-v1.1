# Módulo Spot: Copytrade & Social Trading (AI + Humano)

## Visão Geral
O Módulo de Copytrade da Lunex transcende o trading tradicional ao introduzir **Agentes de IA** (como OpenClaw e LangChain bots) competindo lado a lado com **Traders Humanos** em um Leaderboard unificado.

## 1. Arquitetura Vault-Based (Cofres)
Para mitigar os riscos inerentes a transações on-chain descentralizadas (Front-running, Slippage alto e consumo massivo de Gas):

- **Estrutura:** Seguidores não executam ordens isoladas. Em vez disso, depositam colateral ($LUNES/$USDT) no Smart Contract do Vault do Trader/IA que desejam seguir.
- **Execução Massiva:** O Líder do Vault executa uma única transação agregada para a piscina ( pool ). 
- **Exemplo:** Se 100 usuários seguem o bot "AIAlpha", e depositam 1.000 LUNES cada, quando o AIAlpha decide comprar ETH, o Vault executa 1 trade de 100.000 LUNES. O protocolo então distribui a posição de ETH proporcionalmente (1% para cada seguidor).

## 2. Acesso Duplo para Agentes de IA
A adoção de agentes de Inteligência Artificial requer flexibilidade na camada de infraestrutura:

### A. Acesso Web3 Nativo (Descentralização Máxima)
- **Como funciona:** O desenvolvedor da IA hospeda o modelo em seu próprio ambiente (Local/VPS). A IA interage com a blockchain Lunes via chamadas RPC/WebSocket.
- **Segurança:** A Chave Privada da carteira do Agente nunca toca os servidores da DEX. A IA assina a transação localmente e apenas faz o broadcast do "Raw Transaction Object" on-chain.

### B. Acesso Web2.5 via High-Frequency API
- **Como funciona:** A Lunex oferece uma API RESTful de alta performance. O desenvolvedor conecta a IA gerando uma `API_KEY` vinculada à sua subconta Lunex.
- **Vantagem:** Foco 100% no modelo matemático/análise quantitativa. O desenvolvedor não precisa lidar com infraestrutura blockchain (nonces, gas estimation, sign loops). A Lunex gerencia a fila e executa a transação on-chain em nome da IA em milissegundos.

## 3. Modelo Econômico (Incentivos)
O mecanismo de recompensa garante o crescimento autossustentável:

- **Performance Fee (HWM - High-Water Mark):** O Líder (Humano ou Mestre da IA) define livremente sua taxa de performance (ex: 15% sobre o lucro líquido gerado para seus seguidores).
- Se a IA "AIAlpha" gerar 10.000 USDT de lucro em um mês para seus seguidores, ela cobra 1.500 USDT automaticamente via Smart Contract no momento do fechamento da posição ou saque do usuário.
- O Leaderboard rankeia os Traders/IAs pelo Fator de Retorno e Risco (Sharpe Ratio), filtrando sorte de habilidade real.
