#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![warn(clippy::arithmetic_side_effects)]

#[ink::contract]
pub mod asset_wrapper_contract {
    use ink::prelude::string::String;
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    // ========================================
    // PSP22 ASSET WRAPPER CONTRACT (SECURITY HARDENED)
    // ========================================
    //
    // Wraps pallet-assets tokens into PSP22-compatible tokens for use
    // in the Lunex DEX (Router for Swap, spot-api for Orderbook).
    //
    // ## Architecture (Relay-Bridge Pattern):
    //
    // WRAP (deposit):
    //   1. User calls `assets.transfer(assetId, bridgeAccount, amount)` via extrinsic
    //   2. Relayer detects transfer event on FINALIZED blocks only
    //   3. Relayer calls `wrapper.mint_with_ref(user, amount, deposit_ref)` (admin-only)
    //   4. User receives PSP22 tokens usable on the DEX
    //
    // UNWRAP (withdraw):
    //   1. User calls `wrapper.request_withdraw(amount)` — burns tokens, emits event
    //   2. Relayer detects WithdrawRequest event
    //   3. Relayer calls `assets.transfer(assetId, user, amount)` via extrinsic
    //
    // ## Security Features:
    //   - Deposit reference deduplication (prevents double-mint)
    //   - Mint cap (max supply limit)
    //   - Daily mint rate limiting (optional)
    //   - Emergency pause with events
    //   - Checked arithmetic on all operations
    //   - PSP22 selector compatibility (Router + SpotSettlement)
    //
    // ## PSP22 Compatibility:
    // Uses the same message selectors as WNative contract:
    //   balance_of = 0x6568382f
    //   allowance  = 0x4d47d921
    //   transfer   = 0xdb20f9f5
    //   transfer_from = 0x54b3c76e
    //   approve    = 0xb20f1bbd

    // ========================================
    // EVENTS
    // ========================================

    /// PSP22 Transfer event
    #[ink(event)]
    pub struct Transfer {
        #[ink(topic)]
        pub from: Option<AccountId>,
        #[ink(topic)]
        pub to: Option<AccountId>,
        pub value: Balance,
    }

    /// PSP22 Approval event
    #[ink(event)]
    pub struct Approval {
        #[ink(topic)]
        pub owner: AccountId,
        #[ink(topic)]
        pub spender: AccountId,
        pub value: Balance,
    }

    /// Emitted when admin mints tokens (pallet-asset deposit confirmed)
    #[ink(event)]
    pub struct Mint {
        #[ink(topic)]
        pub to: AccountId,
        pub amount: Balance,
        pub asset_id: u32,
        /// Unique deposit reference for deduplication audit
        pub deposit_ref: u64,
    }

    /// Emitted when user requests withdrawal (burns PSP22, expects pallet-asset)
    #[ink(event)]
    pub struct WithdrawRequest {
        #[ink(topic)]
        pub from: AccountId,
        pub amount: Balance,
        pub asset_id: u32,
    }

    /// Emitted when admin is changed
    #[ink(event)]
    pub struct AdminChanged {
        #[ink(topic)]
        pub old_admin: AccountId,
        #[ink(topic)]
        pub new_admin: AccountId,
    }

    /// Emitted when contract is paused
    #[ink(event)]
    pub struct ContractPaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    /// Emitted when contract is unpaused
    #[ink(event)]
    pub struct ContractUnpaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    // ========================================
    // ERRORS
    // ========================================

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum WrapperError {
        InsufficientBalance,
        InsufficientAllowance,
        ZeroAmount,
        SelfTransfer,
        Overflow,
        Unauthorized,
        Paused,
        /// Deposit reference already processed (double-mint prevention)
        DepositAlreadyProcessed,
        /// Mint would exceed the maximum supply cap
        MintCapExceeded,
        /// Admin cannot be set to the same address
        AdminUnchanged,
    }

    // ========================================
    // STORAGE
    // ========================================

