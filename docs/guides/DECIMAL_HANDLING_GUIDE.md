# 📐 Guia de Decimais - Lunex DEX

## 🎯 Visão Geral

Os tokens podem ter diferentes casas decimais. Este guia documenta como o Lunex DEX trata cada caso para evitar erros e perda de fundos.

## 📊 Decimais Comuns

| Token | Decimais | Base Unit | 1 Token Completo |
|-------|----------|-----------|------------------|
| **LUNES** | 8 | 1 | 100_000_000 |
| **BTC** | 8 | 1 satoshi | 100_000_000 |
| **USDT** | 6 | 1 micro | 1_000_000 |
| **USDC** | 6 | 1 micro | 1_000_000 |
| **ETH** | 18 | 1 wei | 1_000_000_000_000_000_000 |

## ⚠️ Riscos de Decimal Mismatch

### 1. Perda de Precisão
```
❌ PROBLEMA:
   Converter 1.00000001 ETH (18 dec) → USDT (6 dec)
   Os dígitos 0.00000001 serão PERDIDOS!
   
✅ SOLUÇÃO:
   O sistema REJEITA conversões com perda de precisão
   Erro: DecimalError::PrecisionLoss
```

### 2. Overflow
```
❌ PROBLEMA:
   Converter amount muito grande com muitos decimais
   u128 pode estourar em multiplicações
   
✅ SOLUÇÃO:
   Validação de overflow em TODAS as operações
   Erro: DecimalError::Overflow
```

### 3. Display Incorreto
```
❌ PROBLEMA:
   Mostrar 100_000000 USDT como "100000000"
   
✅ SOLUÇÃO:
   Função format_amount() correta:
   format_amount(100_000000, 6) → "100.000000"
```

## 🔧 Funções de Conversão

### `convert_decimals(amount, from, to)`
Conversão ESTRITA - falha se houver perda de precisão.
```rust
// ✅ OK: aumentar decimais
convert_decimals(100_000000, 6, 8) → Ok(10_000_000_000)

// ✅ OK: diminuir sem perda
convert_decimals(10_000_000_000, 8, 6) → Ok(100_000000)

// ❌ ERRO: diminuir com perda
convert_decimals(10_000_000_001, 8, 6) → Err(PrecisionLoss)
```

### `convert_decimals_rounded(amount, from, to, round_up)`
Permite arredondamento - APENAS para display, nunca para transferências.
```rust
// Arredonda para cima
convert_decimals_rounded(10_000_000_001, 8, 6, true) → Ok(100_000001)

// Arredonda para baixo
convert_decimals_rounded(10_000_000_099, 8, 6, false) → Ok(100_000000)
```

### `normalize_amounts(a, dec_a, b, dec_b)`
Normaliza dois amounts para o mesmo decimal (usa o maior).
```rust
normalize_amounts(
    100_00000000, 8,  // 100 LUNES
    50_000000, 6      // 50 USDT
) → (
    100_00000000,     // 100 LUNES (mantém)
    50_00000000,      // 50 USDT (ajustado para 8 dec)
    8                 // target decimals
)
```

## 🔄 Pares de Trading

### LUNES (8) / USDT (6)
```
Pool: 1000 LUNES / 5000 USDT
Normalizado: 1000_00000000 / 5000_00000000 (ambos 8 dec)
Preço: 1 LUNES = 5 USDT
```

### ETH (18) / USDT (6)
```
Pool: 1 ETH / 3000 USDT
Normalizado: 1_000000000000000000 / 3000_000000000000000000 (ambos 18 dec)
Preço: 1 ETH = 3000 USDT
```

### BTC (8) / LUNES (8)
```
Pool: 1 BTC / 50000 LUNES
Normalizado: 1_00000000 / 50000_00000000 (ambos 8 dec)
Preço: 1 BTC = 50000 LUNES
✅ Nenhuma conversão necessária (mesmos decimais)
```

## 🛡️ Validações de Segurança

### Antes de Listar Token
1. ✅ Verificar decimals do contrato
2. ✅ Validar que decimals está entre 0-18
3. ✅ Registrar decimals no registry

### Antes de Criar Par
1. ✅ Ambos tokens têm decimals válidos
2. ✅ Diferença de decimals é suportada (≤ 18)
3. ✅ Calcular normalization factor

### Antes de Swap
1. ✅ Normalizar amounts de input
2. ✅ Calcular output com precisão máxima
3. ✅ Validar que output não é 0 para input > 0
4. ✅ Desnormalizar para decimals do token de saída

### Antes de Add Liquidity
1. ✅ Normalizar ambos amounts
2. ✅ Calcular LP tokens com precisão
3. ✅ Validar proporção do pool

## 📋 Checklist de Implementação

- [x] `convert_decimals()` - conversão estrita
- [x] `convert_decimals_rounded()` - para display
- [x] `normalize_amounts()` - normalização de pares
- [x] `calculate_price()` - preço respeitando decimais
- [x] `format_amount()` - display humano
- [x] `parse_amount()` - input do usuário
- [x] `SwapValidator` - validação de swaps
- [x] Testes para todos os cenários

## 🧪 Casos de Teste Cobertos

| Teste | Status |
|-------|--------|
| Aumentar decimais | ✅ |
| Diminuir sem perda | ✅ |
| Diminuir com perda (erro) | ✅ |
| Arredondamento para cima | ✅ |
| Arredondamento para baixo | ✅ |
| Normalização de pares | ✅ |
| Cálculo de preço | ✅ |
| Formatação para display | ✅ |
| Parse de input | ✅ |
| Validação de swap | ✅ |
| Diferenças extremas (18 → 2) | ✅ |

## 📌 Boas Práticas

1. **SEMPRE validate decimals** ao listar novo token
2. **NUNCA use arredondamento** em transferências reais
3. **NORMALIZE antes** de cálculos de pool
4. **DESNORMALIZE depois** para o token correto
5. **REJEITE** operações com perda de precisão
6. **DOCUMENTE** os decimais de cada token listado
