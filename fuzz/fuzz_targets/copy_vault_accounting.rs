#![no_main]

use libfuzzer_sys::fuzz_target;
use std::collections::HashMap;

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

    fn deposit(&mut self, user: u8, amount: u128) {
        if amount == 0 {
            return;
        }

        let minted = if self.total_assets == 0 || self.total_shares == 0 {
            amount
        } else {
            match amount
                .checked_mul(self.total_shares)
                .and_then(|value| value.checked_div(self.total_assets))
            {
                Some(0) | None => return,
                Some(value) => value,
            }
        };

        let current_user_shares = *self.user_shares.get(&user).unwrap_or(&0);
        let next_user_shares = match current_user_shares.checked_add(minted) {
            Some(value) => value,
            None => return,
        };

        self.total_assets = match self.total_assets.checked_add(amount) {
            Some(value) => value,
            None => return,
        };
        self.total_shares = match self.total_shares.checked_add(minted) {
            Some(value) => value,
            None => return,
        };
        self.user_shares.insert(user, next_user_shares);
    }

    fn withdraw(&mut self, user: u8, shares: u128) {
        if shares == 0 || self.total_shares == 0 {
            return;
        }

        let owned = *self.user_shares.get(&user).unwrap_or(&0);
        if shares > owned {
            return;
        }

        let assets_out = if shares == self.total_shares {
            self.total_assets
        } else {
            match shares
                .checked_mul(self.total_assets)
                .and_then(|value| value.checked_div(self.total_shares))
            {
                Some(0) | None => return,
                Some(value) => value,
            }
        };

        self.total_assets = match self.total_assets.checked_sub(assets_out) {
            Some(value) => value,
            None => return,
        };
        self.total_shares = match self.total_shares.checked_sub(shares) {
            Some(value) => value,
            None => return,
        };

        if shares == owned {
            self.user_shares.remove(&user);
        } else {
            self.user_shares.insert(user, owned - shares);
        }
    }

    fn sum_user_shares(&self) -> Option<u128> {
        self.user_shares
            .values()
            .try_fold(0u128, |acc, value| acc.checked_add(*value))
    }

    fn shares_of(&self, user: u8) -> u128 {
        *self.user_shares.get(&user).unwrap_or(&0)
    }
}

fuzz_target!(|data: &[u8]| {
    let mut vault = VaultModel::new();

    for chunk in data.chunks(4) {
        if chunk.len() < 4 {
            continue;
        }

        let is_deposit = chunk[0] % 2 == 0;
        let user = (chunk[1] % 4) + 1;
        let amount = (((chunk[2] as u128) << 8) | chunk[3] as u128) + 1;

        if is_deposit {
            vault.deposit(user, amount);
        } else {
            let shares = amount.min(vault.shares_of(user));
            if shares > 0 {
                vault.withdraw(user, shares);
            }
        }

        let sum_user_shares = vault.sum_user_shares().unwrap();
        assert_eq!(sum_user_shares, vault.total_shares);

        if vault.total_shares == 0 {
            assert_eq!(vault.total_assets, 0);
        }
    }
});