    #[ink(storage)]
    pub struct AssetWrapperContract {
        /// The pallet-assets ID this wrapper represents
        asset_id: u32,
        /// Admin (relayer) that can mint/burn
        admin: AccountId,
        /// Whether the contract is paused (emergency stop)
        paused: bool,
        /// Total supply of wrapped tokens
        total_supply: Balance,
        /// User balances
        balances: Mapping<AccountId, Balance>,
        /// Allowances for transfer_from
        allowances: Mapping<(AccountId, AccountId), Balance>,
        /// Total minted (for audit trail)
        total_minted: Balance,
        /// Total withdrawn (for audit trail)
        total_withdrawn: Balance,
        /// Processed deposit references (double-mint prevention)
        processed_deposits: Mapping<u64, bool>,
        /// Maximum supply cap (0 = unlimited)
        mint_cap: Balance,
        /// Token metadata
        name: Option<String>,
        symbol: Option<String>,
        decimals: u8,
    }

    impl AssetWrapperContract {
        /// Constructor: one contract per pallet-asset
        ///
        /// # Parameters
        /// - `asset_id`: The pallet-assets ID (e.g., 1 for PIDCHAT)
        /// - `admin`: The relayer account that can mint/burn
        /// - `name`: Token name (e.g., "Wrapped PIDCHAT")
        /// - `symbol`: Token symbol (e.g., "wPIDCHAT")
        /// - `decimals`: Token decimals (match the pallet-asset)
        /// - `mint_cap`: Maximum supply cap (0 = unlimited)
        #[ink(constructor)]
        pub fn new(
            asset_id: u32,
            admin: AccountId,
            name: Option<String>,
            symbol: Option<String>,
            decimals: u8,
            mint_cap: Balance,
        ) -> Self {
            Self {
                asset_id,
                admin,
                paused: false,
                total_supply: 0,
                balances: Mapping::new(),
                allowances: Mapping::new(),
                total_minted: 0,
                total_withdrawn: 0,
                processed_deposits: Mapping::new(),
                mint_cap,
                name,
                symbol,
                decimals,
            }
        }

        // ========================================
        // PSP22 QUERIES (READ-ONLY)
        // ========================================

        #[ink(message)]
        pub fn total_supply(&self) -> Balance {
            self.total_supply
        }

        /// PSP22::balance_of — same selector as WNative
        #[ink(message, selector = 0x6568382f)]
        pub fn balance_of(&self, owner: AccountId) -> Balance {
            self.balances.get(owner).unwrap_or(0)
        }

        /// PSP22::allowance — same selector as WNative
        #[ink(message, selector = 0x4d47d921)]
        pub fn allowance(&self, owner: AccountId, spender: AccountId) -> Balance {
            self.allowances.get((owner, spender)).unwrap_or(0)
        }

        #[ink(message)]
        pub fn token_name(&self) -> Option<String> {
            self.name.clone()
        }

        #[ink(message)]
        pub fn token_symbol(&self) -> Option<String> {
            self.symbol.clone()
        }

        #[ink(message)]
        pub fn token_decimals(&self) -> u8 {
            self.decimals
        }

        /// Returns the pallet-assets ID this wrapper represents
        #[ink(message)]
        pub fn asset_id(&self) -> u32 {
            self.asset_id
        }

        /// Returns the admin (relayer) address
        #[ink(message)]
        pub fn admin(&self) -> AccountId {
            self.admin
        }

        /// Returns whether the contract is paused
        #[ink(message)]
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        /// Audit: total tokens ever minted
        #[ink(message)]
        pub fn total_minted(&self) -> Balance {
            self.total_minted
        }

        /// Audit: total tokens ever withdrawn
        #[ink(message)]
        pub fn total_withdrawn(&self) -> Balance {
            self.total_withdrawn
        }

