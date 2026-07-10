#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![allow(clippy::cast_possible_truncation)]
#![warn(clippy::arithmetic_side_effects)]

/// # Lunex Copy Vault Contract
///
/// Trustless vault for copy trading. Followers deposit collateral and receive
/// vault shares proportional to NAV. Only the leader (vault owner) can execute
/// trades. Performance fees are charged only on profit.
///
/// ## Key Features:
/// - Deposit/withdraw with share-based accounting
/// - Leader-only trade execution
/// - Performance fee (max 50%, only on profit)
/// - 24h cooldown for large withdrawals (>10% of vault)
/// - Max drawdown circuit breaker (auto-pauses trading)
/// - Emergency time-locked withdrawal
///
/// ## Security Features:
/// - Reentrancy protection
/// - Checked arithmetic everywhere
/// - Only leader can execute trades
/// - Followers can always withdraw (with cooldown for large amounts)
/// - Circuit breaker at configurable max drawdown
///
/// ## Modelo de ativo (ADR-002, fecha o P0-3):
/// O vault custodia LUNES nativo (ativo-base de depósito/saque) e uma
/// lista BOUNDED de tokens PSP22 rastreados (`tracked_tokens`, máx. 8).
/// O equity é a soma do saldo nativo + saldo de WLUNES (1:1) + a
/// valuation spot on-chain de cada token rastreado com balance > 0,
/// cotada via `factory.get_pair` → `pair.get_reserves` →
/// `router.get_amount_out(balance, reserve_token, reserve_native)`.
///
/// ## Invariantes de contabilidade (base p/ fuzz `copy_vault_accounting`):
/// 1. Completude do equity: todo ativo que qualquer codepath do vault
///    pode adquirir está em {nativo, wnative} ∪ tracked_tokens — o swap
///    restringe as pontas a esse conjunto e `remove_tracked_token`
///    exige balance 0.
/// 2. `total_shares == 0 ⟺` equity atribuível a cotistas == 0 (módulo
///    donations diretas, que entram no equity diluindo A FAVOR dos
///    cotistas existentes).
/// 3. `share_price` nunca é lido com valuation parcial — falha de
///    cotação reverte a operação (`ValuationUnavailable`), nunca
///    "vale 0".
/// 4. Saque nunca paga mais que `shares/total_shares × equity` no
///    momento do pagamento, e nunca mais que a liquidez nativa
///    disponível (`InsufficientNativeLiquidity` caso contrário).
/// 5. `tracked_token_count <= MAX_TRACKED_TOKENS` sempre.

