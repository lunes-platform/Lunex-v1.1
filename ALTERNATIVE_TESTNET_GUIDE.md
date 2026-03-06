# Guia de Deploy em Testnets Alternativas

## Problema Atual
A testnet da Lunes está com problemas de saldo/storage deposit. Vamos usar uma testnet alternativa para testar os contratos.

## Testnet Recomendada: Aleph Zero Testnet

### Por que Aleph Zero?
- ✅ 100% compatível com contratos INK!
- ✅ Faucet funcional e generoso
- ✅ Interface web excelente
- ✅ Comunidade ativa e suporte
- ✅ Documentação completa

### Configurações da Rede

**Aleph Zero Testnet:**
- **Nome**: Aleph Zero Testnet
- **RPC**: `wss://ws.test.azero.dev`
- **Explorer**: https://test.azero.dev
- **Faucet**: https://faucet.test.azero.dev
- **Portal**: https://test.azero.dev

### Passos para Setup

#### 1. Configurar Carteira
- Acesse: https://test.azero.dev
- Conecte sua carteira (Polkadot.js ou SubWallet)
- Ou crie uma nova conta diretamente no portal

#### 2. Obter Tokens de Teste
- Acesse o faucet: https://faucet.test.azero.dev
- Cole seu endereço de carteira
- Solicite tokens AZERO de teste
- Aguarde alguns minutos para receber

#### 3. Deploy dos Contratos
- Acesse: https://test.azero.dev
- Vá em "Developer" → "Contracts"
- Clique em "Upload & Deploy"
- Selecione os arquivos `.contract` da pasta `artifacts`

### Vantagens para Desenvolvimento

1. **Faucet Generoso**: Tokens suficientes para todos os deploys
2. **Interface Amigável**: Similar à interface da Lunes
3. **Explorer Completo**: Visualização de transações e contratos
4. **Suporte à Comunidade**: Discord ativo para ajuda
5. **Compatibilidade Total**: Mesmos contratos INK! funcionam

### Ordem de Deploy Recomendada

1. **Factory Contract** (`factory_contract.contract`)
2. **WNative Contract** (`wnative_contract.contract`)
3. **Router Contract** (`router_contract.contract`)
4. **Pair Contract** (`pair_contract.contract`)
5. **Staking Contract** (`staking_contract.contract`)
6. **Trading Rewards Contract** (`trading_rewards_contract.contract`)

### Configurações de Storage Deposit

Na Aleph Zero, você pode usar valores maiores sem problemas:
- **Factory**: 10-50 AZERO
- **WNative**: 10-30 AZERO
- **Router**: 20-60 AZERO
- **Pair**: 30-80 AZERO
- **Staking**: 50-150 AZERO
- **Trading Rewards**: 40-100 AZERO

### Próximos Passos

1. Acesse https://test.azero.dev
2. Configure sua carteira
3. Solicite tokens no faucet
4. Faça deploy dos contratos
5. Teste as funcionalidades
6. Documente os endereços deployados

### Migração Futura

Quando a testnet da Lunes estiver funcionando:
- Use os mesmos arquivos `.contract`
- Mantenha a mesma ordem de deploy
- Ajuste apenas os parâmetros de rede
- Os contratos são 100% compatíveis

## Outras Alternativas

### Astar Shibuya Testnet
- **RPC**: `wss://rpc.shibuya.astar.network`
- **Portal**: https://portal.astar.network
- **Faucet**: Disponível no portal

### Contracts on Rococo
- **RPC**: `wss://rococo-contracts-rpc.polkadot.io`
- **Portal**: https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Frococo-contracts-rpc.polkadot.io
- **Faucet**: Disponível via Polkadot.js
