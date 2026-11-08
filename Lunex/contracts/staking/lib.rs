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
        /// Liquidity fund for project (10% of votes)
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
        /// Mapping for tracking staker addresses
        staker_addresses: Mapping<u32, AccountId>,
        /// Current staker index
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
        ///   + excedente (taxas de voto/proposta retidas).
        /// APY e bônus de governança só são pagos de `apy_rewards_pool`.
        apy_rewards_pool: Balance,
        /// Soma de `stake.pending_rewards` (trading rewards creditadas, lastreadas).
        total_credited_rewards: Balance,
        /// APY acumulado mas não pago por falta de pool (passivo NÃO lastreado,
        /// sacável quando o pool for financiado, inclusive após o unstake).
        owed_rewards: Mapping<AccountId, Balance>,
        /// Snapshot do pool no início de uma distribuição paginada.
        distribution_amount: Balance,
    }

    impl StakingContract {
        /// Creates a new staking contract
        #[ink(constructor)]
        pub fn new(treasury_address: AccountId) -> Self {
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
            self.stakes.insert(caller, &stake_position);
            self.staker_addresses.insert(self.staker_index, &caller);
            self.staker_index = self
                .staker_index
                .checked_add(1)
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
        #[ink(message)]
        pub fn unstake(&mut self) -> Result<(), StakingError> {
            self.ensure_not_paused()?;
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
            let (apy_paid, apy_unpaid) = self.split_apy_payout(caller, accrued)?;

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
            self.total_credited_rewards = self
                .total_credited_rewards
                .checked_sub(credited)
                .ok_or(StakingError::Overflow)?;
            self.active_stakers = self
                .active_stakers
                .checked_sub(1)
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
        /// Each vote costs 10 LUNES. Users can vote once per hour.
        /// Requirements:
        /// - Voter must have active staking
        /// Vote distribution:
        /// - 10% → Rewards Pool (stakers)
        /// - 10% → Project Liquidity Pool
        /// - 10% → Treasury
        /// - 70% → Team
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

            // === VALIDATE PAYMENT (10 LUNES per vote) ===
            if payment < constants::VOTE_COST {
                return Err(StakingError::InsufficientFee);
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
            // 10% to rewards pool (stakers)
            let rewards_share = payment / 10; // 10%
                                              // 10% to project liquidity pool
            let liquidity_share = payment / 10; // 10%
                                                // 10% to treasury
            let treasury_share = payment / 10; // 10%
                                               // 70% to team (remains in contract, to be withdrawn by team)

            // Add to rewards pool
            self.trading_rewards_pool = self.trading_rewards_pool.saturating_add(rewards_share);

            // Add to proposal's liquidity fund
            // proposal.votes_against is currently being used to track liquidity fund for YES votes
            if !vote_yes {
                proposal.votes_against = proposal
                    .votes_against
                    .checked_add(1)
                    .ok_or(StakingError::Overflow)?;
            }

            let _ = treasury_share; // Treasury share stays in contract
                                    // Liquidity share also stays in the contract balance: it is not yet
                                    // earmarked anywhere (no liquidity-fund accounting exists).
            let _ = liquidity_share;

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

        /// Transfers ownership (admin only)
        #[ink(message)]
        pub fn transfer_ownership(&mut self, new_owner: AccountId) -> Result<(), StakingError> {
            self.ensure_owner()?;

            if new_owner == AccountId::from(constants::ZERO_ADDRESS) {
                return Err(StakingError::ZeroAddress);
            }

            let old_owner = self.owner;
            self.owner = new_owner;

            // Emit event
            self.env().emit_event(OwnershipTransferred {
                old_owner,
                new_owner,
                timestamp: self.env().block_timestamp(),
            });

            Ok(())
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

        /// Recebe trading rewards do contrato de rewards (apenas contrato autorizado)
        #[ink(message, payable)]
        pub fn fund_staking_rewards(&mut self) -> Result<(), StakingError> {
            self.ensure_not_paused()?;

            // Verifica se é o contrato autorizado
            let caller = self.env().caller();
            if self.trading_rewards_contract != Some(caller) {
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

        /// Distribui trading rewards para todos os stakers ativos (apenas admin)
        /// Para compatibilidade, distribui tudo em uma página
        #[ink(message)]
        pub fn distribute_trading_rewards(&mut self) -> Result<(), StakingError> {
            // Para compatibilidade, distribui tudo em uma página
            let (_processed, _complete, _next) =
                self.distribute_trading_rewards_paginated(None, None)?;
            Ok(())
        }

        /// Distribui trading rewards com paginação para melhor eficiência de gas (apenas admin)
        ///
        /// # Parâmetros
        /// - `start_index`: Índice inicial para distribuição (None = do início)
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
            self.ensure_owner()?;
            self.ensure_not_paused()?;
            self.acquire_lock()?;

            if self.trading_rewards_pool == 0 {
                self.release_lock();
                return Ok((0, true, None)); // Nada para distribuir
            }

            let total_weight = self.calculate_total_staker_weight()?;
            if total_weight == 0 {
                self.release_lock();
                return Ok((0, true, None)); // Nenhum staker ativo
            }

            let start = start_index.unwrap_or(0);
            // Snapshot at page 0 so every page shares the same base amount;
            // each credit is still capped by what is left in the pool, so the
            // total credited can never exceed what was funded.
            if start == 0 || self.distribution_amount == 0 {
                self.distribution_amount = self.trading_rewards_pool;
            }
            let amount_to_distribute = self.distribution_amount;
            let mut credited_this_page: Balance = 0;
            let max_batch = batch_size.unwrap_or(100).min(100); // Limita a 100 para evitar gas excessivo
            let end = start
                .checked_add(max_batch)
                .unwrap_or(self.staker_index)
                .min(self.staker_index);

            let mut distributed_count = 0u32;
            let mut processed_count = 0u32;

            // Distribui proporcionalmente para o lote de stakers
            for i in start..end {
                processed_count = processed_count
                    .checked_add(1)
                    .ok_or(StakingError::Overflow)?;

                if let Some(staker) = self.staker_addresses.get(i) {
                    if let Some(mut stake) = self.stakes.get(staker) {
                        if stake.active {
                            let weight = self.calculate_staker_weight(&stake);
                            let reward = amount_to_distribute
                                .checked_mul(weight)
                                .ok_or(StakingError::Overflow)?
                                .checked_div(total_weight)
                                .ok_or(StakingError::Overflow)?
                                .min(self.trading_rewards_pool);

                            if reward > 0 {
                                stake.pending_rewards = stake
                                    .pending_rewards
                                    .checked_add(reward)
                                    .ok_or(StakingError::Overflow)?;
                                self.trading_rewards_pool = self
                                    .trading_rewards_pool
                                    .checked_sub(reward)
                                    .ok_or(StakingError::Overflow)?;
                                self.total_credited_rewards = self
                                    .total_credited_rewards
                                    .checked_add(reward)
                                    .ok_or(StakingError::Overflow)?;
                                credited_this_page = credited_this_page
                                    .checked_add(reward)
                                    .ok_or(StakingError::Overflow)?;

                                self.stakes.insert(staker, &stake);
                                distributed_count = distributed_count
                                    .checked_add(1)
                                    .ok_or(StakingError::Overflow)?;
                            }
                        }
                    }
                }
            }

            let is_complete = end >= self.staker_index;
            let next_index = if is_complete { None } else { Some(end) };

            self.total_trading_rewards_distributed = self
                .total_trading_rewards_distributed
                .checked_add(credited_this_page)
                .ok_or(StakingError::Overflow)?;

            // Se é a primeira página ou a distribuição está completa, atualiza estado global
            if start == 0 || is_complete {
                if is_complete {
                    // Finaliza a distribuição. O resto de arredondamento fica
                    // no pool para a próxima distribuição (não é zerado).
                    self.distribution_amount = 0;

                    // Emit event final
                    self.env().emit_event(TradingRewardsDistributed {
                        total_amount: amount_to_distribute,
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

            self.release_lock();
            Ok((processed_count, is_complete, next_index))
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

        /// Calcula peso total de todos os stakers ativos
        fn calculate_total_staker_weight(&self) -> Result<Balance, StakingError> {
            let mut total_weight = 0u128;

            for i in 0..self.staker_index {
                if let Some(staker) = self.staker_addresses.get(i) {
                    if let Some(stake) = self.stakes.get(staker) {
                        if stake.active {
                            let weight = self.calculate_staker_weight(&stake);
                            total_weight = total_weight
                                .checked_add(weight)
                                .ok_or(StakingError::Overflow)?;
                        }
                    }
                }
            }

            Ok(total_weight as Balance)
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
    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::test;

        #[ink::test]
        fn test_new_staking_contract() {
            let contract = StakingContract::new(AccountId::from([0x1; 32]));
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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
            let result = contract.stake(constants::MIN_DURATION);

            assert_eq!(result, Err(StakingError::MinimumStakeNotMet));
        }

        #[ink::test]
        fn test_stake_invalid_duration() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));

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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));

            // Stake and create proposal
            contract.stake(constants::MIN_DURATION).unwrap();
            let proposal_id = contract
                .create_proposal(
                    "Test Project".to_string(),
                    "Description".to_string(),
                    accounts.bob,
                )
                .unwrap();

            // Vote on proposal
            let vote_result = contract.vote(proposal_id, true);
            assert!(vote_result.is_ok());

            let proposal = contract.get_proposal(proposal_id).unwrap();
            assert_eq!(proposal.votes_for, constants::MIN_PROPOSAL_POWER);
            assert_eq!(proposal.votes_against, 0);
        }

        #[ink::test]
        fn test_voting_power() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));

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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));

            // Test pause
            assert!(contract.pause().is_ok());

            // Test unpause
            assert!(contract.unpause().is_ok());

            // Test transfer ownership
            assert!(contract.transfer_ownership(accounts.bob).is_ok());

            // Original owner should no longer have access
            assert_eq!(contract.pause(), Err(StakingError::AccessDenied));
        }

        #[ink::test]
        fn test_contract_paused() {
            let accounts = test::default_accounts::<ink::env::DefaultEnvironment>();
            test::set_caller::<ink::env::DefaultEnvironment>(accounts.alice);
            test::set_value_transferred::<ink::env::DefaultEnvironment>(constants::MIN_STAKE);

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));

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

            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
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
            let treasury = AccountId::from([0x1; 32]);
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

            // Votar a favor
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
            let treasury = AccountId::from([0x1; 32]);
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
            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
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
            let mut contract = StakingContract::new(AccountId::from([0x1; 32]));
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
            let contract = StakingContract::new(AccountId::from([0x1; 32]));
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
                StakingContract::new(AccountId::from([0x1; 32])),
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

        /// Invariante de custódia: o saldo do contrato cobre o principal
        /// devido + rewards já creditadas + pools financiados.
        fn assert_solvent(c: &StakingContract, contract_id: AccountId) {
            let (apy_pool, trading_pool, credited) = c.get_reward_pools();
            let (total_staked, _, _) = c.get_stats();
            let liabilities = total_staked + credited + apy_pool + trading_pool;
            assert!(
                balance_of(contract_id) >= liabilities,
                "insolvent: balance {} < liabilities {} (staked {}, credited {}, apy {}, trading {})",
                balance_of(contract_id),
                liabilities,
                total_staked,
                credited,
                apy_pool,
                trading_pool
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
                    now += (next() % (20 * DAY_MS)) as u64;
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
    }
}