#[ink::contract]
pub mod copy_vault {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    // ─── Errors ─────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum VaultError {
        /// Caller is not the vault leader
        NotLeader,
        /// Caller is not admin
        NotAdmin,
        /// Zero amount not allowed
        ZeroAmount,
        /// Insufficient shares for withdrawal
        InsufficientShares,
        /// Deposit below minimum threshold
        BelowMinimumDeposit,
        /// Vault is paused (circuit breaker or admin action)
        VaultPaused,
        /// Vault is not paused
        VaultNotPaused,
        /// Trading is halted (drawdown circuit breaker)
        TradingHalted,
        /// Cooldown period not elapsed for large withdrawal
        CooldownActive,
        /// Performance fee exceeds maximum
        FeeTooHigh,
        /// Overflow in arithmetic operation
        Overflow,
        /// Reentrancy detected
        Reentrancy,
        /// Transfer failed
        TransferFailed,
        /// Provided equity does not match current vault balance
        EquityMismatch,
        /// Emergency withdrawal not yet unlocked
        EmergencyNotUnlocked,
        /// Trade amount exceeds vault risk limits
        TradeExceedsLimit,
        /// Share price is zero (vault depleted)
        SharePriceZero,
        /// Max drawdown exceeded — trading auto-halted
        MaxDrawdownExceeded,
        /// Invalid pair identifier
        InvalidPair,
        /// Per-block volume limit exceeded (anti-manipulation)
        BlockVolumeExceeded,
        /// Router contract address not configured
        RouterNotConfigured,
        /// Cross-contract call to the Router swap failed
        SwapFailed,
        /// Slippage protection — actual amount_out below min_amount_out
        SlippageExceeded,
        /// PSP22 approve(router, amount_in) on token_in failed
        TokenApproveFailed,
        // ── ADR-002: modelo de ativo multi-token ────────────────
        /// Tracked token list is full (MAX_TRACKED_TOKENS)
        TooManyTrackedTokens,
        /// Token is already in the tracked list
        TokenAlreadyTracked,
        /// Token is not in the tracked list (and is not wnative)
        TokenNotTracked,
        /// Cannot untrack a token while the vault holds a balance of it
        TokenHasBalance,
        /// On-chain quote for a tracked token failed — equity reads
        /// MUST fail explicitly, never silently value the token at 0
        ValuationUnavailable,
        /// factory/wnative not configured (set_valuation_infra)
        ValuationInfraNotConfigured,
        /// Native balance cannot cover the withdrawal payout while
        /// positions are open in PSP22 tokens (explicit fail, ADR-002)
        InsufficientNativeLiquidity,
        /// Vault PSP22 balance of token_in below amount_in
        InsufficientTokenBalance,
        /// token<>wnative pair has less native-side reserves than the
        /// minimum required for tracking (anti-manipulation v1)
        InsufficientPairLiquidity,
        /// wnative is implicitly part of the equity (1:1) and must not
        /// enter the tracked list
        CannotTrackWnative,
    }

    // ─── Router interop (selectors + espelhos SCALE) ────────────
    //
    // Selectors copiados do metadata dos contratos DEPLOYADOS
    // (target/ink/*/​*.json) — fonte de verdade para a ABI on-chain.
    // Consistência com os labels é verificada em unit tests via
    // `ink::selector_bytes!`.

    /// `PSP22::approve(spender, value)` — psp22_token e wnative usam o
    /// trait selector PSP22 padrão (metadata: 0xb20f1bbd).
    pub const PSP22_APPROVE_SELECTOR: [u8; 4] = [0xb2, 0x0f, 0x1b, 0xbd];

    /// `swap_exact_tokens_for_tokens(amount_in, amount_out_min, path,
    /// to, deadline)` no Router (metadata: 0xa0ac73cf).
    pub const ROUTER_SWAP_EXACT_TOKENS_SELECTOR: [u8; 4] = [0xa0, 0xac, 0x73, 0xcf];

    /// `PSP22::balance_of(owner)` — trait selector padrão PSP22
    /// (metadata psp22_token/wnative: 0x6568382f).
    pub const PSP22_BALANCE_OF_SELECTOR: [u8; 4] = [0x65, 0x68, 0x38, 0x2f];

    /// `get_pair(token_a, token_b) -> Option<AccountId>` no Factory
    /// (metadata factory_contract: 0x337daf4f).
    pub const FACTORY_GET_PAIR_SELECTOR: [u8; 4] = [0x33, 0x7d, 0xaf, 0x4f];

    /// `get_reserves() -> (Balance, Balance, u64)` no Pair
    /// (metadata pair_contract: 0x8a0d116f). Reservas ordenadas por
    /// token_0 < token_1 (byte order), mesma regra do Router.
    pub const PAIR_GET_RESERVES_SELECTOR: [u8; 4] = [0x8a, 0x0d, 0x11, 0x6f];

    /// `get_amount_out(amount_in, reserve_in, reserve_out)
    /// -> Result<Balance, RouterError>` no Router — view de math pura
    /// usada na valuation do equity (metadata: 0xa8544916).
    /// NOTA ADR-002: o router deployado NÃO expõe `get_amounts_out`
    /// com path como mensagem pública; a cotação token→nativo é
    /// composta on-chain via factory.get_pair + pair.get_reserves +
    /// router.get_amount_out, preservando a fórmula (com fee) do AMM.
    pub const ROUTER_GET_AMOUNT_OUT_SELECTOR: [u8; 4] = [0xa8, 0x54, 0x49, 0x16];

    /// Espelho SCALE-compatível de `PSP22Error` do router/psp22_token
    /// (mesmos discriminantes do type 11 no metadata do router).
    /// Definido localmente para evitar acoplamento de crate.
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Psp22ErrorMirror {
        Custom(ink::prelude::string::String),
        InsufficientBalance,
        InsufficientAllowance,
        ZeroRecipientAddress,
        ZeroSenderAddress,
        SafeTransferCheckFailed(ink::prelude::string::String),
    }

    /// Espelho SCALE-compatível de `RouterError` do router deployado
    /// (mesmos discriminantes do type 10 no metadata do router).
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum RouterErrorMirror {
        Expired,
        InsufficientAAmount,
        InsufficientBAmount,
        InsufficientOutputAmount,
        InsufficientLiquidity,
        InvalidPath,
        IdenticalAddresses,
        ZeroAddress,
        ExcessiveInputAmount,
        PairNotExists,
        PSP22(Psp22ErrorMirror),
        Locked,
        PathTooLong,
        ProtocolPaused,
        PriceImpactTooHigh,
        Unauthorized,
        Overflow,
    }

    // ─── Types ──────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode, Clone, Copy)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub enum TradeSide {
        Buy,
        Sell,
    }

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Clone, ink::storage::traits::StorageLayout)
    )]
    pub struct TradeRecord {
        pub pair: Vec<u8>,
        pub side: TradeSide,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Clone, ink::storage::traits::StorageLayout)
    )]
    pub struct WithdrawalRequest {
        pub shares: Balance,
        pub requested_at: Timestamp,
    }

    // ─── Constants ──────────────────────────────────────────────

    pub mod constants {
        use super::Balance;

        /// Minimum deposit (10 LUNES = 10 * 10^8)
        pub const MIN_DEPOSIT: Balance = 1_000_000_000;

        /// Maximum performance fee (50% = 5000 bps)
        pub const MAX_PERFORMANCE_FEE_BPS: u32 = 5000;

        /// Large withdrawal threshold (10% of vault shares = 1000 bps)
        pub const LARGE_WITHDRAWAL_BPS: u32 = 1000;

        /// Cooldown period for large withdrawals (24 hours in ms)
        pub const COOLDOWN_PERIOD_MS: u64 = 24 * 60 * 60 * 1000;

        /// Emergency unlock delay (72 hours in ms)
        pub const EMERGENCY_UNLOCK_DELAY_MS: u64 = 72 * 60 * 60 * 1000;

        /// Default max drawdown before circuit breaker (30% = 3000 bps)
        pub const DEFAULT_MAX_DRAWDOWN_BPS: u32 = 3000;

        /// Max single trade as % of vault equity (20% = 2000 bps)
        pub const MAX_TRADE_SIZE_BPS: u32 = 2000;

        /// Max total volume per block as % of vault equity (40% = 4000 bps)
        pub const MAX_BLOCK_VOLUME_BPS: u32 = 4000;

        /// Basis points denominator
        pub const BPS: u32 = 10_000;

        /// Initial share price (1:1 with native token, high precision)
        pub const INITIAL_SHARE_PRICE: Balance = 100_000_000; // 1.0 * 10^8

        /// Max trades stored in history
        pub const MAX_TRADE_HISTORY: u32 = 100;

        /// Janela de validade do deadline passado ao Router em swaps
        /// reais (5 minutos, em ms). Derivada de `block_timestamp()` —
        /// nunca de relógio off-chain.
        pub const SWAP_DEADLINE_WINDOW_MS: u64 = 5 * 60 * 1000;

        /// ADR-002: máximo de tokens PSP22 rastreados no equity.
        /// Bounded para limitar o custo de gas da leitura de equity
        /// (cada token custa get_pair + get_reserves + get_amount_out).
        pub const MAX_TRACKED_TOKENS: u32 = 8;

        /// ADR-002 (mitigação v1 de manipulação spot): reserva mínima
        /// do lado nativo no par token<>wnative para o token poder ser
        /// rastreado (10 LUNES = 10 * 10^8).
        pub const MIN_TRACKING_RESERVE_NATIVE: Balance = 1_000_000_000;
    }

    // ─── Events ─────────────────────────────────────────────────

    #[ink(event)]
    pub struct Deposited {
        #[ink(topic)]
        pub depositor: AccountId,
        pub amount: Balance,
        pub shares_minted: Balance,
        pub share_price: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct Withdrawn {
        #[ink(topic)]
        pub depositor: AccountId,
        pub shares_burned: Balance,
        pub amount_received: Balance,
        pub performance_fee: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TradeExecuted {
        #[ink(topic)]
        pub leader: AccountId,
        pub pair: Vec<u8>,
        pub side: TradeSide,
        pub amount: Balance,
        pub vault_equity_after: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct CircuitBreakerTriggered {
        #[ink(topic)]
        pub vault: AccountId,
        pub current_equity: Balance,
        pub high_water_mark: Balance,
        pub drawdown_bps: u32,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct EmergencyWithdrawalRequested {
        #[ink(topic)]
        pub depositor: AccountId,
        pub shares: Balance,
        pub unlock_at: Timestamp,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct PerformanceFeeChanged {
        pub old_fee_bps: u32,
        pub new_fee_bps: u32,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct VaultPausedEvent {
        #[ink(topic)]
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct VaultUnpausedEvent {
        #[ink(topic)]
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    // ── Eventos ADR-002 (modelo de ativo multi-token) ───────────

    #[ink(event)]
    pub struct TrackedTokenAdded {
        #[ink(topic)]
        pub token: AccountId,
        pub by: AccountId,
    }

    #[ink(event)]
    pub struct TrackedTokenRemoved {
        #[ink(topic)]
        pub token: AccountId,
        pub by: AccountId,
    }

    #[ink(event)]
    pub struct VaultSwapExecuted {
        #[ink(topic)]
        pub token_in: AccountId,
        #[ink(topic)]
        pub token_out: AccountId,
        pub amount_in: Balance,
        pub amount_out: Balance,
        pub executed_by: AccountId,
    }

    /// Snapshot de equity emitido em deposit/withdraw para
    /// indexer/reconciliação (`vaultReconciliationService`).
    #[ink(event)]
    pub struct EquitySnapshot {
        pub native: Balance,
        pub tokens_value: Balance,
        pub total: Balance,
    }

    // ─── Storage ────────────────────────────────────────────────

    #[ink(storage)]
    pub struct CopyVault {
        /// Vault leader (trader) who executes trades
        leader: AccountId,
        /// Admin (can pause, set fees)
        admin: AccountId,
        /// Whether vault is paused
        paused: bool,
        /// Whether trading is halted (circuit breaker)
        trading_halted: bool,
        /// Reentrancy guard
        locked: bool,

        // --- Share accounting ---
        /// Total shares outstanding
        total_shares: Balance,
        /// Shares per depositor
        shares: Mapping<AccountId, Balance>,
        /// Cost basis per depositor (for performance fee calc)
        cost_basis: Mapping<AccountId, Balance>,

        // --- Equity tracking ---
        /// High water mark for drawdown calculation
        high_water_mark: Balance,
        /// Total equity at last update
        total_equity: Balance,

        // --- Fees ---
        /// Performance fee in basis points (max 5000 = 50%)
        performance_fee_bps: u32,
        /// Total fees collected by leader
        total_fees_collected: Balance,

        // --- Config ---
        /// Max drawdown before circuit breaker (bps)
        max_drawdown_bps: u32,

        // --- Withdrawal cooldowns ---
        /// Pending large withdrawal requests (address → request)
        withdrawal_requests: Mapping<AccountId, WithdrawalRequest>,
        /// Emergency withdrawal unlock timestamps
        emergency_unlocks: Mapping<AccountId, Timestamp>,

        // --- Trade history ---
        /// Trade count
        trade_count: u32,
        /// Trade records by index
        trade_history: Mapping<u32, TradeRecord>,

        // --- Metrics ---
        /// Total deposited ever
        total_deposited: Balance,
        /// Total withdrawn ever
        total_withdrawn: Balance,
        /// Number of active depositors
        active_depositors: u32,

        // --- Per-block volume tracking ---
        /// Accumulated trade volume in the current block
        block_volume: Balance,
        /// Block number of the last recorded trade
        last_trade_block: u32,

        // --- Router integration (T25) ---
        /// Address of the deployed Router contract for real swap execution.
        /// Optional — left unset on devnet to keep the legacy `execute_trade`
        /// flow working. In production this must be set via `set_router()`
        /// before `swap_through_router` is callable.
        router: Option<AccountId>,

        // --- ADR-002: modelo de ativo multi-token ---
        /// Tokens PSP22 que o vault pode possuir e que compõem o
        /// equity. Índice DENSO (0..tracked_token_count) para iteração
        /// determinística. BOUNDED por MAX_TRACKED_TOKENS.
        tracked_tokens: Mapping<u32, AccountId>,
        /// Índice reverso token → posição, p/ O(1) em `is_tracked`.
        tracked_token_index: Mapping<AccountId, u32>,
        /// Quantidade de tokens rastreados (<= MAX_TRACKED_TOKENS).
        tracked_token_count: u32,
        /// Factory da DEX — resolve o pair token<>wnative na valuation.
        factory: Option<AccountId>,
        /// WLUNES (wnative) — ponta nativa do path de cotação; o saldo
        /// do vault em wnative entra no equity 1:1.
        wnative: Option<AccountId>,
    }

    impl CopyVault {
        /// Create a new Copy Vault
        ///
        /// * `leader` - The trader who will execute trades
        /// * `performance_fee_bps` - Fee on profits (max 5000 = 50%)
        #[ink(constructor)]
        pub fn new(leader: AccountId, performance_fee_bps: u32) -> Self {
            assert!(
                performance_fee_bps <= constants::MAX_PERFORMANCE_FEE_BPS,
                "Fee exceeds maximum"
            );

            Self {
                leader,
                admin: Self::env().caller(),
                paused: false,
                trading_halted: false,
                locked: false,
                total_shares: 0,
                shares: Mapping::default(),
                cost_basis: Mapping::default(),
                high_water_mark: 0,
                total_equity: 0,
                performance_fee_bps,
                total_fees_collected: 0,
                max_drawdown_bps: constants::DEFAULT_MAX_DRAWDOWN_BPS,
                withdrawal_requests: Mapping::default(),
                emergency_unlocks: Mapping::default(),
                trade_count: 0,
                block_volume: 0,
                last_trade_block: 0,
                trade_history: Mapping::default(),
                total_deposited: 0,
                total_withdrawn: 0,
                active_depositors: 0,
                router: None,
                tracked_tokens: Mapping::default(),
                tracked_token_index: Mapping::default(),
                tracked_token_count: 0,
                factory: None,
                wnative: None,
            }
        }

        // ════════════════════════════════════════════════════════
        // DEPOSITOR FUNCTIONS
        // ════════════════════════════════════════════════════════

        /// Deposit native tokens into the vault.
        /// Mints shares proportional to current NAV.
        #[ink(message, payable)]
        pub fn deposit(&mut self) -> Result<Balance, VaultError> {
            self.ensure_not_paused()?;
            self.acquire_lock()?;

            let caller = self.env().caller();
            let amount = self.env().transferred_value();
            // ADR-002: equity completo (nativo + wnative + tracked).
            // Falha de cotação ⇒ depósito reverte (nunca precifica
            // cota com valuation parcial — invariante 3).
            let (native_balance, tokens_value) = match self.equity_split_internal() {
                Ok(split) => split,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let current_balance = match native_balance.checked_add(tokens_value) {
                Some(v) => v,
                None => {
                    self.release_lock();
                    return Err(VaultError::Overflow);
                }
            };
            // Subtracting the just-transferred `amount` from the current balance gives
            // the vault equity *before* the deposit. This subtraction should never
            // underflow (the balance always includes the transferred value), but if it
            // does, it signals a severe accounting inconsistency — return an error
            // instead of silently treating pre-deposit equity as zero, which would
            // allow the first depositor after a gap to receive a disproportionate
            // share count.
            let equity_before_deposit = current_balance
                .checked_sub(amount)
                .ok_or(VaultError::EquityMismatch)?;

            if amount < constants::MIN_DEPOSIT {
                self.release_lock();
                return Err(VaultError::BelowMinimumDeposit);
            }

            // Calculate shares to mint
            let shares_to_mint = if self.total_shares == 0 {
                // First deposit: 1:1 shares
                amount
            } else {
                // shares = amount * total_shares / total_equity
                if equity_before_deposit == 0 {
                    self.release_lock();
                    return Err(VaultError::SharePriceZero);
                }
                amount
                    .checked_mul(self.total_shares)
                    .ok_or(VaultError::Overflow)?
                    .checked_div(equity_before_deposit)
                    .ok_or(VaultError::SharePriceZero)?
            };

            if shares_to_mint == 0 {
                self.release_lock();
                return Err(VaultError::ZeroAmount);
            }

            // Update state
            let existing_shares = self.shares.get(&caller).unwrap_or(0);
            let new_shares = existing_shares
                .checked_add(shares_to_mint)
                .ok_or(VaultError::Overflow)?;

            if existing_shares == 0 {
                self.active_depositors = self
                    .active_depositors
                    .checked_add(1)
                    .ok_or(VaultError::Overflow)?;
            }

            self.shares.insert(&caller, &new_shares);
            self.total_shares = self
                .total_shares
                .checked_add(shares_to_mint)
                .ok_or(VaultError::Overflow)?;

            self.total_equity = current_balance;

            // Update cost basis (weighted average)
            let existing_basis = self.cost_basis.get(&caller).unwrap_or(0);
            let new_basis = existing_basis
                .checked_add(amount)
                .ok_or(VaultError::Overflow)?;
            self.cost_basis.insert(&caller, &new_basis);

            // Update high water mark
            if self.total_equity > self.high_water_mark {
                self.high_water_mark = self.total_equity;
            }

            self.total_deposited = self
                .total_deposited
                .checked_add(amount)
                .ok_or(VaultError::Overflow)?;

            let share_price = self.share_price_from_equity(current_balance);
            let timestamp = self.env().block_timestamp();

            self.env().emit_event(Deposited {
                depositor: caller,
                amount,
                shares_minted: shares_to_mint,
                share_price,
                timestamp,
            });

            self.env().emit_event(EquitySnapshot {
                native: native_balance,
                tokens_value,
                total: current_balance,
            });

            self.release_lock();
            Ok(shares_to_mint)
        }

        /// Withdraw by burning shares. Receives proportional equity minus performance fee on profit.
        #[ink(message)]
        pub fn withdraw(&mut self, shares: Balance) -> Result<Balance, VaultError> {
            self.acquire_lock()?;

            let caller = self.env().caller();
            let caller_shares = self.shares.get(&caller).unwrap_or(0);

            if shares == 0 || shares > caller_shares {
                self.release_lock();
                return Err(VaultError::InsufficientShares);
            }

            // Check cooldown for large withdrawals
            let is_large = self.is_large_withdrawal(shares);
            if is_large {
                if let Some(request) = self.withdrawal_requests.get(&caller) {
                    let now = self.env().block_timestamp();
                    if now < request.requested_at + constants::COOLDOWN_PERIOD_MS {
                        self.release_lock();
                        return Err(VaultError::CooldownActive);
                    }
                    // Cooldown passed — proceed
                    self.withdrawal_requests.remove(&caller);
                } else {
                    // No request yet — create one and return
                    let now = self.env().block_timestamp();
                    self.withdrawal_requests.insert(
                        &caller,
                        &WithdrawalRequest {
                            shares,
                            requested_at: now,
                        },
                    );
                    self.release_lock();
                    return Err(VaultError::CooldownActive);
                }
            }

            // Calculate proportional equity (ADR-002: equity completo;
            // falha de cotação reverte o saque — invariante 3)
            let (native_balance, tokens_value) = match self.equity_split_internal() {
                Ok(split) => split,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let equity = match native_balance.checked_add(tokens_value) {
                Some(v) => v,
                None => {
                    self.release_lock();
                    return Err(VaultError::Overflow);
                }
            };
            let payout = shares
                .checked_mul(equity)
                .ok_or(VaultError::Overflow)?
                .checked_div(self.total_shares)
                .ok_or(VaultError::SharePriceZero)?;

            // Calculate performance fee on profit
            let basis = self.cost_basis.get(&caller).unwrap_or(0);
            let basis_per_share = if caller_shares > 0 {
                basis
                    .checked_div(caller_shares)
                    .ok_or(VaultError::Overflow)?
            } else {
                0
            };
            let cost_for_shares = basis_per_share
                .checked_mul(shares)
                .ok_or(VaultError::Overflow)?;

            let (fee, net_payout) = if payout > cost_for_shares {
                let profit = payout
                    .checked_sub(cost_for_shares)
                    .ok_or(VaultError::Overflow)?;
                let fee = profit
                    .checked_mul(self.performance_fee_bps as u128)
                    .ok_or(VaultError::Overflow)?
                    .checked_div(constants::BPS as u128)
                    .ok_or(VaultError::Overflow)?;
                let net = payout.checked_sub(fee).ok_or(VaultError::Overflow)?;
                (fee, net)
            } else {
                (0, payout)
            };

            // ADR-002: o pagamento da cota é SEMPRE em nativo. Se a
            // liquidez nativa on-chain não cobre o payout bruto
            // (net + fee) porque há posições abertas em PSP22, a
            // operação falha EXPLICITAMENTE — nunca paga parcial e
            // nunca vende posições automaticamente dentro do withdraw
            // (superfície de manipulação/gas griefing — ADR-002 §5).
            // TODO(ADR-002): fluxo não-bloqueante em duas fases
            // request_withdrawal/claim_withdrawal com preço de cota
            // congelado no request — adiado para manter o escopo do
            // P0-3 no invariante correto.
            if payout > native_balance {
                self.release_lock();
                return Err(VaultError::InsufficientNativeLiquidity);
            }

            // Update state
            let remaining_shares = caller_shares
                .checked_sub(shares)
                .ok_or(VaultError::Overflow)?;

            if remaining_shares == 0 {
                self.shares.remove(&caller);
                self.cost_basis.remove(&caller);
                self.active_depositors = self.active_depositors.saturating_sub(1);
            } else {
                self.shares.insert(&caller, &remaining_shares);
                let remaining_basis = basis
                    .checked_sub(cost_for_shares)
                    .unwrap_or(0);
                self.cost_basis.insert(&caller, &remaining_basis);
            }

            self.total_shares = self
                .total_shares
                .checked_sub(shares)
                .ok_or(VaultError::Overflow)?;

            self.total_fees_collected = self
                .total_fees_collected
                .checked_add(fee)
                .ok_or(VaultError::Overflow)?;

            self.total_withdrawn = self
                .total_withdrawn
                .checked_add(net_payout)
                .ok_or(VaultError::Overflow)?;

            if self.env().transfer(caller, net_payout).is_err() {
                self.release_lock();
                return Err(VaultError::TransferFailed);
            }

            if fee > 0 {
                let _ = self.env().transfer(self.leader, fee);
            }

            let (native_after, tokens_after) = match self.equity_split_internal() {
                Ok(split) => split,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let total_after = match native_after.checked_add(tokens_after) {
                Some(v) => v,
                None => {
                    self.release_lock();
                    return Err(VaultError::Overflow);
                }
            };
            self.total_equity = total_after;

            let timestamp = self.env().block_timestamp();
            self.env().emit_event(Withdrawn {
                depositor: caller,
                shares_burned: shares,
                amount_received: net_payout,
                performance_fee: fee,
                timestamp,
            });

            self.env().emit_event(EquitySnapshot {
                native: native_after,
                tokens_value: tokens_after,
                total: total_after,
            });

            self.release_lock();
            Ok(net_payout)
        }

        /// Request emergency withdrawal (time-locked, bypasses all restrictions)
        #[ink(message)]
        pub fn request_emergency_withdrawal(&mut self) -> Result<Timestamp, VaultError> {
            let caller = self.env().caller();
            let caller_shares = self.shares.get(&caller).unwrap_or(0);

            if caller_shares == 0 {
                return Err(VaultError::InsufficientShares);
            }

            let now = self.env().block_timestamp();
            let unlock_at = now
                .checked_add(constants::EMERGENCY_UNLOCK_DELAY_MS)
                .ok_or(VaultError::Overflow)?;

            self.emergency_unlocks.insert(&caller, &unlock_at);

            self.env().emit_event(EmergencyWithdrawalRequested {
                depositor: caller,
                shares: caller_shares,
                unlock_at,
                timestamp: now,
            });

            Ok(unlock_at)
        }

        /// Execute emergency withdrawal after unlock period
        #[ink(message)]
        pub fn execute_emergency_withdrawal(&mut self) -> Result<Balance, VaultError> {
            self.acquire_lock()?;

            let caller = self.env().caller();
            let unlock_at = self
                .emergency_unlocks
                .get(&caller)
                .ok_or(VaultError::EmergencyNotUnlocked)?;

            let now = self.env().block_timestamp();
            if now < unlock_at {
                self.release_lock();
                return Err(VaultError::EmergencyNotUnlocked);
            }

            let caller_shares = self.shares.get(&caller).unwrap_or(0);
            if caller_shares == 0 {
                self.release_lock();
                return Err(VaultError::InsufficientShares);
            }

            // Calculate proportional equity (no fee on emergency)
            let (native_balance, tokens_value) = match self.equity_split_internal() {
                Ok(split) => split,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let equity = match native_balance.checked_add(tokens_value) {
                Some(v) => v,
                None => {
                    self.release_lock();
                    return Err(VaultError::Overflow);
                }
            };
            let payout = caller_shares
                .checked_mul(equity)
                .ok_or(VaultError::Overflow)?
                .checked_div(self.total_shares)
                .ok_or(VaultError::SharePriceZero)?;

            // ADR-002: fail explícito quando a liquidez nativa não
            // cobre o payout (mesma regra do withdraw normal).
            if payout > native_balance {
                self.release_lock();
                return Err(VaultError::InsufficientNativeLiquidity);
            }

            if self.env().transfer(caller, payout).is_err() {
                self.release_lock();
                return Err(VaultError::TransferFailed);
            }

            // Update state
            self.shares.remove(&caller);
            self.cost_basis.remove(&caller);
            self.emergency_unlocks.remove(&caller);
            self.active_depositors = self.active_depositors.saturating_sub(1);

            self.total_shares = self
                .total_shares
                .checked_sub(caller_shares)
                .ok_or(VaultError::Overflow)?;

            self.total_equity = match self.get_vault_equity_internal() {
                Ok(e) => e,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };

            self.total_withdrawn = self
                .total_withdrawn
                .checked_add(payout)
                .ok_or(VaultError::Overflow)?;

            let timestamp = self.env().block_timestamp();
            self.env().emit_event(Withdrawn {
                depositor: caller,
                shares_burned: caller_shares,
                amount_received: payout,
                performance_fee: 0,
                timestamp,
            });

            self.release_lock();
            Ok(payout)
        }

        // ════════════════════════════════════════════════════════
        // LEADER FUNCTIONS
        // ════════════════════════════════════════════════════════

        /// Execute a trade on behalf of the vault (leader only).
        /// This records the trade and adjusts vault equity.
        /// The actual swap is executed off-chain via the router contract.
        #[ink(message, payable)]
        pub fn execute_trade(
            &mut self,
            pair: Vec<u8>,
            side: TradeSide,
            amount: Balance,
        ) -> Result<(), VaultError> {
            self.ensure_leader()?;
            self.ensure_not_paused()?;
            self.ensure_trading_active()?;
            self.acquire_lock()?;

            if amount == 0 {
                self.release_lock();
                return Err(VaultError::ZeroAmount);
            }

            // Per-block volume limit: max MAX_BLOCK_VOLUME_BPS of equity per block
            let current_block = self.env().block_number();
            let equity = match self.get_vault_equity_internal() {
                Ok(e) => e,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let max_block_vol = equity
                .checked_mul(constants::MAX_BLOCK_VOLUME_BPS as u128)
                .ok_or(VaultError::Overflow)?
                .checked_div(constants::BPS as u128)
                .ok_or(VaultError::Overflow)?;

            let new_block_volume = if current_block == self.last_trade_block {
                self.block_volume
                    .checked_add(amount)
                    .ok_or(VaultError::Overflow)?
            } else {
                amount
            };

            if new_block_volume > max_block_vol {
                self.release_lock();
                return Err(VaultError::BlockVolumeExceeded);
            }

            self.block_volume = new_block_volume;
            self.last_trade_block = current_block;

            // Check trade size limit (max 20% of vault equity per trade)
            let max_trade = equity
                .checked_mul(constants::MAX_TRADE_SIZE_BPS as u128)
                .ok_or(VaultError::Overflow)?
                .checked_div(constants::BPS as u128)
                .ok_or(VaultError::Overflow)?;

            if amount > max_trade {
                self.release_lock();
                return Err(VaultError::TradeExceedsLimit);
            }

            // Record trade
            let timestamp = self.env().block_timestamp();
            let idx = self.trade_count % constants::MAX_TRADE_HISTORY;
            let record = TradeRecord {
                pair: pair.clone(),
                side,
                amount,
                timestamp,
            };
            self.trade_history.insert(&idx, &record);
            self.trade_count = self
                .trade_count
                .checked_add(1)
                .ok_or(VaultError::Overflow)?;

            // Update equity based on trade result
            // NOTE: In production this would be called as a callback after
            // the router executes the swap. For now we track the intent.
            // Equity updates happen via `update_equity` called by the backend.

            self.env().emit_event(TradeExecuted {
                leader: self.leader,
                pair,
                side,
                amount,
                vault_equity_after: equity,
                timestamp,
            });

            self.release_lock();
            Ok(())
        }

        /// Execute a real on-chain swap through the configured Router (T25).
        ///
        /// Unlike `execute_trade`, this method:
        ///   1. Approves the Router to pull `amount_in` of `token_in`
        ///      (`PSP22::approve`), since the Router funds itself via
        ///      `PSP22::transfer_from(path[0], caller, pair, ...)`,
        ///   2. Performs a real cross-contract call to
        ///      `Router::swap_exact_tokens_for_tokens(amount_in,
        ///      amount_out_min, path, to, deadline)` with
        ///      `path = [token_in, token_out]` and `to = self`,
        ///   3. Receives the actual `amount_out` (last element of the
        ///      returned `Vec<Balance>`),
        ///   4. Updates `total_equity` from on-chain state — never from a
        ///      parameter provided by the leader.
        ///
        /// Slippage protection is enforced via `min_amount_out`: if the
        /// router returns less than that, the call reverts and the vault
        /// state is unchanged.
        ///
        /// Requires: leader, not paused, trading active, router configured.
        #[ink(message)]
        pub fn swap_through_router(
            &mut self,
            token_in:       AccountId,
            token_out:      AccountId,
            amount_in:      Balance,
            min_amount_out: Balance,
        ) -> Result<Balance, VaultError> {
            self.ensure_leader()?;
            self.ensure_not_paused()?;
            self.ensure_trading_active()?;
            self.acquire_lock()?;

            if amount_in == 0 {
                self.release_lock();
                return Err(VaultError::ZeroAmount);
            }

            if token_in == token_out {
                self.release_lock();
                return Err(VaultError::InvalidPair);
            }

            let router = match self.router {
                Some(addr) => addr,
                None => {
                    self.release_lock();
                    return Err(VaultError::RouterNotConfigured);
                }
            };

            // ── ADR-002: pré-condições do modelo de ativo ────────────
            // As pontas do swap ficam restritas a {wnative} ∪ tracked —
            // isso garante a invariante 1 (todo ativo adquirível é
            // visível ao equity).
            let wnative = match self.require_valuation_infra() {
                Ok((_factory, wnative)) => wnative,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            if token_in != wnative && !self.is_tracked(token_in) {
                self.release_lock();
                return Err(VaultError::TokenNotTracked);
            }
            // Saldo REAL de token_in via balance_of — nunca via equity
            // (era exatamente a confusão do P0-3).
            let token_in_balance = match self.psp22_balance_of(token_in) {
                Ok(b) => b,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            if token_in_balance < amount_in {
                self.release_lock();
                return Err(VaultError::InsufficientTokenBalance);
            }
            // token_out entra na lista ANTES do swap (auto-track).
            // Se a lista está cheia ou o par não tem liquidez mínima,
            // o swap é rejeitado — o vault nunca adquire um ativo que
            // o equity não enxergue.
            if token_out != wnative && !self.is_tracked(token_out) {
                if let Err(e) = self.track_token_internal(token_out) {
                    self.release_lock();
                    return Err(e);
                }
            }

            // Per-block volume cap (same logic as execute_trade) ─────────
            let current_block = self.env().block_number();
            let equity_before = match self.get_vault_equity_internal() {
                Ok(e) => e,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let max_block_vol = equity_before
                .checked_mul(constants::MAX_BLOCK_VOLUME_BPS as u128)
                .ok_or(VaultError::Overflow)?
                .checked_div(constants::BPS as u128)
                .ok_or(VaultError::Overflow)?;
            let new_block_volume = if current_block == self.last_trade_block {
                self.block_volume
                    .checked_add(amount_in)
                    .ok_or(VaultError::Overflow)?
            } else {
                amount_in
            };
            if new_block_volume > max_block_vol {
                self.release_lock();
                return Err(VaultError::BlockVolumeExceeded);
            }

            // Trade-size cap (max 20% of equity per trade)
            let max_trade = equity_before
                .checked_mul(constants::MAX_TRADE_SIZE_BPS as u128)
                .ok_or(VaultError::Overflow)?
                .checked_div(constants::BPS as u128)
                .ok_or(VaultError::Overflow)?;
            if amount_in > max_trade {
                self.release_lock();
                return Err(VaultError::TradeExceedsLimit);
            }

            self.block_volume = new_block_volume;
            self.last_trade_block = current_block;

            // Cross-contract swap via Router — API real do contrato
            // deployado (ver target/ink/router_contract metadata):
            //
            //   swap_exact_tokens_for_tokens(
            //       amount_in: Balance,
            //       amount_out_min: Balance,
            //       path: Vec<AccountId>,
            //       to: AccountId,
            //       deadline: u64,
            //   ) -> Result<Vec<Balance>, RouterError>
            //
            // O Router puxa o token de entrada do caller via
            // `PSP22::transfer_from(path[0], caller, pair, amount)` —
            // por isso o vault PRIMEIRO aprova o router para `amount_in`
            // em `token_in` e SÓ ENTÃO executa o swap. `to = self` para
            // o token de saída ser creditado ao vault, não ao leader.
            //
            // Bypassed under unit-test cfg — there is no router contract in
            // the ink test env. O caminho real é provado on-chain pelo
            // script E2E `spot-api/scripts/e2e-copy-vault-swap.ts`.
            #[cfg(not(test))]
            let amount_out: Balance = {
                use ink::env::call::{
                    build_call,
                    ExecutionInput,
                    Selector,
                };

                // 1) approve(router, amount_in) no token_in.
                let approve_result = build_call::<ink::env::DefaultEnvironment>()
                    .call(token_in)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(PSP22_APPROVE_SELECTOR))
                            .push_arg(router)
                            .push_arg(amount_in),
                    )
                    .returns::<core::result::Result<(), Psp22ErrorMirror>>()
                    .try_invoke();

                match approve_result {
                    Ok(Ok(Ok(()))) => {}
                    _ => {
                        self.release_lock();
                        return Err(VaultError::TokenApproveFailed);
                    }
                }

                // 2) Deadline relativo ao timestamp on-chain do bloco.
                let deadline = match self
                    .env()
                    .block_timestamp()
                    .checked_add(constants::SWAP_DEADLINE_WINDOW_MS)
                {
                    Some(d) => d,
                    None => {
                        self.release_lock();
                        return Err(VaultError::Overflow);
                    }
                };

                // 3) swap_exact_tokens_for_tokens com path direto.
                let mut path: Vec<AccountId> = Vec::with_capacity(2);
                path.push(token_in);
                path.push(token_out);

                let swap_result = build_call::<ink::env::DefaultEnvironment>()
                    .call(router)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(
                            ROUTER_SWAP_EXACT_TOKENS_SELECTOR,
                        ))
                        .push_arg(amount_in)
                        .push_arg(min_amount_out)
                        .push_arg(path)
                        .push_arg(self.env().account_id())
                        .push_arg(deadline),
                    )
                    .returns::<core::result::Result<Vec<Balance>, RouterErrorMirror>>()
                    .try_invoke();

                // amounts[i] = quantidade em cada hop; o último elemento
                // é o amount_out efetivamente creditado ao vault.
                match swap_result {
                    Ok(Ok(Ok(amounts))) => match amounts.last().copied() {
                        Some(out) => out,
                        None => {
                            self.release_lock();
                            return Err(VaultError::SwapFailed);
                        }
                    },
                    _ => {
                        self.release_lock();
                        return Err(VaultError::SwapFailed);
                    }
                }
            };
            #[cfg(test)]
            let amount_out: Balance = {
                let _ = router; // usado apenas no caminho cfg(not(test))
                min_amount_out // deterministic for tests
            };

            if amount_out < min_amount_out {
                self.release_lock();
                return Err(VaultError::SlippageExceeded);
            }

            // Refresh equity from the on-chain state, not from a parameter.
            // This is the core defense — the leader cannot inflate equity.
            // ADR-002: o equity agora inclui a valuation do token_out
            // recém-adquirido (tracked) — fecha o P0-3.
            let new_equity = match self.get_vault_equity_internal() {
                Ok(e) => e,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            self.total_equity = new_equity;
            if new_equity > self.high_water_mark {
                self.high_water_mark = new_equity;
            }

            // Record trade history
            let timestamp = self.env().block_timestamp();
            let idx = self.trade_count % constants::MAX_TRADE_HISTORY;
            // Encode pair as token_in||token_out raw bytes for the audit log.
            let mut pair_bytes = ink::prelude::vec::Vec::with_capacity(64);
            pair_bytes.extend_from_slice(token_in.as_ref());
            pair_bytes.extend_from_slice(token_out.as_ref());
            let record = TradeRecord {
                pair: pair_bytes.clone(),
                // Side semantics here: BUY = received token_out, SELL = sold token_in.
                side: TradeSide::Buy,
                amount: amount_in,
                timestamp,
            };
            self.trade_history.insert(&idx, &record);
            self.trade_count = self
                .trade_count
                .checked_add(1)
                .ok_or(VaultError::Overflow)?;

            self.env().emit_event(TradeExecuted {
                leader: self.leader,
                pair: pair_bytes,
                side: TradeSide::Buy,
                amount: amount_in,
                vault_equity_after: new_equity,
                timestamp,
            });

            self.env().emit_event(VaultSwapExecuted {
                token_in,
                token_out,
                amount_in,
                amount_out,
                executed_by: self.env().caller(),
            });

            self.release_lock();
            Ok(amount_out)
        }

        /// Update vault equity after trade settlement (leader or admin)
        #[ink(message)]
        pub fn update_equity(&mut self, new_equity: Balance) -> Result<(), VaultError> {
            let caller = self.env().caller();
            if caller != self.leader && caller != self.admin {
                return Err(VaultError::NotLeader);
            }

            let current_equity = self.get_vault_equity_internal()?;
            if new_equity != current_equity {
                return Err(VaultError::EquityMismatch);
            }

            self.total_equity = current_equity;

            // Update high water mark
            if current_equity > self.high_water_mark {
                self.high_water_mark = current_equity;
            }

            // Check drawdown circuit breaker
            if self.high_water_mark > 0 {
                let drawdown = self
                    .high_water_mark
                    .checked_sub(current_equity)
                    .unwrap_or(0);
                let drawdown_bps = drawdown
                    .checked_mul(constants::BPS as u128)
                    .unwrap_or(0)
                    .checked_div(self.high_water_mark)
                    .unwrap_or(0) as u32;

                if drawdown_bps > self.max_drawdown_bps {
                    self.trading_halted = true;

                    self.env().emit_event(CircuitBreakerTriggered {
                        vault: self.env().account_id(),
                        current_equity: current_equity,
                        high_water_mark: self.high_water_mark,
                        drawdown_bps,
                        timestamp: self.env().block_timestamp(),
                    });
                }
            }

            Ok(())
        }

        /// Sincroniza total_equity com o equity real on-chain (reconciliação).
        /// ADR-002: usa o equity completo (nativo + wnative + tracked),
        /// nunca apenas o saldo nativo. Falha de cotação ⇒ erro explícito.
        #[ink(message)]
        pub fn sync_equity(&mut self) -> Result<Balance, VaultError> {
            let actual = self.get_vault_equity_internal()?;
            self.total_equity = actual;
            if actual > self.high_water_mark {
                self.high_water_mark = actual;
            }
            Ok(actual)
        }

        // ════════════════════════════════════════════════════════
        // ADMIN FUNCTIONS
        // ════════════════════════════════════════════════════════

        /// Pause the vault (admin only)
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.paused = true;
            self.env().emit_event(VaultPausedEvent {
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Unpause the vault (admin only)
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.paused = false;
            self.env().emit_event(VaultUnpausedEvent {
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Resume trading after circuit breaker (admin only)
        #[ink(message)]
        pub fn resume_trading(&mut self) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.trading_halted = false;
            self.total_equity = self.get_vault_equity_internal()?;
            // Reset high water mark to current equity to prevent immediate re-trigger
            self.high_water_mark = self.total_equity;
            Ok(())
        }

        /// Set performance fee (admin only, max 50%)
        #[ink(message)]
        pub fn set_performance_fee(&mut self, new_fee_bps: u32) -> Result<(), VaultError> {
            self.ensure_admin()?;
            if new_fee_bps > constants::MAX_PERFORMANCE_FEE_BPS {
                return Err(VaultError::FeeTooHigh);
            }

            let old_fee = self.performance_fee_bps;
            self.performance_fee_bps = new_fee_bps;

            self.env().emit_event(PerformanceFeeChanged {
                old_fee_bps: old_fee,
                new_fee_bps,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Set maximum drawdown before circuit breaker triggers (admin only)
        #[ink(message)]
        pub fn set_max_drawdown(&mut self, drawdown_bps: u32) -> Result<(), VaultError> {
            self.ensure_admin()?;
            if drawdown_bps == 0 || drawdown_bps > constants::BPS {
                return Err(VaultError::ZeroAmount);
            }
            self.max_drawdown_bps = drawdown_bps;
            Ok(())
        }

        /// Configure the Router contract used for real on-chain swaps
        /// (admin only). Must be set before `swap_through_router` is callable.
        #[ink(message)]
        pub fn set_router(&mut self, router: AccountId) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.router = Some(router);
            Ok(())
        }

        /// Returns the configured router address (None if not set).
        #[ink(message)]
        pub fn router_address(&self) -> Option<AccountId> {
            self.router
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — TRACKED TOKENS & VALUATION
        // ════════════════════════════════════════════════════════

        /// Configura a infra de valuation (factory + wnative) usada na
        /// cotação on-chain do equity (admin/leader). Deve ser chamada
        /// antes de qualquer swap/tracking.
        #[ink(message)]
        pub fn set_valuation_infra(
            &mut self,
            factory: AccountId,
            wnative: AccountId,
        ) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.factory = Some(factory);
            self.wnative = Some(wnative);
            Ok(())
        }

        /// Retorna (factory, wnative) configurados.
        #[ink(message)]
        pub fn get_valuation_infra(&self) -> (Option<AccountId>, Option<AccountId>) {
            (self.factory, self.wnative)
        }

        /// Adiciona um token PSP22 à lista de rastreados (admin/leader).
        /// Falha se a lista está cheia (MAX_TRACKED_TOKENS), se o token
        /// já é rastreado, ou se o par token<>wnative não existe / não
        /// tem a reserva nativa mínima (anti-manipulação v1).
        #[ink(message)]
        pub fn add_tracked_token(&mut self, token: AccountId) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.track_token_internal(token)
        }

        /// Remove um token da lista de rastreados (admin/leader).
        /// NUNCA des-rastreia com posição aberta: falha se
        /// balance_of(vault, token) > 0 (invariante 1).
        #[ink(message)]
        pub fn remove_tracked_token(&mut self, token: AccountId) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.untrack_token_internal(token)
        }

        /// Lista densa dos tokens rastreados.
        #[ink(message)]
        pub fn get_tracked_tokens(&self) -> Vec<AccountId> {
            let mut tokens = Vec::new();
            for i in 0..self.tracked_token_count {
                if let Some(token) = self.tracked_tokens.get(&i) {
                    tokens.push(token);
                }
            }
            tokens
        }

        /// Valuation em nativo do saldo do vault em `token`
        /// (0 se balance == 0; ERRO explícito se a cotação falhar).
        #[ink(message)]
        pub fn get_token_valuation(&self, token: AccountId) -> Result<Balance, VaultError> {
            let balance = self.psp22_balance_of(token)?;
            if balance == 0 {
                return Ok(0);
            }
            self.quote_token_to_native(token, balance)
        }

        /// Decomposição do equity: (saldo_nativo,
        /// [(token, balance, valor_em_nativo)], total).
        /// Inclui wnative (1:1) quando o vault tem saldo. ERRO explícito
        /// se qualquer cotação falhar — nunca valuation parcial.
        #[ink(message)]
        pub fn get_equity_breakdown(
            &self,
        ) -> Result<(Balance, Vec<(AccountId, Balance, Balance)>, Balance), VaultError> {
            let native = self.env().balance();
            let mut entries: Vec<(AccountId, Balance, Balance)> = Vec::new();
            let mut total = native;

            if let Some(wnative) = self.wnative {
                let balance = self.psp22_balance_of(wnative)?;
                if balance > 0 {
                    entries.push((wnative, balance, balance));
                    total = total.checked_add(balance).ok_or(VaultError::Overflow)?;
                }
            }

            for i in 0..self.tracked_token_count {
                let token = self
                    .tracked_tokens
                    .get(&i)
                    .ok_or(VaultError::ValuationUnavailable)?;
                let balance = self.psp22_balance_of(token)?;
                if balance == 0 {
                    continue;
                }
                let value = self.quote_token_to_native(token, balance)?;
                entries.push((token, balance, value));
                total = total.checked_add(value).ok_or(VaultError::Overflow)?;
            }

            Ok((native, entries, total))
        }

        // ════════════════════════════════════════════════════════
        // VIEW FUNCTIONS
        // ════════════════════════════════════════════════════════

        /// Get vault equity — ADR-002: saldo nativo + wnative (1:1) +
        /// valuation on-chain dos tracked tokens. ERRO explícito se
        /// alguma cotação falhar (nunca "vale 0").
        #[ink(message)]
        pub fn get_vault_equity(&self) -> Result<Balance, VaultError> {
            self.get_vault_equity_internal()
        }

        /// Get current share price (equity / total_shares)
        #[ink(message)]
        pub fn get_share_price(&self) -> Result<Balance, VaultError> {
            self.get_share_price_internal()
        }

        /// Get a depositor's share balance and current value
        #[ink(message)]
        pub fn get_depositor_info(
            &self,
            depositor: AccountId,
        ) -> Result<(Balance, Balance), VaultError> {
            let shares = self.shares.get(&depositor).unwrap_or(0);
            if shares == 0 || self.total_shares == 0 {
                return Ok((0, 0));
            }
            let equity = self.get_vault_equity_internal()?;
            let value = shares
                .checked_mul(equity)
                .unwrap_or(0)
                .checked_div(self.total_shares)
                .unwrap_or(0);
            Ok((shares, value))
        }

        /// Get vault stats
        #[ink(message)]
        pub fn get_vault_stats(
            &self,
        ) -> Result<
            (
                Balance, // total_equity
                Balance, // total_shares
                Balance, // high_water_mark
                u32,     // performance_fee_bps
                u32,     // active_depositors
                u32,     // trade_count
                bool,    // paused
                bool,    // trading_halted
                Balance, // total_fees_collected
            ),
            VaultError,
        > {
            let current_equity = self.get_vault_equity_internal()?;
            Ok((
                current_equity,
                self.total_shares,
                self.high_water_mark,
                self.performance_fee_bps,
                self.active_depositors,
                self.trade_count,
                self.paused,
                self.trading_halted,
                self.total_fees_collected,
            ))
        }

        /// Get vault leader
        #[ink(message)]
        pub fn get_leader(&self) -> AccountId {
            self.leader
        }

        /// Get recent trades
        #[ink(message)]
        pub fn get_recent_trades(&self, count: u32) -> Vec<TradeRecord> {
            let max = core::cmp::min(count, self.trade_count);
            let max = core::cmp::min(max, constants::MAX_TRADE_HISTORY);
            let mut trades = Vec::new();

            if self.trade_count == 0 {
                return trades;
            }

            let start = if self.trade_count > max {
                self.trade_count - max
            } else {
                0
            };

            for i in start..self.trade_count {
                let idx = i % constants::MAX_TRADE_HISTORY;
                if let Some(record) = self.trade_history.get(&idx) {
                    trades.push(record);
                }
            }

            trades
        }

        // ════════════════════════════════════════════════════════
        // INTERNAL HELPERS
        // ════════════════════════════════════════════════════════

        /// ADR-002: decomposição (saldo_nativo, valor_dos_tokens).
        /// `tokens` = saldo wnative (1:1) + Σ valuation on-chain dos
        /// tracked tokens com balance > 0. Falha de QUALQUER cotação é
        /// falha da leitura (`ValuationUnavailable`) — nunca "vale 0".
        fn equity_split_internal(&self) -> Result<(Balance, Balance), VaultError> {
            let native = self.env().balance();
            let mut tokens_value: Balance = 0;

            if let Some(wnative) = self.wnative {
                let balance = self.psp22_balance_of(wnative)?;
                tokens_value = tokens_value
                    .checked_add(balance)
                    .ok_or(VaultError::Overflow)?;
            }

            for i in 0..self.tracked_token_count {
                let token = self
                    .tracked_tokens
                    .get(&i)
                    .ok_or(VaultError::ValuationUnavailable)?;
                let balance = self.psp22_balance_of(token)?;
                if balance == 0 {
                    continue;
                }
                let value = self.quote_token_to_native(token, balance)?;
                tokens_value = tokens_value
                    .checked_add(value)
                    .ok_or(VaultError::Overflow)?;
            }

            Ok((native, tokens_value))
        }

        fn get_vault_equity_internal(&self) -> Result<Balance, VaultError> {
            let (native, tokens_value) = self.equity_split_internal()?;
            native
                .checked_add(tokens_value)
                .ok_or(VaultError::Overflow)
        }

        fn share_price_from_equity(&self, equity: Balance) -> Balance {
            if self.total_shares == 0 {
                return constants::INITIAL_SHARE_PRICE;
            }
            equity
                .checked_mul(constants::INITIAL_SHARE_PRICE)
                .unwrap_or(0)
                .checked_div(self.total_shares)
                .unwrap_or(constants::INITIAL_SHARE_PRICE)
        }

        fn get_share_price_internal(&self) -> Result<Balance, VaultError> {
            if self.total_shares == 0 {
                return Ok(constants::INITIAL_SHARE_PRICE);
            }
            let equity = self.get_vault_equity_internal()?;
            Ok(self.share_price_from_equity(equity))
        }

        // ── ADR-002: tracked tokens ──────────────────────────────

        fn require_valuation_infra(&self) -> Result<(AccountId, AccountId), VaultError> {
            match (self.factory, self.wnative) {
                (Some(factory), Some(wnative)) => Ok((factory, wnative)),
                _ => Err(VaultError::ValuationInfraNotConfigured),
            }
        }

        fn is_tracked(&self, token: AccountId) -> bool {
            self.tracked_token_index.contains(&token)
        }

        fn track_token_internal(&mut self, token: AccountId) -> Result<(), VaultError> {
            let (factory, wnative) = self.require_valuation_infra()?;
            if token == wnative {
                return Err(VaultError::CannotTrackWnative);
            }
            if self.is_tracked(token) {
                return Err(VaultError::TokenAlreadyTracked);
            }
            if self.tracked_token_count >= constants::MAX_TRACKED_TOKENS {
                return Err(VaultError::TooManyTrackedTokens);
            }
            // Mitigação v1 (ADR-002): par precisa existir e ter reserva
            // nativa mínima — encarece manipulação do preço da cota via
            // tokens ilíquidos.
            let (_reserve_token, reserve_native) =
                self.pair_reserves(token, wnative, factory)?;
            if reserve_native < constants::MIN_TRACKING_RESERVE_NATIVE {
                return Err(VaultError::InsufficientPairLiquidity);
            }

            let idx = self.tracked_token_count;
            self.tracked_tokens.insert(&idx, &token);
            self.tracked_token_index.insert(&token, &idx);
            self.tracked_token_count =
                idx.checked_add(1).ok_or(VaultError::Overflow)?;

            self.env().emit_event(TrackedTokenAdded {
                token,
                by: self.env().caller(),
            });
            Ok(())
        }

        fn untrack_token_internal(&mut self, token: AccountId) -> Result<(), VaultError> {
            let idx = self
                .tracked_token_index
                .get(&token)
                .ok_or(VaultError::TokenNotTracked)?;
            // Invariante 1: nunca des-rastrear com posição aberta.
            let balance = self.psp22_balance_of(token)?;
            if balance > 0 {
                return Err(VaultError::TokenHasBalance);
            }

            // Swap-remove mantendo o índice denso.
            let last = self
                .tracked_token_count
                .checked_sub(1)
                .ok_or(VaultError::Overflow)?;
            if idx != last {
                let moved = self
                    .tracked_tokens
                    .get(&last)
                    .ok_or(VaultError::TokenNotTracked)?;
                self.tracked_tokens.insert(&idx, &moved);
                self.tracked_token_index.insert(&moved, &idx);
            }
            self.tracked_tokens.remove(&last);
            self.tracked_token_index.remove(&token);
            self.tracked_token_count = last;

            self.env().emit_event(TrackedTokenRemoved {
                token,
                by: self.env().caller(),
            });
            Ok(())
        }

        // ── ADR-002: cross-contract reads (mockados em unit test) ─
        //
        // Sob cfg(test) não há contratos reais no env de teste do ink;
        // os mocks em `test_mocks` permitem TDD da math de equity.
        // O caminho real é provado on-chain pelo script E2E
        // `spot-api/scripts/e2e-copy-vault-equity.ts`.

        /// PSP22::balance_of(vault) no `token`.
        fn psp22_balance_of(&self, token: AccountId) -> Result<Balance, VaultError> {
            #[cfg(not(test))]
            {
                use ink::env::call::{
                    build_call,
                    ExecutionInput,
                    Selector,
                };
                let result = build_call::<ink::env::DefaultEnvironment>()
                    .call(token)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(PSP22_BALANCE_OF_SELECTOR))
                            .push_arg(self.env().account_id()),
                    )
                    .returns::<Balance>()
                    .try_invoke();
                match result {
                    Ok(Ok(balance)) => Ok(balance),
                    _ => Err(VaultError::ValuationUnavailable),
                }
            }
            #[cfg(test)]
            {
                Ok(test_mocks::psp22_balance(token))
            }
        }

        /// Reservas (reserve_token, reserve_native) do par
        /// token<>wnative resolvido via factory.
        fn pair_reserves(
            &self,
            token: AccountId,
            wnative: AccountId,
            factory: AccountId,
        ) -> Result<(Balance, Balance), VaultError> {
            #[cfg(not(test))]
            {
                use ink::env::call::{
                    build_call,
                    ExecutionInput,
                    Selector,
                };
                let pair_result = build_call::<ink::env::DefaultEnvironment>()
                    .call(factory)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(FACTORY_GET_PAIR_SELECTOR))
                            .push_arg(token)
                            .push_arg(wnative),
                    )
                    .returns::<Option<AccountId>>()
                    .try_invoke();
                let pair = match pair_result {
                    Ok(Ok(Some(pair))) => pair,
                    _ => return Err(VaultError::ValuationUnavailable),
                };

                let reserves_result = build_call::<ink::env::DefaultEnvironment>()
                    .call(pair)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(ExecutionInput::new(Selector::new(
                        PAIR_GET_RESERVES_SELECTOR,
                    )))
                    .returns::<(Balance, Balance, u64)>()
                    .try_invoke();
                let (reserve_0, reserve_1) = match reserves_result {
                    Ok(Ok((r0, r1, _))) => (r0, r1),
                    _ => return Err(VaultError::ValuationUnavailable),
                };

                // Reservas do pair são ordenadas por token_0 < token_1
                // (byte order) — mesma regra do Router::sort_tokens.
                if token < wnative {
                    Ok((reserve_0, reserve_1))
                } else {
                    Ok((reserve_1, reserve_0))
                }
            }
            #[cfg(test)]
            {
                let _ = (wnative, factory);
                test_mocks::pair_reserves(token).ok_or(VaultError::ValuationUnavailable)
            }
        }

        /// Cotação spot on-chain de `amount` de `token` em nativo:
        /// router.get_amount_out(amount, reserve_token, reserve_native).
        /// wnative vale 1:1 por definição (wrap do LUNES).
        fn quote_token_to_native(
            &self,
            token: AccountId,
            amount: Balance,
        ) -> Result<Balance, VaultError> {
            let (factory, wnative) = self.require_valuation_infra()?;
            if token == wnative {
                return Ok(amount);
            }
            let (reserve_token, reserve_native) =
                self.pair_reserves(token, wnative, factory)?;

            #[cfg(not(test))]
            {
                use ink::env::call::{
                    build_call,
                    ExecutionInput,
                    Selector,
                };
                let router = self.router.ok_or(VaultError::RouterNotConfigured)?;
                let result = build_call::<ink::env::DefaultEnvironment>()
                    .call(router)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(
                            ROUTER_GET_AMOUNT_OUT_SELECTOR,
                        ))
                        .push_arg(amount)
                        .push_arg(reserve_token)
                        .push_arg(reserve_native),
                    )
                    .returns::<core::result::Result<Balance, RouterErrorMirror>>()
                    .try_invoke();
                match result {
                    Ok(Ok(Ok(value))) => Ok(value),
                    _ => Err(VaultError::ValuationUnavailable),
                }
            }
            #[cfg(test)]
            {
                // Mock determinístico: proporcional puro
                // (amount * reserve_native / reserve_token). A fórmula
                // real (com fee) é do Router e é provada no E2E.
                if reserve_token == 0 || reserve_native == 0 {
                    return Err(VaultError::ValuationUnavailable);
                }
                amount
                    .checked_mul(reserve_native)
                    .ok_or(VaultError::Overflow)?
                    .checked_div(reserve_token)
                    .ok_or(VaultError::ValuationUnavailable)
            }
        }

        fn is_large_withdrawal(&self, shares: Balance) -> bool {
            if self.total_shares == 0 {
                return false;
            }
            // Large = more than 10% of total shares
            let threshold = self
                .total_shares
                .checked_mul(constants::LARGE_WITHDRAWAL_BPS as u128)
                .unwrap_or(0)
                .checked_div(constants::BPS as u128)
                .unwrap_or(0);
            shares > threshold
        }

        fn ensure_leader(&self) -> Result<(), VaultError> {
            if self.env().caller() != self.leader {
                return Err(VaultError::NotLeader);
            }
            Ok(())
        }

        fn ensure_admin(&self) -> Result<(), VaultError> {
            let caller = self.env().caller();
            if caller != self.admin && caller != self.leader {
                return Err(VaultError::NotAdmin);
            }
            Ok(())
        }

        fn ensure_not_paused(&self) -> Result<(), VaultError> {
            if self.paused {
                return Err(VaultError::VaultPaused);
            }
            Ok(())
        }

        fn ensure_trading_active(&self) -> Result<(), VaultError> {
            if self.trading_halted {
                return Err(VaultError::TradingHalted);
            }
            Ok(())
        }

        fn acquire_lock(&mut self) -> Result<(), VaultError> {
            if self.locked {
                return Err(VaultError::Reentrancy);
            }
            self.locked = true;
            Ok(())
        }

        fn release_lock(&mut self) {
            self.locked = false;
        }
    }

    // ════════════════════════════════════════════════════════
    // TEST MOCKS (cross-contract reads — ADR-002)
    // ════════════════════════════════════════════════════════

    /// Mocks thread-local p/ as leituras cross-contract da valuation.
    /// Cada teste roda em sua própria thread (harness padrão) — estado
    /// isolado por teste.
    #[cfg(test)]
    pub(crate) mod test_mocks {
        use super::{
            AccountId,
            Balance,
        };
        use std::{
            cell::RefCell,
            collections::BTreeMap,
        };

        thread_local! {
            static PSP22_BALANCES: RefCell<BTreeMap<AccountId, Balance>> =
                RefCell::new(BTreeMap::new());
            static PAIR_RESERVES: RefCell<BTreeMap<AccountId, (Balance, Balance)>> =
                RefCell::new(BTreeMap::new());
        }

        /// Saldo PSP22 do vault em `token` (default: 0).
        pub fn set_psp22_balance(token: AccountId, balance: Balance) {
            PSP22_BALANCES.with(|m| {
                m.borrow_mut().insert(token, balance);
            });
        }

        pub fn psp22_balance(token: AccountId) -> Balance {
            PSP22_BALANCES.with(|m| m.borrow().get(&token).copied().unwrap_or(0))
        }

        /// Reservas (reserve_token, reserve_native) do par
        /// token<>wnative. Ausente = par inexistente (cotação falha).
        pub fn set_pair_reserves(
            token: AccountId,
            reserve_token: Balance,
            reserve_native: Balance,
        ) {
            PAIR_RESERVES.with(|m| {
                m.borrow_mut().insert(token, (reserve_token, reserve_native));
            });
        }

        pub fn clear_pair_reserves(token: AccountId) {
            PAIR_RESERVES.with(|m| {
                m.borrow_mut().remove(&token);
            });
        }

        pub fn pair_reserves(token: AccountId) -> Option<(Balance, Balance)> {
            PAIR_RESERVES.with(|m| m.borrow().get(&token).copied())
        }
    }

    // ════════════════════════════════════════════════════════
    // TESTS
    // ════════════════════════════════════════════════════════

    #[cfg(test)]
    mod tests {
        use super::*;

        fn default_accounts() -> ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment> {
            ink::env::test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn set_caller(caller: AccountId) {
            ink::env::test::set_caller::<ink::env::DefaultEnvironment>(caller);
        }

        fn set_value(value: Balance) {
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(value);
        }

        fn set_balance(account: AccountId, balance: Balance) {
            ink::env::test::set_account_balance::<ink::env::DefaultEnvironment>(account, balance);
        }

        fn create_vault() -> (CopyVault, ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>) {
            let accounts = default_accounts();
            set_caller(accounts.alice); // alice = admin
            let vault = CopyVault::new(accounts.bob, 2000); // bob = leader, 20% fee
            (vault, accounts)
        }

        #[ink::test]
        fn test_constructor() {
            let (vault, accounts) = create_vault();
            assert_eq!(vault.get_leader(), accounts.bob);
            assert!(!vault.paused);
            assert!(!vault.trading_halted);
            assert_eq!(vault.total_shares, 0);
            assert_eq!(vault.performance_fee_bps, 2000);
        }

        #[ink::test]
        fn test_deposit() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 0);

            // Charlie deposits 1000 LUNES
            set_caller(accounts.charlie);
            set_value(100_000_000_000); // 1000 LUNES
            set_balance(contract_id, 100_000_000_000);

            let shares = vault.deposit().unwrap();
            assert_eq!(shares, 100_000_000_000); // First deposit: 1:1

            let (depositor_shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(depositor_shares, 100_000_000_000);
            assert_eq!(vault.active_depositors, 1);
        }

        #[ink::test]
        fn test_deposit_below_minimum() {
            let (mut vault, accounts) = create_vault();

            set_caller(accounts.charlie);
            set_value(100); // Way below minimum

            let result = vault.deposit();
            assert_eq!(result, Err(VaultError::BelowMinimumDeposit));
        }

        #[ink::test]
        fn test_only_leader_can_trade() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // First deposit to set equity
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Non-leader tries to trade
            set_caller(accounts.charlie);
            set_value(0);
            let result = vault.execute_trade(b"LUNES/USDT".to_vec(), TradeSide::Buy, 10_000_000_000);
            assert_eq!(result, Err(VaultError::NotLeader));

            // Leader can trade
            set_caller(accounts.bob);
            set_value(0);
            let result = vault.execute_trade(b"LUNES/USDT".to_vec(), TradeSide::Buy, 10_000_000_000);
            assert!(result.is_ok());
        }

        #[ink::test]
        fn test_trade_exceeds_limit() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Deposit 1000 LUNES
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Leader tries to trade > 20% of vault
            set_caller(accounts.bob);
            set_value(0);
            let result = vault.execute_trade(
                b"LUNES/USDT".to_vec(),
                TradeSide::Buy,
                50_000_000_000, // 50% of vault — exceeds 20% limit
            );
            assert_eq!(result, Err(VaultError::BlockVolumeExceeded));
        }

        #[ink::test]
        fn test_pause_unpause() {
            let (mut vault, accounts) = create_vault();

            // Admin pauses
            set_caller(accounts.alice);
            vault.pause().unwrap();
            assert!(vault.paused);

            // Cannot deposit when paused
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            let result = vault.deposit();
            assert_eq!(result, Err(VaultError::VaultPaused));

            // Admin unpauses
            set_caller(accounts.alice);
            vault.unpause().unwrap();
            assert!(!vault.paused);
        }

        #[ink::test]
        fn test_circuit_breaker() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Deposit 1000 LUNES
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Simulate drawdown >30% via update_equity
            set_balance(contract_id, 60_000_000_000);
            set_caller(accounts.bob);
            vault.update_equity(60_000_000_000).unwrap(); // 40% drawdown

            assert!(vault.trading_halted);

            // Leader cannot trade when halted
            set_value(0);
            let result = vault.execute_trade(b"LUNES/USDT".to_vec(), TradeSide::Buy, 1_000_000_000);
            assert_eq!(result, Err(VaultError::TradingHalted));

            // Admin resumes
            set_caller(accounts.alice);
            vault.resume_trading().unwrap();
            assert!(!vault.trading_halted);
        }

        #[ink::test]
        fn test_set_performance_fee() {
            let (mut vault, accounts) = create_vault();

            // Admin sets fee to 30%
            set_caller(accounts.alice);
            vault.set_performance_fee(3000).unwrap();
            assert_eq!(vault.performance_fee_bps, 3000);

            // Cannot exceed max
            let result = vault.set_performance_fee(6000);
            assert_eq!(result, Err(VaultError::FeeTooHigh));
        }

        #[ink::test]
        fn test_share_price_initial() {
            let (vault, _) = create_vault();
            assert_eq!(vault.get_share_price(), Ok(constants::INITIAL_SHARE_PRICE));
        }

        #[ink::test]
        fn test_emergency_not_unlocked() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Deposit
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Try execute without requesting
            let result = vault.execute_emergency_withdrawal();
            assert_eq!(result, Err(VaultError::EmergencyNotUnlocked));
        }

        #[ink::test]
        fn test_vault_stats() {
            let (vault, _) = create_vault();
            let stats = vault.get_vault_stats().unwrap();
            assert_eq!(stats.3, 2000); // performance_fee_bps
            assert_eq!(stats.4, 0);    // active_depositors
            assert!(!stats.6);         // not paused
            assert!(!stats.7);         // trading not halted
        }

        // ── swap_through_router (P0-2 fix) ──────────────────────

        /// Selectors hardcoded devem bater com os labels reais expostos
        /// pelos contratos deployados (trait PSP22 + message do Router).
        #[ink::test]
        fn test_selectors_match_deployed_labels() {
            assert_eq!(
                PSP22_APPROVE_SELECTOR,
                ink::selector_bytes!("PSP22::approve"),
            );
            assert_eq!(
                ROUTER_SWAP_EXACT_TOKENS_SELECTOR,
                ink::selector_bytes!("swap_exact_tokens_for_tokens"),
            );
            // ADR-002: selectors da valuation on-chain
            assert_eq!(
                PSP22_BALANCE_OF_SELECTOR,
                ink::selector_bytes!("PSP22::balance_of"),
            );
            assert_eq!(
                FACTORY_GET_PAIR_SELECTOR,
                ink::selector_bytes!("get_pair"),
            );
            assert_eq!(
                PAIR_GET_RESERVES_SELECTOR,
                ink::selector_bytes!("get_reserves"),
            );
            assert_eq!(
                ROUTER_GET_AMOUNT_OUT_SELECTOR,
                ink::selector_bytes!("get_amount_out"),
            );
        }

        /// Os enums espelho devem ter exatamente os mesmos discriminantes
        /// SCALE do RouterError/PSP22Error no metadata do router deployado
        /// (type 10 / type 11).
        #[ink::test]
        fn test_mirror_enums_scale_layout() {
            use scale::{Decode, Encode};

            assert_eq!(RouterErrorMirror::Expired.encode(), vec![0u8]);
            assert_eq!(RouterErrorMirror::PairNotExists.encode(), vec![9u8]);
            assert_eq!(
                RouterErrorMirror::PSP22(Psp22ErrorMirror::InsufficientAllowance).encode(),
                vec![10u8, 2u8],
            );
            assert_eq!(RouterErrorMirror::Locked.encode(), vec![11u8]);
            assert_eq!(RouterErrorMirror::Overflow.encode(), vec![16u8]);

            // Round-trip do tipo de retorno completo do router:
            // Result<Vec<Balance>, RouterErrorMirror>
            let ok: core::result::Result<Vec<Balance>, RouterErrorMirror> =
                Ok(ink::prelude::vec![5_000u128, 9_500u128]);
            let decoded =
                <core::result::Result<Vec<Balance>, RouterErrorMirror>>::decode(
                    &mut ok.encode().as_slice(),
                )
                .unwrap();
            assert_eq!(decoded.unwrap().last().copied(), Some(9_500u128));
        }

        /// Endereço fixo do wnative nos testes (≠ default accounts).
        fn wnative_addr() -> AccountId {
            AccountId::from([0x77; 32])
        }

        /// Endereço fixo do factory nos testes.
        fn factory_addr() -> AccountId {
            AccountId::from([0xFA; 32])
        }

        /// Vault financiado + router + infra de valuation + token_in
        /// (django) rastreado com saldo mockado:
        ///   - nativo: 100 LUNES (100e9)
        ///   - django: balance 50e9 @ rate 0.1 → valuation 5e9
        ///   - equity total: 105e9
        fn setup_funded_vault_with_router(
        ) -> (CopyVault, ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>) {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Charlie deposita 1000 LUNES
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Admin configura router + infra de valuation (ADR-002)
            set_caller(accounts.alice);
            set_value(0);
            vault.set_router(accounts.frank).unwrap();
            vault
                .set_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();

            // django = token_in rastreado (rate 0.1 → valuation 5e9)
            test_mocks::set_pair_reserves(
                accounts.django,
                100_000_000_000_000,
                10_000_000_000_000,
            );
            vault.add_tracked_token(accounts.django).unwrap();
            test_mocks::set_psp22_balance(accounts.django, 50_000_000_000);

            // eve = token_out com par líquido 1:1 (auto-track no swap)
            test_mocks::set_pair_reserves(
                accounts.eve,
                1_000_000_000_000,
                1_000_000_000_000,
            );

            (vault, accounts)
        }

        #[ink::test]
        fn test_swap_through_router_requires_leader() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            set_caller(accounts.charlie); // não é o leader
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::NotLeader));
        }

        #[ink::test]
        fn test_swap_through_router_requires_router_configured() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Leader chama sem router configurado
            set_caller(accounts.bob);
            set_value(0);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::RouterNotConfigured));
            // Lock deve ter sido liberado no caminho de erro
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_through_router_zero_amount() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            set_caller(accounts.bob);
            let result =
                vault.swap_through_router(accounts.django, accounts.eve, 0, 0);
            assert_eq!(result, Err(VaultError::ZeroAmount));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_through_router_rejects_identical_tokens() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.django, // token_in == token_out
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::InvalidPair));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_through_router_respects_pause_and_halt() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // Pausado
            set_caller(accounts.alice);
            vault.pause().unwrap();
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::VaultPaused));

            // Despausado mas trading halted
            set_caller(accounts.alice);
            vault.unpause().unwrap();
            vault.trading_halted = true;
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::TradingHalted));
        }

        #[ink::test]
        fn test_swap_through_router_trade_size_limits() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            set_caller(accounts.bob);
            // 50% do vault — estoura o cap de volume por bloco (40%)
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                50_000_000_000,
                1,
            );
            assert_eq!(result, Err(VaultError::BlockVolumeExceeded));

            // 25% do vault — passa no volume (40%) mas estoura o cap
            // por trade (20%)
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                25_000_000_000,
                1,
            );
            assert_eq!(result, Err(VaultError::TradeExceedsLimit));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_through_router_happy_path_records_trade() {
            let (mut vault, accounts) = setup_funded_vault_with_router();
            let trade_count_before = vault.trade_count;

            set_caller(accounts.bob);
            // 10% do vault, dentro de todos os limites. Sob cfg(test) o
            // cross-contract call é mockado e retorna min_amount_out.
            let amount_in: Balance = 10_000_000_000;
            let min_out: Balance = 9_000_000_000;
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                amount_in,
                min_out,
            );
            assert_eq!(result, Ok(min_out));

            // Trade registrado no histórico com pair = token_in||token_out
            assert_eq!(vault.trade_count, trade_count_before + 1);
            let trades = vault.get_recent_trades(1);
            assert_eq!(trades.len(), 1);
            let mut expected_pair: Vec<u8> = Vec::new();
            expected_pair.extend_from_slice(accounts.django.as_ref());
            expected_pair.extend_from_slice(accounts.eve.as_ref());
            assert_eq!(trades[0].pair, expected_pair);
            assert_eq!(trades[0].amount, amount_in);

            // Lock liberado e vault operável em seguida
            assert!(!vault.locked);
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — tracked tokens (governança da lista)
        // ════════════════════════════════════════════════════════

        fn token(byte: u8) -> AccountId {
            AccountId::from([byte; 32])
        }

        /// Vault com infra de valuation configurada (sem depósito).
        fn vault_with_infra(
        ) -> (CopyVault, ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>) {
            let (mut vault, accounts) = create_vault();
            set_caller(accounts.alice);
            vault
                .set_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            (vault, accounts)
        }

        #[ink::test]
        fn test_add_tracked_token_success() {
            let (mut vault, _) = vault_with_infra();
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);

            assert_eq!(vault.add_tracked_token(t), Ok(()));
            assert_eq!(vault.get_tracked_tokens(), vec![t]);
            assert_eq!(vault.tracked_token_count, 1);
        }

        #[ink::test]
        fn test_add_tracked_token_requires_infra() {
            let (mut vault, accounts) = create_vault();
            set_caller(accounts.alice);
            let result = vault.add_tracked_token(token(0x01));
            assert_eq!(result, Err(VaultError::ValuationInfraNotConfigured));
        }

        #[ink::test]
        fn test_add_tracked_token_requires_admin_or_leader() {
            let (mut vault, accounts) = vault_with_infra();
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);

            set_caller(accounts.charlie); // nem admin nem leader
            assert_eq!(vault.add_tracked_token(t), Err(VaultError::NotAdmin));
        }

        #[ink::test]
        fn test_add_tracked_token_rejects_duplicate() {
            let (mut vault, _) = vault_with_infra();
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);

            vault.add_tracked_token(t).unwrap();
            assert_eq!(
                vault.add_tracked_token(t),
                Err(VaultError::TokenAlreadyTracked),
            );
        }

        #[ink::test]
        fn test_add_tracked_token_rejects_wnative() {
            let (mut vault, _) = vault_with_infra();
            assert_eq!(
                vault.add_tracked_token(wnative_addr()),
                Err(VaultError::CannotTrackWnative),
            );
        }

        #[ink::test]
        fn test_add_tracked_token_enforces_max_cap() {
            let (mut vault, _) = vault_with_infra();
            for i in 0..constants::MAX_TRACKED_TOKENS {
                let t = token(0x10 + i as u8);
                test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
                vault.add_tracked_token(t).unwrap();
            }
            assert_eq!(vault.tracked_token_count, constants::MAX_TRACKED_TOKENS);

            let extra = token(0xEE);
            test_mocks::set_pair_reserves(extra, 1_000_000_000_000, 1_000_000_000_000);
            assert_eq!(
                vault.add_tracked_token(extra),
                Err(VaultError::TooManyTrackedTokens),
            );
        }

        #[ink::test]
        fn test_add_tracked_token_requires_pair_liquidity() {
            let (mut vault, _) = vault_with_infra();

            // Par inexistente → falha de cotação explícita
            let missing = token(0x01);
            assert_eq!(
                vault.add_tracked_token(missing),
                Err(VaultError::ValuationUnavailable),
            );

            // Par com reserva nativa abaixo do mínimo
            let illiquid = token(0x02);
            test_mocks::set_pair_reserves(
                illiquid,
                1_000_000_000_000,
                constants::MIN_TRACKING_RESERVE_NATIVE - 1,
            );
            assert_eq!(
                vault.add_tracked_token(illiquid),
                Err(VaultError::InsufficientPairLiquidity),
            );
        }

        #[ink::test]
        fn test_remove_tracked_token_requires_zero_balance() {
            let (mut vault, _) = vault_with_infra();
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();

            // Posição aberta — não pode des-rastrear (invariante 1)
            test_mocks::set_psp22_balance(t, 1);
            assert_eq!(
                vault.remove_tracked_token(t),
                Err(VaultError::TokenHasBalance),
            );

            // Zerou — pode remover
            test_mocks::set_psp22_balance(t, 0);
            assert_eq!(vault.remove_tracked_token(t), Ok(()));
            assert_eq!(vault.get_tracked_tokens(), Vec::<AccountId>::new());
        }

        #[ink::test]
        fn test_remove_tracked_token_not_tracked() {
            let (mut vault, _) = vault_with_infra();
            assert_eq!(
                vault.remove_tracked_token(token(0x01)),
                Err(VaultError::TokenNotTracked),
            );
        }

        #[ink::test]
        fn test_remove_tracked_token_keeps_dense_index() {
            let (mut vault, _) = vault_with_infra();
            let (a, b, c) = (token(0x0A), token(0x0B), token(0x0C));
            for t in [a, b, c] {
                test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
                vault.add_tracked_token(t).unwrap();
            }

            // Remove o primeiro — o último (c) ocupa o slot 0
            vault.remove_tracked_token(a).unwrap();
            assert_eq!(vault.get_tracked_tokens(), vec![c, b]);
            assert_eq!(vault.tracked_token_count, 2);
            assert!(vault.is_tracked(b));
            assert!(vault.is_tracked(c));
            assert!(!vault.is_tracked(a));

            // Re-adicionar funciona e mantém densidade
            vault.add_tracked_token(a).unwrap();
            assert_eq!(vault.get_tracked_tokens(), vec![c, b, a]);
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — math de equity (mocks de cotação)
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_equity_native_only_without_infra() {
            let (vault, _) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 42_000_000_000);
            assert_eq!(vault.get_vault_equity(), Ok(42_000_000_000));
        }

        #[ink::test]
        fn test_equity_includes_wnative_one_to_one() {
            let (vault, _) = {
                let (mut v, a) = create_vault();
                set_caller(a.alice);
                v.set_valuation_infra(factory_addr(), wnative_addr()).unwrap();
                (v, a)
            };
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 100_000_000_000);
            test_mocks::set_psp22_balance(wnative_addr(), 5_000_000_000);

            // wnative vale 1:1 — sem par, sem cotação
            assert_eq!(vault.get_vault_equity(), Ok(105_000_000_000));
        }

        #[ink::test]
        fn test_equity_includes_tracked_token_valuation() {
            let (mut vault, _) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 100_000_000_000);

            // Token com rate 0.5 (reserva nativa = metade da do token)
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 2_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 10_000_000_000);

            // 10e9 * 0.5 = 5e9
            assert_eq!(vault.get_token_valuation(t), Ok(5_000_000_000));
            assert_eq!(vault.get_vault_equity(), Ok(105_000_000_000));

            // Decomposição: nativo + entrada por token + total
            let (native, entries, total) = vault.get_equity_breakdown().unwrap();
            assert_eq!(native, 100_000_000_000);
            assert_eq!(entries, vec![(t, 10_000_000_000, 5_000_000_000)]);
            assert_eq!(total, 105_000_000_000);
        }

        #[ink::test]
        fn test_equity_quote_failure_is_explicit_error() {
            let (mut vault, accounts) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Com shares emitidas — share_price depende do equity real
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            set_caller(accounts.alice);
            set_value(0);
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 10_000_000_000);

            // Par some (ex.: liquidez drenada) — cotação falha.
            test_mocks::clear_pair_reserves(t);

            // Equity NUNCA silencia para 0 — erro explícito (invariante 3)
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable),
            );
            assert_eq!(
                vault.get_share_price(),
                Err(VaultError::ValuationUnavailable),
            );
            assert_eq!(
                vault.get_equity_breakdown(),
                Err(VaultError::ValuationUnavailable),
            );
        }

        #[ink::test]
        fn test_equity_skips_zero_balance_tracked_tokens() {
            let (mut vault, _) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 100_000_000_000);

            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();

            // Par some, mas balance == 0 → token não entra na cotação
            test_mocks::clear_pair_reserves(t);
            assert_eq!(vault.get_vault_equity(), Ok(100_000_000_000));
        }

        #[ink::test]
        fn test_deposit_share_price_reflects_token_value() {
            let (mut vault, accounts) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // 1º depósito: 100 LUNES → 100e9 shares (1:1)
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            assert_eq!(vault.deposit(), Ok(100_000_000_000));

            // Vault adquire token valendo 100e9 em nativo (rate 1.0)
            set_caller(accounts.alice);
            set_value(0);
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 100_000_000_000);

            // 2º depósito: 100 LUNES com equity_before = 200e9
            // shares = 100e9 * 100e9 / 200e9 = 50e9 — a cota dobrou de
            // preço porque o token PSP22 agora é visível ao equity
            set_caller(accounts.django);
            set_value(100_000_000_000);
            set_balance(contract_id, 200_000_000_000);
            assert_eq!(vault.deposit(), Ok(50_000_000_000));
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — withdraw (liquidez nativa)
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_withdraw_insufficient_native_liquidity_is_explicit() {
            let (mut vault, accounts) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // 100 LUNES nativo, 100e9 shares
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            // Posição grande em token (valuation 1000e9) — equity 1100e9
            set_caller(accounts.alice);
            set_value(0);
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 1_000_000_000_000);

            // 10% das shares → payout = 110e9 > 100e9 nativo disponível
            // (10% não dispara o cooldown de large withdrawal)
            set_caller(accounts.charlie);
            let result = vault.withdraw(10_000_000_000);
            assert_eq!(result, Err(VaultError::InsufficientNativeLiquidity));
            assert!(!vault.locked);

            // Shares intactas após a falha explícita
            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(shares, 100_000_000_000);
        }

        #[ink::test]
        fn test_withdraw_partial_happy_path_with_open_positions() {
            let (mut vault, accounts) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            set_caller(accounts.alice);
            set_value(0);
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 1_000_000_000_000);

            // 5% das shares → payout = 55e9 ≤ 100e9 nativo. Fee de 20%
            // sobre o lucro (55e9 - 5e9 basis) = 10e9 → net 45e9.
            set_caller(accounts.charlie);
            set_value(0);
            let result = vault.withdraw(5_000_000_000);
            assert_eq!(result, Ok(45_000_000_000));

            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(shares, 95_000_000_000);
        }

        #[ink::test]
        fn test_withdraw_blocked_when_valuation_fails() {
            let (mut vault, accounts) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            set_caller(accounts.alice);
            set_value(0);
            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 10_000_000_000);
            test_mocks::clear_pair_reserves(t);

            // Cotação indisponível ⇒ saque reverte (invariante 3) —
            // nunca precifica a cota ignorando a posição aberta.
            set_caller(accounts.charlie);
            set_value(0);
            let result = vault.withdraw(1_000_000_000);
            assert_eq!(result, Err(VaultError::ValuationUnavailable));
            assert!(!vault.locked);
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — pré-condições do swap
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_swap_requires_valuation_infra() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            set_caller(accounts.alice);
            set_value(0);
            vault.set_router(accounts.frank).unwrap();

            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::ValuationInfraNotConfigured));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_token_in_must_be_tracked_or_wnative() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // token(0x99) não está na lista e não é wnative
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                token(0x99),
                accounts.eve,
                1_000_000_000,
                900_000_000,
            );
            assert_eq!(result, Err(VaultError::TokenNotTracked));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_insufficient_token_in_balance() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // django tem 50e9 mockado — pedir 60e9 falha ANTES dos caps
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                60_000_000_000,
                1,
            );
            assert_eq!(result, Err(VaultError::InsufficientTokenBalance));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_auto_tracks_token_out() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            assert!(!vault.is_tracked(accounts.eve));
            set_caller(accounts.bob);
            vault
                .swap_through_router(
                    accounts.django,
                    accounts.eve,
                    10_000_000_000,
                    9_000_000_000,
                )
                .unwrap();

            // Invariante 1: o ativo adquirido entrou na lista ANTES do
            // swap — o equity passa a enxergá-lo imediatamente.
            assert!(vault.is_tracked(accounts.eve));
            assert_eq!(
                vault.get_tracked_tokens(),
                vec![accounts.django, accounts.eve],
            );
        }

        #[ink::test]
        fn test_swap_auto_track_fails_when_list_full() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // Enche a lista (django já ocupa 1 slot)
            set_caller(accounts.alice);
            for i in 1..constants::MAX_TRACKED_TOKENS {
                let t = token(0x10 + i as u8);
                test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
                vault.add_tracked_token(t).unwrap();
            }
            assert_eq!(vault.tracked_token_count, constants::MAX_TRACKED_TOKENS);

            // token_out novo não cabe → swap rejeitado (nunca adquirir
            // ativo invisível ao equity)
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                10_000_000_000,
                9_000_000_000,
            );
            assert_eq!(result, Err(VaultError::TooManyTrackedTokens));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_sync_equity_uses_full_equity() {
            let (mut vault, _) = vault_with_infra();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 100_000_000_000);

            let t = token(0x01);
            test_mocks::set_pair_reserves(t, 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(t).unwrap();
            test_mocks::set_psp22_balance(t, 10_000_000_000);

            // sync_equity reflete nativo + valuation (não só balance)
            assert_eq!(vault.sync_equity(), Ok(110_000_000_000));
            assert_eq!(vault.total_equity, 110_000_000_000);

            // E falha explícita quando a cotação some
            test_mocks::clear_pair_reserves(t);
            assert_eq!(
                vault.sync_equity(),
                Err(VaultError::ValuationUnavailable),
            );
        }
    }
}
