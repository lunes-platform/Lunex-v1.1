//! # LiquidityLock Contract
//!
//! Receives LP tokens from the ListingManager and locks them for a defined
//! period. Only the original owner can withdraw after the lock expires.
//!
//! Events
//! ------
//! - LiquidityLocked   : emitted on successful lock creation
//! - LiquidityUnlocked : emitted when locked LP tokens are withdrawn

#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![warn(clippy::arithmetic_side_effects)]

#[ink::contract]
mod liquidity_lock {
    use ink::storage::Mapping;
    use scale::{Decode, Encode};

    // ── Types ────────────────────────────────────────────────────────

    pub type LockId = u64;

    #[derive(Debug, Clone, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct LockRecord {
        pub owner:            AccountId,
        pub pair_address:     AccountId,
        pub lp_token:         AccountId,
        pub lp_amount:        Balance,
        pub lunes_amount:     Balance,
        pub token_amount:     Balance,
        pub unlock_timestamp: Timestamp,
        pub tier:             u8,
        pub withdrawn:        bool,
    }

    // ── Storage ──────────────────────────────────────────────────────

    #[ink(storage)]
    pub struct LiquidityLock {
        admin:       AccountId,
        /// Authorised callers that may create locks (ListingManager address)
        manager:     AccountId,
        next_id:     LockId,
        locks:       Mapping<LockId, LockRecord>,
        /// owner → list of their lock IDs (stored as serialised vec via a
        /// counter + separate mapping for gas efficiency)
        owner_count: Mapping<AccountId, u64>,
        owner_lock:  Mapping<(AccountId, u64), LockId>,
    }

    // ── Events ───────────────────────────────────────────────────────

    #[ink(event)]
    pub struct LiquidityLocked {
        #[ink(topic)]
        pub lock_id:          LockId,
        #[ink(topic)]
        pub owner:            AccountId,
        pub pair_address:     AccountId,
        pub lp_amount:        Balance,
        pub unlock_timestamp: Timestamp,
        pub tier:             u8,
    }

    #[ink(event)]
    pub struct ManagerChanged {
        pub old_manager: AccountId,
        pub new_manager: AccountId,
        pub changed_by:  AccountId,
    }

    #[ink(event)]
    pub struct LiquidityUnlocked {
        #[ink(topic)]
        pub lock_id: LockId,
        #[ink(topic)]
        pub owner:   AccountId,
        pub lp_amount: Balance,
    }

    // ── Errors ───────────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, Encode, Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Error {
        Unauthorized,
        LockNotFound,
        LockNotExpired,
        AlreadyWithdrawn,
        ZeroAmount,
        InvalidTier,
        /// Cross-contract PSP22 transfer failed (used by withdraw)
        TransferFailed,
    }

    pub type Result<T> = core::result::Result<T, Error>;

    // ── Implementation ───────────────────────────────────────────────

    impl LiquidityLock {
        #[ink(constructor)]
        pub fn new(manager: AccountId) -> Self {
            Self {
                admin:       Self::env().caller(),
                manager,
                next_id:     0,
                locks:       Mapping::default(),
                owner_count: Mapping::default(),
                owner_lock:  Mapping::default(),
            }
        }

        // ── Admin ─────────────────────────────────────────────────

        #[ink(message)]
        pub fn set_manager(&mut self, new_manager: AccountId) -> Result<()> {
            self.ensure_admin()?;
            let old_manager = self.manager;
            self.manager = new_manager;
            self.env().emit_event(ManagerChanged {
                old_manager,
                new_manager,
                changed_by: self.env().caller(),
            });
            Ok(())
        }

        // ── Core: create lock ─────────────────────────────────────

        /// Called by ListingManager after LP tokens have been transferred here.
        /// `lp_token` is the PSP22 address of the LP pair token.
        #[ink(message)]
        pub fn create_lock(
            &mut self,
            owner:            AccountId,
            pair_address:     AccountId,
            lp_token:         AccountId,
            lp_amount:        Balance,
            lunes_amount:     Balance,
            token_amount:     Balance,
            lock_duration_ms: u64,
            tier:             u8,
        ) -> Result<LockId> {
            self.ensure_manager()?;

            if lp_amount == 0 {
                return Err(Error::ZeroAmount);
            }
            if tier == 0 || tier > 3 {
                return Err(Error::InvalidTier);
            }

            let now            = self.env().block_timestamp();
            let unlock_ts      = now.saturating_add(lock_duration_ms);
            let lock_id        = self.next_id;
            self.next_id       = lock_id.saturating_add(1);

            let record = LockRecord {
                owner,
                pair_address,
                lp_token,
                lp_amount,
                lunes_amount,
                token_amount,
                unlock_timestamp: unlock_ts,
                tier,
                withdrawn: false,
            };

            self.locks.insert(lock_id, &record);

            let idx = self.owner_count.get(owner).unwrap_or(0);
            self.owner_lock.insert((owner, idx), &lock_id);
            self.owner_count.insert(owner, &idx.saturating_add(1));

            self.env().emit_event(LiquidityLocked {
                lock_id,
                owner,
                pair_address,
                lp_amount,
                unlock_timestamp: unlock_ts,
                tier,
            });

            Ok(lock_id)
        }

        // ── Core: withdraw after expiry ───────────────────────────

        #[ink(message)]
        pub fn withdraw(&mut self, lock_id: LockId) -> Result<()> {
            let caller = self.env().caller();
            let mut record = self.locks.get(lock_id).ok_or(Error::LockNotFound)?;

            if record.owner != caller {
                return Err(Error::Unauthorized);
            }
            if record.withdrawn {
                return Err(Error::AlreadyWithdrawn);
            }

            let now = self.env().block_timestamp();
            if now < record.unlock_timestamp {
                return Err(Error::LockNotExpired);
            }

            // Effects: mark withdrawn first so a malicious LP token cannot
            // re-enter via the PSP22 callback and double-withdraw.
            record.withdrawn = true;
            self.locks.insert(lock_id, &record);

            // Interactions: cross-contract PSP22 transfer of the LP tokens
            // back to the owner. The contract holds the LP tokens (received
            // when the ListingManager called create_lock), so this is a
            // direct PSP22::transfer from self → owner.
            //
            // Under unit-test cfg, ink's mock environment cannot route a
            // cross-contract call to a non-deployed account — bypass the
            // call so the lock-state-machine tests don't require a mock
            // PSP22 backend. Production builds always perform the call.
            #[cfg(not(test))]
            if record.lp_amount > 0 {
                let transfer_result = ink::env::call::build_call::<ink::env::DefaultEnvironment>()
                    .call(record.lp_token)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ink::env::call::ExecutionInput::new(ink::env::call::Selector::new(
                            ink::selector_bytes!("PSP22::transfer"),
                        ))
                        .push_arg(caller)
                        .push_arg(record.lp_amount)
                        .push_arg(ink::prelude::vec::Vec::<u8>::new()), // data
                    )
                    .returns::<ink::MessageResult<core::result::Result<(), u8>>>()
                    .try_invoke();

                let transferred = matches!(transfer_result, Ok(Ok(Ok(Ok(())))));
                if !transferred {
                    // Rollback on failure so retry can succeed.
                    record.withdrawn = false;
                    self.locks.insert(lock_id, &record);
                    return Err(Error::TransferFailed);
                }
            }

            self.env().emit_event(LiquidityUnlocked {
                lock_id,
                owner: caller,
                lp_amount: record.lp_amount,
            });

            Ok(())
        }

        // ── Views ─────────────────────────────────────────────────

        #[ink(message)]
        pub fn get_lock(&self, lock_id: LockId) -> Option<LockRecord> {
            self.locks.get(lock_id)
        }

        #[ink(message)]
        pub fn get_owner_lock_count(&self, owner: AccountId) -> u64 {
            self.owner_count.get(owner).unwrap_or(0)
        }

        #[ink(message)]
        pub fn get_owner_lock_id(&self, owner: AccountId, index: u64) -> Option<LockId> {
            self.owner_lock.get((owner, index))
        }

        #[ink(message)]
        pub fn is_locked(&self, lock_id: LockId) -> bool {
            match self.locks.get(lock_id) {
                Some(r) => {
                    !r.withdrawn
                        && self.env().block_timestamp() < r.unlock_timestamp
                }
                None => false,
            }
        }

        #[ink(message)]
        pub fn manager(&self) -> AccountId {
            self.manager
        }

        #[ink(message)]
        pub fn admin(&self) -> AccountId {
            self.admin
        }

        // ── Guards ────────────────────────────────────────────────

        fn ensure_admin(&self) -> Result<()> {
            if self.env().caller() != self.admin {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }

        fn ensure_manager(&self) -> Result<()> {
            if self.env().caller() != self.manager {
                return Err(Error::Unauthorized);
            }
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

        #[ink::test]
        fn create_and_withdraw_lock() {
            let accounts = default_accounts();
            let mut contract = LiquidityLock::new(accounts.alice);

            // alice (manager) creates a lock for bob
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            let lock_id = contract
                .create_lock(
                    accounts.bob,
                    accounts.charlie,
                    accounts.django,
                    1_000,
                    500,
                    500,
                    0, // zero duration — immediately expired for test
                    1,
                )
                .expect("create_lock failed");

            assert_eq!(lock_id, 0);
            assert!(contract.get_lock(0).is_some());

            // bob withdraws — under unit-test cfg, the PSP22 cross-contract
            // call is bypassed (see withdraw()) so the state machine is
            // exercised without a mock token contract. Integration tests
            // on testnet cover the transfer path itself.
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            contract.withdraw(lock_id).expect("withdraw failed");

            let record = contract.get_lock(lock_id).unwrap();
            assert!(record.withdrawn);
        }

        #[ink::test]
        fn non_manager_cannot_create_lock() {
            let accounts = default_accounts();
            let mut contract = LiquidityLock::new(accounts.alice);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            let result = contract.create_lock(
                accounts.bob,
                accounts.charlie,
                accounts.django,
                1_000,
                500,
                500,
                0,
                1,
            );
            assert_eq!(result, Err(Error::Unauthorized));
        }

        #[ink::test]
        fn cannot_withdraw_before_expiry() {
            let accounts = default_accounts();
            let mut contract = LiquidityLock::new(accounts.alice);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            let lock_id = contract
                .create_lock(
                    accounts.bob,
                    accounts.charlie,
                    accounts.django,
                    1_000,
                    500,
                    500,
                    999_999_999, // far future
                    1,
                )
                .unwrap();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            let result = contract.withdraw(lock_id);
            assert_eq!(result, Err(Error::LockNotExpired));
        }

        #[ink::test]
        fn cannot_withdraw_twice() {
            let accounts = default_accounts();
            let mut contract = LiquidityLock::new(accounts.alice);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            let lock_id = contract
                .create_lock(accounts.bob, accounts.charlie, accounts.django, 1_000, 500, 500, 0, 1)
                .unwrap();

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            contract.withdraw(lock_id).unwrap();
            let result = contract.withdraw(lock_id);
            assert_eq!(result, Err(Error::AlreadyWithdrawn));
        }

        #[ink::test]
        fn invalid_tier_rejected() {
            let accounts = default_accounts();
            let mut contract = LiquidityLock::new(accounts.alice);

            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            let result = contract.create_lock(
                accounts.bob, accounts.charlie, accounts.django, 1_000, 500, 500, 0, 0,
            );
            assert_eq!(result, Err(Error::InvalidTier));

            let result2 = contract.create_lock(
                accounts.bob, accounts.charlie, accounts.django, 1_000, 500, 500, 0, 4,
            );
            assert_eq!(result2, Err(Error::InvalidTier));
        }
    }
}
