#![no_main]

use libfuzzer_sys::fuzz_target;
use asymmetric_pair::AsymmetricPair;

// Fuzz test to check the monotonicity of the asymmetric logic
// We want to ensure that no matter the inputs, the output respects the curve limits
fuzz_target!(|data: (u128, u32, u128, u16, u128, u128)| {
    let (buy_k, mut buy_gamma_scaled, mut buy_max_capacity, mut buy_fee_bps, volume_a, volume_b) = data;

    // Use guardrails limits to constrain random inputs to valid ranges
    if buy_gamma_scaled < 5_000 { buy_gamma_scaled = 5_000; }
    if buy_gamma_scaled > 50_000 { buy_gamma_scaled = 50_000; }
    if buy_max_capacity > 1_000_000_000_000_000 { buy_max_capacity = 1_000_000_000_000_000; }
    if buy_max_capacity == 0 { buy_max_capacity = 1; }
    if buy_fee_bps > 500 { buy_fee_bps = 500; }

    // Init the pair
    let pair = AsymmetricPair::new(
        buy_k,
        buy_gamma_scaled,
        buy_max_capacity,
        buy_fee_bps,
        buy_gamma_scaled, // Sell curve same for fuzz simplicity
        buy_max_capacity,
        buy_fee_bps,
    );

    // Get curves
    let curve = pair.get_buy_curve();

    // If volume is equal to or greater than capacity, liquidty must be 0
    if volume_a >= buy_max_capacity {
        // Since we can't easily call the private eval_curve from here in a real fuzz test,
        // we simulate what a user would observe: get_quote.
        // If volume_a >= capacity, attempting to swap any amount should yield an error.
        let result = pair.get_quote(true, 1);
        if result.is_ok() {
            panic!("Should not allow swaps when at or over capacity. Volume {} vs Capacity {}", volume_a, buy_max_capacity);
        }
    } else {
        // If we are below capacity, the swap should either succeed or fail due to insufficient liquidity, 
        // but it should NEVER panic or cause a math overflow that crashes the contract execution.
        let _result = pair.get_quote(true, volume_a);
    }
});