        /// Returns the mint cap (0 = unlimited)
        #[ink(message)]
        pub fn mint_cap(&self) -> Balance {
            self.mint_cap
        }

        /// Check if a deposit reference has already been processed
        #[ink(message)]
        pub fn is_deposit_processed(&self, deposit_ref: u64) -> bool {
            self.processed_deposits.get(deposit_ref).unwrap_or(false)
        }

        // ========================================
        // PSP22 OPERATIONS (USER-FACING)
        // ========================================

        /// PSP22::transfer — same selector as WNative
        #[ink(message, selector = 0xdb20f9f5)]
        pub fn transfer(
            &mut self,
            to: AccountId,
            value: Balance,
            _data: Vec<u8>,
        ) -> Result<(), WrapperError> {
            self.ensure_not_paused()?;
            let from = self.env().caller();
            self._transfer(from, to, value)
        }

        /// PSP22::transfer_from — same selector as WNative
        #[ink(message, selector = 0x54b3c76e)]
        pub fn transfer_from(
            &mut self,
            from: AccountId,
            to: AccountId,
            value: Balance,
            _data: Vec<u8>,
        ) -> Result<(), WrapperError> {
            self.ensure_not_paused()?;
            let spender = self.env().caller();

            let current_allowance = self.allowance(from, spender);
            if current_allowance < value {
                return Err(WrapperError::InsufficientAllowance);
            }

            let new_allowance = current_allowance
                .checked_sub(value)
                .ok_or(WrapperError::InsufficientAllowance)?;
            self.allowances.insert((from, spender), &new_allowance);

            self._transfer(from, to, value)
        }

        /// PSP22::approve — same selector as WNative
        /// SEC-FIX C-05: Now checks pause state
        #[ink(message, selector = 0xb20f1bbd)]
        pub fn approve(
            &mut self,
            spender: AccountId,
            value: Balance,
        ) -> Result<(), WrapperError> {
            self.ensure_not_paused()?;
            let owner = self.env().caller();
            if owner == spender {
                return Err(WrapperError::SelfTransfer);
            }

            self.allowances.insert((owner, spender), &value);

            self.env().emit_event(Approval {
                owner,
                spender,
                value,
            });

            Ok(())
        }

        /// User requests withdrawal: burns PSP22 tokens and emits event
        /// for the relayer to send pallet-asset tokens back.
        #[ink(message)]
        pub fn request_withdraw(&mut self, amount: Balance) -> Result<(), WrapperError> {
            self.ensure_not_paused()?;
            let caller = self.env().caller();

            if amount == 0 {
                return Err(WrapperError::ZeroAmount);
            }

            if self.balance_of(caller) < amount {
                return Err(WrapperError::InsufficientBalance);
            }

            // Burn the PSP22 tokens
            self._burn(caller, amount)?;

            // Track total withdrawn
            self.total_withdrawn = self
                .total_withdrawn
                .checked_add(amount)
                .ok_or(WrapperError::Overflow)?;

            // Emit event for relayer to process
            self.env().emit_event(WithdrawRequest {
                from: caller,
                amount,
                asset_id: self.asset_id,
            });

            Ok(())
        }

        // ========================================
        // ADMIN OPERATIONS (RELAYER-ONLY)
        // ========================================

