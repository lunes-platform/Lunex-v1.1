//! # ListingManager Contract
//!
//! Orchestrates the token listing flow on the Lunex DEX. Before listing, the
//! project creates the TOKEN/LUNES pool via the Factory and adds liquidity.
//! Then, in ONE transaction (`list_token`), this contract:
//!
//!   1. verifies the pair is the canonical Factory pair for TOKEN/LUNES and
//!      derives the caller's LUNES/TOKEN share from the pair reserves,
//!   2. collects the tier listing fee (PSP22 `transfer_from`, fee token) and
//!      splits it 20% staking · 50% treasury · 30% rewards,
//!   3. moves `lp_amount` LP tokens from the caller into the LiquidityLock
//!      (PSP22 `transfer_from` on the pair) and creates the lock there,
//!   4. records the listing and emits events.
//!
//! Any failing step returns `Err`, which reverts the whole message (ink! 4
//! sets the revert flag for `Err` results): no fee is kept without a lock and
//! no lock exists without a fee.
//!
//! Tier system (defaults, in whole fee-token units; scaled by the fee token's
//! real decimals at construction and adjustable by admin behind a timelock)
//! ----------------------------------------------------------------------------
//! | Tier | Name     | Fee (LUNES) | Min Liq (LUNES) | Lock     |
//! |------|----------|-------------|-----------------|----------|
//! |  1   | Basic    |      1_000  |         10_000  |  90 days |
//! |  2   | Verified |      5_000  |         25_000  | 120 days |
//! |  3   | Featured |     20_000  |         50_000  | 180 days |
//!
//! Events
//! ------
//! - TokenListed
//! - ListingFeeCollected
//! - FeeDistributed
//! - TierConfigProposed / TierConfigUpdated

#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![warn(clippy::arithmetic_side_effects)]

#[ink::contract]
mod listing_manager {
    use ink::env::call::{build_call, ExecutionInput, Selector};
    use ink::env::DefaultEnvironment;
    use ink::storage::Mapping;
    use scale::{Decode, Encode};

    // ── Constants ────────────────────────────────────────────────────

    // Default listing fee per tier, in WHOLE fee-token units
    const TIER1_FEE_UNITS: u128 = 1_000;
    const TIER2_FEE_UNITS: u128 = 5_000;
    const TIER3_FEE_UNITS: u128 = 20_000;

    // Default minimum liquidity (LUNES side of the caller's LP share), whole units
    const TIER1_MIN_LIQ_UNITS: u128 = 10_000;
    const TIER2_MIN_LIQ_UNITS: u128 = 25_000;
    const TIER3_MIN_LIQ_UNITS: u128 = 50_000;

    // Lock duration in milliseconds per tier
    const TIER1_LOCK_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
    const TIER2_LOCK_MS: u64 = 120 * 24 * 60 * 60 * 1_000;
    const TIER3_LOCK_MS: u64 = 180 * 24 * 60 * 60 * 1_000;

    /// Admin can never set a lock shorter than this (anti-rug floor).
    const MIN_LOCK_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

    /// Fee token decimals above this would overflow realistic u128 amounts.
    const MAX_DECIMALS: u8 = 24;

    // Fee split basis points (out of 10_000)
    const BPS_DENOM: u128 = 10_000;
    const BPS_STAKING: u128 = 2_000; // 20% → staking pool
    const BPS_TREASURY: u128 = 5_000; // 50% → team revenue
    #[allow(dead_code)] // only checked at compile time below
    const BPS_REWARDS: u128 = 3_000; // 30% → rewards pool (gets rounding dust)
                                     // The split must cover exactly 100% (rewards = fee - staking - treasury).
    const _: () = assert!(BPS_STAKING + BPS_TREASURY + BPS_REWARDS == BPS_DENOM);

    // ── Cross-contract selectors ─────────────────────────────────────
    // PSP22 (explicit selectors used by Lunex Pair / WNative)
    const SEL_PSP22_TRANSFER: [u8; 4] = ink::selector_bytes!("PSP22::transfer");
    const SEL_PSP22_TRANSFER_FROM: [u8; 4] = ink::selector_bytes!("PSP22::transfer_from");
    // Factory / Pair / LiquidityLock (default ink! selectors = message names)
    const SEL_FACTORY_GET_PAIR: [u8; 4] = ink::selector_bytes!("get_pair");
    const SEL_PAIR_GET_RESERVES: [u8; 4] = ink::selector_bytes!("get_reserves");
    const SEL_PAIR_TOKEN_0: [u8; 4] = ink::selector_bytes!("token_0");
    const SEL_PAIR_TOKEN_1: [u8; 4] = ink::selector_bytes!("token_1");
    const SEL_PAIR_TOTAL_SUPPLY: [u8; 4] = ink::selector_bytes!("total_supply");
    const SEL_LOCK_CREATE_LOCK: [u8; 4] = ink::selector_bytes!("create_lock");

    // ── PSP22 Error (for cross-contract returns) ─────────────────────

