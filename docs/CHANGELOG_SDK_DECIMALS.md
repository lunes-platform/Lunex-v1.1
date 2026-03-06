 # 📋 Changelog: Atualização SDK e API - Suporte a Decimais

**Data:** 2025-12-05  
**Versão SDK:** 1.1.0  
**Versão API:** 2.1.0

---

## 🎯 Objetivo

Adicionar suporte completo para tokens com diferentes casas decimais (0-18), garantindo operações seguras e prevenindo perda de fundos.

---

## 📦 Arquivos Modificados

### SDK (`/sdk/src/`)

| Arquivo | Mudança |
|---------|---------|
| `utils.ts` | +280 linhas - Funções de normalização de decimais |
| `index.ts` | Já exporta `utils` automaticamente |

### API Documentation (`/docs/`)

| Arquivo | Mudança |
|---------|---------|
| `PUBLIC_API_SPECIFICATION.md` | +236 linhas - Nova seção Decimal Utilities API |

### Smart Contracts (`/src/`)

| Arquivo | Mudança |
|---------|---------|
| `decimal_utils.rs` | +538 linhas - Módulo Rust de decimais |

### Documentation (`/docs/guides/`)

| Arquivo | Mudança |
|---------|---------|
| `DECIMAL_HANDLING_GUIDE.md` | Novo - Guia completo de decimais |

### Examples (`/examples/`)

| Arquivo | Mudança |
|---------|---------|
| `decimal-utilities-example.ts` | Novo - Exemplo de uso |

---

## 🔧 Novas Funções no SDK

### Conversão
```typescript
convertDecimals(amount, fromDec, toDec) → DecimalResult<string>
convertDecimalsRounded(amount, fromDec, toDec, roundUp) → string
```

### Normalização
```typescript
normalizeAmounts(amountA, decA, amountB, decB) → { amountA, amountB, targetDecimals }
```

### Formatação
```typescript
formatAmountWithDecimals(amount, decimals, maxDisplay?) → string
parseAmountWithValidation(input, decimals) → DecimalResult<string>
```

### Validação
```typescript
validateSwapDecimals(amountIn, amountOut, decIn, decOut) → { valid, warnings }
```

### Lookup
```typescript
getTokenDecimals(symbol) → number | undefined
COMMON_DECIMALS: Record<string, number>
```

---

## 🌐 Novos Endpoints da API

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/v2/public/token/:address/decimals` | GET | Obter decimais do token |
| `/v2/utils/convert-decimals` | POST | Converter entre decimais |
| `/v2/utils/normalize-amounts` | POST | Normalizar par de tokens |
| `/v2/utils/validate-swap` | POST | Validar swap |
| `/v2/utils/format-amount` | GET | Formatar para display |
| `/v2/utils/parse-amount` | POST | Parse de input |

---

## 📊 Tokens Suportados

| Decimais | Tokens | Status |
|----------|--------|--------|
| 0 | NFTs | ✅ |
| 2 | Legacy stablecoins | ✅ |
| 6 | USDT, USDC | ✅ |
| 8 | LUNES, BTC | ✅ |
| 9 | SOL, WSOL | ✅ |
| 18 | ETH, DAI | ✅ |
| 0-18 | Qualquer | ✅ |

---

## 🛡️ Proteções Implementadas

| Risco | Proteção |
|-------|----------|
| Perda de Precisão | `PRECISION_LOSS` error |
| Overflow | `checked_mul/add` + error |
| Display Errado | `formatAmountWithDecimals()` |
| Swap Perigoso | `validateSwapDecimals()` |
| Input Inválido | `parseAmountWithValidation()` |

---

## ✅ Testes

| Suite | Testes | Status |
|-------|--------|--------|
| decimal_utils.rs | 13/13 | ✅ |
| SDK utils (lint) | Pass | ✅ |

---

## 📝 Exemplo de Uso

```typescript
import { LunexSDK } from '@lunex/sdk';

const sdk = new LunexSDK({ baseURL: 'https://api.lunex.io/v2' });

// Obter decimais
const lunesDec = sdk.utils.getTokenDecimals('LUNES'); // 8
const usdtDec = sdk.utils.getTokenDecimals('USDT');   // 6

// Parsear input do usuário
const parsed = sdk.utils.parseAmountWithValidation('100.5', lunesDec);
if (!parsed.success) throw new Error(parsed.error);

// Normalizar para cálculo
const normalized = sdk.utils.normalizeAmounts(
    parsed.value, lunesDec,
    '500000000', usdtDec
);

// Validar swap
const validation = sdk.utils.validateSwapDecimals(
    parsed.value, '500000000',
    lunesDec, usdtDec
);

if (!validation.valid) {
    throw new Error('Swap inválido');
}

// Formatar para display
const display = sdk.utils.formatAmountWithDecimals('500000000', usdtDec, 2);
console.log(`Você receberá: ${display} USDT`); // "500 USDT"
```

---

## 🔄 Migração

Nenhuma breaking change. Novas funções são adicionais.

Para usar as novas funções:
```typescript
// Antes (funciona ainda)
sdk.utils.formatAmount(amount, decimals);

// Novo (mais seguro)
sdk.utils.formatAmountWithDecimals(amount, decimals, maxDisplay);
sdk.utils.parseAmountWithValidation(input, decimals);
```