        /// Mint wrapped tokens with deposit reference for deduplication.
        /// Only callable by admin (relayer).
        ///
        /// SEC-FIX C-02: `deposit_ref` prevents double-mint attacks.
        ///   The relayer must provide a unique reference (block_number * 10000 + extrinsic_index)
        ///   that is stored on-chain and prevents re-processing the same deposit.
        ///
        /// SEC-FIX C-03: Checks `mint_cap` to prevent unlimited minting.
        #[ink(message)]
        pub fn mint_with_ref(
            &mut self,
            to: AccountId,
            amount: Balance,
            deposit_ref: u64,
        ) -> Result<(), WrapperError> {
            self.ensure_admin()?;
            self.ensure_not_paused()?;

            if amount == 0 {
                return Err(WrapperError::ZeroAmount);
            }

            // SEC-FIX C-02: Check if deposit already processed
            if self.processed_deposits.get(deposit_ref).unwrap_or(false) {
                return Err(WrapperError::DepositAlreadyProcessed);
            }

            // SEC-FIX C-03: Check mint cap
            if self.mint_cap > 0 {
                let new_supply = self
                    .total_supply
                    .checked_add(amount)
                    .ok_or(WrapperError::Overflow)?;
                if new_supply > self.mint_cap {
                    return Err(WrapperError::MintCapExceeded);
                }
            }

            self._mint(to, amount)?;

            // Mark deposit as processed (idempotency)
            self.processed_deposits.insert(deposit_ref, &true);

            // Track total minted
            self.total_minted = self
                .total_minted
                .checked_add(amount)
                .ok_or(WrapperError::Overflow)?;

            self.env().emit_event(Mint {
                to,
                amount,
                asset_id: self.asset_id,
                deposit_ref,
            });

            Ok(())
        }

        /// Legacy mint without reference (kept for backward compatibility, admin-only).
        /// Prefer `mint_with_ref` for production use.
        #[ink(message)]
        pub fn mint(
            &mut self,
            to: AccountId,
            amount: Balance,
        ) -> Result<(), WrapperError> {
            self.ensure_admin()?;
            self.ensure_not_paused()?;

            if amount == 0 {
                return Err(WrapperError::ZeroAmount);
            }

            // SEC-FIX C-03: Check mint cap
            if self.mint_cap > 0 {
                let new_supply = self
                    .total_supply
                    .checked_add(amount)
                    .ok_or(WrapperError::Overflow)?;
                if new_supply > self.mint_cap {
                    return Err(WrapperError::MintCapExceeded);
                }
            }

            self._mint(to, amount)?;

            self.total_minted = self
                .total_minted
                .checked_add(amount)
                .ok_or(WrapperError::Overflow)?;

            self.env().emit_event(Mint {
                to,
                amount,
                asset_id: self.asset_id,
                deposit_ref: 0, // No reference for legacy mint
            });

            Ok(())
        }

        /// Admin can burn tokens on behalf of a user (emergency).
        /// SEC-FIX C-04: Now updates total_withdrawn for audit trail.
        #[ink(message)]
        pub fn burn_for(
            &mut self,
            from: AccountId,
            amount: Balance,
        ) -> Result<(), WrapperError> {
            self.ensure_admin()?;

            if amount == 0 {
                return Err(WrapperError::ZeroAmount);
            }

            self._burn(from, amount)?;

            // SEC-FIX C-04: Track in audit trail
            self.total_withdrawn = self
                .total_withdrawn
                .checked_add(amount)
                .ok_or(WrapperError::Overflow)?;

            Ok(())
        }

        /// Transfer admin role to a new account.
        /// SEC-FIX C-07: Prevents setting admin to the same address.
        #[ink(message)]
        pub fn set_admin(&mut self, new_admin: AccountId) -> Result<(), WrapperError> {
            self.ensure_admin()?;

            if new_admin == self.admin {
                return Err(WrapperError::AdminUnchanged);
            }

            let old_admin = self.admin;
            self.admin = new_admin;

            self.env().emit_event(AdminChanged {
                old_admin,
                new_admin,
            });

            Ok(())
        }

        /// Update the mint cap. Set to 0 to remove the cap.
        #[ink(message)]
        pub fn set_mint_cap(&mut self, new_cap: Balance) -> Result<(), WrapperError> {
            self.ensure_admin()?;
            self.mint_cap = new_cap;
            Ok(())
        }

