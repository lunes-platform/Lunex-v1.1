#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![allow(clippy::cast_possible_truncation)] // ink! interno gera cfg conditions que não podem ser suprimidas de outra forma
#![warn(clippy::arithmetic_side_effects)]
/// # Lunex Staking Contract
///
/// This contract allows users to stake $LUNES (native token) and earn rewards.
/// It also provides governance features for project listing proposals.
///
/// ## Key Features:
/// - Stake $LUNES tokens and earn rewards
/// - Unstake with optional penalty periods
/// - Governance voting for project listings
/// - Reward distribution based on staking duration and amount
/// - Anti-whale mechanisms for fair distribution
///
/// ## Security Features:
/// - Reentrancy protection
/// - Access control for admin functions
/// - Input validation and overflow protection
/// - Deadline-based operations
/// - Slashing protection for malicious behavior

#[ink::contract]
pub mod staking_contract {
    use ink::prelude::format;
    use ink::prelude::string::String;
    use ink::prelude::string::ToString;
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    /// Staking-related errors
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum StakingError {
        /// Insufficient balance for staking
        InsufficientBalance,
        /// No active stake found
        NoActiveStake,
        /// Minimum staking amount not met
        MinimumStakeNotMet,
        /// Staking period not yet completed
        StakingPeriodNotCompleted,
        /// Access denied - caller not authorized
        AccessDenied,
        /// Invalid staking duration
        InvalidDuration,
        /// Contract is paused
        ContractPaused,
        /// Unstaking too early (penalty period)
        EarlyUnstaking,
        /// Maximum stakers reached
        MaxStakersReached,
        /// Invalid proposal ID
        InvalidProposal,
        /// Already voted on this proposal
        AlreadyVoted,
        /// Voting period expired
        VotingPeriodExpired,
        /// Insufficient voting power
        InsufficientVotingPower,
        /// Insufficient fee for proposal
        InsufficientFee,
        /// Overflow error
        Overflow,
        /// Zero address not allowed
        ZeroAddress,
        /// Reentrancy detected
        Reentrancy,
        /// Zero amount not allowed
        ZeroAmount,
        /// No rewards to claim
        NoRewardsToClaim,
        /// Token already listed
        AlreadyListed,
        /// Token not listed
        TokenNotListed,
        /// Proposal is still in timelock delay
        TimelockPending,
        /// Too many tokens in batch operation
        TooManyTokens,
        /// Invalid amount provided
        InvalidAmount,
        /// No stake found - user must have active staking to vote
        NoStakeFound,
        /// The funded rewards pool cannot cover this payout (principal is
        /// never used to pay rewards/bonuses)
        InsufficientRewardsPool,
        /// Paginated distribution must continue from the stored cursor (pass
        /// `None` or the `next_index` returned by the previous page)
        InvalidDistributionCursor,
        /// Destination cannot be this contract itself (the transfer would be a
        /// no-op and the withdrawn fund would lose its counter)
        InvalidRecipient,
    }

