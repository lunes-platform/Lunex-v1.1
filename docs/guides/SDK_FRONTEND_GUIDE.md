# 🎯 SDK Lunex - Guia para Frontend

## 📦 Instalação

```bash
npm install @lunex/sdk
# ou
yarn add @lunex/sdk
```

## 🚀 Início Rápido

```typescript
import LunexSDK from '@lunex/sdk';

const sdk = new LunexSDK({
    baseURL: 'https://api.lunex.io/v2',
    wsURL: 'wss://api.lunex.io'
});
```

## 📋 Módulos Disponíveis

| Módulo | Descrição | Métodos Principais |
|--------|-----------|-------------------|
| `sdk.auth` | Autenticação | `getNonce()`, `login()` |
| `sdk.tokens` | **Gestão de tokens** | `getToken()`, `formatAmount()`, `parseUserInput()` |
| `sdk.router` | Swaps e liquidez | `getQuote()`, `swapExactTokensForTokens()` |
| `sdk.factory` | Factory de pares | `getPairs()`, `getPair()` |
| `sdk.pair` | Info de pares | `getReserves()`, `getPrice()` |
| `sdk.staking` | Staking | `stake()`, `unstake()`, `claimRewards()` |
| `sdk.rewards` | Reward pool + DB-backed leader/trader rewards | `getPool()`, `getPending()`, `claimRewards()` |
| `sdk.wnative` | Wrap/Unwrap | `deposit()`, `withdraw()` |
| `sdk.utils` | Utilidades | `formatAmount()`, `convertDecimals()` |

---

## 🔢 Trabalhando com Decimais

### Problema
Tokens têm diferentes casas decimais:
- LUNES: 8 decimais
- USDT: 6 decimais
- ETH: 18 decimais
- SOL: 9 decimais

### Solução: Módulo `sdk.tokens`

```typescript
// 1. Obter token com info de decimais
const token = await sdk.tokens.getToken('5Fxyz...');
console.log(token.decimals); // 8

// 2. Parsear input do usuário SEGURO
const userInput = '100.5';
const parsed = sdk.tokens.parseUserInput(userInput, token.decimals);

if (!parsed.success) {
    // Mostrar erro ao usuário
    alert(parsed.error); // "Too many decimal places"
    return;
}

// 3. Usar o valor parseado nas operações
const quote = await sdk.router.getQuote(parsed.parsed, [tokenA, tokenB]);
```

### Formatando para Display

```typescript
// Formatar para exibir ao usuário
const balance = '12345678900'; // raw
const formatted = sdk.tokens.formatAmount(balance, 8, 4);
// { raw: '12345678900', formatted: '123.4567', decimals: 8 }

// Com símbolo
const display = sdk.tokens.formatAmountWithSymbol(balance, token, 4);
// "123.4567 LUNES"
```

---

## 💱 Fazendo Swap

```typescript
import { LunexSDK } from '@lunex/sdk';

async function swap(tokenInAddress: string, tokenOutAddress: string, userAmount: string) {
    const sdk = new LunexSDK({ baseURL: '...' });
    
    // 1. Obter tokens
    const tokenIn = await sdk.tokens.getToken(tokenInAddress);
    const tokenOut = await sdk.tokens.getToken(tokenOutAddress);
    
    // 2. Parsear input do usuário
    const parsed = sdk.tokens.parseUserInput(userAmount, tokenIn.decimals);
    if (!parsed.success) throw new Error(parsed.error);
    
    // 3. Obter quote
    const quote = await sdk.router.getQuote(parsed.parsed!, [
        tokenInAddress,
        tokenOutAddress
    ]);
    
    // 4. Validar swap (opcional mas recomendado)
    const validation = sdk.utils.validateSwapDecimals(
        parsed.parsed!,
        quote.amountOut,
        tokenIn.decimals,
        tokenOut.decimals
    );
    
    if (!validation.valid) {
        throw new Error('Swap inválido');
    }
    if (validation.warnings.length > 0) {
        console.warn('Warnings:', validation.warnings);
    }
    
    // 5. Calcular mínimo com slippage
    const minOut = sdk.router.calculateMinAmount(quote.amountOut, 1); // 1% slippage
    
    // 6. Executar swap
    const result = await sdk.router.swapExactTokensForTokens({
        amountIn: parsed.parsed!,
        amountOutMin: minOut,
        path: [tokenInAddress, tokenOutAddress],
        to: userWallet,
        deadline: sdk.utils.calculateDeadline(20)
    });
    
    // 7. Formatar resultado para display
    return {
        txHash: result.transactionHash,
        amountIn: sdk.tokens.formatAmountWithSymbol(result.amountIn, tokenIn),
        amountOut: sdk.tokens.formatAmountWithSymbol(result.amountOut, tokenOut),
    };
}
```

---

## 💧 Adicionando Liquidez