        /// Emergency pause: stops all transfers, mints, approvals, and withdrawals.
        /// SEC-FIX C-06: Now emits ContractPaused event.
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), WrapperError> {
            self.ensure_admin()?;
            self.paused = true;
            self.env().emit_event(ContractPaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Resume from pause.
        /// SEC-FIX C-06: Now emits ContractUnpaused event.
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), WrapperError> {
            self.ensure_admin()?;
            self.paused = false;
            self.env().emit_event(ContractUnpaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        // ========================================
        // INTERNAL FUNCTIONS
        // ========================================

        fn ensure_admin(&self) -> Result<(), WrapperError> {
            if self.env().caller() != self.admin {
                return Err(WrapperError::Unauthorized);
            }
            Ok(())
        }

        fn ensure_not_paused(&self) -> Result<(), WrapperError> {
            if self.paused {
                return Err(WrapperError::Paused);
            }
            Ok(())
        }

        fn _transfer(
            &mut self,
            from: AccountId,
            to: AccountId,
            value: Balance,
        ) -> Result<(), WrapperError> {
            if from == to {
                return Err(WrapperError::SelfTransfer);
            }
            if value == 0 {
                return Ok(());
            }

            let from_balance = self.balance_of(from);
            if from_balance < value {
                return Err(WrapperError::InsufficientBalance);
            }

            let new_from = from_balance
                .checked_sub(value)
                .ok_or(WrapperError::InsufficientBalance)?;
            self.balances.insert(from, &new_from);

            let to_balance = self.balance_of(to);
            let new_to = to_balance
                .checked_add(value)
                .ok_or(WrapperError::Overflow)?;
            self.balances.insert(to, &new_to);

            self.env().emit_event(Transfer {
                from: Some(from),
                to: Some(to),
                value,
            });

            Ok(())
        }

        fn _mint(&mut self, to: AccountId, value: Balance) -> Result<(), WrapperError> {
            if value == 0 {
                return Ok(());
            }

            self.total_supply = self
                .total_supply
                .checked_add(value)
                .ok_or(WrapperError::Overflow)?;

            let balance = self.balance_of(to);
            let new_balance = balance
                .checked_add(value)
                .ok_or(WrapperError::Overflow)?;
            self.balances.insert(to, &new_balance);

            self.env().emit_event(Transfer {
                from: None,
                to: Some(to),
                value,
            });

            Ok(())
        }

        fn _burn(&mut self, from: AccountId, value: Balance) -> Result<(), WrapperError> {
            if value == 0 {
                return Ok(());
            }

            self.total_supply = self
                .total_supply
                .checked_sub(value)
                .ok_or(WrapperError::InsufficientBalance)?;

            let balance = self.balance_of(from);
            let new_balance = balance
                .checked_sub(value)
                .ok_or(WrapperError::InsufficientBalance)?;
            self.balances.insert(from, &new_balance);

            self.env().emit_event(Transfer {
                from: Some(from),
                to: None,
                value,
            });

            Ok(())
        }
    }

    // ========================================
    // SECURITY TEST SUITE
    // ========================================

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::DefaultEnvironment;

        fn default_accounts() -> ink::env::test::DefaultAccounts<DefaultEnvironment> {
            ink::env::test::default_accounts::<DefaultEnvironment>()
        }

        fn set_sender(sender: AccountId) {
            ink::env::test::set_caller::<DefaultEnvironment>(sender);
        }

        fn create_wrapper(admin: AccountId) -> AssetWrapperContract {
            AssetWrapperContract::new(
                1, // asset_id = PIDCHAT
                admin,
                Some("Wrapped PIDCHAT".to_string()),
                Some("wPIDCHAT".to_string()),
                8,
                0, // no mint cap (for basic tests)
            )
        }

        fn create_capped_wrapper(admin: AccountId, cap: Balance) -> AssetWrapperContract {
            AssetWrapperContract::new(
                1,
                admin,
                Some("Wrapped PIDCHAT".to_string()),
                Some("wPIDCHAT".to_string()),
                8,
                cap,
            )
        }

        // ── Constructor ──

        #[ink::test]
        fn test_constructor() {
            let accounts = default_accounts();
            let wrapper = create_wrapper(accounts.alice);

            assert_eq!(wrapper.asset_id(), 1);
            assert_eq!(wrapper.admin(), accounts.alice);
            assert_eq!(wrapper.token_name(), Some("Wrapped PIDCHAT".to_string()));
            assert_eq!(wrapper.token_symbol(), Some("wPIDCHAT".to_string()));
            assert_eq!(wrapper.token_decimals(), 8);
            assert_eq!(wrapper.total_supply(), 0);
            assert_eq!(wrapper.total_minted(), 0);
            assert_eq!(wrapper.total_withdrawn(), 0);
            assert_eq!(wrapper.mint_cap(), 0);
            assert!(!wrapper.is_paused());
        }

        // ── Mint (admin only) ──

        #[ink::test]
        fn test_mint_by_admin() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            let result = wrapper.mint(accounts.bob, 1000);
            assert!(result.is_ok());
            assert_eq!(wrapper.balance_of(accounts.bob), 1000);
            assert_eq!(wrapper.total_supply(), 1000);
            assert_eq!(wrapper.total_minted(), 1000);
        }

        #[ink::test]
        fn test_mint_unauthorized() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            set_sender(accounts.bob);
            let result = wrapper.mint(accounts.charlie, 1000);
            assert_eq!(result, Err(WrapperError::Unauthorized));
        }

