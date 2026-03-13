use std::collections::HashMap;

#[derive(Clone, Debug)]
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

        let amount_in_with_fee = amount_in.checked_mul(997)?;
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

#[derive(Clone, Debug)]
struct VaultModel {
    total_assets: u128,
    total_shares: u128,
    user_shares: HashMap<u8, u128>,
}

impl VaultModel {
    fn new() -> Self {
        Self {
            total_assets: 0,
            total_shares: 0,
            user_shares: HashMap::new(),
        }
    }

    fn deposit(&mut self, user: u8, amount: u128) -> bool {
        if amount == 0 {
            return false;
        }

        let minted = if self.total_assets == 0 || self.total_shares == 0 {
            amount
        } else {
            match amount
                .checked_mul(self.total_shares)
                .and_then(|value| value.checked_div(self.total_assets))
            {
                Some(0) | None => return false,
                Some(value) => value,
            }
        };

        let user_balance = *self.user_shares.get(&user).unwrap_or(&0);
        let new_user_balance = match user_balance.checked_add(minted) {
            Some(value) => value,
            None => return false,
        };

        self.total_assets = match self.total_assets.checked_add(amount) {
            Some(value) => value,
            None => return false,
        };

        self.total_shares = match self.total_shares.checked_add(minted) {
            Some(value) => value,
            None => return false,
        };

        self.user_shares.insert(user, new_user_balance);
        true
    }

    fn withdraw(&mut self, user: u8, shares: u128) -> bool {
        if shares == 0 || self.total_shares == 0 {
            return false;
        }

        let owned = *self.user_shares.get(&user).unwrap_or(&0);
        if shares > owned {
            return false;
        }

        let assets_out = if shares == self.total_shares {
            self.total_assets
        } else {
            match shares
                .checked_mul(self.total_assets)
                .and_then(|value| value.checked_div(self.total_shares))
            {
                Some(0) | None => return false,
                Some(value) => value,
            }
        };

        self.total_assets = match self.total_assets.checked_sub(assets_out) {
            Some(value) => value,
            None => return false,
        };

        self.total_shares = match self.total_shares.checked_sub(shares) {
            Some(value) => value,
            None => return false,
        };

        if shares == owned {
            self.user_shares.remove(&user);
        } else {
            self.user_shares.insert(user, owned - shares);
        }

        true
    }

    fn shares_of(&self, user: u8) -> u128 {
        *self.user_shares.get(&user).unwrap_or(&0)
    }

    fn sum_user_shares(&self) -> Option<u128> {
        self.user_shares
            .values()
            .try_fold(0u128, |acc, value| acc.checked_add(*value))
    }
}

#[derive(Clone, Debug)]
struct NonceModel {
    next_expected: HashMap<u8, u64>,
}

impl NonceModel {
    fn new() -> Self {
        Self {
            next_expected: HashMap::new(),
        }
    }

    fn use_nonce(&mut self, user: u8, nonce: u64) -> bool {
        let expected = self.next_expected.get(&user).copied().unwrap_or(1);
        if nonce != expected {
            return false;
        }

        self.next_expected.insert(user, expected + 1);
        true
    }
}

fn next_u64(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *state
}

#[test]
fn pair_swap_preserves_or_increases_invariant_across_many_inputs() {
    let mut seed = 7u64;

    for _ in 0..500 {
        let reserve_0 = 1_000u128 + (next_u64(&mut seed) as u128 % 1_000_000u128);
        let reserve_1 = 1_000u128 + (next_u64(&mut seed) as u128 % 1_000_000u128);
        let amount_1_in = 1u128 + (next_u64(&mut seed) as u128 % 100_000u128);

        let mut pair = PairModel::new(reserve_0, reserve_1);
        let k_before = pair.invariant().unwrap();
        let swap_result = pair.swap_token_1_for_token_0(amount_1_in);

        if swap_result.is_none() {
            continue;
        }

        let k_after = pair.invariant().unwrap();
        assert!(k_after >= k_before);
        assert!(pair.reserve_0 > 0);
        assert!(pair.reserve_1 >= reserve_1);
    }
}

#[test]
fn vault_sequence_preserves_assets_and_share_consistency() {
    let mut seed = 19u64;
    let mut vault = VaultModel::new();

    for _ in 0..1_000 {
        let is_deposit = next_u64(&mut seed) % 2 == 0;
        let user = ((next_u64(&mut seed) % 4) + 1) as u8;
        let amount = 1u128 + (next_u64(&mut seed) as u128 % 10_000u128);

        if is_deposit {
            let _ = vault.deposit(user, amount);
        } else {
            let max_withdrawable = vault.shares_of(user);
            let shares = amount.min(max_withdrawable);
            if shares > 0 {
                let _ = vault.withdraw(user, shares);
            }
        }

        let sum_user_shares = vault.sum_user_shares().unwrap();
        assert_eq!(sum_user_shares, vault.total_shares);

        if vault.total_shares == 0 {
            assert_eq!(vault.total_assets, 0);
        }
    }
}

#[test]
fn nonce_model_rejects_replay_and_out_of_order_values() {
    let mut seed = 31u64;
    let mut model = NonceModel::new();
    let mut accepted: HashMap<u8, Vec<u64>> = HashMap::new();

    for _ in 0..500 {
        let user = ((next_u64(&mut seed) % 4) + 1) as u8;
        let nonce = 1u64 + (next_u64(&mut seed) % 20);

        if model.use_nonce(user, nonce) {
            accepted.entry(user).or_default().push(nonce);
        }
    }

    for values in accepted.values() {
        for (idx, nonce) in values.iter().enumerate() {
            assert_eq!(*nonce, (idx as u64) + 1);
        }
    }
}