    #[derive(Debug, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum PSP22Error {
        Custom(ink::prelude::string::String),
        InsufficientBalance,
        InsufficientAllowance,
        ZeroRecipientAddress,
        ZeroSenderAddress,
        SafeTransferCheckFailed(ink::prelude::string::String),
    }

    // ── Cross-contract call wrappers ─────────────────────────────────
    //
    // `try_invoke` yields Result<MessageResult<R>, EnvError>; every layer
    // (env error, LangError, contract Err) is mapped to a contract Error so
    // the caller propagates it with `?` and the whole message reverts.
    // Reentrancy: calls are made without CallFlags::ALLOW_REENTRY, so the
    // callees cannot call back into this contract.

    struct Ext;

    impl Ext {
        /// PSP22 transfer of `amount` from this contract to `to`.
        fn psp22_transfer(token: AccountId, to: AccountId, amount: Balance) -> Result<()> {
            let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
            build_call::<DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(SEL_PSP22_TRANSFER))
                        .push_arg(to)
                        .push_arg(amount)
                        .push_arg(data),
                )
                .returns::<core::result::Result<(), PSP22Error>>()
                .try_invoke()
                .map_err(|_| Error::TransferFailed)?
                .map_err(|_| Error::TransferFailed)?
                .map_err(|_| Error::TransferFailed)
        }

        /// PSP22 transfer_from (`from` must have approved this contract).
        fn psp22_transfer_from(
            token: AccountId,
            from: AccountId,
            to: AccountId,
            amount: Balance,
            err: Error,
        ) -> Result<()> {
            let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
            let res = build_call::<DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(SEL_PSP22_TRANSFER_FROM))
                        .push_arg(from)
                        .push_arg(to)
                        .push_arg(amount)
                        .push_arg(data),
                )
                // Only the Ok(()) byte is decoded; error payloads differ per token.
                .returns::<core::result::Result<(), u8>>()
                .try_invoke();
            match res {
                Ok(Ok(Ok(()))) => Ok(()),
                _ => Err(err),
            }
        }

        /// Factory::get_pair(a, b) → Option<AccountId>
        fn factory_get_pair(
            factory: AccountId,
            a: AccountId,
            b: AccountId,
        ) -> Result<Option<AccountId>> {
            build_call::<DefaultEnvironment>()
                .call(factory)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(SEL_FACTORY_GET_PAIR))
                        .push_arg(a)
                        .push_arg(b),
                )
                .returns::<Option<AccountId>>()
                .try_invoke()
                .map_err(|_| Error::PairQueryFailed)?
                .map_err(|_| Error::PairQueryFailed)
        }

        fn pair_account(pair: AccountId, selector: [u8; 4]) -> Result<AccountId> {
            build_call::<DefaultEnvironment>()
                .call(pair)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(ExecutionInput::new(Selector::new(selector)))
                .returns::<AccountId>()
                .try_invoke()
                .map_err(|_| Error::PairQueryFailed)?
                .map_err(|_| Error::PairQueryFailed)
        }

        fn pair_reserves(pair: AccountId) -> Result<(Balance, Balance, Timestamp)> {
            build_call::<DefaultEnvironment>()
                .call(pair)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(ExecutionInput::new(Selector::new(SEL_PAIR_GET_RESERVES)))
                .returns::<(Balance, Balance, Timestamp)>()
                .try_invoke()
                .map_err(|_| Error::PairQueryFailed)?
                .map_err(|_| Error::PairQueryFailed)
        }

        fn pair_total_supply(pair: AccountId) -> Result<Balance> {
            build_call::<DefaultEnvironment>()
                .call(pair)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(ExecutionInput::new(Selector::new(SEL_PAIR_TOTAL_SUPPLY)))
                .returns::<Balance>()
                .try_invoke()
                .map_err(|_| Error::PairQueryFailed)?
                .map_err(|_| Error::PairQueryFailed)
        }

        /// LiquidityLock::create_lock(..) → Result<LockId, LockError>
        #[allow(clippy::too_many_arguments)]
        fn lock_create(
            lock: AccountId,
            owner: AccountId,
            pair: AccountId,
            lp_amount: Balance,
            lunes_amount: Balance,
            token_amount: Balance,
            lock_duration_ms: u64,
            tier: u8,
        ) -> Result<u64> {
            let res = build_call::<DefaultEnvironment>()
                .call(lock)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(SEL_LOCK_CREATE_LOCK))
                        .push_arg(owner)
                        .push_arg(pair) // pair_address
                        .push_arg(pair) // lp_token (the pair is the LP token)
                        .push_arg(lp_amount)
                        .push_arg(lunes_amount)
                        .push_arg(token_amount)
                        .push_arg(lock_duration_ms)
                        .push_arg(tier),
                )
                // LiquidityLock::Error is a field-less enum → 1 byte
                .returns::<core::result::Result<u64, u8>>()
                .try_invoke();
            match res {
                Ok(Ok(Ok(id))) => Ok(id),
                _ => Err(Error::LockCreationFailed),
            }
        }
    }

    // ── Pure helpers (unit-tested) ───────────────────────────────────

    /// 10^decimals as u128.
    fn unit_for(decimals: u8) -> Result<u128> {
        if decimals > MAX_DECIMALS {
            return Err(Error::InvalidConfig);
        }
        10u128
            .checked_pow(u32::from(decimals))
            .ok_or(Error::Overflow)
    }

    /// Default tier config scaled by the fee token's real decimals.
    fn default_tier(tier: u8, decimals: u8) -> Result<TierConfig> {
        let unit = unit_for(decimals)?;
        let (fee, min, lock) = match tier {
            1 => (TIER1_FEE_UNITS, TIER1_MIN_LIQ_UNITS, TIER1_LOCK_MS),
            2 => (TIER2_FEE_UNITS, TIER2_MIN_LIQ_UNITS, TIER2_LOCK_MS),
            3 => (TIER3_FEE_UNITS, TIER3_MIN_LIQ_UNITS, TIER3_LOCK_MS),
            _ => return Err(Error::InvalidTier),
        };
        Ok(TierConfig {
            listing_fee: fee.checked_mul(unit).ok_or(Error::Overflow)?,
            min_lunes_liq: min.checked_mul(unit).ok_or(Error::Overflow)?,
            lock_duration_ms: lock,
        })
    }

    fn validate_tier_config(tier: u8, cfg: &TierConfig) -> Result<()> {
        if !(1..=3).contains(&tier) {
            return Err(Error::InvalidTier);
        }
        if cfg.listing_fee == 0 || cfg.min_lunes_liq == 0 || cfg.lock_duration_ms < MIN_LOCK_MS {
            return Err(Error::InvalidConfig);
        }
        Ok(())
    }

    /// (staking, treasury, rewards). Rewards takes the rounding remainder so
    /// the three parts always sum to `fee` (no dust stuck in the contract).
    fn split_fee(fee: Balance) -> Result<(Balance, Balance, Balance)> {
        let staking = fee
            .checked_mul(BPS_STAKING)
            .ok_or(Error::Overflow)?
            .checked_div(BPS_DENOM)
            .ok_or(Error::Overflow)?;
        let treasury = fee
            .checked_mul(BPS_TREASURY)
            .ok_or(Error::Overflow)?
            .checked_div(BPS_DENOM)
            .ok_or(Error::Overflow)?;
        let rewards = fee
            .checked_sub(staking)
            .ok_or(Error::Overflow)?
            .checked_sub(treasury)
            .ok_or(Error::Overflow)?;
        Ok((staking, treasury, rewards))
    }

    /// Caller's share of a reserve for `lp_amount` LP out of `total_supply`.
    fn lp_share(reserve: Balance, lp_amount: Balance, total_supply: Balance) -> Result<Balance> {
        if total_supply == 0 || lp_amount > total_supply {
            return Err(Error::InvalidPair);
        }
        reserve
            .checked_mul(lp_amount)
            .ok_or(Error::Overflow)?
            .checked_div(total_supply)
            .ok_or(Error::Overflow)
    }

    /// Orders reserves as (lunes, token) given the pair's token_0/token_1.
    fn order_reserves(
        lunes_token: AccountId,
        token: AccountId,
        token_0: AccountId,
        token_1: AccountId,
        reserve_0: Balance,
        reserve_1: Balance,
    ) -> Result<(Balance, Balance)> {
        if token_0 == lunes_token && token_1 == token {
            Ok((reserve_0, reserve_1))
        } else if token_1 == lunes_token && token_0 == token {
            Ok((reserve_1, reserve_0))
        } else {
            Err(Error::InvalidPair)
        }
    }

    // ── Types ────────────────────────────────────────────────────────

    pub type ListingId = u64;

    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub enum ListingStatus {
        Pending,
        Active,
        Rejected,
    }

    #[derive(Debug, Clone, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct ListingRecord {
        pub id: ListingId,
        pub owner: AccountId,
        pub token_address: AccountId,
        pub pair_address: AccountId,
        pub lp_token: AccountId,
        pub lp_amount: Balance,
        /// LUNES side of the locked LP share, derived on-chain from reserves
        pub lunes_liquidity: Balance,
        /// TOKEN side of the locked LP share, derived on-chain from reserves
        pub token_liquidity: Balance,
        pub tier: u8,
        /// LiquidityLock lock id holding the LP tokens
        pub lock_id: u64,
        pub unlock_at: Timestamp,
        pub fee_paid: Balance,
        pub status: ListingStatus,
        pub listed_at: Timestamp,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct TierConfig {
        pub listing_fee: Balance,
        pub min_lunes_liq: Balance,
        pub lock_duration_ms: u64,
    }

    // ── Storage ──────────────────────────────────────────────────────

    // Timelock padrão: 48 horas em milissegundos
    const DEFAULT_TIMELOCK_DELAY_MS: u64 = 48 * 60 * 60 * 1_000;

    #[ink(storage)]
    pub struct ListingManager {
        admin: AccountId,
        /// PSP22 the fee is paid in AND the pool's base token (WLUNES)
        lunes_token: AccountId,
        lunes_decimals: u8,
        factory: AccountId,
        liquidity_lock: AccountId,
        treasury: AccountId,
        rewards_pool: AccountId,
        staking_pool: AccountId,
        next_id: ListingId,
        listings: Mapping<ListingId, ListingRecord>,
        token_listing: Mapping<AccountId, ListingId>, // token → listing id
        tier_configs: Mapping<u8, TierConfig>,
        /// tier → (proposed config, executable after)
        pending_tiers: Mapping<u8, (TierConfig, Timestamp)>,
        total_collected: Balance,
        total_staked: Balance,
        paused: bool,
        /// Atraso obrigatório para troca de admin / tier config (timelock)
        timelock_delay: u64,
        /// Admin proposto (aguardando timelock)
        pending_admin: Option<AccountId>,
        /// Timestamp após o qual a mudança de admin pode ser executada
        admin_change_at: Timestamp,
    }

    // ── Events ───────────────────────────────────────────────────────

    #[ink(event)]
    pub struct TokenListed {
        #[ink(topic)]
        pub listing_id: ListingId,
        #[ink(topic)]
        pub owner: AccountId,
        #[ink(topic)]
        pub token_address: AccountId,
        pub pair_address: AccountId,
        pub tier: u8,
        pub lock_id: u64,
        pub listed_at: Timestamp,
    }

    #[ink(event)]
    pub struct AdminChangeProposed {
        #[ink(topic)]
        pub proposed_by: AccountId,
        pub new_admin: AccountId,
        pub execute_at: Timestamp,
    }

    #[ink(event)]
    pub struct AdminChanged {
        pub old_admin: AccountId,
        #[ink(topic)]
        pub new_admin: AccountId,
    }

    #[ink(event)]
    pub struct ListingFeeCollected {
        #[ink(topic)]
        pub listing_id: ListingId,
        pub payer: AccountId,
        pub amount: Balance,
        pub tier: u8,
    }

    #[ink(event)]
    pub struct ListingStatusChanged {
        #[ink(topic)]
        pub listing_id: ListingId,
        pub new_status: ListingStatus,
        pub changed_by: AccountId,
    }

    #[ink(event)]
    pub struct FeeDistributed {
        pub listing_id: ListingId,
        pub staking_amount: Balance,
        pub treasury_amount: Balance,
        pub rewards_amount: Balance,
    }

    #[ink(event)]
    pub struct TierConfigProposed {
        #[ink(topic)]
        pub tier: u8,
        pub config: TierConfig,
        pub execute_at: Timestamp,
    }

    #[ink(event)]
    pub struct TierConfigUpdated {
        #[ink(topic)]
        pub tier: u8,
        pub config: TierConfig,
    }

    // ── Errors ───────────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Error {
        Unauthorized,
        ContractPaused,
        TokenAlreadyListed,
        InvalidTier,
        InsufficientFee,
        InsufficientLiquidity,
        ZeroAmount,
        /// Fee transfer_from / split transfer failed (balance or allowance)
        TransferFailed,
        LockCreationFailed,
        ListingNotFound,
        Overflow,
        /// Nenhuma mudança de admin pendente
        NoPendingAdmin,
        /// Timelock ainda não expirou
        TimelockNotExpired,
        /// Pair is not the Factory pair for TOKEN/LUNES, or has no supply
        InvalidPair,
        /// Factory / pair read failed
        PairQueryFailed,
        /// LP transfer_from into the LiquidityLock failed (balance or allowance)
        LpTransferFailed,
        /// Invalid tier config / decimals
        InvalidConfig,
        /// No pending tier config change
        NoPendingConfig,
    }

    pub type Result<T> = core::result::Result<T, Error>;

    // ── Implementation ───────────────────────────────────────────────

    impl ListingManager {
        /// `lunes_decimals` must equal the fee token's `token_decimals()`
        /// (WLUNES = 8); tier amounts are scaled with it.
        #[ink(constructor)]
        pub fn new(
            lunes_token: AccountId,
            lunes_decimals: u8,
            factory: AccountId,
            liquidity_lock: AccountId,
            treasury: AccountId,
            rewards_pool: AccountId,
            staking_pool: AccountId,
        ) -> Self {
            let mut tier_configs = Mapping::default();
            for tier in 1u8..=3 {
                // Constructor panics (deploy fails) on unsupported decimals.
                let cfg =
                    default_tier(tier, lunes_decimals).expect("unsupported fee token decimals");
                tier_configs.insert(tier, &cfg);
            }
            Self {
                admin: Self::env().caller(),
                lunes_token,
                lunes_decimals,
                factory,
                liquidity_lock,
                treasury,
                rewards_pool,
                staking_pool,
                next_id: 0,
                listings: Mapping::default(),
                token_listing: Mapping::default(),
                tier_configs,
                pending_tiers: Mapping::default(),
                total_collected: 0,
                total_staked: 0,
                paused: false,
                timelock_delay: DEFAULT_TIMELOCK_DELAY_MS,
                pending_admin: None,
                admin_change_at: 0,
            }
        }

        // ── Core: list_token ──────────────────────────────────────

        /// Pays the listing fee and locks the caller's LP in ONE transaction.
        ///
        /// The caller must have:
        ///  1. created the TOKEN/LUNES pool via the Factory and added liquidity,
        ///  2. approved `tier_config(tier).listing_fee` of `lunes_token` to this
        ///     contract,
        ///  3. approved `lp_amount` LP tokens (the pair contract) to this
        ///     contract.
        ///
        /// The LUNES/TOKEN amounts recorded are derived on-chain from the pair
        /// reserves for `lp_amount`; the LUNES side must reach the tier minimum.
        /// LP tokens go to the LiquidityLock, owned by the caller, unlockable
        /// after `lock_duration_ms`. Any failure reverts everything.
        #[ink(message)]
        pub fn list_token(
            &mut self,
            tier: u8,
            token_address: AccountId,
            pair_address: AccountId,
            lp_amount: Balance,
        ) -> Result<ListingId> {
            // ── Checks ───────────────────────────────────────────────
            self.ensure_not_paused()?;
            let cfg = self.tier_config(tier)?;
            let caller = self.env().caller();
            let contract_addr = self.env().account_id();

            if self.token_listing.contains(token_address) {
                return Err(Error::TokenAlreadyListed);
            }
            if lp_amount == 0 {
                return Err(Error::ZeroAmount);
            }
            if token_address == self.lunes_token {
                return Err(Error::InvalidPair);
            }

            // Pair must be the canonical Factory pair (trusted code) for TOKEN/LUNES
            let canonical = Ext::factory_get_pair(self.factory, token_address, self.lunes_token)?;
            if canonical != Some(pair_address) {
                return Err(Error::InvalidPair);
            }
            let token_0 = Ext::pair_account(pair_address, SEL_PAIR_TOKEN_0)?;
            let token_1 = Ext::pair_account(pair_address, SEL_PAIR_TOKEN_1)?;
            let (reserve_0, reserve_1, _) = Ext::pair_reserves(pair_address)?;
            let total_supply = Ext::pair_total_supply(pair_address)?;
            let (reserve_lunes, reserve_token) = order_reserves(
                self.lunes_token,
                token_address,
                token_0,
                token_1,
                reserve_0,
                reserve_1,
            )?;
            let lunes_liquidity = lp_share(reserve_lunes, lp_amount, total_supply)?;
            let token_liquidity = lp_share(reserve_token, lp_amount, total_supply)?;
            if lunes_liquidity == 0 || token_liquidity == 0 {
                return Err(Error::ZeroAmount);
            }
            if lunes_liquidity < cfg.min_lunes_liq {
                return Err(Error::InsufficientLiquidity);
            }
            let (staking_amt, treasury_amt, rewards_amt) = split_fee(cfg.listing_fee)?;

            // ── Effects (before any state-changing interaction) ──────
            let listing_id = self.next_id;
            self.next_id = listing_id.checked_add(1).ok_or(Error::Overflow)?;
            // Reserve the token now: a re-entrant/duplicate call sees it listed.
            self.token_listing.insert(token_address, &listing_id);
            self.total_collected = self
                .total_collected
                .checked_add(cfg.listing_fee)
                .ok_or(Error::Overflow)?;
            self.total_staked = self
                .total_staked
                .checked_add(staking_amt)
                .ok_or(Error::Overflow)?;

            // ── Interactions (any Err reverts all of the above) ──────
            // 1. Collect the fee
            Ext::psp22_transfer_from(
                self.lunes_token,
                caller,
                contract_addr,
                cfg.listing_fee,
                Error::TransferFailed,
            )?;
            self.env().emit_event(ListingFeeCollected {
                listing_id,
                payer: caller,
                amount: cfg.listing_fee,
                tier,
            });

            // 2. Split the fee: 20% staking · 50% treasury · 30% rewards
            Ext::psp22_transfer(self.lunes_token, self.staking_pool, staking_amt)?;
            Ext::psp22_transfer(self.lunes_token, self.treasury, treasury_amt)?;
            Ext::psp22_transfer(self.lunes_token, self.rewards_pool, rewards_amt)?;
            self.env().emit_event(FeeDistributed {
                listing_id,
                staking_amount: staking_amt,
                treasury_amount: treasury_amt,
                rewards_amount: rewards_amt,
            });

            // 3. Move LP from the caller straight into the LiquidityLock
            Ext::psp22_transfer_from(
                pair_address,
                caller,
                self.liquidity_lock,
                lp_amount,
                Error::LpTransferFailed,
            )?;

            // 4. Create the lock (this contract is the lock's manager)
            let lock_id = Ext::lock_create(
                self.liquidity_lock,
                caller,
                pair_address,
                lp_amount,
                lunes_liquidity,
                token_liquidity,
                cfg.lock_duration_ms,
                tier,
            )?;

            // ── Record ───────────────────────────────────────────────
            let now = self.env().block_timestamp();
            let record = ListingRecord {
                id: listing_id,
                owner: caller,
                token_address,
                pair_address,
                lp_token: pair_address,
                lp_amount,
                lunes_liquidity,
                token_liquidity,
                tier,
                lock_id,
                unlock_at: now.saturating_add(cfg.lock_duration_ms),
                fee_paid: cfg.listing_fee,
                status: ListingStatus::Active,
                listed_at: now,
            };
            self.listings.insert(listing_id, &record);

            self.env().emit_event(TokenListed {
                listing_id,
                owner: caller,
                token_address,
                pair_address,
                tier,
                lock_id,
                listed_at: now,
            });

            Ok(listing_id)
        }

        // ── Admin ─────────────────────────────────────────────────

        #[ink(message)]
        pub fn set_paused(&mut self, paused: bool) -> Result<()> {
            self.ensure_admin()?;
            self.paused = paused;
            Ok(())
        }

        #[ink(message)]
        pub fn set_treasury(&mut self, treasury: AccountId) -> Result<()> {
            self.ensure_admin()?;
            self.treasury = treasury;
            Ok(())
        }

        #[ink(message)]
        pub fn set_rewards_pool(&mut self, pool: AccountId) -> Result<()> {
            self.ensure_admin()?;
            self.rewards_pool = pool;
            Ok(())
        }

        #[ink(message)]
        pub fn set_staking_pool(&mut self, pool: AccountId) -> Result<()> {
            self.ensure_admin()?;
            self.staking_pool = pool;
            Ok(())
        }

        #[ink(message)]
        pub fn reject_listing(&mut self, listing_id: ListingId) -> Result<()> {
            self.ensure_admin()?;
            let mut record = self
                .listings
                .get(listing_id)
                .ok_or(Error::ListingNotFound)?;
            record.status = ListingStatus::Rejected;
            self.listings.insert(listing_id, &record);
            self.env().emit_event(ListingStatusChanged {
                listing_id,
                new_status: ListingStatus::Rejected,
                changed_by: self.env().caller(),
            });
            Ok(())
        }

        /// Proposes a new tier config (amounts in fee-token base units).
        /// Executable after the governance timelock.
        #[ink(message)]
        pub fn propose_tier_config(
            &mut self,
            tier: u8,
            listing_fee: Balance,
            min_lunes_liq: Balance,
            lock_duration_ms: u64,
        ) -> Result<()> {
            self.ensure_admin()?;
            let config = TierConfig {
                listing_fee,
                min_lunes_liq,
                lock_duration_ms,
            };
            validate_tier_config(tier, &config)?;
            let execute_at = self
                .env()
                .block_timestamp()
                .saturating_add(self.timelock_delay);
            self.pending_tiers
                .insert(tier, &(config.clone(), execute_at));
            self.env().emit_event(TierConfigProposed {
                tier,
                config,
                execute_at,
            });
            Ok(())
        }

        /// Applies a proposed tier config once its timelock expired (anyone).
        #[ink(message)]
        pub fn execute_tier_config(&mut self, tier: u8) -> Result<()> {
            let (config, execute_at) =
                self.pending_tiers.get(tier).ok_or(Error::NoPendingConfig)?;
            if self.env().block_timestamp() < execute_at {
                return Err(Error::TimelockNotExpired);
            }
            self.pending_tiers.remove(tier);
            self.tier_configs.insert(tier, &config);
            self.env().emit_event(TierConfigUpdated { tier, config });
            Ok(())
        }

        /// Cancels a pending tier config proposal (admin).
        #[ink(message)]
        pub fn cancel_tier_config(&mut self, tier: u8) -> Result<()> {
            self.ensure_admin()?;
            if !self.pending_tiers.contains(tier) {
                return Err(Error::NoPendingConfig);
            }
            self.pending_tiers.remove(tier);
            Ok(())
        }

        // ── Views ─────────────────────────────────────────────────

        #[ink(message)]
        pub fn get_listing(&self, listing_id: ListingId) -> Option<ListingRecord> {
            self.listings.get(listing_id)
        }

        #[ink(message)]
        pub fn get_token_listing(&self, token: AccountId) -> Option<ListingId> {
            self.token_listing.get(token)
        }

        #[ink(message)]
        pub fn is_listed(&self, token: AccountId) -> bool {
            self.token_listing.contains(token)
        }

        /// Effective on-chain tier config (fee-token base units).
        #[ink(message)]
        pub fn tier_config(&self, tier: u8) -> Result<TierConfig> {
            if !(1..=3).contains(&tier) {
                return Err(Error::InvalidTier);
            }
            self.tier_configs.get(tier).ok_or(Error::InvalidTier)
        }

        /// Pending tier config proposal and the time it becomes executable.
        #[ink(message)]
        pub fn get_pending_tier_config(&self, tier: u8) -> Option<(TierConfig, Timestamp)> {
            self.pending_tiers.get(tier)
        }

        /// Fee token (also the pool base token, WLUNES) and its decimals.
        #[ink(message)]
        pub fn lunes_token(&self) -> AccountId {
            self.lunes_token
        }

        #[ink(message)]
        pub fn lunes_decimals(&self) -> u8 {
            self.lunes_decimals
        }

        #[ink(message)]
        pub fn factory(&self) -> AccountId {
            self.factory
        }

        #[ink(message)]
        pub fn liquidity_lock(&self) -> AccountId {
            self.liquidity_lock
        }

        #[ink(message)]
        pub fn total_collected(&self) -> Balance {
            self.total_collected
        }

        #[ink(message)]
        pub fn total_staked(&self) -> Balance {
            self.total_staked
        }

        #[ink(message)]
        pub fn admin(&self) -> AccountId {
            self.admin
        }

        #[ink(message)]
        pub fn staking_pool(&self) -> AccountId {
            self.staking_pool
        }

        #[ink(message)]
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        // ── Guards ────────────────────────────────────────────────

        fn ensure_admin(&self) -> Result<()> {
            if self.env().caller() != self.admin {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }

        fn ensure_not_paused(&self) -> Result<()> {
            if self.paused {
                return Err(Error::ContractPaused);
            }
            Ok(())
        }

        // ── Governance Timelock ───────────────────────────────────

        /// Propõe troca de admin com atraso obrigatório (timelock).
        /// Somente o admin atual pode propor.
        #[ink(message)]
        pub fn propose_admin_change(&mut self, new_admin: AccountId) -> Result<()> {
            self.ensure_admin()?;
            let now = self.env().block_timestamp();
            let execute_at = now.saturating_add(self.timelock_delay);
            self.pending_admin = Some(new_admin);
            self.admin_change_at = execute_at;
            self.env().emit_event(AdminChangeProposed {
                proposed_by: self.env().caller(),
                new_admin,
                execute_at,
            });
            Ok(())
        }

        /// Executa a troca de admin após o timelock expirar.
        /// Pode ser chamado por qualquer um após o delay.
        #[ink(message)]
        pub fn execute_admin_change(&mut self) -> Result<()> {
            let pending = self.pending_admin.ok_or(Error::NoPendingAdmin)?;
            let now = self.env().block_timestamp();
            if now < self.admin_change_at {
                return Err(Error::TimelockNotExpired);
            }
            let old_admin = self.admin;
            self.admin = pending;
            self.pending_admin = None;
            self.env().emit_event(AdminChanged {
                old_admin,
                new_admin: pending,
            });
            Ok(())
        }

        /// Retorna admin proposto e timestamp de liberação (se houver proposta pendente).
        #[ink(message)]
        pub fn get_pending_admin(&self) -> (Option<AccountId>, Timestamp) {
            (self.pending_admin, self.admin_change_at)
        }

        /// Configura o atraso de timelock (somente admin, mínimo 1 hora).
        #[ink(message)]
        pub fn set_timelock_delay(&mut self, delay_ms: u64) -> Result<()> {
            self.ensure_admin()?;
            // Mínimo de 1 hora para evitar bypass
            let min_delay: u64 = 60 * 60 * 1_000;
            self.timelock_delay = delay_ms.max(min_delay);
            Ok(())
        }
    }

    // ── Unit tests ────────────────────────────────────────────────────

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::test;

        const DEC: u8 = 8; // WLUNES decimals
        const UNIT: u128 = 100_000_000;

        fn default_accounts() -> test::DefaultAccounts<ink::env::DefaultEnvironment> {
            test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn make_contract() -> ListingManager {
            let accounts = default_accounts();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            ListingManager::new(
                accounts.alice,   // lunes_token
                DEC,              // lunes_decimals
                accounts.frank,   // factory
                accounts.bob,     // liquidity_lock
                accounts.charlie, // treasury
                accounts.django,  // rewards_pool
                accounts.eve,     // staking_pool
            )
        }

        #[ink::test]
        fn tier_config_scaled_by_fee_token_decimals() {
            let contract = make_contract();

            let t1 = contract.tier_config(1).unwrap();
            assert_eq!(t1.listing_fee, 1_000 * UNIT);
            assert_eq!(t1.min_lunes_liq, 10_000 * UNIT);
            assert_eq!(t1.lock_duration_ms, TIER1_LOCK_MS);

            assert_eq!(contract.tier_config(2).unwrap().listing_fee, 5_000 * UNIT);
            assert_eq!(contract.tier_config(3).unwrap().listing_fee, 20_000 * UNIT);
            assert_eq!(
                contract.tier_config(3).unwrap().min_lunes_liq,
                50_000 * UNIT
            );

            assert_eq!(contract.tier_config(0), Err(Error::InvalidTier));
            assert_eq!(contract.tier_config(4), Err(Error::InvalidTier));
            assert_eq!(contract.lunes_decimals(), DEC);
        }

        #[ink::test]
        fn unit_for_rejects_absurd_decimals() {
            assert_eq!(unit_for(0), Ok(1));
            assert_eq!(unit_for(12), Ok(1_000_000_000_000));
            assert_eq!(unit_for(MAX_DECIMALS + 1), Err(Error::InvalidConfig));
            assert_eq!(default_tier(4, 8), Err(Error::InvalidTier));
        }

        #[ink::test]
        fn cannot_list_same_token_twice_via_mapping() {
            // Full list_token needs cross-contract calls (not available off-chain);
            // these tests cover the guards that run before any call.
            let accounts = default_accounts();
            let mut contract = make_contract();
            contract.token_listing.insert(accounts.frank, &0);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            let result = contract.list_token(1, accounts.frank, accounts.charlie, UNIT);
            assert_eq!(result, Err(Error::TokenAlreadyListed));
        }

        #[ink::test]
        fn zero_lp_amount_rejected() {
            let accounts = default_accounts();
            let mut contract = make_contract();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            assert_eq!(
                contract.list_token(1, accounts.frank, accounts.charlie, 0),
                Err(Error::ZeroAmount)
            );
        }

        #[ink::test]
        fn listing_the_fee_token_itself_rejected() {
            let accounts = default_accounts();
            let mut contract = make_contract();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            // alice is the lunes_token in make_contract
            assert_eq!(
                contract.list_token(1, accounts.alice, accounts.charlie, UNIT),
                Err(Error::InvalidPair)
            );
        }

        #[ink::test]
        fn invalid_tier_rejected_before_calls() {
            let accounts = default_accounts();
            let mut contract = make_contract();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            assert_eq!(
                contract.list_token(0, accounts.frank, accounts.charlie, UNIT),
                Err(Error::InvalidTier)
            );
        }

        #[ink::test]
        fn paused_contract_rejects_listing() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            contract.set_paused(true).unwrap(); // alice = admin

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            let err = contract
                .list_token(1, accounts.frank, accounts.charlie, UNIT)
                .unwrap_err();
            assert_eq!(err, Error::ContractPaused);
        }

        #[ink::test]
        fn fee_split_proportions_are_correct() {
            let fee = 1_000 * UNIT;
            let (staking, treasury, rewards) = split_fee(fee).unwrap();
            assert_eq!(staking + treasury + rewards, fee);
            assert_eq!(staking, 200 * UNIT);
            assert_eq!(treasury, 500 * UNIT);
            assert_eq!(rewards, 300 * UNIT);
        }

        #[ink::test]
        fn fee_split_has_no_dust() {
            for fee in [1u128, 3, 7, 9_999, 10_001, 123_456_789] {
                let (s, t, r) = split_fee(fee).unwrap();
                assert_eq!(s + t + r, fee);
            }
        }

        #[ink::test]
        fn lp_share_math() {
            // 10% of the supply → 10% of each reserve
            assert_eq!(lp_share(50_000 * UNIT, 100, 1_000), Ok(5_000 * UNIT));
            assert_eq!(lp_share(1_000, 1_000, 1_000), Ok(1_000));
            assert_eq!(lp_share(1_000, 1, 0), Err(Error::InvalidPair));
            assert_eq!(lp_share(1_000, 1_001, 1_000), Err(Error::InvalidPair));
            assert_eq!(lp_share(u128::MAX, 2, 2), Err(Error::Overflow));
        }

        #[ink::test]
        fn order_reserves_matches_pair_tokens() {
            let a = default_accounts();
            // lunes = alice, token = frank
            assert_eq!(
                order_reserves(a.alice, a.frank, a.alice, a.frank, 10, 20),
                Ok((10, 20))
            );
            assert_eq!(
                order_reserves(a.alice, a.frank, a.frank, a.alice, 10, 20),
                Ok((20, 10))
            );
            assert_eq!(
                order_reserves(a.alice, a.frank, a.alice, a.bob, 10, 20),
                Err(Error::InvalidPair)
            );
        }

        #[ink::test]
        fn cross_contract_selectors_match_abis() {
            // Selectors from lunes-dex-main/src/abis (Pair.json, Factory.json, WNative.json)
            assert_eq!(SEL_PSP22_TRANSFER, [0xdb, 0x20, 0xf9, 0xf5]);
            assert_eq!(SEL_PSP22_TRANSFER_FROM, [0x54, 0xb3, 0xc7, 0x6e]);
            assert_eq!(SEL_FACTORY_GET_PAIR, [0x33, 0x7d, 0xaf, 0x4f]);
            assert_eq!(SEL_PAIR_GET_RESERVES, [0x8a, 0x0d, 0x11, 0x6f]);
            assert_eq!(SEL_PAIR_TOKEN_0, [0x2e, 0x57, 0x06, 0x87]);
            assert_eq!(SEL_PAIR_TOKEN_1, [0x9d, 0x75, 0x3b, 0xae]);
            assert_eq!(SEL_PAIR_TOTAL_SUPPLY, [0xdb, 0x63, 0x75, 0xa8]);
        }

        #[ink::test]
        fn admin_functions_require_auth() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            assert_eq!(contract.set_paused(true), Err(Error::Unauthorized));
            assert_eq!(
                contract.set_treasury(accounts.eve),
                Err(Error::Unauthorized)
            );
            assert_eq!(
                contract.set_rewards_pool(accounts.eve),
                Err(Error::Unauthorized)
            );
            assert_eq!(
                contract.set_staking_pool(accounts.eve),
                Err(Error::Unauthorized)
            );
            assert_eq!(
                contract.propose_tier_config(1, UNIT, UNIT, MIN_LOCK_MS),
                Err(Error::Unauthorized)
            );
            assert_eq!(contract.cancel_tier_config(1), Err(Error::Unauthorized));
        }

        #[ink::test]
        fn tier_config_change_is_timelocked_and_validated() {
            let mut contract = make_contract(); // caller = alice (admin)

            // Validation: lock below the anti-rug floor, zero fee, bad tier
            assert_eq!(
                contract.propose_tier_config(1, UNIT, UNIT, MIN_LOCK_MS - 1),
                Err(Error::InvalidConfig)
            );
            assert_eq!(
                contract.propose_tier_config(1, 0, UNIT, MIN_LOCK_MS),
                Err(Error::InvalidConfig)
            );
            assert_eq!(
                contract.propose_tier_config(4, UNIT, UNIT, MIN_LOCK_MS),
                Err(Error::InvalidTier)
            );
            assert_eq!(contract.execute_tier_config(1), Err(Error::NoPendingConfig));

            contract
                .propose_tier_config(1, 2 * UNIT, 3 * UNIT, MIN_LOCK_MS)
                .unwrap();
            assert!(contract.get_pending_tier_config(1).is_some());
            assert_eq!(
                contract.execute_tier_config(1),
                Err(Error::TimelockNotExpired)
            );
            // Effective config unchanged until execution
            assert_eq!(contract.tier_config(1).unwrap().listing_fee, 1_000 * UNIT);

            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + DEFAULT_TIMELOCK_DELAY_MS + 1,
            );
            contract.execute_tier_config(1).unwrap();
            let t1 = contract.tier_config(1).unwrap();
            assert_eq!(t1.listing_fee, 2 * UNIT);
            assert_eq!(t1.min_lunes_liq, 3 * UNIT);
            assert_eq!(t1.lock_duration_ms, MIN_LOCK_MS);
            assert!(contract.get_pending_tier_config(1).is_none());
        }

        #[ink::test]
        fn tier_config_proposal_can_be_cancelled() {
            let mut contract = make_contract();
            contract
                .propose_tier_config(2, UNIT, UNIT, MIN_LOCK_MS)
                .unwrap();
            contract.cancel_tier_config(2).unwrap();
            assert_eq!(contract.execute_tier_config(2), Err(Error::NoPendingConfig));
            assert_eq!(contract.cancel_tier_config(2), Err(Error::NoPendingConfig));
        }

        #[ink::test]
        fn staking_pool_can_be_updated() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            assert_eq!(contract.staking_pool(), accounts.eve);
            contract.set_staking_pool(accounts.frank).unwrap();
            assert_eq!(contract.staking_pool(), accounts.frank);
        }

        #[ink::test]
        fn timelock_admin_change() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            contract.propose_admin_change(accounts.bob).unwrap();
            assert_eq!(
                contract.execute_admin_change(),
                Err(Error::TimelockNotExpired)
            );

            test::advance_block::<ink::env::DefaultEnvironment>();
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + DEFAULT_TIMELOCK_DELAY_MS + 1,
            );

            contract.execute_admin_change().unwrap();
            assert_eq!(contract.admin(), accounts.bob);
        }
    }
}
