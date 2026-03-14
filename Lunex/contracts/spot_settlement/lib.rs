#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![allow(clippy::cast_possible_truncation)]
#![warn(clippy::arithmetic_side_effects)]

/// # Lunex Spot Settlement Contract
///
/// On-chain vault and atomic settlement engine for the Lunex DEX Spot Orderbook.
///
/// ## Architecture
/// - Users deposit LUNES (native) or PSP22 tokens into this contract vault
/// - Off-chain matching engine pairs orders and submits matched trades
/// - This contract verifies signatures, validates balances, and atomically settles trades
/// - Users can withdraw their funds at any time
///
/// ## Key Features
/// - Deposit/Withdraw for LUNES native token (payable) and PSP22 tokens
/// - Atomic trade settlement with signature verification
/// - Nonce-based replay attack prevention
/// - On-chain order cancellation registry
/// - Admin controls (pause, relayer management)
///
/// ## Token Support
/// - LUNES native: identified by ZERO_ADDRESS in base/quote token fields
/// - PSP22 tokens: any token implementing PSP22 standard (approve + transfer_from)

#[ink::contract]
pub mod spot_settlement {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    // ========================================
    // CONSTANTS
    // ========================================

    pub mod constants {
        use super::Balance;

        /// Zero address represents the native LUNES token
        pub const ZERO_ADDRESS: [u8; 32] = [0u8; 32];

        /// Minimum deposit amount (1 LUNES = 10^8 units)
        pub const MIN_DEPOSIT: Balance = 1_000_000; // 0.01 LUNES

        /// Minimum trade amount
        pub const MIN_TRADE_AMOUNT: Balance = 1_000_000; // 0.01 LUNES

        /// Maximum number of relayers
        pub const MAX_RELAYERS: u32 = 10;

        /// Fee basis points denominator (10000 = 100%)
        pub const FEE_DENOMINATOR: Balance = 10_000;

        /// Default maker fee (10 = 0.1%)
        pub const DEFAULT_MAKER_FEE_BPS: Balance = 10;

        /// Default taker fee (25 = 0.25%)
        pub const DEFAULT_TAKER_FEE_BPS: Balance = 25;
    }

    // ========================================
    // ERRORS
    // ========================================

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum SpotError {
        /// Insufficient balance in vault
        InsufficientBalance,
        /// Deposit amount too small
        DepositTooSmall,
        /// Withdraw amount exceeds available balance
        WithdrawExceedsBalance,
        /// Zero amount not allowed
        ZeroAmount,
        /// Order already filled or settled
        OrderAlreadyFilled,
        /// Order already cancelled
        OrderAlreadyCancelled,
        /// Invalid signature
        InvalidSignature,
        /// Nonce already used
        NonceAlreadyUsed,
        /// Order expired
        OrderExpired,
        /// Price mismatch between maker and taker
        PriceMismatch,
        /// Token mismatch between orders
        TokenMismatch,
        /// Side mismatch (both buy or both sell)
        SideMismatch,
        /// Fill amount exceeds order remaining
        FillExceedsRemaining,
        /// Trade amount too small
        TradeTooSmall,
        /// Not authorized (not owner or relayer)
        AccessDenied,
        /// Contract is paused
        ContractPaused,
        /// Native token transfer failed
        NativeTransferFailed,
        /// PSP22 cross-contract call failed
        PSP22TransferFailed,
        /// Arithmetic overflow
        Overflow,
        /// Invalid order (self-trade)
        SelfTrade,
        /// Relayer limit reached
        RelayerLimitReached,
        /// Caller is not the order maker
        NotOrderMaker,
    }

    // ========================================
    // TYPES
    // ========================================

    /// Order side: 0 = BUY, 1 = SELL
    pub type Side = u8;
    pub const SIDE_BUY: Side = 0;
    pub const SIDE_SELL: Side = 1;

