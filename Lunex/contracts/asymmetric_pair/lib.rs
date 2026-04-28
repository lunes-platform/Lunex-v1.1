//! # AsymmetricPair — Lunex V2 Parametric Liquidity Pool
//!
//! Implements the parametric curve equation:
//!
//! ```text
//! y = (k + c·L) · (1 - x/x₀)^γ - t·x - r·L
//! ```
//!
//! where:
//! - k  = base liquidity (owner deposit)
//! - L  = borrowed/leveraged amount
//! - c  = allocation fraction (0..1 scaled as 0..1_000_000)
//! - x₀ = max capacity (volume at which curve exhausts)
//! - γ  = curvature 1–5 (higher = more concentrated near midpoint)
//! - t  = fee in basis points
//! - r  = interest rate in basis points
//!
//! ## Access Roles
//! - `owner`   — deploy, deposit, withdraw, set_manager
//! - `manager` — update_curve_parameters within guardrails set by owner

#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod asymmetric_pair {
    use scale::{Decode, Encode};

    // ─── Constants ───────────────────────────────────────────────

    /// Scale factor for all u128 amounts (10^12 = 1 LUNES in plancks)
    const PLANCK: u128 = 1_000_000_000_000;

    /// Fixed-point scale for fractions (1_000_000 = 1.0)
    const FRAC_SCALE: u128 = 1_000_000;

    /// Maximum curvature
    const MAX_GAMMA: u8 = 5;

    /// Maximum fee in basis points (10%)
    const MAX_FEE_BPS: u16 = 1_000;

    // ─── Errors ──────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Error {
        Unauthorized,
        InsufficientLiquidity,
        ExceedsCapacity,
        InvalidGamma,
        InvalidFee,
        InvalidCapacity,
        ArithmeticOverflow,
        ZeroAmount,
        ManagerNotSet,
        GuardrailViolation,
        /// Reentrancy guard tripped — a callback attempted to call back into
        /// asymmetric_swap while a swap was already in flight.
        Reentrancy,
    }

    pub type Result<T> = core::result::Result<T, Error>;

    // ─── Curve Side ──────────────────────────────────────────────

    #[derive(Debug, Clone, Encode, Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct CurveSide {
        /// Base liquidity in plancks
        pub k: u128,
        /// Curvature exponent 1–5
        pub gamma: u8,
        /// Max volume capacity in plancks
        pub max_capacity_x0: u128,
        /// Fee in basis points
        pub fee_bps: u16,
        /// Accumulated volume (x) — resets on rebalance
        pub current_volume: u128,
    }

    // ─── Guardrails (manager limits) ─────────────────────────────

    #[derive(Debug, Clone, Encode, Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct Guardrails {
        pub gamma_min: u8,
        pub gamma_max: u8,
        pub can_change_capacity: bool,
    }

    impl Default for Guardrails {
        fn default() -> Self {
            Self {
                gamma_min: 1,
                gamma_max: 5,
                can_change_capacity: false,
            }
        }
    }

    // ─── Storage ─────────────────────────────────────────────────

    #[ink(storage)]
    pub struct AsymmetricPair {
        /// Owner: can deposit, withdraw, set_manager
        owner: AccountId,
        /// Optional manager: can only call update_curve_parameters
        manager: Option<AccountId>,
        /// Guardrails for the manager role
        guardrails: Guardrails,
        /// Reentrancy guard for `asymmetric_swap`. The current implementation
        /// is in-contract math but if a future revision adds PSP22 calls (or
        /// receives them via an integrated router), the guard is in place.
        locked: bool,

        // Curve state
        buy_curve: CurveSide,
        sell_curve: CurveSide,

        // Token addresses
        base_token: AccountId,
        quote_token: AccountId,
    }

    // ─── Events ──────────────────────────────────────────────────

    #[ink(event)]
    pub struct AsymmetricSwapExecuted {
        #[ink(topic)]
        caller: AccountId,
        is_buy: bool,
        amount_in: u128,
        liquidity_out: u128,
    }

    #[ink(event)]
    pub struct CurveParametersUpdated {
        #[ink(topic)]
        updated_by: AccountId,
        is_buy: bool,
        new_gamma: u8,
        new_capacity: u128,
        new_fee_bps: u16,
    }

    #[ink(event)]
    pub struct ManagerSet {
        #[ink(topic)]
        new_manager: Option<AccountId>,
    }

    #[ink(event)]
    pub struct LiquidityDeployed {
        #[ink(topic)]
        owner: AccountId,
        buy_k: u128,
        sell_k: u128,
    }

    // ─── Fixed-point Math ────────────────────────────────────────

    /// Integer approximation of (1 - x/x0)^gamma using FRAC_SCALE.
    ///
    /// Returns FRAC_SCALE * (1 - x/x0)^gamma using iterated multiplication.
    /// Safe for gamma in [1..5] without floating point.
    fn pow_fraction(x: u128, x0: u128, gamma: u8) -> u128 {
        if x >= x0 || x0 == 0 {
            return 0;
        }

        // base_frac = FRAC_SCALE * (x0 - x) / x0  (i.e. (1 - x/x0) * FRAC_SCALE)
        let numerator = x0.saturating_sub(x);
        let base_frac = (numerator as u128).checked_mul(FRAC_SCALE).unwrap_or(0) / x0;

        // Iterated multiply: result = base_frac^gamma / FRAC_SCALE^(gamma-1)
        let mut result = base_frac;
        for _ in 1..gamma {
            result = result.checked_mul(base_frac).unwrap_or(0) / FRAC_SCALE;
        }
        result
    }

    /// Compute available liquidity y for a given x on a curve side.
    /// Returns the available liquidity in plancks.
    fn compute_liquidity(x: u128, curve: &CurveSide) -> u128 {
        // base = k (c·L handled off-chain for leverage, simplified here to k only)
        let base = curve.k;

        // exhaustion_frac = FRAC_SCALE * (1 - x/x0)^gamma
        let exhaustion_frac = pow_fraction(x, curve.max_capacity_x0, curve.gamma);

        // gross = base * exhaustion_frac / FRAC_SCALE
        let gross = base.checked_mul(exhaustion_frac).unwrap_or(0) / FRAC_SCALE;

        // fee_discount = x * fee_bps / 10_000
        let fee_discount = x.checked_mul(curve.fee_bps as u128).unwrap_or(0) / 10_000;

        gross.saturating_sub(fee_discount)
    }

    // ─── Implementation ──────────────────────────────────────────

    impl AsymmetricPair {
        /// Deploy a new AsymmetricPair contract.
        #[ink(constructor)]
        pub fn new(
            base_token: AccountId,
            quote_token: AccountId,
            buy_gamma: u8,
            buy_max_capacity: u128,
            buy_fee_bps: u16,
            sell_gamma: u8,
            sell_max_capacity: u128,
            sell_fee_bps: u16,
        ) -> Self {
            assert!(
                buy_gamma >= 1 && buy_gamma <= MAX_GAMMA,
                "Invalid buy gamma"
            );
            assert!(
                sell_gamma >= 1 && sell_gamma <= MAX_GAMMA,
                "Invalid sell gamma"
            );
            assert!(buy_fee_bps <= MAX_FEE_BPS, "Buy fee too high");
            assert!(sell_fee_bps <= MAX_FEE_BPS, "Sell fee too high");

            Self {
                owner: Self::env().caller(),
                manager: None,
                guardrails: Guardrails::default(),
                locked: false,
                buy_curve: CurveSide {
                    k: 0,
                    gamma: buy_gamma,
                    max_capacity_x0: buy_max_capacity,
                    fee_bps: buy_fee_bps,
                    current_volume: 0,
                },
                sell_curve: CurveSide {
                    k: 0,
                    gamma: sell_gamma,
                    max_capacity_x0: sell_max_capacity,
                    fee_bps: sell_fee_bps,
                    current_volume: 0,
                },
                base_token,
                quote_token,
            }
        }

        // ── Owner Actions ────────────────────────────────────────

        /// Deploy initial liquidity. Only callable by owner.
        #[ink(message)]
        pub fn deploy_liquidity(&mut self, buy_k: u128, sell_k: u128) -> Result<()> {
            self.only_owner()?;
            self.buy_curve.k = buy_k;
            self.sell_curve.k = sell_k;

            self.env().emit_event(LiquidityDeployed {
                owner: self.owner,
                buy_k,
                sell_k,
            });
            Ok(())
        }

        /// Withdraw liquidity. Only callable by owner.
        #[ink(message)]
        pub fn withdraw(&mut self, amount: u128) -> Result<()> {
            self.only_owner()?;
            if amount == 0 {
                return Err(Error::ZeroAmount);
            }

            // Reduce buy_curve.k (simplified: full accounting done by PSP22 transfer off-chain)
            self.buy_curve.k = self.buy_curve.k.saturating_sub(amount);
            Ok(())
        }

        /// Assign (or remove) the manager role. Owner only.
        #[ink(message)]
        pub fn set_manager(
            &mut self,
            new_manager: Option<AccountId>,
            guardrails: Guardrails,
        ) -> Result<()> {
            self.only_owner()?;

            if guardrails.gamma_min < 1
                || guardrails.gamma_max > MAX_GAMMA
                || guardrails.gamma_min > guardrails.gamma_max
            {
                return Err(Error::InvalidGamma);
            }

            self.manager = new_manager;
            self.guardrails = guardrails;

            self.env().emit_event(ManagerSet { new_manager });
            Ok(())
        }

        // ── Manager / Owner Action ────────────────────────────────

        /// Update curve parameters. Callable by owner or manager (within guardrails).
        #[ink(message)]
        pub fn update_curve_parameters(
            &mut self,
            is_buy: bool,
            new_gamma: Option<u8>,
            new_max_capacity: Option<u128>,
            new_fee_bps: Option<u16>,
        ) -> Result<()> {
            let caller = self.env().caller();
            let is_owner = caller == self.owner;
            let is_manager = self.manager.map(|m| m == caller).unwrap_or(false);

            if !is_owner && !is_manager {
                return Err(Error::Unauthorized);
            }

            let current_curve = if is_buy {
                &self.buy_curve
            } else {
                &self.sell_curve
            };
            let mut next_gamma = current_curve.gamma;
            let mut next_capacity = current_curve.max_capacity_x0;
            let mut next_fee_bps = current_curve.fee_bps;

            if let Some(g) = new_gamma {
                if g < 1 || g > MAX_GAMMA {
                    return Err(Error::InvalidGamma);
                }
                if !is_owner {
                    if g < self.guardrails.gamma_min || g > self.guardrails.gamma_max {
                        return Err(Error::GuardrailViolation);
                    }
                }
                next_gamma = g;
            }

            if let Some(cap) = new_max_capacity {
                if cap == 0 {
                    return Err(Error::InvalidCapacity);
                }
                if !is_owner && !self.guardrails.can_change_capacity {
                    return Err(Error::GuardrailViolation);
                }
                next_capacity = cap;
            }

            if let Some(fee) = new_fee_bps {
                if fee > MAX_FEE_BPS {
                    return Err(Error::InvalidFee);
                }
                next_fee_bps = fee;
            }

            let curve = if is_buy {
                &mut self.buy_curve
            } else {
                &mut self.sell_curve
            };
            curve.gamma = next_gamma;
            curve.max_capacity_x0 = next_capacity;
            curve.fee_bps = next_fee_bps;

            self.env().emit_event(CurveParametersUpdated {
                updated_by: caller,
                is_buy,
                new_gamma: next_gamma,
                new_capacity: next_capacity,
                new_fee_bps: next_fee_bps,
            });

            Ok(())
        }

        // ── Public: Swap ─────────────────────────────────────────

        /// Execute an asymmetric swap against the curve.
        ///
        /// `is_buy = true`  → caller sends quote token, receives base token
        /// `is_buy = false` → caller sends base token, receives quote token
        ///
        /// Returns the amount of liquidity available (output) for `amount_in`.
        #[ink(message)]
        pub fn asymmetric_swap(&mut self, amount_in: u128, is_buy: bool) -> Result<u128> {
            if self.locked {
                return Err(Error::Reentrancy);
            }
            self.locked = true;

            if amount_in == 0 {
                self.locked = false;
                return Err(Error::ZeroAmount);
            }

            let curve = if is_buy {
                &mut self.buy_curve
            } else {
                &mut self.sell_curve
            };

            // Compute available liquidity at current volume
            let available = compute_liquidity(curve.current_volume, curve);
            if available < amount_in {
                self.locked = false;
                return Err(Error::InsufficientLiquidity);
            }

            // Check we won't exceed max capacity with this volume
            let new_volume = match curve.current_volume.checked_add(amount_in) {
                Some(v) => v,
                None => {
                    self.locked = false;
                    return Err(Error::ArithmeticOverflow);
                }
            };
            if new_volume > curve.max_capacity_x0 {
                self.locked = false;
                return Err(Error::ExceedsCapacity);
            }

            // Compute how much liquidity is consumed (the output)
            let liq_before = compute_liquidity(curve.current_volume, curve);
            curve.current_volume = new_volume;
            let liq_after = compute_liquidity(curve.current_volume, curve);

            let liquidity_out = liq_before.saturating_sub(liq_after);

            self.env().emit_event(AsymmetricSwapExecuted {
                caller: self.env().caller(),
                is_buy,
                amount_in,
                liquidity_out,
            });

            self.locked = false;
            Ok(liquidity_out)
        }

        // ── Queries ──────────────────────────────────────────────

        /// Query the available liquidity for a given input amount without executing.
        #[ink(message)]
        pub fn get_quote(&self, amount_in: u128, is_buy: bool) -> u128 {
            let curve = if is_buy {
                &self.buy_curve
            } else {
                &self.sell_curve
            };
            let liq_before = compute_liquidity(curve.current_volume, curve);
            let liq_after =
                compute_liquidity(curve.current_volume.saturating_add(amount_in), curve);
            liq_before.saturating_sub(liq_after)
        }

        /// Get the current buy curve state.
        #[ink(message)]
        pub fn get_buy_curve(&self) -> CurveSide {
            self.buy_curve.clone()
        }

        /// Get the current sell curve state.
        #[ink(message)]
        pub fn get_sell_curve(&self) -> CurveSide {
            self.sell_curve.clone()
        }

        /// Get the owner address.
        #[ink(message)]
        pub fn get_owner(&self) -> AccountId {
            self.owner
        }

        /// Get the manager address (if set).
        #[ink(message)]
        pub fn get_manager(&self) -> Option<AccountId> {
            self.manager
        }

        /// Get current guardrails.
        #[ink(message)]
        pub fn get_guardrails(&self) -> Guardrails {
            self.guardrails.clone()
        }

        // ── Helpers ──────────────────────────────────────────────

        fn only_owner(&self) -> Result<()> {
            if self.env().caller() != self.owner {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }
    }

    // ─── Unit Tests ──────────────────────────────────────────────

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::test;

        fn default_contract() -> AsymmetricPair {
            let base = test::default_accounts::<ink::env::DefaultEnvironment>().alice;
            AsymmetricPair::new(base, base, 3, 10_000 * PLANCK, 30, 2, 8_000 * PLANCK, 30)
        }

        #[ink::test]
        fn deploy_and_query_works() {
            let mut c = default_contract();
            c.deploy_liquidity(1_000 * PLANCK, 500 * PLANCK).unwrap();

            assert!(c.get_buy_curve().k == 1_000 * PLANCK);
            assert!(c.get_sell_curve().k == 500 * PLANCK);
        }

        #[ink::test]
        fn swap_reduces_liquidity() {
            let mut c = default_contract();
            c.deploy_liquidity(1_000 * PLANCK, 500 * PLANCK).unwrap();

            let quote = c.get_quote(10 * PLANCK, true);
            assert!(quote > 0, "Should have positive liquidity for small trade");

            let result = c.asymmetric_swap(10 * PLANCK, true);
            assert!(result.is_ok());
        }

        #[ink::test]
        fn manager_update_within_guardrails() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut c = default_contract();
            c.deploy_liquidity(1_000 * PLANCK, 500 * PLANCK).unwrap();

            // Set manager with restricted guardrails
            let guardrails = Guardrails {
                gamma_min: 2,
                gamma_max: 4,
                can_change_capacity: false,
            };
            c.set_manager(Some(accounts.bob), guardrails).unwrap();

            // Simulate manager call
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            let result = c.update_curve_parameters(true, Some(3), None, None);
            assert!(
                result.is_ok(),
                "Manager should be able to set gamma=3 within {{2,4}}"
            );
        }

        #[ink::test]
        fn manager_blocked_outside_guardrails() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut c = default_contract();
            c.deploy_liquidity(1_000 * PLANCK, 500 * PLANCK).unwrap();

            let guardrails = Guardrails {
                gamma_min: 2,
                gamma_max: 3,
                can_change_capacity: false,
            };
            c.set_manager(Some(accounts.bob), guardrails).unwrap();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            let result = c.update_curve_parameters(true, Some(5), None, None);
            assert_eq!(result, Err(Error::GuardrailViolation));
        }

        #[ink::test]
        fn failed_curve_update_does_not_partially_apply_prior_fields() {
            let mut c = default_contract();
            let before = c.get_buy_curve();

            let result = c.update_curve_parameters(true, Some(4), None, Some(MAX_FEE_BPS + 1));

            assert_eq!(result, Err(Error::InvalidFee));
            let after = c.get_buy_curve();
            assert_eq!(after.gamma, before.gamma);
            assert_eq!(after.max_capacity_x0, before.max_capacity_x0);
            assert_eq!(after.fee_bps, before.fee_bps);
            assert_eq!(after.current_volume, before.current_volume);
        }

        #[ink::test]
        fn manager_cannot_withdraw() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut c = default_contract();
            c.deploy_liquidity(1_000 * PLANCK, 500 * PLANCK).unwrap();
            c.set_manager(Some(accounts.bob), Guardrails::default())
                .unwrap();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            let result = c.withdraw(1 * PLANCK);
            assert_eq!(result, Err(Error::Unauthorized));
        }

        #[ink::test]
        fn pow_fraction_sanity() {
            // (1 - 10/500)^2 = 0.98^2 = 0.9604 → FRAC_SCALE * 0.9604 ≈ 960_400
            let result = pow_fraction(10, 500, 2);
            assert!(
                result > 950_000 && result < 970_000,
                "Expected ~960400, got {result}"
            );
        }
    }
}
