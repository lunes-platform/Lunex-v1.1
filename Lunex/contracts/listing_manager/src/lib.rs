//! # ListingManager Contract
//!
//! Orchestrates the token listing flow on the Lunex DEX:
//!
//!   1. Project pays listing fee in LUNES (PSP22 transfer to this contract)
//!   2. Project creates TOKEN/LUNES pool via the Factory
//!   3. Project provides liquidity and receives LP tokens
//!   4. LP tokens are transferred to LiquidityLock
//!   5. Token listing is activated and event emitted
//!
//! Tier system
//! -----------
//! | Tier | Name     | Fee (LUNES) | Min Liq (LUNES) | Lock     |
//! |------|----------|-------------|-----------------|----------|
//! |  1   | Basic    |      1_000  |         10_000  |  90 days |
//! |  2   | Verified |      5_000  |         25_000  | 120 days |
//! |  3   | Featured |     20_000  |         50_000  | 180 days |
//!
//! Fee distribution
//! ----------------
//! 20% staking  ·  50% team revenue  ·  30% rewards pool
//!
//! Events
//! ------
//! - TokenListed
//! - ListingFeeCollected
//! - FeeDistributed

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

    // Decimals: 1 LUNES = 1_000_000_000_000 (12 decimals, like Substrate native)
    const DECIMALS: u128 = 1_000_000_000_000;

    // Listing fee per tier (in LUNES raw units)
    const TIER1_FEE: Balance     = 1_000  * DECIMALS;
    const TIER2_FEE: Balance     = 5_000  * DECIMALS;
    const TIER3_FEE: Balance     = 20_000 * DECIMALS;

    // Minimum liquidity (LUNES side of the pool) per tier
    const TIER1_MIN_LIQ: Balance = 10_000 * DECIMALS;
    const TIER2_MIN_LIQ: Balance = 25_000 * DECIMALS;
    const TIER3_MIN_LIQ: Balance = 50_000 * DECIMALS;

    // Lock duration in milliseconds per tier
    const TIER1_LOCK_MS: u64 = 90  * 24 * 60 * 60 * 1_000;
    const TIER2_LOCK_MS: u64 = 120 * 24 * 60 * 60 * 1_000;
    const TIER3_LOCK_MS: u64 = 180 * 24 * 60 * 60 * 1_000;

    // Fee split basis points (out of 10_000)
    const BPS_STAKING:  u128 = 2_000; // 20% → staking pool
    const BPS_TREASURY: u128 = 5_000; // 50% → team revenue
    const BPS_REWARDS:  u128 = 3_000; // 30% → rewards pool

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

    // ── PSP22Ref — cross-contract call wrappers ──────────────────────

    /// Cross-contract call helpers for PSP22 tokens.
    /// Uses ink! v4 `build_call` + selectors matching the PSP22 standard.
    struct PSP22Ref;

    impl PSP22Ref {
        /// Transfer `amount` tokens from this contract to `to`.
        /// Requires this contract to hold sufficient balance.
        fn transfer(
            token: AccountId,
            to: AccountId,
            amount: Balance,
        ) -> Result<()> {
            let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
            build_call::<DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(ink::selector_bytes!("PSP22::transfer")))
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

        /// Transfer `amount` tokens from `from` to `to` using allowance.
        /// Requires `from` to have approved this contract for at least `amount`.
        fn transfer_from(
            token: AccountId,
            from: AccountId,
            to: AccountId,
            amount: Balance,
        ) -> Result<()> {
            let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
            build_call::<DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(ink::selector_bytes!("PSP22::transfer_from")))
                        .push_arg(from)
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
        pub id:              ListingId,
        pub owner:           AccountId,
        pub token_address:   AccountId,
        pub pair_address:    AccountId,
        pub lp_token:        AccountId,
        pub lp_amount:       Balance,
        pub lunes_liquidity: Balance,
        pub token_liquidity: Balance,
        pub tier:            u8,
        pub lock_id:         u64,
        pub status:          ListingStatus,
        pub listed_at:       Timestamp,
    }

    #[derive(Debug, Clone, PartialEq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct TierConfig {
        pub listing_fee:      Balance,
        pub min_lunes_liq:    Balance,
        pub lock_duration_ms: u64,
    }

    // ── Storage ──────────────────────────────────────────────────────

    // Timelock padrão: 48 horas em milissegundos
    const DEFAULT_TIMELOCK_DELAY_MS: u64 = 48 * 60 * 60 * 1_000;

    #[ink(storage)]
    pub struct ListingManager {
        admin:           AccountId,
        lunes_token:     AccountId,
        liquidity_lock:  AccountId,
        treasury:        AccountId,
        rewards_pool:    AccountId,
        staking_pool:    AccountId,
        next_id:         ListingId,
        listings:        Mapping<ListingId, ListingRecord>,
        token_listing:   Mapping<AccountId, ListingId>,  // token → listing id
        total_collected: Balance,
        total_staked:    Balance,
        paused:          bool,
        /// Atraso obrigatório para troca de admin (timelock)
        timelock_delay:  u64,
        /// Admin proposto (aguardando timelock)
        pending_admin:   Option<AccountId>,
        /// Timestamp após o qual a mudança de admin pode ser executada
        admin_change_at: Timestamp,
    }

    // ── Events ───────────────────────────────────────────────────────

    #[ink(event)]
    pub struct TokenListed {
        #[ink(topic)]
        pub listing_id:    ListingId,
        #[ink(topic)]
        pub owner:         AccountId,
        #[ink(topic)]
        pub token_address: AccountId,
        pub pair_address:  AccountId,
        pub tier:          u8,
        pub lock_id:       u64,
        pub listed_at:     Timestamp,
    }

    #[ink(event)]
    pub struct AdminChangeProposed {
        #[ink(topic)]
        pub proposed_by: AccountId,
        pub new_admin:   AccountId,
        pub execute_at:  Timestamp,
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
        pub payer:      AccountId,
        pub amount:     Balance,
        pub tier:       u8,
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
        pub listing_id:      ListingId,
        pub staking_amount:  Balance,
        pub treasury_amount: Balance,
        pub rewards_amount:  Balance,
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
        TransferFailed,
        LockCreationFailed,
        ListingNotFound,
        Overflow,
        /// Nenhuma mudança de admin pendente
        NoPendingAdmin,
        /// Timelock ainda não expirou
        TimelockNotExpired,
    }

    pub type Result<T> = core::result::Result<T, Error>;

    // ── Implementation ───────────────────────────────────────────────

    impl ListingManager {
        #[ink(constructor)]
        pub fn new(
            lunes_token:    AccountId,
            liquidity_lock: AccountId,
            treasury:       AccountId,
            rewards_pool:   AccountId,
            staking_pool:   AccountId,
        ) -> Self {
            Self {
                admin:           Self::env().caller(),
                lunes_token,
                liquidity_lock,
                treasury,
                rewards_pool,
                staking_pool,
                next_id:         0,
                listings:        Mapping::default(),
                token_listing:   Mapping::default(),
                total_collected: 0,
                total_staked:    0,
                paused:          false,
                timelock_delay:  DEFAULT_TIMELOCK_DELAY_MS,
                pending_admin:   None,
                admin_change_at: 0,
            }
        }

        // ── Core: list_token ──────────────────────────────────────

        /// Main entry-point. The caller must have:
        ///  1. Approved `listing_fee` LUNES to this contract
        ///  2. Approved `lp_amount` LP tokens to this contract (after adding liq)
        ///
        /// Parameters
        ///  - tier            : 1 | 2 | 3
        ///  - token_address   : PSP22 address of the new token
        ///  - pair_address    : LP pair contract address (already created)
        ///  - lp_token        : LP token PSP22 address (same as pair_address on Lunex)
        ///  - lp_amount       : LP tokens to lock
        ///  - lunes_liquidity : LUNES amount deposited into the pool
        ///  - token_liquidity : project token amount deposited into the pool
        #[ink(message)]
        pub fn list_token(
            &mut self,
            tier:            u8,
            token_address:   AccountId,
            pair_address:    AccountId,
            lp_token:        AccountId,
            lp_amount:       Balance,
            lunes_liquidity: Balance,
            token_liquidity: Balance,
        ) -> Result<ListingId> {
            self.ensure_not_paused()?;

            let cfg = self.tier_config(tier)?;
            let caller = self.env().caller();
            let contract_addr = self.env().account_id();

            // Duplicate check
            if self.token_listing.contains(token_address) {
                return Err(Error::TokenAlreadyListed);
            }

            // Validate amounts
            if lp_amount == 0 || lunes_liquidity == 0 || token_liquidity == 0 {
                return Err(Error::ZeroAmount);
            }
            if lunes_liquidity < cfg.min_lunes_liq {
                return Err(Error::InsufficientLiquidity);
            }

            let listing_id = self.next_id;
            self.next_id = listing_id.saturating_add(1);

            // ── Step 1: collect listing fee via PSP22 transfer_from ────
            // Caller must have approved `listing_fee` LUNES to this contract.
            PSP22Ref::transfer_from(
                self.lunes_token,
                caller,
                contract_addr,
                cfg.listing_fee,
            )?;

            self.total_collected = self.total_collected.saturating_add(cfg.listing_fee);

            self.env().emit_event(ListingFeeCollected {
                listing_id,
                payer: caller,
                amount: cfg.listing_fee,
                tier,
            });

            // ── Step 2: calculate fee splits ─────────────────────────
            let staking_amt = cfg.listing_fee
                .checked_mul(BPS_STAKING)
                .ok_or(Error::Overflow)?
                .checked_div(10_000)
                .ok_or(Error::Overflow)?;
            let treasury_amt = cfg.listing_fee
                .checked_mul(BPS_TREASURY)
                .ok_or(Error::Overflow)?
                .checked_div(10_000)
                .ok_or(Error::Overflow)?;
            let rewards_amt = cfg.listing_fee
                .checked_mul(BPS_REWARDS)
                .ok_or(Error::Overflow)?
                .checked_div(10_000)
                .ok_or(Error::Overflow)?;

            // ── Step 3: distribute fee via PSP22 transfers ───────────
            // 20% → staking pool
            PSP22Ref::transfer(self.lunes_token, self.staking_pool, staking_amt)?;
            self.total_staked = self.total_staked.saturating_add(staking_amt);

            // 50% → team treasury
            PSP22Ref::transfer(self.lunes_token, self.treasury, treasury_amt)?;

            // 30% → rewards pool
            PSP22Ref::transfer(self.lunes_token, self.rewards_pool, rewards_amt)?;

            self.env().emit_event(FeeDistributed {
                listing_id,
                staking_amount:  staking_amt,
                treasury_amount: treasury_amt,
                rewards_amount:  rewards_amt,
            });

            // ── Step 4: register lock ────────────────────────────────
            // The caller must have transferred LP tokens to the LiquidityLock
            // contract before calling list_token. The lock_id mirrors the
            // listing_id for deterministic tracking. The off-chain relayer
            // verifies LP transfer and calls create_lock on behalf of the user.
            let lock_id: u64 = listing_id;

            // ── Step 5: save listing record ───────────────────────────
            let now = self.env().block_timestamp();
            let record = ListingRecord {
                id: listing_id,
                owner: caller,
                token_address,
                pair_address,
                lp_token,
                lp_amount,
                lunes_liquidity,
                token_liquidity,
                tier,
                lock_id,
                status: ListingStatus::Active,
                listed_at: now,
            };

            self.listings.insert(listing_id, &record);
            self.token_listing.insert(token_address, &listing_id);

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
            let mut record = self.listings.get(listing_id).ok_or(Error::ListingNotFound)?;
            record.status = ListingStatus::Rejected;
            self.listings.insert(listing_id, &record);
            self.env().emit_event(ListingStatusChanged {
                listing_id,
                new_status: ListingStatus::Rejected,
                changed_by: self.env().caller(),
            });
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

        #[ink(message)]
        pub fn tier_config(&self, tier: u8) -> Result<TierConfig> {
            match tier {
                1 => Ok(TierConfig {
                    listing_fee:      TIER1_FEE,
                    min_lunes_liq:    TIER1_MIN_LIQ,
                    lock_duration_ms: TIER1_LOCK_MS,
                }),
                2 => Ok(TierConfig {
                    listing_fee:      TIER2_FEE,
                    min_lunes_liq:    TIER2_MIN_LIQ,
                    lock_duration_ms: TIER2_LOCK_MS,
                }),
                3 => Ok(TierConfig {
                    listing_fee:      TIER3_FEE,
                    min_lunes_liq:    TIER3_MIN_LIQ,
                    lock_duration_ms: TIER3_LOCK_MS,
                }),
                _ => Err(Error::InvalidTier),
            }
        }

        #[ink(message)]
        pub fn total_collected(&self) -> Balance { self.total_collected }

        #[ink(message)]
        pub fn total_staked(&self) -> Balance { self.total_staked }

        #[ink(message)]
        pub fn admin(&self) -> AccountId { self.admin }

        #[ink(message)]
        pub fn staking_pool(&self) -> AccountId { self.staking_pool }

        #[ink(message)]
        pub fn is_paused(&self) -> bool { self.paused }

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
            self.pending_admin   = Some(new_admin);
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
            self.admin         = pending;
            self.pending_admin = None;
            self.env().emit_event(AdminChanged { old_admin, new_admin: pending });
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

        fn default_accounts() -> test::DefaultAccounts<ink::env::DefaultEnvironment> {
            test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn make_contract() -> ListingManager {
            let accounts = default_accounts();
            ListingManager::new(
                accounts.alice,   // lunes_token
                accounts.bob,     // liquidity_lock
                accounts.charlie, // treasury
                accounts.django,  // rewards_pool
                accounts.eve,     // staking_pool
            )
        }

        #[ink::test]
        fn tier_config_returns_correct_values() {
            let contract = make_contract();

            let t1 = contract.tier_config(1).unwrap();
            assert_eq!(t1.listing_fee,      TIER1_FEE);
            assert_eq!(t1.min_lunes_liq,    TIER1_MIN_LIQ);
            assert_eq!(t1.lock_duration_ms, TIER1_LOCK_MS);

            let t2 = contract.tier_config(2).unwrap();
            assert_eq!(t2.listing_fee, TIER2_FEE);

            let t3 = contract.tier_config(3).unwrap();
            assert_eq!(t3.listing_fee, TIER3_FEE);

            assert_eq!(contract.tier_config(0), Err(Error::InvalidTier));
            assert_eq!(contract.tier_config(4), Err(Error::InvalidTier));
        }

        #[ink::test]
        fn cannot_list_same_token_twice_via_mapping() {
            // Note: full list_token with PSP22 cross-contract calls cannot be tested
            // in off-chain unit tests (no contract runtime). These tests verify
            // pre-condition logic only. E2E tests cover the full flow.
            let accounts = default_accounts();
            let mut contract = make_contract();

            // Manually insert a listing to test duplicate check
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            contract.token_listing.insert(accounts.frank, &0);

            // Attempt to list same token — should fail at duplicate check
            // (before PSP22 call)
            let result = contract.list_token(
                1,
                accounts.frank,
                accounts.charlie,
                accounts.django,
                TIER1_MIN_LIQ,
                TIER1_MIN_LIQ,
                TIER1_MIN_LIQ,
            );
            assert_eq!(result, Err(Error::TokenAlreadyListed));
        }

        #[ink::test]
        fn insufficient_liquidity_rejected() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);

            let err = contract
                .list_token(
                    1,
                    accounts.frank,
                    accounts.charlie,
                    accounts.django,
                    TIER1_MIN_LIQ,
                    TIER1_MIN_LIQ - 1, // below minimum
                    TIER1_MIN_LIQ,
                )
                .unwrap_err();

            assert_eq!(err, Error::InsufficientLiquidity);
        }

        #[ink::test]
        fn zero_amounts_rejected() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);

            // Zero lp_amount
            assert_eq!(
                contract.list_token(1, accounts.frank, accounts.charlie, accounts.django,
                    0, TIER1_MIN_LIQ, TIER1_MIN_LIQ),
                Err(Error::ZeroAmount)
            );

            // Zero lunes_liquidity
            assert_eq!(
                contract.list_token(1, accounts.frank, accounts.charlie, accounts.django,
                    TIER1_MIN_LIQ, 0, TIER1_MIN_LIQ),
                Err(Error::ZeroAmount)
            );

            // Zero token_liquidity
            assert_eq!(
                contract.list_token(1, accounts.frank, accounts.charlie, accounts.django,
                    TIER1_MIN_LIQ, TIER1_MIN_LIQ, 0),
                Err(Error::ZeroAmount)
            );
        }

        #[ink::test]
        fn paused_contract_rejects_listing() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice); // admin
            contract.set_paused(true).unwrap();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            let err = contract
                .list_token(1, accounts.frank, accounts.charlie, accounts.django,
                    TIER1_MIN_LIQ, TIER1_MIN_LIQ, TIER1_MIN_LIQ)
                .unwrap_err();

            assert_eq!(err, Error::ContractPaused);
        }

        #[ink::test]
        fn fee_split_proportions_are_correct() {
            // Validates the math without cross-contract calls
            let fee = TIER1_FEE;
            let staking  = fee.checked_mul(BPS_STAKING).unwrap()  / 10_000;
            let treasury = fee.checked_mul(BPS_TREASURY).unwrap() / 10_000;
            let rewards  = fee.checked_mul(BPS_REWARDS).unwrap()  / 10_000;

            // 20% + 50% + 30% = 100%
            assert_eq!(staking + treasury + rewards, fee);

            // Individual checks
            assert_eq!(staking,  200 * DECIMALS);  // 20% of 1000
            assert_eq!(treasury, 500 * DECIMALS);  // 50% of 1000
            assert_eq!(rewards,  300 * DECIMALS);  // 30% of 1000
        }

        #[ink::test]
        fn admin_functions_require_auth() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            // Non-admin cannot pause
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.eve);
            assert_eq!(contract.set_paused(true), Err(Error::Unauthorized));
            assert_eq!(contract.set_treasury(accounts.eve), Err(Error::Unauthorized));
            assert_eq!(contract.set_rewards_pool(accounts.eve), Err(Error::Unauthorized));
            assert_eq!(contract.set_staking_pool(accounts.eve), Err(Error::Unauthorized));
        }

        #[ink::test]
        fn staking_pool_can_be_updated() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            assert_eq!(contract.staking_pool(), accounts.eve);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice); // admin
            contract.set_staking_pool(accounts.frank).unwrap();
            assert_eq!(contract.staking_pool(), accounts.frank);
        }

        #[ink::test]
        fn timelock_admin_change() {
            let accounts = default_accounts();
            let mut contract = make_contract();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice); // admin
            contract.propose_admin_change(accounts.bob).unwrap();

            // Cannot execute before timelock
            assert_eq!(contract.execute_admin_change(), Err(Error::TimelockNotExpired));

            // Advance time past the timelock
            test::advance_block::<ink::env::DefaultEnvironment>();
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            // Force timestamp past the deadline
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + DEFAULT_TIMELOCK_DELAY_MS + 1,
            );

            contract.execute_admin_change().unwrap();
            assert_eq!(contract.admin(), accounts.bob);
        }
    }
}