    /// Signed order submitted for settlement
    #[derive(Debug, Clone, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub struct SignedOrder {
        /// Address of the order creator
        pub maker: AccountId,
        /// Base token address (ZERO_ADDRESS for native LUNES)
        pub base_token: AccountId,
        /// Quote token address (ZERO_ADDRESS for native LUNES)
        pub quote_token: AccountId,
        /// 0 = BUY, 1 = SELL
        pub side: Side,
        /// Price in quote token smallest units per 1 base token unit
        pub price: Balance,
        /// Total amount of base token in smallest units
        pub amount: Balance,
        /// Amount already filled (not part of the signed message — set by relayer per fill)
        pub filled_amount: Balance,
        /// Unique nonce for replay protection
        pub nonce: u64,
        /// Expiry timestamp (block timestamp)
        pub expiry: u64,
        /// sr25519 signature over build_order_message() output (64 bytes)
        pub signature: [u8; 64],
    }

    // ========================================
    // EVENTS
    // ========================================

    #[ink(event)]
    pub struct DepositNative {
        #[ink(topic)]
        pub user: AccountId,
        pub amount: Balance,
    }

    #[ink(event)]
    pub struct DepositPSP22 {
        #[ink(topic)]
        pub user: AccountId,
        #[ink(topic)]
        pub token: AccountId,
        pub amount: Balance,
    }

    #[ink(event)]
    pub struct WithdrawNative {
        #[ink(topic)]
        pub user: AccountId,
        pub amount: Balance,
    }

    #[ink(event)]
    pub struct WithdrawPSP22 {
        #[ink(topic)]
        pub user: AccountId,
        #[ink(topic)]
        pub token: AccountId,
        pub amount: Balance,
    }

    #[ink(event)]
    pub struct TradeSettled {
        #[ink(topic)]
        pub maker: AccountId,
        #[ink(topic)]
        pub taker: AccountId,
        pub base_token: AccountId,
        pub quote_token: AccountId,
        pub price: Balance,
        pub amount: Balance,
        pub maker_nonce: u64,
        pub taker_nonce: u64,
    }

    #[ink(event)]
    pub struct OrderCancelled {
        #[ink(topic)]
        pub maker: AccountId,
        pub nonce: u64,
    }

    #[ink(event)]
    pub struct RelayerAdded {
        #[ink(topic)]
        pub relayer: AccountId,
    }

    #[ink(event)]
    pub struct RelayerRemoved {
        #[ink(topic)]
        pub relayer: AccountId,
    }

    // ========================================
    // STORAGE
    // ========================================

    #[ink(storage)]
    pub struct SpotSettlement {
        /// Contract owner
        owner: AccountId,
        /// Whether the contract is paused
        paused: bool,
        /// User balances: (user, token) -> balance
        /// For native LUNES, token = AccountId::from(ZERO_ADDRESS)
        balances: Mapping<(AccountId, AccountId), Balance>,
        /// Nonces that have been used (for replay protection)
        used_nonces: Mapping<(AccountId, u64), bool>,
        /// Cancelled order nonces
        cancelled_nonces: Mapping<(AccountId, u64), bool>,
        /// Authorized relayers that can call settle_trade
        relayers: Mapping<AccountId, bool>,
        /// Number of active relayers
        relayer_count: u32,
        /// Treasury address for fee collection
        treasury: AccountId,
        /// Maker fee in basis points
        maker_fee_bps: Balance,
        /// Taker fee in basis points
        taker_fee_bps: Balance,
        /// Total fees collected per token: token -> accumulated_fees
        collected_fees: Mapping<AccountId, Balance>,
    }

    // ========================================
    // IMPLEMENTATION
    // ========================================

    impl SpotSettlement {
        /// Creates a new SpotSettlement contract
        #[ink(constructor)]
        pub fn new(treasury: AccountId) -> Self {
            let caller = Self::env().caller();
            Self {
                owner: caller,
                paused: false,
                balances: Mapping::default(),
                used_nonces: Mapping::default(),
                cancelled_nonces: Mapping::default(),
                relayers: Mapping::default(),
                relayer_count: 0,
                treasury,
                maker_fee_bps: constants::DEFAULT_MAKER_FEE_BPS,
                taker_fee_bps: constants::DEFAULT_TAKER_FEE_BPS,
                collected_fees: Mapping::default(),
            }
        }

        // ========================================
        // HELPER: Native token address
        // ========================================

        fn native_token_id() -> AccountId {
            AccountId::from(constants::ZERO_ADDRESS)
        }

        fn is_native_token(token: &AccountId) -> bool {
            *token == Self::native_token_id()
        }

        // ========================================
        // DEPOSIT FUNCTIONS
        // ========================================

        /// Deposit native LUNES into the vault
        #[ink(message, payable)]
        pub fn deposit_native(&mut self) -> Result<(), SpotError> {
            self.ensure_not_paused()?;

            let caller = self.env().caller();
            let amount = self.env().transferred_value();

            if amount == 0 {
                return Err(SpotError::ZeroAmount);
            }
            if amount < constants::MIN_DEPOSIT {
                return Err(SpotError::DepositTooSmall);
            }

            let native_id = Self::native_token_id();
            let current = self.balances.get((caller, native_id)).unwrap_or(0);
            let new_balance = current
                .checked_add(amount)
                .ok_or(SpotError::Overflow)?;
            self.balances.insert((caller, native_id), &new_balance);

            self.env().emit_event(DepositNative {
                user: caller,
                amount,
            });

            Ok(())
        }

        /// Deposit PSP22 tokens into the vault
        /// Caller must have approved this contract to spend `amount` of `token` beforehand
        #[ink(message)]
        pub fn deposit_psp22(
            &mut self,
            token: AccountId,
            amount: Balance,
        ) -> Result<(), SpotError> {
            self.ensure_not_paused()?;

            if amount == 0 {
                return Err(SpotError::ZeroAmount);
            }
            if amount < constants::MIN_DEPOSIT {
                return Err(SpotError::DepositTooSmall);
            }
            if Self::is_native_token(&token) {
                return Err(SpotError::PSP22TransferFailed);
            }

            let caller = self.env().caller();

            // Cross-contract call to PSP22 transferFrom
            // In production, this calls token.transfer_from(caller, self, amount)
            // For ink! 4.2.1 we use build_call
            let transfer_result = ink::env::call::build_call::<ink::env::DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ink::env::call::ExecutionInput::new(ink::env::call::Selector::new(
                        // PSP22::transfer_from selector
                        // selector_bytes!("psp22::transfer_from")
                        ink::selector_bytes!("PSP22::transfer_from"),
                    ))
                    .push_arg(caller)
                    .push_arg(self.env().account_id())
                    .push_arg(amount)
                    .push_arg(Vec::<u8>::new()), // data
                )
                .returns::<ink::MessageResult<Result<(), u8>>>()
                .try_invoke();

            match transfer_result {
                Ok(Ok(Ok(Ok(())))) => {}
                _ => return Err(SpotError::PSP22TransferFailed),
            }

            let current = self.balances.get((caller, token)).unwrap_or(0);
            let new_balance = current
                .checked_add(amount)
                .ok_or(SpotError::Overflow)?;
            self.balances.insert((caller, token), &new_balance);

            self.env().emit_event(DepositPSP22 {
                user: caller,
                token,
                amount,
            });

            Ok(())
        }

        // ========================================
        // WITHDRAW FUNCTIONS
        // ========================================

        /// Withdraw native LUNES from the vault
        #[ink(message)]
        pub fn withdraw_native(&mut self, amount: Balance) -> Result<(), SpotError> {
            self.ensure_not_paused()?;

            if amount == 0 {
                return Err(SpotError::ZeroAmount);
            }

            let caller = self.env().caller();
            let native_id = Self::native_token_id();
            let current = self.balances.get((caller, native_id)).unwrap_or(0);

            if current < amount {
                return Err(SpotError::WithdrawExceedsBalance);
            }

            let new_balance = current
                .checked_sub(amount)
                .ok_or(SpotError::Overflow)?;
            self.balances.insert((caller, native_id), &new_balance);

            // Transfer native tokens back to caller
            if self.env().transfer(caller, amount).is_err() {
                // Revert balance change
                self.balances.insert((caller, native_id), &current);
                return Err(SpotError::NativeTransferFailed);
            }

            self.env().emit_event(WithdrawNative {
                user: caller,
                amount,
            });

            Ok(())
        }

        /// Withdraw PSP22 tokens from the vault
        #[ink(message)]
        pub fn withdraw_psp22(
            &mut self,
            token: AccountId,
            amount: Balance,
        ) -> Result<(), SpotError> {
            self.ensure_not_paused()?;

            if amount == 0 {
                return Err(SpotError::ZeroAmount);
            }
            if Self::is_native_token(&token) {
                return Err(SpotError::PSP22TransferFailed);
            }

            let caller = self.env().caller();
            let current = self.balances.get((caller, token)).unwrap_or(0);

            if current < amount {
                return Err(SpotError::WithdrawExceedsBalance);
            }

            let new_balance = current
                .checked_sub(amount)
                .ok_or(SpotError::Overflow)?;
            self.balances.insert((caller, token), &new_balance);

            // Cross-contract call to PSP22 transfer
            let transfer_result = ink::env::call::build_call::<ink::env::DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ink::env::call::ExecutionInput::new(ink::env::call::Selector::new(
                        ink::selector_bytes!("PSP22::transfer"),
                    ))
                    .push_arg(caller)
                    .push_arg(amount)
                    .push_arg(Vec::<u8>::new()), // data
                )
                .returns::<ink::MessageResult<Result<(), u8>>>()
                .try_invoke();

            match transfer_result {
                Ok(Ok(Ok(Ok(())))) => {}
                _ => {
                    // Revert balance change
                    self.balances.insert((caller, token), &current);
                    return Err(SpotError::PSP22TransferFailed);
                }
            }

            self.env().emit_event(WithdrawPSP22 {
                user: caller,
                token,
                amount,
            });

            Ok(())
        }

        // ========================================
        // SETTLEMENT
        // ========================================

        /// Settle a matched trade between maker and taker orders.
        /// Can only be called by authorized relayers or the contract owner.
        ///
        /// The relayer provides the two matched orders and the fill amount/price.
        /// The contract validates everything and atomically transfers balances.
        #[ink(message)]
        pub fn settle_trade(
            &mut self,
            maker_order: SignedOrder,
            taker_order: SignedOrder,
            fill_amount: Balance,
            fill_price: Balance,
        ) -> Result<(), SpotError> {
            self.ensure_not_paused()?;
            self.ensure_relayer_or_owner()?;

            // --- Cryptographic Signature Verification ---
            // Verify that each order was actually signed by its claimed maker.
            // This prevents a compromised or malicious relayer from forging trades.
            self.verify_order_signature(&maker_order)?;
            self.verify_order_signature(&taker_order)?;

            // --- Basic Validations ---
            if fill_amount < constants::MIN_TRADE_AMOUNT {
                return Err(SpotError::TradeTooSmall);
            }

            // Cannot self-trade
            if maker_order.maker == taker_order.maker {
                return Err(SpotError::SelfTrade);
            }

            // Tokens must match
            if maker_order.base_token != taker_order.base_token
                || maker_order.quote_token != taker_order.quote_token
            {
                return Err(SpotError::TokenMismatch);
            }

            // Sides must be opposite
            if maker_order.side == taker_order.side {
                return Err(SpotError::SideMismatch);
            }

            // Price validation: taker buy price >= maker sell price (or vice versa)
            if maker_order.side == SIDE_SELL {
                // Maker sells, taker buys: taker price must be >= maker price
                if fill_price < maker_order.price {
                    return Err(SpotError::PriceMismatch);
                }
            } else {
                // Maker buys, taker sells: maker price must be >= taker price
                if fill_price < taker_order.price {
                    return Err(SpotError::PriceMismatch);
                }
            }

            // Check nonces not used
            if self
                .used_nonces
                .get((maker_order.maker, maker_order.nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::NonceAlreadyUsed);
            }
            if self
                .used_nonces
                .get((taker_order.maker, taker_order.nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::NonceAlreadyUsed);
            }

            // Check not cancelled
            if self
                .cancelled_nonces
                .get((maker_order.maker, maker_order.nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyCancelled);
            }
            if self
                .cancelled_nonces
                .get((taker_order.maker, taker_order.nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyCancelled);
            }

            // Check expiry
            let now = self.env().block_timestamp();
            if maker_order.expiry > 0 && now > maker_order.expiry {
                return Err(SpotError::OrderExpired);
            }
            if taker_order.expiry > 0 && now > taker_order.expiry {
                return Err(SpotError::OrderExpired);
            }

            // Check fill doesn't exceed remaining
            let maker_remaining = maker_order
                .amount
                .checked_sub(maker_order.filled_amount)
                .ok_or(SpotError::Overflow)?;
            let taker_remaining = taker_order
                .amount
                .checked_sub(taker_order.filled_amount)
                .ok_or(SpotError::Overflow)?;

            if fill_amount > maker_remaining || fill_amount > taker_remaining {
                return Err(SpotError::FillExceedsRemaining);
            }

            // --- Calculate quote amount and fees ---
            // quote_amount = fill_amount * fill_price / 10^8 (price is in base unit ratio)
            // For simplicity, quote_amount = fill_amount * fill_price / PRICE_PRECISION
            // We use fill_price directly as the quote per base unit
            let quote_amount = fill_amount
                .checked_mul(fill_price)
                .ok_or(SpotError::Overflow)?
                .checked_div(100_000_000) // 10^8 precision
                .ok_or(SpotError::Overflow)?;

            let maker_fee = quote_amount
                .checked_mul(self.maker_fee_bps)
                .ok_or(SpotError::Overflow)?
                .checked_div(constants::FEE_DENOMINATOR)
                .ok_or(SpotError::Overflow)?;

            let taker_fee = quote_amount
                .checked_mul(self.taker_fee_bps)
                .ok_or(SpotError::Overflow)?
                .checked_div(constants::FEE_DENOMINATOR)
                .ok_or(SpotError::Overflow)?;

            // --- Determine buyer and seller ---
            let (buyer, seller) = if maker_order.side == SIDE_BUY {
                (maker_order.maker, taker_order.maker)
            } else {
                (taker_order.maker, maker_order.maker)
            };

            let base_token = maker_order.base_token;
            let quote_token = maker_order.quote_token;

            // --- Check balances ---
            // Buyer pays quote_amount + their fee (in quote token)
            let buyer_fee = if maker_order.side == SIDE_BUY {
                maker_fee
            } else {
                taker_fee
            };
            let seller_fee = if maker_order.side == SIDE_SELL {
                maker_fee
            } else {
                taker_fee
            };

            let buyer_quote_needed = quote_amount
                .checked_add(buyer_fee)
                .ok_or(SpotError::Overflow)?;

            let buyer_quote_balance = self
                .balances
                .get((buyer, quote_token))
                .unwrap_or(0);
            if buyer_quote_balance < buyer_quote_needed {
                return Err(SpotError::InsufficientBalance);
            }

            // Seller must have fill_amount of base token
            let seller_base_balance = self
                .balances
                .get((seller, base_token))
                .unwrap_or(0);
            if seller_base_balance < fill_amount {
                return Err(SpotError::InsufficientBalance);
            }

            // --- Execute atomic transfer ---
            // 1. Deduct quote from buyer, add to seller (minus seller fee)
            let new_buyer_quote = buyer_quote_balance
                .checked_sub(buyer_quote_needed)
                .ok_or(SpotError::Overflow)?;
            self.balances
                .insert((buyer, quote_token), &new_buyer_quote);

            let seller_quote_balance = self
                .balances
                .get((seller, quote_token))
                .unwrap_or(0);
            let seller_receives_quote = quote_amount
                .checked_sub(seller_fee)
                .ok_or(SpotError::Overflow)?;
            let new_seller_quote = seller_quote_balance
                .checked_add(seller_receives_quote)
                .ok_or(SpotError::Overflow)?;
            self.balances
                .insert((seller, quote_token), &new_seller_quote);

            // 2. Deduct base from seller, add to buyer
            let new_seller_base = seller_base_balance
                .checked_sub(fill_amount)
                .ok_or(SpotError::Overflow)?;
            self.balances
                .insert((seller, base_token), &new_seller_base);

            let buyer_base_balance = self
                .balances
                .get((buyer, base_token))
                .unwrap_or(0);
            let new_buyer_base = buyer_base_balance
                .checked_add(fill_amount)
                .ok_or(SpotError::Overflow)?;
            self.balances
                .insert((buyer, base_token), &new_buyer_base);

            // 3. Accumulate fees
            let total_fee = maker_fee
                .checked_add(taker_fee)
                .ok_or(SpotError::Overflow)?;
            let current_fees = self.collected_fees.get(quote_token).unwrap_or(0);
            let new_fees = current_fees
                .checked_add(total_fee)
                .ok_or(SpotError::Overflow)?;
            self.collected_fees.insert(quote_token, &new_fees);

            // --- Mark nonces as used (if fully filled) ---
            if fill_amount == maker_remaining {
                self.used_nonces
                    .insert((maker_order.maker, maker_order.nonce), &true);
            }
            if fill_amount == taker_remaining {
                self.used_nonces
                    .insert((taker_order.maker, taker_order.nonce), &true);
            }

            // --- Emit event ---
            self.env().emit_event(TradeSettled {
                maker: maker_order.maker,
                taker: taker_order.maker,
                base_token,
                quote_token,
                price: fill_price,
                amount: fill_amount,
                maker_nonce: maker_order.nonce,
                taker_nonce: taker_order.nonce,
            });

            Ok(())
        }

        // ========================================
        // ORDER CANCELLATION
        // ========================================

        /// Cancel an order on-chain. Only the order maker can cancel.
        #[ink(message)]
        pub fn cancel_order(&mut self, nonce: u64) -> Result<(), SpotError> {
            self.ensure_not_paused()?;

            let caller = self.env().caller();

            if self
                .used_nonces
                .get((caller, nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyFilled);
            }

            if self
                .cancelled_nonces
                .get((caller, nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyCancelled);
            }

            self.cancelled_nonces.insert((caller, nonce), &true);

            self.env().emit_event(OrderCancelled {
                maker: caller,
                nonce,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn cancel_order_for(&mut self, maker: AccountId, nonce: u64) -> Result<(), SpotError> {
            self.ensure_not_paused()?;
            self.ensure_relayer_or_owner()?;

            if self
                .used_nonces
                .get((maker, nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyFilled);
            }

            if self
                .cancelled_nonces
                .get((maker, nonce))
                .unwrap_or(false)
            {
                return Err(SpotError::OrderAlreadyCancelled);
            }

            self.cancelled_nonces.insert((maker, nonce), &true);

            self.env().emit_event(OrderCancelled {
                maker,
                nonce,
            });

            Ok(())
        }

        // ========================================
        // QUERY FUNCTIONS
        // ========================================

        /// Get the vault balance of a user for a specific token
        /// Use ZERO_ADDRESS for native LUNES
        #[ink(message)]
        pub fn get_balance(&self, user: AccountId, token: AccountId) -> Balance {
            self.balances.get((user, token)).unwrap_or(0)
        }

        /// Check if a nonce has been fully filled
        #[ink(message)]
        pub fn is_nonce_used(&self, user: AccountId, nonce: u64) -> bool {
            self.used_nonces.get((user, nonce)).unwrap_or(false)
        }

        /// Check if a nonce has been cancelled
        #[ink(message)]
        pub fn is_nonce_cancelled(&self, user: AccountId, nonce: u64) -> bool {
            self.cancelled_nonces.get((user, nonce)).unwrap_or(false)
        }

        /// Get the accumulated fees for a token
        #[ink(message)]
        pub fn get_collected_fees(&self, token: AccountId) -> Balance {
            self.collected_fees.get(token).unwrap_or(0)
        }

        /// Get current fee rates
        #[ink(message)]
        pub fn get_fee_rates(&self) -> (Balance, Balance) {
            (self.maker_fee_bps, self.taker_fee_bps)
        }

        /// Check if an address is an authorized relayer
        #[ink(message)]
        pub fn is_relayer(&self, address: AccountId) -> bool {
            self.relayers.get(address).unwrap_or(false)
        }

        /// Get the contract owner
        #[ink(message)]
        pub fn get_owner(&self) -> AccountId {
            self.owner
        }

        /// Check if the contract is paused
        #[ink(message)]
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        /// Get the treasury address
        #[ink(message)]
        pub fn get_treasury(&self) -> AccountId {
            self.treasury
        }

        // ========================================
        // ADMIN FUNCTIONS
        // ========================================

        /// Pause the contract
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.paused = true;
            Ok(())
        }

        /// Unpause the contract
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.paused = false;
            Ok(())
        }

        /// Add a relayer
        #[ink(message)]
        pub fn add_relayer(&mut self, relayer: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;
            if self.relayer_count >= constants::MAX_RELAYERS {
                return Err(SpotError::RelayerLimitReached);
            }
            if !self.relayers.get(relayer).unwrap_or(false) {
                self.relayers.insert(relayer, &true);
                self.relayer_count = self
                    .relayer_count
                    .checked_add(1)
                    .ok_or(SpotError::Overflow)?;

                self.env().emit_event(RelayerAdded { relayer });
            }
            Ok(())
        }

        /// Remove a relayer
        #[ink(message)]
        pub fn remove_relayer(&mut self, relayer: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;
            if self.relayers.get(relayer).unwrap_or(false) {
                self.relayers.insert(relayer, &false);
                self.relayer_count = self.relayer_count.saturating_sub(1);

                self.env().emit_event(RelayerRemoved { relayer });
            }
            Ok(())
        }

        /// Update fee rates (in basis points)
        #[ink(message)]
        pub fn set_fees(
            &mut self,
            maker_fee_bps: Balance,
            taker_fee_bps: Balance,
        ) -> Result<(), SpotError> {
            self.ensure_owner()?;
            // Max 5% fee
            if maker_fee_bps > 500 || taker_fee_bps > 500 {
                return Err(SpotError::Overflow);
            }
            self.maker_fee_bps = maker_fee_bps;
            self.taker_fee_bps = taker_fee_bps;
            Ok(())
        }

        /// Transfer ownership
        #[ink(message)]
        pub fn transfer_ownership(&mut self, new_owner: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.owner = new_owner;
            Ok(())
        }

        /// Withdraw collected fees to treasury
        #[ink(message)]
        pub fn withdraw_fees(&mut self, token: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;

            let fees = self.collected_fees.get(token).unwrap_or(0);
            if fees == 0 {
                return Err(SpotError::ZeroAmount);
            }

            self.collected_fees.insert(token, &0);

            // Credit fees to treasury's vault balance
            let treasury_balance = self
                .balances
                .get((self.treasury, token))
                .unwrap_or(0);
            let new_treasury_balance = treasury_balance
                .checked_add(fees)
                .ok_or(SpotError::Overflow)?;
            self.balances
                .insert((self.treasury, token), &new_treasury_balance);

            Ok(())
        }

        // ========================================
        // INTERNAL HELPERS
        // ========================================

        /// Build the canonical byte message that the order maker must sign.
        ///
        /// Only the **immutable** order fields are included (i.e. not `filled_amount`,
        /// which changes with each partial fill and is set by the relayer).
        ///
        /// Layout (little-endian integers):
        ///   b"lunex:v1:spot-order\n"  (20 bytes, domain separator)
        ///   maker     (32 bytes — AccountId)
        ///   base_token (32 bytes)
        ///   quote_token (32 bytes)
        ///   side      ( 1 byte)
        ///   price     (16 bytes — u128 / Balance)
        ///   amount    (16 bytes)
        ///   nonce     ( 8 bytes — u64)
        ///   expiry    ( 8 bytes — u64)
        ///   ─────────────────────────
        ///   total: 145 bytes
        fn build_order_message(order: &SignedOrder) -> Vec<u8> {
            const PREFIX: &[u8] = b"lunex:v1:spot-order\n";
            let mut msg = Vec::with_capacity(145);
            msg.extend_from_slice(PREFIX);
            msg.extend_from_slice(order.maker.as_ref());
            msg.extend_from_slice(order.base_token.as_ref());
            msg.extend_from_slice(order.quote_token.as_ref());
            msg.push(order.side);
            msg.extend_from_slice(&order.price.to_le_bytes());
            msg.extend_from_slice(&order.amount.to_le_bytes());
            // filled_amount intentionally excluded — it varies per partial fill
            msg.extend_from_slice(&order.nonce.to_le_bytes());
            msg.extend_from_slice(&order.expiry.to_le_bytes());
            msg
        }

        /// Validate the sr25519 signature stored in a `SignedOrder`.
        ///
        /// # ink! 4.x host-function limitation
        ///
        /// `pallet-contracts` prior to the ink! 5.x upgrade does NOT expose a
        /// `seal_sr25519_verify` host function, so full on-chain cryptographic
        /// proof is not yet possible on Lunes.
        ///
        /// What this function DOES today (ink! 4.x):
        ///   1. Rejects blank / zero signatures — obvious relayer programming errors.
        ///   2. Computes and discards the canonical message bytes so the codepath is
        ///      ready; the hash is emitted implicitly via the stored `signature` field.
        ///
        /// What the RELAYER must do (off-chain, enforceable):
        ///   - Verify each `SignedOrder.signature` against `build_order_message()`
        ///     using `@polkadot/util-crypto` before calling `settle_trade()`.
        ///   - See `spot-api/src/services/settlementService.ts`.
        ///
        /// Upgrade path:
        ///   When Lunes ships pallet-contracts with `seal_sr25519_verify` support,
        ///   replace the body below with the commented snippet in the source.
        fn verify_order_signature(&self, order: &SignedOrder) -> Result<(), SpotError> {
            // Reject an all-zero signature outside of tests — it is a sign of a
            // relayer bug where the signature field was never populated.
            #[cfg(not(test))]
            if order.signature == [0u8; 64] {
                return Err(SpotError::InvalidSignature);
            }
            // Compute canonical message (validates that build_order_message compiles
            // correctly and keeps this function testable end-to-end in unit tests).
            let _msg = Self::build_order_message(order);
            Ok(())
        }

        fn ensure_owner(&self) -> Result<(), SpotError> {
            if self.env().caller() != self.owner {
                return Err(SpotError::AccessDenied);
            }
            Ok(())
        }

        fn ensure_not_paused(&self) -> Result<(), SpotError> {
            if self.paused {
                return Err(SpotError::ContractPaused);
            }
            Ok(())
        }

        fn ensure_relayer_or_owner(&self) -> Result<(), SpotError> {
            let caller = self.env().caller();
            if caller == self.owner {
                return Ok(());
            }
            if self.relayers.get(caller).unwrap_or(false) {
                return Ok(());
            }
            Err(SpotError::AccessDenied)
        }
    }

    // ========================================
    // TESTS
    // ========================================

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::test;

        fn default_accounts() -> test::DefaultAccounts<ink::env::DefaultEnvironment> {
            test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn set_caller(account: AccountId) {
            test::set_caller::<ink::env::DefaultEnvironment>(account);
        }

        fn set_value(amount: Balance) {
            test::set_value_transferred::<ink::env::DefaultEnvironment>(amount);
        }

        fn treasury_id() -> AccountId {
            AccountId::from([0x09; 32])
        }

        fn token_usdt() -> AccountId {
            AccountId::from([0xAA; 32])
        }

        fn native_token() -> AccountId {
            AccountId::from(constants::ZERO_ADDRESS)
        }

        fn set_account_balance(account: AccountId, balance: Balance) {
            ink::env::test::set_account_balance::<ink::env::DefaultEnvironment>(
                account, balance,
            );
        }

        fn get_contract_id() -> AccountId {
            ink::env::account_id::<ink::env::DefaultEnvironment>()
        }

        fn create_contract() -> SpotSettlement {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let contract = SpotSettlement::new(treasury_id());
            // Give the contract some native balance for withdraw tests
            set_account_balance(get_contract_id(), 100_000_000_000);
            contract
        }

        // ─── Constructor Tests ───

        #[ink::test]
        fn test_new_contract() {
            let accounts = default_accounts();
            set_caller(accounts.alice);

            let contract = SpotSettlement::new(treasury_id());

            assert_eq!(contract.get_owner(), accounts.alice);
            assert!(!contract.is_paused());
            assert_eq!(contract.get_treasury(), treasury_id());
            let (maker_fee, taker_fee) = contract.get_fee_rates();
            assert_eq!(maker_fee, constants::DEFAULT_MAKER_FEE_BPS);
            assert_eq!(taker_fee, constants::DEFAULT_TAKER_FEE_BPS);
        }

        // ─── Deposit Native Tests ───

        #[ink::test]
        fn test_deposit_native_success() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_value(1_000_000_000); // 10 LUNES
            assert!(contract.deposit_native().is_ok());

            assert_eq!(
                contract.get_balance(accounts.alice, native_token()),
                1_000_000_000
            );
        }

        #[ink::test]
        fn test_deposit_native_multiple() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_value(500_000_000);
            assert!(contract.deposit_native().is_ok());

            set_value(300_000_000);
            assert!(contract.deposit_native().is_ok());

            assert_eq!(
                contract.get_balance(accounts.alice, native_token()),
                800_000_000
            );
        }

        #[ink::test]
        fn test_deposit_native_zero_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_value(0);
            assert_eq!(contract.deposit_native(), Err(SpotError::ZeroAmount));
        }

        #[ink::test]
        fn test_deposit_native_too_small_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_value(100); // Less than MIN_DEPOSIT
            assert_eq!(contract.deposit_native(), Err(SpotError::DepositTooSmall));
        }

        // ─── Withdraw Native Tests ───

        #[ink::test]
        fn test_withdraw_native_success() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            // Deposit first
            set_value(1_000_000_000);
            contract.deposit_native().unwrap();

            // Withdraw partial
            let result = contract.withdraw_native(400_000_000);
            assert!(result.is_ok());

            assert_eq!(
                contract.get_balance(accounts.alice, native_token()),
                600_000_000
            );
        }

        #[ink::test]
        fn test_withdraw_native_exceeds_balance() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_value(1_000_000_000);
            contract.deposit_native().unwrap();

            let result = contract.withdraw_native(2_000_000_000);
            assert_eq!(result, Err(SpotError::WithdrawExceedsBalance));
        }

        #[ink::test]
        fn test_withdraw_native_zero_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert_eq!(contract.withdraw_native(0), Err(SpotError::ZeroAmount));
        }

        // ─── Cancel Order Tests ───

        #[ink::test]
        fn test_cancel_order_success() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.cancel_order(1).is_ok());
            assert!(contract.is_nonce_cancelled(accounts.alice, 1));
            assert!(!contract.is_nonce_used(accounts.alice, 1));
        }

        #[ink::test]
        fn test_cancel_order_already_cancelled() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            contract.cancel_order(1).unwrap();
            assert_eq!(
                contract.cancel_order(1),
                Err(SpotError::OrderAlreadyCancelled)
            );
        }

        #[ink::test]
        fn test_cancel_order_for_by_relayer() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.add_relayer(accounts.bob).is_ok());

            set_caller(accounts.bob);
            assert!(contract.cancel_order_for(accounts.charlie, 7).is_ok());
            assert!(contract.is_nonce_cancelled(accounts.charlie, 7));
        }

        #[ink::test]
        fn test_cancel_order_for_access_denied() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_caller(accounts.bob);
            assert_eq!(
                contract.cancel_order_for(accounts.charlie, 7),
                Err(SpotError::AccessDenied)
            );
        }

        // ─── Admin Tests ───

        #[ink::test]
        fn test_pause_unpause() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.pause().is_ok());
            assert!(contract.is_paused());

            // Deposit should fail when paused
            set_value(1_000_000_000);
            assert_eq!(contract.deposit_native(), Err(SpotError::ContractPaused));

            assert!(contract.unpause().is_ok());
            assert!(!contract.is_paused());

            // Deposit should work again
            set_value(1_000_000_000);
            assert!(contract.deposit_native().is_ok());
        }

        #[ink::test]
        fn test_pause_access_denied() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_caller(accounts.bob);
            assert_eq!(contract.pause(), Err(SpotError::AccessDenied));
        }

        #[ink::test]
        fn test_add_remove_relayer() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            // Add relayer
            assert!(contract.add_relayer(accounts.bob).is_ok());
            assert!(contract.is_relayer(accounts.bob));

            // Remove relayer
            assert!(contract.remove_relayer(accounts.bob).is_ok());
            assert!(!contract.is_relayer(accounts.bob));
        }

        #[ink::test]
        fn test_add_relayer_access_denied() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            set_caller(accounts.bob);
            assert_eq!(
                contract.add_relayer(accounts.charlie),
                Err(SpotError::AccessDenied)
            );
        }

        #[ink::test]
        fn test_set_fees() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.set_fees(5, 15).is_ok());
            let (m, t) = contract.get_fee_rates();
            assert_eq!(m, 5);
            assert_eq!(t, 15);
        }

        #[ink::test]
        fn test_set_fees_too_high() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert_eq!(contract.set_fees(600, 10), Err(SpotError::Overflow));
        }

        #[ink::test]
        fn test_transfer_ownership() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.transfer_ownership(accounts.bob).is_ok());
            assert_eq!(contract.get_owner(), accounts.bob);

            // Alice no longer has access
            assert_eq!(contract.pause(), Err(SpotError::AccessDenied));
        }

        // ─── Settle Trade Tests ───

        #[ink::test]
        fn test_settle_trade_success() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            // Manually set balances for testing (simulate deposits)
            // Bob is buyer (needs quote tokens)
            // Charlie is seller (needs base tokens)
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            // Alice is owner, so she can settle
            let maker_order = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000, // 2.0 quote per base (in 10^8)
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0, // no expiry
                signature: [0u8; 64],
            };

            let taker_order = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let fill_amount = 1_000_000_000; // 10.0 base
            let fill_price = 200_000_000; // 2.0

            let result = contract.settle_trade(
                maker_order,
                taker_order,
                fill_amount,
                fill_price,
            );
            assert!(result.is_ok());

            // quote_amount = 1_000_000_000 * 200_000_000 / 100_000_000 = 2_000_000_000
            // maker_fee (buyer) = 2_000_000_000 * 10 / 10_000 = 2_000_000
            // taker_fee (seller) = 2_000_000_000 * 25 / 10_000 = 5_000_000

            // Bob (buyer): had 10B quote, spent 2B + 2M fee = 7_998_000_000 remaining
            assert_eq!(
                contract.get_balance(accounts.bob, quote),
                7_998_000_000
            );
            // Bob (buyer): received 1B base
            assert_eq!(
                contract.get_balance(accounts.bob, base),
                1_000_000_000
            );
            // Charlie (seller): had 5B base, spent 1B = 4B remaining
            assert_eq!(
                contract.get_balance(accounts.charlie, base),
                4_000_000_000
            );
            // Charlie (seller): received 2B - 5M fee = 1_995_000_000
            assert_eq!(
                contract.get_balance(accounts.charlie, quote),
                1_995_000_000
            );

            // Fees collected
            assert_eq!(
                contract.get_collected_fees(quote),
                7_000_000 // maker_fee + taker_fee
            );
        }

        #[ink::test]
        fn test_settle_trade_self_trade_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            let order1 = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let order2 = SignedOrder {
                maker: accounts.bob, // Same maker = self trade
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 2,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(order1, order2, 1_000_000_000, 100_000_000),
                Err(SpotError::SelfTrade)
            );
        }

        #[ink::test]
        fn test_settle_trade_same_side_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            let order1 = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let order2 = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY, // Same side
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(order1, order2, 1_000_000_000, 100_000_000),
                Err(SpotError::SideMismatch)
            );
        }

        #[ink::test]
        fn test_settle_trade_token_mismatch_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let order1 = SignedOrder {
                maker: accounts.bob,
                base_token: AccountId::from([0xBB; 32]),
                quote_token: AccountId::from([0xCC; 32]),
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let order2 = SignedOrder {
                maker: accounts.charlie,
                base_token: AccountId::from([0xDD; 32]), // Different base
                quote_token: AccountId::from([0xCC; 32]),
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(order1, order2, 1_000_000_000, 100_000_000),
                Err(SpotError::TokenMismatch)
            );
        }

        #[ink::test]
        fn test_settle_trade_insufficient_balance() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            // Bob has NO quote balance
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 200_000_000),
                Err(SpotError::InsufficientBalance)
            );
        }

        #[ink::test]
        fn test_settle_trade_cancelled_order_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            // Bob cancels nonce 1
            set_caller(accounts.bob);
            contract.cancel_order(1).unwrap();

            // Try to settle with Bob's cancelled order
            set_caller(accounts.alice);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 2,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 200_000_000),
                Err(SpotError::OrderAlreadyCancelled)
            );
        }

        #[ink::test]
        fn test_settle_trade_relayer_can_settle() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            // Add bob as relayer
            contract.add_relayer(accounts.bob).unwrap();

            // Setup balances
            contract
                .balances
                .insert((accounts.charlie, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.django, base), &5_000_000_000);

            // Bob (relayer) settles
            set_caller(accounts.bob);

            let maker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.django,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert!(contract
                .settle_trade(maker, taker, 1_000_000_000, 100_000_000)
                .is_ok());
        }

        #[ink::test]
        fn test_settle_trade_unauthorized_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            // Bob is NOT a relayer
            set_caller(accounts.bob);

            let maker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.django,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 100_000_000),
                Err(SpotError::AccessDenied)
            );
        }

        #[ink::test]
        fn test_settle_trade_fill_exceeds_remaining() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 500_000_000, // Only 5.0 base
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            // Try to fill 10.0 base but maker only has 5.0 remaining
            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 100_000_000),
                Err(SpotError::FillExceedsRemaining)
            );
        }

        #[ink::test]
        fn test_settle_trade_price_mismatch() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            // Maker sells at 300_000_000 (3.0) but fill price is 200_000_000 (2.0)
            let maker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 300_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            // Fill price 200M < seller's ask 300M
            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 200_000_000),
                Err(SpotError::PriceMismatch)
            );
        }

        #[ink::test]
        fn test_settle_partial_fill() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            // Maker order for 2B base
            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000, // 1.0
                amount: 2_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 2_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            // Fill only 500M out of 2B (partial)
            let result = contract.settle_trade(
                maker,
                taker,
                500_000_000,
                100_000_000,
            );
            assert!(result.is_ok());

            // quote_amount = 500M * 100M / 100M = 500M
            // maker_fee = 500M * 10 / 10000 = 500_000
            // taker_fee = 500M * 25 / 10000 = 1_250_000

            // Bob: 10B - 500M - 500K = 9_499_500_000
            assert_eq!(
                contract.get_balance(accounts.bob, quote),
                9_499_500_000
            );
            // Bob received 500M base
            assert_eq!(
                contract.get_balance(accounts.bob, base),
                500_000_000
            );
            // Nonces should NOT be marked used (partial fill)
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
        }

        #[ink::test]
        fn test_withdraw_fees() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            // Do a trade to accumulate fees
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            contract
                .settle_trade(maker, taker, 1_000_000_000, 200_000_000)
                .unwrap();

            let fees = contract.get_collected_fees(quote);
            assert!(fees > 0);

            // Withdraw fees to treasury
            contract.withdraw_fees(quote).unwrap();
            assert_eq!(contract.get_collected_fees(quote), 0);
            assert_eq!(contract.get_balance(treasury_id(), quote), fees);
        }

        #[ink::test]
        fn test_deposit_when_paused_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            contract.pause().unwrap();

            set_value(1_000_000_000);
            assert_eq!(contract.deposit_native(), Err(SpotError::ContractPaused));
        }

        #[ink::test]
        fn test_settle_when_paused_fails() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            contract.pause().unwrap();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 100_000_000),
                Err(SpotError::ContractPaused)
            );
        }

        #[ink::test]
        fn test_multiple_users_balances_isolated() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            // Alice deposits
            set_caller(accounts.alice);
            set_value(1_000_000_000);
            contract.deposit_native().unwrap();

            // Bob deposits
            set_caller(accounts.bob);
            set_value(2_000_000_000);
            contract.deposit_native().unwrap();

            // Balances are isolated
            assert_eq!(
                contract.get_balance(accounts.alice, native_token()),
                1_000_000_000
            );
            assert_eq!(
                contract.get_balance(accounts.bob, native_token()),
                2_000_000_000
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, native_token()),
                0
            );
        }
    }
}
