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
/// - Emergency time-locked withdrawal, paid in kind (no valuation needed)
/// - Protocol-admin token allowlist for tracked/bought tokens
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
///    restringe as pontas a esse conjunto, `remove_tracked_token` exige
///    saldo LIVRE 0 e a troca de wnative rastreia o antigo com saldo.
/// 2. `total_shares == 0 ⟺` equity atribuível a cotistas == 0 (módulo
///    donations diretas, que entram no equity diluindo A FAVOR dos
///    cotistas existentes).
/// 3. `share_price` nunca é lido com valuation parcial — falha de
///    cotação reverte a operação (`ValuationUnavailable`), nunca
///    "vale 0".
/// 4. Saque nunca paga mais que `shares/total_shares × equity` no
///    momento do pagamento, e nunca mais que a liquidez nativa
///    disponível (`InsufficientNativeLiquidity` caso contrário).
/// 5. `add_tracked_token` / auto-track nunca passam de
///    MAX_TRACKED_TOKENS. Só a troca de wnative (D3) pode acrescentar o
///    wnative antigo acima do teto (a lista pode ter 9+); a skip list da
///    saída in-kind é limitada por `tracked_token_count + 1`.
/// 6. (A-02) `total_shares == 0 || total_shares >= MINIMUM_SHARES`: o
///    1º depósito soma MINIMUM_SHARES dead shares SÓ em `total_shares`,
///    sem creditá-las a conta alguma — nenhum caller consegue queimá-las.
///    Logo `Σ shares[conta] + MINIMUM_SHARES == total_shares` após o 1º
///    depósito, e "sem depositantes" passa a ser
///    `total_shares <= MINIMUM_SHARES` (ver `depositor_shares`).
/// 7. (A-01) router e factory/wnative só mudam pelo admin do protocolo:
///    na hora quando não há depositantes, ou com depositantes via
///    `propose_*` → `apply_*` após `CONFIG_CHANGE_DELAY_MS` (maior que o
///    atraso do saque de emergência). A proposta caduca em
///    `eta + CONFIG_CHANGE_GRACE_MS`, o setter imediato a descarta, e
///    `deposit` é recusado enquanto ela está viva — todo depositante
///    presente no `apply_*` já o era na proposta. O `amount_out` do swap
///    é o delta de `balance_of(vault)` do token_out, nunca o retorno do
///    router.
/// 8. (Saída in-kind) `reserved_tokens[t] == Σ pending_tokens[(t, *)]`
///    entre mensagens, e o reservado nunca entra no equity, no saldo
///    vendável do swap nem no pro-rata de saídas seguintes: quem fica
///    não recebe o que já é devido a quem saiu.
/// 9. (Allowlist) o vault só rastreia ou compra token permitido AGORA
///    pelo admin do protocolo (wnative é implícito). Com depositantes a
///    permissão só vale após `CONFIG_CHANGE_DELAY_MS`; a remoção é
///    imediata e não força venda.
///
/// ## Riscos aceitos / abertos (só documentação)
/// - (A-03) Cotação spot manipulável no DEPÓSITO e no `withdraw` normal
///   continua aberta: ambos precificam a cota pela reserva instantânea do
///   par (mitigação v1 = `MIN_TRACKING_RESERVE_NATIVE`). A saída de
///   emergência in-kind não depende de cotação.
/// - A saída de emergência não cobra taxa de performance (como antes).
///   O unlock maduro NÃO expira: quem chama `request_emergency_withdrawal`
///   logo após depositar espera 72 h (`EMERGENCY_UNLOCK_DELAY_MS`) UMA
///   vez e passa a ter, enquanto não depositar de novo, a opção
///   permanente de sair a qualquer momento sem taxa. O líder não perde
///   principal; perde a taxa de performance desse depositante.
/// - Skip (renúncia) na saída in-kind: a fração renunciada fica no vault
///   e no NAV, para quem fica. Se TODOS os depositantes saem pulando um
///   ativo, o valor dele fica com as `MINIMUM_SHARES` dead shares (que
///   ninguém resgata) e infla o preço da cota: o próximo depósito perde
///   até ~1 cota por arredondamento (ou falha com `ZeroAmount` se menor
///   que o preço de 1 cota) — mesma classe da doação direta.
/// - Allowlist pendente não bloqueia depósito (ao contrário das propostas
///   de router/infra): o depositante deve consultar
///   `get_token_allowed_at`; a janela conta da permissão, não da entrada.
/// - Transfer PSP22: o vault só confia num retorno `Ok(Ok(Ok(())))` ou na
///   prova pelo saldo (`settle_psp22_transfer`). A ABI de retorno do
///   `transfer` de cada token precisa ser provada em e2e ANTES de
///   `set_token_allowed`.

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
        /// Performance fee cannot be raised while depositors hold shares
        /// (a raise would apply retroactively to capital already in)
        FeeIncreaseWithDepositors,
        /// Router / valuation infra cannot change IMMEDIATELY while
        /// depositors hold shares (their funds would be approved to /
        /// priced by the new contracts without their consent) — use the
        /// timelocked `propose_*` / `apply_*` path instead
        ConfigChangeWithDepositors,
        /// `apply_*` / `cancel_*` called without a pending proposal
        NoPendingConfigChange,
        /// `apply_*` called before the proposal's `eta`
        ConfigChangeTimelocked,
        /// `apply_*` called after `eta + CONFIG_CHANGE_GRACE_MS` — the
        /// proposal lapsed and must be proposed again (fresh notice)
        ConfigChangeExpired,
        /// Deposits are refused while a router / valuation infra change
        /// is pending (not expired), so every depositor present at
        /// `apply_*` had the full notice window
        DepositsBlockedByPendingConfigChange,
        /// Proposed address is the zero AccountId, the vault itself, or
        /// factory == wnative
        InvalidConfigAddress,
        // ── Saída in-kind + allowlist (anexados por último) ─────
        /// Token is not on the protocol admin's allowlist (or its
        /// allowance is not effective yet) — cannot be tracked or bought
        TokenNotAllowed,
        /// `skip_tokens` longer than `tracked_token_count + 1`
        InvalidSkipList,
        /// PSP22 balance of a non-skipped exit asset could not be read —
        /// retry with that token in `skip_tokens`
        TokenUnreadable,
        /// No pending token credit for (token, caller)
        NothingToClaim,
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

    /// `PSP22::transfer(to, value, data)` — trait selector padrão PSP22
    /// usado na saída de emergência in-kind (metadata: 0xdb20f9f5).
    pub const PSP22_TRANSFER_SELECTOR: [u8; 4] = [0xdb, 0x20, 0xf9, 0xf5];

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

    /// Troca de router proposta, aplicável a partir de `eta` (ms).
    #[derive(Debug, PartialEq, Eq, Clone, Copy, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct PendingRouterChange {
        pub router: AccountId,
        pub eta: Timestamp,
    }

    /// Troca de factory/wnative proposta, aplicável a partir de `eta` (ms).
    #[derive(Debug, PartialEq, Eq, Clone, Copy, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct PendingValuationInfraChange {
        pub factory: AccountId,
        pub wnative: AccountId,
        pub eta: Timestamp,
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

        /// A-02: dead shares somadas a `total_shares` no 1º depósito e
        /// nunca queimadas (mesmo valor do `MINIMUM_LIQUIDITY` de
        /// pair/router). Não são creditadas a conta alguma (nem ao
        /// `AccountId` zero, cuja chave de ordem pequena é assinável),
        /// então nenhum caller as saca. Mantém `total_shares` em 0 ou
        /// >= este piso, o que torna o ataque de inflação do primeiro
        /// depositante (1 share + doação) não lucrativo.
        pub const MINIMUM_SHARES: Balance = 1_000;

        /// A-01: atraso entre `propose_router` / `propose_valuation_infra`
        /// e o respectivo `apply_*` quando há depositantes (120h, em ms).
        /// É ESTRITAMENTE maior que `EMERGENCY_UNLOCK_DELAY_MS` (72h) +
        /// 48h de folga: um depositante que pede o saque de emergência ao
        /// ver o evento de proposta consegue executá-lo antes de a troca
        /// poder ser aplicada.
        pub const CONFIG_CHANGE_DELAY_MS: u64 = EMERGENCY_UNLOCK_DELAY_MS + 48 * 60 * 60 * 1000;

        const _: () = assert!(CONFIG_CHANGE_DELAY_MS > EMERGENCY_UNLOCK_DELAY_MS);

        /// A-01 (rodada 2): validade da proposta após o `eta` (48h, em
        /// ms). `apply_*` só passa em `[eta, eta + CONFIG_CHANGE_GRACE_MS]`;
        /// depois a proposta caduca (`ConfigChangeExpired`) e não pode
        /// ficar latente, pré-armada, à espera de depositantes futuros.
        /// Enquanto a proposta está viva (até `eta + grace`), `deposit`
        /// é recusado — logo todo depositante presente no `apply` já o
        /// era na proposta e teve o aviso inteiro de
        /// `CONFIG_CHANGE_DELAY_MS`.
        pub const CONFIG_CHANGE_GRACE_MS: u64 = 48 * 60 * 60 * 1000;
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

    /// Large-withdrawal cooldown started (`request_withdrawal`). Declared
    /// last so the indexes of the existing events stay stable.
    #[ink(event)]
    pub struct WithdrawalRequested {
        #[ink(topic)]
        pub depositor: AccountId,
        pub shares: Balance,
        pub unlock_at: Timestamp,
        pub timestamp: Timestamp,
    }

    /// A-01: router trocado pelo admin (só sem depositantes). Declarado
    /// depois dos existentes para manter os índices estáveis.
    #[ink(event)]
    pub struct RouterChanged {
        pub old_router: Option<AccountId>,
        pub new_router: AccountId,
        pub timestamp: Timestamp,
    }

    /// A-01: factory/wnative trocados pelo admin (só sem depositantes).
    #[ink(event)]
    pub struct ValuationInfraChanged {
        pub factory: AccountId,
        pub wnative: AccountId,
        pub timestamp: Timestamp,
    }

    /// A-01: troca de router proposta (timelock); aplicável a partir de
    /// `eta`. Declarado depois dos existentes para manter os índices.
    #[ink(event)]
    pub struct RouterChangeProposed {
        pub router: AccountId,
        pub eta: Timestamp,
        pub timestamp: Timestamp,
    }

    /// A-01: proposta de troca de router cancelada.
    #[ink(event)]
    pub struct RouterChangeCancelled {
        pub router: AccountId,
        pub timestamp: Timestamp,
    }

    /// A-01: troca de factory/wnative proposta (timelock).
    #[ink(event)]
    pub struct ValuationInfraChangeProposed {
        pub factory: AccountId,
        pub wnative: AccountId,
        pub eta: Timestamp,
        pub timestamp: Timestamp,
    }

    /// A-01: proposta de troca de factory/wnative cancelada.
    #[ink(event)]
    pub struct ValuationInfraChangeCancelled {
        pub factory: AccountId,
        pub wnative: AccountId,
        pub timestamp: Timestamp,
    }

    /// Allowlist: `token` permitido a partir de `effective_at` (ms), ou
    /// removido (`allowed == false`, `effective_at == now`). Declarado
    /// depois dos existentes para manter os índices.
    #[ink(event)]
    pub struct TokenAllowlistChanged {
        #[ink(topic)]
        pub token: AccountId,
        pub allowed: bool,
        pub effective_at: Timestamp,
    }

    /// Saída in-kind: perna PSP22 de `depositor` em `token`.
    /// `status`: 0 = pago, 1 = pendente (`claim_pending_token`),
    /// 2 = renunciado (skip, `amount == 0`).
    #[ink(event)]
    pub struct EmergencyTokenSettled {
        #[ink(topic)]
        pub depositor: AccountId,
        #[ink(topic)]
        pub token: AccountId,
        pub amount: Balance,
        pub status: u8,
    }

    /// Crédito pendente de `token` pago a `account`.
    #[ink(event)]
    pub struct PendingTokenClaimed {
        #[ink(topic)]
        pub account: AccountId,
        #[ink(topic)]
        pub token: AccountId,
        pub amount: Balance,
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

        // --- A-01: trocas de config com timelock (anexados por último) ---
        /// Troca de router pendente (`propose_router`).
        pending_router: Option<PendingRouterChange>,
        /// Troca de factory/wnative pendente (`propose_valuation_infra`).
        pending_valuation_infra: Option<PendingValuationInfraChange>,

        // --- Saída in-kind + allowlist (anexados por último) ---
        /// Tokens que o admin do protocolo permite rastrear/comprar:
        /// token → instante (ms) a partir do qual a permissão vale.
        allowed_tokens: Mapping<AccountId, Timestamp>,
        /// Por token: soma dos valores já devidos a quem saiu (créditos
        /// pendentes). Fora do equity e do distribuível.
        reserved_tokens: Mapping<AccountId, Balance>,
        /// Crédito pendente por (token, conta), resgatável por
        /// `claim_pending_token`.
        pending_tokens: Mapping<(AccountId, AccountId), Balance>,
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
                pending_router: None,
                pending_valuation_infra: None,
                allowed_tokens: Mapping::default(),
                reserved_tokens: Mapping::default(),
                pending_tokens: Mapping::default(),
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
            // Rodada 2 (A-01): sem novos depositantes com troca de
            // router/infra viva — quem está no `apply` teve o aviso todo.
            self.ensure_no_live_config_proposal()?;
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

            // A-02: no 1º depósito, MINIMUM_SHARES entram só em
            // `total_shares` (dead shares sem dono, nunca queimadas).
            // Assim `total_shares` nunca volta a ficar entre 0 e o piso,
            // e inflar o preço da cota via doação custa ao atacante ~toda
            // a doação.
            let dead_shares = if self.total_shares == 0 {
                constants::MINIMUM_SHARES
            } else {
                0
            };

            // Calculate shares to mint
            let shares_to_mint = if self.total_shares == 0 {
                // First deposit: 1:1 shares, minus the dead shares
                // (amount >= MIN_DEPOSIT > MINIMUM_SHARES)
                amount
                    .checked_sub(dead_shares)
                    .ok_or(VaultError::Overflow)?
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
            let existing_shares = self.shares.get(caller).unwrap_or(0);
            let new_shares = existing_shares
                .checked_add(shares_to_mint)
                .ok_or(VaultError::Overflow)?;

            if existing_shares == 0 {
                self.active_depositors = self
                    .active_depositors
                    .checked_add(1)
                    .ok_or(VaultError::Overflow)?;
            }

            self.shares.insert(caller, &new_shares);
            self.total_shares = self
                .total_shares
                .checked_add(shares_to_mint)
                .ok_or(VaultError::Overflow)?
                .checked_add(dead_shares)
                .ok_or(VaultError::Overflow)?;

            self.total_equity = current_balance;

            // Update cost basis (weighted average)
            let existing_basis = self.cost_basis.get(caller).unwrap_or(0);
            let new_basis = existing_basis
                .checked_add(amount)
                .ok_or(VaultError::Overflow)?;
            self.cost_basis.insert(caller, &new_basis);

            // Update high water mark
            if self.total_equity > self.high_water_mark {
                self.high_water_mark = self.total_equity;
            }

            self.total_deposited = self
                .total_deposited
                .checked_add(amount)
                .ok_or(VaultError::Overflow)?;

            // Saída in-kind: depositar desarma o unlock de emergência do
            // caller (fecha "depósito a preço spot + saída in-kind
            // imediata" com unlock pré-armado). Depois de todos os checks.
            self.emergency_unlocks.remove(caller);

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
            let caller_shares = self.shares.get(caller).unwrap_or(0);

            if shares == 0 || shares > caller_shares {
                self.release_lock();
                return Err(VaultError::InsufficientShares);
            }

            // Large withdrawals need a matured `request_withdrawal` covering
            // `shares`. ink! 4 reverts every write of a message returning
            // `Err`, so the request can NOT be created here (it used to be,
            // which made large withdrawals impossible on-chain).
            let is_large = self.is_large_withdrawal(shares);
            if is_large {
                let matured = match self.withdrawal_requests.get(caller) {
                    Some(request) => {
                        let now = self.env().block_timestamp();
                        let unlock_at = request
                            .requested_at
                            .saturating_add(constants::COOLDOWN_PERIOD_MS);
                        now >= unlock_at && shares <= request.shares
                    }
                    None => false,
                };
                if !matured {
                    self.release_lock();
                    return Err(VaultError::CooldownActive);
                }
                // Consumed only if the withdrawal succeeds (Err reverts).
                self.withdrawal_requests.remove(caller);
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

            // Calculate performance fee on profit.
            // CV-FEE-01: custo das `shares` = basis × shares / caller_shares
            // (multiplica ANTES de dividir). O antigo `basis / caller_shares`
            // truncava para ~1 (ou 0, cota < 1,0) e cobrava taxa sobre o
            // principal. Saque total ⇒ custo == basis exatamente.
            // (`caller_shares >= shares > 0` garantido acima.)
            let basis = self.cost_basis.get(caller).unwrap_or(0);
            let cost_for_shares = match Self::mul_div_floor(basis, shares, caller_shares) {
                Ok(cost) => cost,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };

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
                self.shares.remove(caller);
                self.cost_basis.remove(caller);
                self.active_depositors = self.active_depositors.saturating_sub(1);
            } else {
                self.shares.insert(caller, &remaining_shares);
                let remaining_basis = basis.saturating_sub(cost_for_shares);
                self.cost_basis.insert(caller, &remaining_basis);
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

        /// Start the 24h cooldown required for a large withdrawal (> 10% of
        /// the vault shares). Returns the timestamp from which `withdraw`
        /// accepts up to `shares`. Calling again replaces the request and
        /// restarts the cooldown.
        #[ink(message)]
        pub fn request_withdrawal(&mut self, shares: Balance) -> Result<Timestamp, VaultError> {
            let caller = self.env().caller();
            let caller_shares = self.shares.get(caller).unwrap_or(0);
            if shares == 0 || shares > caller_shares {
                return Err(VaultError::InsufficientShares);
            }

            let now = self.env().block_timestamp();
            let unlock_at = now
                .checked_add(constants::COOLDOWN_PERIOD_MS)
                .ok_or(VaultError::Overflow)?;
            self.withdrawal_requests.insert(
                caller,
                &WithdrawalRequest {
                    shares,
                    requested_at: now,
                },
            );

            self.env().emit_event(WithdrawalRequested {
                depositor: caller,
                shares,
                unlock_at,
                timestamp: now,
            });
            Ok(unlock_at)
        }

        /// Pending large-withdrawal cooldown request of `account`, if any.
        #[ink(message)]
        pub fn get_withdrawal_request(&self, account: AccountId) -> Option<WithdrawalRequest> {
            self.withdrawal_requests.get(account)
        }

        /// Request emergency withdrawal (time-locked, bypasses all restrictions)
        #[ink(message)]
        pub fn request_emergency_withdrawal(&mut self) -> Result<Timestamp, VaultError> {
            let caller = self.env().caller();
            let caller_shares = self.shares.get(caller).unwrap_or(0);

            if caller_shares == 0 {
                return Err(VaultError::InsufficientShares);
            }

            let now = self.env().block_timestamp();
            let unlock_at = now
                .checked_add(constants::EMERGENCY_UNLOCK_DELAY_MS)
                .ok_or(VaultError::Overflow)?;

            self.emergency_unlocks.insert(caller, &unlock_at);

            self.env().emit_event(EmergencyWithdrawalRequested {
                depositor: caller,
                shares: caller_shares,
                unlock_at,
                timestamp: now,
            });

            Ok(unlock_at)
        }

        /// Execute emergency withdrawal after unlock period.
        ///
        /// Seletor e assinatura mantidos. Desde a saída in-kind este é o
        /// mesmo caminho de `execute_emergency_withdrawal_in_kind` sem
        /// skip: paga a fração do caller EM ESPÉCIE (nativo + wnative +
        /// cada token rastreado) e devolve só a perna nativa paga. Não
        /// depende de cotação, router, factory, leader, pausa ou halt.
        #[ink(message)]
        pub fn execute_emergency_withdrawal(&mut self) -> Result<Balance, VaultError> {
            self.acquire_lock()?;
            let result = self.emergency_exit_internal(&[]);
            self.release_lock();
            result
        }

        /// Saída de emergência IN-KIND (após o unlock de 72h).
        ///
        /// Paga ao caller `piso(livre × s / total_shares)` de cada ativo
        /// do vault — nativo (saldo − existential deposit), wnative e cada
        /// token rastreado (saldo − `reserved_tokens`) — e queima as `s`
        /// cotas. Não lê cotação nem chama router/factory: funciona com o
        /// vault pausado, trading parado e valuation quebrada.
        ///
        /// * `skip_tokens`: renúncia explícita da fração desses ativos em
        ///   favor de quem fica, com ZERO chamadas ao token (escape de um
        ///   token que trava, queima gas ou devolve saída gigante). No
        ///   máximo `tracked_token_count + 1` entradas; entradas que não
        ///   são ativo do vault são ignoradas.
        /// * Saldo ilegível de um ativo não pulado ⇒ `TokenUnreadable`
        ///   antes de qualquer escrita (refazer com o token em skip).
        /// * Transfer PSP22 com falha limpa (saldo inalterado) ⇒ a saída
        ///   conclui e o valor vira crédito pendente
        ///   (`claim_pending_token`), mantido em `reserved_tokens` fora do
        ///   distribuível. Retorno não confirmado com saldo que caiu
        ///   exatamente o valor ⇒ pago; saldo divergente ou ilegível ⇒
        ///   `TransferFailed` (reverte tudo; refazer com o token em skip).
        ///
        /// Retorna o nativo pago. Emite um `Withdrawn` (`amount_received`
        /// = só a perna nativa, `performance_fee` = 0) e um
        /// `EmergencyTokenSettled` por ativo pago, pendente ou pulado.
        /// Sem taxa de performance (ver "Riscos aceitos" no topo).
        #[ink(message)]
        pub fn execute_emergency_withdrawal_in_kind(
            &mut self,
            skip_tokens: Vec<AccountId>,
        ) -> Result<Balance, VaultError> {
            self.acquire_lock()?;
            let result = self.emergency_exit_internal(&skip_tokens);
            self.release_lock();
            result
        }

        /// Resgata o crédito pendente do caller em `token` (deixado por um
        /// transfer falho na saída in-kind). Paga só ao caller; funciona
        /// pausado e para token não rastreado. Se o transfer falhar de
        /// novo SEM mover saldo devolve `Ok(0)` e o crédito continua de
        /// pé; retorno não confirmado com saldo que caiu exatamente o
        /// crédito conta como pago; qualquer outro caso (saldo ilegível
        /// ou divergente) ⇒ `TransferFailed`, que reverte a mensagem.
        #[ink(message)]
        pub fn claim_pending_token(&mut self, token: AccountId) -> Result<Balance, VaultError> {
            self.acquire_lock()?;
            let caller = self.env().caller();
            let key = (token, caller);
            let amount = self.pending_tokens.get(key).unwrap_or(0);
            if amount == 0 {
                self.release_lock();
                return Err(VaultError::NothingToClaim);
            }
            // Débito ANTES de qualquer chamada ao token (inclusive a
            // leitura de saldo); a reserva só cai após o sucesso.
            self.pending_tokens.remove(key);
            // Saldo ANTES do transfer: prova do que saiu se o retorno do
            // token não for confirmado (ver `settle_psp22_transfer`).
            let balance_before = self.psp22_balance_of(token).ok();
            let paid = match self.settle_psp22_transfer(token, caller, amount, balance_before) {
                Ok(true) => {
                    let reserved = self.reserved_of(token).saturating_sub(amount);
                    self.set_reserved(token, reserved);
                    self.env().emit_event(PendingTokenClaimed {
                        account: caller,
                        token,
                        amount,
                    });
                    amount
                }
                Ok(false) => {
                    self.pending_tokens.insert(key, &amount);
                    0
                }
                Err(e) => {
                    // On-chain o `Err` reverte tudo; aqui só espelha o
                    // estado do vault de antes da chamada.
                    self.pending_tokens.insert(key, &amount);
                    self.release_lock();
                    return Err(e);
                }
            };
            self.release_lock();
            Ok(paid)
        }

        /// Prévia da saída in-kind de `account` (sem skip): (nativo,
        /// [(ativo, valor)]) na ordem de pagamento, com `None` quando o
        /// saldo do ativo é ilegível (ou, fora do domínio de
        /// `mul_div_floor`, quando a perna estouraria): é o ativo que a
        /// saída real recusa e que entra na skip list.
        /// `(0, [])` se a conta não tem cotas.
        #[ink(message)]
        pub fn preview_emergency_exit(
            &self,
            account: AccountId,
        ) -> (Balance, Vec<(AccountId, Option<Balance>)>) {
            let s = self.shares.get(account).unwrap_or(0);
            let total = self.total_shares;
            if s == 0 || s > total {
                return (0, Vec::new());
            }
            let native = self.native_exit_amount(s, total).unwrap_or(0);
            let legs = self
                .exit_assets()
                .into_iter()
                .map(|asset| (asset, self.token_exit_amount(asset, s, total).ok()))
                .collect();
            (native, legs)
        }

        /// Crédito pendente de `account` em `token`.
        #[ink(message)]
        pub fn get_pending_token(&self, token: AccountId, account: AccountId) -> Balance {
            self.pending_tokens.get((token, account)).unwrap_or(0)
        }

        /// Total reservado (devido a quem já saiu) de `token`.
        #[ink(message)]
        pub fn get_reserved_token(&self, token: AccountId) -> Balance {
            self.reserved_of(token)
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
            self.trade_history.insert(idx, &record);
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
        ///   3. Resets the router allowance on `token_in` to 0,
        ///   4. Measures the actual `amount_out` as the delta of the
        ///      vault's `balance_of(token_out)` before/after the swap —
        ///      the router's returned `Vec<Balance>` is NOT trusted (A-01),
        ///   5. Updates `total_equity` from on-chain state — never from a
        ///      parameter provided by the leader.
        ///
        /// Slippage protection is enforced via `min_amount_out` on that
        /// balance delta: if the vault received less, the call reverts
        /// and the vault state is unchanged.
        ///
        /// Requires: leader, not paused, trading active, router configured.
        #[ink(message)]
        pub fn swap_through_router(
            &mut self,
            token_in: AccountId,
            token_out: AccountId,
            amount_in: Balance,
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
            // Allowlist: só se COMPRA wnative ou token permitido agora —
            // mesmo que já rastreado (token removido da allowlist ainda
            // pode ser vendido como token_in).
            if token_out != wnative && !self.token_allowed_now(token_out) {
                self.release_lock();
                return Err(VaultError::TokenNotAllowed);
            }
            // Saldo REAL de token_in via balance_of — nunca via equity
            // (era exatamente a confusão do P0-3) — menos o que está
            // reservado a quem já saiu (saída in-kind).
            let token_in_balance = match self.free_token_balance(token_in) {
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
            // A-01: o amount_out efetivo é o DELTA de balance_of(vault)
            // em token_out (antes/depois), nunca o `amounts.last()` que o
            // router devolve — um router malicioso pode mentir no retorno.
            let token_out_before = match self.psp22_balance_of(token_out) {
                Ok(b) => b,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };

            // Bypassed under unit-test cfg — there is no router contract in
            // the ink test env. O caminho real (approve → router → swap) é
            // exercitado on-chain pelo script E2E manual
            // `spot-api/scripts/e2e-copy-vault-equity.ts` (fora de CI). Ele
            // NÃO afirma `allowance(vault, router) == 0` após o swap nem
            // `retorno == delta de balance_of`: essas duas propriedades do
            // A-01 não têm prova automatizada hoje.
            #[cfg(not(test))]
            {
                use ink::env::call::{build_call, ExecutionInput, Selector};

                // 1) approve(router, amount_in) no token_in.
                if let Err(e) = self.psp22_approve(token_in, router, amount_in) {
                    self.release_lock();
                    return Err(e);
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
                let path: Vec<AccountId> = ink::prelude::vec![token_in, token_out];

                let swap_result = build_call::<ink::env::DefaultEnvironment>()
                    .call(router)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(ROUTER_SWAP_EXACT_TOKENS_SELECTOR))
                            .push_arg(amount_in)
                            .push_arg(min_amount_out)
                            .push_arg(path)
                            .push_arg(self.env().account_id())
                            .push_arg(deadline),
                    )
                    .returns::<core::result::Result<Vec<Balance>, RouterErrorMirror>>()
                    .try_invoke();

                // O valor retornado (amounts) é ignorado de propósito: o
                // que conta é o delta de saldo medido abaixo.
                if !matches!(swap_result, Ok(Ok(Ok(_)))) {
                    self.release_lock();
                    return Err(VaultError::SwapFailed);
                }

                // 4) A-01: zera a allowance remanescente do router.
                if let Err(e) = self.psp22_approve(token_in, router, 0) {
                    self.release_lock();
                    return Err(e);
                }
            }
            #[cfg(test)]
            {
                let _ = router; // usado apenas no caminho cfg(not(test))
                test_mocks::simulate_router_swap(token_out, min_amount_out);
            }

            let token_out_after = match self.psp22_balance_of(token_out) {
                Ok(b) => b,
                Err(e) => {
                    self.release_lock();
                    return Err(e);
                }
            };
            let amount_out = match token_out_after.checked_sub(token_out_before) {
                Some(delta) => delta,
                None => {
                    self.release_lock();
                    return Err(VaultError::SwapFailed);
                }
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
            self.trade_history.insert(idx, &record);
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
                let drawdown = self.high_water_mark.saturating_sub(current_equity);
                let drawdown_bps = drawdown
                    .checked_mul(constants::BPS as u128)
                    .unwrap_or(0)
                    .checked_div(self.high_water_mark)
                    .unwrap_or(0) as u32;

                if drawdown_bps > self.max_drawdown_bps {
                    self.trading_halted = true;

                    self.env().emit_event(CircuitBreakerTriggered {
                        vault: self.env().account_id(),
                        current_equity,
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

        /// Unpause the vault (protocol admin only — the leader can pause
        /// but never lift a pause)
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            self.paused = false;
            self.env().emit_event(VaultUnpausedEvent {
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Resume trading after circuit breaker (protocol admin only —
        /// the leader must not reset the breaker it tripped)
        #[ink(message)]
        pub fn resume_trading(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            self.trading_halted = false;
            self.total_equity = self.get_vault_equity_internal()?;
            // Reset high water mark to current equity to prevent immediate re-trigger
            self.high_water_mark = self.total_equity;
            Ok(())
        }

        /// Set performance fee (max 50%). Lowering: protocol admin or
        /// leader. Raising: protocol admin only, and only while no
        /// depositor holds shares, so a raise never applies retroactively
        /// to capital already in the vault.
        #[ink(message)]
        pub fn set_performance_fee(&mut self, new_fee_bps: u32) -> Result<(), VaultError> {
            self.ensure_admin()?;
            if new_fee_bps > constants::MAX_PERFORMANCE_FEE_BPS {
                return Err(VaultError::FeeTooHigh);
            }
            if new_fee_bps > self.performance_fee_bps {
                // O leader só pode reduzir a própria taxa.
                self.ensure_protocol_admin()?;
                // Dead shares (A-02) não são depositantes.
                if self.depositor_shares() > 0 {
                    return Err(VaultError::FeeIncreaseWithDepositors);
                }
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

        /// Set maximum drawdown before circuit breaker triggers (protocol
        /// admin only — the leader must not loosen its own breaker)
        #[ink(message)]
        pub fn set_max_drawdown(&mut self, drawdown_bps: u32) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            if drawdown_bps == 0 || drawdown_bps > constants::BPS {
                return Err(VaultError::ZeroAmount);
            }
            self.max_drawdown_bps = drawdown_bps;
            Ok(())
        }

        /// Configure the Router contract used for real on-chain swaps.
        /// Must be set before `swap_through_router` is callable.
        ///
        /// A-01: protocol admin only (NOT the leader) and, immediately,
        /// only while no depositor holds shares — the router receives
        /// `approve` over vault funds and prices the NAV, so swapping it
        /// under live deposits without notice would let a malicious
        /// router drain them. With depositors use `propose_router` /
        /// `apply_router` (timelock `CONFIG_CHANGE_DELAY_MS`). Discards
        /// (and emits `RouterChangeCancelled` for) any pending proposal.
        #[ink(message)]
        pub fn set_router(&mut self, router: AccountId) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            self.ensure_no_depositors()?;
            // Rodada 2: a troca imediata descarta a proposta pendente —
            // ela não pode ficar latente (pré-armada) para depois.
            if let Some(pending) = self.pending_router.take() {
                self.env().emit_event(RouterChangeCancelled {
                    router: pending.router,
                    timestamp: self.env().block_timestamp(),
                });
            }
            let old_router = self.router;
            self.router = Some(router);
            self.env().emit_event(RouterChanged {
                old_router,
                new_router: router,
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Returns the configured router address (None if not set).
        #[ink(message)]
        pub fn router_address(&self) -> Option<AccountId> {
            self.router
        }

        /// A-01: propõe a troca do router (admin do protocolo). Aplicável
        /// por `apply_router` a partir do `eta` retornado
        /// (`now + CONFIG_CHANGE_DELAY_MS`) até `eta +
        /// CONFIG_CHANGE_GRACE_MS`. Nova proposta sobrescreve a anterior e
        /// reinicia o relógio. Enquanto viva, `deposit` é recusado.
        /// Recusa o AccountId zero e o próprio vault.
        #[ink(message)]
        pub fn propose_router(&mut self, router: AccountId) -> Result<Timestamp, VaultError> {
            self.ensure_protocol_admin()?;
            self.ensure_valid_config_address(router)?;
            let eta = self.config_change_eta()?;
            let now = self.env().block_timestamp();
            self.pending_router = Some(PendingRouterChange { router, eta });
            self.env().emit_event(RouterChangeProposed {
                router,
                eta,
                timestamp: now,
            });
            Ok(eta)
        }

        /// A-01: aplica a troca de router proposta, em
        /// `[eta, eta + CONFIG_CHANGE_GRACE_MS]` (depois: `ConfigChangeExpired`).
        #[ink(message)]
        pub fn apply_router(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            let pending = self
                .pending_router
                .ok_or(VaultError::NoPendingConfigChange)?;
            let now = self.env().block_timestamp();
            Self::ensure_config_change_window(pending.eta, now)?;
            let old_router = self.router;
            self.router = Some(pending.router);
            self.pending_router = None;
            self.env().emit_event(RouterChanged {
                old_router,
                new_router: pending.router,
                timestamp: now,
            });
            Ok(())
        }

        /// A-01: cancela a troca de router pendente.
        #[ink(message)]
        pub fn cancel_router_proposal(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            let pending = self
                .pending_router
                .ok_or(VaultError::NoPendingConfigChange)?;
            self.pending_router = None;
            self.env().emit_event(RouterChangeCancelled {
                router: pending.router,
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Troca de router pendente (None se não houver).
        #[ink(message)]
        pub fn get_pending_router(&self) -> Option<PendingRouterChange> {
            self.pending_router
        }

        // ════════════════════════════════════════════════════════
        // ALLOWLIST DE TOKENS
        // ════════════════════════════════════════════════════════

        /// Allowlist (admin do protocolo): permite ou remove `token` como
        /// ativo que o vault pode rastrear e comprar.
        ///
        /// * `true`: sem depositantes vale na hora; com depositantes vale
        ///   a partir de `now + CONFIG_CHANGE_DELAY_MS` (aviso a quem está
        ///   dentro). Entrada já existente ⇒ `Ok` sem alterar nem emitir
        ///   (não reinicia o prazo). wnative é implícito
        ///   (`CannotTrackWnative`).
        /// * `false`: remove na hora (cancela permissão pendente); ausente
        ///   ⇒ `Ok`. O token continua rastreado, avaliado, vendável e
        ///   pago in-kind; só não pode mais ser comprado nem re-rastreado.
        ///
        /// Recusa o AccountId zero e o próprio vault.
        ///
        /// Regras operacionais: (1) provar em e2e, ANTES de permitir, a
        /// ABI de retorno de `PSP22::transfer` do token
        /// (`Result<Result<(), PSP22Error>, LangError>`, ink! 4); um token
        /// cujo retorno não decodifica só é liquidado pela prova de saldo
        /// de `settle_psp22_transfer` e, se ela não fechar, a saída falha
        /// com `TransferFailed` até o usuário pular o token. (2) A
        /// permissão pendente NÃO bloqueia depósito: quem entra durante a
        /// janela deve consultar `get_token_allowed_at`.
        #[ink(message)]
        pub fn set_token_allowed(
            &mut self,
            token: AccountId,
            allowed: bool,
        ) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            self.ensure_valid_config_address(token)?;
            let now = self.env().block_timestamp();
            if allowed {
                if self.wnative == Some(token) {
                    return Err(VaultError::CannotTrackWnative);
                }
                if self.allowed_tokens.contains(token) {
                    return Ok(());
                }
                let effective_at = if self.depositor_shares() == 0 {
                    now
                } else {
                    self.config_change_eta()?
                };
                self.allowed_tokens.insert(token, &effective_at);
                self.env().emit_event(TokenAllowlistChanged {
                    token,
                    allowed: true,
                    effective_at,
                });
            } else if self.allowed_tokens.contains(token) {
                self.allowed_tokens.remove(token);
                self.env().emit_event(TokenAllowlistChanged {
                    token,
                    allowed: false,
                    effective_at: now,
                });
            }
            Ok(())
        }

        /// `token` está permitido AGORA (entrada existe e já vale)?
        #[ink(message)]
        pub fn is_token_allowed(&self, token: AccountId) -> bool {
            self.token_allowed_now(token)
        }

        /// Instante (ms) a partir do qual `token` é permitido (None se não
        /// está na allowlist).
        #[ink(message)]
        pub fn get_token_allowed_at(&self, token: AccountId) -> Option<Timestamp> {
            self.allowed_tokens.get(token)
        }

        // ════════════════════════════════════════════════════════
        // ADR-002 — TRACKED TOKENS & VALUATION
        // ════════════════════════════════════════════════════════

        /// Configura a infra de valuation (factory + wnative) usada na
        /// cotação on-chain do equity. Deve ser chamada antes de
        /// qualquer swap/tracking.
        ///
        /// A-01: só o admin do protocolo (NÃO o leader) e, na hora, só
        /// sem depositantes — uma factory falsa torna o NAV arbitrário.
        /// Com depositantes: `propose_valuation_infra` /
        /// `apply_valuation_infra` (timelock `CONFIG_CHANGE_DELAY_MS`).
        /// Descarta (com `ValuationInfraChangeCancelled`) a proposta
        /// pendente.
        ///
        /// Troca de wnative: mesma regra de `apply_valuation_infra` (ver
        /// `switch_valuation_infra`).
        #[ink(message)]
        pub fn set_valuation_infra(
            &mut self,
            factory: AccountId,
            wnative: AccountId,
        ) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            self.ensure_no_depositors()?;
            // Rodada 2: descarta a proposta pendente (ver `set_router`).
            if let Some(pending) = self.pending_valuation_infra.take() {
                self.env().emit_event(ValuationInfraChangeCancelled {
                    factory: pending.factory,
                    wnative: pending.wnative,
                    timestamp: self.env().block_timestamp(),
                });
            }
            self.switch_valuation_infra(factory, wnative)?;
            self.env().emit_event(ValuationInfraChanged {
                factory,
                wnative,
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Retorna (factory, wnative) configurados.
        #[ink(message)]
        pub fn get_valuation_infra(&self) -> (Option<AccountId>, Option<AccountId>) {
            (self.factory, self.wnative)
        }

        /// A-01: propõe a troca de factory/wnative (admin do protocolo).
        /// Aplicável por `apply_valuation_infra` a partir do `eta`
        /// retornado (`now + CONFIG_CHANGE_DELAY_MS`) até `eta +
        /// CONFIG_CHANGE_GRACE_MS`. Nova proposta sobrescreve a anterior e
        /// reinicia o relógio. Enquanto viva, `deposit` é recusado.
        /// Recusa AccountId zero, o próprio vault e factory == wnative.
        #[ink(message)]
        pub fn propose_valuation_infra(
            &mut self,
            factory: AccountId,
            wnative: AccountId,
        ) -> Result<Timestamp, VaultError> {
            self.ensure_protocol_admin()?;
            self.ensure_valid_config_address(factory)?;
            self.ensure_valid_config_address(wnative)?;
            if factory == wnative {
                return Err(VaultError::InvalidConfigAddress);
            }
            let eta = self.config_change_eta()?;
            let now = self.env().block_timestamp();
            self.pending_valuation_infra = Some(PendingValuationInfraChange {
                factory,
                wnative,
                eta,
            });
            self.env().emit_event(ValuationInfraChangeProposed {
                factory,
                wnative,
                eta,
                timestamp: now,
            });
            Ok(eta)
        }

        /// A-01: aplica a troca de factory/wnative proposta, em
        /// `[eta, eta + CONFIG_CHANGE_GRACE_MS]` (depois: `ConfigChangeExpired`).
        ///
        /// Troca de wnative COM saldo (D3, ver `switch_valuation_infra`):
        /// o wnative antigo com saldo vira token rastreado comum e o novo
        /// sai da lista de rastreados. Regra operacional do admin: criar o
        /// par wnative antigo↔novo na factory NOVA antes do `apply` — sem
        /// ele o wnative antigo fica sem cotação (`ValuationUnavailable`
        /// fecha depósito e saque normal; a saída de emergência in-kind
        /// continua funcionando; o líder vende e des-rastreia).
        #[ink(message)]
        pub fn apply_valuation_infra(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            let pending = self
                .pending_valuation_infra
                .ok_or(VaultError::NoPendingConfigChange)?;
            let now = self.env().block_timestamp();
            Self::ensure_config_change_window(pending.eta, now)?;
            self.switch_valuation_infra(pending.factory, pending.wnative)?;
            self.pending_valuation_infra = None;
            self.env().emit_event(ValuationInfraChanged {
                factory: pending.factory,
                wnative: pending.wnative,
                timestamp: now,
            });
            Ok(())
        }

        /// A-01: cancela a troca de factory/wnative pendente.
        #[ink(message)]
        pub fn cancel_valuation_infra_proposal(&mut self) -> Result<(), VaultError> {
            self.ensure_protocol_admin()?;
            let pending = self
                .pending_valuation_infra
                .ok_or(VaultError::NoPendingConfigChange)?;
            self.pending_valuation_infra = None;
            self.env().emit_event(ValuationInfraChangeCancelled {
                factory: pending.factory,
                wnative: pending.wnative,
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Troca de factory/wnative pendente (None se não houver).
        #[ink(message)]
        pub fn get_pending_valuation_infra(&self) -> Option<PendingValuationInfraChange> {
            self.pending_valuation_infra
        }

        /// Adiciona um token PSP22 à lista de rastreados (admin/leader).
        /// Falha se o token não está permitido agora pela allowlist do
        /// admin do protocolo (`TokenNotAllowed`), se a lista está cheia
        /// (MAX_TRACKED_TOKENS), se o token já é rastreado, ou se o par
        /// token<>wnative não existe / não tem a reserva nativa mínima
        /// (anti-manipulação v1).
        #[ink(message)]
        pub fn add_tracked_token(&mut self, token: AccountId) -> Result<(), VaultError> {
            self.ensure_admin()?;
            self.track_token_internal(token)
        }

        /// Remove um token da lista de rastreados (admin/leader).
        /// NUNCA des-rastreia com posição aberta: falha se o saldo LIVRE
        /// (balance_of(vault, token) − reservado a quem saiu) > 0
        /// (invariante 1). O reservado segue resgatável por
        /// `claim_pending_token`.
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
                if let Some(token) = self.tracked_tokens.get(i) {
                    tokens.push(token);
                }
            }
            tokens
        }

        /// Valuation em nativo do saldo LIVRE do vault em `token` (menos
        /// o reservado a quem saiu, como no equity; 0 se o saldo livre é
        /// 0; ERRO explícito se a cotação falhar).
        #[ink(message)]
        pub fn get_token_valuation(&self, token: AccountId) -> Result<Balance, VaultError> {
            let balance = self.free_token_balance(token)?;
            if balance == 0 {
                return Ok(0);
            }
            self.quote_token_to_native(token, balance)
        }

        /// Decomposição do equity: (saldo_nativo,
        /// [(token, balance, valor_em_nativo)], total).
        /// Inclui wnative (1:1) quando o vault tem saldo. ERRO explícito
        /// se qualquer cotação falhar — nunca valuation parcial.
        /// `balance` é o saldo LIVRE (menos o reservado a quem saiu), o
        /// mesmo que entra em `get_vault_equity`.
        #[allow(clippy::type_complexity)]
        #[ink(message)]
        pub fn get_equity_breakdown(
            &self,
        ) -> Result<(Balance, Vec<(AccountId, Balance, Balance)>, Balance), VaultError> {
            let native = self.env().balance();
            let mut entries: Vec<(AccountId, Balance, Balance)> = Vec::new();
            let mut total = native;

            if let Some(wnative) = self.wnative {
                let balance = self.free_token_balance(wnative)?;
                if balance > 0 {
                    entries.push((wnative, balance, balance));
                    total = total.checked_add(balance).ok_or(VaultError::Overflow)?;
                }
            }

            for i in 0..self.tracked_token_count {
                let token = self
                    .tracked_tokens
                    .get(i)
                    .ok_or(VaultError::ValuationUnavailable)?;
                // Estado legado wnative == rastreado: já contado 1:1
                // acima (mesma regra de `exit_assets`).
                if Some(token) == self.wnative {
                    continue;
                }
                let balance = self.free_token_balance(token)?;
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
            let shares = self.shares.get(depositor).unwrap_or(0);
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
        #[allow(clippy::type_complexity)]
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

            let start = self.trade_count.saturating_sub(max);

            for i in start..self.trade_count {
                let idx = i % constants::MAX_TRADE_HISTORY;
                if let Some(record) = self.trade_history.get(idx) {
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
        /// Saldos PSP22 entram LIVRES: o reservado a quem já saiu pela
        /// saída in-kind (`reserved_tokens`) não é dos cotistas.
        fn equity_split_internal(&self) -> Result<(Balance, Balance), VaultError> {
            let native = self.env().balance();
            let mut tokens_value: Balance = 0;

            if let Some(wnative) = self.wnative {
                let balance = self.free_token_balance(wnative)?;
                tokens_value = tokens_value
                    .checked_add(balance)
                    .ok_or(VaultError::Overflow)?;
            }

            for i in 0..self.tracked_token_count {
                let token = self
                    .tracked_tokens
                    .get(i)
                    .ok_or(VaultError::ValuationUnavailable)?;
                // Estado legado wnative == rastreado: já contado 1:1
                // acima (mesma regra de `exit_assets`).
                if Some(token) == self.wnative {
                    continue;
                }
                let balance = self.free_token_balance(token)?;
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
            native.checked_add(tokens_value).ok_or(VaultError::Overflow)
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
            self.tracked_token_index.contains(token)
        }

        fn track_token_internal(&mut self, token: AccountId) -> Result<(), VaultError> {
            let (factory, wnative) = self.require_valuation_infra()?;
            if token == wnative {
                return Err(VaultError::CannotTrackWnative);
            }
            // Allowlist: leader/admin só rastreiam (e o swap só auto-
            // rastreia) o que o admin do protocolo permitiu.
            if !self.token_allowed_now(token) {
                return Err(VaultError::TokenNotAllowed);
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
            let (_reserve_token, reserve_native) = self.pair_reserves(token, wnative, factory)?;
            if reserve_native < constants::MIN_TRACKING_RESERVE_NATIVE {
                return Err(VaultError::InsufficientPairLiquidity);
            }

            self.push_tracked(token)
        }

        fn untrack_token_internal(&mut self, token: AccountId) -> Result<(), VaultError> {
            let idx = self
                .tracked_token_index
                .get(token)
                .ok_or(VaultError::TokenNotTracked)?;
            // Invariante 1: nunca des-rastrear com posição aberta. O
            // reservado a quem saiu não é posição do vault.
            let balance = self.free_token_balance(token)?;
            if balance > 0 {
                return Err(VaultError::TokenHasBalance);
            }
            self.remove_tracked(token, idx)
        }

        /// Acrescenta `token` no fim da lista densa, SEM checagens de
        /// política (allowlist, liquidez, teto) — quem chama decide.
        fn push_tracked(&mut self, token: AccountId) -> Result<(), VaultError> {
            let idx = self.tracked_token_count;
            let count = idx.checked_add(1).ok_or(VaultError::Overflow)?;
            self.tracked_tokens.insert(idx, &token);
            self.tracked_token_index.insert(token, &idx);
            self.tracked_token_count = count;

            self.env().emit_event(TrackedTokenAdded {
                token,
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Swap-remove de `token` (posição `idx`) mantendo o índice denso,
        /// SEM checar saldo — quem chama decide.
        fn remove_tracked(&mut self, token: AccountId, idx: u32) -> Result<(), VaultError> {
            let last = self
                .tracked_token_count
                .checked_sub(1)
                .ok_or(VaultError::Overflow)?;
            let moved = if idx != last {
                Some(
                    self.tracked_tokens
                        .get(last)
                        .ok_or(VaultError::TokenNotTracked)?,
                )
            } else {
                None
            };
            if let Some(moved) = moved {
                self.tracked_tokens.insert(idx, &moved);
                self.tracked_token_index.insert(moved, &idx);
            }
            self.tracked_tokens.remove(last);
            self.tracked_token_index.remove(token);
            self.tracked_token_count = last;

            self.env().emit_event(TrackedTokenRemoved {
                token,
                by: self.env().caller(),
            });
            Ok(())
        }

        /// D3: grava factory/wnative aplicando a regra da troca de wnative
        /// (chamada por `set_valuation_infra` e `apply_valuation_infra`).
        /// Só quando o wnative MUDA:
        /// 1. se o novo wnative estava rastreado, sai da lista sem checar
        ///    saldo (passa a valer 1:1 como wnative — sem dupla contagem);
        /// 2. se havia wnative antigo e o saldo dele no vault é > 0 (ou a
        ///    leitura falha), ele entra na lista de rastreados IGNORANDO
        ///    allowlist, liquidez mínima e MAX_TRACKED_TOKENS — nunca sai
        ///    do NAV nem da saída in-kind. Saldo lido 0 ⇒ não rastreia.
        ///
        /// Depois da troca o wnative antigo é um token rastreado comum,
        /// cotado pela factory nova; sem par antigo↔novo ele fica sem
        /// cotação (`ValuationUnavailable` fecha depósito, saque normal,
        /// `sync_equity` e o próprio swap do líder, que lê o equity antes
        /// de trocar; a saída de emergência in-kind segue funcionando).
        /// Como ele não está na allowlist, pode ser vendido mas não
        /// recomprado.
        ///
        /// Regras operacionais do admin do protocolo:
        /// * criar o par antigo↔novo (com reservas) na factory nova ANTES
        ///   do `apply`, MESMO com saldo zero no wnative antigo: qualquer
        ///   conta pode doar 1 planck durante o timelock e o antigo é
        ///   rastreado no `apply`. Sem par, o líder não consegue vender nem
        ///   des-rastrear (`TokenHasBalance`); a recuperação é criar o par
        ///   (permissionless) ou rotacionar de volta (novo timelock).
        /// * limitações conhecidas: um wnative antigo que trapa/queima gas
        ///   no `balance_of` derruba a própria rotação; um que falha limpo
        ///   fica rastreado sem rota administrativa de des-rastreio (só a
        ///   saída in-kind com skip). Cada rotação com saldo acrescenta um
        ///   item acima de `MAX_TRACKED_TOKENS`, sem teto rígido — o custo
        ///   de gas da saída sem skip cresce junto; medir em e2e.
        fn switch_valuation_infra(
            &mut self,
            factory: AccountId,
            new_wnative: AccountId,
        ) -> Result<(), VaultError> {
            let old_wnative = self.wnative;
            if old_wnative != Some(new_wnative) {
                if let Some(idx) = self.tracked_token_index.get(new_wnative) {
                    self.remove_tracked(new_wnative, idx)?;
                }
                if let Some(old) = old_wnative {
                    let has_balance = match self.psp22_balance_of(old) {
                        Ok(balance) => balance > 0,
                        Err(_) => true,
                    };
                    if has_balance && !self.is_tracked(old) {
                        self.push_tracked(old)?;
                    }
                }
            }
            self.factory = Some(factory);
            self.wnative = Some(new_wnative);
            Ok(())
        }

        // ── Saída in-kind + allowlist ────────────────────────────

        /// Corpo da saída de emergência in-kind. Pressupõe o lock tomado
        /// (os wrappers liberam em todo caminho). Ordem: checks →
        /// leituras/matemática → transfer nativo → escritas → evento
        /// `Withdrawn` → transfers PSP22 → eventos por ativo.
        /// Depois da primeira escrita só há um `Err`: transfer PSP22 não
        /// confirmado que não se prova pelo saldo (`TransferFailed`), que
        /// on-chain reverte a mensagem inteira (falha fechada).
        fn emergency_exit_internal(
            &mut self,
            skip_tokens: &[AccountId],
        ) -> Result<Balance, VaultError> {
            // 1) Checks.
            let max_skip = (self.tracked_token_count as usize).saturating_add(1);
            if skip_tokens.len() > max_skip {
                return Err(VaultError::InvalidSkipList);
            }
            let caller = self.env().caller();
            let now = self.env().block_timestamp();
            match self.emergency_unlocks.get(caller) {
                Some(unlock_at) if now >= unlock_at => {}
                _ => return Err(VaultError::EmergencyNotUnlocked),
            }
            let s = self.shares.get(caller).unwrap_or(0);
            if s == 0 {
                return Err(VaultError::InsufficientShares);
            }
            let total = self.total_shares;
            if s > total {
                return Err(VaultError::Overflow);
            }

            // 2) Leituras e matemática (nenhuma escrita). `None` = skip:
            // nenhuma chamada ao token. `Some((valor, saldo_lido))`: o
            // saldo lido aqui é o "antes" de `settle_psp22_transfer`.
            let native_out = self.native_exit_amount(s, total)?;
            let mut legs: Vec<(AccountId, Option<(Balance, Balance)>)> = Vec::new();
            for asset in self.exit_assets() {
                if skip_tokens.contains(&asset) {
                    legs.push((asset, None));
                } else {
                    legs.push((asset, Some(self.token_exit_leg(asset, s, total)?)));
                }
            }
            let new_total = total.checked_sub(s).ok_or(VaultError::Overflow)?;
            let new_equity = Self::mul_div_floor(self.total_equity, new_total, total)?;
            let new_hwm = Self::mul_div_floor(self.high_water_mark, new_total, total)?;

            // 3) Perna nativa (KeepAlive, não executa código do destino).
            if native_out > 0 && self.env().transfer(caller, native_out).is_err() {
                return Err(VaultError::TransferFailed);
            }

            // 4) Escritas — cotas queimadas ANTES de qualquer chamada a
            // token; tudo o que é devido entra na reserva.
            self.shares.remove(caller);
            self.cost_basis.remove(caller);
            self.emergency_unlocks.remove(caller);
            self.withdrawal_requests.remove(caller);
            self.total_shares = new_total;
            self.total_equity = new_equity;
            self.high_water_mark = new_hwm;
            self.active_depositors = self.active_depositors.saturating_sub(1);
            self.total_withdrawn = self.total_withdrawn.saturating_add(native_out);
            for (asset, leg) in legs.iter() {
                if let Some((amount, _)) = *leg {
                    if amount > 0 {
                        let reserved = self.reserved_of(*asset).saturating_add(amount);
                        self.set_reserved(*asset, reserved);
                    }
                }
            }

            // 5) Exatamente um Withdrawn (perna nativa, sem taxa).
            self.env().emit_event(Withdrawn {
                depositor: caller,
                shares_burned: s,
                amount_received: native_out,
                performance_fee: 0,
                timestamp: now,
            });

            // 6) Pernas PSP22, na ordem da lista. Falha limpa (saldo
            // inalterado) ⇒ crédito pendente por VALOR (a reserva fica).
            // Único `Err` possível aqui: transfer não confirmado com saldo
            // ilegível/divergente (`settle_psp22_transfer`) — on-chain ele
            // reverte a mensagem INTEIRA (perna nativa, escritas e
            // movimentos de token); o usuário refaz com o token em skip.
            for (asset, leg) in legs {
                match leg {
                    None => self.env().emit_event(EmergencyTokenSettled {
                        depositor: caller,
                        token: asset,
                        amount: 0,
                        status: 2,
                    }),
                    Some((0, _)) => {}
                    Some((amount, balance_before)) => {
                        let paid = self.settle_psp22_transfer(
                            asset,
                            caller,
                            amount,
                            Some(balance_before),
                        )?;
                        let status = if paid {
                            let reserved = self.reserved_of(asset).saturating_sub(amount);
                            self.set_reserved(asset, reserved);
                            0
                        } else {
                            let key = (asset, caller);
                            let pending = self
                                .pending_tokens
                                .get(key)
                                .unwrap_or(0)
                                .saturating_add(amount);
                            self.pending_tokens.insert(key, &pending);
                            1
                        };
                        self.env().emit_event(EmergencyTokenSettled {
                            depositor: caller,
                            token: asset,
                            amount,
                            status,
                        });
                    }
                }
            }

            Ok(native_out)
        }

        /// Ativos pagos na saída in-kind, em ordem: wnative (se
        /// configurado) e os rastreados, omitindo um rastreado igual ao
        /// wnative (estado legado — sem isso haveria pagamento duplo).
        fn exit_assets(&self) -> Vec<AccountId> {
            let mut assets = Vec::new();
            if let Some(wnative) = self.wnative {
                assets.push(wnative);
            }
            for i in 0..self.tracked_token_count {
                if let Some(token) = self.tracked_tokens.get(i) {
                    if Some(token) != self.wnative {
                        assets.push(token);
                    }
                }
            }
            assets
        }

        /// Perna nativa da saída: piso((saldo − ED) × s / total). O ED
        /// fica sempre no vault (transfer nativo é KeepAlive).
        fn native_exit_amount(&self, s: Balance, total: Balance) -> Result<Balance, VaultError> {
            let free = self
                .env()
                .balance()
                .saturating_sub(self.env().minimum_balance());
            Self::mul_div_floor(free, s, total)
        }

        /// Perna de `token` na saída: piso(saldo livre × s / total).
        /// Saldo ilegível ⇒ `TokenUnreadable`.
        fn token_exit_amount(
            &self,
            token: AccountId,
            s: Balance,
            total: Balance,
        ) -> Result<Balance, VaultError> {
            self.token_exit_leg(token, s, total)
                .map(|(amount, _)| amount)
        }

        /// (perna, saldo PSP22 bruto lido) de `token` na saída. O saldo
        /// lido serve de "antes" para `settle_psp22_transfer`.
        fn token_exit_leg(
            &self,
            token: AccountId,
            s: Balance,
            total: Balance,
        ) -> Result<(Balance, Balance), VaultError> {
            let balance = self
                .psp22_balance_of(token)
                .map_err(|_| VaultError::TokenUnreadable)?;
            let free = balance.saturating_sub(self.reserved_of(token));
            Ok((Self::mul_div_floor(free, s, total)?, balance))
        }

        /// Transfer PSP22 do vault com prova pelo saldo quando o retorno
        /// do token não é confirmado (`psp22_transfer == false`). O vault
        /// não distingue "o token não moveu" de "moveu e o retorno não
        /// decodificou" (ink! 4: falha de decode NÃO reverte o callee).
        /// Com `balance_before` = saldo PSP22 do vault lido antes:
        /// * retorno confirmado ⇒ `Ok(true)` (pago);
        /// * não confirmado e saldo inalterado ⇒ `Ok(false)` (nada saiu);
        /// * não confirmado e saldo caiu exatamente `amount` ⇒ `Ok(true)`;
        /// * qualquer outro caso (saldo ilegível antes ou depois, ou
        ///   divergente) ⇒ `Err(TransferFailed)`: on-chain reverte a
        ///   mensagem inteira, inclusive o que o token moveu.
        ///
        /// Na saída o "antes" é o saldo lido no passo de leituras: entre a
        /// leitura e o transfer o vault não move esse token por outro
        /// caminho (lista sem duplicata, allowances zeradas), então só um
        /// token hostil alheio poderia alterá-lo — e qualquer alteração
        /// que não seja exatamente `−amount` cai no `Err`.
        fn settle_psp22_transfer(
            &self,
            token: AccountId,
            to: AccountId,
            amount: Balance,
            balance_before: Option<Balance>,
        ) -> Result<bool, VaultError> {
            if self.psp22_transfer(token, to, amount) {
                return Ok(true);
            }
            let before = balance_before.ok_or(VaultError::TransferFailed)?;
            match self.psp22_balance_of(token) {
                Ok(after) if after == before => Ok(false),
                Ok(after) if before.checked_sub(amount) == Some(after) => Ok(true),
                _ => Err(VaultError::TransferFailed),
            }
        }

        /// Saldo PSP22 do vault em `token` menos o reservado a quem saiu.
        fn free_token_balance(&self, token: AccountId) -> Result<Balance, VaultError> {
            let balance = self.psp22_balance_of(token)?;
            Ok(balance.saturating_sub(self.reserved_of(token)))
        }

        fn reserved_of(&self, token: AccountId) -> Balance {
            self.reserved_tokens.get(token).unwrap_or(0)
        }

        fn set_reserved(&mut self, token: AccountId, amount: Balance) {
            if amount == 0 {
                self.reserved_tokens.remove(token);
            } else {
                self.reserved_tokens.insert(token, &amount);
            }
        }

        /// Allowlist: entrada existe e já vale (`now >= effective_at`).
        fn token_allowed_now(&self, token: AccountId) -> bool {
            let now = self.env().block_timestamp();
            self.allowed_tokens
                .get(token)
                .is_some_and(|effective_at| now >= effective_at)
        }

        /// piso(a × b / d) sem perder precisão quando `a × b` estoura u128:
        /// a = q·d + r ⇒ piso(a·b/d) = q·b + piso(r·b/d). `d == 0` ou
        /// resultado que não cabe ⇒ `Overflow` (nunca trunca).
        ///
        /// Domínio: NÃO é mul-div de 256 bits — também devolve `Overflow`
        /// (falha fechada, nunca valor errado) quando `r·b >= 2^128` mesmo
        /// que o resultado coubesse. Com `b, d` = cotas (`total_shares`
        /// ≪ 2^64) isso exige `r·b` com `r < d`, inalcançável na prática.
        fn mul_div_floor(a: Balance, b: Balance, d: Balance) -> Result<Balance, VaultError> {
            if d == 0 {
                return Err(VaultError::Overflow);
            }
            if let Some(product) = a.checked_mul(b) {
                return product.checked_div(d).ok_or(VaultError::Overflow);
            }
            let q = a.checked_div(d).ok_or(VaultError::Overflow)?;
            let r = a.checked_rem(d).ok_or(VaultError::Overflow)?;
            let high = q.checked_mul(b).ok_or(VaultError::Overflow)?;
            let low = r
                .checked_mul(b)
                .ok_or(VaultError::Overflow)?
                .checked_div(d)
                .ok_or(VaultError::Overflow)?;
            high.checked_add(low).ok_or(VaultError::Overflow)
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
                use ink::env::call::{build_call, ExecutionInput, Selector};
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
                test_mocks::psp22_balance_of_checked(token).ok_or(VaultError::ValuationUnavailable)
            }
        }

        /// PSP22::transfer(to, value, data = []) do saldo do vault em
        /// `token`. `true` só em `Ok(Ok(Ok(())))`; revert, trap, erro PSP22
        /// ou decode falho ⇒ `false` (nunca propaga). `false` é AMBÍGUO
        /// (decode falho não reverte o token): quem move fundos usa
        /// `settle_psp22_transfer`, nunca este `bool` sozinho. Sem gas cap
        /// (`gas_limit(0)` = todo o gas restante).
        fn psp22_transfer(&self, token: AccountId, to: AccountId, value: Balance) -> bool {
            #[cfg(not(test))]
            {
                use ink::env::call::{build_call, ExecutionInput, Selector};
                let result = build_call::<ink::env::DefaultEnvironment>()
                    .call(token)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(PSP22_TRANSFER_SELECTOR))
                            .push_arg(to)
                            .push_arg(value)
                            .push_arg(Vec::<u8>::new()),
                    )
                    .returns::<core::result::Result<(), Psp22ErrorMirror>>()
                    .try_invoke();
                matches!(result, Ok(Ok(Ok(()))))
            }
            #[cfg(test)]
            {
                test_mocks::psp22_transfer(token, to, value)
            }
        }

        /// PSP22::approve(spender, value) no `token`, em nome do vault.
        /// Usado no swap real (approve antes, reset para 0 depois).
        #[cfg(not(test))]
        fn psp22_approve(
            &self,
            token: AccountId,
            spender: AccountId,
            value: Balance,
        ) -> Result<(), VaultError> {
            use ink::env::call::{build_call, ExecutionInput, Selector};
            let result = build_call::<ink::env::DefaultEnvironment>()
                .call(token)
                .gas_limit(0)
                .transferred_value(0)
                .exec_input(
                    ExecutionInput::new(Selector::new(PSP22_APPROVE_SELECTOR))
                        .push_arg(spender)
                        .push_arg(value),
                )
                .returns::<core::result::Result<(), Psp22ErrorMirror>>()
                .try_invoke();
            match result {
                Ok(Ok(Ok(()))) => Ok(()),
                _ => Err(VaultError::TokenApproveFailed),
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
                use ink::env::call::{build_call, ExecutionInput, Selector};
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
            let (reserve_token, reserve_native) = self.pair_reserves(token, wnative, factory)?;

            #[cfg(not(test))]
            {
                use ink::env::call::{build_call, ExecutionInput, Selector};
                let router = self.router.ok_or(VaultError::RouterNotConfigured)?;
                let result = build_call::<ink::env::DefaultEnvironment>()
                    .call(router)
                    .gas_limit(0)
                    .transferred_value(0)
                    .exec_input(
                        ExecutionInput::new(Selector::new(ROUTER_GET_AMOUNT_OUT_SELECTOR))
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

        /// A-01: admin do protocolo apenas — o leader NÃO passa.
        fn ensure_protocol_admin(&self) -> Result<(), VaultError> {
            if self.env().caller() != self.admin {
                return Err(VaultError::NotAdmin);
            }
            Ok(())
        }

        /// A-01: config sensível só muda NA HORA sem shares de
        /// depositantes (com depositantes: `propose_*` / `apply_*`).
        fn ensure_no_depositors(&self) -> Result<(), VaultError> {
            if self.depositor_shares() > 0 {
                return Err(VaultError::ConfigChangeWithDepositors);
            }
            Ok(())
        }

        /// Shares de depositantes reais: `total_shares` menos as dead
        /// shares (A-02), que não pertencem a conta alguma.
        /// `total_shares` é sempre 0 ou >= MINIMUM_SHARES.
        fn depositor_shares(&self) -> Balance {
            self.total_shares.saturating_sub(constants::MINIMUM_SHARES)
        }

        /// A-01: `eta` de uma nova proposta (`now + CONFIG_CHANGE_DELAY_MS`).
        /// Também exige que `eta + CONFIG_CHANGE_GRACE_MS` caiba em u64,
        /// para o fim da janela nunca saturar (proposta sem expiração).
        fn config_change_eta(&self) -> Result<Timestamp, VaultError> {
            let eta = self
                .env()
                .block_timestamp()
                .checked_add(constants::CONFIG_CHANGE_DELAY_MS)
                .ok_or(VaultError::Overflow)?;
            eta.checked_add(constants::CONFIG_CHANGE_GRACE_MS)
                .ok_or(VaultError::Overflow)?;
            Ok(eta)
        }

        /// A-01 (rodada 2): proposta com `eta` ainda não caducou?
        /// (`now <= eta + CONFIG_CHANGE_GRACE_MS`; a soma não estoura —
        /// `config_change_eta` já a verificou).
        fn config_change_live(eta: Timestamp, now: Timestamp) -> bool {
            now <= eta.saturating_add(constants::CONFIG_CHANGE_GRACE_MS)
        }

        /// A-01 (rodada 2): `apply_*` só dentro de
        /// `[eta, eta + CONFIG_CHANGE_GRACE_MS]`.
        fn ensure_config_change_window(eta: Timestamp, now: Timestamp) -> Result<(), VaultError> {
            if now < eta {
                return Err(VaultError::ConfigChangeTimelocked);
            }
            if !Self::config_change_live(eta, now) {
                return Err(VaultError::ConfigChangeExpired);
            }
            Ok(())
        }

        /// A-01 (rodada 2): recusa depósito enquanto houver proposta de
        /// router ou de factory/wnative viva (não caducada).
        fn ensure_no_live_config_proposal(&self) -> Result<(), VaultError> {
            let now = self.env().block_timestamp();
            let router_live = self
                .pending_router
                .is_some_and(|p| Self::config_change_live(p.eta, now));
            let infra_live = self
                .pending_valuation_infra
                .is_some_and(|p| Self::config_change_live(p.eta, now));
            if router_live || infra_live {
                return Err(VaultError::DepositsBlockedByPendingConfigChange);
            }
            Ok(())
        }

        /// A-01 (rodada 2): endereço proposto não pode ser o AccountId
        /// zero nem o próprio vault.
        fn ensure_valid_config_address(&self, addr: AccountId) -> Result<(), VaultError> {
            if addr == AccountId::from([0u8; 32]) || addr == self.env().account_id() {
                return Err(VaultError::InvalidConfigAddress);
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
        use super::{AccountId, Balance};
        use std::{
            cell::RefCell,
            collections::{BTreeMap, BTreeSet},
        };

        thread_local! {
            static PSP22_BALANCES: RefCell<BTreeMap<AccountId, Balance>> =
                RefCell::new(BTreeMap::new());
            static PAIR_RESERVES: RefCell<BTreeMap<AccountId, (Balance, Balance)>> =
                RefCell::new(BTreeMap::new());
            static ROUTER_SWAP_CREDIT: RefCell<Option<Balance>> = RefCell::new(None);
            static PSP22_TRANSFER_FAIL: RefCell<BTreeSet<AccountId>> =
                const { RefCell::new(BTreeSet::new()) };
            static PSP22_BALANCE_FAIL: RefCell<BTreeSet<AccountId>> =
                const { RefCell::new(BTreeSet::new()) };
            static PSP22_TRANSFERS: RefCell<Vec<(AccountId, AccountId, Balance)>> =
                const { RefCell::new(Vec::new()) };
            static PSP22_CALLS: RefCell<BTreeMap<AccountId, u32>> =
                const { RefCell::new(BTreeMap::new()) };
            static PSP22_TRANSFER_UNCONFIRMED: RefCell<BTreeMap<AccountId, Option<Balance>>> =
                const { RefCell::new(BTreeMap::new()) };
        }

        fn count_call(token: AccountId) {
            PSP22_CALLS.with(|m| {
                let mut m = m.borrow_mut();
                let n = m.entry(token).or_insert(0);
                *n = n.saturating_add(1);
            });
        }

        /// Faz `transfer` do `token` falhar (revert/trap limpo).
        pub fn set_psp22_transfer_fail(token: AccountId, fail: bool) {
            PSP22_TRANSFER_FAIL.with(|s| {
                if fail {
                    s.borrow_mut().insert(token);
                } else {
                    s.borrow_mut().remove(&token);
                }
            });
        }

        /// Faz `balance_of` do `token` falhar (saldo ilegível).
        pub fn set_psp22_balance_fail(token: AccountId, fail: bool) {
            PSP22_BALANCE_FAIL.with(|s| {
                if fail {
                    s.borrow_mut().insert(token);
                } else {
                    s.borrow_mut().remove(&token);
                }
            });
        }

        /// Faz `transfer` do `token` MOVER saldo e devolver um retorno que
        /// o vault não confirma (ex.: token ink! 3.x sem a camada
        /// `LangError`, decode falho). `moved = None` move o valor pedido;
        /// `Some(x)` move `x`. O movimento entra em `psp22_transfers`.
        pub fn set_psp22_transfer_unconfirmed(token: AccountId, moved: Option<Balance>) {
            PSP22_TRANSFER_UNCONFIRMED.with(|m| {
                m.borrow_mut().insert(token, moved);
            });
        }

        pub fn clear_psp22_transfer_unconfirmed(token: AccountId) {
            PSP22_TRANSFER_UNCONFIRMED.with(|m| {
                m.borrow_mut().remove(&token);
            });
        }

        /// Transfers PSP22 que MOVERAM saldo, em ordem: (token, to, amount).
        pub fn psp22_transfers() -> Vec<(AccountId, AccountId, Balance)> {
            PSP22_TRANSFERS.with(|v| v.borrow().clone())
        }

        /// Chamadas do vault ao `token` (`balance_of` + `transfer`).
        pub fn psp22_calls(token: AccountId) -> u32 {
            PSP22_CALLS.with(|m| m.borrow().get(&token).copied().unwrap_or(0))
        }

        /// `balance_of` visto pelo contrato: conta a chamada; `None` se
        /// o token está em BALANCE_FAIL.
        pub fn psp22_balance_of_checked(token: AccountId) -> Option<Balance> {
            count_call(token);
            if PSP22_BALANCE_FAIL.with(|s| s.borrow().contains(&token)) {
                return None;
            }
            Some(psp22_balance(token))
        }

        /// `transfer` visto pelo contrato: conta a chamada; falha se o
        /// token está em TRANSFER_FAIL ou o saldo não cobre; senão
        /// debita o saldo mockado do vault e registra.
        pub fn psp22_transfer(token: AccountId, to: AccountId, amount: Balance) -> bool {
            count_call(token);
            if PSP22_TRANSFER_FAIL.with(|s| s.borrow().contains(&token)) {
                return false;
            }
            if let Some(moved) =
                PSP22_TRANSFER_UNCONFIRMED.with(|m| m.borrow().get(&token).copied())
            {
                let balance = psp22_balance(token);
                let moved = moved.unwrap_or(amount).min(balance);
                set_psp22_balance(token, balance.saturating_sub(moved));
                if moved > 0 {
                    PSP22_TRANSFERS.with(|v| v.borrow_mut().push((token, to, moved)));
                }
                return false;
            }
            let balance = psp22_balance(token);
            let Some(rest) = balance.checked_sub(amount) else {
                return false;
            };
            set_psp22_balance(token, rest);
            PSP22_TRANSFERS.with(|v| v.borrow_mut().push((token, to, amount)));
            true
        }

        /// Quanto o router simulado credita de token_out ao vault no
        /// próximo swap (default: `min_amount_out`). Permite simular um
        /// router que reporta sucesso mas entrega menos.
        pub fn set_router_swap_credit(credit: Balance) {
            ROUTER_SWAP_CREDIT.with(|c| *c.borrow_mut() = Some(credit));
        }

        /// Router simulado: credita token_out no saldo PSP22 mockado do
        /// vault (o swap real é provado no E2E).
        pub fn simulate_router_swap(token_out: AccountId, default_credit: Balance) {
            let credit = ROUTER_SWAP_CREDIT.with(|c| c.borrow().unwrap_or(default_credit));
            set_psp22_balance(token_out, psp22_balance(token_out).saturating_add(credit));
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
                m.borrow_mut()
                    .insert(token, (reserve_token, reserve_native));
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

        fn create_vault() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
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
            // First deposit: 1:1 minus the dead shares (A-02)
            assert_eq!(shares, 100_000_000_000 - constants::MINIMUM_SHARES);

            let (depositor_shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(
                depositor_shares,
                100_000_000_000 - constants::MINIMUM_SHARES
            );
            assert_eq!(vault.active_depositors, 1);
            // Dead shares só em total_shares, sem dono (nem o AccountId
            // zero); total = 1:1
            assert_eq!(vault.shares.get(AccountId::from([0u8; 32])), None);
            assert_eq!(vault.total_shares, 100_000_000_000);
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
            let result =
                vault.execute_trade(b"LUNES/USDT".to_vec(), TradeSide::Buy, 10_000_000_000);
            assert_eq!(result, Err(VaultError::NotLeader));

            // Leader can trade
            set_caller(accounts.bob);
            set_value(0);
            let result =
                vault.execute_trade(b"LUNES/USDT".to_vec(), TradeSide::Buy, 10_000_000_000);
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
            assert_eq!(stats.4, 0); // active_depositors
            assert!(!stats.6); // not paused
            assert!(!stats.7); // trading not halted
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
            assert_eq!(FACTORY_GET_PAIR_SELECTOR, ink::selector_bytes!("get_pair"),);
            assert_eq!(
                PAIR_GET_RESERVES_SELECTOR,
                ink::selector_bytes!("get_reserves"),
            );
            assert_eq!(
                ROUTER_GET_AMOUNT_OUT_SELECTOR,
                ink::selector_bytes!("get_amount_out"),
            );
            // Saída in-kind: PSP22::transfer(to, value, data)
            assert_eq!(
                PSP22_TRANSFER_SELECTOR,
                ink::selector_bytes!("PSP22::transfer"),
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
            let decoded = <core::result::Result<Vec<Balance>, RouterErrorMirror>>::decode(
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
        fn setup_funded_vault_with_router() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // Admin configura router + infra de valuation (ADR-002) ANTES
            // de qualquer depósito (A-01: proibido com depositantes)
            set_caller(accounts.alice);
            set_value(0);
            vault.set_router(accounts.frank).unwrap();
            vault
                .set_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            // Allowlist: django/eve e os tokens de enchimento da lista
            // permitidos antes do depósito (efeito imediato).
            allow_test_tokens(&mut vault);

            // Charlie deposita 1000 LUNES
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();

            set_caller(accounts.alice);
            set_value(0);

            // django = token_in rastreado (rate 0.1 → valuation 5e9)
            test_mocks::set_pair_reserves(accounts.django, 100_000_000_000_000, 10_000_000_000_000);
            vault.add_tracked_token(accounts.django).unwrap();
            test_mocks::set_psp22_balance(accounts.django, 50_000_000_000);

            // eve = token_out com par líquido 1:1 (auto-track no swap)
            test_mocks::set_pair_reserves(accounts.eve, 1_000_000_000_000, 1_000_000_000_000);

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
            let result = vault.swap_through_router(accounts.django, accounts.eve, 0, 0);
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
            let result =
                vault.swap_through_router(accounts.django, accounts.eve, 50_000_000_000, 1);
            assert_eq!(result, Err(VaultError::BlockVolumeExceeded));

            // 25% do vault — passa no volume (40%) mas estoura o cap
            // por trade (20%)
            let result =
                vault.swap_through_router(accounts.django, accounts.eve, 25_000_000_000, 1);
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
            let result =
                vault.swap_through_router(accounts.django, accounts.eve, amount_in, min_out);
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

        fn token_at(base: u8, i: u32) -> AccountId {
            token(base.wrapping_add(i as u8))
        }

        /// Permite (como alice, sem depositantes ⇒ efeito imediato) os
        /// tokens que os testes ADR-002 pré-existentes rastreiam/compram.
        fn allow_test_tokens(vault: &mut CopyVault) {
            let accounts = default_accounts();
            set_caller(accounts.alice);
            let mut list = vec![
                accounts.django,
                accounts.eve,
                token(0x01),
                token(0x02),
                token(0x0A),
                token(0x0B),
                token(0x0C),
                token(0xEE),
            ];
            list.extend((0..constants::MAX_TRACKED_TOKENS).map(|i| token_at(0x10, i)));
            let this = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            for t in list {
                if t == this {
                    // token(0x01) == alice == callee padrão do ambiente
                    // off-chain: `set_token_allowed` recusa o próprio vault
                    // (InvalidConfigAddress), então só nos testes legados
                    // que usam esse id a permissão entra direto no storage.
                    vault.allowed_tokens.insert(t, &0);
                } else {
                    assert_eq!(vault.set_token_allowed(t, true), Ok(()));
                }
            }
        }

        /// Vault com infra de valuation configurada (sem depósito).
        fn vault_with_infra() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
            let (mut vault, accounts) = create_vault();
            set_caller(accounts.alice);
            vault
                .set_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            // Allowlist: os tokens usados pelos testes ADR-002 são
            // permitidos antes de qualquer depósito (efeito imediato).
            allow_test_tokens(&mut vault);
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
                v.set_valuation_infra(factory_addr(), wnative_addr())
                    .unwrap();
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

            // 1º depósito: 100 LUNES → 100e9 shares (1:1), das quais
            // MINIMUM_SHARES são dead shares (A-02)
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            assert_eq!(
                vault.deposit(),
                Ok(100_000_000_000 - constants::MINIMUM_SHARES)
            );

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
            assert_eq!(shares, 100_000_000_000 - constants::MINIMUM_SHARES);
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
            // sobre o lucro. CV-FEE-01: o custo das 5e9 shares é o
            // proporcional EXATO do basis (charlie pagou 100e9 por
            // 100e9 − MINIMUM_SHARES shares): piso(100e9 × 5e9 /
            // 99_999_999_000) = 5_000_000_050 → lucro 49_999_999_950 →
            // fee 9_999_999_990 → net 45_000_000_010 (antes 45e9 exatos
            // porque o basis por share truncava para 1).
            set_caller(accounts.charlie);
            set_value(0);
            let result = vault.withdraw(5_000_000_000);
            assert_eq!(result, Ok(45_000_000_010));

            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(shares, 95_000_000_000 - constants::MINIMUM_SHARES);
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

            // Router antes do depósito (A-01: proibido com depositantes)
            set_caller(accounts.alice);
            set_value(0);
            vault.set_router(accounts.frank).unwrap();

            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();
            set_value(0);

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
            let result =
                vault.swap_through_router(token(0x99), accounts.eve, 1_000_000_000, 900_000_000);
            assert_eq!(result, Err(VaultError::TokenNotTracked));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_insufficient_token_in_balance() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // django tem 50e9 mockado — pedir 60e9 falha ANTES dos caps
            set_caller(accounts.bob);
            let result =
                vault.swap_through_router(accounts.django, accounts.eve, 60_000_000_000, 1);
            assert_eq!(result, Err(VaultError::InsufficientTokenBalance));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_auto_tracks_token_out() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            assert!(!vault.is_tracked(accounts.eve));
            set_caller(accounts.bob);
            vault
                .swap_through_router(accounts.django, accounts.eve, 10_000_000_000, 9_000_000_000)
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
            assert_eq!(vault.sync_equity(), Err(VaultError::ValuationUnavailable),);
        }

        // ════════════════════════════════════════════════════════
        // Large-withdrawal cooldown (fix: request must persist)
        // ════════════════════════════════════════════════════════
        //
        // ink! 4 reverts ALL storage writes of a message that returns
        // `Err` (ink_codegen dispatch: `is_result_err` ⇒ REVERT flag). The
        // off-chain test env does not roll back, so these tests assert
        // the on-chain invariant directly: an `Err` path must not write.

        fn set_now(ms: u64) {
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(ms);
        }

        /// Charlie alone in the vault: ANY withdrawal is > 10% (large).
        fn vault_with_single_depositor() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_now(1_000);
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();
            set_value(0);
            (vault, accounts)
        }

        #[ink::test]
        fn test_large_withdraw_without_request_errs_without_writing() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.charlie);
            assert_eq!(
                vault.withdraw(50_000_000_000),
                Err(VaultError::CooldownActive)
            );
            // On-chain this write would be reverted anyway; the contract
            // must not rely on it (it previously did → large withdrawals
            // could never start their cooldown).
            assert_eq!(vault.get_withdrawal_request(accounts.charlie), None);
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_request_withdrawal_persists_and_unlocks_after_cooldown() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.charlie);
            let unlock_at = vault.request_withdrawal(50_000_000_000).unwrap();
            assert_eq!(unlock_at, 1_000 + constants::COOLDOWN_PERIOD_MS);
            assert_eq!(
                vault.get_withdrawal_request(accounts.charlie),
                Some(WithdrawalRequest {
                    shares: 50_000_000_000,
                    requested_at: 1_000,
                })
            );

            // Before the cooldown: rejected, request kept, shares intact.
            set_now(unlock_at - 1);
            assert_eq!(
                vault.withdraw(50_000_000_000),
                Err(VaultError::CooldownActive)
            );
            assert!(vault.get_withdrawal_request(accounts.charlie).is_some());

            // After the cooldown: the large withdrawal goes through and
            // consumes the request (no fee: no profit).
            set_now(unlock_at);
            assert_eq!(vault.withdraw(50_000_000_000), Ok(50_000_000_000));
            assert_eq!(vault.get_withdrawal_request(accounts.charlie), None);
            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(shares, 50_000_000_000 - constants::MINIMUM_SHARES);
        }

        #[ink::test]
        fn test_large_withdraw_cannot_exceed_requested_shares() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.charlie);
            let unlock_at = vault.request_withdrawal(20_000_000_000).unwrap();
            set_now(unlock_at);
            assert_eq!(
                vault.withdraw(60_000_000_000),
                Err(VaultError::CooldownActive)
            );
            assert!(vault.get_withdrawal_request(accounts.charlie).is_some());
        }

        #[ink::test]
        fn test_request_withdrawal_validates_shares() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.charlie);
            assert_eq!(
                vault.request_withdrawal(0),
                Err(VaultError::InsufficientShares)
            );
            assert_eq!(
                vault.request_withdrawal(100_000_000_001),
                Err(VaultError::InsufficientShares)
            );
            set_caller(accounts.django);
            assert_eq!(
                vault.request_withdrawal(1),
                Err(VaultError::InsufficientShares)
            );
        }

        // ════════════════════════════════════════════════════════
        // Performance fee is not retroactive (item 9 / BE-15)
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_fee_increase_blocked_while_depositors_hold_shares() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            assert_eq!(
                vault.set_performance_fee(3000),
                Err(VaultError::FeeIncreaseWithDepositors)
            );
            assert_eq!(vault.performance_fee_bps, 2000);

            // Decreasing always allowed (benefits followers).
            assert_eq!(vault.set_performance_fee(1000), Ok(()));
            assert_eq!(vault.performance_fee_bps, 1000);
        }

        // ════════════════════════════════════════════════════════
        // A-01 — router / valuation infra fora do alcance do leader
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_leader_cannot_set_router_or_valuation_infra() {
            let (mut vault, accounts) = create_vault();

            // Sem depositantes: o leader já não é admin do protocolo.
            set_caller(accounts.bob);
            assert_eq!(vault.set_router(accounts.frank), Err(VaultError::NotAdmin));
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Err(VaultError::NotAdmin)
            );

            // Com depósito ativo: idem (era Ok — leader trocava o router
            // por um malicioso e drenava via approve/transfer_from).
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();
            set_value(0);

            set_caller(accounts.bob);
            assert_eq!(vault.set_router(accounts.frank), Err(VaultError::NotAdmin));
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Err(VaultError::NotAdmin)
            );
            assert_eq!(vault.router_address(), None);
            assert_eq!(vault.get_valuation_infra(), (None, None));
        }

        #[ink::test]
        fn test_admin_cannot_change_router_or_infra_with_depositors() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            assert_eq!(
                vault.set_router(accounts.frank),
                Err(VaultError::ConfigChangeWithDepositors)
            );
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Err(VaultError::ConfigChangeWithDepositors)
            );
            assert_eq!(vault.router_address(), None);
            assert_eq!(vault.get_valuation_infra(), (None, None));
        }

        #[ink::test]
        fn test_admin_can_change_router_and_infra_without_depositors() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // total_shares == 0: admin configura, e cada mudança emite
            // evento (mesmo padrão de PerformanceFeeChanged).
            set_caller(accounts.alice);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.set_router(accounts.frank), Ok(()));
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Ok(())
            );
            assert_eq!(ink::env::test::recorded_events().count(), events_before + 2);
            assert_eq!(vault.router_address(), Some(accounts.frank));
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(factory_addr()), Some(wnative_addr()))
            );

            // Depois que o último depositante sai (só restam as dead
            // shares), o admin volta a poder trocar o router.
            set_now(1_000);
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            let minted = vault.deposit().unwrap();
            set_value(0);
            let unlock_at = vault.request_withdrawal(minted).unwrap();
            set_now(unlock_at);
            vault.withdraw(minted).unwrap();

            set_caller(accounts.alice);
            assert_eq!(vault.set_router(accounts.django), Ok(()));
            assert_eq!(vault.router_address(), Some(accounts.django));
        }

        /// O min_amount_out vale sobre o delta REAL de balance_of(vault)
        /// do token_out, não sobre o `amounts.last()` que o router
        /// devolve.
        #[ink::test]
        fn test_swap_slippage_measured_on_balance_delta() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            // Router "reporta" sucesso mas credita 1 unidade a menos.
            test_mocks::set_router_swap_credit(9_000_000_000 - 1);
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                10_000_000_000,
                9_000_000_000,
            );
            assert_eq!(result, Err(VaultError::SlippageExceeded));
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_swap_returns_actual_balance_delta() {
            let (mut vault, accounts) = setup_funded_vault_with_router();

            test_mocks::set_router_swap_credit(9_000_000_123);
            set_caller(accounts.bob);
            let result = vault.swap_through_router(
                accounts.django,
                accounts.eve,
                10_000_000_000,
                9_000_000_000,
            );
            assert_eq!(result, Ok(9_000_000_123));
            assert_eq!(test_mocks::psp22_balance(accounts.eve), 9_000_000_123);
        }

        // ════════════════════════════════════════════════════════
        // A-02 — inflação do primeiro depositante (dead shares)
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn first_depositor_inflation_is_unprofitable() {
            let (mut vault, accounts) = create_vault();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_now(1_000);

            // 1) Atacante (django) é o primeiro depositante, com o mínimo.
            set_caller(accounts.django);
            set_value(constants::MIN_DEPOSIT);
            set_balance(contract_id, constants::MIN_DEPOSIT);
            let attacker_minted = vault.deposit().unwrap();
            set_value(0);

            // 2) Reduz a própria posição a 1 share (saque grande ⇒
            // request + cooldown de 24h).
            let burn = attacker_minted - 1;
            let unlock_at = vault.request_withdrawal(burn).unwrap();
            set_now(unlock_at);
            let attacker_out = vault.withdraw(burn).unwrap();
            let native_after_burn = constants::MIN_DEPOSIT - attacker_out;
            set_balance(contract_id, native_after_burn);

            // 3) Doação direta D em nativo (entra no NAV).
            let donation: Balance = 100_000_000_000; // 1000 LUNES
            set_balance(contract_id, native_after_burn + donation);

            // 4) Vítima (charlie) deposita V = 1,9·D.
            let victim_deposit: Balance = donation * 19 / 10;
            set_caller(accounts.charlie);
            set_value(victim_deposit);
            set_balance(contract_id, native_after_burn + donation + victim_deposit);
            vault.deposit().unwrap();
            set_value(0);

            // Vítima resgata >= 99,9% do que depositou.
            let (_, victim_value) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert!(
                victim_value >= victim_deposit * 999 / 1000,
                "victim redeemable {} < 99.9% of {}",
                victim_value,
                victim_deposit
            );

            // E o atacante sai no prejuízo.
            let (_, attacker_value) = vault.get_depositor_info(accounts.django).unwrap();
            assert!(attacker_out + attacker_value < constants::MIN_DEPOSIT + donation);
        }

        #[ink::test]
        fn test_withdraw_keeps_total_shares_zero_or_above_floor() {
            let (mut vault, accounts) = vault_with_single_depositor();

            // Único depositante reduz a posição a 1 share.
            set_caller(accounts.charlie);
            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            let unlock_at = vault.request_withdrawal(shares - 1).unwrap();
            set_now(unlock_at);
            vault.withdraw(shares - 1).unwrap();
            assert!(
                vault.total_shares == 0 || vault.total_shares >= constants::MINIMUM_SHARES,
                "total_shares {} below floor",
                vault.total_shares
            );

            // As dead shares não prendem ninguém: ele sai por completo
            // e só o piso fica no vault.
            let unlock_at = vault.request_withdrawal(1).unwrap();
            set_now(unlock_at);
            vault.withdraw(1).unwrap();
            assert_eq!(vault.get_depositor_info(accounts.charlie), Ok((0, 0)));
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
        }

        // ════════════════════════════════════════════════════════
        // Re-revisão #7 — dead shares não pertencem a conta alguma
        // ════════════════════════════════════════════════════════

        fn zero_account() -> AccountId {
            AccountId::from([0u8; 32])
        }

        #[ink::test]
        fn test_zero_account_cannot_withdraw_dead_shares() {
            let (mut vault, _accounts) = vault_with_single_depositor();
            let total_before = vault.total_shares;

            // A conta zero (chave de ordem pequena, assinável por
            // qualquer um em verificadores permissivos) não tem shares.
            set_caller(zero_account());
            assert_eq!(
                vault.withdraw(constants::MINIMUM_SHARES),
                Err(VaultError::InsufficientShares)
            );
            assert_eq!(vault.withdraw(1), Err(VaultError::InsufficientShares));
            assert_eq!(
                vault.request_withdrawal(1),
                Err(VaultError::InsufficientShares)
            );
            assert_eq!(
                vault.request_emergency_withdrawal(),
                Err(VaultError::InsufficientShares)
            );
            // Mesmo com um unlock de emergência forjado no storage, o
            // saque de emergência não paga nada à conta zero.
            vault.emergency_unlocks.insert(zero_account(), &0);
            assert_eq!(
                vault.execute_emergency_withdrawal(),
                Err(VaultError::InsufficientShares)
            );
            assert!(!vault.locked);

            assert_eq!(vault.shares.get(zero_account()), None);
            assert_eq!(vault.get_depositor_info(zero_account()), Ok((0, 0)));
            assert_eq!(vault.total_shares, total_before);
        }

        #[ink::test]
        fn test_total_shares_never_below_floor_after_all_exit() {
            let (mut vault, accounts) = vault_with_single_depositor();

            // Único depositante sai pela via de emergência (queima tudo).
            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            vault.execute_emergency_withdrawal().unwrap();
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
            assert_eq!(vault.depositor_shares(), 0);

            // O piso continua de pé: a conta zero não queima as dead shares.
            set_caller(zero_account());
            assert_eq!(
                vault.withdraw(constants::MINIMUM_SHARES),
                Err(VaultError::InsufficientShares)
            );
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
        }

        // ════════════════════════════════════════════════════════
        // Re-revisão #2 — o leader só freia, nunca desfaz freios
        // ════════════════════════════════════════════════════════

        #[ink::test]
        fn test_leader_can_pause_but_not_unpause() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.bob);
            assert_eq!(vault.pause(), Ok(()));
            assert!(vault.paused);
            assert_eq!(vault.unpause(), Err(VaultError::NotAdmin));
            assert!(vault.paused);

            // Pause do admin também não é desfeito pelo leader.
            set_caller(accounts.alice);
            assert_eq!(vault.unpause(), Ok(()));
            vault.pause().unwrap();
            set_caller(accounts.bob);
            assert_eq!(vault.unpause(), Err(VaultError::NotAdmin));
            assert!(vault.paused);
        }

        #[ink::test]
        fn test_leader_cannot_resume_trading() {
            let (mut vault, accounts) = vault_with_single_depositor();
            vault.trading_halted = true;
            vault.high_water_mark = 200_000_000_000;

            set_caller(accounts.bob);
            assert_eq!(vault.resume_trading(), Err(VaultError::NotAdmin));
            assert!(vault.trading_halted);
            assert_eq!(vault.high_water_mark, 200_000_000_000);

            set_caller(accounts.alice);
            assert_eq!(vault.resume_trading(), Ok(()));
            assert!(!vault.trading_halted);
        }

        #[ink::test]
        fn test_leader_cannot_set_max_drawdown() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.bob);
            assert_eq!(vault.set_max_drawdown(10_000), Err(VaultError::NotAdmin));
            assert_eq!(vault.max_drawdown_bps, constants::DEFAULT_MAX_DRAWDOWN_BPS);

            set_caller(accounts.alice);
            assert_eq!(vault.set_max_drawdown(2_000), Ok(()));
            assert_eq!(vault.max_drawdown_bps, 2_000);
        }

        #[ink::test]
        fn test_leader_can_only_lower_performance_fee() {
            let (mut vault, accounts) = create_vault();

            // Sem depositantes: aumento só pelo admin do protocolo.
            set_caller(accounts.bob);
            assert_eq!(vault.set_performance_fee(3000), Err(VaultError::NotAdmin));
            assert_eq!(vault.performance_fee_bps, 2000);
            assert_eq!(vault.set_performance_fee(1000), Ok(()));
            assert_eq!(vault.performance_fee_bps, 1000);

            set_caller(accounts.alice);
            assert_eq!(vault.set_performance_fee(1500), Ok(()));
            assert_eq!(vault.performance_fee_bps, 1500);

            // Terceiros não mexem na taxa.
            set_caller(accounts.charlie);
            assert_eq!(vault.set_performance_fee(1000), Err(VaultError::NotAdmin));

            // Com depositantes: o leader continua sem poder aumentar.
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            vault.deposit().unwrap();
            set_value(0);
            set_caller(accounts.bob);
            assert_eq!(vault.set_performance_fee(1600), Err(VaultError::NotAdmin));
            assert_eq!(vault.set_performance_fee(500), Ok(()));
            assert_eq!(vault.performance_fee_bps, 500);
        }

        // ════════════════════════════════════════════════════════
        // Re-revisão #0/#1/#4 — troca de router/infra com timelock
        // ════════════════════════════════════════════════════════

        type Event = <CopyVault as ::ink::reflect::ContractEventBase>::Type;

        fn last_event() -> Event {
            let event = ink::env::test::recorded_events()
                .last()
                .expect("nenhum evento emitido");
            <Event as scale::Decode>::decode(&mut &event.data[..]).expect("evento inválido")
        }

        #[ink::test]
        fn test_config_change_delay_exceeds_emergency_delay() {
            assert_eq!(
                constants::CONFIG_CHANGE_DELAY_MS,
                constants::EMERGENCY_UNLOCK_DELAY_MS + 48 * 60 * 60 * 1000
            );
            // `CONFIG_CHANGE_DELAY_MS > EMERGENCY_UNLOCK_DELAY_MS` também é
            // garantido em tempo de compilação (const assert em `constants`).
        }

        #[ink::test]
        fn test_router_change_with_depositors_goes_through_timelock() {
            let (mut vault, accounts) = vault_with_single_depositor();

            // Caminho imediato continua fechado com depositantes.
            set_caller(accounts.alice);
            assert_eq!(
                vault.set_router(accounts.frank),
                Err(VaultError::ConfigChangeWithDepositors)
            );

            let events_before = ink::env::test::recorded_events().count();
            let eta = vault.propose_router(accounts.frank).unwrap();
            assert_eq!(eta, 1_000 + constants::CONFIG_CHANGE_DELAY_MS);
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::RouterChangeProposed(e) => {
                    assert_eq!(e.router, accounts.frank);
                    assert_eq!(e.eta, eta);
                }
                _ => panic!("esperado RouterChangeProposed"),
            }
            assert_eq!(
                vault.get_pending_router(),
                Some(PendingRouterChange {
                    router: accounts.frank,
                    eta,
                })
            );
            assert_eq!(vault.router_address(), None);

            // Antes do eta: recusado, nada muda.
            set_now(eta.saturating_sub(1));
            assert_eq!(
                vault.apply_router(),
                Err(VaultError::ConfigChangeTimelocked)
            );
            assert_eq!(vault.router_address(), None);
            assert!(vault.get_pending_router().is_some());

            // No eta: aplica, limpa o pendente e emite RouterChanged.
            set_now(eta);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.apply_router(), Ok(()));
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::RouterChanged(e) => {
                    assert_eq!(e.old_router, None);
                    assert_eq!(e.new_router, accounts.frank);
                }
                _ => panic!("esperado RouterChanged"),
            }
            assert_eq!(vault.router_address(), Some(accounts.frank));
            assert_eq!(vault.get_pending_router(), None);

            // Sem proposta pendente não há o que aplicar.
            assert_eq!(vault.apply_router(), Err(VaultError::NoPendingConfigChange));
        }

        #[ink::test]
        fn test_new_router_proposal_overwrites_and_restarts_clock() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            let first_eta = vault.propose_router(accounts.frank).unwrap();
            set_now(5_000);
            let second_eta = vault.propose_router(accounts.django).unwrap();
            assert_eq!(second_eta, 5_000 + constants::CONFIG_CHANGE_DELAY_MS);

            set_now(first_eta);
            assert_eq!(
                vault.apply_router(),
                Err(VaultError::ConfigChangeTimelocked)
            );

            set_now(second_eta);
            assert_eq!(vault.apply_router(), Ok(()));
            assert_eq!(vault.router_address(), Some(accounts.django));
        }

        #[ink::test]
        fn test_cancel_router_proposal() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            assert_eq!(
                vault.cancel_router_proposal(),
                Err(VaultError::NoPendingConfigChange)
            );
            let eta = vault.propose_router(accounts.frank).unwrap();

            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.cancel_router_proposal(), Ok(()));
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::RouterChangeCancelled(e) => assert_eq!(e.router, accounts.frank),
                _ => panic!("esperado RouterChangeCancelled"),
            }
            assert_eq!(vault.get_pending_router(), None);

            set_now(eta);
            assert_eq!(vault.apply_router(), Err(VaultError::NoPendingConfigChange));
            assert_eq!(vault.router_address(), None);
        }

        #[ink::test]
        fn test_router_proposal_requires_protocol_admin() {
            let (mut vault, accounts) = vault_with_single_depositor();

            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.propose_router(accounts.django),
                    Err(VaultError::NotAdmin)
                );
            }
            assert_eq!(vault.get_pending_router(), None);

            set_caller(accounts.alice);
            let eta = vault.propose_router(accounts.frank).unwrap();
            set_now(eta);

            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.propose_router(accounts.django),
                    Err(VaultError::NotAdmin)
                );
                assert_eq!(vault.apply_router(), Err(VaultError::NotAdmin));
                assert_eq!(vault.cancel_router_proposal(), Err(VaultError::NotAdmin));
            }
            assert_eq!(vault.router_address(), None);
            assert_eq!(
                vault.get_pending_router(),
                Some(PendingRouterChange {
                    router: accounts.frank,
                    eta,
                })
            );
        }

        #[ink::test]
        fn test_valuation_infra_change_with_depositors_goes_through_timelock() {
            let (mut vault, accounts) = vault_with_single_depositor();
            let new_factory = token(0xF1);
            let new_wnative = token(0xF2);

            set_caller(accounts.alice);
            assert_eq!(
                vault.set_valuation_infra(new_factory, new_wnative),
                Err(VaultError::ConfigChangeWithDepositors)
            );

            let events_before = ink::env::test::recorded_events().count();
            let eta = vault
                .propose_valuation_infra(new_factory, new_wnative)
                .unwrap();
            assert_eq!(eta, 1_000 + constants::CONFIG_CHANGE_DELAY_MS);
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::ValuationInfraChangeProposed(e) => {
                    assert_eq!(e.factory, new_factory);
                    assert_eq!(e.wnative, new_wnative);
                    assert_eq!(e.eta, eta);
                }
                _ => panic!("esperado ValuationInfraChangeProposed"),
            }
            assert_eq!(
                vault.get_pending_valuation_infra(),
                Some(PendingValuationInfraChange {
                    factory: new_factory,
                    wnative: new_wnative,
                    eta,
                })
            );

            set_now(eta.saturating_sub(1));
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::ConfigChangeTimelocked)
            );
            assert_eq!(vault.get_valuation_infra(), (None, None));

            set_now(eta);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.apply_valuation_infra(), Ok(()));
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::ValuationInfraChanged(e) => {
                    assert_eq!(e.factory, new_factory);
                    assert_eq!(e.wnative, new_wnative);
                }
                _ => panic!("esperado ValuationInfraChanged"),
            }
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(new_factory), Some(new_wnative))
            );
            assert_eq!(vault.get_pending_valuation_infra(), None);
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::NoPendingConfigChange)
            );
        }

        #[ink::test]
        fn test_cancel_valuation_infra_proposal() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            assert_eq!(
                vault.cancel_valuation_infra_proposal(),
                Err(VaultError::NoPendingConfigChange)
            );
            let eta = vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();

            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.cancel_valuation_infra_proposal(), Ok(()));
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(1)
            );
            match last_event() {
                Event::ValuationInfraChangeCancelled(e) => {
                    assert_eq!(e.factory, factory_addr());
                    assert_eq!(e.wnative, wnative_addr());
                }
                _ => panic!("esperado ValuationInfraChangeCancelled"),
            }
            assert_eq!(vault.get_pending_valuation_infra(), None);

            set_now(eta);
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::NoPendingConfigChange)
            );
            assert_eq!(vault.get_valuation_infra(), (None, None));
        }

        #[ink::test]
        fn test_valuation_infra_proposal_requires_protocol_admin() {
            let (mut vault, accounts) = vault_with_single_depositor();

            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.propose_valuation_infra(token(0xF1), token(0xF2)),
                    Err(VaultError::NotAdmin)
                );
            }
            assert_eq!(vault.get_pending_valuation_infra(), None);

            set_caller(accounts.alice);
            let eta = vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            set_now(eta);

            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.propose_valuation_infra(token(0xF1), token(0xF2)),
                    Err(VaultError::NotAdmin)
                );
                assert_eq!(vault.apply_valuation_infra(), Err(VaultError::NotAdmin));
                assert_eq!(
                    vault.cancel_valuation_infra_proposal(),
                    Err(VaultError::NotAdmin)
                );
            }
            assert_eq!(vault.get_valuation_infra(), (None, None));
            assert_eq!(
                vault.get_pending_valuation_infra(),
                Some(PendingValuationInfraChange {
                    factory: factory_addr(),
                    wnative: wnative_addr(),
                    eta,
                })
            );
        }

        /// #1: um depósito feito antes da configuração (griefing ou
        /// acidente) não impede mais o admin de configurar o vault.
        #[ink::test]
        fn test_deposit_before_configuration_no_longer_blocks_it() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            assert_eq!(
                vault.set_router(accounts.frank),
                Err(VaultError::ConfigChangeWithDepositors)
            );
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Err(VaultError::ConfigChangeWithDepositors)
            );

            let router_eta = vault.propose_router(accounts.frank).unwrap();
            let infra_eta = vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            set_now(core::cmp::max(router_eta, infra_eta));
            assert_eq!(vault.apply_router(), Ok(()));
            assert_eq!(vault.apply_valuation_infra(), Ok(()));

            assert_eq!(vault.router_address(), Some(accounts.frank));
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(factory_addr()), Some(wnative_addr()))
            );

            // O depositante segue com as suas shares intactas.
            let (shares, _) = vault.get_depositor_info(accounts.charlie).unwrap();
            assert_eq!(shares, 100_000_000_000 - constants::MINIMUM_SHARES);
        }

        /// O depositante que reage à proposta consegue executar o saque
        /// de emergência ANTES de a troca poder ser aplicada.
        #[ink::test]
        fn test_depositor_can_exit_before_router_change_applies() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            let eta = vault.propose_router(accounts.frank).unwrap();

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            assert!(unlock_at < eta);
            set_now(unlock_at);
            assert!(vault.execute_emergency_withdrawal().is_ok());

            set_caller(accounts.alice);
            assert_eq!(
                vault.apply_router(),
                Err(VaultError::ConfigChangeTimelocked)
            );
        }

        // ════════════════════════════════════════════════════════
        // Rodada 2 — timelock pré-armado / expiração / depositante tardio
        // ════════════════════════════════════════════════════════

        /// Vault vazio (sem depositantes), relógio em 1_000.
        fn empty_vault_at_1000() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
            let (vault, accounts) = create_vault();
            set_now(1_000);
            (vault, accounts)
        }

        /// Charlie deposita 1000 LUNES no vault (sem infra de valuation).
        fn charlie_deposits(vault: &mut CopyVault) -> Result<Balance, VaultError> {
            let accounts = default_accounts();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_caller(accounts.charlie);
            set_value(100_000_000_000);
            set_balance(contract_id, 100_000_000_000);
            let res = vault.deposit();
            set_value(0);
            res
        }

        #[ink::test]
        fn test_config_change_grace_constant() {
            assert_eq!(constants::CONFIG_CHANGE_GRACE_MS, 48 * 60 * 60 * 1000);
        }

        /// (a) O setter imediato (sem depositantes) descarta a proposta
        /// de router pendente: ela não pode ser aplicada depois.
        #[ink::test]
        fn test_immediate_set_router_clears_pending_proposal() {
            let (mut vault, accounts) = empty_vault_at_1000();

            set_caller(accounts.alice);
            let eta = vault.propose_router(accounts.frank).unwrap();
            assert_eq!(vault.set_router(accounts.django), Ok(()));
            assert_eq!(vault.get_pending_router(), None);
            assert_eq!(vault.router_address(), Some(accounts.django));

            // Depósito posterior e eta maduro: nada a aplicar.
            assert!(charlie_deposits(&mut vault).is_ok());
            set_caller(accounts.alice);
            set_now(eta);
            assert_eq!(vault.apply_router(), Err(VaultError::NoPendingConfigChange));
            assert_eq!(vault.router_address(), Some(accounts.django));
        }

        /// (a) Mesmo para a infra de valuation — cenário do revisor:
        /// wnative falso pré-armado + config legítima imediata.
        #[ink::test]
        fn test_immediate_set_valuation_infra_clears_pending_proposal() {
            let (mut vault, accounts) = empty_vault_at_1000();
            let fake_wnative = token(0xEE);

            set_caller(accounts.alice);
            let eta = vault
                .propose_valuation_infra(factory_addr(), fake_wnative)
                .unwrap();
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Ok(())
            );
            assert_eq!(vault.get_pending_valuation_infra(), None);

            assert!(charlie_deposits(&mut vault).is_ok());
            set_caller(accounts.alice);
            set_now(eta);
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::NoPendingConfigChange)
            );
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(factory_addr()), Some(wnative_addr()))
            );
        }

        /// (a) O descarte pelo setter imediato emite o evento de cancelamento.
        #[ink::test]
        fn test_immediate_setter_emits_cancel_for_discarded_proposal() {
            let (mut vault, accounts) = empty_vault_at_1000();

            set_caller(accounts.alice);
            vault.propose_router(accounts.frank).unwrap();
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.set_router(accounts.django), Ok(()));
            // RouterChangeCancelled + RouterChanged.
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(2)
            );
            let cancelled = ink::env::test::recorded_events()
                .nth(events_before)
                .expect("evento de cancelamento");
            match <Event as scale::Decode>::decode(&mut &cancelled.data[..]).unwrap() {
                Event::RouterChangeCancelled(e) => assert_eq!(e.router, accounts.frank),
                _ => panic!("esperado RouterChangeCancelled"),
            }

            vault
                .propose_valuation_infra(token(0xF1), token(0xF2))
                .unwrap();
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(
                vault.set_valuation_infra(factory_addr(), wnative_addr()),
                Ok(())
            );
            assert_eq!(
                ink::env::test::recorded_events().count(),
                events_before.saturating_add(2)
            );
            let cancelled = ink::env::test::recorded_events()
                .nth(events_before)
                .expect("evento de cancelamento");
            match <Event as scale::Decode>::decode(&mut &cancelled.data[..]).unwrap() {
                Event::ValuationInfraChangeCancelled(e) => {
                    assert_eq!(e.factory, token(0xF1));
                    assert_eq!(e.wnative, token(0xF2));
                }
                _ => panic!("esperado ValuationInfraChangeCancelled"),
            }
        }

        /// (b) A proposta de router tem validade: só aplica em
        /// [eta, eta + CONFIG_CHANGE_GRACE_MS]; fora disso nada muda.
        #[ink::test]
        fn test_router_proposal_expires_after_grace() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            let eta = vault.propose_router(accounts.frank).unwrap();
            let last_valid = eta.saturating_add(constants::CONFIG_CHANGE_GRACE_MS);

            set_now(last_valid.saturating_add(1));
            assert_eq!(vault.apply_router(), Err(VaultError::ConfigChangeExpired));
            assert_eq!(vault.router_address(), None);

            set_now(last_valid);
            assert_eq!(vault.apply_router(), Ok(()));
            assert_eq!(vault.router_address(), Some(accounts.frank));
        }

        /// (b) Idem para factory/wnative.
        #[ink::test]
        fn test_valuation_infra_proposal_expires_after_grace() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            let eta = vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            let last_valid = eta.saturating_add(constants::CONFIG_CHANGE_GRACE_MS);

            set_now(last_valid.saturating_add(1));
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::ConfigChangeExpired)
            );
            assert_eq!(vault.get_valuation_infra(), (None, None));

            set_now(last_valid);
            assert_eq!(vault.apply_valuation_infra(), Ok(()));
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(factory_addr()), Some(wnative_addr()))
            );
        }

        /// (c) Com proposta de router viva, ninguém entra: todo
        /// depositante presente no `apply` teve o aviso completo.
        #[ink::test]
        fn test_deposit_blocked_while_router_proposal_pending() {
            let (mut vault, accounts) = empty_vault_at_1000();

            set_caller(accounts.alice);
            let eta = vault.propose_router(accounts.frank).unwrap();

            set_now(eta.saturating_sub(1));
            assert_eq!(
                charlie_deposits(&mut vault),
                Err(VaultError::DepositsBlockedByPendingConfigChange)
            );
            assert_eq!(vault.total_shares, 0);
            set_now(eta.saturating_add(constants::CONFIG_CHANGE_GRACE_MS));
            assert_eq!(
                charlie_deposits(&mut vault),
                Err(VaultError::DepositsBlockedByPendingConfigChange)
            );
            assert_eq!(vault.total_shares, 0);

            // Cancelada a proposta, o depósito volta a funcionar.
            set_caller(accounts.alice);
            assert_eq!(vault.cancel_router_proposal(), Ok(()));
            assert!(charlie_deposits(&mut vault).is_ok());
        }

        /// (c) Idem para proposta de factory/wnative.
        #[ink::test]
        fn test_deposit_blocked_while_valuation_infra_proposal_pending() {
            let (mut vault, accounts) = empty_vault_at_1000();

            set_caller(accounts.alice);
            vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            assert_eq!(
                charlie_deposits(&mut vault),
                Err(VaultError::DepositsBlockedByPendingConfigChange)
            );
            assert_eq!(vault.total_shares, 0);

            set_caller(accounts.alice);
            assert_eq!(vault.cancel_valuation_infra_proposal(), Ok(()));
            assert!(charlie_deposits(&mut vault).is_ok());
        }

        /// Cenário do revisor: proposta pré-armada que já expirou não
        /// bloqueia depósitos e não pode mais ser aplicada sobre eles.
        #[ink::test]
        fn test_expired_prearmed_proposal_cannot_hit_later_depositors() {
            let (mut vault, accounts) = empty_vault_at_1000();
            let fake_wnative = token(0xEE);

            set_caller(accounts.alice);
            let eta = vault
                .propose_valuation_infra(factory_addr(), fake_wnative)
                .unwrap();

            set_now(
                eta.saturating_add(constants::CONFIG_CHANGE_GRACE_MS)
                    .saturating_add(1),
            );
            assert!(charlie_deposits(&mut vault).is_ok());

            set_caller(accounts.alice);
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::ConfigChangeExpired)
            );
            assert_eq!(vault.get_valuation_infra(), (None, None));
        }

        /// Revisor (baixo): nova proposta de infra sobrescreve a anterior
        /// e reinicia o relógio, como no router.
        #[ink::test]
        fn test_new_valuation_infra_proposal_overwrites_and_restarts_clock() {
            let (mut vault, accounts) = vault_with_single_depositor();

            set_caller(accounts.alice);
            let first_eta = vault
                .propose_valuation_infra(token(0xF1), token(0xF2))
                .unwrap();
            set_now(5_000);
            let second_eta = vault
                .propose_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            assert_eq!(
                second_eta,
                5_000u64.saturating_add(constants::CONFIG_CHANGE_DELAY_MS)
            );

            set_now(first_eta);
            assert_eq!(
                vault.apply_valuation_infra(),
                Err(VaultError::ConfigChangeTimelocked)
            );

            set_now(second_eta);
            assert_eq!(vault.apply_valuation_infra(), Ok(()));
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(factory_addr()), Some(wnative_addr()))
            );
        }

        /// Revisor (baixo): propostas degeneradas são recusadas antes de
        /// qualquer escrita (AccountId zero, o próprio vault, factory ==
        /// wnative).
        #[ink::test]
        fn test_propose_rejects_degenerate_addresses() {
            let (mut vault, accounts) = vault_with_single_depositor();
            let zero = AccountId::from([0u8; 32]);
            let this = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            set_caller(accounts.alice);
            let events_before = ink::env::test::recorded_events().count();
            for bad in [zero, this] {
                assert_eq!(
                    vault.propose_router(bad),
                    Err(VaultError::InvalidConfigAddress)
                );
            }
            for (factory, wnative) in [
                (zero, wnative_addr()),
                (factory_addr(), zero),
                (this, wnative_addr()),
                (factory_addr(), this),
                (factory_addr(), factory_addr()),
            ] {
                assert_eq!(
                    vault.propose_valuation_infra(factory, wnative),
                    Err(VaultError::InvalidConfigAddress)
                );
            }
            assert_eq!(vault.get_pending_router(), None);
            assert_eq!(vault.get_pending_valuation_infra(), None);
            assert_eq!(ink::env::test::recorded_events().count(), events_before);
        }

        // ════════════════════════════════════════════════════════
        // CV-FEE-01 — custo proporcional (multiplicar antes de dividir)
        // ════════════════════════════════════════════════════════

        /// Charlie entra com 100 LUNES (cota 1,0); doação leva o NAV a
        /// 150 LUNES (cota 1,5); django entra com 30 LUNES → 20e9 shares
        /// (basis 30e9). Saldo nativo final: 180 LUNES, total 120e9.
        fn vault_with_django_at_price_1_5() -> (
            CopyVault,
            ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>,
        ) {
            let (mut vault, accounts) = vault_with_single_depositor();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 150_000_000_000);
            set_caller(accounts.django);
            set_value(30_000_000_000);
            set_balance(contract_id, 180_000_000_000);
            assert_eq!(vault.deposit(), Ok(20_000_000_000));
            set_value(0);
            assert_eq!(vault.cost_basis.get(accounts.django), Some(30_000_000_000));
            (vault, accounts)
        }

        /// D2 (1): cota comprada a 1,5 e resgatada a 1,5 → sem lucro, sem taxa.
        #[ink::test]
        fn test_fee_full_withdraw_bought_above_par_without_profit_is_zero() {
            let (mut vault, accounts) = vault_with_django_at_price_1_5();

            set_caller(accounts.django);
            let unlock_at = vault.request_withdrawal(20_000_000_000).unwrap();
            set_now(unlock_at);
            assert_eq!(vault.withdraw(20_000_000_000), Ok(30_000_000_000));
            assert_eq!(vault.total_fees_collected, 0);
            assert_eq!(vault.cost_basis.get(accounts.django), None);
        }

        /// D2 (2): cota comprada abaixo de 1,0 (vault em prejuízo) e
        /// resgatada ao mesmo preço → sem taxa (antes: payout INTEIRO
        /// tratado como lucro).
        #[ink::test]
        fn test_fee_full_withdraw_bought_below_par_without_profit_is_zero() {
            let (mut vault, accounts) = vault_with_single_depositor();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            // Prejuízo: NAV 80 LUNES para 100e9 shares (cota 0,8).
            set_balance(contract_id, 80_000_000_000);
            set_caller(accounts.django);
            set_value(40_000_000_000);
            set_balance(contract_id, 120_000_000_000);
            assert_eq!(vault.deposit(), Ok(50_000_000_000));
            set_value(0);

            let unlock_at = vault.request_withdrawal(50_000_000_000).unwrap();
            set_now(unlock_at);
            assert_eq!(vault.withdraw(50_000_000_000), Ok(40_000_000_000));
            assert_eq!(vault.total_fees_collected, 0);
        }

        /// D2 (3): cota a 1,5, preço sobe a 2,0, saque PARCIAL de metade
        /// → taxa = 20% do lucro real e a base remanescente é proporcional.
        #[ink::test]
        fn test_fee_partial_withdraw_charges_only_real_profit() {
            let (mut vault, accounts) = vault_with_django_at_price_1_5();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();
            set_balance(contract_id, 240_000_000_000); // cota 2,0

            set_caller(accounts.django);
            // payout 20e9; custo real 30e9 × 10/20 = 15e9; lucro 5e9;
            // taxa 20% = 1e9; líquido 19e9.
            assert_eq!(vault.withdraw(10_000_000_000), Ok(19_000_000_000));
            assert_eq!(vault.total_fees_collected, 1_000_000_000);
            assert_eq!(vault.cost_basis.get(accounts.django), Some(15_000_000_000));
            assert_eq!(vault.shares.get(accounts.django), Some(10_000_000_000));
        }

        /// D2 (4): dois saques parciais seguidos pagam a mesma taxa que um
        /// saque total da mesma posição (± 1 planck). Django e eve têm
        /// posições idênticas; eve sai de uma vez, django em duas metades.
        #[ink::test]
        fn test_fee_two_partials_equal_one_full_withdraw() {
            let (mut vault, accounts) = vault_with_django_at_price_1_5();
            let contract_id = ink::env::test::callee::<ink::env::DefaultEnvironment>();

            // eve entra ao mesmo preço 1,5: 30e9 → 20e9 shares.
            set_caller(accounts.eve);
            set_value(30_000_000_000);
            set_balance(contract_id, 210_000_000_000);
            assert_eq!(vault.deposit(), Ok(20_000_000_000));
            set_value(0);

            // Preço sobe a 2,0 (total 140e9 shares).
            set_balance(contract_id, 280_000_000_000);

            // eve: saque total (14% > 10% ⇒ cooldown).
            let unlock_at = vault.request_withdrawal(20_000_000_000).unwrap();
            set_now(unlock_at);
            let fees_before = vault.total_fees_collected;
            vault.withdraw(20_000_000_000).unwrap();
            let fee_full = sub(vault.total_fees_collected, fees_before);
            // 20% do lucro real (40e9 - 30e9).
            assert_eq!(fee_full, 2_000_000_000);

            // django: duas metades (cada uma < 10% do total).
            set_caller(accounts.django);
            let fees_before = vault.total_fees_collected;
            vault.withdraw(10_000_000_000).unwrap();
            vault.withdraw(10_000_000_000).unwrap();
            let fee_partials = sub(vault.total_fees_collected, fees_before);

            assert!(
                fee_partials.abs_diff(fee_full) <= 1,
                "parciais {} != total {}",
                fee_partials,
                fee_full
            );
            assert_eq!(vault.cost_basis.get(accounts.django), None);
        }

        // ════════════════════════════════════════════════════════
        // Saída de emergência in-kind + allowlist de tokens
        // ════════════════════════════════════════════════════════

        type Accounts = ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment>;

        const C_DEP: Balance = 100_000_000_000;
        const D_DEP: Balance = 50_000_000_000;
        const W_BAL: Balance = 30_000_000_000;
        const A_BAL: Balance = 60_000_000_000;
        const B_BAL: Balance = 9_000_000_000;

        fn ed() -> Balance {
            ink::env::minimum_balance::<ink::env::DefaultEnvironment>()
        }

        fn contract() -> AccountId {
            ink::env::test::callee::<ink::env::DefaultEnvironment>()
        }

        fn native_of(account: AccountId) -> Balance {
            ink::env::test::get_account_balance::<ink::env::DefaultEnvironment>(account)
                .unwrap_or(0)
        }

        /// Oráculo independente de `mul_div_floor` (sem estouro nos testes).
        fn pro_rata(amount: Balance, s: Balance, total: Balance) -> Balance {
            amount
                .checked_mul(s)
                .and_then(|p| p.checked_div(total))
                .expect("pro_rata estourou")
        }

        fn add(a: Balance, b: Balance) -> Balance {
            a.checked_add(b).expect("overflow no teste")
        }

        fn sub(a: Balance, b: Balance) -> Balance {
            a.checked_sub(b).expect("underflow no teste")
        }

        /// `n` endereços que não são ativo do vault (0x40..).
        fn junk_tokens(n: u8) -> Vec<AccountId> {
            (0..n).map(|i| token(0x40u8.wrapping_add(i))).collect()
        }

        fn token_a() -> AccountId {
            token(0x31)
        }

        fn token_b() -> AccountId {
            token(0x32)
        }

        /// Permite `t` como admin do protocolo (alice).
        fn allow_token(vault: &mut CopyVault, t: AccountId) {
            set_caller(default_accounts().alice);
            assert_eq!(vault.set_token_allowed(t, true), Ok(()));
        }

        fn events_since(start: usize) -> Vec<Event> {
            ink::env::test::recorded_events()
                .skip(start)
                .map(|e| <Event as scale::Decode>::decode(&mut &e.data[..]).unwrap())
                .collect()
        }

        /// Router + infra; tA (1:1) e tB (0,5) permitidos e rastreados;
        /// charlie (100 LUNES) e django (50 LUNES) com o unlock de
        /// emergência maduro. Saldos PSP22 do vault: wnative 30e9,
        /// tA 60e9, tB 9e9. Nativo 150e9, total_shares 150e9.
        fn inkind_vault() -> (CopyVault, Accounts) {
            let (mut vault, accounts) = create_vault();
            let contract_id = contract();
            set_now(1_000);
            set_caller(accounts.alice);
            set_value(0);
            vault.set_router(accounts.frank).unwrap();
            vault
                .set_valuation_infra(factory_addr(), wnative_addr())
                .unwrap();
            test_mocks::set_pair_reserves(token_a(), 1_000_000_000_000, 1_000_000_000_000);
            test_mocks::set_pair_reserves(token_b(), 2_000_000_000_000, 1_000_000_000_000);
            for t in [token_a(), token_b()] {
                allow_token(&mut vault, t);
                vault.add_tracked_token(t).unwrap();
            }

            set_caller(accounts.charlie);
            set_value(C_DEP);
            set_balance(contract_id, C_DEP);
            vault.deposit().unwrap();
            set_caller(accounts.django);
            set_value(D_DEP);
            set_balance(contract_id, C_DEP + D_DEP);
            assert_eq!(vault.deposit(), Ok(D_DEP));
            set_value(0);

            test_mocks::set_psp22_balance(wnative_addr(), W_BAL);
            test_mocks::set_psp22_balance(token_a(), A_BAL);
            test_mocks::set_psp22_balance(token_b(), B_BAL);

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_caller(accounts.django);
            vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            (vault, accounts)
        }

        /// (1) Pro-rata exato de nativo + wnative + 2 tokens com dois
        /// depositantes; a soma paga nunca passa do saldo (R2).
        #[ink::test]
        fn test_inkind_exit_pays_exact_pro_rata_of_every_asset() {
            let (mut vault, accounts) = inkind_vault();
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let charlie_before = native_of(accounts.charlie);

            set_caller(accounts.charlie);
            let native_c = vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            assert_eq!(native_c, pro_rata(sub(C_DEP + D_DEP, ed()), s_c, total));
            assert_eq!(native_of(accounts.charlie), add(charlie_before, native_c));
            assert_eq!(
                test_mocks::psp22_transfers(),
                vec![
                    (
                        wnative_addr(),
                        accounts.charlie,
                        pro_rata(W_BAL, s_c, total)
                    ),
                    (token_a(), accounts.charlie, pro_rata(A_BAL, s_c, total)),
                    (token_b(), accounts.charlie, pro_rata(B_BAL, s_c, total)),
                ]
            );
            assert!(!vault.locked);
            assert_eq!(vault.total_shares, sub(total, s_c));
            assert_eq!(vault.shares.get(accounts.charlie), None);
            assert_eq!(vault.cost_basis.get(accounts.charlie), None);
            assert_eq!(vault.active_depositors, 1);
            assert_eq!(vault.total_withdrawn, native_c);

            // django sai em seguida, do que restou.
            let total2 = vault.total_shares;
            let native_left = native_of(contract());
            set_caller(accounts.django);
            let native_d = vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            assert_eq!(native_d, pro_rata(sub(native_left, ed()), D_DEP, total2));
            assert!(add(native_c, native_d) <= sub(C_DEP + D_DEP, ed()));

            let transfers = test_mocks::psp22_transfers();
            for (t, initial) in [
                (wnative_addr(), W_BAL),
                (token_a(), A_BAL),
                (token_b(), B_BAL),
            ] {
                let paid: Balance = transfers.iter().filter(|x| x.0 == t).map(|x| x.2).sum();
                assert!(paid <= initial, "pago {} > saldo {}", paid, initial);
                assert_eq!(test_mocks::psp22_balance(t), sub(initial, paid));
                assert_eq!(vault.get_reserved_token(t), 0);
            }
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
            assert_eq!(vault.active_depositors, 0);
        }

        /// (2) Achado #0: par sem reservas (equity falha) não impede a saída.
        #[ink::test]
        fn test_inkind_exit_works_when_equity_valuation_fails() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::clear_pair_reserves(token_a());
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable)
            );

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .is_ok());
            assert_eq!(vault.shares.get(accounts.charlie), None);
            assert_eq!(test_mocks::psp22_transfers().len(), 3);
        }

        /// (3) Achado #3: funciona com o vault pausado e o trading parado.
        #[ink::test]
        fn test_inkind_exit_works_paused_and_halted() {
            let (mut vault, accounts) = inkind_vault();
            set_caller(accounts.alice);
            vault.pause().unwrap();
            vault.trading_halted = true;

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .is_ok());
            assert_eq!(vault.shares.get(accounts.charlie), None);
        }

        /// (4) P2: poeira de wnative não bloqueia o último depositante.
        #[ink::test]
        fn test_inkind_exit_wnative_dust_does_not_block_last_depositor() {
            let (mut vault, accounts) = vault_with_infra();
            set_now(1_000);
            set_caller(accounts.charlie);
            set_value(C_DEP);
            set_balance(contract(), C_DEP);
            vault.deposit().unwrap();
            set_value(0);
            test_mocks::set_psp22_balance(wnative_addr(), 1);

            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            let s = vault.shares.get(accounts.charlie).unwrap();
            let total = vault.total_shares;
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Ok(pro_rata(sub(C_DEP, ed()), s, total))
            );
            // 1 planck × s / total arredonda para 0: nada a transferir.
            assert!(test_mocks::psp22_transfers().is_empty());
            assert_eq!(test_mocks::psp22_balance(wnative_addr()), 1);
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
        }

        /// (5) O wrapper legado paga in-kind e devolve o nativo pago.
        #[ink::test]
        fn test_legacy_emergency_withdrawal_pays_in_kind() {
            let (mut vault, accounts) = inkind_vault();
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();

            set_caller(accounts.charlie);
            assert_eq!(
                vault.execute_emergency_withdrawal(),
                Ok(pro_rata(sub(C_DEP + D_DEP, ed()), s_c, total))
            );
            assert_eq!(test_mocks::psp22_transfers().len(), 3);
            assert_eq!(
                test_mocks::psp22_balance(token_a()),
                sub(A_BAL, pro_rata(A_BAL, s_c, total))
            );
        }

        /// (6) Sem unlock, ou antes do prazo: erro sem escrita nenhuma.
        #[ink::test]
        fn test_inkind_exit_requires_matured_unlock() {
            let (mut vault, accounts) = inkind_vault();
            let shares_before = vault.shares.get(accounts.eve);
            assert_eq!(shares_before, None);

            // eve nunca pediu.
            set_caller(accounts.eve);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::EmergencyNotUnlocked)
            );
            assert!(!vault.locked);

            // charlie pede de novo e tenta antes do novo prazo.
            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at.saturating_sub(1));
            let total = vault.total_shares;
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::EmergencyNotUnlocked)
            );
            assert!(!vault.locked);
            assert_eq!(vault.total_shares, total);
            assert_eq!(
                vault.shares.get(accounts.charlie),
                Some(C_DEP - constants::MINIMUM_SHARES)
            );
            assert_eq!(
                vault.emergency_unlocks.get(accounts.charlie),
                Some(unlock_at)
            );
            assert!(test_mocks::psp22_transfers().is_empty());
            assert_eq!(native_of(contract()), C_DEP + D_DEP);
        }

        /// (7) Saldo ilegível sem skip ⇒ TokenUnreadable, nenhuma escrita,
        /// zero transfers, lock liberado.
        #[ink::test]
        fn test_inkind_exit_unreadable_token_without_skip_fails_clean() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_balance_fail(token_b(), true);
            let total = vault.total_shares;
            let equity = vault.total_equity;

            set_caller(accounts.charlie);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::TokenUnreadable)
            );
            assert!(!vault.locked);
            assert_eq!(vault.total_shares, total);
            assert_eq!(vault.total_equity, equity);
            assert!(vault.shares.get(accounts.charlie).is_some());
            assert!(vault.emergency_unlocks.get(accounts.charlie).is_some());
            assert!(test_mocks::psp22_transfers().is_empty());
            assert_eq!(native_of(contract()), C_DEP + D_DEP);
            for t in [wnative_addr(), token_a(), token_b()] {
                assert_eq!(vault.get_reserved_token(t), 0);
            }
        }

        /// (8) O mesmo token em skip: Ok, zero chamadas ao token, evento
        /// status 2 e o saldo do token fica no vault (para quem fica).
        #[ink::test]
        fn test_inkind_exit_skip_makes_zero_calls_to_token() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_balance_fail(token_b(), true);
            let calls_before = test_mocks::psp22_calls(token_b());
            let events_before = ink::env::test::recorded_events().count();

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(vec![token_b()])
                .is_ok());
            assert_eq!(test_mocks::psp22_calls(token_b()), calls_before);
            assert_eq!(test_mocks::psp22_balance(token_b()), B_BAL);
            assert!(test_mocks::psp22_transfers()
                .iter()
                .all(|x| x.0 != token_b()));

            let skipped: Vec<_> = events_since(events_before)
                .into_iter()
                .filter_map(|e| match e {
                    Event::EmergencyTokenSettled(s) if s.token == token_b() => Some(s),
                    _ => None,
                })
                .collect();
            assert_eq!(skipped.len(), 1);
            assert_eq!(skipped[0].status, 2);
            assert_eq!(skipped[0].amount, 0);
            assert_eq!(skipped[0].depositor, accounts.charlie);
        }

        /// R1: com todos os ativos em skip, a saída não faz NENHUMA
        /// chamada entre contratos e paga só o nativo.
        #[ink::test]
        fn test_inkind_exit_all_skipped_makes_no_cross_contract_call() {
            let (mut vault, accounts) = inkind_vault();
            let assets = [wnative_addr(), token_a(), token_b()];
            for t in assets {
                test_mocks::set_psp22_balance_fail(t, true);
                test_mocks::set_psp22_transfer_fail(t, true);
            }
            let calls: Vec<u32> = assets.iter().map(|t| test_mocks::psp22_calls(*t)).collect();

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(assets.to_vec())
                .is_ok());
            let after: Vec<u32> = assets.iter().map(|t| test_mocks::psp22_calls(*t)).collect();
            assert_eq!(after, calls);
            assert_eq!(vault.shares.get(accounts.charlie), None);
        }

        /// (9) Transfer falho: Ok, crédito pendente == reserva == amt,
        /// demais ativos pagos, cotas queimadas.
        #[ink::test]
        fn test_inkind_exit_failed_transfer_becomes_pending_credit() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let amt = pro_rata(A_BAL, s_c, total);
            let events_before = ink::env::test::recorded_events().count();

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .is_ok());
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), amt);
            assert_eq!(vault.get_reserved_token(token_a()), amt);
            assert_eq!(test_mocks::psp22_balance(token_a()), A_BAL);
            assert_eq!(
                test_mocks::psp22_transfers(),
                vec![
                    (
                        wnative_addr(),
                        accounts.charlie,
                        pro_rata(W_BAL, s_c, total)
                    ),
                    (token_b(), accounts.charlie, pro_rata(B_BAL, s_c, total)),
                ]
            );
            assert_eq!(vault.shares.get(accounts.charlie), None);
            assert!(!vault.locked);
            let pending: Vec<_> = events_since(events_before)
                .into_iter()
                .filter_map(|e| match e {
                    Event::EmergencyTokenSettled(s) if s.token == token_a() => Some(s),
                    _ => None,
                })
                .collect();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].status, 1);
            assert_eq!(pending[0].amount, amt);
        }

        /// (10) A segunda saída depois de (9) não distribui a reserva.
        #[ink::test]
        fn test_inkind_second_exit_excludes_reserved_amount() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let amt_c = pro_rata(A_BAL, s_c, total);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();

            test_mocks::set_psp22_transfer_fail(token_a(), false);
            let total2 = vault.total_shares;
            set_caller(accounts.django);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let amt_d = pro_rata(sub(A_BAL, amt_c), D_DEP, total2);
            assert!(test_mocks::psp22_transfers().contains(&(token_a(), accounts.django, amt_d)));
            assert_eq!(test_mocks::psp22_balance(token_a()), sub(A_BAL, amt_d));
            // A reserva de charlie segue intacta e coberta pelo saldo.
            assert_eq!(vault.get_reserved_token(token_a()), amt_c);
            assert!(test_mocks::psp22_balance(token_a()) >= amt_c);
        }

        /// (11) Equity e o teto de amount_in do swap descontam a reserva.
        #[ink::test]
        fn test_reserved_tokens_excluded_from_equity_and_swap_balance() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let reserved = vault.get_reserved_token(token_a());
            assert!(reserved > 0);

            let native = native_of(contract());
            let w = test_mocks::psp22_balance(wnative_addr());
            let a_free = sub(A_BAL, reserved); // tA cotado 1:1
            let b_value = test_mocks::psp22_balance(token_b()) / 2; // tB a 0,5
            let expected = add(add(add(native, w), a_free), b_value);
            assert_eq!(vault.get_vault_equity(), Ok(expected));
            let (_, entries, total) = vault.get_equity_breakdown().unwrap();
            assert_eq!(total, expected);
            assert!(entries.contains(&(token_a(), a_free, a_free)));

            // Vender mais que o saldo LIVRE falha antes de qualquer cap.
            set_caller(accounts.bob);
            assert_eq!(
                vault.swap_through_router(token_a(), wnative_addr(), add(a_free, 1), 1),
                Err(VaultError::InsufficientTokenBalance)
            );
            assert!(!vault.locked);
        }

        /// Untrack exige saldo LIVRE zero: saldo só reservado não prende o token.
        #[ink::test]
        fn test_untrack_allows_fully_reserved_balance() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_b(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let reserved = vault.get_reserved_token(token_b());
            // Simula o leader vendendo todo o saldo livre de tB.
            test_mocks::set_psp22_balance(token_b(), reserved);

            set_caller(accounts.alice);
            assert_eq!(vault.remove_tracked_token(token_b()), Ok(()));
            // O credito pendente continua resgatável (token não rastreado).
            test_mocks::set_psp22_transfer_fail(token_b(), false);
            set_caller(accounts.charlie);
            assert_eq!(vault.claim_pending_token(token_b()), Ok(reserved));
            assert_eq!(vault.get_reserved_token(token_b()), 0);
        }

        /// (12) Claim: sucesso zera pendente e reserva; falha devolve
        /// Ok(0) e mantém ambos; sem crédito ⇒ NothingToClaim sem escrita.
        #[ink::test]
        fn test_claim_pending_token() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let amt = vault.get_pending_token(token_a(), accounts.charlie);
            assert!(amt > 0);

            // Terceiro não tem crédito e não toca no de charlie.
            set_caller(accounts.eve);
            assert_eq!(
                vault.claim_pending_token(token_a()),
                Err(VaultError::NothingToClaim)
            );
            assert!(!vault.locked);
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), amt);

            // Ainda falhando: Ok(0), estado igual (funciona pausado).
            set_caller(accounts.alice);
            vault.pause().unwrap();
            set_caller(accounts.charlie);
            let transfers_before = test_mocks::psp22_transfers().len();
            assert_eq!(vault.claim_pending_token(token_a()), Ok(0));
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), amt);
            assert_eq!(vault.get_reserved_token(token_a()), amt);
            assert_eq!(test_mocks::psp22_transfers().len(), transfers_before);
            assert!(!vault.locked);

            // Token volta a funcionar: paga só ao caller e zera tudo.
            test_mocks::set_psp22_transfer_fail(token_a(), false);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.claim_pending_token(token_a()), Ok(amt));
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(token_a()), 0);
            assert_eq!(
                test_mocks::psp22_transfers().last(),
                Some(&(token_a(), accounts.charlie, amt))
            );
            match events_since(events_before).as_slice() {
                [Event::PendingTokenClaimed(e)] => {
                    assert_eq!(e.account, accounts.charlie);
                    assert_eq!(e.token, token_a());
                    assert_eq!(e.amount, amt);
                }
                _ => panic!("esperado um PendingTokenClaimed"),
            }

            // Nada mais a resgatar.
            assert_eq!(
                vault.claim_pending_token(token_a()),
                Err(VaultError::NothingToClaim)
            );
        }

        /// (13) Segunda chamada do mesmo caller: erro, nenhum pagamento a mais.
        #[ink::test]
        fn test_inkind_exit_cannot_be_repeated() {
            let (mut vault, accounts) = inkind_vault();
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let transfers = test_mocks::psp22_transfers().len();
            let native = native_of(contract());

            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::EmergencyNotUnlocked)
            );
            // Mesmo com um unlock forjado, sem cotas não há pagamento.
            vault.emergency_unlocks.insert(accounts.charlie, &0);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::InsufficientShares)
            );
            assert_eq!(test_mocks::psp22_transfers().len(), transfers);
            assert_eq!(native_of(contract()), native);
            assert!(!vault.locked);
        }

        /// (14) Estado legado com wnative também rastreado: paga uma vez só.
        #[ink::test]
        fn test_inkind_exit_wnative_also_tracked_paid_once() {
            let (mut vault, accounts) = inkind_vault();
            let idx = vault.tracked_token_count;
            vault.tracked_tokens.insert(idx, &wnative_addr());
            vault.tracked_token_index.insert(wnative_addr(), &idx);
            vault.tracked_token_count = idx.checked_add(1).unwrap();

            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let w_transfers = test_mocks::psp22_transfers()
                .iter()
                .filter(|x| x.0 == wnative_addr())
                .count();
            assert_eq!(w_transfers, 1);
            assert_eq!(vault.get_pending_token(wnative_addr(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(wnative_addr()), 0);
        }

        /// (15)/(16) Último depositante: total_shares volta ao piso, a
        /// fração das dead shares e o ED ficam no vault.
        #[ink::test]
        fn test_inkind_last_exit_leaves_dead_share_fraction_and_ed() {
            let (mut vault, accounts) = inkind_vault();
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            set_caller(accounts.django);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();

            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
            assert_eq!(vault.depositor_shares(), 0);
            assert!(native_of(contract()) >= ed());
            // A fração MINIMUM_SHARES / 150e9 de cada token fica.
            for (t, initial) in [(token_a(), A_BAL), (wnative_addr(), W_BAL)] {
                assert!(
                    test_mocks::psp22_balance(t)
                        >= pro_rata(initial, constants::MINIMUM_SHARES, C_DEP + D_DEP)
                );
            }
        }

        /// (17) Skip list maior que tracked_token_count + 1 ⇒ InvalidSkipList
        /// sem escrita; exatamente count + 1 entradas é aceito.
        #[ink::test]
        fn test_inkind_exit_rejects_oversized_skip_list() {
            let (mut vault, accounts) = inkind_vault();
            let total = vault.total_shares;
            set_caller(accounts.charlie);
            let ten = junk_tokens(10);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(ten),
                Err(VaultError::InvalidSkipList)
            );
            let four = junk_tokens(4);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(four),
                Err(VaultError::InvalidSkipList)
            );
            assert!(!vault.locked);
            assert_eq!(vault.total_shares, total);
            assert!(test_mocks::psp22_transfers().is_empty());

            // count (2) + 1 entradas, com lixo e duplicata: aceito; entradas
            // que não são ativo do vault são ignoradas.
            assert!(vault
                .execute_emergency_withdrawal_in_kind(vec![token(0x40), token(0x40), token(0x41)])
                .is_ok());
            assert_eq!(test_mocks::psp22_transfers().len(), 3);
        }

        /// (18) total_equity e high_water_mark escalam por (total - s)/total.
        #[ink::test]
        fn test_inkind_exit_scales_equity_and_hwm() {
            let (mut vault, accounts) = inkind_vault();
            vault.total_equity = 300_000_000_007;
            vault.high_water_mark = 400_000_000_009;
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let rest = sub(total, s_c);

            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            assert_eq!(vault.total_equity, pro_rata(300_000_000_007, rest, total));
            assert_eq!(
                vault.high_water_mark,
                pro_rata(400_000_000_009, rest, total)
            );
        }

        /// (19) Exatamente um Withdrawn e um EmergencyTokenSettled por
        /// ativo liquidado (pago, pendente ou skip).
        #[ink::test]
        fn test_inkind_exit_events() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let events_before = ink::env::test::recorded_events().count();

            set_caller(accounts.charlie);
            let native = vault
                .execute_emergency_withdrawal_in_kind(vec![token_b()])
                .unwrap();
            let events = events_since(events_before);
            let withdrawn: Vec<_> = events
                .iter()
                .filter_map(|e| match e {
                    Event::Withdrawn(w) => Some(w),
                    _ => None,
                })
                .collect();
            assert_eq!(withdrawn.len(), 1);
            assert_eq!(withdrawn[0].depositor, accounts.charlie);
            assert_eq!(withdrawn[0].shares_burned, s_c);
            assert_eq!(withdrawn[0].amount_received, native);
            assert_eq!(withdrawn[0].performance_fee, 0);

            let settled: Vec<(AccountId, Balance, u8)> = events
                .iter()
                .filter_map(|e| match e {
                    Event::EmergencyTokenSettled(s) => Some((s.token, s.amount, s.status)),
                    _ => None,
                })
                .collect();
            assert_eq!(
                settled,
                vec![
                    (wnative_addr(), pro_rata(W_BAL, s_c, total), 0),
                    (token_a(), pro_rata(A_BAL, s_c, total), 1),
                    (token_b(), 0, 2),
                ]
            );
            assert_eq!(events.len(), 4);
        }

        /// (20) mul_div_floor é exato mesmo quando a·b estoura u128.
        #[ink::test]
        fn test_mul_div_floor_handles_overflowing_product() {
            assert_eq!(CopyVault::mul_div_floor(10, 3, 4), Ok(7));
            assert_eq!(CopyVault::mul_div_floor(5, 0, 4), Ok(0));
            assert_eq!(CopyVault::mul_div_floor(5, 7, 0), Err(VaultError::Overflow));
            // u128::MAX = 3k (2^128 - 1 é múltiplo de 3).
            let k = u128::MAX / 3;
            let two_k = k.checked_mul(2).unwrap();
            assert_eq!(CopyVault::mul_div_floor(u128::MAX, 2, 3), Ok(two_k));
            assert_eq!(
                CopyVault::mul_div_floor(u128::MAX.saturating_sub(1), 2, 3),
                Ok(two_k.saturating_sub(1))
            );
            assert_eq!(
                CopyVault::mul_div_floor(1u128 << 100, 1u128 << 60, 1u128 << 62),
                Ok(1u128 << 98)
            );
            assert_eq!(
                CopyVault::mul_div_floor(u128::MAX, u128::MAX, u128::MAX),
                Ok(u128::MAX)
            );
            // Resultado que não cabe em u128 ⇒ Overflow (nunca trunca).
            assert_eq!(
                CopyVault::mul_div_floor(u128::MAX, 3, 2),
                Err(VaultError::Overflow)
            );
        }

        /// preview_emergency_exit espelha o cálculo da saída (None =
        /// saldo ilegível) e não escreve.
        #[ink::test]
        fn test_preview_emergency_exit() {
            let (mut vault, accounts) = inkind_vault();
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            test_mocks::set_psp22_balance_fail(token_b(), true);

            let (native, legs) = vault.preview_emergency_exit(accounts.charlie);
            assert_eq!(native, pro_rata(sub(C_DEP + D_DEP, ed()), s_c, total));
            assert_eq!(
                legs,
                vec![
                    (wnative_addr(), Some(pro_rata(W_BAL, s_c, total))),
                    (token_a(), Some(pro_rata(A_BAL, s_c, total))),
                    (token_b(), None),
                ]
            );
            assert_eq!(vault.preview_emergency_exit(accounts.eve), (0, Vec::new()));

            test_mocks::set_psp22_balance_fail(token_b(), false);
            set_caller(accounts.charlie);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Ok(native)
            );
        }

        // ── allowlist ──────────────────────────────────────────

        /// (21) Só o admin do protocolo mexe na allowlist.
        #[ink::test]
        fn test_set_token_allowed_requires_protocol_admin() {
            let (mut vault, accounts) = vault_with_infra();
            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.set_token_allowed(token_a(), true),
                    Err(VaultError::NotAdmin)
                );
            }
            assert!(!vault.is_token_allowed(token_a()));

            set_caller(accounts.alice);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.set_token_allowed(token_a(), true), Ok(()));
            assert!(vault.is_token_allowed(token_a()));
            match events_since(events_before).as_slice() {
                [Event::TokenAllowlistChanged(e)] => {
                    assert_eq!(e.token, token_a());
                    assert!(e.allowed);
                }
                _ => panic!("esperado TokenAllowlistChanged"),
            }

            for caller in [accounts.bob, accounts.charlie] {
                set_caller(caller);
                assert_eq!(
                    vault.set_token_allowed(token_a(), false),
                    Err(VaultError::NotAdmin)
                );
            }
            assert!(vault.is_token_allowed(token_a()));
        }

        /// (22) Sem depositantes: na hora. Com depositantes: só após
        /// CONFIG_CHANGE_DELAY_MS.
        #[ink::test]
        fn test_set_token_allowed_delay_with_depositors() {
            let (mut vault, accounts) = vault_with_infra();
            set_now(1_000);
            allow_token(&mut vault, token_a());
            assert_eq!(vault.get_token_allowed_at(token_a()), Some(1_000));
            assert!(vault.is_token_allowed(token_a()));

            set_caller(accounts.charlie);
            set_value(C_DEP);
            set_balance(contract(), C_DEP);
            vault.deposit().unwrap();
            set_value(0);

            allow_token(&mut vault, token_b());
            let eta = 1_000 + constants::CONFIG_CHANGE_DELAY_MS;
            assert_eq!(vault.get_token_allowed_at(token_b()), Some(eta));
            assert!(!vault.is_token_allowed(token_b()));
            test_mocks::set_pair_reserves(token_b(), 1_000_000_000_000, 1_000_000_000_000);
            set_caller(accounts.alice);
            assert_eq!(
                vault.add_tracked_token(token_b()),
                Err(VaultError::TokenNotAllowed)
            );

            set_now(eta - 1);
            assert!(!vault.is_token_allowed(token_b()));
            set_now(eta);
            assert!(vault.is_token_allowed(token_b()));
            assert_eq!(vault.add_tracked_token(token_b()), Ok(()));
        }

        /// (23) Re-permitir não reinicia o prazo; remover é imediato e
        /// cancela o pendente.
        #[ink::test]
        fn test_set_token_allowed_idempotent_and_removal_immediate() {
            let (mut vault, accounts) = vault_with_single_depositor();
            set_caller(accounts.alice);
            assert_eq!(vault.set_token_allowed(token_a(), true), Ok(()));
            let eta = vault.get_token_allowed_at(token_a()).unwrap();
            assert_eq!(eta, 1_000 + constants::CONFIG_CHANGE_DELAY_MS);

            set_now(5_000);
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.set_token_allowed(token_a(), true), Ok(()));
            assert_eq!(vault.get_token_allowed_at(token_a()), Some(eta));
            assert_eq!(ink::env::test::recorded_events().count(), events_before);

            // Remoção do pendente: na hora, com evento.
            assert_eq!(vault.set_token_allowed(token_a(), false), Ok(()));
            assert_eq!(vault.get_token_allowed_at(token_a()), None);
            match events_since(events_before).as_slice() {
                [Event::TokenAllowlistChanged(e)] => {
                    assert_eq!(e.token, token_a());
                    assert!(!e.allowed);
                    assert_eq!(e.effective_at, 5_000);
                }
                _ => panic!("esperado TokenAllowlistChanged"),
            }
            set_now(eta);
            assert!(!vault.is_token_allowed(token_a()));

            // Remover o que não existe: Ok, sem evento.
            let events_before = ink::env::test::recorded_events().count();
            assert_eq!(vault.set_token_allowed(token_a(), false), Ok(()));
            assert_eq!(ink::env::test::recorded_events().count(), events_before);
        }

        /// (24) Token não permitido não entra por add_tracked_token nem
        /// pelo auto-track do swap.
        #[ink::test]
        fn test_unallowed_token_cannot_be_tracked_or_bought() {
            let (mut vault, accounts) = setup_funded_vault_with_router();
            let rogue = token(0x55);
            test_mocks::set_pair_reserves(rogue, 1_000_000_000_000, 1_000_000_000_000);

            set_caller(accounts.alice);
            assert_eq!(
                vault.add_tracked_token(rogue),
                Err(VaultError::TokenNotAllowed)
            );
            set_caller(accounts.bob);
            assert_eq!(
                vault.add_tracked_token(rogue),
                Err(VaultError::TokenNotAllowed)
            );
            assert_eq!(
                vault.swap_through_router(accounts.django, rogue, 1_000_000_000, 900_000_000),
                Err(VaultError::TokenNotAllowed)
            );
            assert!(!vault.locked);
            assert!(!vault.is_tracked(rogue));
            assert_eq!(test_mocks::psp22_balance(rogue), 0);
        }

        /// (25) Token rastreado e depois removido da allowlist: não pode
        /// mais ser comprado; vender continua; segue no equity e na saída.
        #[ink::test]
        fn test_delisted_tracked_token_can_be_sold_not_bought() {
            let (mut vault, accounts) = setup_funded_vault_with_router();
            set_caller(accounts.bob);
            vault
                .swap_through_router(accounts.django, accounts.eve, 10_000_000_000, 9_000_000_000)
                .unwrap();
            assert!(vault.is_tracked(accounts.eve));

            set_caller(accounts.alice);
            vault.set_token_allowed(accounts.eve, false).unwrap();

            set_caller(accounts.bob);
            assert_eq!(
                vault.swap_through_router(accounts.django, accounts.eve, 1_000_000_000, 1),
                Err(VaultError::TokenNotAllowed)
            );
            assert!(!vault.locked);
            // Vender eve (token_in) por django continua possível.
            assert_eq!(
                vault.swap_through_router(accounts.eve, accounts.django, 1_000_000_000, 1),
                Ok(1)
            );
            assert!(vault.is_tracked(accounts.eve));
            let (_, entries, _) = vault.get_equity_breakdown().unwrap();
            assert!(entries.iter().any(|e| e.0 == accounts.eve));
            let (_, legs) = vault.preview_emergency_exit(accounts.charlie);
            assert!(legs.iter().any(|l| l.0 == accounts.eve));
            // E não pode ser re-rastreado sem nova permissão.
            set_caller(accounts.alice);
            assert_eq!(
                vault.add_tracked_token(accounts.eve),
                Err(VaultError::TokenNotAllowed)
            );
        }

        /// (26) wnative é implícito; endereço degenerado é recusado.
        #[ink::test]
        fn test_set_token_allowed_rejects_wnative_and_invalid_address() {
            let (mut vault, accounts) = vault_with_infra();
            set_caller(accounts.alice);
            assert_eq!(
                vault.set_token_allowed(wnative_addr(), true),
                Err(VaultError::CannotTrackWnative)
            );
            assert_eq!(
                vault.set_token_allowed(AccountId::from([0u8; 32]), true),
                Err(VaultError::InvalidConfigAddress)
            );
            assert_eq!(
                vault.set_token_allowed(contract(), true),
                Err(VaultError::InvalidConfigAddress)
            );
            assert_eq!(vault.get_token_allowed_at(wnative_addr()), None);
        }

        /// (27) Depositar com unlock armado o remove: depósito a preço spot
        /// seguido de saída in-kind imediata fica fechado.
        #[ink::test]
        fn test_deposit_clears_armed_emergency_unlock() {
            let (mut vault, accounts) = vault_with_single_depositor();
            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);

            set_value(constants::MIN_DEPOSIT);
            set_balance(contract(), C_DEP + constants::MIN_DEPOSIT);
            vault.deposit().unwrap();
            set_value(0);
            assert_eq!(vault.emergency_unlocks.get(accounts.charlie), None);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::EmergencyNotUnlocked)
            );
        }

        // ── D3: troca de wnative com saldo ─────────────────────

        fn new_factory() -> AccountId {
            token(0xF1)
        }

        fn new_wnative() -> AccountId {
            token(0xF2)
        }

        /// Infra configurada, `extra` permitidos, charlie depositado (1_000 ms).
        fn d3_vault(extra: &[AccountId]) -> (CopyVault, Accounts) {
            let (mut vault, accounts) = vault_with_infra();
            set_now(1_000);
            for t in extra {
                allow_token(&mut vault, *t);
            }
            set_caller(accounts.charlie);
            set_value(C_DEP);
            set_balance(contract(), C_DEP);
            vault.deposit().unwrap();
            set_value(0);
            (vault, accounts)
        }

        fn propose_and_apply_new_infra(vault: &mut CopyVault) {
            set_caller(default_accounts().alice);
            let eta = vault
                .propose_valuation_infra(new_factory(), new_wnative())
                .unwrap();
            set_now(eta);
            assert_eq!(vault.apply_valuation_infra(), Ok(()));
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(new_factory()), Some(new_wnative()))
            );
        }

        /// D3 (a) Saldo no wnative antigo: vira rastreado, entra no NAV e
        /// é pago na saída in-kind.
        #[ink::test]
        fn test_wnative_rotation_tracks_old_wnative_with_balance() {
            let (mut vault, accounts) = d3_vault(&[]);
            test_mocks::set_psp22_balance(wnative_addr(), W_BAL);
            // Par antigo↔novo na factory nova (cotação 1:1).
            test_mocks::set_pair_reserves(wnative_addr(), 1_000_000_000_000, 1_000_000_000_000);
            let events_before = ink::env::test::recorded_events().count();

            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.get_tracked_tokens(), vec![wnative_addr()]);
            assert!(events_since(events_before).iter().any(|e| matches!(
                e,
                Event::TrackedTokenAdded(t) if t.token == wnative_addr()
            )));
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP + W_BAL));

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            let s = vault.shares.get(accounts.charlie).unwrap();
            let total = vault.total_shares;
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            assert!(test_mocks::psp22_transfers().contains(&(
                wnative_addr(),
                accounts.charlie,
                pro_rata(W_BAL, s, total)
            )));
        }

        /// D3 (b) Saldo zero no wnative antigo: nada rastreado.
        #[ink::test]
        fn test_wnative_rotation_with_zero_balance_tracks_nothing() {
            let (mut vault, _) = d3_vault(&[]);
            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.get_tracked_tokens(), Vec::<AccountId>::new());
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP));
        }

        /// D3 (c) Novo wnative que era rastreado: sai da lista e o NAV não
        /// o conta duas vezes.
        #[ink::test]
        fn test_wnative_rotation_untracks_new_wnative() {
            let (mut vault, _) = d3_vault(&[new_wnative()]);
            set_caller(default_accounts().alice);
            // Rastreado a 0,5 sob a infra antiga.
            test_mocks::set_pair_reserves(new_wnative(), 2_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(new_wnative()).unwrap();
            test_mocks::set_psp22_balance(new_wnative(), 10_000_000_000);
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP + 5_000_000_000));
            let events_before = ink::env::test::recorded_events().count();

            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.get_tracked_tokens(), Vec::<AccountId>::new());
            assert!(!vault.is_tracked(new_wnative()));
            assert!(events_since(events_before).iter().any(|e| matches!(
                e,
                Event::TrackedTokenRemoved(t) if t.token == new_wnative()
            )));
            // Agora 1:1 como wnative, uma vez só.
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP + 10_000_000_000));
        }

        /// D3 (d) Lista cheia (8) + saldo no antigo: o apply funciona e a
        /// lista fica com 9; a saída in-kind enxerga os 10 ativos.
        #[ink::test]
        fn test_wnative_rotation_can_exceed_max_tracked() {
            let full: Vec<AccountId> = (0..constants::MAX_TRACKED_TOKENS)
                .map(|i| token_at(0x10, i))
                .collect();
            let (mut vault, accounts) = d3_vault(&full);
            set_caller(accounts.alice);
            for t in &full {
                test_mocks::set_pair_reserves(*t, 1_000_000_000_000, 1_000_000_000_000);
                vault.add_tracked_token(*t).unwrap();
            }
            test_mocks::set_psp22_balance(wnative_addr(), W_BAL);

            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.tracked_token_count, constants::MAX_TRACKED_TOKENS + 1);
            assert!(vault.is_tracked(wnative_addr()));
            // Sem par antigo↔novo o NAV fica fechado; com o par (1:1) o
            // saldo do antigo entra uma vez só.
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable)
            );
            test_mocks::set_pair_reserves(wnative_addr(), 1_000_000_000_000, 1_000_000_000_000);
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP + W_BAL));
            // Nada novo entra acima do teto.
            let extra = token(0x60);
            allow_token(&mut vault, extra);
            test_mocks::set_pair_reserves(extra, 1_000_000_000_000, 1_000_000_000_000);
            set_now(vault.get_token_allowed_at(extra).unwrap());
            set_caller(accounts.alice);
            assert_eq!(
                vault.add_tracked_token(extra),
                Err(VaultError::TooManyTrackedTokens)
            );

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            // count (9) + 1 = 10 entradas na skip list é o limite.
            let skip = junk_tokens(10);
            assert!(vault.execute_emergency_withdrawal_in_kind(skip).is_ok());
            assert!(test_mocks::psp22_transfers()
                .iter()
                .any(|x| x.0 == wnative_addr()));
        }

        /// D3 (e) Leitura do saldo do antigo falha: rastreia mesmo assim.
        #[ink::test]
        fn test_wnative_rotation_tracks_old_wnative_when_unreadable() {
            let (mut vault, _) = d3_vault(&[]);
            test_mocks::set_psp22_balance_fail(wnative_addr(), true);
            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.get_tracked_tokens(), vec![wnative_addr()]);
            // Ilegível ⇒ NAV fechado (nunca valuation parcial); quando o
            // saldo volta a ser lido como zero, o NAV reabre.
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable)
            );
            test_mocks::set_psp22_balance_fail(wnative_addr(), false);
            assert_eq!(vault.get_vault_equity(), Ok(C_DEP));
        }

        /// D3 (f) Mesma regra pelo set_valuation_infra sem depositantes;
        /// re-configurar o MESMO wnative não rastreia nada.
        #[ink::test]
        fn test_wnative_rotation_via_immediate_setter() {
            let (mut vault, accounts) = vault_with_infra();
            allow_token(&mut vault, new_wnative());
            test_mocks::set_pair_reserves(new_wnative(), 1_000_000_000_000, 1_000_000_000_000);
            vault.add_tracked_token(new_wnative()).unwrap();
            test_mocks::set_psp22_balance(wnative_addr(), 7);

            set_caller(accounts.alice);
            // Mesmo wnative: só troca a factory.
            assert_eq!(
                vault.set_valuation_infra(new_factory(), wnative_addr()),
                Ok(())
            );
            assert_eq!(vault.get_tracked_tokens(), vec![new_wnative()]);

            assert_eq!(
                vault.set_valuation_infra(new_factory(), new_wnative()),
                Ok(())
            );
            assert_eq!(vault.get_tracked_tokens(), vec![wnative_addr()]);
            assert_eq!(
                vault.get_valuation_infra(),
                (Some(new_factory()), Some(new_wnative()))
            );
            // O antigo (7 plancks) é rastreado comum: sem par não há NAV;
            // com par 1:1 entra pelo valor cotado, uma vez.
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable)
            );
            test_mocks::set_pair_reserves(wnative_addr(), 1_000_000_000_000, 1_000_000_000_000);
            assert_eq!(vault.get_vault_equity(), Ok(add(native_of(contract()), 7)));
        }

        // ── Rodada de correção 1 ───────────────────────────────

        /// Soma do que `to` recebeu de `t` (transfers que moveram saldo).
        fn paid_to(t: AccountId, to: AccountId) -> Balance {
            test_mocks::psp22_transfers()
                .iter()
                .filter(|x| x.0 == t && x.1 == to)
                .map(|x| x.2)
                .sum()
        }

        /// FIX1-M1 (saída): transfer que MOVE o valor mas devolve retorno
        /// não confirmado (decode falho) é tratado como pago — nenhum
        /// crédito pendente fantasma, reserva zerada, nada a resgatar.
        #[ink::test]
        fn test_inkind_exit_unconfirmed_transfer_that_moved_is_paid_once() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_unconfirmed(token_a(), None);
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            let amt = pro_rata(A_BAL, s_c, total);
            let events_before = ink::env::test::recorded_events().count();

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .is_ok());
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(token_a()), 0);
            assert_eq!(test_mocks::psp22_balance(token_a()), sub(A_BAL, amt));
            assert_eq!(paid_to(token_a(), accounts.charlie), amt);
            let settled: Vec<_> = events_since(events_before)
                .into_iter()
                .filter_map(|e| match e {
                    Event::EmergencyTokenSettled(s) if s.token == token_a() => Some(s),
                    _ => None,
                })
                .collect();
            assert_eq!(settled.len(), 1);
            assert_eq!(settled[0].status, 0);
            assert_eq!(settled[0].amount, amt);

            for _ in 0..3 {
                assert_eq!(
                    vault.claim_pending_token(token_a()),
                    Err(VaultError::NothingToClaim)
                );
            }
            assert_eq!(paid_to(token_a(), accounts.charlie), amt);
            assert!(!vault.locked);
        }

        /// FIX1-M1 (claim): com o token movendo e reportando falha, o
        /// claim conta como pago e não pode ser repetido — o total pago
        /// nunca passa do crédito.
        #[ink::test]
        fn test_claim_unconfirmed_transfer_that_moved_is_not_repeatable() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let amt = vault.get_pending_token(token_a(), accounts.charlie);
            assert!(amt > 0);

            test_mocks::set_psp22_transfer_fail(token_a(), false);
            test_mocks::set_psp22_transfer_unconfirmed(token_a(), None);
            let mut claimed: Balance = 0;
            for _ in 0..4 {
                if let Ok(x) = vault.claim_pending_token(token_a()) {
                    claimed = add(claimed, x);
                }
            }
            assert_eq!(claimed, amt);
            assert_eq!(paid_to(token_a(), accounts.charlie), amt);
            assert_eq!(test_mocks::psp22_balance(token_a()), sub(A_BAL, amt));
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(token_a()), 0);
            assert!(!vault.locked);
        }

        /// FIX1-M1: retorno não confirmado e saldo que não bate (nem
        /// inalterado nem `antes − amount`), ou saldo ilegível ⇒ falha
        /// FECHADA com `TransferFailed` (on-chain reverte a mensagem
        /// inteira, inclusive o movimento do token).
        #[ink::test]
        fn test_unconfirmed_transfer_with_unexpected_balance_fails_closed() {
            // Saída: o token move 1 planck e reporta falha.
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_unconfirmed(token_a(), Some(1));
            set_caller(accounts.charlie);
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Err(VaultError::TransferFailed)
            );
            assert!(!vault.locked);
        }

        #[ink::test]
        fn test_claim_unconfirmed_transfer_fails_closed_when_unverifiable() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let amt = vault.get_pending_token(token_a(), accounts.charlie);
            assert!(amt > 0);

            // Move 1 planck e reporta falha: saldo diverge ⇒ Err.
            test_mocks::set_psp22_transfer_fail(token_a(), false);
            test_mocks::set_psp22_transfer_unconfirmed(token_a(), Some(1));
            assert_eq!(
                vault.claim_pending_token(token_a()),
                Err(VaultError::TransferFailed)
            );
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), amt);
            assert_eq!(vault.get_reserved_token(token_a()), amt);
            assert!(!vault.locked);

            // Falha sem saldo legível: não dá para provar que nada saiu.
            test_mocks::clear_psp22_transfer_unconfirmed(token_a());
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            test_mocks::set_psp22_balance_fail(token_a(), true);
            assert_eq!(
                vault.claim_pending_token(token_a()),
                Err(VaultError::TransferFailed)
            );
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), amt);
            assert_eq!(vault.get_reserved_token(token_a()), amt);
            assert!(!vault.locked);
        }

        /// FIX1-M2 (mutante M02b): a reserva de WNATIVE também sai do NAV
        /// e do breakdown.
        #[ink::test]
        fn test_reserved_wnative_excluded_from_equity() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(wnative_addr(), true);
            let total = vault.total_shares;
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let reserved = vault.get_reserved_token(wnative_addr());
            assert_eq!(reserved, pro_rata(W_BAL, s_c, total));
            assert_eq!(test_mocks::psp22_balance(wnative_addr()), W_BAL);

            let w_free = sub(W_BAL, reserved);
            let native = native_of(contract());
            let a = test_mocks::psp22_balance(token_a()); // 1:1
            let b_value = test_mocks::psp22_balance(token_b()) / 2; // 0,5
            let expected = add(add(add(native, w_free), a), b_value);
            assert_eq!(vault.get_vault_equity(), Ok(expected));
            let (_, entries, breakdown_total) = vault.get_equity_breakdown().unwrap();
            assert_eq!(breakdown_total, expected);
            assert!(entries.contains(&(wnative_addr(), w_free, w_free)));
        }

        /// Estado legado wnative == rastreado, montado à mão.
        fn track_wnative_legacy(vault: &mut CopyVault) {
            let idx = vault.tracked_token_count;
            vault.tracked_tokens.insert(idx, &wnative_addr());
            vault.tracked_token_index.insert(wnative_addr(), &idx);
            vault.tracked_token_count = idx.checked_add(1).unwrap();
        }

        /// FIX1-M3 (mutante M18): com wnative também rastreado, um
        /// depositante MINORITÁRIO (os dois transfers caberiam no saldo)
        /// recebe a perna de wnative uma única vez, sem crédito/reserva.
        #[ink::test]
        fn test_inkind_minority_exit_wnative_also_tracked_paid_once() {
            let (mut vault, accounts) = inkind_vault();
            track_wnative_legacy(&mut vault);
            let total = vault.total_shares;
            let s_d = vault.shares.get(accounts.django).unwrap();

            set_caller(accounts.django);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let w: Vec<_> = test_mocks::psp22_transfers()
                .into_iter()
                .filter(|x| x.0 == wnative_addr())
                .collect();
            assert_eq!(
                w,
                vec![(wnative_addr(), accounts.django, pro_rata(W_BAL, s_d, total))]
            );
            assert_eq!(vault.get_pending_token(wnative_addr(), accounts.django), 0);
            assert_eq!(vault.get_reserved_token(wnative_addr()), 0);
        }

        /// FIX1-M4 (mutante M19): o MESMO credor que sai duas vezes com o
        /// token falhando acumula o crédito (soma, não sobrescreve), e a
        /// reserva continua igual ao crédito; o claim paga a soma.
        #[ink::test]
        fn test_inkind_same_creditor_accumulates_pending() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let first = vault.get_pending_token(token_a(), accounts.charlie);
            assert!(first > 0);

            // Redeposita, arma o unlock de novo e sai outra vez.
            set_value(C_DEP);
            set_balance(contract(), add(native_of(contract()), C_DEP));
            vault.deposit().unwrap();
            set_value(0);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            let total = vault.total_shares;
            let s2 = vault.shares.get(accounts.charlie).unwrap();
            let second = pro_rata(sub(A_BAL, first), s2, total);
            assert!(second > 0);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();

            let pending = vault.get_pending_token(token_a(), accounts.charlie);
            assert_eq!(pending, add(first, second));
            assert_eq!(vault.get_reserved_token(token_a()), pending);

            test_mocks::set_psp22_transfer_fail(token_a(), false);
            assert_eq!(vault.claim_pending_token(token_a()), Ok(pending));
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(token_a()), 0);
            assert_eq!(test_mocks::psp22_balance(token_a()), sub(A_BAL, pending));
        }

        /// FIX1-L (mutante M24): a saída de emergência apaga o pedido de
        /// saque grande do caller (redepósito não herda cooldown vencido).
        #[ink::test]
        fn test_inkind_exit_clears_withdrawal_request() {
            let (mut vault, accounts) = inkind_vault();
            set_caller(accounts.charlie);
            let s_c = vault.shares.get(accounts.charlie).unwrap();
            vault.request_withdrawal(s_c).unwrap();
            assert!(vault.get_withdrawal_request(accounts.charlie).is_some());
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            assert_eq!(vault.get_withdrawal_request(accounts.charlie), None);
        }

        /// FIX1-L: dois credores no mesmo token ⇒ reserva == soma dos
        /// créditos (invariante 8); claim com saldo do token menor que o
        /// crédito devolve Ok(0) e mantém tudo.
        #[ink::test]
        fn test_two_pending_creditors_and_short_balance_claim() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            set_caller(accounts.django);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let p_c = vault.get_pending_token(token_a(), accounts.charlie);
            let p_d = vault.get_pending_token(token_a(), accounts.django);
            assert!(p_c > 0 && p_d > 0);
            assert_eq!(vault.get_reserved_token(token_a()), add(p_c, p_d));

            // Token "encolhe" abaixo do crédito de charlie.
            test_mocks::set_psp22_transfer_fail(token_a(), false);
            test_mocks::set_psp22_balance(token_a(), sub(p_c, 1));
            set_caller(accounts.charlie);
            assert_eq!(vault.claim_pending_token(token_a()), Ok(0));
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), p_c);
            assert_eq!(vault.get_reserved_token(token_a()), add(p_c, p_d));

            test_mocks::set_psp22_balance(token_a(), A_BAL);
            assert_eq!(vault.claim_pending_token(token_a()), Ok(p_c));
            assert_eq!(vault.get_reserved_token(token_a()), p_d);
            set_caller(accounts.django);
            assert_eq!(vault.claim_pending_token(token_a()), Ok(p_d));
            assert_eq!(vault.get_reserved_token(token_a()), 0);
        }

        /// FIX1-L: get_token_valuation usa o saldo LIVRE, como o equity.
        #[ink::test]
        fn test_get_token_valuation_uses_free_balance() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            set_caller(accounts.charlie);
            vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .unwrap();
            let reserved = vault.get_reserved_token(token_a());
            assert!(reserved > 0);
            // tA cotado 1:1.
            assert_eq!(
                vault.get_token_valuation(token_a()),
                Ok(sub(A_BAL, reserved))
            );
        }

        /// FIX1-L: estado legado wnative == rastreado — o NAV conta o
        /// wnative uma vez só (1:1), como a saída in-kind paga uma vez.
        #[ink::test]
        fn test_equity_counts_wnative_once_when_also_tracked() {
            let (mut vault, _) = inkind_vault();
            let expected = add(add(add(native_of(contract()), W_BAL), A_BAL), B_BAL / 2);
            assert_eq!(vault.get_vault_equity(), Ok(expected));
            track_wnative_legacy(&mut vault);
            assert_eq!(vault.get_vault_equity(), Ok(expected));
            let (_, entries, total) = vault.get_equity_breakdown().unwrap();
            assert_eq!(total, expected);
            assert_eq!(entries.iter().filter(|e| e.0 == wnative_addr()).count(), 1);
        }

        /// FIX1-L (D3): troca com saldo (1 planck basta) e SEM par
        /// antigo↔novo na factory nova: NAV, depósito e des-rastreio
        /// ficam fechados; a saída in-kind segue funcionando.
        #[ink::test]
        fn test_wnative_rotation_with_balance_without_pair() {
            let (mut vault, accounts) = d3_vault(&[]);
            test_mocks::set_psp22_balance(wnative_addr(), 1);
            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.get_tracked_tokens(), vec![wnative_addr()]);
            assert_eq!(
                vault.get_vault_equity(),
                Err(VaultError::ValuationUnavailable)
            );
            set_caller(accounts.alice);
            assert_eq!(
                vault.remove_tracked_token(wnative_addr()),
                Err(VaultError::TokenHasBalance)
            );
            set_caller(accounts.django);
            set_value(D_DEP);
            set_balance(contract(), add(native_of(contract()), D_DEP));
            assert_eq!(vault.deposit(), Err(VaultError::ValuationUnavailable));
            set_value(0);
            set_balance(contract(), C_DEP);

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            let s = vault.shares.get(accounts.charlie).unwrap();
            let total = vault.total_shares;
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(Vec::new()),
                Ok(pro_rata(sub(C_DEP, ed()), s, total))
            );
        }

        /// FIX1-L: o preço da cota de quem fica não cai após saída in-kind
        /// paga, pendente e com skip (eq1·t0 >= eq0·t1).
        #[ink::test]
        fn test_inkind_exit_never_lowers_remaining_share_price() {
            let (mut vault, accounts) = inkind_vault();
            // Terceiro depositante para sobrar alguém depois de duas saídas.
            set_caller(accounts.eve);
            set_value(D_DEP);
            set_balance(contract(), add(native_of(contract()), D_DEP));
            vault.deposit().unwrap();
            set_value(0);

            let price_ok = |eq0: Balance, t0: Balance, eq1: Balance, t1: Balance| {
                eq1.checked_mul(t0).unwrap() >= eq0.checked_mul(t1).unwrap()
            };
            // charlie: tA pendente, tB em skip; django: tudo pago.
            test_mocks::set_psp22_transfer_fail(token_a(), true);
            for (who, skip) in [
                (accounts.charlie, vec![token_b()]),
                (accounts.django, Vec::new()),
            ] {
                if who == accounts.django {
                    test_mocks::set_psp22_transfer_fail(token_a(), false);
                }
                let eq0 = vault.get_vault_equity().unwrap();
                let t0 = vault.total_shares;
                set_caller(who);
                vault.execute_emergency_withdrawal_in_kind(skip).unwrap();
                let eq1 = vault.get_vault_equity().unwrap();
                let t1 = vault.total_shares;
                assert!(
                    price_ok(eq0, t0, eq1, t1),
                    "cota caiu: {eq0}/{t0} -> {eq1}/{t1}"
                );
            }
        }

        /// FIX1-L (CV-FEE-01, números ímpares): em parciais, cada custo é
        /// o PISO de basis·s/cotas, a base remanescente é a diferença
        /// exata, a soma dos custos fecha na base e cada taxa é
        /// bps × (payout − custo).
        #[ink::test]
        fn test_fee_odd_partials_cost_is_floor_and_sums_to_basis() {
            let (mut vault, accounts) = vault_with_single_depositor();
            let contract_id = contract();
            set_balance(contract_id, 150_000_000_007);
            set_caller(accounts.django);
            set_value(33_333_333_331);
            set_balance(contract_id, 183_333_333_338);
            vault.deposit().unwrap();
            set_value(0);
            let basis = vault.cost_basis.get(accounts.django).unwrap();
            assert_eq!(basis, 33_333_333_331);
            // Preço sobe para um NAV ímpar.
            set_balance(contract_id, 300_000_000_011);

            let mut cost_sum: Balance = 0;
            let parts = [5_000_000_003, 4_999_999_999, 7_777_777_777];
            for part in parts {
                let cs = vault.shares.get(accounts.django).unwrap();
                let b = vault.cost_basis.get(accounts.django).unwrap();
                let cost = pro_rata(b, part, cs);
                let fees_before = vault.total_fees_collected;
                let net = vault.withdraw(part).unwrap();
                let fee = sub(vault.total_fees_collected, fees_before);
                let payout = add(net, fee);
                let expected_fee = sub(payout, cost)
                    .checked_mul(vault.performance_fee_bps as u128)
                    .and_then(|x| x.checked_div(constants::BPS as u128))
                    .unwrap();
                assert_eq!(fee, expected_fee);
                assert_eq!(vault.cost_basis.get(accounts.django), Some(sub(b, cost)));
                cost_sum = add(cost_sum, cost);
            }
            // Último saque leva o resto: custo == base remanescente.
            let rest = vault.shares.get(accounts.django).unwrap();
            let b = vault.cost_basis.get(accounts.django).unwrap();
            let unlock_at = vault.request_withdrawal(rest).unwrap();
            set_now(unlock_at);
            vault.withdraw(rest).unwrap();
            cost_sum = add(cost_sum, b);
            assert_eq!(cost_sum, basis);
            assert_eq!(vault.cost_basis.get(accounts.django), None);
        }

        /// FIX1-L: domínio de `mul_div_floor` na saída (`s <= total <
        /// 2^64`): nem o maior saldo possível estoura, porque `r·s <
        /// total² < 2^128`. Fora do domínio (`r·b >= 2^128`) a falha é
        /// fechada (`Overflow`), nunca um valor truncado.
        #[ink::test]
        fn test_mul_div_floor_share_domain_never_overflows() {
            // d = 2^64 − 1 e u128::MAX = d · (2^64 + 1).
            let d = u128::from(u64::MAX);
            let two64 = 1u128 << 64;
            assert_eq!(CopyVault::mul_div_floor(u128::MAX, d, d), Ok(u128::MAX));
            assert_eq!(CopyVault::mul_div_floor(u128::MAX, 1, d), Ok(add(two64, 1)));
            // (2^64 + 1)(2^64 − 2) = 2^128 − 2^64 − 2.
            assert_eq!(
                CopyVault::mul_div_floor(u128::MAX, sub(d, 1), d),
                Ok(sub(sub(u128::MAX, two64), 1))
            );
            // a = 2^64·d + (d − 1), resto máximo: piso = 2^128 − 2^64 − 3.
            assert_eq!(
                CopyVault::mul_div_floor(sub(u128::MAX, 1), sub(d, 1), d),
                Ok(sub(sub(u128::MAX, two64), 2))
            );
            // Varredura: sempre Ok, nunca acima de `a`, monótono em `s`
            // e `s == d` devolve `a`.
            let third = d.checked_div(3).unwrap();
            for a in [
                u128::MAX,
                sub(u128::MAX, 1),
                add(1u128 << 127, 12_345),
                add(two64, 7),
            ] {
                let mut prev: Balance = 0;
                for s in [1, 2, 1_000, third, sub(d, 1), d] {
                    let got = CopyVault::mul_div_floor(a, s, d).unwrap();
                    assert!(got <= a);
                    assert!(got >= prev);
                    prev = got;
                }
                assert_eq!(prev, a);
            }
            // Fora do domínio: d = 2^127, a = d − 1 (q = 0, r = a), b = 4
            // ⇒ r·b >= 2^128. O valor real (3) caberia; falha fechada.
            let big = 1u128 << 127;
            assert_eq!(
                CopyVault::mul_div_floor(sub(big, 1), 4, big),
                Err(VaultError::Overflow)
            );
        }

        /// FIX1-L: token com saldo gigante (u128::MAX) não derruba a
        /// saída com `Overflow` no domínio suportado: a prévia traz o
        /// valor e a saída paga o piso exato, uma vez.
        #[ink::test]
        fn test_inkind_exit_with_giant_token_balance_does_not_overflow() {
            let (mut vault, accounts) = inkind_vault();
            test_mocks::set_psp22_balance(token_a(), u128::MAX);
            let s = vault.shares.get(accounts.charlie).unwrap();
            let total = vault.total_shares;
            // Oráculo: u128::MAX = q·total + r ⇒ piso = q·s + piso(r·s/total).
            let q = u128::MAX.checked_div(total).unwrap();
            let r = u128::MAX.checked_rem(total).unwrap();
            let expected = add(q.checked_mul(s).unwrap(), pro_rata(r, s, total));

            let (_, legs) = vault.preview_emergency_exit(accounts.charlie);
            assert!(legs.contains(&(token_a(), Some(expected))));

            set_caller(accounts.charlie);
            assert!(vault
                .execute_emergency_withdrawal_in_kind(Vec::new())
                .is_ok());
            assert_eq!(paid_to(token_a(), accounts.charlie), expected);
            assert_eq!(
                test_mocks::psp22_balance(token_a()),
                sub(u128::MAX, expected)
            );
            assert_eq!(vault.get_pending_token(token_a(), accounts.charlie), 0);
            assert_eq!(vault.get_reserved_token(token_a()), 0);
        }

        /// FIX1-L: todos saem pulando o mesmo ativo. O ativo pulado fica
        /// inteiro no vault, livre, lastreando só as MINIMUM_SHARES dead
        /// shares (ninguém o resgata). O próximo depositante entra pelo
        /// NAV: recebe poucas cotas de preço alto e não perde mais que o
        /// arredondamento de uma cota.
        #[ink::test]
        fn test_all_depositors_skip_same_token_value_stays_with_dead_shares() {
            let (mut vault, accounts) = inkind_vault();
            for who in [accounts.charlie, accounts.django] {
                set_caller(who);
                vault
                    .execute_emergency_withdrawal_in_kind(vec![token_b()])
                    .unwrap();
            }
            assert_eq!(vault.total_shares, constants::MINIMUM_SHARES);
            assert_eq!(vault.active_depositors, 0);
            assert_eq!(test_mocks::psp22_balance(token_b()), B_BAL);
            assert_eq!(vault.get_reserved_token(token_b()), 0);
            for who in [accounts.charlie, accounts.django] {
                assert_eq!(paid_to(token_b(), who), 0);
                assert_eq!(vault.get_pending_token(token_b(), who), 0);
            }
            // tB vale 0,5: o valor pulado segue inteiro no NAV.
            let eq0 = vault.get_vault_equity().unwrap();
            assert!(eq0 >= B_BAL.checked_div(2).unwrap());

            set_caller(accounts.eve);
            set_value(D_DEP);
            set_balance(contract(), add(native_of(contract()), D_DEP));
            let minted = vault.deposit().unwrap();
            set_value(0);
            assert_eq!(minted, pro_rata(D_DEP, constants::MINIMUM_SHARES, eq0));
            let eq1 = vault.get_vault_equity().unwrap();
            assert_eq!(eq1, add(eq0, D_DEP));
            let total1 = vault.total_shares;
            let value = pro_rata(minted, eq1, total1);
            let share_price = eq1.checked_div(total1).unwrap();
            assert!(value <= D_DEP);
            assert!(sub(D_DEP, value) <= add(share_price, 1));
        }

        /// FIX1-L (D3): duas rotações de wnative com saldo e lista cheia.
        /// A lista chega a MAX_TRACKED_TOKENS + 2 — não há teto rígido,
        /// cada rotação custa admin + timelock —, o limite da skip list
        /// acompanha (`count + 1`) e a saída in-kind paga os dois
        /// wnatives antigos.
        #[ink::test]
        fn test_two_wnative_rotations_grow_list_and_exit_still_pays() {
            const W2_BAL: Balance = 5_000_000_000;
            let full: Vec<AccountId> = (0..constants::MAX_TRACKED_TOKENS)
                .map(|i| token_at(0x10, i))
                .collect();
            let (mut vault, accounts) = d3_vault(&full);
            set_caller(accounts.alice);
            for t in &full {
                test_mocks::set_pair_reserves(*t, 1_000_000_000_000, 1_000_000_000_000);
                vault.add_tracked_token(*t).unwrap();
            }
            test_mocks::set_psp22_balance(wnative_addr(), W_BAL);
            propose_and_apply_new_infra(&mut vault);
            assert_eq!(vault.tracked_token_count, constants::MAX_TRACKED_TOKENS + 1);

            test_mocks::set_psp22_balance(new_wnative(), W2_BAL);
            set_caller(accounts.alice);
            let eta = vault
                .propose_valuation_infra(token(0xF3), token(0xF4))
                .unwrap();
            set_now(eta);
            assert_eq!(vault.apply_valuation_infra(), Ok(()));
            assert_eq!(vault.tracked_token_count, constants::MAX_TRACKED_TOKENS + 2);
            assert!(vault.is_tracked(wnative_addr()));
            assert!(vault.is_tracked(new_wnative()));

            set_caller(accounts.charlie);
            let unlock_at = vault.request_emergency_withdrawal().unwrap();
            set_now(unlock_at);
            let s = vault.shares.get(accounts.charlie).unwrap();
            let total = vault.total_shares;
            // wnative atual + 10 rastreados = 11 ativos na prévia.
            assert_eq!(vault.preview_emergency_exit(accounts.charlie).1.len(), 11);
            // Limite da skip list = count (10) + 1.
            assert_eq!(
                vault.execute_emergency_withdrawal_in_kind(junk_tokens(12)),
                Err(VaultError::InvalidSkipList)
            );
            assert!(vault
                .execute_emergency_withdrawal_in_kind(junk_tokens(11))
                .is_ok());
            assert_eq!(
                paid_to(wnative_addr(), accounts.charlie),
                pro_rata(W_BAL, s, total)
            );
            assert_eq!(
                paid_to(new_wnative(), accounts.charlie),
                pro_rata(W2_BAL, s, total)
            );
        }
    }
}