```typescript
async function addLiquidity(
    tokenAAddress: string, 
    tokenBAddress: string,
    amountAInput: string,
    amountBInput: string
) {
    // 1. Obter tokens
    const tokenA = await sdk.tokens.getToken(tokenAAddress);
    const tokenB = await sdk.tokens.getToken(tokenBAddress);
    
    // 2. Parsear inputs
    const parsedA = sdk.tokens.parseUserInput(amountAInput, tokenA.decimals);
    const parsedB = sdk.tokens.parseUserInput(amountBInput, tokenB.decimals);
    
    if (!parsedA.success || !parsedB.success) {
        throw new Error('Input inválido');
    }
    
    // 3. Normalizar para cálculos (se necessário)
    const normalized = sdk.utils.normalizeAmounts(
        parsedA.parsed!,
        tokenA.decimals,
        parsedB.parsed!,
        tokenB.decimals
    );
    
    console.log('Normalizado para', normalized.targetDecimals, 'decimais');
    
    // 4. Calcular mínimos (1% slippage)
    const minA = sdk.router.calculateMinAmount(parsedA.parsed!, 1);
    const minB = sdk.router.calculateMinAmount(parsedB.parsed!, 1);
    
    // 5. Adicionar liquidez
    const result = await sdk.router.addLiquidity({
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        amountADesired: parsedA.parsed!,
        amountBDesired: parsedB.parsed!,
        amountAMin: minA,
        amountBMin: minB,
        to: userWallet,
        deadline: sdk.utils.calculateDeadline(20)
    });
    
    return result;
}
```

---

## 📊 Exibindo Balances

```typescript
async function showPortfolio(userAddress: string) {
    // Obter todos os balances
    const portfolio = await sdk.tokens.getAllBalances(userAddress);
    
    // Já vem formatado!
    portfolio.balances.forEach(balance => {
        console.log(`${balance.token.symbol}: ${balance.formattedBalance}`);
        console.log(`  USD: $${balance.valueUSD}`);
    });
    
    console.log(`Total: $${portfolio.totalValueUSD}`);
    console.log(`24h: ${portfolio.change24hPercent}%`);
}
```

---

## 🔄 WebSocket (Real-time)

```typescript
// Conectar
sdk.connectWebSocket();

// Escutar atualizações de preço
sdk.on('price', (event) => {
    console.log('Novo preço:', event.price0);
});

// Escutar swaps
sdk.on('swap', (event) => {
    console.log('Swap executado:', event);
});

// Subscrever a um par específico
sdk.subscribeToPair('5Epair...');

// Desconectar quando não precisar mais
sdk.disconnectWebSocket();
```

---

## 🔧 Utilidades Disponíveis

```typescript
// Deadline para transações
const deadline = sdk.utils.calculateDeadline(20); // 20 minutos

// Formatar números grandes
sdk.utils.formatLargeNumber(1500000); // "1.50M"

// Comparar amounts
sdk.utils.compareAmounts('1000', '2000'); // -1 (menor)

// Verificar se é zero
sdk.utils.isZero('0'); // true

// Calcular porcentagem
sdk.utils.calculatePercentage('50', '200'); // "25.00"

// Converter decimais
const result = sdk.utils.convertDecimals('100000000', 6, 8);
if (result.success) {
    console.log(result.value); // "10000000000"
}

// Obter decimais conhecidos
sdk.utils.getTokenDecimals('LUNES'); // 8
sdk.utils.getTokenDecimals('USDT'); // 6
sdk.utils.getTokenDecimals('SOL'); // 9
```

---

## ⚠️ Tratamento de Erros

```typescript
try {
    const result = await sdk.router.swapExactTokensForTokens({ ... });
} catch (error) {
    if (error.code === 'PRECISION_LOSS') {
        alert('Muitas casas decimais para este token');
    } else if (error.code === 'INSUFFICIENT_BALANCE') {
        alert('Saldo insuficiente');
    } else if (error.code === 'SLIPPAGE_EXCEEDED') {
        alert('Slippage excedido, tente novamente');
    } else {
        console.error('Erro desconhecido:', error);
    }
}
```

---

## 📝 Tipos TypeScript

Todos os tipos são exportados:

```typescript
import {
    // Tokens
    Token,
    TokenWithDecimals,
    FormattedAmount,
    ParsedAmount,
    
    // Pools
    Pair,
    PoolWithDecimals,
    
    // Trading
    Quote,
    TradePreview,
    SwapValidation,
    
    // Staking
    StakePosition,
    StakingTier,
    
    // Decimais
    DecimalError,
    DecimalResult,
    NormalizedAmounts,
    
    // Config
    LunexConfig,
} from '@lunex/sdk';
```

---

## ✅ Checklist para Frontend

- [x] Sempre parsear input do usuário com `parseUserInput()`
- [x] Sempre formatar amounts para display com `formatAmount()`
- [x] Validar swaps com `validateSwapDecimals()`
- [x] Usar decimais corretos do token (não assumir 18)
- [x] Tratar erros de precisão graciosamente
- [x] Mostrar warnings ao usuário quando relevante
- [x] Usar `calculateDeadline()` para transações
- [x] Calcular slippage com `calculateMinAmount()`