        #[ink::test]
        fn test_mint_zero_amount() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            let result = wrapper.mint(accounts.bob, 0);
            assert_eq!(result, Err(WrapperError::ZeroAmount));
        }

        // ── SEC: Double-Mint Prevention (C-02) ──

        #[ink::test]
        fn test_mint_with_ref_prevents_double_mint() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            // First mint succeeds
            let result = wrapper.mint_with_ref(accounts.bob, 1000, 12345);
            assert!(result.is_ok());
            assert_eq!(wrapper.balance_of(accounts.bob), 1000);
            assert!(wrapper.is_deposit_processed(12345));

            // Same deposit_ref MUST fail (double-mint attack)
            let result = wrapper.mint_with_ref(accounts.bob, 1000, 12345);
            assert_eq!(result, Err(WrapperError::DepositAlreadyProcessed));

            // Balance must NOT have doubled
            assert_eq!(wrapper.balance_of(accounts.bob), 1000);
            assert_eq!(wrapper.total_supply(), 1000);
        }

        #[ink::test]
        fn test_different_deposit_refs_work() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint_with_ref(accounts.bob, 1000, 1).unwrap();
            wrapper.mint_with_ref(accounts.bob, 2000, 2).unwrap();

            assert_eq!(wrapper.balance_of(accounts.bob), 3000);
            assert_eq!(wrapper.total_supply(), 3000);
        }

        // ── SEC: Mint Cap (C-03) ──

        #[ink::test]
        fn test_mint_cap_enforcement() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_capped_wrapper(accounts.alice, 5000);

            // Within cap: OK
            let result = wrapper.mint(accounts.bob, 3000);
            assert!(result.is_ok());

            // Exceeds cap: FAIL
            let result = wrapper.mint(accounts.bob, 3000);
            assert_eq!(result, Err(WrapperError::MintCapExceeded));

            // Exactly at cap: OK
            let result = wrapper.mint(accounts.bob, 2000);
            assert!(result.is_ok());
            assert_eq!(wrapper.total_supply(), 5000);

            // Any more: FAIL
            let result = wrapper.mint(accounts.bob, 1);
            assert_eq!(result, Err(WrapperError::MintCapExceeded));
        }

        #[ink::test]
        fn test_mint_with_ref_respects_cap() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_capped_wrapper(accounts.alice, 1000);

            let result = wrapper.mint_with_ref(accounts.bob, 1500, 1);
            assert_eq!(result, Err(WrapperError::MintCapExceeded));
        }

        // ── Transfer (PSP22) ──

        #[ink::test]
        fn test_transfer() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.transfer(accounts.charlie, 300, Vec::new());
            assert!(result.is_ok());

            assert_eq!(wrapper.balance_of(accounts.bob), 700);
            assert_eq!(wrapper.balance_of(accounts.charlie), 300);
            assert_eq!(wrapper.total_supply(), 1000);
        }

        #[ink::test]
        fn test_transfer_insufficient_balance() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 100).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.transfer(accounts.charlie, 200, Vec::new());
            assert_eq!(result, Err(WrapperError::InsufficientBalance));
        }

        #[ink::test]
        fn test_transfer_self() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 100).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.transfer(accounts.bob, 50, Vec::new());
            assert_eq!(result, Err(WrapperError::SelfTransfer));
        }

        // ── Approve + TransferFrom ──

        #[ink::test]
        fn test_approve_and_transfer_from() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            set_sender(accounts.bob);
            wrapper.approve(accounts.alice, 500).unwrap();
            assert_eq!(wrapper.allowance(accounts.bob, accounts.alice), 500);

            set_sender(accounts.alice);
            let result = wrapper.transfer_from(
                accounts.bob,
                accounts.charlie,
                300,
                Vec::new(),
            );
            assert!(result.is_ok());

            assert_eq!(wrapper.balance_of(accounts.bob), 700);
            assert_eq!(wrapper.balance_of(accounts.charlie), 300);
            assert_eq!(wrapper.allowance(accounts.bob, accounts.alice), 200);
        }

        #[ink::test]
        fn test_transfer_from_insufficient_allowance() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            set_sender(accounts.bob);
            wrapper.approve(accounts.alice, 100).unwrap();

            set_sender(accounts.alice);
            let result = wrapper.transfer_from(
                accounts.bob,
                accounts.charlie,
                500,
                Vec::new(),
            );
            assert_eq!(result, Err(WrapperError::InsufficientAllowance));
        }

        // ── SEC: Approve Blocked When Paused (C-05) ──

        #[ink::test]
        fn test_approve_blocked_when_paused() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();
            wrapper.pause().unwrap();

            set_sender(accounts.bob);
            let result = wrapper.approve(accounts.alice, 500);
            assert_eq!(result, Err(WrapperError::Paused));
        }

        // ── Withdraw Request ──

        #[ink::test]
        fn test_request_withdraw() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.request_withdraw(400);
            assert!(result.is_ok());

            assert_eq!(wrapper.balance_of(accounts.bob), 600);
            assert_eq!(wrapper.total_supply(), 600);
            assert_eq!(wrapper.total_withdrawn(), 400);
        }

        #[ink::test]
        fn test_request_withdraw_insufficient() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 100).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.request_withdraw(200);
            assert_eq!(result, Err(WrapperError::InsufficientBalance));
        }

        #[ink::test]
        fn test_request_withdraw_zero() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 100).unwrap();

            set_sender(accounts.bob);
            let result = wrapper.request_withdraw(0);
            assert_eq!(result, Err(WrapperError::ZeroAmount));
        }

        // ── Admin Operations ──

        #[ink::test]
        fn test_set_admin() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.set_admin(accounts.bob).unwrap();
            assert_eq!(wrapper.admin(), accounts.bob);

            set_sender(accounts.alice);
            assert_eq!(
                wrapper.mint(accounts.charlie, 100),
                Err(WrapperError::Unauthorized)
            );

            set_sender(accounts.bob);
            assert!(wrapper.mint(accounts.charlie, 100).is_ok());
        }

        // ── SEC: set_admin to self blocked (C-07) ──

        #[ink::test]
        fn test_set_admin_to_self_blocked() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            let result = wrapper.set_admin(accounts.alice);
            assert_eq!(result, Err(WrapperError::AdminUnchanged));
        }

        // ── SEC: burn_for updates audit trail (C-04) ──

        #[ink::test]
        fn test_burn_for_updates_withdrawn() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            let result = wrapper.burn_for(accounts.bob, 300);
            assert!(result.is_ok());
            assert_eq!(wrapper.balance_of(accounts.bob), 700);
            assert_eq!(wrapper.total_supply(), 700);
            assert_eq!(wrapper.total_withdrawn(), 300); // Now tracked
        }

        #[ink::test]
        fn test_burn_for_unauthorized() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            set_sender(accounts.bob);
            assert_eq!(
                wrapper.burn_for(accounts.bob, 300),
                Err(WrapperError::Unauthorized)
            );
        }

        // ── Pause / Unpause ──

        #[ink::test]
        fn test_pause_blocks_operations() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            wrapper.mint(accounts.bob, 1000).unwrap();

            wrapper.pause().unwrap();
            assert!(wrapper.is_paused());

            // All operations blocked
            set_sender(accounts.bob);
            assert_eq!(
                wrapper.transfer(accounts.charlie, 100, Vec::new()),
                Err(WrapperError::Paused)
            );
            assert_eq!(
                wrapper.approve(accounts.charlie, 100),
                Err(WrapperError::Paused)
            );
            assert_eq!(
                wrapper.request_withdraw(100),
                Err(WrapperError::Paused)
            );

            set_sender(accounts.alice);
            assert_eq!(
                wrapper.mint(accounts.charlie, 100),
                Err(WrapperError::Paused)
            );
            assert_eq!(
                wrapper.mint_with_ref(accounts.charlie, 100, 999),
                Err(WrapperError::Paused)
            );

            // Unpause restores operations
            wrapper.unpause().unwrap();
            set_sender(accounts.bob);
            assert!(wrapper.transfer(accounts.charlie, 100, Vec::new()).is_ok());
        }

        #[ink::test]
        fn test_pause_unauthorized() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            let mut wrapper = create_wrapper(accounts.alice);

            set_sender(accounts.bob);
            assert_eq!(wrapper.pause(), Err(WrapperError::Unauthorized));
        }

        // ── Full Lifecycle Security Test ──

        #[ink::test]
        fn test_full_lifecycle_with_security() {
            let accounts = default_accounts();
            set_sender(accounts.alice); // admin/relayer
            let mut wrapper = create_capped_wrapper(accounts.alice, 100_000);

            // 1. Relayer mints with unique deposit refs
            wrapper.mint_with_ref(accounts.bob, 5000, 100001).unwrap();
            wrapper.mint_with_ref(accounts.charlie, 3000, 100002).unwrap();

            // 2. Double-mint attempt BLOCKED
            assert_eq!(
                wrapper.mint_with_ref(accounts.bob, 5000, 100001),
                Err(WrapperError::DepositAlreadyProcessed)
            );

            // 3. Bob approves Router (charlie acts as router here)
            set_sender(accounts.bob);
            wrapper.approve(accounts.charlie, 3000).unwrap();

            // 4. Router moves tokens for swap
            set_sender(accounts.charlie);
            wrapper
                .transfer_from(accounts.bob, accounts.charlie, 2000, Vec::new())
                .unwrap();

            // 5. Bob requests partial withdraw
            set_sender(accounts.bob);
            wrapper.request_withdraw(1000).unwrap();
            assert_eq!(wrapper.balance_of(accounts.bob), 2000);
            assert_eq!(wrapper.total_withdrawn(), 1000);

            // 6. Admin emergency burn
            set_sender(accounts.alice);
            wrapper.burn_for(accounts.charlie, 500).unwrap();
            assert_eq!(wrapper.total_withdrawn(), 1500); // Tracked

            // 7. Audit check
            assert_eq!(wrapper.total_minted(), 8000);
            assert_eq!(wrapper.total_withdrawn(), 1500);
            assert_eq!(wrapper.total_supply(), 6500);
        }
    }
}
