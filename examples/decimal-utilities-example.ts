/**
 * 📐 Exemplo de Uso - Decimal Utilities
 * 
 * Este exemplo mostra como usar as funções de normalização de decimais
 * para operações seguras entre tokens com diferentes casas decimais.
 */

import {
    convertDecimals,
    convertDecimalsRounded,
    normalizeAmounts,
    formatAmountWithDecimals,
    parseAmountWithValidation,
    validateSwapDecimals,
    getTokenDecimals,
    COMMON_DECIMALS,
    DecimalError,
} from '@lunex/sdk';

// ============================================
// 1. OBTENDO DECIMAIS DE TOKENS CONHECIDOS
// ============================================

console.log('📊 1. Decimais de Tokens Comuns\n');

const lunesDecimals = getTokenDecimals('LUNES'); // 8
const usdtDecimals = getTokenDecimals('USDT');   // 6
const ethDecimals = getTokenDecimals('ETH');     // 18
const solDecimals = getTokenDecimals('SOL');     // 9

console.log(`LUNES: ${lunesDecimals} decimais`);
console.log(`USDT:  ${usdtDecimals} decimais`);
console.log(`ETH:   ${ethDecimals} decimais`);
console.log(`SOL:   ${solDecimals} decimais`);

// ============================================
// 2. CONVERTENDO ENTRE DECIMAIS
// ============================================

console.log('\n📊 2. Conversão entre Decimais\n');

// USDT (6 dec) -> LUNES (8 dec)
const usdtAmount = '100000000'; // 100 USDT
const result = convertDecimals(usdtAmount, 6, 8);

if (result.success) {
    console.log(`✅ 100 USDT (6 dec) = ${result.value} (8 dec)`);
} else {
    console.log(`❌ Erro: ${result.error}`);
}

// Conversão que perderia precisão
const lunesWithRemainder = '10000000001'; // 100.00000001 LUNES
const result2 = convertDecimals(lunesWithRemainder, 8, 6);

if (!result2.success) {
    console.log(`⚠️ Conversão bloqueada: ${result2.error}`);
    console.log('   Dígitos seriam perdidos na conversão 8 -> 6 decimais');
}

// ============================================
// 3. NORMALIZANDO PARES PARA AMM
// ============================================

console.log('\n📊 3. Normalização de Pares\n');

// Antes de calcular preço no AMM, normalizar ambos para o mesmo decimal
const normalized = normalizeAmounts(
    '10000000000',  // 100 LUNES (8 dec)
    8,
    '50000000',     // 50 USDT (6 dec)
    6
);

console.log(`Par LUNES/USDT normalizado para ${normalized.targetDecimals} decimais:`);
console.log(`   LUNES: ${normalized.amountA}`);
console.log(`   USDT:  ${normalized.amountB}`);

// ============================================
// 4. FORMATANDO PARA DISPLAY
// ============================================

console.log('\n📊 4. Formatação para Display\n');

const rawAmount = '12345678900'; // em 8 decimais
const formatted = formatAmountWithDecimals(rawAmount, 8);
const formattedShort = formatAmountWithDecimals(rawAmount, 8, 4);

console.log(`Raw: ${rawAmount}`);
console.log(`Formatado: ${formatted}`);        // "123.456789"
console.log(`Resumido:  ${formattedShort}`);   // "123.4567"

// ============================================
// 5. PARSEANDO INPUT DO USUÁRIO
// ============================================

console.log('\n📊 5. Parse de Input do Usuário\n');

const userInput = '123.456789';
const parsed = parseAmountWithValidation(userInput, 8);

if (parsed.success) {
    console.log(`✅ "${userInput}" -> ${parsed.value}`);
}

// Input com muitos decimais
const badInput = '123.1234567890'; // 10 casas
const badParsed = parseAmountWithValidation(badInput, 8);

if (!badParsed.success) {
    console.log(`⚠️ Input rejeitado: ${badParsed.error}`);
    console.log('   O token só suporta 8 casas decimais');
}

// ============================================
// 6. VALIDANDO SWAP
// ============================================

console.log('\n📊 6. Validação de Swap\n');

// Swap seguro
const swap1 = validateSwapDecimals(
    '10000000000',  // 100 LUNES
    '50000000',     // 50 USDT
    8,              // LUNES decimals
    6               // USDT decimals
);
console.log(`Swap LUNES->USDT: ${swap1.valid ? '✅ Válido' : '❌ Inválido'}`);

// Swap perigoso (output zero)
const swap2 = validateSwapDecimals(
    '10000000000',  // 100 LUNES
    '0',            // 0 output!
    8,
    6
);
console.log(`Swap com output 0: ${swap2.valid ? '✅ Válido' : '❌ Inválido'}`);
if (swap2.warnings.length > 0) {
    console.log(`   ⚠️ ${swap2.warnings[0]}`);
}

// Swap com grande diferença de decimais
const swap3 = validateSwapDecimals(
    '1000000000000000000',  // 1 ETH
    '100',                   // Token com 2 decimais
    18,
    2
);
if (swap3.warnings.length > 0) {
    console.log(`Swap ETH->LowDecToken:`);
    swap3.warnings.forEach(w => console.log(`   ⚠️ ${w}`));
}

// ============================================
// 7. EXEMPLO COMPLETO: SWAP SEGURO
// ============================================

console.log('\n📊 7. Fluxo Completo de Swap Seguro\n');

async function executeSecureSwap(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    userAmount: string
) {
    // 1. Obter decimais
    const decIn = getTokenDecimals(tokenInSymbol) || 8;
    const decOut = getTokenDecimals(tokenOutSymbol) || 8;

    console.log(`Swap ${tokenInSymbol} (${decIn} dec) -> ${tokenOutSymbol} (${decOut} dec)`);

    // 2. Parsear input do usuário
    const parsed = parseAmountWithValidation(userAmount, decIn);
    if (!parsed.success) {
        throw new Error(`Input inválido: ${parsed.error}`);
    }
    console.log(`   Input: ${userAmount} = ${parsed.value} wei`);

    // 3. Simular cálculo de output (mock)
    const amountOut = (BigInt(parsed.value) * BigInt(5) / BigInt(10)).toString();
    console.log(`   Output estimado: ${amountOut} wei`);

    // 4. Validar swap
    const validation = validateSwapDecimals(parsed.value, amountOut, decIn, decOut);
    if (!validation.valid) {
        throw new Error('Swap inválido!');
    }
    if (validation.warnings.length > 0) {
        console.log('   ⚠️ Warnings:');
        validation.warnings.forEach(w => console.log(`      - ${w}`));
    }

    // 5. Formatar para display
    const outFormatted = formatAmountWithDecimals(amountOut, decOut, 6);
    console.log(`   Você receberá: ~${outFormatted} ${tokenOutSymbol}`);

    return { success: true, amountOut, formatted: outFormatted };
}

// Executar exemplo
executeSecureSwap('LUNES', 'USDT', '100').then(result => {
    console.log('\n✅ Swap simulado com sucesso!');
});
