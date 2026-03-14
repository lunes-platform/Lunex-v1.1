# Como Obter Tokens LUNES na Testnet

## Problema Atual
- Erro: "Value exceeds available balance"
- Sua conta não tem saldo suficiente para o Storage Deposit Limit

## Soluções

### 1. Faucet da Testnet Lunes
Procure por um faucet oficial da Lunes testnet:
- Verifique a documentação oficial da Lunes
- Procure por links de faucet na interface da testnet
- Entre em contato com a equipe Lunes para obter tokens de teste

### 2. Reduzir o Storage Deposit Limit
Tente valores menores enquanto não consegue mais tokens:

**Valores para testar (do menor para o maior):**
- `1000000000` (1 LUNES)
- `5000000000` (5 LUNES)
- `10000000000` (10 LUNES)
- `20000000000` (20 LUNES)

### 3. Verificar Saldo Atual
- Verifique seu saldo atual na interface
- Anote quanto você tem disponível
- Use um valor menor que seu saldo disponível

### 4. Contatos para Suporte
- Discord/Telegram da comunidade Lunes
- Documentação oficial
- Suporte técnico da equipe Lunes

## Estratégia Recomendada

1. **Primeiro**: Tente com `1000000000` (1 LUNES)
2. **Se funcionar**: Anote o endereço do contrato
3. **Se não funcionar**: Procure o faucet da testnet
4. **Depois**: Faça deploy dos outros contratos

## Ordem de Deploy com Baixo Storage Limit

Se conseguir fazer deploy com limite baixo:
1. Factory (menor contrato)
2. WNative 
3. Router
4. Pair
5. Staking (maior - pode precisar de mais tokens)
6. Trading Rewards
