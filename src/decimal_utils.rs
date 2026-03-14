//! # Módulo de Normalização de Decimais
//!
//! Gerencia conversões seguras entre tokens com diferentes casas decimais.
//! 
//! ## Casos Comuns:
//! - LUNES: 8 decimais
//! - USDT: 6 decimais  
//! - ETH: 18 decimais
//! - BTC: 8 decimais
//!
//! ## Problemas que Resolvemos:
//! 1. Perda de precisão em swaps
//! 2. Overflow em multiplicações
//! 3. Underflow em divisões
//! 4. Display incorreto para UI

use std::cmp::Ordering;

/// Representa um token com seus metadados de decimais
#[derive(Debug, Clone)]
pub struct TokenInfo {
    pub symbol: String,
    pub decimals: u8,
    pub address: String,
}

/// Erro de operação com decimais
#[derive(Debug, PartialEq)]
pub enum DecimalError {
    Overflow,
    Underflow,
    PrecisionLoss,
    InvalidDecimals,
    DivisionByZero,
}

/// Converte um amount de um decimal para outro
/// 
/// # Exemplo
/// ```
/// // 100 USDT (6 decimais) -> representação com 8 decimais
/// // 100_000000 -> 10_000_000_000
/// use lunex_sim_tests::decimal_utils::convert_decimals;
/// let result = convert_decimals(100_000000, 6, 8);
/// assert_eq!(result, Ok(10_000_000_000));
/// ```
pub fn convert_decimals(amount: u128, from_decimals: u8, to_decimals: u8) -> Result<u128, DecimalError> {
    match from_decimals.cmp(&to_decimals) {
        Ordering::Less => {
            // Aumentando decimais: multiplicar
            let diff = to_decimals - from_decimals;
            let multiplier = 10u128.checked_pow(diff as u32)
                .ok_or(DecimalError::Overflow)?;
            amount.checked_mul(multiplier)
                .ok_or(DecimalError::Overflow)
        }
        Ordering::Greater => {
            // Diminuindo decimais: dividir (pode perder precisão!)
            let diff = from_decimals - to_decimals;
            let divisor = 10u128.checked_pow(diff as u32)
                .ok_or(DecimalError::Overflow)?;
            
            // Verificar se há perda de precisão
            let remainder = amount % divisor;
            if remainder != 0 {
                // Retorna erro para operações críticas, ou pode arredondar
                // Para swaps, é melhor falhar do que perder fundos
                return Err(DecimalError::PrecisionLoss);
            }
            
            Ok(amount / divisor)
        }
        Ordering::Equal => Ok(amount),
    }
}

/// Converte amount permitindo arredondamento (para exibição, não para transferências)
pub fn convert_decimals_rounded(amount: u128, from_decimals: u8, to_decimals: u8, round_up: bool) -> Result<u128, DecimalError> {
    match from_decimals.cmp(&to_decimals) {
        Ordering::Less => {
            let diff = to_decimals - from_decimals;
            let multiplier = 10u128.checked_pow(diff as u32)
                .ok_or(DecimalError::Overflow)?;
            amount.checked_mul(multiplier)
                .ok_or(DecimalError::Overflow)
        }
        Ordering::Greater => {
            let diff = from_decimals - to_decimals;
            let divisor = 10u128.checked_pow(diff as u32)
                .ok_or(DecimalError::Overflow)?;
            
            let base = amount / divisor;
            let remainder = amount % divisor;
            
            if round_up && remainder > 0 {
                base.checked_add(1).ok_or(DecimalError::Overflow)
            } else {
                Ok(base)
            }
        }
        Ordering::Equal => Ok(amount),
    }
}

/// Normaliza dois amounts para o mesmo número de decimais (usa o maior)
pub fn normalize_amounts(
    amount_a: u128, 
    decimals_a: u8,
    amount_b: u128,
    decimals_b: u8,
) -> Result<(u128, u128, u8), DecimalError> {
    let target_decimals = decimals_a.max(decimals_b);
    
    let normalized_a = convert_decimals(amount_a, decimals_a, target_decimals)?;
    let normalized_b = convert_decimals(amount_b, decimals_b, target_decimals)?;
    
    Ok((normalized_a, normalized_b, target_decimals))
}

