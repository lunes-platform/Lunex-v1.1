# Guia de Deploy na Testnet Lunes

## Contratos Disponíveis para Deploy

Os seguintes contratos estão compilados e prontos para upload na testnet:

### 1. Factory Contract
- **Arquivo**: `artifacts/factory_contract.contract`
- **Descrição**: Contrato principal que gerencia a criação de pares de trading
- **Prioridade**: Deploy primeiro (outros contratos dependem dele)

### 2. WNative Contract  
- **Arquivo**: `artifacts/wnative_contract.contract`
- **Descrição**: Token wrapped nativo (WLUNES)
- **Prioridade**: Deploy segundo (router depende dele)

### 3. Router Contract
- **Arquivo**: `artifacts/router_contract.contract`
- **Descrição**: Interface principal para swaps e liquidez
- **Prioridade**: Deploy terceiro (depende do factory e wnative)

### 4. Pair Contract
- **Arquivo**: `artifacts/pair_contract.contract`
- **Descrição**: Contrato de par de trading individual
- **Prioridade**: Deploy quarto

### 5. Staking Contract
- **Arquivo**: `artifacts/staking_contract.contract`
- **Descrição**: Sistema de staking de tokens
- **Prioridade**: Deploy quinto

### 6. Trading Rewards Contract
- **Arquivo**: `artifacts/trading_rewards_contract.contract`
- **Descrição**: Sistema de recompensas por trading
- **Prioridade**: Deploy sexto

## Ordem Recomendada de Deploy

1. **Factory** → 2. **WNative** → 3. **Router** → 4. **Pair** → 5. **Staking** → 6. **Trading Rewards**

## Passos para Deploy via Interface Web

### 1. Upload do Contrato
- Clique em "Upload New Contract Code"
- Selecione o arquivo `.contract` da pasta `artifacts`
- Aguarde o upload completar

### 2. Configuração do Contrato
- Defina um nome para o contrato
- Configure os parâmetros iniciais se necessário
- Confirme o deploy

### 3. Verificação
- Anote o endereço do contrato deployado
- Teste as funções básicas
- Salve as informações no arquivo de deployment

## Configurações de Rede

**Testnet Lunes:**
- Endpoint: `wss://ws-test.lunes.io`
- Explorer: Disponível na interface web da testnet

## Próximos Passos Após Deploy

1. Criar arquivo `deployment/testnet.json` com os endereços deployados
2. Configurar as interações entre contratos
3. Testar funcionalidades básicas
4. Documentar os endereços para uso futuro

## Notas Importantes

- Mantenha os endereços dos contratos deployados
- Teste cada contrato após o deploy
- Verifique as dependências entre contratos
- Documente qualquer configuração especial necessária
