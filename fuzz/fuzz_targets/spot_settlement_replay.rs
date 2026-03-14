#![no_main]

use libfuzzer_sys::fuzz_target;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Order {
    maker: u8,
    base_token: u8,
    quote_token: u8,
    side: Side,
    price: u128,
    amount: u128,
    filled_amount: u128,
    nonce: u64,
    expiry: u64,
}

#[derive(Default)]
struct SettlementModel {
    balances: HashMap<(u8, u8), u128>,
    used_nonces: HashSet<(u8, u64)>,
    cancelled_nonces: HashSet<(u8, u64)>,
    now: u64,
}

impl SettlementModel {
    fn settle_trade(
        &mut self,
        maker_order: Order,
        taker_order: Order,
        fill_amount: u128,
        fill_price: u128,
    ) -> bool {
        if fill_amount == 0 {
            return false;
        }

        if maker_order.maker == taker_order.maker {
            return false;
        }

        if maker_order.base_token != taker_order.base_token || maker_order.quote_token != taker_order.quote_token {
            return false;
        }

        if maker_order.side == taker_order.side {
            return false;
        }

        match maker_order.side {
            Side::Sell => {
                if fill_price < maker_order.price {
                    return false;
                }
            }
            Side::Buy => {
                if fill_price < taker_order.price {
                    return false;
                }
            }
        }

        if self.used_nonces.contains(&(maker_order.maker, maker_order.nonce)) {
            return false;
        }
        if self.used_nonces.contains(&(taker_order.maker, taker_order.nonce)) {
            return false;
        }
        if self.cancelled_nonces.contains(&(maker_order.maker, maker_order.nonce)) {
            return false;
        }
        if self.cancelled_nonces.contains(&(taker_order.maker, taker_order.nonce)) {
            return false;
        }

        if maker_order.expiry > 0 && self.now > maker_order.expiry {
            return false;
        }
        if taker_order.expiry > 0 && self.now > taker_order.expiry {
            return false;
        }

        let maker_remaining = match maker_order.amount.checked_sub(maker_order.filled_amount) {
            Some(value) => value,
            None => return false,
        };
        let taker_remaining = match taker_order.amount.checked_sub(taker_order.filled_amount) {
            Some(value) => value,
            None => return false,
        };

        if fill_amount > maker_remaining || fill_amount > taker_remaining {
            return false;
        }

        let quote_amount = match fill_amount.checked_mul(fill_price).and_then(|value| value.checked_div(100_000_000)) {
            Some(value) => value,
            None => return false,
        };

        let (buyer, seller) = if maker_order.side == Side::Buy {
            (maker_order.maker, taker_order.maker)
        } else {
            (taker_order.maker, maker_order.maker)
        };

        let buyer_quote_balance = *self.balances.get(&(buyer, maker_order.quote_token)).unwrap_or(&0);
        let seller_base_balance = *self.balances.get(&(seller, maker_order.base_token)).unwrap_or(&0);

        if buyer_quote_balance < quote_amount {
            return false;
        }
        if seller_base_balance < fill_amount {
            return false;
        }

        let new_buyer_quote = match buyer_quote_balance.checked_sub(quote_amount) {
            Some(value) => value,
            None => return false,
        };
        let seller_quote_balance = *self.balances.get(&(seller, maker_order.quote_token)).unwrap_or(&0);
        let new_seller_quote = match seller_quote_balance.checked_add(quote_amount) {
            Some(value) => value,
            None => return false,
        };
        let new_seller_base = match seller_base_balance.checked_sub(fill_amount) {
            Some(value) => value,
            None => return false,
        };
        let buyer_base_balance = *self.balances.get(&(buyer, maker_order.base_token)).unwrap_or(&0);
        let new_buyer_base = match buyer_base_balance.checked_add(fill_amount) {
            Some(value) => value,
            None => return false,
        };

        self.balances.insert((buyer, maker_order.quote_token), new_buyer_quote);
        self.balances.insert((seller, maker_order.quote_token), new_seller_quote);
        self.balances.insert((seller, maker_order.base_token), new_seller_base);
        self.balances.insert((buyer, maker_order.base_token), new_buyer_base);

        if fill_amount == maker_remaining {
            self.used_nonces.insert((maker_order.maker, maker_order.nonce));
        }
        if fill_amount == taker_remaining {
            self.used_nonces.insert((taker_order.maker, taker_order.nonce));
        }

        true
    }

    fn cancel_order(&mut self, maker: u8, nonce: u64) -> bool {
        if self.used_nonces.contains(&(maker, nonce)) {
            return false;
        }
        if self.cancelled_nonces.contains(&(maker, nonce)) {
            return false;
        }
        self.cancelled_nonces.insert((maker, nonce));
        true
    }
}

fn decode_side(byte: u8) -> Side {
    if byte % 2 == 0 {
        Side::Buy
    } else {
        Side::Sell
    }
}

fn decode_order(chunk: &[u8], nonce_seed: u64) -> Order {
    Order {
        maker: (chunk[0] % 4) + 1,
        base_token: (chunk[1] % 5) + 1,
        quote_token: (chunk[2] % 5) + 6,
        side: decode_side(chunk[3]),
        price: 100_000_000 + (((chunk[4] as u128) << 8) | chunk[5] as u128),
        amount: 1 + (((chunk[6] as u128) << 8) | chunk[7] as u128),
        filled_amount: (chunk[8] as u128) % 4,
        nonce: nonce_seed,
        expiry: chunk[9] as u64,
    }
}

fuzz_target!(|data: &[u8]| {
    let mut model = SettlementModel::default();
    model.now = 32;

    for user in 1u8..=4u8 {
        for token in 1u8..=10u8 {
            model.balances.insert((user, token), 1_000_000_000);
        }
    }

    for chunk in data.chunks(24) {
        if chunk.len() < 24 {
            continue;
        }

        let op = chunk[0] % 3;
        let maker_nonce = chunk[1] as u64;
        let taker_nonce = chunk[2] as u64;
        let fill_amount = 1 + (((chunk[3] as u128) << 8) | chunk[4] as u128);
        let fill_price = 100_000_000 + ((((chunk[5] as u128) << 8) | chunk[6] as u128) % 1_000_000u128);

        let mut maker_order = decode_order(&chunk[7..17], maker_nonce);
        let mut taker_order = decode_order(&chunk[14..24], taker_nonce);

        if op == 0 {
            let _ = model.cancel_order((chunk[7] % 4) + 1, maker_nonce);
        } else {
            if op == 2 {
                taker_order.base_token = maker_order.base_token;
                taker_order.quote_token = maker_order.quote_token;
                taker_order.side = if maker_order.side == Side::Buy { Side::Sell } else { Side::Buy };
                taker_order.maker = ((maker_order.maker + (chunk[13] % 3) + 1) % 4) + 1;
                maker_order.filled_amount %= maker_order.amount;
                taker_order.filled_amount %= taker_order.amount;
            }

            let _ = model.settle_trade(maker_order, taker_order, fill_amount, fill_price);
        }

        for ((_, _), balance) in &model.balances {
            assert!(*balance <= 1_000_001_000_000);
        }

        for nonce in &model.used_nonces {
            assert!(!model.cancelled_nonces.contains(nonce));
        }
    }
});