/// Calcula o preço de um token em termos do outro, respeitando decimais
pub fn calculate_price(
    reserve_a: u128,
    decimals_a: u8,
    reserve_b: u128,
    decimals_b: u8,
    precision: u8, // Decimais de precisão para o resultado
) -> Result<u128, DecimalError> {
    if reserve_a == 0 {
        return Err(DecimalError::DivisionByZero);
    }
    
    // Preço = reserve_b / reserve_a
    // Para manter precisão, multiplicamos reserve_b por 10^precision primeiro
    let precision_multiplier = 10u128.checked_pow(precision as u32)
        .ok_or(DecimalError::Overflow)?;
    
    // Ajustar para diferença de decimais
    let decimal_adjustment = if decimals_a >= decimals_b {
        let diff = decimals_a - decimals_b;
        10u128.checked_pow(diff as u32).ok_or(DecimalError::Overflow)?
    } else {
        1 // Será tratado na divisão
    };
    
    let numerator = reserve_b
        .checked_mul(precision_multiplier)
        .ok_or(DecimalError::Overflow)?
        .checked_mul(decimal_adjustment)
        .ok_or(DecimalError::Overflow)?;
    
    if decimals_b > decimals_a {
        let diff = decimals_b - decimals_a;
        let divisor = reserve_a
            .checked_mul(10u128.pow(diff as u32))
            .ok_or(DecimalError::Overflow)?;
        Ok(numerator / divisor)
    } else {
        Ok(numerator / reserve_a)
    }
}

/// Formata um amount para exibição humana
pub fn format_amount(amount: u128, decimals: u8) -> String {
    if decimals == 0 {
        return amount.to_string();
    }
    
    let divisor = 10u128.pow(decimals as u32);
    let integer_part = amount / divisor;
    let decimal_part = amount % divisor;
    
    format!("{}.{:0>width$}", integer_part, decimal_part, width = decimals as usize)
}

/// Parseia um string decimal para amount interno
pub fn parse_amount(input: &str, decimals: u8) -> Result<u128, DecimalError> {
    let parts: Vec<&str> = input.split('.').collect();
    
    match parts.len() {
        1 => {
            // Apenas parte inteira
            let integer: u128 = parts[0].parse().map_err(|_| DecimalError::InvalidDecimals)?;
            let multiplier = 10u128.checked_pow(decimals as u32)
                .ok_or(DecimalError::Overflow)?;
            integer.checked_mul(multiplier)
                .ok_or(DecimalError::Overflow)
        }
        2 => {
            let integer: u128 = parts[0].parse().map_err(|_| DecimalError::InvalidDecimals)?;
            
            // Tratar parte decimal
            let decimal_str = parts[1];
            let decimal_len = decimal_str.len();
            
            if decimal_len > decimals as usize {
                return Err(DecimalError::PrecisionLoss);
            }
            
            let decimal: u128 = decimal_str.parse().map_err(|_| DecimalError::InvalidDecimals)?;
            
            // Ajustar para o número correto de decimais
            let padding = decimals as usize - decimal_len;
            let decimal_adjusted = decimal * 10u128.pow(padding as u32);
            
            let integer_part = integer
                .checked_mul(10u128.pow(decimals as u32))
                .ok_or(DecimalError::Overflow)?;
            
            integer_part.checked_add(decimal_adjusted)
                .ok_or(DecimalError::Overflow)
        }
        _ => Err(DecimalError::InvalidDecimals),
    }
}

/// Validador de swap considerando decimais
pub struct SwapValidator {
    pub token_a_decimals: u8,
    pub token_b_decimals: u8,
    pub min_output_decimals: u8,
}

impl SwapValidator {
    pub fn new(token_a_decimals: u8, token_b_decimals: u8) -> Self {
        Self {
            token_a_decimals,
            token_b_decimals,
            min_output_decimals: 6, // Mínimo aceitável para não perder fundos
        }
    }
    
