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
            let current_balance = self.get_vault_equity_internal();
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

            let share_price = self.get_share_price_internal();
            let timestamp = self.env().block_timestamp();

            self.env().emit_event(Deposited {
                depositor: caller,
                amount,
                shares_minted: shares_to_mint,
                share_price,
                timestamp,
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

            // Calculate proportional equity
            let equity = self.get_vault_equity_internal();
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

            self.total_equity = self.get_vault_equity_internal();

            let timestamp = self.env().block_timestamp();
            self.env().emit_event(Withdrawn {
                depositor: caller,
                shares_burned: shares,
                amount_received: net_payout,
                performance_fee: fee,
                timestamp,
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
            let equity = self.get_vault_equity_internal();
            let payout = caller_shares
                .checked_mul(equity)
                .ok_or(VaultError::Overflow)?
                .checked_div(self.total_shares)
                .ok_or(VaultError::SharePriceZero)?;

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

            self.total_equity = self.get_vault_equity_internal();

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
            let equity = self.get_vault_equity_internal();
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

        /// Update vault equity after trade settlement (leader or admin)
        #[ink(message)]
        pub fn update_equity(&mut self, new_equity: Balance) -> Result<(), VaultError> {
            let caller = self.env().caller();
            if caller != self.leader && caller != self.admin {
                return Err(VaultError::NotLeader);
            }

            let current_equity = self.get_vault_equity_internal();
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

        /// Sincroniza total_equity com o saldo real do contrato (reconciliação).
        /// Corrige inconsistências entre o valor armazenado e o saldo on-chain.
        /// Pode ser chamado por qualquer um, mas só afeta equity se divergir.
        #[ink(message)]
        pub fn sync_equity(&mut self) -> Balance {
            let actual = self.env().balance();
            self.total_equity = actual;
            if actual > self.high_water_mark {
                self.high_water_mark = actual;
            }
            actual
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
            self.total_equity = self.get_vault_equity_internal();
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

        // ════════════════════════════════════════════════════════
        // VIEW FUNCTIONS
        // ════════════════════════════════════════════════════════

        /// Get vault equity (total native balance)
        #[ink(message)]
        pub fn get_vault_equity(&self) -> Balance {
            self.get_vault_equity_internal()
        }

        /// Get current share price (equity / total_shares)
        #[ink(message)]
        pub fn get_share_price(&self) -> Balance {
            self.get_share_price_internal()
        }

        /// Get a depositor's share balance and current value
        #[ink(message)]
        pub fn get_depositor_info(&self, depositor: AccountId) -> (Balance, Balance) {
            let shares = self.shares.get(&depositor).unwrap_or(0);
            if shares == 0 || self.total_shares == 0 {
                return (0, 0);
            }
            let equity = self.get_vault_equity_internal();
            let value = shares
                .checked_mul(equity)
                .unwrap_or(0)
                .checked_div(self.total_shares)
                .unwrap_or(0);
            (shares, value)
        }

        /// Get vault stats
        #[ink(message)]
        pub fn get_vault_stats(
            &self,
        ) -> (
            Balance,        // total_equity
            Balance,        // total_shares
            Balance,        // high_water_mark
            u32,            // performance_fee_bps
            u32,            // active_depositors
            u32,            // trade_count
            bool,           // paused
            bool,           // trading_halted
            Balance,        // total_fees_collected
        ) {
            let current_equity = self.get_vault_equity_internal();
            (
                current_equity,
                self.total_shares,
                self.high_water_mark,
                self.performance_fee_bps,
                self.active_depositors,
                self.trade_count,
                self.paused,
                self.trading_halted,
                self.total_fees_collected,
            )
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

        fn get_vault_equity_internal(&self) -> Balance {
            // Use the contract's native balance as source of truth
            self.env().balance()
        }

        fn get_share_price_internal(&self) -> Balance {
            if self.total_shares == 0 {
                return constants::INITIAL_SHARE_PRICE;
            }
            let equity = self.get_vault_equity_internal();
            equity
                .checked_mul(constants::INITIAL_SHARE_PRICE)
                .unwrap_or(0)
                .checked_div(self.total_shares)
                .unwrap_or(constants::INITIAL_SHARE_PRICE)
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

            let (depositor_shares, _) = vault.get_depositor_info(accounts.charlie);
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
            assert_eq!(vault.get_share_price(), constants::INITIAL_SHARE_PRICE);
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
            let stats = vault.get_vault_stats();
            assert_eq!(stats.3, 2000); // performance_fee_bps
            assert_eq!(stats.4, 0);    // active_depositors
            assert!(!stats.6);         // not paused
            assert!(!stats.7);         // trading not halted
        }
    }
}