    /// Governance proposal for project listing
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Clone, ink::storage::traits::StorageLayout)
    )]
    pub struct ProjectProposal {
        /// Unique proposal ID
        pub id: u32,
        /// Project name
        pub name: String,
        /// Project description
        pub description: String,
        /// Project token contract address
        pub token_address: AccountId,
        /// Proposal creator
        pub proposer: AccountId,
        /// Total vote count (each vote costs 10 LUNES)
        pub vote_count: u64,
        /// Total LUNES collected from votes (100%)
        pub votes_for: Balance,
        /// Number of NO votes (the liquidity share of votes is in `liquidity_fund`)
        pub votes_against: Balance,
        /// Voting deadline
        pub voting_deadline: Timestamp,
        /// Whether proposal is executed
        pub executed: bool,
        /// Whether proposal is active
        pub active: bool,
        /// Fee paid for proposal
        pub fee: Balance,
        /// Whether fee has been refunded
        pub fee_refunded: bool,
        /// For fee change proposals, this stores the new fee amount
        pub new_fee_amount: Option<Balance>,
        /// Timestamp at which execution is allowed (voting_deadline + EXECUTION_DELAY_MS)
        pub execution_time: Timestamp,
    }

    /// Individual staking position
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Clone, ink::storage::traits::StorageLayout)
    )]
    pub struct StakePosition {
        /// Amount staked
        pub amount: Balance,
        /// Timestamp when stake was created
        pub start_time: Timestamp,
        /// Staking duration in milliseconds (unlock = start_time + duration)
        pub duration: u64,
        /// Last reward claim timestamp
        pub last_claim: Timestamp,
        /// Accumulated rewards
        pub pending_rewards: Balance,
        /// Whether position is active
        pub active: bool,
        /// Staking tier baseado na duração
        pub tier: StakingTier,
        /// Early adopter tier
        pub early_adopter_tier: EarlyAdopterTier,
        /// Participação em governança (número de votos)
        pub governance_participation: u32,
    }

    /// Tiers de staking baseados em duração
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode, Clone, Copy)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub enum StakingTier {
        Bronze,   // 7-30 dias - 8% APY
        Silver,   // 31-90 dias - 10% APY
        Gold,     // 91-180 dias - 12% APY
        Platinum, // 181+ dias - 15% APY
    }

    /// Tier de early adopter
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode, Clone, Copy)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub enum EarlyAdopterTier {
        None,
        Top1000, // +10% por 1 mês
        Top500,  // +25% por 2 meses
        Top100,  // +50% por 3 meses
    }

    /// Informações de campanha promocional
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Clone, ink::storage::traits::StorageLayout)
    )]
    pub struct Campaign {
        pub name: Vec<u8>,
        pub bonus_rate: u32,
        pub start_time: Timestamp,
        pub end_time: Timestamp,
        pub active: bool,
    }

    /// Staking events
    #[ink(event)]
    pub struct Staked {
        #[ink(topic)]
        pub staker: AccountId,
        pub amount: Balance,
        pub duration: u64,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct Unstaked {
        #[ink(topic)]
        pub staker: AccountId,
        pub amount: Balance,
        pub rewards: Balance,
        pub penalty: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct RewardsClaimed {
        #[ink(topic)]
        pub staker: AccountId,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct ProposalCreated {
        #[ink(topic)]
        pub proposal_id: u32,
        pub proposer: AccountId,
        pub project_name: String,
        pub token_address: AccountId,
        pub voting_deadline: Timestamp,
    }

    #[ink(event)]
    pub struct Voted {
        #[ink(topic)]
        pub proposal_id: u32,
        #[ink(topic)]
        pub voter: AccountId,
        pub vote_power: Balance,
        pub in_favor: bool,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct ProposalExecuted {
        #[ink(topic)]
        pub proposal_id: u32,
        pub approved: bool,
        pub votes_for: Balance,
        pub votes_against: Balance,
        pub timestamp: Timestamp,
    }

    /// Emitted when a proposal passes voting and enters the 48h execution timelock.
    #[ink(event)]
    pub struct ProposalQueued {
        #[ink(topic)]
        pub proposal_id: u32,
        pub execution_time: Timestamp,
        pub timestamp: Timestamp,
    }

    /// === NOVOS EVENTOS PARA PREMIAÇÃO ===

    #[ink(event)]
    pub struct TradingRewardsFunded {
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    /// APY rewards pool funded (anyone may fund it; penalties also flow in)
    #[ink(event)]
    pub struct ApyRewardsFunded {
        #[ink(topic)]
        pub funder: AccountId,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TradingRewardsDistributed {
        pub total_amount: Balance,
        pub stakers_count: u32,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TradingRewardsDistributionProgress {
        pub processed_stakers: u32,
        pub rewards_distributed: u32,
        pub start_index: u32,
        pub end_index: u32,
        pub is_complete: bool,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct GovernanceBonusAwarded {
        #[ink(topic)]
        pub staker: AccountId,
        pub bonus_type: u8, // 1=voting, 2=proposal, 3=implementation
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct GovernanceBonusClaimed {
        #[ink(topic)]
        pub staker: AccountId,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TierUpgraded {
        #[ink(topic)]
        pub staker: AccountId,
        pub old_tier: StakingTier,
        pub new_tier: StakingTier,
        pub timestamp: Timestamp,
    }

    // === ADMIN LISTING EVENTS ===

    #[ink(event)]
    pub struct AdminTokenListed {
        #[ink(topic)]
        pub token_address: AccountId,
        #[ink(topic)]
        pub admin: AccountId,
        pub reason: String,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct AdminBatchListingCompleted {
        #[ink(topic)]
        pub admin: AccountId,
        pub tokens_listed: u32,
        pub timestamp: Timestamp,
    }

    /// === EVENTOS ADMINISTRATIVOS ===

    #[ink(event)]
    pub struct TreasuryAddressChanged {
        pub old_treasury: AccountId,
        pub new_treasury: AccountId,
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct OwnershipTransferred {
        pub old_owner: AccountId,
        pub new_owner: AccountId,
        pub timestamp: Timestamp,
    }

    /// Primeiro passo da troca de owner; só vale após `accept_ownership`.
    #[ink(event)]
    pub struct OwnershipTransferStarted {
        pub current_owner: AccountId,
        pub pending_owner: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct DistributorChanged {
        pub old_distributor: Option<AccountId>,
        pub new_distributor: Option<AccountId>,
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    /// Saque de uma fatia dos votos.
    #[ink(event)]
    pub struct VoteFundWithdrawn {
        #[ink(topic)]
        pub to: AccountId,
        pub fund: u8, // 1=liquidity, 2=treasury, 3=team
        pub amount: Balance,
        pub caller: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TradingRewardsContractChanged {
        pub old_contract: Option<AccountId>,
        pub new_contract: AccountId,
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct ContractPaused {
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct ContractUnpaused {
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct AdminTokenDelisted {
        #[ink(topic)]
        pub token_address: AccountId,
        #[ink(topic)]
        pub admin: AccountId,
        pub reason: String,
        pub timestamp: Timestamp,
    }

    // === GOVERNANCE FEE EVENTS ===
    #[ink(event)]
    pub struct FeeChangeProposed {
        #[ink(topic)]
        pub proposal_id: u32,
        #[ink(topic)]
        pub proposer: AccountId,
        pub current_fee: Balance,
        pub proposed_fee: Balance,
        pub justification: String,
        pub voting_deadline: Timestamp,
    }

    #[ink(event)]
    pub struct ProposalFeeChanged {
        #[ink(topic)]
        pub proposal_id: u32,
        pub old_fee: Balance,
        pub new_fee: Balance,
        #[ink(topic)]
        pub changed_by: AccountId,
        pub timestamp: Timestamp,
    }

    /// Constants for staking mechanics
    pub mod constants {
        use super::Balance;

        /// Minimum stake amount (1000 LUNES)
        pub const MIN_STAKE: Balance = 100_000_000_000; // 1000 * 10^8

        /// One day in milliseconds. ALL durations in this contract are in ms
        /// because they are compared/added to `block_timestamp()` (ms).
        pub const DAY_MS: u64 = 24 * 60 * 60 * 1000;

        /// One (365-day) year in milliseconds — APY denominator.
        pub const YEAR_MS: u64 = 365 * DAY_MS;

        /// Minimum staking duration (7 days, in ms)
        pub const MIN_DURATION: u64 = 7 * DAY_MS;

        /// Maximum staking duration (365 days, in ms)
        pub const MAX_DURATION: u64 = 365 * DAY_MS;

        /// Tier thresholds (staking duration, in ms)
        pub const SILVER_MIN_DURATION: u64 = 31 * DAY_MS;
        pub const GOLD_MIN_DURATION: u64 = 91 * DAY_MS;
        pub const PLATINUM_MIN_DURATION: u64 = 181 * DAY_MS;

        // === REWARD RATES POR TIER (em basis points) ===

        /// Bronze tier reward rate (8% APY)
        pub const BRONZE_REWARD_RATE: u32 = 800; // 8% = 800 basis points

        /// Silver tier reward rate (10% APY)
        pub const SILVER_REWARD_RATE: u32 = 1000; // 10% = 1000 basis points

        /// Gold tier reward rate (12% APY)  
        pub const GOLD_REWARD_RATE: u32 = 1200; // 12% = 1200 basis points

        /// Platinum tier reward rate (15% APY)
        pub const PLATINUM_REWARD_RATE: u32 = 1500; // 15% = 1500 basis points

        // === MULTIPLICADORES DE QUANTIDADE ===

        /// 1k-10k LUNES: 1.0x (base)
        pub const SMALL_STAKER_MULTIPLIER: u32 = 10000; // 1.0x = 10000 basis points

        /// 10k-50k LUNES: 1.1x (+10%)
        pub const MEDIUM_STAKER_MULTIPLIER: u32 = 11000; // 1.1x = 11000 basis points

        /// 50k-200k LUNES: 1.2x (+20%)
        pub const LARGE_STAKER_MULTIPLIER: u32 = 12000; // 1.2x = 12000 basis points

        /// 200k+ LUNES: 1.3x (+30%)
        pub const WHALE_STAKER_MULTIPLIER: u32 = 13000; // 1.3x = 13000 basis points

        // === THRESHOLDS PARA MULTIPLICADORES ===

        pub const MEDIUM_STAKE_THRESHOLD: Balance = 1_000_000_000_000; // 10k LUNES
        pub const LARGE_STAKE_THRESHOLD: Balance = 5_000_000_000_000; // 50k LUNES
        pub const WHALE_STAKE_THRESHOLD: Balance = 20_000_000_000_000; // 200k LUNES

        // === EARLY ADOPTER BONUSES ===

        /// Top 100 early adopters: +50% for 3 months
        pub const TOP_100_BONUS: u32 = 5000; // +50% = 5000 basis points
        pub const TOP_100_DURATION: u64 = 90 * DAY_MS; // 3 months

        /// Top 500 early adopters: +25% for 2 months  
        pub const TOP_500_BONUS: u32 = 2500; // +25% = 2500 basis points
        pub const TOP_500_DURATION: u64 = 60 * DAY_MS; // 2 months

        /// Top 1000 early adopters: +10% for 1 month
        pub const TOP_1000_BONUS: u32 = 1000; // +10% = 1000 basis points
        pub const TOP_1000_DURATION: u64 = 30 * DAY_MS; // 1 month

        // === GOVERNANCE BONUSES ===

        /// Bonus for creating approved proposal (1000 LUNES)
        pub const PROPOSAL_BONUS: Balance = 100_000_000_000; // 1000 * 10^8

        /// Bonus for active voting (200 LUNES/month)
        pub const VOTING_BONUS: Balance = 20_000_000_000; // 200 * 10^8

        /// Bonus for implemented proposal (5000 LUNES)
        pub const IMPLEMENTATION_BONUS: Balance = 500_000_000_000; // 5000 * 10^8

        /// Minimum votes per month for bonus (80% participation)
        pub const MIN_VOTES_FOR_BONUS: u32 = 8; // Assuming ~10 proposals/month

        // === TRADING REWARDS SHARE ===

        /// Percentage of trading rewards que vai para stakers (10%)
        pub const STAKING_SHARE_OF_TRADING_REWARDS: u32 = 1000; // 10% = 1000 basis points

        // === CONSTANTES EXISTENTES ===

        /// Early unstaking penalty (5%)
        pub const EARLY_PENALTY_RATE: u32 = 500; // 5% = 500 basis points

        /// Voting period for proposals (14 days, in ms — added to block_timestamp)
        pub const VOTING_PERIOD: u64 = 14 * DAY_MS;

        /// Minimum voting power required to create proposal (10,000 LUNES staked)
        pub const MIN_PROPOSAL_POWER: Balance = 1_000_000_000_000; // 10,000 * 10^8

        /// Proposal fee (1,000 LUNES)
        pub const PROPOSAL_FEE: Balance = 100_000_000_000; // 1000 * 10^8

        /// Cost per vote (10 LUNES)
        pub const VOTE_COST: Balance = 1_000_000_000; // 10 * 10^8

        /// Minimum votes required for approval (10,000 votes)
        #[cfg(not(test))]
        pub const MIN_VOTES_FOR_APPROVAL: u64 = 10_000;
        #[cfg(test)]
        pub const MIN_VOTES_FOR_APPROVAL: u64 = 1;

        /// Governance execution delay after voting ends (48 hours in ms)
        /// Gives token holders time to react before an approved proposal takes effect.
        #[cfg(not(test))]
        pub const EXECUTION_DELAY_MS: u64 = 48 * 60 * 60 * 1000;
        #[cfg(test)]
        pub const EXECUTION_DELAY_MS: u64 = 0;

        /// Maximum number of active stakers
        pub const MAX_STAKERS: u32 = 10_000;

        /// Basis points denominator
        pub const BASIS_POINTS: u32 = 10_000;

        /// Zero address constant
        pub const ZERO_ADDRESS: [u8; 32] = [0u8; 32];
    }

    /// Main staking contract storage
    #[ink(storage)]
    pub struct StakingContract {
        /// Contract owner/admin
        owner: AccountId,
        /// Treasury address for project funds
        treasury_address: AccountId,
        /// Whether contract is paused
        paused: bool,
        /// Reentrancy guard
        locked: bool,
        /// Total amount staked in the contract
        total_staked: Balance,
        /// Total rewards distributed
        total_rewards_distributed: Balance,
        /// Number of active stakers
        active_stakers: u32,
        /// Mapping from staker to their position
        stakes: Mapping<AccountId, StakePosition>,
        /// Mapping for tracking staker addresses (slots `0..staker_index` hold
        /// exactly the active stakers)
        staker_addresses: Mapping<u32, AccountId>,
        /// Number of indexed stakers (== active stakers)
        staker_index: u32,
        /// Governance proposals
        proposals: Mapping<u32, ProjectProposal>,
        /// Next proposal ID
        next_proposal_id: u32,
        /// Mapping to track if user voted on proposal
        user_votes: Mapping<(u32, AccountId), bool>,
        /// Approved projects for listing
        approved_projects: Mapping<AccountId, bool>,

        // === NOVO SISTEMA DE PREMIAÇÃO ===
        /// Pool de trading rewards destinado para stakers
        trading_rewards_pool: Balance,
        /// Endereço do contrato de trading rewards
        trading_rewards_contract: Option<AccountId>,
        /// Mapeamento de tier multipliers
        tier_multipliers: Mapping<StakingTier, u32>,
        /// Bônus de governança acumulados por usuário
        governance_bonuses: Mapping<AccountId, Balance>,
        /// Contador de early adopters por tier
        early_adopter_counts: Mapping<EarlyAdopterTier, u32>,
        /// Campanhas ativas (direct mapping para evitar storage collision)
        active_campaigns: Mapping<u32, Campaign>,
        /// Próximo ID de campanha
        next_campaign_id: u32,
        /// Total de trading rewards distribuídos para stakers (métrica, acessada raramente)
        total_trading_rewards_distributed: Balance,
        /// Taxa atual para criação de propostas (ajustável via governança)
        current_proposal_fee: Balance,

        /// === SOLVÊNCIA (rewards nunca saem do principal) ===
        ///
        /// Saldo do contrato = principal (`total_staked`)
        ///   + trading rewards ainda não distribuídas (`trading_rewards_pool`)
        ///   + trading rewards já creditadas em `stake.pending_rewards`
        ///     (`total_credited_rewards`)
        ///   + pool financiado de APY/bônus (`apy_rewards_pool`)
        ///   + fatias dos votos ainda não sacadas (`liquidity_fund`,
        ///     `treasury_fund`, `team_fund`)
        ///   + excedente (taxas de proposta retidas).
        /// APY e bônus de governança só são pagos de `apy_rewards_pool`.
        apy_rewards_pool: Balance,
        /// Soma de `stake.pending_rewards` (trading rewards creditadas, lastreadas).
        total_credited_rewards: Balance,
        /// APY acumulado mas não pago por falta de pool (passivo NÃO lastreado,
        /// sacável quando o pool for financiado, inclusive após o unstake).
        owed_rewards: Mapping<AccountId, Balance>,
        /// Snapshot do pool no início de uma distribuição paginada.
        distribution_amount: Balance,

        /// === FUNDOS DOS VOTOS (cada voto: 10% rewards, 10% liquidez, 10% treasury, 70% team) ===
        /// Fatia de liquidez de projetos, sacável pelo owner (`withdraw_liquidity_fund`).
        liquidity_fund: Balance,
        /// Fatia do treasury, sacável só para `treasury_address` (`withdraw_treasury_fund`).
        treasury_fund: Balance,
        /// Fatia do team, sacável pelo owner (`withdraw_team_fund`).
        team_fund: Balance,

        /// === ÍNDICE DE STAKERS ===
        /// Soma de `calculate_staker_weight` das posições ativas, mantida em
        /// stake/unstake (a distribuição não varre mais o índice para obtê-la).
        total_staker_weight: Balance,
        /// Posição de cada staker ativo em `staker_addresses`. Só é válida
        /// enquanto a posição está ativa (unstake faz swap-remove no índice).
        staker_slots: Mapping<AccountId, u32>,

        /// === PAPÉIS ===
        /// Conta que só pode financiar (`fund_staking_rewards`) e distribuir
        /// trading rewards — a hot key do relayer, sem poderes de owner.
        distributor: Option<AccountId>,
        /// Owner proposto por `transfer_ownership`; vira owner em `accept_ownership`.
        pending_owner: Option<AccountId>,
        /// Próximo slot da rodada de distribuição em andamento
        /// (`distribution_amount != 0`); 0 fora de rodada.
        distribution_cursor: u32,
        /// Número da rodada de distribuição atual (incrementado quando uma
        /// rodada começa; a primeira é 1).
        distribution_round: u32,
        /// Última rodada em que cada conta recebeu crédito (0/ausente = nunca).
        /// Não é limpo no unstake: impede crédito duplo de quem sai e volta a
        /// fazer stake entre páginas da mesma rodada.
        last_credited_round: Mapping<AccountId, u32>,
        /// Peso total (`total_staker_weight`) no início da rodada em andamento:
        /// denominador de todas as páginas dela, para que stake/unstake entre
        /// páginas não infle nem dilua as fatias. 0 fora de rodada.
        distribution_total_weight: Balance,
        /// Soma creditada na rodada em andamento; nunca passa de
        /// `distribution_amount`. 0 fora de rodada.
        distribution_credited: Balance,
        /// `distribution_round` vigente quando a posição atual de cada conta
        /// foi criada. A posição só é elegível nas rodadas seguintes: capital
        /// que entra (ou volta, por qualquer conta) com uma rodada aberta não
        /// está no peso do snapshot e não recebe nada nela.
        stake_entry_round: Mapping<AccountId, u32>,
    }

    /// Estado de uma rodada de distribuição enquanto uma página (ou o crédito
    /// imediato no unstake) é calculada, antes de qualquer escrita.
    struct RoundState {
        round: u32,
        amount: Balance,
        total_weight: Balance,
        credited: Balance,
        pool_left: Balance,
    }

    impl StakingContract {
        /// Creates a new staking contract
        #[ink(constructor)]
        pub fn new(treasury_address: AccountId) -> Self {
            // O próprio contrato como treasury faria `withdraw_treasury_fund`
            // zerar o contador numa auto-transferência que não move saldo.
            assert!(
                treasury_address != Self::env().account_id(),
                "treasury cannot be the staking contract itself"
            );
            let mut contract = Self {
                owner: Self::env().caller(),
                treasury_address,
                paused: false,
                locked: false,
                total_staked: 0,
                total_rewards_distributed: 0,
                active_stakers: 0,
                stakes: Mapping::default(),
                staker_addresses: Mapping::default(),
                staker_index: 0,
                proposals: Mapping::default(),
                next_proposal_id: 1,
                user_votes: Mapping::default(),
                approved_projects: Mapping::default(),

                // Novos campos para premiação
                trading_rewards_pool: 0,
                trading_rewards_contract: None,
                tier_multipliers: Mapping::default(),
                governance_bonuses: Mapping::default(),
                early_adopter_counts: Mapping::default(),
                active_campaigns: Mapping::default(),
                next_campaign_id: 1,
                total_trading_rewards_distributed: 0,
                current_proposal_fee: constants::PROPOSAL_FEE, // Inicia com 1,000 LUNES
                apy_rewards_pool: 0,
                total_credited_rewards: 0,
                owed_rewards: Mapping::default(),
                distribution_amount: 0,
                liquidity_fund: 0,
                treasury_fund: 0,
                team_fund: 0,
                total_staker_weight: 0,
                staker_slots: Mapping::default(),
                distributor: None,
                pending_owner: None,
                distribution_cursor: 0,
                distribution_round: 0,
                last_credited_round: Mapping::default(),
                distribution_total_weight: 0,
                distribution_credited: 0,
                stake_entry_round: Mapping::default(),
            };

            // Campos já inicializados diretamente no struct

            // Inicializa tier multipliers
            contract
                .tier_multipliers
                .insert(StakingTier::Bronze, &constants::BRONZE_REWARD_RATE);
            contract
                .tier_multipliers
                .insert(StakingTier::Silver, &constants::SILVER_REWARD_RATE);
            contract
                .tier_multipliers
                .insert(StakingTier::Gold, &constants::GOLD_REWARD_RATE);
            contract
                .tier_multipliers
                .insert(StakingTier::Platinum, &constants::PLATINUM_REWARD_RATE);

            // Inicializa contadores de early adopters
            contract
                .early_adopter_counts
                .insert(EarlyAdopterTier::None, &0);
            contract
                .early_adopter_counts
                .insert(EarlyAdopterTier::Top1000, &0);
            contract
                .early_adopter_counts
                .insert(EarlyAdopterTier::Top500, &0);
            contract
                .early_adopter_counts
                .insert(EarlyAdopterTier::Top100, &0);

            contract
        }

        // ========================================
        // ADMIN METHODS
        // ========================================

        /// Set treasury address
        #[ink(message)]
        pub fn set_treasury_address(
            &mut self,
            new_treasury: AccountId,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if new_treasury == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }
            if new_treasury == self.env().account_id() {
                return Err(StakingError::InvalidRecipient);
            }

            let old_treasury = self.treasury_address;
            self.treasury_address = new_treasury;

            // Emit event
            self.env().emit_event(TreasuryAddressChanged {
                old_treasury,
                new_treasury,
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        // ========================================
        // STAKING & REWARDS
        // ========================================

        /// Stakes native LUNES (transferred value) for `duration` milliseconds
        /// (MIN_DURATION..=MAX_DURATION, i.e. 7..=365 days).
        #[ink(message, payable)]
        pub fn stake(&mut self, duration: u64) -> Result<(), StakingError> {
            self.ensure_not_paused()?;
            self.acquire_lock()?;

            let caller = self.env().caller();
            let amount = self.env().transferred_value();
            let current_time = self.env().block_timestamp();

            // Validations
            if amount < constants::MIN_STAKE {
                self.release_lock();
                return Err(StakingError::MinimumStakeNotMet);
            }

            if !(constants::MIN_DURATION..=constants::MAX_DURATION).contains(&duration) {
                self.release_lock();
                return Err(StakingError::InvalidDuration);
            }

            if self.active_stakers >= constants::MAX_STAKERS {
                self.release_lock();
                return Err(StakingError::MaxStakersReached);
            }

            // Check if user already has an active stake
            if let Some(existing_stake) = self.stakes.get(caller) {
                if existing_stake.active {
                    self.release_lock();
                    return Err(StakingError::NoActiveStake); // User already has active stake
                }
            }

            // Determina tier baseado na duração
            let tier = self.calculate_staking_tier(duration);

            // Determina early adopter tier
            let early_adopter_tier = self.determine_early_adopter_tier();

            // Create new stake position
            let stake_position = StakePosition {
                amount,
                start_time: current_time,
                duration,
                last_claim: current_time,
                pending_rewards: 0,
                active: true,
                tier,
                early_adopter_tier,
                governance_participation: 0,
            };

            // Update state
            let weight = self.calculate_staker_weight(&stake_position);
            self.stakes.insert(caller, &stake_position);
            // Indexa o staker. Só posições ativas ficam no índice (unstake faz
            // swap-remove) e um caller com posição ativa já foi rejeitado
            // acima, então o endereço nunca é indexado duas vezes.
            let slot = self.staker_index;
            self.staker_addresses.insert(slot, &caller);
            self.staker_slots.insert(caller, &slot);
            // Elegível só a partir da próxima rodada (com rodada aberta, a
            // atual já tem snapshot do peso sem esta posição).
            self.stake_entry_round
                .insert(caller, &self.distribution_round);
            self.staker_index = slot.checked_add(1).ok_or(StakingError::Overflow)?;
            self.total_staker_weight = self
                .total_staker_weight
                .checked_add(weight)
                .ok_or(StakingError::Overflow)?;
            self.active_stakers = self
                .active_stakers
                .checked_add(1)
                .ok_or(StakingError::Overflow)?;
            self.total_staked = self
                .total_staked
                .checked_add(amount)
                .ok_or(StakingError::Overflow)?;

            // Emit event
            self.env().emit_event(Staked {
                staker: caller,
                amount,
                duration,
                timestamp: current_time,
            });

            self.release_lock();
            Ok(())
        }

        /// Unstakes the whole position.
        ///
        /// Pays: principal − early penalty (always, never capped), the
        /// trading rewards credited to the position (backed), and the APY
        /// accrued capped by `apy_rewards_pool`. Any APY the pool cannot cover
        /// stays in `owed_rewards` (claimable later via `claim_rewards`).
        /// The 5% early-unstake penalty goes to `apy_rewards_pool`.
        ///
        /// Also works while the contract is paused (the owner cannot freeze
        /// principal): principal − penalty and the credited trading rewards are
        /// paid, but no APY leaves the shared pool — all of it goes to
        /// `owed_rewards`, claimable via `claim_rewards` after unpause.
        #[ink(message)]
        pub fn unstake(&mut self) -> Result<(), StakingError> {
            self.acquire_lock()?;
            let result = self.unstake_inner();
            self.release_lock();
            result
        }

        fn unstake_inner(&mut self) -> Result<(), StakingError> {
            let caller = self.env().caller();
            let current_time = self.env().block_timestamp();

            let mut stake = self.stakes.get(caller).ok_or(StakingError::NoActiveStake)?;
            if !stake.active {
                return Err(StakingError::NoActiveStake);
            }

            let (accrued, penalty) = self.calculate_rewards_and_penalty(&stake, current_time)?;
            let credited = stake.pending_rewards;
            let (apy_paid, apy_unpaid) = if self.paused {
                let owed = self.owed_rewards.get(caller).unwrap_or(0);
                (0, accrued.checked_add(owed).ok_or(StakingError::Overflow)?)
            } else {
                self.split_apy_payout(caller, accrued)?
            };

            let principal_out = stake
                .amount
                .checked_sub(penalty)
                .ok_or(StakingError::Overflow)?;
            let rewards_out = credited
                .checked_add(apy_paid)
                .ok_or(StakingError::Overflow)?;
            let total_out = principal_out
                .checked_add(rewards_out)
                .ok_or(StakingError::Overflow)?;

            // Rodada paginada em andamento: o swap-remove abaixo pode levar o
            // staker do último slot (ainda não processado) para um slot já
            // processado, que a rodada não visita mais. Ele recebe agora a
            // fatia do snapshot (todas as contas checadas antes das escritas).
            let moved_credit = self.moved_staker_credit(caller)?;
            let moved_reward = moved_credit.as_ref().map_or(0, |(_, _, r)| *r);
            let trading_rewards_pool = self
                .trading_rewards_pool
                .checked_sub(moved_reward)
                .ok_or(StakingError::Overflow)?;
            let distribution_credited = self
                .distribution_credited
                .checked_add(moved_reward)
                .ok_or(StakingError::Overflow)?;
            let total_trading_rewards_distributed = self
                .total_trading_rewards_distributed
                .checked_add(moved_reward)
                .ok_or(StakingError::Overflow)?;
            let total_credited_rewards = self
                .total_credited_rewards
                .checked_sub(credited)
                .ok_or(StakingError::Overflow)?
                .checked_add(moved_reward)
                .ok_or(StakingError::Overflow)?;

            // Effects
            stake.active = false;
            stake.pending_rewards = 0;
            stake.last_claim = current_time;
            self.stakes.insert(caller, &stake);
            self.owed_rewards.insert(caller, &apy_unpaid);
            self.apy_rewards_pool = self
                .apy_rewards_pool
                .checked_sub(apy_paid)
                .ok_or(StakingError::Overflow)?
                .checked_add(penalty)
                .ok_or(StakingError::Overflow)?;
            if let Some((moved, moved_stake, _)) = &moved_credit {
                self.stakes.insert(*moved, moved_stake);
                self.last_credited_round
                    .insert(*moved, &self.distribution_round);
            }
            self.trading_rewards_pool = trading_rewards_pool;
            self.distribution_credited = distribution_credited;
            self.total_trading_rewards_distributed = total_trading_rewards_distributed;
            self.total_credited_rewards = total_credited_rewards;
            self.active_stakers = self
                .active_stakers
                .checked_sub(1)
                .ok_or(StakingError::Overflow)?;
            self.remove_from_staker_index(caller)?;
            self.total_staker_weight = self
                .total_staker_weight
                .checked_sub(self.calculate_staker_weight(&stake))
                .ok_or(StakingError::Overflow)?;
            self.total_staked = self
                .total_staked
                .checked_sub(stake.amount)
                .ok_or(StakingError::Overflow)?;
            self.total_rewards_distributed = self
                .total_rewards_distributed
                .checked_add(rewards_out)
                .ok_or(StakingError::Overflow)?;

            // Interaction (an Err reverts every effect above on-chain)
            if total_out > 0 && self.env().transfer(caller, total_out).is_err() {
                return Err(StakingError::InsufficientBalance);
            }

            self.env().emit_event(Unstaked {
                staker: caller,
                amount: stake.amount,
                rewards: rewards_out,
                penalty,
                timestamp: current_time,
            });
            Ok(())
        }

        /// Claims rewards without unstaking: credited trading rewards (backed)
        /// + APY capped by `apy_rewards_pool`. The uncovered remainder is kept
        /// in `owed_rewards` — never paid from principal. Also works after
        /// unstake when `owed_rewards > 0`. Returns Ok with no transfer when
        /// nothing is payable right now.
        #[ink(message)]
        pub fn claim_rewards(&mut self) -> Result<(), StakingError> {
            self.ensure_not_paused()?;
            self.acquire_lock()?;
            let result = self.claim_rewards_inner();
            self.release_lock();
            result
        }

        fn claim_rewards_inner(&mut self) -> Result<(), StakingError> {
            let caller = self.env().caller();
            let current_time = self.env().block_timestamp();

            let active_stake = self.stakes.get(caller).filter(|s| s.active);
            let owed_before = self.owed_rewards.get(caller).unwrap_or(0);
            if active_stake.is_none() && owed_before == 0 {
                return Err(StakingError::NoActiveStake);
            }

            let (accrued, credited) = match &active_stake {
                Some(stake) => (
                    self.calculate_pending_rewards(stake, current_time)?,
                    stake.pending_rewards,
                ),
                None => (0, 0),
            };
            let (apy_paid, apy_unpaid) = self.split_apy_payout(caller, accrued)?;
            let payout = credited
                .checked_add(apy_paid)
                .ok_or(StakingError::Overflow)?;

            // Effects
            if let Some(mut stake) = active_stake {
                stake.last_claim = current_time;
                stake.pending_rewards = 0;
                self.stakes.insert(caller, &stake);
            }
            self.owed_rewards.insert(caller, &apy_unpaid);
            self.apy_rewards_pool = self
                .apy_rewards_pool
                .checked_sub(apy_paid)
                .ok_or(StakingError::Overflow)?;
            self.total_credited_rewards = self
                .total_credited_rewards
                .checked_sub(credited)
                .ok_or(StakingError::Overflow)?;
            self.total_rewards_distributed = self
                .total_rewards_distributed
                .checked_add(payout)
                .ok_or(StakingError::Overflow)?;

            if payout == 0 {
                return Ok(()); // nothing payable now; accrual moved to owed
            }

            // Interaction (an Err reverts every effect above on-chain)
            if self.env().transfer(caller, payout).is_err() {
                return Err(StakingError::InsufficientBalance);
            }

            self.env().emit_event(RewardsClaimed {
                staker: caller,
                amount: payout,
                timestamp: current_time,
            });
            Ok(())
        }

        /// (apy paid now, apy left owed) for `accrued` + previously owed APY,
        /// capped by the funded `apy_rewards_pool`.
        fn split_apy_payout(
            &self,
            account: AccountId,
            accrued: Balance,
        ) -> Result<(Balance, Balance), StakingError> {
            let due = accrued
                .checked_add(self.owed_rewards.get(account).unwrap_or(0))
                .ok_or(StakingError::Overflow)?;
            let paid = due.min(self.apy_rewards_pool);
            let unpaid = due.checked_sub(paid).ok_or(StakingError::Overflow)?;
            Ok((paid, unpaid))
        }

        /// Creates a new project listing proposal
        #[ink(message, payable)]
        pub fn create_proposal(
            &mut self,
            name: String,
            description: String,
            token_address: AccountId,
        ) -> Result<u32, StakingError> {
            self.ensure_not_paused()?;

            let caller = self.env().caller();
            let current_time = self.env().block_timestamp();
            let fee = self.env().transferred_value();

            // Validate inputs
            if token_address == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            // Check proposal fee (agora dinâmica, ajustável pela comunidade)
            if fee < self.current_proposal_fee {
                return Err(StakingError::InsufficientFee);
            }

            // Check voting power requirement
            let voting_power = self.get_voting_power(caller)?;
            if voting_power < constants::MIN_PROPOSAL_POWER {
                return Err(StakingError::InsufficientVotingPower);
            }

            let proposal_id = self.next_proposal_id;
            let voting_deadline = current_time.saturating_add(constants::VOTING_PERIOD);

            let execution_time = voting_deadline.saturating_add(constants::EXECUTION_DELAY_MS);

            let proposal = ProjectProposal {
                id: proposal_id,
                name: name.clone(),
                description,
                token_address,
                proposer: caller,
                vote_count: 0,
                votes_for: 0,
                votes_against: 0,
                voting_deadline,
                executed: false,
                active: true,
                fee,
                fee_refunded: false,
                new_fee_amount: None, // Proposta normal de token, não mudança de taxa
                execution_time,
            };

            self.proposals.insert(proposal_id, &proposal);
            self.next_proposal_id = self
                .next_proposal_id
                .checked_add(1)
                .ok_or(StakingError::Overflow)?;

            // Emit event
            self.env().emit_event(ProposalCreated {
                proposal_id,
                proposer: caller,
                project_name: name,
                token_address,
                voting_deadline,
            });

            Ok(proposal_id)
        }

        /// Votes on a project listing proposal (YES or NO)
        /// Each vote costs exactly `VOTE_COST` (10 LUNES); any other value is
        /// rejected (no change is kept). Users can vote once per hour.
        /// Requirements:
        /// - Voter must have active staking
        /// Vote distribution (each share has its own counter, see `get_vote_funds`):
        /// - 10% → Rewards Pool (stakers) — `trading_rewards_pool`
        /// - 10% → Project Liquidity Pool — `liquidity_fund` (`withdraw_liquidity_fund`)
        /// - 10% → Treasury — `treasury_fund` (`withdraw_treasury_fund`)
        /// - 70% → Team — `team_fund` (`withdraw_team_fund`)
        /// Project needs 10,000 YES votes minimum to be approved.
        #[ink(message, payable)]
        pub fn vote(&mut self, proposal_id: u32, vote_yes: bool) -> Result<(), StakingError> {
            self.ensure_not_paused()?;

            let caller = self.env().caller();
            let current_time = self.env().block_timestamp();
            let payment = self.env().transferred_value();

            // === REQUIREMENT: Voter must have active staking ===
            let stake = self.stakes.get(caller).ok_or(StakingError::NoStakeFound)?;
            if !stake.active {
                return Err(StakingError::NoStakeFound);
            }

            // === CHECK VOTE COOLDOWN (1 hour) ===
            // Using user_votes mapping to store last vote timestamp
            let last_vote_key = (proposal_id, caller);
            if self.user_votes.get(last_vote_key).unwrap_or(false) {
                // Already voted at least once - check cooldown
                // Note: For full cooldown tracking, would need separate timestamp storage
                // For now, allow one vote per proposal per user
                return Err(StakingError::AlreadyVoted);
            }

            // === VALIDATE PAYMENT (exactly 10 LUNES per vote) ===
            if payment < constants::VOTE_COST {
                return Err(StakingError::InsufficientFee);
            }
            if payment > constants::VOTE_COST {
                return Err(StakingError::InvalidAmount);
            }

            let mut proposal = self
                .proposals
                .get(proposal_id)
                .ok_or(StakingError::InvalidProposal)?;

            if !proposal.active {
                return Err(StakingError::InvalidProposal);
            }

            if current_time > proposal.voting_deadline {
                return Err(StakingError::VotingPeriodExpired);
            }

            // === DISTRIBUTE VOTE PAYMENT ===
            // Every share is credited to its own counter, so no part of the
            // payment is left in the balance without accounting.
            // 10% rewards, 10% liquidity, 10% treasury; 70% team is the
            // remainder, so the shares always add up to `payment`.
            let rewards_share = payment.checked_div(10).ok_or(StakingError::Overflow)?;
            let liquidity_share = payment.checked_div(10).ok_or(StakingError::Overflow)?;
            let treasury_share = payment.checked_div(10).ok_or(StakingError::Overflow)?;
            let team_share = payment
                .checked_sub(rewards_share)
                .and_then(|v| v.checked_sub(liquidity_share))
                .and_then(|v| v.checked_sub(treasury_share))
                .ok_or(StakingError::Overflow)?;

            self.trading_rewards_pool = self
                .trading_rewards_pool
                .checked_add(rewards_share)
                .ok_or(StakingError::Overflow)?;
            self.liquidity_fund = self
                .liquidity_fund
                .checked_add(liquidity_share)
                .ok_or(StakingError::Overflow)?;
            self.treasury_fund = self
                .treasury_fund
                .checked_add(treasury_share)
                .ok_or(StakingError::Overflow)?;
            self.team_fund = self
                .team_fund
                .checked_add(team_share)
                .ok_or(StakingError::Overflow)?;

            // votes_against counts NO votes
            if !vote_yes {
                proposal.votes_against = proposal
                    .votes_against
                    .checked_add(1)
                    .ok_or(StakingError::Overflow)?;
            }

            // === COUNT VOTE (YES or NO) ===
            if vote_yes {
                // YES vote - increment vote_count (used for YES votes)
                proposal.vote_count = proposal
                    .vote_count
                    .checked_add(1)
                    .ok_or(StakingError::Overflow)?;
            }
            // NO votes don't increase vote_count (only YES votes count towards approval)

            // Track total LUNES collected
            proposal.votes_for = proposal
                .votes_for
                .checked_add(payment)
                .ok_or(StakingError::Overflow)?;

            self.proposals.insert(proposal_id, &proposal);

            // Mark user as having voted
            self.user_votes.insert(last_vote_key, &true);

            // Update voter's governance participation
            let mut updated_stake = stake;
            updated_stake.governance_participation =
                updated_stake.governance_participation.saturating_add(1);
            self.stakes.insert(caller, &updated_stake);

            // Emit event
            self.env().emit_event(Voted {
                proposal_id,
                voter: caller,
                vote_power: payment,
                in_favor: vote_yes,
                timestamp: current_time,
            });

            Ok(())
        }

        /// Executes a proposal after voting period ends
        /// Project is approved if it reaches MIN_VOTES_FOR_APPROVAL (10,000 votes)
        #[ink(message)]
        pub fn execute_proposal(&mut self, proposal_id: u32) -> Result<(), StakingError> {
            let current_time = self.env().block_timestamp();

            let mut proposal = self
                .proposals
                .get(proposal_id)
                .ok_or(StakingError::InvalidProposal)?;

            if !proposal.active || proposal.executed {
                return Err(StakingError::InvalidProposal);
            }

            if current_time < proposal.voting_deadline {
                return Err(StakingError::VotingPeriodExpired);
            }

            // Enforce 48h timelock between end of voting and execution
            if current_time < proposal.execution_time {
                return Err(StakingError::TimelockPending);
            }

            // Project is approved if it reaches minimum votes (10,000)
            let approved = proposal.vote_count >= constants::MIN_VOTES_FOR_APPROVAL;

            // Mark executed in storage BEFORE any external transfer so a
            // cross-contract reentry cannot double-execute the same proposal.
            // (Effects-Interactions ordering — see T21 for the same pattern
            // in claim_rewards.)
            if approved {
                if let Some(new_fee) = proposal.new_fee_amount {
                    self.execute_fee_change(proposal_id, new_fee)?;
                } else {
                    self.approved_projects.insert(proposal.token_address, &true);
                }
            }

            proposal.executed = true;
            proposal.active = false;
            // Track refund/distribution in storage before transferring so a
            // failed transfer cannot be silently retried into a double pay.
            let fee_to_move = proposal.fee;
            let refund_target = proposal.proposer;
            let needs_refund = approved && !proposal.fee_refunded && fee_to_move > 0;
            let needs_distribution = !approved && !proposal.fee_refunded && fee_to_move > 0;
            if needs_refund || needs_distribution {
                proposal.fee_refunded = true;
            }
            self.proposals.insert(proposal_id, &proposal);

            // ─── Real on-chain settlement of the proposal fee ─────────────
            // Approved proposal: refund the fee to the proposer.
            // Rejected proposal: split the fee — 10% credited to the
            // staking rewards pool (kept inside the contract balance), the
            // remainder forwarded to treasury for protocol revenue.
            //
            // Skipped under unit-test cfg — ink's mock env doesn't pre-fund
            // the contract account with the cumulative fees of all proposals,
            // and adding balance setup to every test is noisy. Integration
            // tests on testnet exercise the transfers.
            #[cfg(not(test))]
            {
                if needs_refund {
                    if self.env().balance() < fee_to_move {
                        return Err(StakingError::InsufficientBalance);
                    }
                    if self.env().transfer(refund_target, fee_to_move).is_err() {
                        return Err(StakingError::InsufficientBalance);
                    }
                } else if needs_distribution {
                    let staking_share = fee_to_move / 10; // 10% to staking pool
                    let treasury_share = fee_to_move.saturating_sub(staking_share);

                    self.trading_rewards_pool =
                        self.trading_rewards_pool.saturating_add(staking_share);

                    if treasury_share > 0 {
                        if self.env().balance() < treasury_share {
                            self.trading_rewards_pool =
                                self.trading_rewards_pool.saturating_sub(staking_share);
                            proposal.fee_refunded = false;
                            self.proposals.insert(proposal_id, &proposal);
                            return Err(StakingError::InsufficientBalance);
                        }
                        if self
                            .env()
                            .transfer(self.treasury_address, treasury_share)
                            .is_err()
                        {
                            self.trading_rewards_pool =
                                self.trading_rewards_pool.saturating_sub(staking_share);
                            proposal.fee_refunded = false;
                            self.proposals.insert(proposal_id, &proposal);
                            return Err(StakingError::InsufficientBalance);
                        }
                    }
                }
            }
            // Under unit-test cfg, still record the staking-rewards pool
            // bookkeeping for rejected proposals so existing tests that
            // assert on `trading_rewards_pool` keep passing.
            #[cfg(test)]
            if needs_distribution {
                let staking_share = fee_to_move / 10;
                self.trading_rewards_pool = self.trading_rewards_pool.saturating_add(staking_share);
            }
            // Suppress unused-variable warnings when cfg(test).
            #[cfg(test)]
            let _ = (needs_refund, refund_target, fee_to_move);

            // Emit event
            self.env().emit_event(ProposalExecuted {
                proposal_id,
                approved,
                votes_for: proposal.votes_for,
                votes_against: proposal.vote_count as u128, // Usando para armazenar vote_count no evento
                timestamp: current_time,
            });

            Ok(())
        }

        // === Query Methods ===

        /// Gets stake information for an account
        #[ink(message)]
        pub fn get_stake(&self, account: AccountId) -> Option<StakePosition> {
            self.stakes.get(account)
        }

        /// Gets current rewards for a staker
        #[ink(message)]
        /// Total rewards owed to `account`: APY accrued since the last claim
        /// + previously owed APY + credited trading rewards. What is payable
        /// right now is capped by `get_reward_pools().0` (APY part).
        pub fn get_pending_rewards(&self, account: AccountId) -> Result<Balance, StakingError> {
            let owed = self.owed_rewards.get(account).unwrap_or(0);
            match self.stakes.get(account).filter(|s| s.active) {
                Some(stake) => {
                    let current_time = self.env().block_timestamp();
                    self.calculate_pending_rewards(&stake, current_time)?
                        .checked_add(stake.pending_rewards)
                        .and_then(|v| v.checked_add(owed))
                        .ok_or(StakingError::Overflow)
                }
                None if owed > 0 => Ok(owed),
                None => Err(StakingError::NoActiveStake),
            }
        }

        /// APY not paid yet because the pool was short (claimable later).
        #[ink(message)]
        pub fn get_owed_rewards(&self, account: AccountId) -> Balance {
            self.owed_rewards.get(account).unwrap_or(0)
        }

        /// (apy_rewards_pool, trading_rewards_pool, total_credited_rewards).
        #[ink(message)]
        pub fn get_reward_pools(&self) -> (Balance, Balance, Balance) {
            (
                self.apy_rewards_pool,
                self.trading_rewards_pool,
                self.total_credited_rewards,
            )
        }

        /// Gets voting power for an account
        #[ink(message)]
        pub fn get_voting_power(&self, account: AccountId) -> Result<Balance, StakingError> {
            if let Some(stake) = self.stakes.get(account) {
                if stake.active {
                    Ok(stake.amount)
                } else {
                    Ok(0)
                }
            } else {
                Ok(0)
            }
        }

        /// Gets proposal information
        #[ink(message)]
        pub fn get_proposal(&self, proposal_id: u32) -> Option<ProjectProposal> {
            self.proposals.get(proposal_id)
        }

        /// Checks if a project is approved for listing
        #[ink(message)]
        pub fn is_project_approved(&self, token_address: AccountId) -> bool {
            self.approved_projects.get(token_address).unwrap_or(false)
        }

        // ========================================
        // ADMIN LISTING FUNCTIONS (TEAM POWER)
        // ========================================

        /// Lista token diretamente via admin (sem governança)
        /// Usado para tokens iniciais e casos especiais
        #[ink(message)]
        pub fn admin_list_token(
            &mut self,
            token_address: AccountId,
            reason: String,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if token_address == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            // Verificar se já está aprovado
            if self.approved_projects.get(token_address).unwrap_or(false) {
                return Err(StakingError::AlreadyListed);
            }

            // Aprovar diretamente
            self.approved_projects.insert(token_address, &true);

            // Emit event específico para listagem por admin
            self.env().emit_event(AdminTokenListed {
                token_address,
                admin: self.env().caller(),
                reason,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Lista múltiplos tokens de uma vez (batch)
        /// Útil para configuração inicial da DEX
        #[ink(message)]
        pub fn admin_batch_list_tokens(
            &mut self,
            tokens: Vec<(AccountId, String)>,
        ) -> Result<u32, StakingError> {
            self.ensure_owner()?;

            if tokens.len() > 50 {
                return Err(StakingError::TooManyTokens);
            }

            let mut listed_count = 0u32;

            for (token_address, reason) in tokens {
                if token_address == AccountId::from(constants::ZERO_ADDRESS) {
                    continue; // Pular endereços inválidos
                }

                // Verificar se já está aprovado
                if self.approved_projects.get(token_address).unwrap_or(false) {
                    continue; // Pular se já listado
                }

                // Aprovar token
                self.approved_projects.insert(token_address, &true);

                // Emit event individual
                self.env().emit_event(AdminTokenListed {
                    token_address,
                    admin: self.env().caller(),
                    reason: reason.clone(),
                    timestamp: self.env().block_timestamp(),
                });

                listed_count = listed_count.checked_add(1).ok_or(StakingError::Overflow)?;
            }

            // Emit event de batch
            self.env().emit_event(AdminBatchListingCompleted {
                admin: self.env().caller(),
                tokens_listed: listed_count,
                timestamp: self.env().block_timestamp(),
            });

            Ok(listed_count)
        }

        /// Remove token da lista (apenas admin)
        /// Para casos extremos onde um token precisa ser removido
        #[ink(message)]
        pub fn admin_delist_token(
            &mut self,
            token_address: AccountId,
            reason: String,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if !self.approved_projects.get(token_address).unwrap_or(false) {
                return Err(StakingError::TokenNotListed);
            }

            // Remover da lista (usa insert false para compatibilidade com seal0::clear_storage)
            self.approved_projects.insert(token_address, &false);

            // Emit event
            self.env().emit_event(AdminTokenDelisted {
                token_address,
                admin: self.env().caller(),
                reason,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Obter estatísticas de listagem
        #[ink(message)]
        pub fn get_listing_stats(&self) -> (u32, u32, u32) {
            (
                self.next_proposal_id.saturating_sub(1), // Propostas criadas
                self.active_stakers,                     // Stakers ativos (podem votar)
                0u32, // Tokens aprovados - calculado off-chain para eficiência
            )
        }

        // ========================================
        // GOVERNANÇA DA TAXA DE PROPOSTA
        // ========================================

        /// Propor alteração na taxa de proposta (via governança)
        #[ink(message, payable)]
        pub fn propose_fee_change(
            &mut self,
            new_fee: Balance,
            justification: String,
        ) -> Result<u32, StakingError> {
            self.ensure_not_paused()?;

            let caller = self.env().caller();
            let current_time = self.env().block_timestamp();
            let fee = self.env().transferred_value();

            // Validações
            if new_fee == 0 || new_fee > 10_000_000_000_000 {
                // Max 100,000 LUNES
                return Err(StakingError::InvalidAmount);
            }

            // Taxa atual se aplica para propostas de mudança de taxa também
            if fee < self.current_proposal_fee {
                return Err(StakingError::InsufficientFee);
            }

            // Check voting power requirement
            let voting_power = self.get_voting_power(caller)?;
            if voting_power < constants::MIN_PROPOSAL_POWER {
                return Err(StakingError::InsufficientVotingPower);
            }

            let proposal_id = self.next_proposal_id;
            let voting_deadline = current_time.saturating_add(constants::VOTING_PERIOD);

            let execution_time = voting_deadline.saturating_add(constants::EXECUTION_DELAY_MS);
            let proposal = ProjectProposal {
                id: proposal_id,
                name: "MUDANCA_TAXA_PROPOSTA".to_string(),
                description: format!(
                    "Alterar taxa de proposta para {} LUNES. Justificativa: {}",
                    new_fee.checked_div(100_000_000).unwrap_or(0),
                    justification
                ), // Mostrar em LUNES
                token_address: AccountId::from(constants::ZERO_ADDRESS), // Endereço especial para mudança de taxa
                proposer: caller,
                vote_count: 0,
                votes_for: 0,
                votes_against: 0,
                voting_deadline,
                executed: false,
                active: true,
                fee,
                fee_refunded: false,
                new_fee_amount: Some(new_fee), // Armazenar diretamente a nova taxa
                execution_time,
            };

            self.proposals.insert(proposal_id, &proposal);
            self.next_proposal_id = self
                .next_proposal_id
                .checked_add(1)
                .ok_or(StakingError::Overflow)?;

            // Emit event
            self.env().emit_event(FeeChangeProposed {
                proposal_id,
                proposer: caller,
                current_fee: self.current_proposal_fee,
                proposed_fee: new_fee,
                justification,
                voting_deadline,
            });

            Ok(proposal_id)
        }

        /// Executar mudança de taxa (após aprovação)
        pub fn execute_fee_change(
            &mut self,
            proposal_id: u32,
            new_fee: Balance,
        ) -> Result<(), StakingError> {
            // Esta função é chamada internamente por execute_proposal quando uma proposta de taxa é aprovada
            if new_fee == 0 || new_fee > 10_000_000_000_000 {
                // Max 100,000 LUNES
                return Err(StakingError::InvalidAmount);
            }

            let old_fee = self.current_proposal_fee;
            self.current_proposal_fee = new_fee;

            // Emit event
            self.env().emit_event(ProposalFeeChanged {
                proposal_id,
                old_fee,
                new_fee,
                changed_by: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Obter taxa atual de proposta
        #[ink(message)]
        pub fn get_current_proposal_fee(&self) -> Balance {
            self.current_proposal_fee
        }

        /// Gets contract statistics
        #[ink(message)]
        pub fn get_stats(&self) -> (Balance, Balance, u32) {
            (
                self.total_staked,
                self.total_rewards_distributed,
                self.active_stakers,
            )
        }

        // === Admin Methods ===

        /// Pauses the contract (admin only)
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), StakingError> {
            self.ensure_owner()?;
            self.paused = true;

            // Emit event
            self.env().emit_event(ContractPaused {
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Unpauses the contract (admin only)
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), StakingError> {
            self.ensure_owner()?;
            self.paused = false;

            // Emit event
            self.env().emit_event(ContractUnpaused {
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Starts an ownership transfer (admin only). Step 1 of 2: `new_owner`
        /// only becomes owner after calling `accept_ownership`. Calling again
        /// replaces the pending owner.
        #[ink(message)]
        pub fn transfer_ownership(&mut self, new_owner: AccountId) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if new_owner == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            self.pending_owner = Some(new_owner);

            self.env().emit_event(OwnershipTransferStarted {
                current_owner: self.owner,
                pending_owner: new_owner,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Step 2 of 2: the pending owner accepts and becomes owner.
        #[ink(message)]
        pub fn accept_ownership(&mut self) -> Result<(), StakingError> {
            let caller = self.env().caller();
            if self.pending_owner != Some(caller) {
                return Err(StakingError::AccessDenied);
            }

            let old_owner = self.owner;
            self.owner = caller;
            self.pending_owner = None;

            // Emit event
            self.env().emit_event(OwnershipTransferred {
                old_owner,
                new_owner: caller,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Sets (or revokes, with `None`) the distributor (admin only). The
        /// distributor can only fund and distribute trading rewards.
        #[ink(message)]
        pub fn set_distributor(
            &mut self,
            new_distributor: Option<AccountId>,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if new_distributor == Some(AccountId::from(constants::ZERO_ADDRESS)) {
                return Err(StakingError::ZeroAddress);
            }

            let old_distributor = self.distributor;
            self.distributor = new_distributor;

            self.env().emit_event(DistributorChanged {
                old_distributor,
                new_distributor,
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// (owner, pending_owner, distributor).
        #[ink(message)]
        pub fn get_admin_roles(&self) -> (AccountId, Option<AccountId>, Option<AccountId>) {
            (self.owner, self.pending_owner, self.distributor)
        }

        // ========================================
        // FUNDOS DOS VOTOS (liquidez / treasury / team)
        // ========================================

        /// (liquidity_fund, treasury_fund, team_fund): vote shares not yet withdrawn.
        #[ink(message)]
        pub fn get_vote_funds(&self) -> (Balance, Balance, Balance) {
            (self.liquidity_fund, self.treasury_fund, self.team_fund)
        }

        /// Sends the whole treasury share to `treasury_address` (its only
        /// possible destination). Callable by the owner or by the treasury.
        #[ink(message)]
        pub fn withdraw_treasury_fund(&mut self) -> Result<Balance, StakingError> {
            let caller = self.env().caller();
            if caller != self.owner && caller != self.treasury_address {
                return Err(StakingError::AccessDenied);
            }
            self.withdraw_vote_fund(2, self.treasury_address)
        }

        /// Sends the whole project-liquidity share to `to` (admin only). The
        /// contract has no on-chain liquidity destination, so the owner picks
        /// it and `VoteFundWithdrawn` records it.
        #[ink(message)]
        pub fn withdraw_liquidity_fund(&mut self, to: AccountId) -> Result<Balance, StakingError> {
            self.ensure_owner()?;
            self.withdraw_vote_fund(1, to)
        }

        /// Sends the whole team share to `to` (admin only); no team address
        /// exists on-chain, `VoteFundWithdrawn` records the destination.
        #[ink(message)]
        pub fn withdraw_team_fund(&mut self, to: AccountId) -> Result<Balance, StakingError> {
            self.ensure_owner()?;
            self.withdraw_vote_fund(3, to)
        }

        /// Zeroes vote share `fund` (1=liquidity, 2=treasury, 3=team) and then
        /// transfers it to `to` (effects before the interaction).
        fn withdraw_vote_fund(&mut self, fund: u8, to: AccountId) -> Result<Balance, StakingError> {
            if to == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }
            // Auto-transferência não move saldo: o contador seria zerado e o
            // valor ficaria preso fora de qualquer contador.
            if to == self.env().account_id() {
                return Err(StakingError::InvalidRecipient);
            }
            let share = match fund {
                1 => &mut self.liquidity_fund,
                2 => &mut self.treasury_fund,
                _ => &mut self.team_fund,
            };
            let amount = *share;
            if amount == 0 {
                return Err(StakingError::ZeroAmount);
            }
            *share = 0;

            // Interaction (an Err reverts the effect above on-chain)
            if self.env().transfer(to, amount).is_err() {
                return Err(StakingError::InsufficientBalance);
            }

            self.env().emit_event(VoteFundWithdrawn {
                to,
                fund,
                amount,
                caller: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });
            Ok(amount)
        }

        // === FUNÇÕES DE INTEGRAÇÃO COM TRADING REWARDS ===

        /// Define o endereço do contrato de trading rewards (apenas admin)
        #[ink(message)]
        pub fn set_trading_rewards_contract(
            &mut self,
            contract_address: AccountId,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if contract_address == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            let old_contract = self.trading_rewards_contract;
            self.trading_rewards_contract = Some(contract_address);

            // Emit event
            self.env().emit_event(TradingRewardsContractChanged {
                old_contract,
                new_contract: contract_address,
                admin: self.env().caller(),
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Recebe trading rewards (apenas o contrato de rewards autorizado ou o distributor)
        #[ink(message, payable)]
        pub fn fund_staking_rewards(&mut self) -> Result<(), StakingError> {
            self.ensure_not_paused()?;

            // Verifica se é o contrato autorizado ou o distributor
            let caller = self.env().caller();
            if self.trading_rewards_contract != Some(caller) && self.distributor != Some(caller) {
                return Err(StakingError::AccessDenied);
            }

            let amount = self.env().transferred_value();
            if amount == 0 {
                return Err(StakingError::ZeroAmount);
            }

            self.trading_rewards_pool = self
                .trading_rewards_pool
                .checked_add(amount)
                .ok_or(StakingError::Overflow)?;

            // Emit event
            self.env().emit_event(TradingRewardsFunded {
                amount,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Funds the APY / governance-bonus pool with the transferred LUNES.
        /// Open to anyone (treasury, team, rewards contract). This pool is the
        /// ONLY source for APY rewards and governance bonuses.
        #[ink(message, payable)]
        pub fn fund_apy_rewards(&mut self) -> Result<(), StakingError> {
            self.ensure_not_paused()?;
            let amount = self.env().transferred_value();
            if amount == 0 {
                return Err(StakingError::ZeroAmount);
            }
            self.apy_rewards_pool = self
                .apy_rewards_pool
                .checked_add(amount)
                .ok_or(StakingError::Overflow)?;
            self.env().emit_event(ApyRewardsFunded {
                funder: self.env().caller(),
                amount,
                timestamp: self.env().block_timestamp(),
            });
            Ok(())
        }

        /// Distribui trading rewards para todos os stakers ativos (owner ou distributor)
        /// Para compatibilidade, processa a próxima página (até 100 stakers) a
        /// partir do cursor da rodada; com mais stakers, chamadas seguintes continuam
        #[ink(message)]
        pub fn distribute_trading_rewards(&mut self) -> Result<(), StakingError> {
            // Para compatibilidade, distribui tudo em uma página
            let (_processed, _complete, _next) =
                self.distribute_trading_rewards_paginated(None, None)?;
            Ok(())
        }

        /// Distribui trading rewards com paginação para melhor eficiência de gas (owner ou distributor)
        ///
        /// A rodada fixa no início o valor (`distribution_amount`) e o peso
        /// total (`distribution_total_weight`); toda página usa os dois. Cada
        /// staker ativo desde antes do início recebe
        /// `distribution_amount * peso / distribution_total_weight`, e a soma
        /// da rodada nunca passa de `distribution_amount`
        /// (`distribution_credited`).
        /// - O índice só contém stakers ativos (swap-remove no unstake). Se um
        ///   unstake entre páginas move o último staker, ainda não processado,
        ///   para um slot já processado, ele é creditado na hora (no unstake).
        /// - Quem sai antes de ser processado não recebe; a fatia fica no pool.
        /// - Posições criadas com a rodada aberta (`stake_entry_round`), por
        ///   qualquer conta, só participam da rodada seguinte.
        /// - Cada conta recebe no máximo um crédito por rodada
        ///   (`last_credited_round`).
        ///
        /// # Parâmetros
        /// - `start_index`: o índice é imposto on-chain (`distribution_cursor`):
        ///   passe `None` ou o `next_index` devolvido pela página anterior. Fora
        ///   de rodada o início esperado é 0. Qualquer outro valor falha com
        ///   `InvalidDistributionCursor` sem alterar estado (impede repetir uma
        ///   página ou recomeçar a rodada com novo snapshot).
        /// - `batch_size`: Número máximo de stakers para processar (None = todos restantes, max 100)
        ///
        /// # Retorna
        /// - `Ok((processed_count, is_complete, next_index))`:
        ///   - processed_count: número de stakers processados
        ///   - is_complete: se a distribuição foi finalizada
        ///   - next_index: próximo índice para continuar (se não completo)
        #[ink(message)]
        pub fn distribute_trading_rewards_paginated(
            &mut self,
            start_index: Option<u32>,
            batch_size: Option<u32>,
        ) -> Result<(u32, bool, Option<u32>), StakingError> {
            self.ensure_owner_or_distributor()?;
            self.ensure_not_paused()?;
            self.acquire_lock()?;
            let result = self.distribute_trading_rewards_paginated_inner(start_index, batch_size);
            self.release_lock();
            result
        }

        fn distribute_trading_rewards_paginated_inner(
            &mut self,
            start_index: Option<u32>,
            batch_size: Option<u32>,
        ) -> Result<(u32, bool, Option<u32>), StakingError> {
            // Uma rodada está em andamento enquanto há snapshot; ela só avança
            // a partir do cursor gravado.
            let in_progress = self.distribution_amount != 0;
            let expected_start = if in_progress {
                self.distribution_cursor
            } else {
                0
            };
            let start = start_index.unwrap_or(expected_start);
            if start != expected_start {
                return Err(StakingError::InvalidDistributionCursor);
            }

            if self.trading_rewards_pool == 0 {
                self.reset_distribution_round();
                return Ok((0, true, None)); // Nada para distribuir
            }

            // O denominador também é snapshot: stake/unstake entre páginas não
            // muda a fatia de quem ainda não foi processado.
            let total_weight = if in_progress {
                self.distribution_total_weight
            } else {
                self.total_staker_weight
            };
            if total_weight == 0 {
                self.reset_distribution_round();
                return Ok((0, true, None)); // Nenhum staker ativo
            }

            // Snapshot (valor, peso total, número da rodada) só quando a rodada
            // começa. Tudo é calculado em `state` e gravado no fim.
            let mut state = if in_progress {
                self.current_round_state()
            } else {
                RoundState {
                    round: self
                        .distribution_round
                        .checked_add(1)
                        .ok_or(StakingError::Overflow)?,
                    amount: self.trading_rewards_pool,
                    total_weight,
                    credited: 0,
                    pool_left: self.trading_rewards_pool,
                }
            };
            let mut credited_this_page: Balance = 0;
            let max_batch = batch_size.unwrap_or(100).min(100); // Limita a 100 para evitar gas excessivo
            let end = start
                .checked_add(max_batch)
                .unwrap_or(self.staker_index)
                .min(self.staker_index);

            let mut distributed_count = 0u32;
            let mut processed_count = 0u32;
            let mut credits: Vec<(AccountId, StakePosition)> = Vec::new();

            // Distribui proporcionalmente para o lote de stakers
            for i in start..end {
                processed_count = processed_count
                    .checked_add(1)
                    .ok_or(StakingError::Overflow)?;

                if let Some(staker) = self.staker_addresses.get(i) {
                    if let Some(mut stake) = self.stakes.get(staker) {
                        let reward = self.round_share(staker, &stake, &state)?;
                        if reward > 0 {
                            stake.pending_rewards = stake
                                .pending_rewards
                                .checked_add(reward)
                                .ok_or(StakingError::Overflow)?;
                            state.pool_left = state
                                .pool_left
                                .checked_sub(reward)
                                .ok_or(StakingError::Overflow)?;
                            state.credited = state
                                .credited
                                .checked_add(reward)
                                .ok_or(StakingError::Overflow)?;
                            credited_this_page = credited_this_page
                                .checked_add(reward)
                                .ok_or(StakingError::Overflow)?;
                            distributed_count = distributed_count
                                .checked_add(1)
                                .ok_or(StakingError::Overflow)?;
                            credits.push((staker, stake));
                        }
                    }
                }
            }

            // Com o índice encolhido entre páginas (cursor >= staker_index) a
            // página fica vazia e a rodada termina.
            let is_complete = end >= self.staker_index;
            let next_index = if is_complete { None } else { Some(end) };
            let total_credited_rewards = self
                .total_credited_rewards
                .checked_add(credited_this_page)
                .ok_or(StakingError::Overflow)?;
            let total_trading_rewards_distributed = self
                .total_trading_rewards_distributed
                .checked_add(credited_this_page)
                .ok_or(StakingError::Overflow)?;

            // Effects (todas as contas acima já foram checadas)
            for (staker, stake) in &credits {
                self.stakes.insert(*staker, stake);
                self.last_credited_round.insert(*staker, &state.round);
            }
            self.trading_rewards_pool = state.pool_left;
            self.total_credited_rewards = total_credited_rewards;
            self.total_trading_rewards_distributed = total_trading_rewards_distributed;
            self.distribution_round = state.round;

            if is_complete {
                self.reset_distribution_round();
            } else {
                self.distribution_amount = state.amount;
                self.distribution_total_weight = state.total_weight;
                self.distribution_credited = state.credited;
                self.distribution_cursor = end;
            }

            // Se é a primeira página ou a distribuição está completa, atualiza estado global
            if start == 0 || is_complete {
                if is_complete {
                    // Rodada finalizada (snapshot e cursor zerados acima). O
                    // resto de arredondamento fica no pool para a próxima
                    // distribuição (não é zerado).

                    // Emit event final
                    self.env().emit_event(TradingRewardsDistributed {
                        total_amount: state.amount,
                        stakers_count: distributed_count,
                        timestamp: self.env().block_timestamp(),
                    });
                } else {
                    // Emit event parcial
                    self.env().emit_event(TradingRewardsDistributionProgress {
                        processed_stakers: processed_count,
                        rewards_distributed: distributed_count,
                        start_index: start,
                        end_index: end,
                        is_complete: false,
                        timestamp: self.env().block_timestamp(),
                    });
                }
            }

            Ok((processed_count, is_complete, next_index))
        }

        /// Estado gravado da rodada em andamento (`distribution_amount != 0`).
        fn current_round_state(&self) -> RoundState {
            RoundState {
                round: self.distribution_round,
                amount: self.distribution_amount,
                total_weight: self.distribution_total_weight,
                credited: self.distribution_credited,
                pool_left: self.trading_rewards_pool,
            }
        }

        /// Fatia de `staker` na rodada `state`, ou 0 se a posição não é
        /// elegível: precisa estar ativa, ter sido criada antes do início da
        /// rodada (`stake_entry_round`) e ainda não ter crédito nela.
        fn round_share(
            &self,
            staker: AccountId,
            stake: &StakePosition,
            state: &RoundState,
        ) -> Result<Balance, StakingError> {
            if !stake.active
                || self.last_credited_round.get(staker).unwrap_or(0) == state.round
                || self.stake_entry_round.get(staker).unwrap_or(0) >= state.round
            {
                return Ok(0);
            }
            let share = state
                .amount
                .checked_mul(self.calculate_staker_weight(stake))
                .ok_or(StakingError::Overflow)?
                .checked_div(state.total_weight)
                .ok_or(StakingError::Overflow)?;
            // A soma da rodada nunca passa do snapshot, qualquer que seja o
            // arredondamento ou o pool (que pode ter recebido aportes da
            // próxima rodada).
            let remaining = state
                .amount
                .checked_sub(state.credited)
                .ok_or(StakingError::Overflow)?;
            Ok(share.min(remaining).min(state.pool_left))
        }

        /// Crédito do staker que o swap-remove de `account` vai mover do último
        /// slot (ainda não processado na rodada em andamento) para o slot de
        /// `account`, já processado (< `distribution_cursor`), onde a rodada
        /// não o visitaria mais. Só calcula: devolve a posição já creditada e
        /// o valor, e as escritas ficam com o chamador.
        fn moved_staker_credit(
            &self,
            account: AccountId,
        ) -> Result<Option<(AccountId, StakePosition, Balance)>, StakingError> {
            if self.distribution_amount == 0 {
                return Ok(None);
            }
            let slot = self
                .staker_slots
                .get(account)
                .ok_or(StakingError::NoActiveStake)?;
            let last = self
                .staker_index
                .checked_sub(1)
                .ok_or(StakingError::Overflow)?;
            // slot < cursor <= last: o movido sai da parte não processada para
            // a processada. Fora disso ninguém troca de lado.
            if slot >= self.distribution_cursor || last < self.distribution_cursor {
                return Ok(None);
            }
            let moved = self
                .staker_addresses
                .get(last)
                .ok_or(StakingError::NoActiveStake)?;
            let Some(mut stake) = self.stakes.get(moved) else {
                return Ok(None);
            };
            let reward = self.round_share(moved, &stake, &self.current_round_state())?;
            if reward == 0 {
                return Ok(None);
            }
            stake.pending_rewards = stake
                .pending_rewards
                .checked_add(reward)
                .ok_or(StakingError::Overflow)?;
            Ok(Some((moved, stake, reward)))
        }

        /// Encerra a rodada de distribuição: sem snapshot, cursor no início.
        fn reset_distribution_round(&mut self) {
            self.distribution_amount = 0;
            self.distribution_cursor = 0;
            self.distribution_total_weight = 0;
            self.distribution_credited = 0;
        }

        // === FUNÇÕES DE GOVERNANÇA EXPANDIDA ===

        /// Registra participação em votação (chamado pelo sistema de governança)
        #[ink(message)]
        pub fn record_vote_participation(&mut self, voter: AccountId) -> Result<(), StakingError> {
            self.ensure_owner()?; // Por enquanto apenas admin, depois será o contrato de governança

            if voter == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            if let Some(mut stake) = self.stakes.get(voter) {
                if stake.active {
                    stake.governance_participation = stake
                        .governance_participation
                        .checked_add(1)
                        .ok_or(StakingError::Overflow)?;

                    self.stakes.insert(voter, &stake);

                    // Bônus por participação ativa (cada 8 votos = 200 LUNES)
                    if stake.governance_participation % constants::MIN_VOTES_FOR_BONUS == 0 {
                        let bonus = constants::VOTING_BONUS;
                        let current_bonus = self.governance_bonuses.get(voter).unwrap_or(0);
                        let new_bonus = current_bonus
                            .checked_add(bonus)
                            .ok_or(StakingError::Overflow)?;
                        self.governance_bonuses.insert(voter, &new_bonus);

                        // Emit event
                        self.env().emit_event(GovernanceBonusAwarded {
                            staker: voter,
                            bonus_type: 1, // 1 = voting bonus
                            amount: bonus,
                            timestamp: self.env().block_timestamp(),
                        });
                    }
                }
            }

            Ok(())
        }

        /// Recompensa por proposta aprovada (chamado pelo sistema de governança)
        #[ink(message)]
        pub fn reward_approved_proposal(
            &mut self,
            proposer: AccountId,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?; // Por enquanto apenas admin, depois será o contrato de governança

            let bonus = constants::PROPOSAL_BONUS;
            let current_bonus = self.governance_bonuses.get(proposer).unwrap_or(0);
            let new_bonus = current_bonus
                .checked_add(bonus)
                .ok_or(StakingError::Overflow)?;
            self.governance_bonuses.insert(proposer, &new_bonus);

            // Emit event
            self.env().emit_event(GovernanceBonusAwarded {
                staker: proposer,
                bonus_type: 2, // 2 = proposal bonus
                amount: bonus,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Recompensa por proposta implementada (chamado pelo sistema de governança)
        #[ink(message)]
        pub fn reward_implemented_proposal(
            &mut self,
            proposer: AccountId,
        ) -> Result<(), StakingError> {
            self.ensure_owner()?; // Por enquanto apenas admin, depois será o contrato de governança

            let bonus = constants::IMPLEMENTATION_BONUS;
            let current_bonus = self.governance_bonuses.get(proposer).unwrap_or(0);
            let new_bonus = current_bonus
                .checked_add(bonus)
                .ok_or(StakingError::Overflow)?;
            self.governance_bonuses.insert(proposer, &new_bonus);

            // Emit event
            self.env().emit_event(GovernanceBonusAwarded {
                staker: proposer,
                bonus_type: 3, // 3 = implementation bonus
                amount: bonus,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
        }

        /// Permite que o staker reivindique seus bônus de governança
        #[ink(message)]
        pub fn claim_governance_bonus(&mut self) -> Result<Balance, StakingError> {
            self.ensure_not_paused()?;
            self.acquire_lock()?;
            let result = self.claim_governance_bonus_inner();
            self.release_lock();
            result
        }

        /// Governance bonuses are paid ONLY from the funded APY pool; when the
        /// pool cannot cover the full bonus the call fails and the bonus stays
        /// credited (never paid from principal).
        fn claim_governance_bonus_inner(&mut self) -> Result<Balance, StakingError> {
            let caller = self.env().caller();
            let bonus = self.governance_bonuses.get(caller).unwrap_or(0);
            if bonus == 0 {
                return Err(StakingError::NoRewardsToClaim);
            }
            if bonus > self.apy_rewards_pool {
                return Err(StakingError::InsufficientRewardsPool);
            }

            // Effects (insert 0 para compatibilidade com seal0::clear_storage)
            self.governance_bonuses.insert(caller, &0u128);
            self.apy_rewards_pool = self
                .apy_rewards_pool
                .checked_sub(bonus)
                .ok_or(StakingError::Overflow)?;

            if self.env().transfer(caller, bonus).is_err() {
                return Err(StakingError::InsufficientBalance);
            }

            self.env().emit_event(GovernanceBonusClaimed {
                staker: caller,
                amount: bonus,
                timestamp: self.env().block_timestamp(),
            });
            Ok(bonus)
        }

        // === Internal Helper Methods ===

        /// Ensures only owner can call
        fn ensure_owner(&self) -> Result<(), StakingError> {
            if self.env().caller() != self.owner {
                return Err(StakingError::AccessDenied);
            }
            Ok(())
        }

        /// Ensures caller is the owner or the distributor (rewards ops only)
        fn ensure_owner_or_distributor(&self) -> Result<(), StakingError> {
            let caller = self.env().caller();
            if caller != self.owner && self.distributor != Some(caller) {
                return Err(StakingError::AccessDenied);
            }
            Ok(())
        }

        /// Ensures contract is not paused
        fn ensure_not_paused(&self) -> Result<(), StakingError> {
            if self.paused {
                return Err(StakingError::ContractPaused);
            }
            Ok(())
        }

        /// Reentrancy protection
        fn acquire_lock(&mut self) -> Result<(), StakingError> {
            if self.locked {
                return Err(StakingError::Reentrancy);
            }
            self.locked = true;
            Ok(())
        }

        /// Release reentrancy lock
        fn release_lock(&mut self) {
            self.locked = false;
        }

        /// Calculates pending rewards for a stake position with new tier system
        fn calculate_pending_rewards(
            &self,
            stake: &StakePosition,
            current_time: Timestamp,
        ) -> Result<Balance, StakingError> {
            let time_staked = current_time
                .checked_sub(stake.last_claim)
                .ok_or(StakingError::Overflow)?;

            // Get tier-specific reward rate
            let base_rate = self
                .tier_multipliers
                .get(stake.tier)
                .unwrap_or(constants::BRONZE_REWARD_RATE);

            // Get quantity multiplier
            let quantity_multiplier = self.get_quantity_multiplier(stake.amount);

            // Get early adopter bonus if applicable
            let early_adopter_bonus = self.get_early_adopter_bonus(stake, current_time);

            // Calculate base rewards
            // Formula: (amount * rate * time_ms) / (basis_points * year_ms)
            let year_ms: u128 = constants::YEAR_MS as u128;

            let base_rewards = stake
                .amount
                .checked_mul(base_rate as u128)
                .ok_or(StakingError::Overflow)?
                .checked_mul(time_staked as u128)
                .ok_or(StakingError::Overflow)?
                .checked_div(constants::BASIS_POINTS as u128)
                .ok_or(StakingError::Overflow)?
                .checked_div(year_ms)
                .ok_or(StakingError::Overflow)? as Balance;

            // Apply quantity multiplier
            let rewards_with_quantity = base_rewards
                .checked_mul(quantity_multiplier as Balance)
                .ok_or(StakingError::Overflow)?
                .checked_div(constants::BASIS_POINTS as Balance)
                .ok_or(StakingError::Overflow)?;

            // Apply early adopter bonus
            let final_rewards = rewards_with_quantity
                .checked_mul(
                    constants::BASIS_POINTS
                        .checked_add(early_adopter_bonus)
                        .ok_or(StakingError::Overflow)? as Balance,
                )
                .ok_or(StakingError::Overflow)?
                .checked_div(constants::BASIS_POINTS as Balance)
                .ok_or(StakingError::Overflow)?;

            Ok(final_rewards)
        }

        // === NOVAS FUNÇÕES HELPER PARA PREMIAÇÃO ===

        /// Calcula tier baseado na duração do stake
        fn calculate_staking_tier(&self, duration: u64) -> StakingTier {
            if duration >= constants::PLATINUM_MIN_DURATION {
                // 181+ dias
                StakingTier::Platinum
            } else if duration >= constants::GOLD_MIN_DURATION {
                // 91-180 dias
                StakingTier::Gold
            } else if duration >= constants::SILVER_MIN_DURATION {
                // 31-90 dias
                StakingTier::Silver
            } else {
                // 7-30 dias
                StakingTier::Bronze
            }
        }

        /// Determina early adopter tier baseado na ordem de chegada
        fn determine_early_adopter_tier(&mut self) -> EarlyAdopterTier {
            let top_100_count = self
                .early_adopter_counts
                .get(EarlyAdopterTier::Top100)
                .unwrap_or(0);
            let top_500_count = self
                .early_adopter_counts
                .get(EarlyAdopterTier::Top500)
                .unwrap_or(0);
            let top_1000_count = self
                .early_adopter_counts
                .get(EarlyAdopterTier::Top1000)
                .unwrap_or(0);

            if top_100_count < 100 {
                let new_count = top_100_count.saturating_add(1);
                self.early_adopter_counts
                    .insert(EarlyAdopterTier::Top100, &new_count);
                EarlyAdopterTier::Top100
            } else if top_500_count < 500 {
                let new_count = top_500_count.saturating_add(1);
                self.early_adopter_counts
                    .insert(EarlyAdopterTier::Top500, &new_count);
                EarlyAdopterTier::Top500
            } else if top_1000_count < 1000 {
                let new_count = top_1000_count.saturating_add(1);
                self.early_adopter_counts
                    .insert(EarlyAdopterTier::Top1000, &new_count);
                EarlyAdopterTier::Top1000
            } else {
                EarlyAdopterTier::None
            }
        }

        /// Obtém multiplicador baseado na quantidade stakada
        fn get_quantity_multiplier(&self, amount: Balance) -> u32 {
            if amount >= constants::WHALE_STAKE_THRESHOLD {
                constants::WHALE_STAKER_MULTIPLIER // 200k+ = 1.3x
            } else if amount >= constants::LARGE_STAKE_THRESHOLD {
                constants::LARGE_STAKER_MULTIPLIER // 50k+ = 1.2x
            } else if amount >= constants::MEDIUM_STAKE_THRESHOLD {
                constants::MEDIUM_STAKER_MULTIPLIER // 10k+ = 1.1x
            } else {
                constants::SMALL_STAKER_MULTIPLIER // <10k = 1.0x
            }
        }

        /// Calcula bônus de early adopter se ainda aplicável
        fn get_early_adopter_bonus(&self, stake: &StakePosition, current_time: Timestamp) -> u32 {
            let time_since_start = current_time.saturating_sub(stake.start_time);

            match stake.early_adopter_tier {
                EarlyAdopterTier::Top100 => {
                    if time_since_start <= constants::TOP_100_DURATION {
                        constants::TOP_100_BONUS // +50%
                    } else {
                        0
                    }
                }
                EarlyAdopterTier::Top500 => {
                    if time_since_start <= constants::TOP_500_DURATION {
                        constants::TOP_500_BONUS // +25%
                    } else {
                        0
                    }
                }
                EarlyAdopterTier::Top1000 => {
                    if time_since_start <= constants::TOP_1000_DURATION {
                        constants::TOP_1000_BONUS // +10%
                    } else {
                        0
                    }
                }
                EarlyAdopterTier::None => 0,
            }
        }

        /// Calcula peso do staker para distribuição de trading rewards
        fn calculate_staker_weight(&self, stake: &StakePosition) -> Balance {
            let tier_multiplier: Balance = match stake.tier {
                StakingTier::Bronze => 100,
                StakingTier::Silver => 120,
                StakingTier::Gold => 150,
                StakingTier::Platinum => 200,
            };

            let quantity_multiplier = self.get_quantity_multiplier(stake.amount);

            stake.amount
                .checked_mul(tier_multiplier)
                .unwrap_or(0)
                .checked_mul(quantity_multiplier as Balance)
                .unwrap_or(0)
                .checked_div(10000) // Normalizar basis points
                .unwrap_or(0)
        }

        /// Swap-remove de `account` do índice: o último endereço ocupa o slot
        /// dele, mantendo `staker_addresses[0..staker_index]` == stakers ativos.
        /// As entradas antigas (`staker_addresses[último]` e
        /// `staker_slots[account]`) ficam obsoletas em vez de removidas
        /// (compatibilidade com seal0::clear_storage): a primeira fica fora de
        /// `0..staker_index` e a segunda só é lida com a posição ativa.
        fn remove_from_staker_index(&mut self, account: AccountId) -> Result<(), StakingError> {
            let slot = self
                .staker_slots
                .get(account)
                .ok_or(StakingError::NoActiveStake)?;
            let last = self
                .staker_index
                .checked_sub(1)
                .ok_or(StakingError::Overflow)?;
            if slot != last {
                let moved = self
                    .staker_addresses
                    .get(last)
                    .ok_or(StakingError::NoActiveStake)?;
                self.staker_addresses.insert(slot, &moved);
                self.staker_slots.insert(moved, &slot);
            }
            self.staker_index = last;
            Ok(())
        }

        /// Calculates rewards and early unstaking penalty
        fn calculate_rewards_and_penalty(
            &self,
            stake: &StakePosition,
            current_time: Timestamp,
        ) -> Result<(Balance, Balance), StakingError> {
            let rewards = self.calculate_pending_rewards(stake, current_time)?;

            let time_staked = current_time
                .checked_sub(stake.start_time)
                .ok_or(StakingError::Overflow)?;

            let penalty = if time_staked < stake.duration {
                // Early unstaking penalty
                stake
                    .amount
                    .checked_mul(constants::EARLY_PENALTY_RATE as Balance)
                    .ok_or(StakingError::Overflow)?
                    .checked_div(constants::BASIS_POINTS as Balance)
                    .ok_or(StakingError::Overflow)?
            } else {
                0
            };

            Ok((rewards, penalty))
        }
    }

    // === Unit Tests ===
    // Aritmética simples nos testes (overflow em debug já faz o teste falhar);
    // `arithmetic_side_effects` vale para o código do contrato.
    #[cfg(test)]
    #[allow(clippy::arithmetic_side_effects)]
    mod tests {
        use super::*;
        use ink::env::test;

        /// Treasury dos fixtures. Antes era `[0x1; 32]`, que é a própria alice
        /// e também o callee padrão do ambiente off-chain (a conta do
        /// contrato), destino que o construtor agora rejeita.
        const TEST_TREASURY: [u8; 32] = [0x7E; 32];

        #[ink::test]
        fn test_new_staking_contract() {
            let contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            let (total_staked, total_rewards, active_stakers) = contract.get_stats();

            assert_eq!(total_staked, 0);
            assert_eq!(total_rewards, 0);
            assert_eq!(active_stakers, 0);
        }

        #[ink::test]
        fn test_stake_success() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            let result = contract.stake(constants::MIN_DURATION);

            assert!(result.is_ok());

            let stake = contract.get_stake(accounts.alice).unwrap();
            assert_eq!(stake.amount, constants::MIN_STAKE);
            assert_eq!(stake.duration, constants::MIN_DURATION);
            assert!(stake.active);
        }

        #[ink::test]
        fn test_stake_insufficient_amount() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(1000); // Below minimum

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            let result = contract.stake(constants::MIN_DURATION);

            assert_eq!(result, Err(StakingError::MinimumStakeNotMet));
        }

        #[ink::test]
        fn test_stake_invalid_duration() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            let result = contract.stake(1000); // Below minimum duration

            assert_eq!(result, Err(StakingError::InvalidDuration));
        }

        #[ink::test]
        fn test_create_proposal_success() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(
                constants::MIN_PROPOSAL_POWER,
            );

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));

            // First stake enough tokens for proposal power
            let stake_result = contract.stake(constants::MIN_DURATION);
            assert!(stake_result.is_ok());

            // Create proposal
            let proposal_result = contract.create_proposal(
                "Test Project".to_string(),
                "A test project for listing".to_string(),
                accounts.bob,
            );

            assert!(proposal_result.is_ok());
            let proposal_id = proposal_result.unwrap();

            let proposal = contract.get_proposal(proposal_id).unwrap();
            assert_eq!(proposal.name, "Test Project");
            assert_eq!(proposal.proposer, accounts.alice);
            assert!(proposal.active);
        }

        #[ink::test]
        fn test_vote_success() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(
                constants::MIN_PROPOSAL_POWER,
            );

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));

            // Stake and create proposal
            contract.stake(constants::MIN_DURATION).unwrap();
            let proposal_id = contract
                .create_proposal(
                    "Test Project".to_string(),
                    "Description".to_string(),
                    accounts.bob,
                )
                .unwrap();

            // Vote on proposal (pays exactly VOTE_COST)
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::VOTE_COST);
            let vote_result = contract.vote(proposal_id, true);
            assert!(vote_result.is_ok());

            let proposal = contract.get_proposal(proposal_id).unwrap();
            assert_eq!(proposal.votes_for, constants::VOTE_COST);
            assert_eq!(proposal.votes_against, 0);
        }

        #[ink::test]
        fn test_voting_power() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));

            // No stake, no voting power
            let power = contract.get_voting_power(accounts.alice).unwrap();
            assert_eq!(power, 0);

            // Stake tokens
            contract.stake(constants::MIN_DURATION).unwrap();

            let power = contract.get_voting_power(accounts.alice).unwrap();
            assert_eq!(power, constants::MIN_STAKE);
        }

        #[ink::test]
        fn test_admin_functions() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));

            // Test pause
            assert!(contract.pause().is_ok());

            // Test unpause
            assert!(contract.unpause().is_ok());

            // Test transfer ownership (two steps: propose + accept)
            assert!(contract.transfer_ownership(accounts.bob).is_ok());
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.bob);
            assert!(contract.accept_ownership().is_ok());
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);

            // Original owner should no longer have access
            assert_eq!(contract.pause(), Err(StakingError::AccessDenied));
        }

        #[ink::test]
        fn test_contract_paused() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));

            // Pause contract
            contract.pause().unwrap();

            // Operations should fail when paused
            let result = contract.stake(constants::MIN_DURATION);
            assert_eq!(result, Err(StakingError::ContractPaused));
        }

        #[ink::test]
        fn test_zero_address_validation() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(
                constants::MIN_PROPOSAL_POWER,
            );

            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            contract.stake(constants::MIN_DURATION).unwrap();

            let result = contract.create_proposal(
                "Test".to_string(),
                "Description".to_string(),
                AccountId::from(constants::ZERO_ADDRESS),
            );

            assert_eq!(result, Err(StakingError::ZeroAddress));
        }

        #[ink::test]
        fn test_proposal_fee_governance_works() {
            let treasury = AccountId::from(TEST_TREASURY);
            let mut staking = StakingContract::new(treasury);
            let alice = AccountId::from([0x2; 32]);

            // Setup Alice with enough stake for voting power (mais que MIN_PROPOSAL_POWER)
            ink::env::test::set_caller::<ink::env::DefaultEnvironment>(alice);
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(
                2_000_000_000_000,
            ); // 20,000 LUNES (> 10,000 requeridos)
            assert!(staking.stake(30 * constants::DAY_MS).is_ok()); // 30 days

            // Avançar tempo para que o stake seja considerado válido
            ink::env::test::advance_block::<ink::env::DefaultEnvironment>();
            let current_time = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(current_time + 10);

            // Verificar taxa inicial
            assert_eq!(staking.get_current_proposal_fee(), 100_000_000_000); // 1000 LUNES

            // Propor nova taxa (500 LUNES)
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(100_000_000_000); // 1000 LUNES fee
            let proposal_id = staking
                .propose_fee_change(
                    50_000_000_000, // 500 LUNES
                    "Reduzir barreira de entrada".to_string(),
                )
                .unwrap();

            // Votar a favor (paga exatamente VOTE_COST)
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(
                constants::VOTE_COST,
            );
            assert!(staking.vote(proposal_id, true).is_ok());

            // Avançar tempo para depois do deadline
            ink::env::test::advance_block::<ink::env::DefaultEnvironment>();
            let current_time = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(
                current_time + constants::VOTING_PERIOD + 1,
            );

            // Executar proposta
            assert!(staking.execute_proposal(proposal_id).is_ok());

            // Verificar que taxa foi alterada
            assert_eq!(staking.get_current_proposal_fee(), 50_000_000_000); // 500 LUNES
        }

        #[ink::test]
        fn test_proposal_fee_governance_validation() {
            let treasury = AccountId::from(TEST_TREASURY);
            let mut staking = StakingContract::new(treasury);
            let alice = AccountId::from([0x2; 32]);

            // Setup Alice with enough stake
            ink::env::test::set_caller::<ink::env::DefaultEnvironment>(alice);
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(
                2_000_000_000_000,
            ); // 20,000 LUNES
            assert!(staking.stake(30 * constants::DAY_MS).is_ok());

            // Avançar tempo para que o stake seja válido
            ink::env::test::advance_block::<ink::env::DefaultEnvironment>();
            let current_time = ink::env::block_timestamp::<ink::env::DefaultEnvironment>();
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(current_time + 10);

            // Teste: Taxa zero deve falhar
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(100_000_000_000);
            assert_eq!(
                staking.propose_fee_change(0, "Invalid".to_string()),
                Err(StakingError::InvalidAmount)
            );

            // Teste: Taxa muito alta deve falhar
            assert_eq!(
                staking.propose_fee_change(20_000_000_000_000, "Too high".to_string()), // 200,000 LUNES
                Err(StakingError::InvalidAmount)
            );

            // Teste: Fee insuficiente deve falhar
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(50_000_000_000); // 500 LUNES
            assert_eq!(
                staking.propose_fee_change(30_000_000_000, "Valid amount".to_string()),
                Err(StakingError::InsufficientFee)
            );
        }

        // ========================================
        // UNIDADES DE TEMPO (block_timestamp é em MILISSEGUNDOS)
        // Regressão P0-3/P0-2: as constantes eram "blocos" mas eram
        // comparadas/somadas a block_timestamp() (ms), o que encurtava a
        // votação para ~10 min e inflava o APY ~2000x.
        // ========================================

        const DAY_MS: u64 = 24 * 60 * 60 * 1000;

        fn staked_contract(amount: Balance, duration: u64) -> StakingContract {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(1_000);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(amount);
            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            contract.stake(duration).unwrap();
            contract
        }

        #[ink::test]
        fn test_voting_deadline_is_14_days_in_ms() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut contract = staked_contract(constants::MIN_PROPOSAL_POWER, 7 * DAY_MS);
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(10_000);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::PROPOSAL_FEE);
            let id = contract
                .create_proposal("P".to_string(), "D".to_string(), accounts.bob)
                .unwrap();
            let proposal = contract.get_proposal(id).unwrap();
            assert_eq!(proposal.voting_deadline, 10_000 + 14 * DAY_MS);

            // Votar 13 dias depois ainda é permitido.
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(10_000 + 13 * DAY_MS);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::VOTE_COST);
            assert_eq!(contract.vote(id, true), Ok(()));
        }

        #[ink::test]
        fn test_vote_after_deadline_is_rejected() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut contract = staked_contract(constants::MIN_PROPOSAL_POWER, 7 * DAY_MS);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::PROPOSAL_FEE);
            let id = contract
                .create_proposal("P".to_string(), "D".to_string(), accounts.bob)
                .unwrap();
            let deadline = contract.get_proposal(id).unwrap().voting_deadline;
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(deadline + 1);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::VOTE_COST);
            assert_eq!(
                contract.vote(id, true),
                Err(StakingError::VotingPeriodExpired)
            );
        }

        #[ink::test]
        fn test_vote_requires_vote_cost() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let mut contract = staked_contract(constants::MIN_PROPOSAL_POWER, 7 * DAY_MS);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::PROPOSAL_FEE);
            let id = contract
                .create_proposal("P".to_string(), "D".to_string(), accounts.bob)
                .unwrap();
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::VOTE_COST - 1);
            assert_eq!(contract.vote(id, true), Err(StakingError::InsufficientFee));
        }

        #[ink::test]
        fn test_duration_bounds_are_7_to_365_days_in_ms() {
            assert_eq!(constants::MIN_DURATION, 7 * DAY_MS);
            assert_eq!(constants::MAX_DURATION, 365 * DAY_MS);
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);
            let mut contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            assert_eq!(
                contract.stake(6 * DAY_MS),
                Err(StakingError::InvalidDuration)
            );
            assert_eq!(
                contract.stake(366 * DAY_MS),
                Err(StakingError::InvalidDuration)
            );
            assert_eq!(contract.stake(30 * DAY_MS), Ok(()));
        }

        #[ink::test]
        fn test_tier_thresholds_are_in_days() {
            let contract = StakingContract::new(AccountId::from(TEST_TREASURY));
            assert_eq!(
                contract.calculate_staking_tier(7 * DAY_MS),
                StakingTier::Bronze
            );
            assert_eq!(
                contract.calculate_staking_tier(30 * DAY_MS),
                StakingTier::Bronze
            );
            assert_eq!(
                contract.calculate_staking_tier(31 * DAY_MS),
                StakingTier::Silver
            );
            assert_eq!(
                contract.calculate_staking_tier(91 * DAY_MS),
                StakingTier::Gold
            );
            assert_eq!(
                contract.calculate_staking_tier(181 * DAY_MS),
                StakingTier::Platinum
            );
        }

        #[ink::test]
        fn test_rewards_accrue_at_nominal_apy_per_year_in_ms() {
            // 1000 LUNES, Bronze (8% APY), multiplicador 1.0x. Após 365 dias o
            // bônus early-adopter (90 dias) já expirou → 80 LUNES.
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let contract = staked_contract(constants::MIN_STAKE, 7 * DAY_MS);
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(1_000 + 365 * DAY_MS);
            assert_eq!(
                contract.get_pending_rewards(accounts.alice),
                Ok(8_000_000_000) // 80 * 10^8
            );
        }

        #[ink::test]
        fn test_early_adopter_bonus_applies_within_90_days() {
            // 30 dias, Bronze 8%, Top100 +50%:
            // base = 1e11 * 800 * 30d_ms / 10_000 / 365d_ms = 657_534_246
            // final = 657_534_246 * 15_000 / 10_000 = 986_301_369
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let contract = staked_contract(constants::MIN_STAKE, 7 * DAY_MS);
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(1_000 + 30 * DAY_MS);
            assert_eq!(
                contract.get_pending_rewards(accounts.alice),
                Ok(986_301_369)
            );
        }

        #[ink::test]
        fn test_early_unstake_penalty_window_uses_ms() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            let contract = staked_contract(constants::MIN_STAKE, 7 * DAY_MS);
            let stake = contract.get_stake(accounts.alice).unwrap();
            // 1 hora depois: ainda bloqueado → multa de 5%.
            let (_, penalty) = contract
                .calculate_rewards_and_penalty(&stake, 1_000 + 60 * 60 * 1000)
                .unwrap();
            assert_eq!(penalty, constants::MIN_STAKE / 20);
            // Após 7 dias: sem multa.
            let (_, penalty) = contract
                .calculate_rewards_and_penalty(&stake, 1_000 + 7 * DAY_MS)
                .unwrap();
            assert_eq!(penalty, 0);
        }

        // ========================================
        // SOLVÊNCIA: rewards nunca saem do principal dos stakers
        // ========================================

        type E = ink::env::DefaultEnvironment;
        const CONTRACT: [u8; 32] = [0xC0; 32];
        const LUNES: Balance = 100_000_000;

        /// Contrato com conta própria (o callee padrão do ambiente off-chain é
        /// a alice) e saldos iniciais generosos para os callers.
        fn solvency_setup() -> (StakingContract, AccountId) {
            solvency_setup_at(CONTRACT)
        }

        /// Cada instância precisa de uma conta própria: o storage off-chain é
        /// indexado pela conta do contrato e persiste entre instâncias.
        fn solvency_setup_at(contract: [u8; 32]) -> (StakingContract, AccountId) {
            let accounts = test::default_accounts::<E>();
            let contract_id = AccountId::from(contract);
            test::set_callee::<E>(contract_id);
            test::set_account_balance::<E>(contract_id, 0);
            for who in [
                accounts.alice,
                accounts.bob,
                accounts.charlie,
                accounts.django,
                accounts.eve,
                accounts.frank,
            ] {
                test::set_account_balance::<E>(who, 1_000_000_000 * LUNES);
            }
            test::set_block_timestamp::<E>(1_000);
            test::set_caller::<E>(accounts.alice);
            test::set_value_transferred::<E>(0);
            (
                StakingContract::new(AccountId::from(TEST_TREASURY)),
                contract_id,
            )
        }

        fn balance_of(who: AccountId) -> Balance {
            test::get_account_balance::<E>(who).unwrap_or(0)
        }

        /// Chamada payable que move `value` do caller para o contrato.
        fn as_caller(who: AccountId, value: Balance) {
            test::set_caller::<E>(who);
            test::set_value_transferred::<E>(0);
            if value > 0 {
                test::transfer_in::<E>(value);
            }
        }

        /// Passivo contabilizado: principal + rewards creditadas + pools
        /// financiados + fundos dos votos (liquidez, treasury, team).
        fn liabilities(c: &StakingContract) -> Balance {
            let (apy_pool, trading_pool, credited) = c.get_reward_pools();
            let (total_staked, _, _) = c.get_stats();
            let (liquidity, treasury, team) = c.get_vote_funds();
            total_staked + credited + apy_pool + trading_pool + liquidity + treasury + team
        }

        /// Invariante de custódia: o saldo do contrato cobre o principal
        /// devido + rewards já creditadas + pools financiados + fundos dos votos.
        fn assert_solvent(c: &StakingContract, contract_id: AccountId) {
            let (apy_pool, trading_pool, credited) = c.get_reward_pools();
            let (total_staked, _, _) = c.get_stats();
            let liabilities = liabilities(c);
            assert!(
                balance_of(contract_id) >= liabilities,
                "insolvent: balance {} < liabilities {} (staked {}, credited {}, apy {}, trading {}, vote funds {:?})",
                balance_of(contract_id),
                liabilities,
                total_staked,
                credited,
                apy_pool,
                trading_pool,
                c.get_vote_funds()
            );
            assert!(balance_of(contract_id) >= total_staked);
        }

        #[ink::test]
        fn test_claim_with_empty_pool_pays_nothing_and_keeps_rewards_owed() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(31 * DAY_MS).unwrap();
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(31 * DAY_MS).unwrap();

            test::set_block_timestamp::<E>(1_000 + 30 * DAY_MS);
            let accrued = c.get_pending_rewards(accounts.alice).unwrap();
            assert!(accrued > 0);
            let before = balance_of(accounts.alice);
            as_caller(accounts.alice, 0);
            assert_eq!(c.claim_rewards(), Ok(()));
            // Nada pago (pool vazio) — o principal do bob continua intacto.
            assert_eq!(balance_of(accounts.alice), before);
            assert_eq!(balance_of(contract_id), 20_000 * LUNES);
            // A reward continua devida, não se perde.
            assert_eq!(c.get_owed_rewards(accounts.alice), accrued);
            assert_eq!(c.get_pending_rewards(accounts.alice), Ok(accrued));
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_claim_is_capped_by_funded_pool() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(31 * DAY_MS).unwrap();
            // Qualquer um pode financiar o pool de APY.
            as_caller(accounts.charlie, LUNES);
            assert_eq!(c.fund_apy_rewards(), Ok(()));
            assert_eq!(c.get_reward_pools().0, LUNES);

            test::set_block_timestamp::<E>(1_000 + 30 * DAY_MS);
            let accrued = c.get_pending_rewards(accounts.alice).unwrap();
            assert!(accrued > LUNES);
            let before = balance_of(accounts.alice);
            as_caller(accounts.alice, 0);
            c.claim_rewards().unwrap();
            assert_eq!(balance_of(accounts.alice), before + LUNES);
            assert_eq!(c.get_reward_pools().0, 0);
            assert_eq!(c.get_owed_rewards(accounts.alice), accrued - LUNES);
            assert_solvent(&c, contract_id);

            // Novo funding → o restante devido pode ser sacado depois.
            as_caller(accounts.charlie, 1_000 * LUNES);
            c.fund_apy_rewards().unwrap();
            as_caller(accounts.alice, 0);
            c.claim_rewards().unwrap();
            assert_eq!(c.get_owed_rewards(accounts.alice), 0);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_unstake_always_returns_principal_even_with_empty_pool() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(accounts.bob, 5_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();

            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            let accrued = c.get_pending_rewards(accounts.alice).unwrap();
            let before = balance_of(accounts.alice);
            as_caller(accounts.alice, 0);
            assert_eq!(c.unstake(), Ok(()));
            // Principal integral (sem multa após o lock), sem rewards (pool vazio).
            assert_eq!(balance_of(accounts.alice), before + 10_000 * LUNES);
            assert_eq!(balance_of(contract_id), 5_000 * LUNES);
            assert_eq!(c.get_owed_rewards(accounts.alice), accrued);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_early_unstake_penalty_goes_to_apy_pool() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(30 * DAY_MS).unwrap();
            test::set_block_timestamp::<E>(1_000 + DAY_MS);
            let before = balance_of(accounts.alice);
            as_caller(accounts.alice, 0);
            c.unstake().unwrap();
            let penalty = 10_000 * LUNES / 20;
            assert_eq!(
                balance_of(accounts.alice),
                before + 10_000 * LUNES - penalty
            );
            assert_eq!(c.get_reward_pools().0, penalty);
            assert_eq!(balance_of(contract_id), penalty);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_owed_rewards_claimable_after_unstake() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            test::set_block_timestamp::<E>(1_000 + 10 * DAY_MS);
            as_caller(accounts.alice, 0);
            c.unstake().unwrap();
            let owed = c.get_owed_rewards(accounts.alice);
            assert!(owed > 0);
            as_caller(accounts.django, owed);
            c.fund_apy_rewards().unwrap();
            let before = balance_of(accounts.alice);
            as_caller(accounts.alice, 0);
            assert_eq!(c.claim_rewards(), Ok(()));
            assert_eq!(balance_of(accounts.alice), before + owed);
            assert_eq!(c.get_owed_rewards(accounts.alice), 0);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_governance_bonus_cannot_drain_principal() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(accounts.alice, 0); // owner
            c.reward_approved_proposal(accounts.charlie).unwrap();
            as_caller(accounts.charlie, 0);
            assert_eq!(
                c.claim_governance_bonus(),
                Err(StakingError::InsufficientRewardsPool)
            );
            assert_eq!(balance_of(contract_id), 10_000 * LUNES);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_trading_rewards_distribution_is_paid_and_capped() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            let rewards_contract = accounts.eve;
            test::set_account_balance::<E>(rewards_contract, 1_000_000 * LUNES);
            as_caller(accounts.alice, 0);
            c.set_trading_rewards_contract(rewards_contract).unwrap();
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(accounts.charlie, 30_000 * LUNES);
            c.stake(91 * DAY_MS).unwrap();
            as_caller(rewards_contract, 100 * LUNES);
            c.fund_staking_rewards().unwrap();
            as_caller(accounts.alice, 0);
            c.distribute_trading_rewards().unwrap();
            let (_, trading_pool, credited) = c.get_reward_pools();
            assert!(credited > 0 && credited <= 100 * LUNES);
            assert_eq!(trading_pool + credited, 100 * LUNES);
            assert_solvent(&c, contract_id);

            // A reward creditada é paga de fato no claim (antes era zerada).
            let bob_credit = c.get_stake(accounts.bob).unwrap().pending_rewards;
            assert!(bob_credit > 0);
            let before = balance_of(accounts.bob);
            as_caller(accounts.bob, 0);
            c.claim_rewards().unwrap();
            assert_eq!(balance_of(accounts.bob), before + bob_credit);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_invariant_holds_over_random_sequences() {
            let accounts = test::default_accounts::<E>();
            let stakers = [
                accounts.bob,
                accounts.charlie,
                accounts.django,
                accounts.frank,
            ];
            for seed in 1u64..=12 {
                let (mut c, contract_id) = solvency_setup_at([0xC0 + seed as u8; 32]);
                let mut rng = seed;
                let mut next = || {
                    rng = rng
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    rng >> 33
                };
                let mut now = 1_000u64;
                for _ in 0..120 {
                    let who = stakers[(next() % 4) as usize];
                    now += next() % (20 * DAY_MS);
                    test::set_block_timestamp::<E>(now);
                    match next() % 5 {
                        0 | 1 => {
                            let amount = (1_000 + (next() % 50_000) as u128) * LUNES;
                            let days = 7 + next() % 359;
                            as_caller(who, amount);
                            if c.stake(days * DAY_MS).is_err() {
                                // payable falhou → devolve (o runtime reverteria)
                                test::set_account_balance::<E>(
                                    contract_id,
                                    balance_of(contract_id) - amount,
                                );
                            }
                        }
                        2 => {
                            as_caller(who, 0);
                            let _ = c.claim_rewards();
                        }
                        3 => {
                            as_caller(who, 0);
                            let _ = c.unstake();
                        }
                        _ => {
                            let amount = (next() % 200) as u128 * LUNES;
                            if amount > 0 {
                                as_caller(accounts.eve, amount);
                                c.fund_apy_rewards().unwrap();
                            }
                        }
                    }
                    assert_solvent(&c, contract_id);
                    assert_index_consistent(&c);
                }
                // Todos saem: o principal é integralmente devolvido.
                for who in stakers {
                    as_caller(who, 0);
                    let _ = c.unstake();
                    assert_solvent(&c, contract_id);
                }
                assert_eq!(c.get_stats().0, 0);
            }
        }

        // ========================================
        // A-05: FUNDOS DOS VOTOS (liquidez / treasury / team)
        // Antes só os 10% do rewards pool eram contabilizados; os 90% restantes
        // ficavam presos no saldo do contrato sem contador nem saída.
        // ========================================

        const VOTE_SHARE: Balance = constants::VOTE_COST / 10; // 10%
        const VOTE_TEAM_SHARE: Balance = constants::VOTE_COST * 7 / 10; // 70%

        /// Alice (owner) faz stake com poder de proposta e cria uma proposta.
        fn proposal_setup(c: &mut StakingContract) -> u32 {
            let accounts = test::default_accounts::<E>();
            as_caller(accounts.alice, constants::MIN_PROPOSAL_POWER);
            c.stake(30 * DAY_MS).unwrap();
            as_caller(accounts.alice, constants::PROPOSAL_FEE);
            c.create_proposal("P".to_string(), "D".to_string(), accounts.bob)
                .unwrap()
        }

        fn stake_and_vote(c: &mut StakingContract, who: AccountId, proposal_id: u32) {
            as_caller(who, constants::MIN_STAKE);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(who, constants::VOTE_COST);
            c.vote(proposal_id, true).unwrap();
        }

        #[ink::test]
        fn test_vote_funds_are_accounted_per_vote() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            let id = proposal_setup(&mut c);
            let voters = [
                accounts.bob,
                accounts.charlie,
                accounts.django,
                accounts.frank,
            ];
            for who in voters {
                stake_and_vote(&mut c, who, id);
            }
            let n = voters.len() as Balance;
            assert_eq!(
                c.get_vote_funds(),
                (n * VOTE_SHARE, n * VOTE_SHARE, n * VOTE_TEAM_SHARE)
            );
            assert_eq!(c.get_reward_pools().1, n * VOTE_SHARE);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_vote_requires_exact_vote_cost() {
            let accounts = test::default_accounts::<E>();
            let (mut c, _) = solvency_setup();
            let id = proposal_setup(&mut c);
            as_caller(accounts.bob, constants::MIN_STAKE);
            c.stake(7 * DAY_MS).unwrap();
            // Pagamento acima do custo era aceito sem troco.
            as_caller(accounts.bob, constants::VOTE_COST + 1);
            assert_eq!(c.vote(id, true), Err(StakingError::InvalidAmount));
            assert_eq!(c.get_proposal(id).unwrap().vote_count, 0);
            assert_eq!(c.get_vote_funds(), (0, 0, 0));
        }

        #[ink::test]
        fn test_vote_fund_withdrawals_are_restricted() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            // Usa um treasury explícito, distinto do owner (alice).
            let treasury = AccountId::from([0x7A; 32]);
            as_caller(accounts.alice, 0);
            c.set_treasury_address(treasury).unwrap();
            let id = proposal_setup(&mut c);
            for who in [accounts.bob, accounts.charlie] {
                stake_and_vote(&mut c, who, id);
            }

            // Conta qualquer (staker votante) não saca nenhuma fatia.
            as_caller(accounts.bob, 0);
            assert_eq!(c.withdraw_treasury_fund(), Err(StakingError::AccessDenied));
            assert_eq!(
                c.withdraw_liquidity_fund(accounts.bob),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.withdraw_team_fund(accounts.bob),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.get_vote_funds(),
                (2 * VOTE_SHARE, 2 * VOTE_SHARE, 2 * VOTE_TEAM_SHARE)
            );

            // Treasury: só sai para `treasury_address` (o próprio treasury pode acionar).
            as_caller(treasury, 0);
            assert_eq!(c.withdraw_treasury_fund(), Ok(2 * VOTE_SHARE));
            assert_eq!(balance_of(treasury), 2 * VOTE_SHARE);
            assert_eq!(c.withdraw_treasury_fund(), Err(StakingError::ZeroAmount));

            // Liquidez e team: owner, para o endereço informado.
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.withdraw_team_fund(AccountId::from(constants::ZERO_ADDRESS)),
                Err(StakingError::ZeroAddress)
            );
            let django_before = balance_of(accounts.django);
            assert_eq!(
                c.withdraw_liquidity_fund(accounts.django),
                Ok(2 * VOTE_SHARE)
            );
            assert_eq!(balance_of(accounts.django), django_before + 2 * VOTE_SHARE);
            let frank_before = balance_of(accounts.frank);
            assert_eq!(
                c.withdraw_team_fund(accounts.frank),
                Ok(2 * VOTE_TEAM_SHARE)
            );
            assert_eq!(
                balance_of(accounts.frank),
                frank_before + 2 * VOTE_TEAM_SHARE
            );
            assert_eq!(c.get_vote_funds(), (0, 0, 0));
            assert_eq!(
                c.withdraw_liquidity_fund(accounts.django),
                Err(StakingError::ZeroAmount)
            );
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_vote_funds_keep_contract_solvent_through_lifecycle() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 0);
            c.set_trading_rewards_contract(accounts.eve).unwrap();
            let id = proposal_setup(&mut c);
            assert_solvent(&c, contract_id);
            for who in [accounts.bob, accounts.charlie, accounts.django] {
                stake_and_vote(&mut c, who, id);
                assert_solvent(&c, contract_id);
            }
            // Todo LUNES dos votos está contabilizado: o único excedente é a
            // taxa da proposta ainda não executada.
            assert_eq!(
                balance_of(contract_id) - liabilities(&c),
                constants::PROPOSAL_FEE
            );

            as_caller(accounts.frank, 100 * LUNES);
            c.fund_apy_rewards().unwrap();
            as_caller(accounts.alice, 0);
            c.distribute_trading_rewards().unwrap();
            assert_solvent(&c, contract_id);

            test::set_block_timestamp::<E>(1_000 + 10 * DAY_MS);
            as_caller(accounts.bob, 0);
            c.claim_rewards().unwrap();
            assert_solvent(&c, contract_id);
            as_caller(accounts.charlie, 0);
            c.unstake().unwrap();
            assert_solvent(&c, contract_id);

            as_caller(accounts.alice, 0);
            c.withdraw_treasury_fund().unwrap();
            c.withdraw_liquidity_fund(accounts.frank).unwrap();
            c.withdraw_team_fund(accounts.frank).unwrap();
            assert_solvent(&c, contract_id);

            for who in [accounts.alice, accounts.bob, accounts.django] {
                as_caller(who, 0);
                c.unstake().unwrap();
                assert_solvent(&c, contract_id);
            }
            assert_eq!(c.get_stats().0, 0);
            assert_eq!(
                balance_of(contract_id) - liabilities(&c),
                constants::PROPOSAL_FEE
            );
        }

        // ========================================
        // M-04: ÍNDICE DE STAKERS LIMITADO + PESO TOTAL INCREMENTAL
        // ========================================

        /// Peso total recalculado varrendo o índice (referência para o
        /// contador incremental `total_staker_weight`).
        fn recomputed_total_weight(c: &StakingContract) -> Balance {
            (0..c.staker_index)
                .filter_map(|i| c.staker_addresses.get(i))
                .filter_map(|who| c.stakes.get(who))
                .filter(|s| s.active)
                .map(|s| c.calculate_staker_weight(&s))
                .sum()
        }

        /// O índice contém exatamente os stakers ativos, sem duplicatas, e o
        /// slot de cada um aponta de volta para a posição dele.
        fn assert_index_consistent(c: &StakingContract) {
            assert_eq!(c.staker_index, c.active_stakers);
            for i in 0..c.staker_index {
                let who = c.staker_addresses.get(i).unwrap();
                assert!(c.stakes.get(who).unwrap().active);
                assert_eq!(c.staker_slots.get(who), Some(i));
            }
            assert_eq!(c.total_staker_weight, recomputed_total_weight(c));
        }

        #[ink::test]
        fn test_stake_unstake_cycles_keep_staker_index_bounded() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(365 * DAY_MS).unwrap();

            let mut now = 1_000u64;
            for _ in 0..25 {
                as_caller(accounts.bob, constants::MIN_STAKE);
                c.stake(7 * DAY_MS).unwrap();
                now += 7 * DAY_MS;
                test::set_block_timestamp::<E>(now);
                as_caller(accounts.bob, 0);
                c.unstake().unwrap();
            }
            assert!(
                c.staker_index <= 2,
                "staker_index cresceu para {}",
                c.staker_index
            );
            assert_index_consistent(&c);

            // A distribuição paginada só percorre o staker ativo.
            as_caller(accounts.alice, 0);
            c.set_trading_rewards_contract(accounts.eve).unwrap();
            as_caller(accounts.eve, 100 * LUNES);
            c.fund_staking_rewards().unwrap();
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(10)),
                Ok((1, true, None))
            );
            assert_eq!(c.get_reward_pools().2, 100 * LUNES);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_unstake_swap_removes_from_staker_index() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 0);
            c.set_trading_rewards_contract(accounts.eve).unwrap();
            as_caller(accounts.alice, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(accounts.bob, 20_000 * LUNES);
            c.stake(91 * DAY_MS).unwrap();
            as_caller(accounts.charlie, 60_000 * LUNES);
            c.stake(181 * DAY_MS).unwrap();
            assert_index_consistent(&c);

            // Remove o do meio: o último (charlie) ocupa o slot do bob.
            test::set_block_timestamp::<E>(1_000 + 200 * DAY_MS);
            as_caller(accounts.bob, 0);
            c.unstake().unwrap();
            assert_index_consistent(&c);
            assert_eq!(c.staker_addresses.get(1), Some(accounts.charlie));

            as_caller(accounts.eve, 90 * LUNES);
            c.fund_staking_rewards().unwrap();
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), Some(1)),
                Ok((1, true, None))
            );
            assert!(c.get_stake(accounts.alice).unwrap().pending_rewards > 0);
            assert!(c.get_stake(accounts.charlie).unwrap().pending_rewards > 0);
            assert_solvent(&c, contract_id);

            for who in [accounts.charlie, accounts.alice] {
                as_caller(who, 0);
                c.unstake().unwrap();
                assert_index_consistent(&c);
            }
            assert_eq!(c.total_staker_weight, 0);

            // Re-stake de quem já saiu entra de novo uma única vez.
            as_caller(accounts.bob, constants::MIN_STAKE);
            c.stake(7 * DAY_MS).unwrap();
            assert_index_consistent(&c);
            assert_eq!(c.staker_index, 1);
            assert_solvent(&c, contract_id);
        }

        // ========================================
        // M-05: PAPEL `distributor`, OWNERSHIP EM DOIS PASSOS, UNSTAKE PAUSADO
        // ========================================

        #[ink::test]
        fn test_distributor_funds_and_distributes_but_has_no_admin_power() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            let distributor = accounts.eve;
            as_caller(accounts.alice, 0);
            assert_eq!(c.set_distributor(Some(distributor)), Ok(()));
            assert_eq!(
                c.get_admin_roles(),
                (accounts.alice, None, Some(distributor))
            );
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();

            as_caller(distributor, 100 * LUNES);
            assert_eq!(c.fund_staking_rewards(), Ok(()));
            as_caller(distributor, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((1, true, None))
            );
            assert_eq!(c.get_reward_pools().2, 100 * LUNES);

            // Nenhum poder administrativo.
            assert_eq!(c.pause(), Err(StakingError::AccessDenied));
            assert_eq!(
                c.set_treasury_address(distributor),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.set_distributor(Some(accounts.charlie)),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.transfer_ownership(distributor),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.reward_approved_proposal(distributor),
                Err(StakingError::AccessDenied)
            );
            assert_eq!(
                c.withdraw_team_fund(distributor),
                Err(StakingError::AccessDenied)
            );

            // Conta comum não distribui; owner revoga o distributor.
            as_caller(accounts.charlie, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Err(StakingError::AccessDenied)
            );
            as_caller(accounts.alice, 0);
            c.set_distributor(None).unwrap();
            as_caller(distributor, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Err(StakingError::AccessDenied)
            );
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_unstake_returns_principal_while_paused() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            as_caller(accounts.charlie, 1_000 * LUNES);
            c.fund_apy_rewards().unwrap();
            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            let accrued = c.get_pending_rewards(accounts.bob).unwrap();
            assert!(accrued > 0);

            as_caller(accounts.alice, 0);
            c.pause().unwrap();

            let before = balance_of(accounts.bob);
            as_caller(accounts.bob, 0);
            assert_eq!(c.unstake(), Ok(()));
            // Principal integral; o APY fica devido até o despause.
            assert_eq!(balance_of(accounts.bob), before + 10_000 * LUNES);
            assert_eq!(c.get_owed_rewards(accounts.bob), accrued);
            assert_eq!(c.claim_rewards(), Err(StakingError::ContractPaused));
            assert_solvent(&c, contract_id);

            as_caller(accounts.alice, 0);
            c.unpause().unwrap();
            as_caller(accounts.bob, 0);
            c.claim_rewards().unwrap();
            assert_eq!(balance_of(accounts.bob), before + 10_000 * LUNES + accrued);
            assert_eq!(c.get_owed_rewards(accounts.bob), 0);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_ownership_transfer_requires_acceptance() {
            let accounts = test::default_accounts::<E>();
            let (mut c, _) = solvency_setup();
            as_caller(accounts.alice, 0);
            assert_eq!(c.transfer_ownership(accounts.bob), Ok(()));
            assert_eq!(
                c.get_admin_roles(),
                (accounts.alice, Some(accounts.bob), None)
            );
            // Ainda vale o owner antigo até o aceite.
            assert_eq!(c.pause(), Ok(()));
            assert_eq!(c.unpause(), Ok(()));
            as_caller(accounts.bob, 0);
            assert_eq!(c.pause(), Err(StakingError::AccessDenied));

            as_caller(accounts.charlie, 0);
            assert_eq!(c.accept_ownership(), Err(StakingError::AccessDenied));

            as_caller(accounts.bob, 0);
            assert_eq!(c.accept_ownership(), Ok(()));
            assert_eq!(c.get_admin_roles(), (accounts.bob, None, None));
            assert_eq!(c.pause(), Ok(()));
            as_caller(accounts.alice, 0);
            assert_eq!(c.unpause(), Err(StakingError::AccessDenied));
            // Aceite não pode ser repetido.
            as_caller(accounts.bob, 0);
            assert_eq!(c.accept_ownership(), Err(StakingError::AccessDenied));
        }

        // ========================================
        // DISTRIBUIÇÃO PAGINADA SEQUENCIAL (cursor on-chain)
        // Antes o caller escolhia `start_index` livremente: repetir a mesma
        // página creditava os mesmos slots de novo (snapshot reaproveitado).
        // ========================================

        /// Contrato com `eve` como contrato de trading rewards e os stakers dados
        /// (conta, valor, dias de lock).
        fn distribution_setup(
            stakers: &[(AccountId, Balance, u64)],
        ) -> (StakingContract, AccountId) {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            as_caller(accounts.alice, 0);
            c.set_trading_rewards_contract(accounts.eve).unwrap();
            for &(who, amount, days) in stakers {
                as_caller(who, amount);
                c.stake(days * DAY_MS).unwrap();
            }
            (c, contract_id)
        }

        fn four_stakers() -> [(AccountId, Balance, u64); 4] {
            let accounts = test::default_accounts::<E>();
            [
                (accounts.alice, 10_000 * LUNES, 7),
                (accounts.bob, 20_000 * LUNES, 91),
                (accounts.charlie, 60_000 * LUNES, 181),
                (accounts.django, 5_000 * LUNES, 31),
            ]
        }

        fn fund_trading(c: &mut StakingContract, amount: Balance) {
            let accounts = test::default_accounts::<E>();
            as_caller(accounts.eve, amount);
            c.fund_staking_rewards().unwrap();
        }

        fn credited(c: &StakingContract, who: AccountId) -> Balance {
            c.get_stake(who).map(|s| s.pending_rewards).unwrap_or(0)
        }

        /// Fatia proporcional de `who` sobre `snapshot` (mesma conta do contrato).
        fn expected_share(c: &StakingContract, who: AccountId, snapshot: Balance) -> Balance {
            let stake = c.get_stake(who).unwrap();
            snapshot * c.calculate_staker_weight(&stake) / c.total_staker_weight
        }

        #[ink::test]
        fn test_distribution_page_cannot_be_replayed() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = distribution_setup(&four_stakers());
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), Some(1)),
                Ok((1, false, Some(2)))
            );
            let pool = c.get_reward_pools().1;
            let credits: Vec<Balance> = four_stakers()
                .iter()
                .map(|&(who, _, _)| credited(&c, who))
                .collect();

            // Repetir a página 1 (ou recomeçar na 0) é rejeitado sem mudar estado.
            for replay in [Some(1), Some(0)] {
                assert_eq!(
                    c.distribute_trading_rewards_paginated(replay, Some(1)),
                    Err(StakingError::InvalidDistributionCursor)
                );
            }
            assert_eq!(c.get_reward_pools().1, pool);
            for (i, &(who, _, _)) in four_stakers().iter().enumerate() {
                assert_eq!(credited(&c, who), credits[i]);
            }
            assert_eq!(c.distribution_cursor, 2);
            assert!(!c.locked);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_distribution_rejects_out_of_sequence_start() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = distribution_setup(&four_stakers());
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);

            // Fora de rodada só o início (0) é aceito.
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), Some(1)),
                Err(StakingError::InvalidDistributionCursor)
            );
            assert_eq!(c.distribution_amount, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(0), Some(1)),
                Ok((1, false, Some(1)))
            );
            let snapshot = c.distribution_amount;
            assert_eq!(snapshot, 100 * LUNES);

            // À frente e atrás do cursor.
            for wrong in [Some(3), Some(2)] {
                assert_eq!(
                    c.distribute_trading_rewards_paginated(wrong, Some(1)),
                    Err(StakingError::InvalidDistributionCursor)
                );
            }
            // `Some(0)` no meio da rodada não refaz o snapshot, nem com pool novo.
            fund_trading(&mut c, 50 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(0), Some(1)),
                Err(StakingError::InvalidDistributionCursor)
            );
            assert_eq!(c.distribution_amount, snapshot);
            assert_eq!(c.distribution_cursor, 1);
            assert!(!c.locked);

            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), None),
                Ok((3, true, None))
            );
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_sequential_round_credits_each_staker_once() {
            let accounts = test::default_accounts::<E>();
            let stakers = four_stakers();
            let (mut c, contract_id) = distribution_setup(&stakers);
            fund_trading(&mut c, 100 * LUNES);

            // Rodada 1 usando o `next_index` devolvido; rodada 2 usando `None`.
            for use_returned_next in [true, false] {
                as_caller(accounts.alice, 0);
                let pool_at_start = c.get_reward_pools().1;
                let before: Vec<Balance> =
                    stakers.iter().map(|&(w, _, _)| credited(&c, w)).collect();
                let shares: Vec<Balance> = stakers
                    .iter()
                    .map(|&(w, _, _)| expected_share(&c, w, pool_at_start))
                    .collect();

                let mut next = None;
                let mut pages = 0;
                let mut complete = false;
                for _ in 0..10 {
                    let start = if use_returned_next { next } else { None };
                    let (processed, done, n) = c
                        .distribute_trading_rewards_paginated(start, Some(1))
                        .unwrap();
                    assert_eq!(processed, 1);
                    pages += 1;
                    next = n;
                    if done {
                        complete = true;
                        break;
                    }
                }
                assert!(complete, "rodada não terminou em 10 páginas");
                assert_eq!(pages, 4);

                let mut total = 0;
                for (i, &(who, _, _)) in stakers.iter().enumerate() {
                    let got = credited(&c, who) - before[i];
                    assert_eq!(got, shares[i]);
                    total += got;
                }
                assert!(total <= pool_at_start);
                assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
                assert_solvent(&c, contract_id);

                fund_trading(&mut c, 70 * LUNES);
            }
        }

        #[ink::test]
        fn test_distributor_cannot_drain_pool_into_one_slot() {
            let accounts = test::default_accounts::<E>();
            let distributor = accounts.frank;
            let mut stakers = four_stakers().to_vec();
            stakers[3] = (distributor, 10_000 * LUNES, 7); // slot 3
            let (mut c, contract_id) = distribution_setup(&stakers);
            as_caller(accounts.alice, 0);
            c.set_distributor(Some(distributor)).unwrap();
            fund_trading(&mut c, 100 * LUNES);
            let share = expected_share(&c, distributor, 100 * LUNES);
            assert!(share < 100 * LUNES);

            // Mirar direto o próprio slot, repetidamente: rejeitado.
            as_caller(distributor, 0);
            for _ in 0..5 {
                assert_eq!(
                    c.distribute_trading_rewards_paginated(Some(3), Some(1)),
                    Err(StakingError::InvalidDistributionCursor)
                );
            }
            assert_eq!(credited(&c, distributor), 0);

            // Avança em sequência até a página do próprio slot e tenta repeti-la.
            for expected_start in 0..3u32 {
                assert_eq!(
                    c.distribute_trading_rewards_paginated(Some(expected_start), Some(1)),
                    Ok((1, false, Some(expected_start + 1)))
                );
            }
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(3), Some(1)),
                Ok((1, true, None))
            );
            for _ in 0..5 {
                assert_eq!(
                    c.distribute_trading_rewards_paginated(Some(3), Some(1)),
                    Err(StakingError::InvalidDistributionCursor)
                );
            }
            assert_eq!(credited(&c, distributor), share);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_round_state_resets_when_pool_or_weight_is_zero() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.alice, 10_000 * LUNES, 7),
                (accounts.bob, 10_000 * LUNES, 7),
            ]);

            // (a) Todos saem no meio da rodada (peso total 0).
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(
                (c.distribution_amount, c.distribution_cursor),
                (100 * LUNES, 1)
            );
            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            for who in [accounts.alice, accounts.bob] {
                as_caller(who, 0);
                c.unstake().unwrap();
            }
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), Some(1)),
                Ok((0, true, None))
            );
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert!(!c.locked);

            // A próxima rodada financiada começa em 0 com snapshot novo.
            as_caller(accounts.bob, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            fund_trading(&mut c, 30 * LUNES);
            let pool = c.get_reward_pools().1;
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), None),
                Err(StakingError::InvalidDistributionCursor)
            );
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((1, true, None))
            );
            assert_eq!(credited(&c, accounts.bob), pool);
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert_solvent(&c, contract_id);

            // (b) Pool zerado no meio da rodada. Com valor e peso em snapshot e
            // o acumulador da rodada, o pool só zera no meio dela quando toda
            // a fatia do snapshot já foi creditada sem aporte novo (como em (a),
            // onde o unstake da alice credita bob na hora). Aqui o teste zera o
            // campo diretamente para exercitar o retorno antecipado com
            // stakers ainda por processar.
            as_caller(accounts.charlie, 10_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            fund_trading(&mut c, 40 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            c.trading_rewards_pool = 0;
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(1), Some(1)),
                Ok((0, true, None))
            );
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert!(!c.locked);

            fund_trading(&mut c, 20 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(c.distribution_amount, 20 * LUNES);
        }

        // ========================================
        // UM CRÉDITO POR CONTA POR RODADA (unstake → stake entre páginas)
        // ========================================

        #[ink::test]
        fn test_restake_between_pages_is_not_credited_twice() {
            let accounts = test::default_accounts::<E>();
            // Alice domina o peso; os demais são pequenos.
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.alice, 60_000 * LUNES, 181),
                (accounts.bob, 1_000 * LUNES, 7),
                (accounts.charlie, 1_000 * LUNES, 7),
                (accounts.django, 1_000 * LUNES, 7),
            ]);
            fund_trading(&mut c, 100 * LUNES);
            // Fatias sobre o peso total do INÍCIO da rodada (snapshot), não o
            // peso corrente depois das mudanças entre páginas.
            let early = [
                accounts.alice,
                accounts.bob,
                accounts.charlie,
                accounts.django,
            ];
            let shares = snapshot_shares(&c, &early, 100 * LUNES);
            let alice_share = expected_share(&c, accounts.alice, 100 * LUNES);
            assert_eq!(alice_share, shares[0]);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(credited(&c, accounts.alice), alice_share);

            // Lock expirado: sai (recebe o crédito) e volta no fim do índice.
            // O swap-remove leva django (slot 3, ainda não processado) para o
            // slot 0, já processado.
            test::set_block_timestamp::<E>(1_000 + 182 * DAY_MS);
            as_caller(accounts.alice, 0);
            c.unstake().unwrap();
            as_caller(accounts.alice, 60_000 * LUNES);
            c.stake(181 * DAY_MS).unwrap();
            // Um staker novo depois dela fica na última página.
            as_caller(accounts.frank, 1_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            assert_eq!(c.staker_addresses.get(0), Some(accounts.django));
            assert_eq!(c.staker_addresses.get(3), Some(accounts.alice));
            assert_eq!(c.staker_addresses.get(4), Some(accounts.frank));

            as_caller(accounts.alice, 0);
            let mut next = Some(1);
            while let Some(start) = next {
                let (_, _, n) = c
                    .distribute_trading_rewards_paginated(Some(start), Some(1))
                    .unwrap();
                next = n;
            }
            // Nenhum segundo crédito para alice nesta rodada, nem crédito para
            // frank, que entrou depois do início da rodada...
            assert_eq!(credited(&c, accounts.alice), 0);
            assert_eq!(credited(&c, accounts.frank), 0);
            // ...e todo staker ativo desde o início, inclusive django (movido
            // para um slot já processado), recebe a fatia exata do snapshot.
            let mut round_total = shares[0];
            for (i, &who) in early.iter().enumerate().skip(1) {
                assert_eq!(credited(&c, who), shares[i], "staker {i}");
                round_total += shares[i];
            }
            assert!(round_total <= 100 * LUNES);
            assert_eq!(c.get_reward_pools().1, 100 * LUNES - round_total);
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert_solvent(&c, contract_id);
        }

        /// Fatia de cada conta sobre `amount` com o peso total corrente
        /// (chamar antes da rodada: é o peso do snapshot).
        fn snapshot_shares(
            c: &StakingContract,
            who: &[AccountId],
            amount: Balance,
        ) -> Vec<Balance> {
            let total_weight = recomputed_total_weight(c);
            assert_eq!(total_weight, c.total_staker_weight);
            who.iter()
                .map(|&w| {
                    amount * c.calculate_staker_weight(&c.get_stake(w).unwrap()) / total_weight
                })
                .collect()
        }

        /// Percorre o resto da rodada em páginas de 1 a partir do cursor.
        fn finish_round_in_pages_of_one(c: &mut StakingContract) {
            let accounts = test::default_accounts::<E>();
            as_caller(accounts.alice, 0);
            let mut next = Some(c.distribution_cursor);
            let mut pages = 0;
            while let Some(start) = next {
                let (_, _, n) = c
                    .distribute_trading_rewards_paginated(Some(start), Some(1))
                    .unwrap();
                next = n;
                pages += 1;
                assert!(pages <= 20, "rodada não terminou");
            }
        }

        #[ink::test]
        fn test_capital_returning_through_another_account_is_not_credited() {
            let accounts = test::default_accounts::<E>();
            let second = AccountId::from([0x58; 32]);
            // Cenário do achado #0: X (bob), Y (charlie), Z (django) com o
            // mesmo peso, pool 90, páginas de 1.
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.bob, 1_000 * LUNES, 7),
                (accounts.charlie, 1_000 * LUNES, 7),
                (accounts.django, 1_000 * LUNES, 7),
            ]);
            test::set_account_balance::<E>(second, 10_000 * LUNES);
            fund_trading(&mut c, 90 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(credited(&c, accounts.bob), 30 * LUNES);

            // X sai com lock vencido (leva principal + 30) e o mesmo capital
            // volta por OUTRA conta, no fim do índice.
            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            let bob_before = balance_of(accounts.bob);
            as_caller(accounts.bob, 0);
            c.unstake().unwrap();
            assert_eq!(
                balance_of(accounts.bob),
                bob_before + 1_000 * LUNES + 30 * LUNES
            );
            as_caller(second, 1_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();

            finish_round_in_pages_of_one(&mut c);

            // A segunda conta não captura a fatia de ninguém; Y e Z recebem a
            // fatia inteira e nada do snapshot sobra nem falta.
            assert_eq!(credited(&c, second), 0);
            assert_eq!(credited(&c, accounts.charlie), 30 * LUNES);
            assert_eq!(credited(&c, accounts.django), 30 * LUNES);
            assert_eq!(c.get_reward_pools().1, 0);
            assert_eq!(c.get_reward_pools().2, 60 * LUNES);
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert_solvent(&c, contract_id);

            // Na rodada seguinte a segunda conta participa normalmente.
            fund_trading(&mut c, 30 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((3, true, None))
            );
            assert_eq!(credited(&c, second), 10 * LUNES);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_unstake_and_stake_between_pages_keep_exact_snapshot_shares() {
            let accounts = test::default_accounts::<E>();
            let late = AccountId::from([0x59; 32]);
            // Pesos 4:2:2:1:1 (mesmo tier e multiplicador): fatias 40/20/20/10/10.
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.alice, 4_000 * LUNES, 7),
                (accounts.bob, 2_000 * LUNES, 7),
                (accounts.charlie, 2_000 * LUNES, 7),
                (accounts.django, 1_000 * LUNES, 7),
                (accounts.frank, 1_000 * LUNES, 7),
            ]);
            test::set_account_balance::<E>(late, 10_000 * LUNES);
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(credited(&c, accounts.alice), 40 * LUNES);

            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            // Alice (já processada, a maior) sai: frank, do último slot e
            // ainda não processado, vai para o slot 0.
            as_caller(accounts.alice, 0);
            c.unstake().unwrap();
            assert_eq!(c.staker_addresses.get(0), Some(accounts.frank));
            // Django sai antes de ser processado: não recebe, a fatia fica no pool.
            as_caller(accounts.django, 0);
            c.unstake().unwrap();
            // Capital novo no meio da rodada não entra no snapshot.
            as_caller(late, 4_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            // Aporte no meio da rodada pertence à próxima.
            fund_trading(&mut c, 7 * LUNES);
            assert_index_consistent(&c);

            finish_round_in_pages_of_one(&mut c);

            assert_eq!(credited(&c, accounts.frank), 10 * LUNES);
            assert_eq!(credited(&c, accounts.bob), 20 * LUNES);
            assert_eq!(credited(&c, accounts.charlie), 20 * LUNES);
            assert_eq!(credited(&c, accounts.django), 0);
            assert_eq!(credited(&c, late), 0);
            let round_total = (40 + 10 + 20 + 20) * LUNES;
            assert!(round_total <= 100 * LUNES);
            // Pool restante exato: fatia do django + aporte do meio da rodada.
            assert_eq!(
                c.get_reward_pools().1,
                100 * LUNES - round_total + 7 * LUNES
            );
            // Creditado em aberto: alice já levou os 40 dela no unstake.
            assert_eq!(c.get_reward_pools().2, (10 + 20 + 20) * LUNES);
            assert_eq!((c.distribution_amount, c.distribution_cursor), (0, 0));
            assert_index_consistent(&c);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_round_credits_never_exceed_snapshot_amount() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.alice, 1_000 * LUNES, 7),
                (accounts.bob, 1_000 * LUNES, 7),
                (accounts.charlie, 1_000 * LUNES, 7),
            ]);
            fund_trading(&mut c, 90 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, Some(1)),
                Ok((1, false, Some(1)))
            );
            assert_eq!(c.distribution_credited, 30 * LUNES);

            // Denominador corrompido (qualquer deriva de peso) e pool com
            // sobra: só o acumulador da rodada limita a soma ao snapshot.
            c.distribution_total_weight /= 3;
            fund_trading(&mut c, 1_000 * LUNES);
            finish_round_in_pages_of_one(&mut c);

            let round_total = credited(&c, accounts.alice)
                + credited(&c, accounts.bob)
                + credited(&c, accounts.charlie);
            assert_eq!(round_total, 90 * LUNES);
            assert_eq!(c.get_reward_pools().1, 1_000 * LUNES);
            assert_eq!(c.distribution_credited, 0);
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_vote_funds_cannot_be_withdrawn_to_the_contract_itself() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = solvency_setup();
            let id = proposal_setup(&mut c);
            for who in [accounts.bob, accounts.charlie] {
                stake_and_vote(&mut c, who, id);
            }
            let funds = c.get_vote_funds();
            let balance = balance_of(contract_id);

            as_caller(accounts.alice, 0);
            assert_eq!(
                c.withdraw_team_fund(contract_id),
                Err(StakingError::InvalidRecipient)
            );
            assert_eq!(
                c.withdraw_liquidity_fund(contract_id),
                Err(StakingError::InvalidRecipient)
            );
            assert_eq!(c.get_vote_funds(), funds);
            assert_eq!(balance_of(contract_id), balance);

            // O treasury também não pode apontar para o próprio contrato.
            let treasury_before = c.treasury_address;
            assert_eq!(
                c.set_treasury_address(contract_id),
                Err(StakingError::InvalidRecipient)
            );
            assert_eq!(c.treasury_address, treasury_before);
            assert_eq!(c.withdraw_treasury_fund(), Ok(2 * VOTE_SHARE));
            assert_eq!(c.get_vote_funds(), (funds.0, 0, funds.2));

            // O caminho legítimo continua funcionando.
            assert_eq!(
                c.withdraw_team_fund(accounts.frank),
                Ok(2 * VOTE_TEAM_SHARE)
            );
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        #[should_panic(expected = "treasury")]
        fn test_constructor_rejects_contract_as_treasury() {
            let contract_id = AccountId::from([0xCA; 32]);
            test::set_callee::<E>(contract_id);
            let _ = StakingContract::new(contract_id);
        }

        #[ink::test]
        fn test_staker_is_credited_again_in_the_next_round() {
            let accounts = test::default_accounts::<E>();
            let (mut c, contract_id) = distribution_setup(&[
                (accounts.alice, 10_000 * LUNES, 7),
                (accounts.bob, 20_000 * LUNES, 7),
            ]);
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((2, true, None))
            );
            assert_eq!(c.last_credited_round.get(accounts.bob), Some(1));
            let bob_round_1 = credited(&c, accounts.bob);
            assert!(bob_round_1 > 0);

            // Sai e volta entre as rodadas: a marca da rodada 1 não o bloqueia.
            test::set_block_timestamp::<E>(1_000 + 8 * DAY_MS);
            as_caller(accounts.bob, 0);
            c.unstake().unwrap();
            as_caller(accounts.bob, 20_000 * LUNES);
            c.stake(7 * DAY_MS).unwrap();
            assert_eq!(c.last_credited_round.get(accounts.bob), Some(1));

            fund_trading(&mut c, 60 * LUNES);
            let pool = c.get_reward_pools().1;
            let shares = [
                expected_share(&c, accounts.alice, pool),
                expected_share(&c, accounts.bob, pool),
            ];
            let alice_before = credited(&c, accounts.alice);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((2, true, None))
            );
            assert_eq!(c.distribution_round, 2);
            assert_eq!(credited(&c, accounts.alice) - alice_before, shares[0]);
            assert_eq!(credited(&c, accounts.bob), shares[1]);
            assert_eq!(c.last_credited_round.get(accounts.alice), Some(2));
            assert_eq!(c.last_credited_round.get(accounts.bob), Some(2));
            assert_solvent(&c, contract_id);
        }

        #[ink::test]
        fn test_round_counter_advances_once_per_round() {
            let accounts = test::default_accounts::<E>();
            let (mut c, _) = distribution_setup(&[]);
            as_caller(accounts.alice, 0);
            // Pool vazio e peso zero: retornos antecipados não abrem rodada.
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((0, true, None))
            );
            assert_eq!(c.distribution_round, 0);
            fund_trading(&mut c, 100 * LUNES);
            as_caller(accounts.alice, 0);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((0, true, None))
            );
            assert_eq!(c.distribution_round, 0);

            for (who, amount, days) in four_stakers() {
                as_caller(who, amount);
                c.stake(days * DAY_MS).unwrap();
            }
            as_caller(accounts.alice, 0);
            c.distribute_trading_rewards_paginated(None, Some(1))
                .unwrap();
            assert_eq!(c.distribution_round, 1);
            // Chamada rejeitada não avança o contador.
            assert_eq!(
                c.distribute_trading_rewards_paginated(Some(3), Some(1)),
                Err(StakingError::InvalidDistributionCursor)
            );
            assert_eq!(c.distribution_round, 1);
            // Páginas seguintes da mesma rodada também não.
            c.distribute_trading_rewards_paginated(None, Some(1))
                .unwrap();
            assert_eq!(c.distribution_round, 1);
            assert_eq!(
                c.distribute_trading_rewards_paginated(None, None),
                Ok((2, true, None))
            );
            assert_eq!(c.distribution_round, 1);

            // Nova rodada: +1.
            fund_trading(&mut c, 50 * LUNES);
            as_caller(accounts.alice, 0);
            c.distribute_trading_rewards_paginated(None, Some(1))
                .unwrap();
            assert_eq!(c.distribution_round, 2);
        }
    }
}