    /// Valida se o swap é seguro considerando decimais
    pub fn validate_swap(
        &self,
        amount_in: u128,
        amount_out: u128,
        is_a_to_b: bool,
    ) -> Result<(), DecimalError> {
        let (in_decimals, out_decimals) = if is_a_to_b {
            (self.token_a_decimals, self.token_b_decimals)
        } else {
            (self.token_b_decimals, self.token_a_decimals)
        };
        
        // Verificar se output tem precisão suficiente
        if out_decimals < self.min_output_decimals {
            // Para tokens com poucos decimais, verificar se não há perda significativa
            let min_detectable = 10u128.pow((self.min_output_decimals - out_decimals) as u32);
            if amount_out < min_detectable && amount_in > 0 {
                return Err(DecimalError::PrecisionLoss);
            }
        }
        
        // Verificar se amounts estão no range válido
        if amount_in > u128::MAX / 10u128.pow(18) {
            return Err(DecimalError::Overflow);
        }
        
        Ok(())
    }
}

// ============================================
// TESTES
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_decimals_increase() {
        // USDT (6) -> LUNES (8): 100 USDT = 100_000000 -> 10_000_000_000
        let result = convert_decimals(100_000000, 6, 8);
        assert_eq!(result, Ok(10_000_000_000));
        
        // ETH (18) -> LUNES (8): perde precisão apenas se há dígitos nas casas perdidas
        // 1 ETH inteiro: 1_000000000000000000 -> 100_000_000 (sem perda se zeros nas casas)
        let result = convert_decimals(1_000000000000000000, 18, 8);
        assert_eq!(result, Ok(100_000_000)); // 1 ETH com 8 decimais
        
        // Com dígitos nas casas que serão perdidas -> erro
        let result = convert_decimals(1_000000000000000001, 18, 8);
        assert_eq!(result, Err(DecimalError::PrecisionLoss));
    }

    #[test]
    fn test_convert_decimals_decrease() {
        // LUNES (8) -> USDT (6): 100 LUNES = 10_000_000_000 -> 100_000000
        let result = convert_decimals(10_000_000_000, 8, 6);
        assert_eq!(result, Ok(100_000000));
        
        // Com resto (perda de precisão)
        let result = convert_decimals(10_000_000_001, 8, 6);
        assert_eq!(result, Err(DecimalError::PrecisionLoss));
    }

    #[test]
    fn test_convert_decimals_rounded() {
        // Com arredondamento para cima
        let result = convert_decimals_rounded(10_000_000_001, 8, 6, true);
        assert_eq!(result, Ok(100_000001)); // Arredonda para cima
        
        // Com arredondamento para baixo
        let result = convert_decimals_rounded(10_000_000_099, 8, 6, false);
        assert_eq!(result, Ok(100_000000)); // Arredonda para baixo
    }

    #[test]
    fn test_normalize_amounts() {
        // LUNES (8 dec) + USDT (6 dec) -> ambos em 8 decimais
        let result = normalize_amounts(
            100_00000000,  // 100 LUNES
            8,
            50_000000,     // 50 USDT
            6,
        );
        
        let (norm_a, norm_b, target_dec) = result.unwrap();
        assert_eq!(target_dec, 8);
        assert_eq!(norm_a, 100_00000000);
        assert_eq!(norm_b, 50_00000000); // 50 USDT em 8 decimais
    }

    #[test]
    fn test_format_amount() {
        assert_eq!(format_amount(123_45678900, 8), "123.45678900");
        assert_eq!(format_amount(1_000000, 6), "1.000000");
        assert_eq!(format_amount(5, 8), "0.00000005");
    }

    #[test]
    fn test_parse_amount() {
        assert_eq!(parse_amount("123.456789", 8), Ok(123_45678900));
        assert_eq!(parse_amount("1", 6), Ok(1_000000));
        assert_eq!(parse_amount("0.00000005", 8), Ok(5));
        
        // Erro: muitos decimais
        assert_eq!(parse_amount("1.1234567890", 8), Err(DecimalError::PrecisionLoss));
    }

    #[test]
    fn test_calculate_price() {
        // Pool: 1000 LUNES (8 dec) / 5000 USDT (6 dec)
        // Preço: 1 LUNES = 5 USDT
        let price = calculate_price(
            1000_00000000,  // 1000 LUNES
            8,
            5000_000000,    // 5000 USDT
            6,
            8,              // 8 decimais de precisão
        ).unwrap();
        
        // Preço deve ser ~5.0 (representado como 5_00000000)
        // Com ajuste de decimais: 5 * 10^8 = 500_000_000
        assert!(price >= 400_000_000 && price <= 600_000_000, "Preço: {}", price);
    }

    #[test]
    fn test_swap_validator() {
        // Validador para tokens com 8 e 6 decimais
        let validator = SwapValidator::new(8, 6);
        
        // Swap válido: amounts razoáveis
        assert!(validator.validate_swap(1000_00000000, 5000_000000, true).is_ok());
        
        // Swap com output zero é perigoso se token B tem menos decimais que min_output (6)
        // Como B tem 6 decimais = min_output_decimals, não vai entrar na condição
        // Precisamos testar com um token de poucos decimais
        let validator_low = SwapValidator::new(8, 2); // token B com só 2 decimais
        // output < min_detectable (10^4 = 10000) e input > 0 -> erro
        assert!(validator_low.validate_swap(1000, 0, true).is_err());
    }

    #[test]
    fn test_extreme_decimal_differences() {
        // ETH (18 dec) para token com 2 decimais (muito extremo)
        // 1 ETH = 1_000000000000000000 -> conversão para 2 dec = 100
        // Mas há 16 zeros que serão perdidos, só funciona se são zeros
        let result = convert_decimals(1_000000000000000000, 18, 2);
        assert_eq!(result, Ok(100)); // 1.00 em 2 decimais
        
        // Com dígitos significativos nas casas perdidas -> erro
        let result = convert_decimals(1_000000000000000001, 18, 2);
        assert_eq!(result, Err(DecimalError::PrecisionLoss));
        
        // Token com 2 dec para ETH (18 dec)
        let result = convert_decimals(100, 2, 18);
        assert_eq!(result, Ok(1_000000000000000000));
    }

    #[test]
    fn test_common_token_pairs() {
        println!("\n🔢 TESTE DE PARES COMUNS COM DIFERENTES DECIMAIS\n");
        
        // LUNES (8) / USDT (6)
        println!("📊 Par: LUNES (8 dec) / USDT (6 dec)");
        let (norm_lunes, norm_usdt, _) = normalize_amounts(
            100_00000000,  // 100 LUNES
            8,
            500_000000,    // 500 USDT  
            6,
        ).unwrap();
        println!("   100 LUNES normalizado: {}", norm_lunes);
        println!("   500 USDT normalizado: {}", norm_usdt);
        assert_eq!(norm_lunes, 100_00000000);  // Mantém
        assert_eq!(norm_usdt, 500_00000000);   // Ajustado para 8 dec
        
        // ETH (18) / USDT (6)
        println!("\n📊 Par: ETH (18 dec) / USDT (6 dec)");
        let (norm_eth, norm_usdt, target) = normalize_amounts(
            1_000000000000000000,  // 1 ETH
            18,
            3000_000000,           // 3000 USDT
            6,
        ).unwrap();
        println!("   1 ETH normalizado: {}", norm_eth);
        println!("   3000 USDT normalizado: {}", norm_usdt);
        println!("   Target decimals: {}", target);
        assert_eq!(target, 18);
        
        // BTC (8) / LUNES (8) - mesmo decimais
        println!("\n📊 Par: BTC (8 dec) / LUNES (8 dec) - iguais");
        let (btc, lunes, target) = normalize_amounts(
            1_00000000,      // 1 BTC
            8,
            50000_00000000,  // 50000 LUNES
            8,
        ).unwrap();
        assert_eq!(target, 8);
        assert_eq!(btc, 1_00000000);
        assert_eq!(lunes, 50000_00000000);
        println!("   ✅ Nenhuma conversão necessária");
        
        println!("\n✅ Todos os pares comuns validados!\n");
    }
}

    #[test]
    fn test_all_decimal_ranges() {
        println!("\n🔢 TESTE: TODOS OS RANGES DE DECIMAIS (0-18)\n");
        
        // Testar TODOS os decimais de 0 a 18
        for decimals in 0u8..=18 {
            let amount = 10u128.pow(decimals as u32); // 1 token inteiro
            let formatted = format_amount(amount, decimals);
            let parsed = parse_amount("1", decimals).unwrap();
            
            assert_eq!(parsed, amount, "Falha no parse para {} decimais", decimals);
            println!("   ✅ {} decimais: amount={}, formatted={}", decimals, amount, formatted);
        }
        
        println!("\n✅ Todos os ranges 0-18 funcionam!\n");
    }

    #[test]
    fn test_9_decimals_specifically() {
        println!("\n🔢 TESTE ESPECÍFICO: 9 DECIMAIS\n");
        
        // Alguns tokens usam 9 decimais (ex: alguns tokens Solana)
        let decimals_9 = 9u8;
        
        // 1 TOKEN com 9 decimais = 1_000_000_000
        let one_token = 1_000_000_000u128;
        
        // Format
        let formatted = format_amount(one_token, decimals_9);
        assert_eq!(formatted, "1.000000000");
        println!("   ✅ Format: {} → {}", one_token, formatted);
        
        // Parse - 9 decimais aceita até 9 casas após o ponto
        let parsed = parse_amount("123.4567890123", 9); // 10 casas decimais
        assert_eq!(parsed, Err(DecimalError::PrecisionLoss)); // 10 casas > 9
        println!("   ✅ Parse com 10 casas: ERRO esperado");
        
        let parsed = parse_amount("123.456789012", 9).unwrap(); // 9 casas OK
        assert_eq!(parsed, 123_456789012);
        println!("   ✅ Parse: 123.456789012 → {}", parsed);
        
        // Conversão 9 → 8 (perda de 1 casa)
        let result = convert_decimals(1_000000000, 9, 8);
        assert_eq!(result, Ok(100_000_000)); // OK se último dígito é 0
        println!("   ✅ Conversão 9→8: 1_000000000 → 100_000_000");
        
        let result = convert_decimals(1_000000001, 9, 8);
        assert_eq!(result, Err(DecimalError::PrecisionLoss));
        println!("   ✅ Conversão 9→8 com perda: ERRO esperado");
        
        // Conversão 8 → 9
        let result = convert_decimals(100_000_000, 8, 9);
        assert_eq!(result, Ok(1_000_000_000));
        println!("   ✅ Conversão 8→9: 100_000_000 → 1_000_000_000");
        
        // Normalização: LUNES (8) / TOKEN9 (9)
        let (norm_lunes, norm_token9, target) = normalize_amounts(
            100_00000000,    // 100 LUNES (8 dec)
            8,
            50_000000000,    // 50 TOKEN9 (9 dec)  
            9,
        ).unwrap();
        
        assert_eq!(target, 9);
        assert_eq!(norm_lunes, 100_000000000); // 100 LUNES em 9 dec
        assert_eq!(norm_token9, 50_000000000);  // 50 TOKEN9 (mantém)
        println!("   ✅ Normalização LUNES(8)/TOKEN9(9): target={}", target);
        
        println!("\n✅ Tokens com 9 decimais TOTALMENTE SUPORTADOS!\n");
    }

    #[test]
    fn test_odd_decimal_pairs() {
        println!("\n🔢 TESTE: PARES COM DECIMAIS ÍMPARES\n");
        
        // Cenários menos comuns mas possíveis
        let test_cases = vec![
            (7, 9, "7 vs 9"),
            (5, 11, "5 vs 11"),
            (3, 15, "3 vs 15"),
            (1, 17, "1 vs 17"),
            (9, 9, "9 vs 9 (iguais)"),
            (0, 18, "0 vs 18 (extremos)"),
        ];
        
        for (dec_a, dec_b, label) in test_cases {
            let amount_a = 100 * 10u128.pow(dec_a as u32);
            let amount_b = 200 * 10u128.pow(dec_b as u32);
            
            let result = normalize_amounts(amount_a, dec_a, amount_b, dec_b);
            assert!(result.is_ok(), "Falha em {}", label);
            
            let (norm_a, norm_b, target) = result.unwrap();
            assert_eq!(target, dec_a.max(dec_b));
            
            println!("   ✅ {}: target={} dec", label, target);
        }
        
        println!("\n✅ Todos os pares ímpares funcionam!\n");
    }
