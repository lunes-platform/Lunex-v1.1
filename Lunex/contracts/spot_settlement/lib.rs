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
    use ink::env::hash::{Blake2x256, HashOutput};
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    // ========================================
    // PSP22 ERROR TYPE (DEFINIDO LOCALMENTE)
    // ========================================
    //
    // Tipo de retorno canônico das mensagens PSP22 (transfer / transfer_from /
    // approve), conforme a PSP22 spec e TODOS os tokens deployados neste repo
    // (ver `Lunex/contracts/psp22/lib.rs` e o `PSP22Ref` de `pair`/`router`).
    //
    // Mensagens PSP22 retornam `Result<(), PSP22Error>`. Decodificar esse
    // retorno como `Result<(), u8>` faz uma transferência bem-sucedida ser
    // mal-decodificada e revertida como `PSP22TransferFailed`. Mantemos
    // `Custom(String)` como variante de índice 0 para casar com o layout
    // SCALE do `PSP22Ref` do repo e tolerar erros customizados de qualquer
    // token PSP22 sem falha de decode.
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum PSP22Error {
        /// Erro personalizado com mensagem
        Custom(ink::prelude::string::String),
        /// Saldo insuficiente
        InsufficientBalance,
        /// Allowance insuficiente
        InsufficientAllowance,
        /// Endereço zero (destinatário) não permitido
        ZeroRecipientAddress,
        /// Endereço zero (remetente) não permitido
        ZeroSenderAddress,
        /// Falha de verificação de transferência segura
        SafeTransferCheckFailed(ink::prelude::string::String),
    }

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
        /// Immutable order fields changed for a nonce already partially filled
        OrderMismatch,
        /// Reentrancy detected — a malicious PSP22 token attempted to call back
        /// into the contract while a deposit/withdraw was in progress.
        Reentrancy,
        /// On-chain cryptographic signature verification is UNAVAILABLE on the
        /// current Lunes runtime (pallet-contracts does not expose
        /// `sr25519_verify` — EXT-CRYPTO dependency, see P0-1). While the
        /// fail-closed gate `signature_verification_enforced` is active (the
        /// default), `settle_trade` is blocked for safety: settling custodial
        /// balances on signatures that were never cryptographically verified
        /// on-chain would reduce the security model to "trust the relayer".
        /// With ADR-001 (option c) this error also means: enforcement is
        /// active but no `attestor_pubkey` is configured yet, so the ECDSA
        /// attestation path cannot run — settlement stays blocked.
        SignatureVerificationUnavailable,
        /// The ECDSA attestation attached to a `SignedOrder` is invalid:
        /// either `ecdsa_recover` failed (malformed signature / recovery id)
        /// or the recovered public key does not match the configured
        /// `attestor_pubkey`. See ADR-001 (option c, 2-of-2 attestation).
        AttestationInvalid,
        /// Timelock for disabling enforcement has not expired yet.
        EnforcementTimelockNotExpired,
        /// execute_disable_enforcement called with no pending proposal.
        NoPendingEnforcementDisable,
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
        /// Amount already filled reported by the relayer. This field is not trusted for
        /// settlement accounting; the contract tracks cumulative fills by maker nonce.
        pub filled_amount: Balance,
        /// Unique nonce for replay protection
        pub nonce: u64,
        /// Expiry timestamp (block timestamp)
        pub expiry: u64,
        /// sr25519 signature over build_order_message() output (64 bytes)
        pub signature: [u8; 64],
        /// ECDSA (secp256k1) attestation by the independent attestor service
        /// over `blake2x256(build_order_message_v2(order))` — 65 bytes:
        /// `r (32) ‖ s (32) ‖ recovery_id (1, values 0/1 or 27/28)`.
        ///
        /// ADR-001 (option c): the attestor verifies the maker's sr25519
        /// `signature` OFF-chain and, only if valid, signs the canonical v2
        /// order hash with its own secp256k1 key. On-chain the contract
        /// recovers the public key via `ecdsa_recover` and compares it with
        /// the owner-configured `attestor_pubkey` (2-of-2: relayer + attestor).
        pub attestation: [u8; 65],
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

    /// Emitted whenever the owner toggles the fail-closed signature gate.
    /// Indexers/alerting MUST watch this event: `enforced == false` means the
    /// contract is running in explicit testnet mode WITHOUT on-chain
    /// cryptographic verification of order signatures.
    #[ink(event)]
    pub struct SignatureEnforcementChanged {
        /// New state of the fail-closed gate.
        pub enforced: bool,
        /// Owner account that performed the change.
        #[ink(topic)]
        pub changed_by: AccountId,
    }

    /// Emitted whenever the owner sets/rotates the ECDSA attestor public key
    /// (ADR-001, option c). Indexers/alerting MUST watch this event: a key
    /// rotation is a privileged, security-sensitive operation.
    #[ink(event)]
    pub struct AttestorKeyChanged {
        /// New compressed secp256k1 public key of the attestor service.
        pub attestor_pubkey: [u8; 33],
        /// Owner account that performed the change.
        #[ink(topic)]
        pub changed_by: AccountId,
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
        /// Reentrancy guard — set true while a message that performs cross-contract
        /// PSP22 calls is in flight. A malicious token cannot re-enter the contract
        /// while this is true (acquire_lock returns SpotError::Reentrancy).
        reentrancy_lock: bool,
        /// Pending owner address (two-step ownership transfer).
        /// Set by `transfer_ownership`, cleared by `accept_ownership`.
        /// Prevents permanent loss of admin control if a typo'd address is used.
        pending_owner: Option<AccountId>,
        /// User balances: (user, token) -> balance
        /// For native LUNES, token = AccountId::from(ZERO_ADDRESS)
        balances: Mapping<(AccountId, AccountId), Balance>,
        /// Nonces that have been used (for replay protection)
        used_nonces: Mapping<(AccountId, u64), bool>,
        /// Cumulative amount filled per maker nonce.
        filled_amounts: Mapping<(AccountId, u64), Balance>,
        /// Canonical immutable order hash per maker nonce.
        order_hashes: Mapping<(AccountId, u64), [u8; 32]>,
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
        /// Fail-closed gate (P0-1): while `true` (the DEFAULT), `settle_trade`
        /// is blocked with `SignatureVerificationUnavailable` because the
        /// current Lunes runtime cannot verify sr25519 signatures on-chain.
        /// Only the owner can set it to `false` (explicit testnet mode), and
        /// every change emits `SignatureEnforcementChanged`.
        signature_verification_enforced: bool,
        /// Compressed secp256k1 public key (33 bytes, SEC1) of the
        /// independent attestor service (ADR-001, option c — 2-of-2
        /// attestation). Stored split as `(sec1_tag_byte, x_coordinate)`
        /// because ink! 4.x only implements `StorageLayout` for arrays up to
        /// 32 bytes; the public ABI (`set_attestor_key`/`get_attestor_key`)
        /// always speaks `[u8; 33]`.
        /// `None` (the default) keeps `settle_trade` blocked with
        /// `SignatureVerificationUnavailable` while enforcement is active.
        /// Only the owner can set it, and every change emits
        /// `AttestorKeyChanged`.
        attestor_pubkey: Option<(u8, [u8; 32])>,
        /// Deadline timestamp (ms) for a pending disable-enforcement proposal.
        /// `None` means no proposal is active. Set by `propose_disable_enforcement`,
        /// cleared by `execute_disable_enforcement` or `cancel_disable_enforcement`.
        pending_enforcement_off: Option<u64>,
        /// Minimum delay (ms) between proposing and executing a disable-enforcement
        /// transition. Immutable after construction: 48 * 3_600_000 = 172_800_000 ms.
        enforcement_timelock_ms: u64,
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
                reentrancy_lock: false,
                pending_owner: None,
                balances: Mapping::default(),
                used_nonces: Mapping::default(),
                filled_amounts: Mapping::default(),
                order_hashes: Mapping::default(),
                cancelled_nonces: Mapping::default(),
                relayers: Mapping::default(),
                relayer_count: 0,
                treasury,
                maker_fee_bps: constants::DEFAULT_MAKER_FEE_BPS,
                taker_fee_bps: constants::DEFAULT_TAKER_FEE_BPS,
                collected_fees: Mapping::default(),
                // FAIL-CLOSED by default: settlement stays blocked until the
                // owner explicitly opts into testnet mode (audited via event).
                signature_verification_enforced: true,
                // No attestor key at deploy time: enforcement stays
                // fail-closed until the owner registers one (ADR-001).
                attestor_pubkey: None,
                pending_enforcement_off: None,
                enforcement_timelock_ms: 48 * 3_600_000,
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
        // HELPER: Reentrancy guard
        // ========================================

        fn acquire_lock(&mut self) -> Result<(), SpotError> {
            if self.reentrancy_lock {
                return Err(SpotError::Reentrancy);
            }
            self.reentrancy_lock = true;
            Ok(())
        }

        fn release_lock(&mut self) {
            self.reentrancy_lock = false;
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
            let new_balance = current.checked_add(amount).ok_or(SpotError::Overflow)?;
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
            // Reentrancy guard — must be acquired before the cross-contract
            // call so a malicious PSP22 token cannot recurse back into any
            // guarded message while the caller's balance is mid-transition.
            self.acquire_lock()?;

            if amount == 0 {
                self.release_lock();
                return Err(SpotError::ZeroAmount);
            }
            if amount < constants::MIN_DEPOSIT {
                self.release_lock();
                return Err(SpotError::DepositTooSmall);
            }
            if Self::is_native_token(&token) {
                self.release_lock();
                return Err(SpotError::PSP22TransferFailed);
            }

            let caller = self.env().caller();
            let current = self.balances.get((caller, token)).unwrap_or(0);
            let new_balance = current.checked_add(amount).ok_or_else(|| {
                self.release_lock();
                SpotError::Overflow
            })?;

            // Cross-contract call to PSP22 transfer_from
            // Calls token.transfer_from(caller, self, amount, data).
            // The PSP22 standard (and every token deployed in this repo)
            // returns `Result<(), PSP22Error>` — decoding it as
            // `Result<(), u8>` mis-decodes the error variant and makes a
            // successful transfer revert as PSP22TransferFailed. We decode
            // the canonical PSP22 return type, exactly like `PSP22Ref` in the
            // `pair`/`router` contracts.
            let transfer_result = ink::env::call::build_call::<ink::env::DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ink::env::call::ExecutionInput::new(ink::env::call::Selector::new(
                        // PSP22::transfer_from selector = 0x54b3c76e
                        ink::selector_bytes!("PSP22::transfer_from"),
                    ))
                    .push_arg(caller)
                    .push_arg(self.env().account_id())
                    .push_arg(amount)
                    .push_arg(Vec::<u8>::new()), // data
                )
                .returns::<Result<(), PSP22Error>>()
                .try_invoke();

            // Three layers must all be Ok for the transfer to have succeeded:
            // env error (CalleeTrapped/decode) -> LangError -> PSP22Error.
            match transfer_result {
                Ok(Ok(Ok(()))) => {}
                _ => {
                    self.release_lock();
                    return Err(SpotError::PSP22TransferFailed);
                }
            }

            self.balances.insert((caller, token), &new_balance);

            self.env().emit_event(DepositPSP22 {
                user: caller,
                token,
                amount,
            });

            self.release_lock();
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

            let new_balance = current.checked_sub(amount).ok_or(SpotError::Overflow)?;
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
            self.acquire_lock()?;

            if amount == 0 {
                self.release_lock();
                return Err(SpotError::ZeroAmount);
            }
            if Self::is_native_token(&token) {
                self.release_lock();
                return Err(SpotError::PSP22TransferFailed);
            }

            let caller = self.env().caller();
            let current = self.balances.get((caller, token)).unwrap_or(0);

            if current < amount {
                self.release_lock();
                return Err(SpotError::WithdrawExceedsBalance);
            }

            let new_balance = current.checked_sub(amount).ok_or_else(|| {
                self.release_lock();
                SpotError::Overflow
            })?;
            self.balances.insert((caller, token), &new_balance);

            // Cross-contract call to PSP22 transfer. Decode the canonical
            // PSP22 return type `Result<(), PSP22Error>` (see deposit_psp22).
            let transfer_result = ink::env::call::build_call::<ink::env::DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ink::env::call::ExecutionInput::new(ink::env::call::Selector::new(
                        // PSP22::transfer selector = 0xdb20f9f5
                        ink::selector_bytes!("PSP22::transfer"),
                    ))
                    .push_arg(caller)
                    .push_arg(amount)
                    .push_arg(Vec::<u8>::new()), // data
                )
                .returns::<Result<(), PSP22Error>>()
                .try_invoke();

            match transfer_result {
                Ok(Ok(Ok(()))) => {}
                _ => {
                    // Revert balance change
                    self.balances.insert((caller, token), &current);
                    self.release_lock();
                    return Err(SpotError::PSP22TransferFailed);
                }
            }

            self.release_lock();
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

            // Price validation: seller gets at least their limit, buyer pays at
            // most their limit. A relayer cannot choose an arbitrary better fee
            // for one side if it violates the other side's signed limit.
            let (buyer_limit_price, seller_limit_price) = if maker_order.side == SIDE_BUY {
                (maker_order.price, taker_order.price)
            } else {
                (taker_order.price, maker_order.price)
            };
            if fill_price < seller_limit_price || fill_price > buyer_limit_price {
                return Err(SpotError::PriceMismatch);
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

            let maker_order_hash = Self::build_order_hash(&maker_order);
            self.ensure_order_hash_matches(&maker_order, &maker_order_hash)?;
            let taker_order_hash = Self::build_order_hash(&taker_order);
            self.ensure_order_hash_matches(&taker_order, &taker_order_hash)?;

            // Check fill doesn't exceed the on-chain remaining amount. The
            // relayer-supplied filled_amount is not trusted because it is not
            // part of the signed order message.
            let maker_filled = self
                .filled_amounts
                .get((maker_order.maker, maker_order.nonce))
                .unwrap_or(0);
            let taker_filled = self
                .filled_amounts
                .get((taker_order.maker, taker_order.nonce))
                .unwrap_or(0);

            let maker_remaining = maker_order
                .amount
                .checked_sub(maker_filled)
                .ok_or(SpotError::FillExceedsRemaining)?;
            let taker_remaining = taker_order
                .amount
                .checked_sub(taker_filled)
                .ok_or(SpotError::FillExceedsRemaining)?;

            if fill_amount > maker_remaining || fill_amount > taker_remaining {
                return Err(SpotError::FillExceedsRemaining);
            }

            let new_maker_filled = maker_filled
                .checked_add(fill_amount)
                .ok_or(SpotError::Overflow)?;
            let new_taker_filled = taker_filled
                .checked_add(fill_amount)
                .ok_or(SpotError::Overflow)?;

            if new_maker_filled > maker_order.amount || new_taker_filled > taker_order.amount {
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

            let buyer_quote_balance = self.balances.get((buyer, quote_token)).unwrap_or(0);
            if buyer_quote_balance < buyer_quote_needed {
                return Err(SpotError::InsufficientBalance);
            }

            // Seller must have fill_amount of base token
            let seller_base_balance = self.balances.get((seller, base_token)).unwrap_or(0);
            if seller_base_balance < fill_amount {
                return Err(SpotError::InsufficientBalance);
            }

            // --- Calculate all post-trade state before mutating storage ---
            let new_buyer_quote = buyer_quote_balance
                .checked_sub(buyer_quote_needed)
                .ok_or(SpotError::Overflow)?;

            let seller_quote_balance = self.balances.get((seller, quote_token)).unwrap_or(0);
            let seller_receives_quote = quote_amount
                .checked_sub(seller_fee)
                .ok_or(SpotError::Overflow)?;
            let new_seller_quote = seller_quote_balance
                .checked_add(seller_receives_quote)
                .ok_or(SpotError::Overflow)?;

            let new_seller_base = seller_base_balance
                .checked_sub(fill_amount)
                .ok_or(SpotError::Overflow)?;

            let buyer_base_balance = self.balances.get((buyer, base_token)).unwrap_or(0);
            let new_buyer_base = buyer_base_balance
                .checked_add(fill_amount)
                .ok_or(SpotError::Overflow)?;

            let total_fee = maker_fee
                .checked_add(taker_fee)
                .ok_or(SpotError::Overflow)?;
            let current_fees = self.collected_fees.get(quote_token).unwrap_or(0);
            let new_fees = current_fees
                .checked_add(total_fee)
                .ok_or(SpotError::Overflow)?;

            // --- Execute atomic transfer ---
            self.balances.insert((buyer, quote_token), &new_buyer_quote);
            self.balances
                .insert((seller, quote_token), &new_seller_quote);
            self.balances.insert((seller, base_token), &new_seller_base);
            self.balances.insert((buyer, base_token), &new_buyer_base);
            self.collected_fees.insert(quote_token, &new_fees);
            self.filled_amounts
                .insert((maker_order.maker, maker_order.nonce), &new_maker_filled);
            self.filled_amounts
                .insert((taker_order.maker, taker_order.nonce), &new_taker_filled);
            self.order_hashes
                .insert((maker_order.maker, maker_order.nonce), &maker_order_hash);
            self.order_hashes
                .insert((taker_order.maker, taker_order.nonce), &taker_order_hash);

            // --- Mark nonces as used (if fully filled) ---
            if new_maker_filled == maker_order.amount {
                self.used_nonces
                    .insert((maker_order.maker, maker_order.nonce), &true);
            }
            if new_taker_filled == taker_order.amount {
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

            if self.used_nonces.get((caller, nonce)).unwrap_or(false) {
                return Err(SpotError::OrderAlreadyFilled);
            }

            if self.cancelled_nonces.get((caller, nonce)).unwrap_or(false) {
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

            if self.used_nonces.get((maker, nonce)).unwrap_or(false) {
                return Err(SpotError::OrderAlreadyFilled);
            }

            if self.cancelled_nonces.get((maker, nonce)).unwrap_or(false) {
                return Err(SpotError::OrderAlreadyCancelled);
            }

            self.cancelled_nonces.insert((maker, nonce), &true);

            self.env().emit_event(OrderCancelled { maker, nonce });

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

        /// Get the cumulative filled amount recorded on-chain for a maker nonce.
        #[ink(message)]
        pub fn get_filled_amount(&self, user: AccountId, nonce: u64) -> Balance {
            self.filled_amounts.get((user, nonce)).unwrap_or(0)
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

        /// Initiate two-step ownership transfer.
        /// Stores `new_owner` as pending; the new owner must call
        /// `accept_ownership` to complete the handover. A typo can be undone
        /// by re-calling this with the correct address (overwrites pending).
        #[ink(message)]
        pub fn transfer_ownership(&mut self, new_owner: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.pending_owner = Some(new_owner);
            Ok(())
        }

        /// Cancel a pending ownership transfer (current owner only).
        #[ink(message)]
        pub fn cancel_ownership_transfer(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.pending_owner = None;
            Ok(())
        }

        /// Accept a pending ownership transfer.
        /// Must be called by the address set via `transfer_ownership`.
        /// This two-step pattern prevents typos in `transfer_ownership` from
        /// permanently locking out admin control of the contract.
        #[ink(message)]
        pub fn accept_ownership(&mut self) -> Result<(), SpotError> {
            let caller = self.env().caller();
            match self.pending_owner {
                Some(pending) if pending == caller => {
                    self.owner = caller;
                    self.pending_owner = None;
                    Ok(())
                }
                _ => Err(SpotError::AccessDenied),
            }
        }

        /// Returns the pending owner (if any).
        #[ink(message)]
        pub fn pending_owner(&self) -> Option<AccountId> {
            self.pending_owner
        }

        /// Withdraw collected fees to treasury
        #[ink(message)]
        pub fn withdraw_fees(&mut self, token: AccountId) -> Result<(), SpotError> {
            self.ensure_owner()?;

            let fees = self.collected_fees.get(token).unwrap_or(0);
            if fees == 0 {
                return Err(SpotError::ZeroAmount);
            }

            // Credit fees to treasury's vault balance
            let treasury_balance = self.balances.get((self.treasury, token)).unwrap_or(0);
            let new_treasury_balance = treasury_balance
                .checked_add(fees)
                .ok_or(SpotError::Overflow)?;

            self.collected_fees.insert(token, &0);
            self.balances
                .insert((self.treasury, token), &new_treasury_balance);

            Ok(())
        }

        // ========================================
        // INTERNAL HELPERS
        // ========================================

        /// Build the canonical byte message that the order maker must sign.
        ///
        /// Only the **immutable** order fields are included. `filled_amount` is
        /// excluded because the contract stores cumulative fills by maker nonce.
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
            // filled_amount intentionally excluded — on-chain storage is canonical.
            msg.extend_from_slice(&order.nonce.to_le_bytes());
            msg.extend_from_slice(&order.expiry.to_le_bytes());
            msg
        }

        fn build_order_hash(order: &SignedOrder) -> [u8; 32] {
            let msg = Self::build_order_message(order);
            let mut output = <Blake2x256 as HashOutput>::Type::default();
            ink::env::hash_bytes::<Blake2x256>(&msg, &mut output);
            output
        }

        /// Build the canonical **v2** byte payload of an order (ADR-001).
        ///
        /// ⚠️ INTEGRATION CONTRACT — the off-chain backend (spot-api relayer
        /// + attestor service) MUST reproduce this layout byte-for-byte. The
        /// attestor signs `blake2_256(build_order_message_v2(order))` with
        /// its secp256k1 key; `verify_order_signature` recovers that key
        /// on-chain via `ecdsa_recover` and compares it to `attestor_pubkey`.
        ///
        /// Only the **immutable** order fields are included. `filled_amount`
        /// is excluded (on-chain cumulative fill tracking is canonical) and
        /// `signature`/`attestation` are excluded (they are proofs OVER this
        /// payload, never part of it). Keeping the v2 payload free of the
        /// sr25519 signature means the SAME hash can later be verified
        /// directly against the maker's sr25519 signature when the Lunes
        /// runtime ships `sr25519_verify` (EXT-CRYPTO → ADR-001 option a),
        /// without another payload migration.
        ///
        /// Layout (integers little-endian, fixed order, no separators):
        ///   offset   0: b"lunex:v2:spot-order\n" (20 bytes, version-tagged
        ///               domain separator)
        ///   offset  20: maker        (32 bytes — AccountId raw bytes)
        ///   offset  52: base_token   (32 bytes)
        ///   offset  84: quote_token  (32 bytes)
        ///   offset 116: side         ( 1 byte — 0 = BUY, 1 = SELL)
        ///   offset 117: price        (16 bytes — u128 LE)
        ///   offset 133: amount       (16 bytes — u128 LE)
        ///   offset 149: nonce        ( 8 bytes — u64 LE)
        ///   offset 157: expiry       ( 8 bytes — u64 LE)
        ///   ──────────────────────────────────────────────
        ///   total: 165 bytes
        fn build_order_message_v2(order: &SignedOrder) -> Vec<u8> {
            const PREFIX_V2: &[u8] = b"lunex:v2:spot-order\n";
            let mut msg = Vec::with_capacity(165);
            msg.extend_from_slice(PREFIX_V2);
            msg.extend_from_slice(order.maker.as_ref());
            msg.extend_from_slice(order.base_token.as_ref());
            msg.extend_from_slice(order.quote_token.as_ref());
            msg.push(order.side);
            msg.extend_from_slice(&order.price.to_le_bytes());
            msg.extend_from_slice(&order.amount.to_le_bytes());
            // filled_amount intentionally excluded — on-chain storage is canonical.
            msg.extend_from_slice(&order.nonce.to_le_bytes());
            msg.extend_from_slice(&order.expiry.to_le_bytes());
            msg
        }

        /// 32-byte message hash the attestor signs: `blake2_256(payload_v2)`.
        fn build_attestation_hash(order: &SignedOrder) -> [u8; 32] {
            let msg = Self::build_order_message_v2(order);
            let mut output = <Blake2x256 as HashOutput>::Type::default();
            ink::env::hash_bytes::<Blake2x256>(&msg, &mut output);
            output
        }

        fn ensure_order_hash_matches(
            &self,
            order: &SignedOrder,
            order_hash: &[u8; 32],
        ) -> Result<(), SpotError> {
            if let Some(existing_hash) = self.order_hashes.get((order.maker, order.nonce)) {
                if existing_hash != *order_hash {
                    return Err(SpotError::OrderMismatch);
                }
            }
            Ok(())
        }

        /// Cryptographically validate a `SignedOrder` (ADR-001, option c).
        ///
        /// # Security model — 2-of-2 interim attestation
        ///
        /// `pallet-contracts` on the current Lunes runtime does NOT expose a
        /// `sr25519_verify` host function (EXT-CRYPTO dependency, P0-1), so
        /// the maker's sr25519 signature cannot be verified on-chain yet.
        /// Instead, while `signature_verification_enforced == true` (the
        /// DEFAULT) settlement requires an **ECDSA attestation**:
        ///
        ///   1. The maker signs the order with sr25519 (unchanged UX).
        ///   2. An independent **attestor service** (secp256k1 key, separate
        ///      host/process/secret from the relayer) verifies that sr25519
        ///      signature off-chain and, only if valid, signs
        ///      `blake2_256(build_order_message_v2(order))` with its key.
        ///   3. On-chain, this function runs
        ///      `ecdsa_recover(attestation, hash)` and compares the recovered
        ///      compressed pubkey with the owner-configured `attestor_pubkey`.
        ///
        /// Forging a settlement therefore requires compromising BOTH the
        /// relayer (extrinsic signer, `ensure_relayer_or_owner`) AND the
        /// attestor (per-order attestation) — 2-of-2. This is an **interim
        /// mitigation**, NOT trustless: when the Lunes runtime ships native
        /// `sr25519_verify` (EXT-CRYPTO, ADR-001 option a), the maker's own
        /// signature over the SAME v2 payload becomes verifiable on-chain
        /// (defense-in-depth third check or attestation replacement; the
        /// versioned payload prefix discriminates the regimes).
        ///
        /// Fail-closed behaviour while enforcement is active:
        ///   - No `attestor_pubkey` configured → `SignatureVerificationUnavailable`.
        ///   - Recover failure or pubkey mismatch → `AttestationInvalid`.
        ///
        /// What the RELAYER must still do (off-chain, unchanged):
        ///   - Verify each `SignedOrder.signature` against `build_order_message()`
        ///     using `@polkadot/util-crypto` before calling `settle_trade()`.
        ///   - See `spot-api/src/services/settlementService.ts`.
        fn verify_order_signature(&self, order: &SignedOrder) -> Result<(), SpotError> {
            // ── ENFORCED MODE (P0-1 / ADR-001, the DEFAULT) ──────────────
            // Require a real on-chain cryptographic check: the ECDSA
            // attestation by the independent attestor over the canonical v2
            // order payload. Without a configured attestor key the gate
            // stays fail-closed exactly as before.
            if self.signature_verification_enforced {
                let Some((tag, x)) = self.attestor_pubkey else {
                    return Err(SpotError::SignatureVerificationUnavailable);
                };
                let expected_pubkey = Self::join_pubkey(tag, x);
                // An all-zero sr25519 signature is always a relayer bug —
                // the attestor must never attest an unsigned order.
                if order.signature == [0u8; 64] {
                    return Err(SpotError::InvalidSignature);
                }
                let message_hash = Self::build_attestation_hash(order);
                let recovered = self
                    .env()
                    .ecdsa_recover(&order.attestation, &message_hash)
                    .map_err(|_| SpotError::AttestationInvalid)?;
                if recovered != expected_pubkey {
                    return Err(SpotError::AttestationInvalid);
                }
                return Ok(());
            }
            // ── EXPLICIT TESTNET MODE (enforced == false) ────────────────
            // No cryptographic verification is performed. The relayer MUST
            // verify each signature off-chain against build_order_message()
            // (see spot-api/src/services/settlementService.ts).
            // Reject an all-zero signature — it is a sign of a relayer bug
            // where the signature field was never populated.
            if order.signature == [0u8; 64] {
                return Err(SpotError::InvalidSignature);
            }
            // Compute canonical message (validates that build_order_message compiles
            // correctly and keeps this function testable end-to-end in unit tests).
            let _msg = Self::build_order_message(order);
            Ok(())
        }

        // ========================================
        // SIGNATURE-ENFORCEMENT GATE (ADMIN)
        // ========================================

        /// Returns whether the fail-closed signature gate is active.
        #[ink(message)]
        pub fn is_signature_verification_enforced(&self) -> bool {
            self.signature_verification_enforced
        }

        /// Enable/disable the fail-closed signature gate. Owner only (the
        /// owner role itself is protected by two-step ownership transfer).
        ///
        /// `false` is an EXPLICIT testnet-only mode: `settle_trade` will
        /// accept orders whose signatures were only verified OFF-chain by the
        /// relayer. Every state change emits `SignatureEnforcementChanged`
        /// so indexers and alerting can audit the transition on-chain.
        #[ink(message)]
        pub fn set_signature_verification_enforced(
            &mut self,
            enforced: bool,
        ) -> Result<(), SpotError> {
            self.ensure_owner()?;
            if !enforced {
                return Err(SpotError::EnforcementTimelockNotExpired)
            }
            self.signature_verification_enforced = true;
            self.env().emit_event(SignatureEnforcementChanged {
                enforced: true,
                changed_by: self.env().caller(),
            });
            Ok(())
        }

        /// Begin the two-step disable-enforcement flow. Owner only.
        /// Records `block_timestamp + enforcement_timelock_ms` as the execution
        /// deadline in `pending_enforcement_off`. The proposal can be cancelled
        /// at any time with `cancel_disable_enforcement`.
        #[ink(message)]
        pub fn propose_disable_enforcement(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.pending_enforcement_off =
                Some(self.env().block_timestamp() + self.enforcement_timelock_ms);
            Ok(())
        }

        /// Cancel a pending disable-enforcement proposal. Owner only.
        /// Clears `pending_enforcement_off`; a subsequent
        /// `execute_disable_enforcement` will return `NoPendingEnforcementDisable`.
        #[ink(message)]
        pub fn cancel_disable_enforcement(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.pending_enforcement_off = None;
            Ok(())
        }

        /// Complete the two-step disable-enforcement flow. Owner only.
        /// Requires an active proposal whose deadline has passed; sets
        /// `signature_verification_enforced` to `false` and emits
        /// `SignatureEnforcementChanged { enforced: false }`.
        #[ink(message)]
        pub fn execute_disable_enforcement(&mut self) -> Result<(), SpotError> {
            self.ensure_owner()?;
            let deadline = self
                .pending_enforcement_off
                .ok_or(SpotError::NoPendingEnforcementDisable)?;
            if self.env().block_timestamp() < deadline {
                return Err(SpotError::EnforcementTimelockNotExpired)
            }
            self.signature_verification_enforced = false;
            self.pending_enforcement_off = None;
            self.env().emit_event(SignatureEnforcementChanged {
                enforced: false,
                changed_by: self.env().caller(),
            });
            Ok(())
        }

        /// Returns the deadline timestamp (ms) for a pending
        /// disable-enforcement proposal, or `None` if no proposal is active.
        #[ink(message)]
        pub fn pending_enforcement_off(&self) -> Option<u64> {
            self.pending_enforcement_off
        }

        /// Split a 33-byte compressed SEC1 pubkey into its storage form
        /// `(tag_byte, x_coordinate)` — see `attestor_pubkey` field docs.
        fn split_pubkey(pubkey: &[u8; 33]) -> (u8, [u8; 32]) {
            let mut x = [0u8; 32];
            x.copy_from_slice(&pubkey[1..]);
            (pubkey[0], x)
        }

        /// Rebuild the 33-byte compressed SEC1 pubkey from its storage form.
        fn join_pubkey(tag: u8, x: [u8; 32]) -> [u8; 33] {
            let mut pubkey = [0u8; 33];
            pubkey[0] = tag;
            pubkey[1..].copy_from_slice(&x);
            pubkey
        }

        /// Returns the configured attestor public key (compressed secp256k1,
        /// 33 bytes), or `None` while no attestor has been registered.
        #[ink(message)]
        pub fn get_attestor_key(&self) -> Option<[u8; 33]> {
            self.attestor_pubkey
                .map(|(tag, x)| Self::join_pubkey(tag, x))
        }

        /// Register/rotate the ECDSA attestor public key (ADR-001, option c).
        /// Owner only. Every change emits `AttestorKeyChanged` so indexers
        /// and alerting can audit key rotations on-chain.
        ///
        /// While `signature_verification_enforced == true`, settlement only
        /// becomes possible AFTER this key is set — and every settled order
        /// must carry an ECDSA attestation recoverable to this key.
        #[ink(message)]
        pub fn set_attestor_key(&mut self, pubkey: [u8; 33]) -> Result<(), SpotError> {
            self.ensure_owner()?;
            self.attestor_pubkey = Some(Self::split_pubkey(&pubkey));
            self.env().emit_event(AttestorKeyChanged {
                attestor_pubkey: pubkey,
                changed_by: self.env().caller(),
            });
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

        fn native_token() -> AccountId {
            AccountId::from(constants::ZERO_ADDRESS)
        }

        fn valid_order_signature() -> [u8; 64] {
            let mut signature = [0u8; 64];
            signature[0] = 1;
            signature
        }

        /// Placeholder attestation for tests that run in explicit testnet
        /// mode (`signature_verification_enforced == false`), where the
        /// attestation path is skipped entirely.
        fn no_attestation() -> [u8; 65] {
            [0u8; 65]
        }

        // ─── ECDSA attestation test fixtures (ADR-001, option c) ───
        //
        // `ecdsa_recover` is a pure function, fully supported by the ink!
        // off-chain engine (ink_engine -> secp256k1 crate), so these tests
        // perform REAL sign/recover round-trips with a deterministic test
        // keypair (fixed secret key bytes — NEVER use in production).

        /// Deterministic attestor secret key for tests: 32 bytes of 0x42.
        fn attestor_secret() -> secp256k1::SecretKey {
            secp256k1::SecretKey::from_slice(&[0x42u8; 32])
                .expect("0x42*32 is a valid secp256k1 secret key")
        }

        /// Compressed (33-byte) public key matching `attestor_secret()`.
        fn attestor_pubkey() -> [u8; 33] {
            let secp = secp256k1::Secp256k1::new();
            secp256k1::PublicKey::from_secret_key(&secp, &attestor_secret()).serialize()
        }

        /// Sign `blake2_256(build_order_message_v2(order))` with `secret`,
        /// producing the 65-byte `r ‖ s ‖ recovery_id` attestation exactly
        /// like the off-chain attestor service must.
        fn sign_attestation_with(
            order: &SignedOrder,
            secret: &secp256k1::SecretKey,
        ) -> [u8; 65] {
            let secp = secp256k1::Secp256k1::new();
            let hash = SpotSettlement::build_attestation_hash(order);
            let message = secp256k1::Message::from_slice(&hash)
                .expect("blake2_256 output is 32 bytes");
            let recoverable = secp.sign_ecdsa_recoverable(&message, secret);
            let (recovery_id, compact) = recoverable.serialize_compact();
            let mut attestation = [0u8; 65];
            attestation[..64].copy_from_slice(&compact);
            attestation[64] = recovery_id.to_i32() as u8;
            attestation
        }

        /// Attestation by the canonical test attestor key.
        fn sign_attestation(order: &SignedOrder) -> [u8; 65] {
            sign_attestation_with(order, &attestor_secret())
        }

        fn set_account_balance(account: AccountId, balance: Balance) {
            ink::env::test::set_account_balance::<ink::env::DefaultEnvironment>(account, balance);
        }

        fn get_contract_id() -> AccountId {
            ink::env::account_id::<ink::env::DefaultEnvironment>()
        }

        fn create_contract() -> SpotSettlement {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());
            // Settlement-logic tests run in EXPLICIT testnet mode: the
            // fail-closed signature gate (P0-1) is disabled by the owner
            // (alice) via the B3 two-step timelock flow.
            contract
                .propose_disable_enforcement()
                .expect("owner proposes disable");
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(172_800_001);
            contract
                .execute_disable_enforcement()
                .expect("owner executes disable after delay");
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

        // ─── Signature-Enforcement Gate Tests (P0-1 fail-closed) ───

        #[ink::test]
        fn test_signature_enforcement_default_is_enforced() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let contract = SpotSettlement::new(treasury_id());
            assert!(contract.is_signature_verification_enforced());
        }

        #[ink::test]
        fn test_settle_trade_blocked_when_enforcement_active() {
            // Fresh contract WITHOUT the create_contract() testnet override —
            // the fail-closed default must block settlement outright.
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            let maker_order = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Err(SpotError::SignatureVerificationUnavailable)
            );
            // No balances were touched by the blocked settlement.
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, base), 5_000_000_000);
        }

        #[ink::test]
        fn test_owner_can_disable_enforcement_and_event_is_emitted() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Propose the disable (emits nothing).
            assert!(contract.propose_disable_enforcement().is_ok());
            // Advance past the 48-hour deadline.
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + 172_800_001,
            );

            let events_before = test::recorded_events().count();
            // Execute: this emits exactly one SignatureEnforcementChanged event.
            assert!(contract.execute_disable_enforcement().is_ok());
            assert!(!contract.is_signature_verification_enforced());

            let events: Vec<_> = test::recorded_events().collect();
            assert_eq!(events.len(), events_before + 1);

            type Event = <SpotSettlement as ::ink::reflect::ContractEventBase>::Type;
            let decoded =
                <Event as scale::Decode>::decode(&mut &events.last().unwrap().data[..])
                    .expect("SignatureEnforcementChanged must decode");
            match decoded {
                Event::SignatureEnforcementChanged(e) => {
                    assert!(!e.enforced);
                    assert_eq!(e.changed_by, accounts.alice);
                }
                _ => panic!("expected SignatureEnforcementChanged event"),
            }

            // Re-enabling also works and emits another auditable event.
            assert!(contract.set_signature_verification_enforced(true).is_ok());
            assert!(contract.is_signature_verification_enforced());
            assert_eq!(test::recorded_events().count(), events_before + 2);
        }

        #[ink::test]
        fn test_non_owner_cannot_change_enforcement() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            set_caller(accounts.bob);
            assert_eq!(
                contract.set_signature_verification_enforced(false),
                Err(SpotError::AccessDenied)
            );
            assert!(contract.is_signature_verification_enforced());
        }

        // ─── ECDSA Attestation Tests (ADR-001, option c — 2-of-2) ───

        /// Enforced-mode contract (the production default) with the test
        /// attestor key registered and bob/charlie funded for a BUY/SELL
        /// match (base = 0xBB, quote = 0xCC).
        fn create_enforced_contract_with_attestor() -> SpotSettlement {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());
            assert!(contract.is_signature_verification_enforced());
            contract
                .set_attestor_key(attestor_pubkey())
                .expect("owner can register the attestor key");

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);
            contract
        }

        /// Matched BUY (bob) / SELL (charlie) order pair, both attested by
        /// the canonical test attestor key.
        fn attested_order_pair() -> (SignedOrder, SignedOrder) {
            let accounts = default_accounts();
            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            let mut maker_order = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };
            maker_order.attestation = sign_attestation(&maker_order);

            let mut taker_order = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };
            taker_order.attestation = sign_attestation(&taker_order);

            (maker_order, taker_order)
        }

        #[ink::test]
        fn test_settle_trade_with_valid_attestation_succeeds() {
            let accounts = default_accounts();
            let mut contract = create_enforced_contract_with_attestor();
            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);
            let (maker_order, taker_order) = attested_order_pair();

            // Enforcement stays ON — the real ECDSA recover path must pass.
            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Ok(())
            );

            // quote_amount = 1e9 * 2e8 / 1e8 = 2_000_000_000
            // buyer (bob, maker, 10 bps fee) pays 2_000_000_000 + 2_000_000
            // seller (charlie, taker, 25 bps fee) receives 2_000_000_000 - 5_000_000
            assert_eq!(contract.get_balance(accounts.bob, base), 1_000_000_000);
            assert_eq!(
                contract.get_balance(accounts.bob, quote),
                10_000_000_000 - 2_002_000_000
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, quote),
                1_995_000_000
            );
            assert_eq!(contract.get_balance(accounts.charlie, base), 4_000_000_000);
        }

        #[ink::test]
        fn test_settle_trade_attestation_from_wrong_key_fails() {
            let accounts = default_accounts();
            let mut contract = create_enforced_contract_with_attestor();
            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);
            let (mut maker_order, taker_order) = attested_order_pair();

            // Re-attest the maker order with a DIFFERENT secp256k1 key:
            // ecdsa_recover succeeds but yields a pubkey != attestor_pubkey.
            let rogue_secret = secp256k1::SecretKey::from_slice(&[0x24u8; 32])
                .expect("0x24*32 is a valid secp256k1 secret key");
            maker_order.attestation = sign_attestation_with(&maker_order, &rogue_secret);

            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Err(SpotError::AttestationInvalid)
            );
            // No state was touched.
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, base), 5_000_000_000);
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
        }

        #[ink::test]
        fn test_settle_trade_tampered_payload_fails() {
            let accounts = default_accounts();
            let mut contract = create_enforced_contract_with_attestor();
            let quote = AccountId::from([0xCC; 32]);
            let (mut maker_order, taker_order) = attested_order_pair();

            // Tamper a signed field AFTER attestation: the v2 hash changes,
            // so the recovered pubkey no longer matches the attestor's.
            maker_order.price = maker_order.price.wrapping_add(1);

            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Err(SpotError::AttestationInvalid)
            );
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
        }

        #[ink::test]
        fn test_settle_trade_enforced_without_attestor_key_stays_blocked() {
            // Fresh enforced contract WITHOUT a registered attestor key:
            // even orders carrying valid attestations must stay blocked
            // (fail-closed, same observable behaviour as before ADR-001).
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());
            assert_eq!(contract.get_attestor_key(), None);

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);
            let (maker_order, taker_order) = attested_order_pair();

            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Err(SpotError::SignatureVerificationUnavailable)
            );
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, base), 5_000_000_000);
        }

        #[ink::test]
        fn test_only_owner_sets_attestor_key_and_event_is_emitted() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Non-owner cannot register an attestor key.
            set_caller(accounts.bob);
            assert_eq!(
                contract.set_attestor_key(attestor_pubkey()),
                Err(SpotError::AccessDenied)
            );
            assert_eq!(contract.get_attestor_key(), None);

            // Owner can, and the change is audited via AttestorKeyChanged.
            set_caller(accounts.alice);
            let events_before = test::recorded_events().count();
            assert!(contract.set_attestor_key(attestor_pubkey()).is_ok());
            assert_eq!(contract.get_attestor_key(), Some(attestor_pubkey()));

            let events: Vec<_> = test::recorded_events().collect();
            assert_eq!(events.len(), events_before + 1);

            type Event = <SpotSettlement as ::ink::reflect::ContractEventBase>::Type;
            let decoded =
                <Event as scale::Decode>::decode(&mut &events.last().unwrap().data[..])
                    .expect("AttestorKeyChanged must decode");
            match decoded {
                Event::AttestorKeyChanged(e) => {
                    assert_eq!(e.attestor_pubkey, attestor_pubkey());
                    assert_eq!(e.changed_by, accounts.alice);
                }
                _ => panic!("expected AttestorKeyChanged event"),
            }
        }

        #[ink::test]
        fn test_enforced_mode_rejects_zero_maker_signature_even_with_attestation() {
            let mut contract = create_enforced_contract_with_attestor();
            let (mut maker_order, taker_order) = attested_order_pair();

            // The attestor must never attest an unsigned order; an all-zero
            // sr25519 signature is rejected before the ECDSA recover runs.
            maker_order.signature = [0u8; 64];
            maker_order.attestation = sign_attestation(&maker_order);

            assert_eq!(
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000),
                Err(SpotError::InvalidSignature)
            );
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

        #[ink::test]
        fn test_deposit_psp22_overflow_rejects_before_transfer() {
            let accounts = default_accounts();
            let mut contract = create_contract();
            set_caller(accounts.bob);

            let token = AccountId::from([0xCC; 32]);
            contract.balances.insert((accounts.bob, token), &u128::MAX);

            assert_eq!(
                contract.deposit_psp22(token, constants::MIN_DEPOSIT),
                Err(SpotError::Overflow)
            );
            assert_eq!(contract.get_balance(accounts.bob, token), u128::MAX);
        }

        // NOTE on the PSP22 decode fix: `deposit_psp22`/`withdraw_psp22` now
        // decode the token's return as the canonical `Result<(), PSP22Error>`
        // (every token in this repo returns this — `pair`/`router` use the
        // same `PSP22Ref` pattern), NOT `Result<(), u8>` which mis-decoded a
        // successful transfer into PSP22TransferFailed. The cross-call success
        // path cannot run in an off-chain `#[ink::test]` (the ink 4.3 off-chain
        // engine panics: "does not support contract invocation"), so it is
        // proven end-to-end on-chain — see fix-contract-deposit-psp22 report.
        // The settle-side PSP22/PSP22 accounting is proven by the unit test
        // below, which operates on funded vaults exactly as a successful
        // deposit_psp22 would leave them.

        // Proves `settle_trade` atomically moves PSP22/PSP22 vault balances
        // (both legs are non-native AccountIds = PSP22 tokens, exactly like
        // the WLUNES/LBTC/LETH/GMC/LUP pairs that were stuck on Bloqueador B).
        // Funding here simulates a successful `deposit_psp22` crediting each
        // vault, which the decode fix now enables on-chain.
        #[ink::test]
        fn test_settle_trade_psp22_pair_moves_vault_balances() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            // PSP22/PSP22 pair (e.g. LBTC base / LUSDT quote): both non-native.
            let base = AccountId::from([0xB1; 32]);
            let quote = AccountId::from([0xC2; 32]);

            // Simulate funded vaults (post deposit_psp22):
            // buyer (bob) holds quote, seller (charlie) holds base.
            contract
                .balances
                .insert((accounts.bob, quote), &10_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &5_000_000_000);

            let maker_order = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            let result =
                contract.settle_trade(maker_order, taker_order, 1_000_000_000, 200_000_000);
            assert!(result.is_ok());

            // Buyer paid 2B quote + 2M fee, received 1B base.
            assert_eq!(contract.get_balance(accounts.bob, quote), 7_998_000_000);
            assert_eq!(contract.get_balance(accounts.bob, base), 1_000_000_000);
            // Seller delivered 1B base, received 2B quote - 5M fee.
            assert_eq!(contract.get_balance(accounts.charlie, base), 4_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, quote), 1_995_000_000);
            // Fees collected in quote token.
            assert_eq!(contract.get_collected_fees(quote), 7_000_000);
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
        fn test_transfer_ownership_two_step() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            // Step 1: Alice initiates transfer to Bob.
            assert!(contract.transfer_ownership(accounts.bob).is_ok());
            // Owner unchanged until Bob accepts.
            assert_eq!(contract.get_owner(), accounts.alice);
            assert_eq!(contract.pending_owner(), Some(accounts.bob));

            // Wrong caller cannot accept.
            set_caller(accounts.charlie);
            assert_eq!(contract.accept_ownership(), Err(SpotError::AccessDenied));

            // Step 2: Bob accepts.
            set_caller(accounts.bob);
            assert!(contract.accept_ownership().is_ok());
            assert_eq!(contract.get_owner(), accounts.bob);
            assert_eq!(contract.pending_owner(), None);

            // Alice no longer has access.
            set_caller(accounts.alice);
            assert_eq!(contract.pause(), Err(SpotError::AccessDenied));
        }

        #[ink::test]
        fn test_cancel_ownership_transfer() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            assert!(contract.transfer_ownership(accounts.bob).is_ok());
            assert_eq!(contract.pending_owner(), Some(accounts.bob));

            assert!(contract.cancel_ownership_transfer().is_ok());
            assert_eq!(contract.pending_owner(), None);

            // Bob can no longer accept after cancel.
            set_caller(accounts.bob);
            assert_eq!(contract.accept_ownership(), Err(SpotError::AccessDenied));
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            let fill_amount = 1_000_000_000; // 10.0 base
            let fill_price = 200_000_000; // 2.0

            let result = contract.settle_trade(maker_order, taker_order, fill_amount, fill_price);
            assert!(result.is_ok());

            // quote_amount = 1_000_000_000 * 200_000_000 / 100_000_000 = 2_000_000_000
            // maker_fee (buyer) = 2_000_000_000 * 10 / 10_000 = 2_000_000
            // taker_fee (seller) = 2_000_000_000 * 25 / 10_000 = 5_000_000

            // Bob (buyer): had 10B quote, spent 2B + 2M fee = 7_998_000_000 remaining
            assert_eq!(contract.get_balance(accounts.bob, quote), 7_998_000_000);
            // Bob (buyer): received 1B base
            assert_eq!(contract.get_balance(accounts.bob, base), 1_000_000_000);
            // Charlie (seller): had 5B base, spent 1B = 4B remaining
            assert_eq!(contract.get_balance(accounts.charlie, base), 4_000_000_000);
            // Charlie (seller): received 2B - 5M fee = 1_995_000_000
            assert_eq!(contract.get_balance(accounts.charlie, quote), 1_995_000_000);

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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            // Fill price 200M < seller's ask 300M
            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 200_000_000),
                Err(SpotError::PriceMismatch)
            );
        }

        #[ink::test]
        fn test_settle_trade_rejects_fill_above_buyer_limit_price() {
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
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 300_000_000),
                Err(SpotError::PriceMismatch)
            );
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
            assert_eq!(contract.get_balance(accounts.bob, base), 0);
            assert_eq!(contract.get_balance(accounts.charlie, base), 5_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, quote), 0);
        }

        #[ink::test]
        fn test_settle_trade_rejects_blank_order_signature() {
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
                price: 200_000_000,
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: [0u8; 64],
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000_000, 200_000_000),
                Err(SpotError::InvalidSignature)
            );
            assert_eq!(contract.get_balance(accounts.bob, quote), 10_000_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, base), 5_000_000_000);
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
        }

        #[ink::test]
        fn test_failed_settlement_overflow_does_not_partially_mutate_balances() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract.balances.insert((accounts.bob, quote), &2_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &1_000_000);
            contract
                .balances
                .insert((accounts.charlie, quote), &u128::MAX);

            let maker = SignedOrder {
                maker: accounts.bob,
                base_token: base,
                quote_token: quote,
                side: SIDE_BUY,
                price: 100_000_000,
                amount: 1_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            let taker = SignedOrder {
                maker: accounts.charlie,
                base_token: base,
                quote_token: quote,
                side: SIDE_SELL,
                price: 100_000_000,
                amount: 1_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker, taker, 1_000_000, 100_000_000),
                Err(SpotError::Overflow)
            );
            assert_eq!(contract.get_balance(accounts.bob, quote), 2_000_000);
            assert_eq!(contract.get_balance(accounts.bob, base), 0);
            assert_eq!(contract.get_balance(accounts.charlie, base), 1_000_000);
            assert_eq!(contract.get_balance(accounts.charlie, quote), u128::MAX);
            assert_eq!(contract.get_collected_fees(quote), 0);
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            // Fill only 500M out of 2B (partial)
            let result = contract.settle_trade(maker, taker, 500_000_000, 100_000_000);
            assert!(result.is_ok());

            // quote_amount = 500M * 100M / 100M = 500M
            // maker_fee = 500M * 10 / 10000 = 500_000
            // taker_fee = 500M * 25 / 10000 = 1_250_000

            // Bob: 10B - 500M - 500K = 9_499_500_000
            assert_eq!(contract.get_balance(accounts.bob, quote), 9_499_500_000);
            // Bob received 500M base
            assert_eq!(contract.get_balance(accounts.bob, base), 500_000_000);
            // Nonces should NOT be marked used (partial fill)
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
            assert_eq!(contract.get_filled_amount(accounts.bob, 1), 500_000_000);
            assert_eq!(contract.get_filled_amount(accounts.charlie, 1), 500_000_000);
        }

        #[ink::test]
        fn test_repeated_partial_fill_cannot_exceed_order_amount() {
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
                amount: 1_000_000_000,
                filled_amount: 0,
                nonce: 1,
                expiry: 0,
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker.clone(), taker.clone(), 600_000_000, 100_000_000),
                Ok(())
            );

            let buyer_quote_after_first = contract.get_balance(accounts.bob, quote);
            let buyer_base_after_first = contract.get_balance(accounts.bob, base);
            let seller_base_after_first = contract.get_balance(accounts.charlie, base);
            let seller_quote_after_first = contract.get_balance(accounts.charlie, quote);
            let fees_after_first = contract.get_collected_fees(quote);

            assert_eq!(
                contract.settle_trade(maker, taker, 600_000_000, 100_000_000),
                Err(SpotError::FillExceedsRemaining)
            );

            assert_eq!(
                contract.get_balance(accounts.bob, quote),
                buyer_quote_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.bob, base),
                buyer_base_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, base),
                seller_base_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, quote),
                seller_quote_after_first
            );
            assert_eq!(contract.get_collected_fees(quote), fees_after_first);
            assert!(!contract.is_nonce_used(accounts.bob, 1));
            assert!(!contract.is_nonce_used(accounts.charlie, 1));
        }

        #[ink::test]
        fn test_partial_fill_rejects_changed_order_fields_for_same_nonce() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let base = AccountId::from([0xBB; 32]);
            let quote = AccountId::from([0xCC; 32]);

            contract
                .balances
                .insert((accounts.bob, quote), &20_000_000_000);
            contract
                .balances
                .insert((accounts.charlie, base), &20_000_000_000);

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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
            };

            assert_eq!(
                contract.settle_trade(maker.clone(), taker.clone(), 600_000_000, 100_000_000),
                Ok(())
            );

            let mut changed_maker = maker;
            changed_maker.amount = 10_000_000_000;
            let mut changed_taker = taker;
            changed_taker.amount = 10_000_000_000;

            let buyer_quote_after_first = contract.get_balance(accounts.bob, quote);
            let buyer_base_after_first = contract.get_balance(accounts.bob, base);
            let seller_base_after_first = contract.get_balance(accounts.charlie, base);
            let seller_quote_after_first = contract.get_balance(accounts.charlie, quote);
            let fees_after_first = contract.get_collected_fees(quote);

            assert_eq!(
                contract.settle_trade(changed_maker, changed_taker, 9_000_000_000, 100_000_000),
                Err(SpotError::OrderMismatch)
            );

            assert_eq!(
                contract.get_balance(accounts.bob, quote),
                buyer_quote_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.bob, base),
                buyer_base_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, base),
                seller_base_after_first
            );
            assert_eq!(
                contract.get_balance(accounts.charlie, quote),
                seller_quote_after_first
            );
            assert_eq!(contract.get_collected_fees(quote), fees_after_first);
            assert_eq!(contract.get_filled_amount(accounts.bob, 1), 600_000_000);
            assert_eq!(contract.get_filled_amount(accounts.charlie, 1), 600_000_000);
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
        fn test_failed_withdraw_fees_overflow_does_not_clear_fees() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = create_contract();

            let token = AccountId::from([0xCC; 32]);
            contract.collected_fees.insert(token, &10);
            contract.balances.insert((treasury_id(), token), &u128::MAX);

            assert_eq!(contract.withdraw_fees(token), Err(SpotError::Overflow));
            assert_eq!(contract.get_collected_fees(token), 10);
            assert_eq!(contract.get_balance(treasury_id(), token), u128::MAX);
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
                signature: valid_order_signature(),
                attestation: no_attestation(),
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
            assert_eq!(contract.get_balance(accounts.charlie, native_token()), 0);
        }

        // ─── B3: Signature-Enforcement Toggle Timelock Tests ───

        /// B3-T1a: Proves that after B3 lands, calling
        /// `set_signature_verification_enforced(false)` directly returns
        /// `EnforcementTimelockNotExpired`. This is the canonical RED test that
        /// drives the entire B3 implementation.
        #[ink::test]
        fn test_disable_enforcement_direct_call_is_rejected() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Direct disable must now be rejected — no bypass path.
            assert_eq!(
                contract.set_signature_verification_enforced(false),
                Err(SpotError::EnforcementTimelockNotExpired),
            );
            // Enforcement must remain ON (fail-closed).
            assert!(contract.is_signature_verification_enforced());
        }

        /// B3-T1b: Proves the propose → apply-before-delay path reverts with
        /// `EnforcementTimelockNotExpired`.
        #[ink::test]
        fn test_apply_disable_enforcement_before_delay_reverts() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Propose — must succeed.
            assert!(contract.propose_disable_enforcement().is_ok());
            // No time has passed: apply must revert.
            assert_eq!(
                contract.execute_disable_enforcement(),
                Err(SpotError::EnforcementTimelockNotExpired),
            );
            // Enforcement still ON.
            assert!(contract.is_signature_verification_enforced());
        }

        /// B3-T1c: After the 48-hour delay elapses, `execute_disable_enforcement`
        /// flips enforcement to `false` and emits `SignatureEnforcementChanged`.
        #[ink::test]
        fn test_apply_disable_enforcement_after_delay_succeeds() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Propose.
            assert!(contract.propose_disable_enforcement().is_ok());

            // Advance the block timestamp past the 48-hour deadline.
            // ENFORCEMENT_DISABLE_TIMELOCK_MS = 48 * 3_600_000 = 172_800_000 ms.
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + 172_800_001,
            );

            let events_before = test::recorded_events().count();
            assert!(contract.execute_disable_enforcement().is_ok());
            assert!(!contract.is_signature_verification_enforced());

            // A `SignatureEnforcementChanged { enforced: false }` event must be emitted.
            let events: Vec<_> = test::recorded_events().collect();
            assert_eq!(events.len(), events_before + 1);
            type Event = <SpotSettlement as ::ink::reflect::ContractEventBase>::Type;
            let decoded =
                <Event as scale::Decode>::decode(&mut &events.last().unwrap().data[..])
                    .expect("must decode SignatureEnforcementChanged");
            match decoded {
                Event::SignatureEnforcementChanged(e) => {
                    assert!(!e.enforced);
                    assert_eq!(e.changed_by, accounts.alice);
                }
                _ => panic!("expected SignatureEnforcementChanged event"),
            }

            // Pending state is cleared after execution.
            assert_eq!(contract.pending_enforcement_off(), None);
        }

        /// B3-T1d: Re-enabling enforcement (true) remains immediate — no
        /// timelock needed; tightening security is always safe.
        #[ink::test]
        fn test_enable_enforcement_is_still_immediate() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // First disable via the correct two-step flow.
            assert!(contract.propose_disable_enforcement().is_ok());
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + 172_800_001,
            );
            assert!(contract.execute_disable_enforcement().is_ok());
            assert!(!contract.is_signature_verification_enforced());

            // Re-enable must work immediately.
            assert!(contract.set_signature_verification_enforced(true).is_ok());
            assert!(contract.is_signature_verification_enforced());
        }

        /// B3-T1e: Only the owner can propose or execute the timelock.
        #[ink::test]
        fn test_non_owner_cannot_propose_or_execute_disable() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            // Non-owner propose attempt.
            set_caller(accounts.bob);
            assert_eq!(
                contract.propose_disable_enforcement(),
                Err(SpotError::AccessDenied),
            );

            // Owner proposes.
            set_caller(accounts.alice);
            assert!(contract.propose_disable_enforcement().is_ok());

            // Non-owner execute attempt (even after delay).
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + 172_800_001,
            );
            set_caller(accounts.bob);
            assert_eq!(
                contract.execute_disable_enforcement(),
                Err(SpotError::AccessDenied),
            );
            // Enforcement still ON.
            assert!(contract.is_signature_verification_enforced());
        }

        /// B3-T1f: `cancel_disable_enforcement` clears the pending state;
        /// subsequent execute must revert with `NoPendingEnforcementDisable`.
        #[ink::test]
        fn test_cancel_disable_enforcement_clears_pending() {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut contract = SpotSettlement::new(treasury_id());

            assert!(contract.propose_disable_enforcement().is_ok());
            assert!(contract.pending_enforcement_off().is_some());

            assert!(contract.cancel_disable_enforcement().is_ok());
            assert_eq!(contract.pending_enforcement_off(), None);

            // Execute after cancel with expired time must now return NoPendingEnforcementDisable.
            let now = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                now + 172_800_001,
            );
            assert_eq!(
                contract.execute_disable_enforcement(),
                Err(SpotError::NoPendingEnforcementDisable),
            );
            assert!(contract.is_signature_verification_enforced());
        }
    }
}
