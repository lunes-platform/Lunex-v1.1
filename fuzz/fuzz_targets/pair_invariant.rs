#![no_main]

use libfuzzer_sys::fuzz_target;

#[derive(Clone, Copy, Debug)]
struct PairModel {
    reserve_0: u128,
    reserve_1: u128,
}

impl PairModel {
    fn new(reserve_0: u128, reserve_1: u128) -> Self {
        Self { reserve_0, reserve_1 }
    }

    fn get_amount_out(amount_in: u128, reserve_in: u128, reserve_out: u128) -> Option<u128> {
        if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
            return None;
        }

        let amount_in_with_fee = amount_in.checked_mul(995)?;
        let numerator = amount_in_with_fee.checked_mul(reserve_out)?;
        let denominator = reserve_in.checked_mul(1000)?.checked_add(amount_in_with_fee)?;
        let amount_out = numerator.checked_div(denominator)?;

        if amount_out == 0 {
            return None;
        }

        Some(amount_out)
    }

    fn swap_token_1_for_token_0(&mut self, amount_1_in: u128) -> Option<u128> {
        let amount_0_out = Self::get_amount_out(amount_1_in, self.reserve_1, self.reserve_0)?;
        if amount_0_out >= self.reserve_0 {
            return None;
        }

        self.reserve_0 = self.reserve_0.checked_sub(amount_0_out)?;
        self.reserve_1 = self.reserve_1.checked_add(amount_1_in)?;

        Some(amount_0_out)
    }

    fn invariant(&self) -> Option<u128> {
        self.reserve_0.checked_mul(self.reserve_1)
    }
}

fuzz_target!(|data: (u128, u128, u128)| {
    let reserve_0 = 1_000u128 + (data.0 % 1_000_000_000u128);
    let reserve_1 = 1_000u128 + (data.1 % 1_000_000_000u128);
    let amount_1_in = 1u128 + (data.2 % 10_000_000u128);

    let mut pair = PairModel::new(reserve_0, reserve_1);
    let k_before = pair.invariant().unwrap();

    if pair.swap_token_1_for_token_0(amount_1_in).is_some() {
        let k_after = pair.invariant().unwrap();
        assert!(k_after >= k_before);
        assert!(pair.reserve_0 > 0);
        assert!(pair.reserve_1 >= reserve_1);
    }
});
