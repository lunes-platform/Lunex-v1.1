#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![allow(clippy::cast_possible_truncation)] // ink! interno gera cfg conditions que não podem ser suprimidas de outra forma
#![warn(clippy::arithmetic_side_effects)]

#[ink::contract]
pub mod trading_rewards {
    use ink::storage::Mapping;

    /// Posição de trading de um usuário
    #[derive(scale::Decode, scale::Encode, Clone)]
    #[cfg_attr(
        feature = "std",
        derive(
            scale_info::TypeInfo,
            Debug,
            PartialEq,
            Eq,
            ink::storage::traits::StorageLayout
        )
    )]
    pub struct TradingPosition {
        pub total_volume: Balance,
        pub monthly_volume: Balance,
        pub daily_volume: Balance,
        pub last_trade_timestamp: Timestamp,
        pub last_daily_reset: Timestamp,
        pub tier: TradingTier,
        pub pending_rewards: Balance,
        pub claimed_rewards: Balance,
        pub trade_count: u32,
        pub suspicious_flags: u8,
        /// Início da janela mensal corrente de `monthly_volume` (ms). O reset
        /// mensal é ancorado aqui, não no último trade.
        pub monthly_window_start: Timestamp,
    }

    /// Tiers de trading baseados em volume
    #[derive(scale::Decode, scale::Encode, Clone, Copy, PartialEq, Eq)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, Debug, ink::storage::traits::StorageLayout)
    )]
    pub enum TradingTier {
        Bronze,   // 0 - 10,000 LUNES volume/mês
        Silver,   // 10,000 - 50,000 LUNES volume/mês
        Gold,     // 50,000 - 200,000 LUNES volume/mês
        Platinum, // 200,000+ LUNES volume/mês
    }

    /// Erros do contrato
    #[derive(scale::Decode, scale::Encode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, Debug, PartialEq, Eq))]
    pub enum TradingRewardsError {
        /// Acesso negado - apenas admin/router
        AccessDenied,
        /// Contrato pausado
        ContractPaused,
        /// Endereço zero não permitido
        ZeroAddress,
        /// Sem rewards para reivindicar
        NoRewardsToClaim,
        /// Overflow aritmético
        Overflow,
        /// Saldo insuficiente
        InsufficientBalance,
        /// Guard de reentrância ativo
        ReentrancyGuardActive,
        /// Volume de trade muito pequeno (anti-spam)
        VolumeTooSmall,
        /// Cooldown entre trades ainda ativo
        TradeCooldownActive,
        /// Limite diário de volume excedido
        DailyLimitExceeded,
        /// Endereço suspeito/blacklisted
        SuspiciousAddress,
        /// Época atual sem peso de trading: distribuir não creditaria ninguém
        NoActiveTraders,
        /// A chamada `fund_staking_rewards` no contrato de staking não
        /// retornou `Ok(())` (erro de ambiente, LangError ou Err do callee)
        StakingFundingFailed,
        /// A época atual tem peso de trading: só pode ser fechada por
        /// `distribute_rewards` (fechar sem rewards confiscaria o peso)
        EpochHasPendingWeight,
        /// A operação exige um trader atualmente em blacklist
        NotBlacklisted,
        /// A época atual ainda não atingiu `epoch_end_time` (fixado na
        /// abertura da época)
        EpochNotFinished,
        /// Void de época fechada recusado: o trader ainda tem peso na época
        /// aberta (anule a época aberta primeiro, depois as fechadas)
        OpenEpochWeightPending,
    }

    /// Eventos emitidos pelo contrato
    #[ink(event)]
    pub struct VolumeTracked {
        #[ink(topic)]
        pub trader: AccountId,
        pub volume: Balance,
        pub new_tier: TradingTier,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct RewardsDistributed {
        pub total_amount: Balance,
        pub traders_count: u32,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct RewardsClaimed {
        #[ink(topic)]
        pub trader: AccountId,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct TierUpgraded {
        #[ink(topic)]
        pub trader: AccountId,
        pub old_tier: TradingTier,
        pub new_tier: TradingTier,
    }

    #[ink(event)]
    pub struct RewardsPoolFunded {
        pub total_amount: Balance,
        pub trading_amount: Balance,
        pub staking_amount: Balance,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct AntifraudParametersUpdated {
        pub min_trade_volume: Balance,
        pub trade_cooldown: Timestamp,
        pub max_daily_volume: Balance,
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct EpochStarted {
        #[ink(topic)]
        pub epoch_id: u32,
        pub start_time: Timestamp,
        pub duration: Timestamp,
    }

    #[ink(event)]
    pub struct EpochEnded {
        #[ink(topic)]
        pub epoch_id: u32,
        pub total_rewards: Balance,
        pub active_traders: u32,
        pub end_time: Timestamp,
    }

    #[ink(event)]
    pub struct RouterChanged {
        pub old_router: AccountId,
        pub new_router: AccountId,
        pub admin: AccountId,
        pub timestamp: Timestamp,
    }

    #[ink(event)]
    pub struct AdminTransferred {
        pub old_admin: AccountId,
        pub new_admin: AccountId,
        pub timestamp: Timestamp,
    }

    /// Saldo nativo não contabilizado (fora de `rewards_pool` e
    /// `reserved_rewards`) resgatado pelo admin
    #[ink(event)]
    pub struct NativeRescued {
        #[ink(topic)]
        pub to: AccountId,
        pub amount: Balance,
        pub timestamp: Timestamp,
    }

    /// Peso de um trader em blacklist anulado pelo admin. Época aberta: o
    /// peso sai do total da época. Época fechada: a fração do trader volta de
    /// `reserved_rewards` para `rewards_pool` (`returned_to_pool`).
    #[ink(event)]
    pub struct BlacklistedWeightVoided {
        #[ink(topic)]
        pub trader: AccountId,
        pub epoch_id: u32,
        pub weight: Balance,
        pub returned_to_pool: Balance,
        pub timestamp: Timestamp,
    }

    /// Selector de `fund_staking_rewards()` no contrato de staking
    /// (metadata staking_contract: 0x201f2814). Mensagem payable, sem
    /// argumentos, retorna `Result<(), StakingError>`. Consistência com o
    /// label verificada em unit test via `ink::selector_bytes!`.
    pub const STAKING_FUND_STAKING_REWARDS_SELECTOR: [u8; 4] = [0x20, 0x1f, 0x28, 0x14];

    /// Contrato principal otimizado para gas
    #[ink(storage)]
    pub struct TradingRewardsContract {
        /// Admin do contrato
        admin: AccountId,
        /// Endereço do router autorizado
        authorized_router: AccountId,
        /// Pool de rewards disponível
        rewards_pool: Balance,
        /// Posições de trading por usuário
        trading_positions: Mapping<AccountId, TradingPosition>,
        /// Mapeamento de traders ativos (O(1) lookup ao invés de Vec)
        active_traders: Mapping<AccountId, bool>,
        /// Contador de traders ativos
        active_trader_count: u32,
        /// Timestamp da última distribuição
        last_distribution: Timestamp,
        /// Total distribuído até agora
        total_distributed: Balance,
        /// Contrato pausado
        paused: bool,
        /// Guard de reentrância
        reentrancy_guard: bool,
        /// Endereços blacklisted (suspeitos)
        blacklisted_addresses: Mapping<AccountId, bool>,
        /// Contadores de segurança
        total_suspicious_flags: u32,
        /// Endereço do contrato de staking para receber 10% das fees
        staking_contract: Option<AccountId>,
        /// Cache do peso total (atualizado quando traders mudam de tier)
        cached_total_weight: Balance,
        /// Timestamp da última atualização do cache
        weight_cache_timestamp: Timestamp,

        // === PARÂMETROS ANTI-FRAUDE CONFIGURÁVEIS ===
        /// Volume mínimo por trade (configurável)
        min_trade_volume: Balance,
        /// Cooldown entre trades (configurável)
        trade_cooldown: Timestamp,
        /// Limite máximo de volume diário (configurável)
        max_daily_volume: Balance,

        // === SISTEMA DE ÉPOCAS ===
        /// ID da época atual
        current_epoch: u32,
        /// Timestamp de início da época atual
        epoch_start_time: Timestamp,
        /// Duração de cada época (configurável)
        epoch_duration: Timestamp,
        /// Rewards por época
        epoch_rewards: Mapping<u32, Balance>,
        /// Snapshots de rewards por trader por época.
        /// NÃO UTILIZADO: mantido apenas para preservar o layout de storage.
        /// O valor reivindicável é calculado a partir de `epoch_trader_weight`
        /// / `epoch_total_weight` (ver `get_epoch_rewards`).
        epoch_trader_rewards: Mapping<(u32, AccountId), Balance>,
        /// Total de traders ativos por época
        epoch_active_traders: Mapping<u32, u32>,

        // === CONTABILIDADE DE REWARDS POR ÉPOCA (pull claims) ===
        /// Soma dos pesos de todos os traders em cada época
        epoch_total_weight: Mapping<u32, Balance>,
        /// Peso de cada trader em cada época. A remoção da entrada é a fonte
        /// de verdade de "já reivindicado" (impede pagamento duplo).
        epoch_trader_weight: Mapping<(u32, AccountId), Balance>,
        /// LUNES já atribuídos a épocas fechadas e ainda não pagos
        reserved_rewards: Balance,
        /// Cursor por trader: próxima época a liquidar em `claim_rewards`
        /// (apenas otimização; não é a fonte de verdade de "já pago")
        next_claim_epoch: Mapping<AccountId, u32>,
        /// Fim da época atual (ms), fixado quando a época abre:
        /// `epoch_start_time + epoch_duration` vigente naquele momento
        epoch_end_time: Timestamp,
    }

    /// Constantes
    mod constants {
        use super::{Balance, Timestamp};

        /// Multiplicador para 8 casas decimais do LUNES
        pub const DECIMALS_8: Balance = 100_000_000;

        // Thresholds para tiers (em LUNES com 8 decimais)

        pub const SILVER_THRESHOLD: Balance = 10_000 * DECIMALS_8; // 10k LUNES
        pub const GOLD_THRESHOLD: Balance = 50_000 * DECIMALS_8; // 50k LUNES
        pub const PLATINUM_THRESHOLD: Balance = 200_000 * DECIMALS_8; // 200k LUNES

        /// Multiplicadores de rewards por tier
        pub const BRONZE_MULTIPLIER: u32 = 100; // 1.0x
        pub const SILVER_MULTIPLIER: u32 = 120; // 1.2x
        pub const GOLD_MULTIPLIER: u32 = 150; // 1.5x
        pub const PLATINUM_MULTIPLIER: u32 = 200; // 2.0x

        // === UNIDADES DE TEMPO ===
        // `block_timestamp()` no Substrate/Lunes é em MILISSEGUNDOS (pallet
        // timestamp). Todas as constantes e parâmetros de tempo deste contrato
        // estão em ms (mesma convenção de staking, copy_vault, listing_manager
        // e spot_settlement).

        /// 1 segundo em ms
        pub const SECOND_MS: Timestamp = 1_000;
        /// 1 dia em ms
        pub const DAY_MS: Timestamp = 24 * 60 * 60 * SECOND_MS;

        /// Período de reset mensal: 30 dias (em ms)
        pub const MONTHLY_RESET_PERIOD: Timestamp = 30 * DAY_MS;

        // === CONSTANTES ANTI-FRAUDE (valores padrão) ===

        /// Volume mínimo por trade (anti-spam) - padrão
        pub const DEFAULT_MIN_TRADE_VOLUME: Balance = 100 * DECIMALS_8; // 100 LUNES

        /// Cooldown mínimo entre trades (anti-spam) - padrão: 1 minuto (em ms)
        pub const DEFAULT_TRADE_COOLDOWN: Timestamp = 60 * SECOND_MS;

        /// Limite máximo de volume diário por trader - padrão
        pub const DEFAULT_MAX_DAILY_VOLUME: Balance = 1_000_000 * DECIMALS_8; // 1M LUNES

        /// Período de reset diário: 24 horas (em ms)
        pub const DAILY_RESET_PERIOD: Timestamp = DAY_MS;

        // === CONSTANTES DE ÉPOCA ===

        /// Duração padrão de uma época: 7 dias (em ms)
        pub const DEFAULT_EPOCH_DURATION: Timestamp = 7 * DAY_MS;

        /// Duração mínima de uma época: 1 hora (em ms)
        pub const MIN_EPOCH_DURATION: Timestamp = 60 * 60 * SECOND_MS;

        /// Duração máxima de uma época: 90 dias (em ms)
        pub const MAX_EPOCH_DURATION: Timestamp = 90 * DAY_MS;

        /// Máximo de épocas fechadas liquidadas por chamada de `claim_rewards`
        /// (limita o gas; traders com longo período ocioso avançam em várias
        /// chamadas)
        pub const MAX_EPOCHS_PER_CLAIM: u32 = 32;

        /// Flags de suspeita
        pub const SUSPICIOUS_FLAG_NONE: u8 = 0;

        pub const SUSPICIOUS_FLAG_BLACKLISTED: u8 = 128;
    }

    impl TradingRewardsContract {
        /// Construtor
        #[ink(constructor)]
        pub fn new(admin: AccountId, router: AccountId) -> Result<Self, TradingRewardsError> {
            if admin == AccountId::from([0u8; 32]) || router == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }

            let current_time = Self::env().block_timestamp();
            // Fim da primeira época, fixado na abertura (ver `epoch_end_time`)
            let epoch_end_time = current_time
                .checked_add(constants::DEFAULT_EPOCH_DURATION)
                .ok_or(TradingRewardsError::Overflow)?;

            Ok(Self {
                admin,
                authorized_router: router,
                rewards_pool: 0,
                trading_positions: Mapping::default(),
                active_traders: Mapping::default(),
                active_trader_count: 0,
                last_distribution: current_time,
                total_distributed: 0,
                paused: false,
                reentrancy_guard: false,
                blacklisted_addresses: Mapping::default(),
                total_suspicious_flags: 0,
                staking_contract: None,
                cached_total_weight: 0,
                weight_cache_timestamp: current_time,

                // Parâmetros anti-fraude configuráveis (valores padrão)
                min_trade_volume: constants::DEFAULT_MIN_TRADE_VOLUME,
                trade_cooldown: constants::DEFAULT_TRADE_COOLDOWN,
                max_daily_volume: constants::DEFAULT_MAX_DAILY_VOLUME,

                // Sistema de épocas
                current_epoch: 0,
                epoch_start_time: current_time,
                epoch_duration: constants::DEFAULT_EPOCH_DURATION,
                epoch_rewards: Mapping::default(),
                epoch_trader_rewards: Mapping::default(),
                epoch_active_traders: Mapping::default(),

                // Contabilidade de rewards por época
                epoch_total_weight: Mapping::default(),
                epoch_trader_weight: Mapping::default(),
                reserved_rewards: 0,
                next_claim_epoch: Mapping::default(),
                epoch_end_time,
            })
        }

        /// Registra volume de trading (apenas router autorizado)
        #[ink(message)]
        pub fn track_trading_volume(
            &mut self,
            trader: AccountId,
            volume: Balance,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_not_paused()?;
            self.ensure_authorized_router()?;
            // Único ponto de acquire e único ponto de release (Ok e Err)
            self.acquire_reentrancy_guard()?;
            let result = self.track_trading_volume_inner(trader, volume);
            self.release_reentrancy_guard();
            result
        }

        fn track_trading_volume_inner(
            &mut self,
            trader: AccountId,
            volume: Balance,
        ) -> Result<(), TradingRewardsError> {
            if trader == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }

            // === VALIDAÇÕES ANTI-FRAUDE ===

            // 1. Volume mínimo (anti-spam) - usando parâmetro configurável
            if volume < self.min_trade_volume {
                return Err(TradingRewardsError::VolumeTooSmall);
            }

            // 2. Verificar blacklist
            if self.blacklisted_addresses.get(trader).unwrap_or(false) {
                return Err(TradingRewardsError::SuspiciousAddress);
            }

            let current_time = Self::env().block_timestamp();

            // Busca ou cria posição do trader
            let (mut position, is_new_position) = match self.trading_positions.get(trader) {
                Some(pos) => (pos, false),
                None => {
                    // Adiciona ao mapeamento de traders ativos se novo (O(1) operation)
                    if !self.active_traders.get(trader).unwrap_or(false) {
                        self.active_traders.insert(trader, &true);
                        self.active_trader_count = self
                            .active_trader_count
                            .checked_add(1)
                            .ok_or(TradingRewardsError::Overflow)?;
                    }

                    (
                        TradingPosition {
                            total_volume: 0,
                            monthly_volume: 0,
                            daily_volume: 0,
                            last_trade_timestamp: 0, // Para novos usuários, define como 0 para passar no cooldown
                            last_daily_reset: current_time,
                            tier: TradingTier::Bronze,
                            pending_rewards: 0,
                            claimed_rewards: 0,
                            trade_count: 0,
                            suspicious_flags: constants::SUSPICIOUS_FLAG_NONE,
                            monthly_window_start: current_time,
                        },
                        true,
                    )
                }
            };

            // === MAIS VALIDAÇÕES ANTI-FRAUDE ===

            // 3. Cooldown entre trades - usando parâmetro configurável.
            // Mesmo timestamp (mesmo bloco) está DENTRO do cooldown: diferença 0.
            if position.last_trade_timestamp > 0
                && current_time.saturating_sub(position.last_trade_timestamp) < self.trade_cooldown
            {
                return Err(TradingRewardsError::TradeCooldownActive);
            }

            // 4. Reset diário se necessário
            if current_time > position.last_daily_reset
                && current_time.saturating_sub(position.last_daily_reset)
                    > constants::DAILY_RESET_PERIOD
            {
                position.daily_volume = 0;
                position.last_daily_reset = current_time;
            }

            // 5. Verificar limite diário
            let new_daily_volume = position
                .daily_volume
                .checked_add(volume)
                .ok_or(TradingRewardsError::Overflow)?;

            if new_daily_volume > self.max_daily_volume {
                return Err(TradingRewardsError::DailyLimitExceeded);
            }

            // Reset mensal ancorado no início da janela (mesmo padrão do reset
            // diário): sem isso, quem opera ao menos a cada 30 dias acumularia
            // volume vitalício e manteria o tier (que multiplica o peso)
            if current_time > position.monthly_window_start
                && current_time.saturating_sub(position.monthly_window_start)
                    > constants::MONTHLY_RESET_PERIOD
            {
                position.monthly_volume = 0;
                position.monthly_window_start = current_time;
            }

            let old_tier = position.tier;

            // Atualiza volumes e contadores com verificação segura
            position.total_volume = position
                .total_volume
                .checked_add(volume)
                .ok_or(TradingRewardsError::Overflow)?;

            position.monthly_volume = position
                .monthly_volume
                .checked_add(volume)
                .ok_or(TradingRewardsError::Overflow)?;

            position.daily_volume = new_daily_volume; // Já verificado acima
            position.last_trade_timestamp = current_time;

            position.trade_count = position
                .trade_count
                .checked_add(1)
                .ok_or(TradingRewardsError::Overflow)?;

            // Calcula novo tier
            let new_tier = self.calculate_tier(position.monthly_volume);

            // === PESO DA ÉPOCA ATUAL ===
            // peso do trade = volume * multiplicador(tier APÓS este trade) / 100.
            // Todo o cálculo checked é feito antes de qualquer escrita de peso.
            let epoch = self.current_epoch;
            let trade_weight = volume
                .checked_mul(Self::tier_multiplier(new_tier))
                .ok_or(TradingRewardsError::Overflow)?
                .checked_div(100)
                .ok_or(TradingRewardsError::Overflow)?;
            if trade_weight > 0 {
                let prev_trader_weight = self.epoch_trader_weight.get((epoch, trader)).unwrap_or(0);
                let new_trader_weight = prev_trader_weight
                    .checked_add(trade_weight)
                    .ok_or(TradingRewardsError::Overflow)?;
                let new_total_weight = self
                    .epoch_total_weight
                    .get(epoch)
                    .unwrap_or(0)
                    .checked_add(trade_weight)
                    .ok_or(TradingRewardsError::Overflow)?;
                // Trader entra na contagem da época quando o peso vai de 0 a > 0
                let new_active_count = if prev_trader_weight == 0 {
                    Some(
                        self.epoch_active_traders
                            .get(epoch)
                            .unwrap_or(0)
                            .checked_add(1)
                            .ok_or(TradingRewardsError::Overflow)?,
                    )
                } else {
                    None
                };

                self.epoch_trader_weight
                    .insert((epoch, trader), &new_trader_weight);
                self.epoch_total_weight.insert(epoch, &new_total_weight);
                if let Some(count) = new_active_count {
                    self.epoch_active_traders.insert(epoch, &count);
                }
            }

            // Atualiza cache se o tier mudou (comportamento legado, mantido)
            if old_tier != new_tier {
                let old_weight = self.calculate_tier_weight(old_tier, position.monthly_volume);
                let new_weight = self.calculate_tier_weight(new_tier, position.monthly_volume);
                let _ = self.update_weight_cache(old_weight, new_weight);
            }
            position.tier = new_tier;

            // Salva posição atualizada
            self.trading_positions.insert(trader, &position);
            if is_new_position {
                // Cursor de claim começa na época atual: o trader não tem peso
                // em épocas anteriores
                self.next_claim_epoch.insert(trader, &epoch);
            }

            // Emite eventos
            Self::env().emit_event(VolumeTracked {
                trader,
                volume,
                new_tier,
                timestamp: current_time,
            });

            if old_tier != new_tier {
                Self::env().emit_event(TierUpgraded {
                    trader,
                    old_tier,
                    new_tier,
                });
            }

            Ok(())
        }

        /// Deposita rewards no pool (apenas admin)
        #[ink(message, payable)]
        pub fn fund_rewards_pool(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.ensure_not_paused()?;

            let amount = Self::env().transferred_value();
            self.rewards_pool = self
                .rewards_pool
                .checked_add(amount)
                .ok_or(TradingRewardsError::Overflow)?;

            Ok(())
        }

        /// Fecha a época atual atribuindo a ela o pool inteiro (apenas admin).
        ///
        /// Os traders da época reivindicam depois a sua fração
        /// (`peso_trader / peso_total`) via `claim_rewards` /
        /// `claim_epoch_rewards`. O valor atribuído passa para
        /// `reserved_rewards` até ser pago.
        #[ink(message)]
        pub fn distribute_rewards(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.ensure_not_paused()?;
            // Único ponto de acquire e único ponto de release (Ok e Err)
            self.acquire_reentrancy_guard()?;
            let result = self.distribute_rewards_inner();
            self.release_reentrancy_guard();
            result
        }

        fn distribute_rewards_inner(&mut self) -> Result<(), TradingRewardsError> {
            if self.rewards_pool == 0 {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            let epoch = self.current_epoch;
            // Sem peso na época: ninguém seria creditado. Nenhuma mudança de
            // estado (pool e época intactos).
            if self.epoch_total_weight.get(epoch).unwrap_or(0) == 0 {
                return Err(TradingRewardsError::NoActiveTraders);
            }

            // A época só fecha em `epoch_end_time` (fixado quando ela abriu):
            // impede fechar uma época logo após abri-la com um pool irrisório
            // (zerando as frações), e `set_epoch_duration` não encurta nem
            // alonga a época já aberta. Nenhuma mudança de estado em falha.
            let current_time = Self::env().block_timestamp();
            if current_time < self.epoch_end_time {
                return Err(TradingRewardsError::EpochNotFinished);
            }

            let amount_to_distribute = self.rewards_pool;
            let traders_count = self.epoch_active_traders.get(epoch).unwrap_or(0);

            // Todo o cálculo checked antes das escritas
            let new_reserved = self
                .reserved_rewards
                .checked_add(amount_to_distribute)
                .ok_or(TradingRewardsError::Overflow)?;
            let new_total_distributed = self
                .total_distributed
                .checked_add(amount_to_distribute)
                .ok_or(TradingRewardsError::Overflow)?;
            let next_epoch = epoch.checked_add(1).ok_or(TradingRewardsError::Overflow)?;
            // Duração aplicada à próxima época: a vigente agora
            let next_epoch_duration = self.epoch_duration;
            let next_epoch_end = current_time
                .checked_add(next_epoch_duration)
                .ok_or(TradingRewardsError::Overflow)?;

            self.epoch_rewards.insert(epoch, &amount_to_distribute);
            self.reserved_rewards = new_reserved;
            self.total_distributed = new_total_distributed;
            self.rewards_pool = 0;
            self.last_distribution = current_time;

            Self::env().emit_event(RewardsDistributed {
                total_amount: amount_to_distribute,
                traders_count,
                timestamp: current_time,
            });
            Self::env().emit_event(EpochEnded {
                epoch_id: epoch,
                total_rewards: amount_to_distribute,
                active_traders: traders_count,
                end_time: current_time,
            });

            // Abre a próxima época
            self.current_epoch = next_epoch;
            self.epoch_start_time = current_time;
            self.epoch_end_time = next_epoch_end;
            Self::env().emit_event(EpochStarted {
                epoch_id: next_epoch,
                start_time: current_time,
                duration: next_epoch_duration,
            });

            Ok(())
        }

        /// Liquida até `MAX_EPOCHS_PER_CLAIM` épocas fechadas a partir do
        /// cursor do caller e paga o total.
        ///
        /// Retorna `Ok(0)` quando o cursor avançou mas não havia nada a pagar
        /// (permite progresso após longo período ocioso; um `Err` reverteria o
        /// cursor) e `Err(NoRewardsToClaim)` quando o cursor já estava na época
        /// atual e não há nada pendente.
        #[ink(message)]
        pub fn claim_rewards(&mut self) -> Result<Balance, TradingRewardsError> {
            self.ensure_not_paused()?;
            // Único ponto de acquire e único ponto de release (Ok e Err)
            self.acquire_reentrancy_guard()?;
            let result = self.claim_rewards_inner();
            self.release_reentrancy_guard();
            result
        }

        fn claim_rewards_inner(&mut self) -> Result<Balance, TradingRewardsError> {
            let caller = Self::env().caller();
            // Blacklist antes de qualquer `take` de peso ou avanço de cursor: o
            // valor fica em `reserved_rewards` até um eventual unblacklist
            self.ensure_not_blacklisted(caller)?;
            let mut position = self
                .trading_positions
                .get(caller)
                .ok_or(TradingRewardsError::NoRewardsToClaim)?;

            // Liquida épocas fechadas [start, end)
            let start = self.next_claim_epoch.get(caller).unwrap_or(0);
            let end = start
                .saturating_add(constants::MAX_EPOCHS_PER_CLAIM)
                .min(self.current_epoch);
            let mut settled: Balance = 0;
            for epoch in start..end {
                let share = self.take_epoch_reward(epoch, caller)?;
                settled = settled
                    .checked_add(share)
                    .ok_or(TradingRewardsError::Overflow)?;
            }
            let cursor_advanced = end > start;
            if cursor_advanced {
                self.next_claim_epoch.insert(caller, &end);
            }

            position.pending_rewards = position
                .pending_rewards
                .checked_add(settled)
                .ok_or(TradingRewardsError::Overflow)?;

            if position.pending_rewards == 0 {
                return if cursor_advanced {
                    Ok(0)
                } else {
                    Err(TradingRewardsError::NoRewardsToClaim)
                };
            }

            let amount = position.pending_rewards;
            let new_claimed = position
                .claimed_rewards
                .checked_add(amount)
                .ok_or(TradingRewardsError::Overflow)?;
            // Pendente sempre faz parte do reservado; underflow = invariante quebrado
            let new_reserved = self
                .reserved_rewards
                .checked_sub(amount)
                .ok_or(TradingRewardsError::Overflow)?;

            position.pending_rewards = 0;
            position.claimed_rewards = new_claimed;
            self.trading_positions.insert(caller, &position);
            self.reserved_rewards = new_reserved;

            // Transfere LUNES para o usuário (efeitos antes da interação)
            if Self::env().transfer(caller, amount).is_err() {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            Self::env().emit_event(RewardsClaimed {
                trader: caller,
                amount,
                timestamp: Self::env().block_timestamp(),
            });

            Ok(amount)
        }

        /// Visualiza posição de trading
        #[ink(message)]
        pub fn get_trading_position(&self, trader: AccountId) -> Option<TradingPosition> {
            self.trading_positions.get(trader)
        }

        /// Visualiza tier do trader
        #[ink(message)]
        pub fn get_trader_tier(&self, trader: AccountId) -> TradingTier {
            self.trading_positions
                .get(trader)
                .map(|p| p.tier)
                .unwrap_or(TradingTier::Bronze)
        }

        /// Estatísticas gerais
        #[ink(message)]
        pub fn get_stats(&self) -> (Balance, u32, Balance, Timestamp) {
            (
                self.rewards_pool,
                self.active_trader_count,
                self.total_distributed,
                self.last_distribution,
            )
        }

        /// Pausa o contrato (apenas admin)
        #[ink(message)]
        pub fn pause_contract(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.paused = true;
            Ok(())
        }

        /// Despausa o contrato (apenas admin)
        #[ink(message)]
        pub fn unpause_contract(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.paused = false;
            Ok(())
        }

        /// Define novo router autorizado (apenas admin)
        #[ink(message)]
        pub fn set_authorized_router(
            &mut self,
            router: AccountId,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if router == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }

            let old_router = self.authorized_router;
            self.authorized_router = router;

            Self::env().emit_event(RouterChanged {
                old_router,
                new_router: router,
                admin: self.admin,
                timestamp: Self::env().block_timestamp(),
            });

            Ok(())
        }

        /// Transfere admin (apenas admin atual)
        #[ink(message)]
        pub fn transfer_admin(&mut self, new_admin: AccountId) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if new_admin == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }

            let old_admin = self.admin;
            self.admin = new_admin;

            Self::env().emit_event(AdminTransferred {
                old_admin,
                new_admin,
                timestamp: Self::env().block_timestamp(),
            });

            Ok(())
        }

        // === FUNÇÕES DE CONFIGURAÇÃO ANTI-FRAUDE ===

        /// Define volume mínimo por trade (apenas admin)
        #[ink(message)]
        pub fn set_min_trade_volume(&mut self, volume: Balance) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.min_trade_volume = volume;
            self.emit_antifraud_parameters_updated();
            Ok(())
        }

        /// Define cooldown entre trades (apenas admin)
        #[ink(message)]
        pub fn set_trade_cooldown(
            &mut self,
            cooldown: Timestamp,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.trade_cooldown = cooldown;
            self.emit_antifraud_parameters_updated();
            Ok(())
        }

        /// Define limite máximo de volume diário (apenas admin)
        #[ink(message)]
        pub fn set_max_daily_volume(&mut self, volume: Balance) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.max_daily_volume = volume;
            self.emit_antifraud_parameters_updated();
            Ok(())
        }

        /// Atualiza todos os parâmetros anti-fraude de uma vez (apenas admin)
        #[ink(message)]
        pub fn update_antifraud_parameters(
            &mut self,
            min_volume: Balance,
            cooldown: Timestamp,
            max_daily: Balance,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.min_trade_volume = min_volume;
            self.trade_cooldown = cooldown;
            self.max_daily_volume = max_daily;
            self.emit_antifraud_parameters_updated();
            Ok(())
        }

        /// Obtém parâmetros anti-fraude atuais
        #[ink(message)]
        pub fn get_antifraud_parameters(&self) -> (Balance, Timestamp, Balance) {
            (
                self.min_trade_volume,
                self.trade_cooldown,
                self.max_daily_volume,
            )
        }

        // === SISTEMA DE ÉPOCAS ===

        /// Inicia uma nova época (apenas admin)
        #[ink(message)]
        pub fn start_new_epoch(&mut self) -> Result<u32, TradingRewardsError> {
            self.ensure_admin()?;
            self.ensure_not_paused()?;

            // Época com peso só fecha via `distribute_rewards`: avançar aqui
            // deixaria `epoch_rewards` = 0 e zeraria a fração de todos os
            // traders da época para sempre. Nenhuma mudança de estado.
            if self.epoch_total_weight.get(self.current_epoch).unwrap_or(0) > 0 {
                return Err(TradingRewardsError::EpochHasPendingWeight);
            }

            let current_time = Self::env().block_timestamp();

            // Todo o cálculo checked antes de qualquer escrita
            let next_epoch = self
                .current_epoch
                .checked_add(1)
                .ok_or(TradingRewardsError::Overflow)?;
            let next_epoch_duration = self.epoch_duration;
            let next_epoch_end = current_time
                .checked_add(next_epoch_duration)
                .ok_or(TradingRewardsError::Overflow)?;

            // Finaliza época atual se houver (apenas emite `EpochEnded`)
            if self.current_epoch > 0 && current_time >= self.epoch_end_time {
                self.finalize_current_epoch()?;
            }

            // Inicia nova época com o fim fixado agora
            self.current_epoch = next_epoch;
            self.epoch_start_time = current_time;
            self.epoch_end_time = next_epoch_end;

            Self::env().emit_event(EpochStarted {
                epoch_id: next_epoch,
                start_time: current_time,
                duration: next_epoch_duration,
            });

            Ok(next_epoch)
        }

        /// Finaliza a época atual (apenas admin)
        #[ink(message)]
        pub fn finalize_current_epoch(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;

            if self.current_epoch == 0 {
                return Ok(()); // Nenhuma época ativa
            }

            let current_time = Self::env().block_timestamp();
            let epoch_rewards = self.epoch_rewards.get(self.current_epoch).unwrap_or(0);
            let active_traders = self
                .epoch_active_traders
                .get(self.current_epoch)
                .unwrap_or(0);

            Self::env().emit_event(EpochEnded {
                epoch_id: self.current_epoch,
                total_rewards: epoch_rewards,
                active_traders,
                end_time: current_time,
            });

            Ok(())
        }

        /// Define duração da época em ms (apenas admin), entre
        /// `MIN_EPOCH_DURATION` (1 h) e `MAX_EPOCH_DURATION` (90 dias).
        ///
        /// Só afeta épocas abertas DEPOIS desta chamada: o fim da época atual
        /// (`epoch_end_time`) foi fixado quando ela abriu e não muda.
        #[ink(message)]
        pub fn set_epoch_duration(
            &mut self,
            duration: Timestamp,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if !(constants::MIN_EPOCH_DURATION..=constants::MAX_EPOCH_DURATION).contains(&duration)
            {
                // Fora de [1 h, 90 dias] em ms
                return Err(TradingRewardsError::VolumeTooSmall); // Reutilizando erro por simplicidade
            }
            self.epoch_duration = duration;
            Ok(())
        }

        /// Reivindica rewards de uma época específica (já fechada)
        #[ink(message)]
        pub fn claim_epoch_rewards(
            &mut self,
            epoch_id: u32,
        ) -> Result<Balance, TradingRewardsError> {
            self.ensure_not_paused()?;
            // Único ponto de acquire e único ponto de release (Ok e Err)
            self.acquire_reentrancy_guard()?;
            let result = self.claim_epoch_rewards_inner(epoch_id);
            self.release_reentrancy_guard();
            result
        }

        fn claim_epoch_rewards_inner(
            &mut self,
            epoch_id: u32,
        ) -> Result<Balance, TradingRewardsError> {
            let caller = Self::env().caller();
            // Blacklist antes de qualquer `take` de peso (ver claim_rewards_inner)
            self.ensure_not_blacklisted(caller)?;
            let current_time = Self::env().block_timestamp();

            // Verifica se a época já finalizou
            if epoch_id >= self.current_epoch {
                return Err(TradingRewardsError::NoRewardsToClaim);
            }

            // Primitivo único: remove a entrada de peso (impede double-spend,
            // inclusive contra `claim_rewards`)
            let reward_amount = self.take_epoch_reward(epoch_id, caller)?;
            if reward_amount == 0 {
                return Err(TradingRewardsError::NoRewardsToClaim);
            }

            self.reserved_rewards = self
                .reserved_rewards
                .checked_sub(reward_amount)
                .ok_or(TradingRewardsError::Overflow)?;

            // Mantém `claimed_rewards` da posição consistente com o pago
            if let Some(mut position) = self.trading_positions.get(caller) {
                position.claimed_rewards = position
                    .claimed_rewards
                    .checked_add(reward_amount)
                    .ok_or(TradingRewardsError::Overflow)?;
                self.trading_positions.insert(caller, &position);
            }

            // Transfere LUNES para o usuário (efeitos antes da interação)
            if Self::env().transfer(caller, reward_amount).is_err() {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            Self::env().emit_event(RewardsClaimed {
                trader: caller,
                amount: reward_amount,
                timestamp: current_time,
            });

            Ok(reward_amount)
        }

        /// Obtém informações da época atual:
        /// (`current_epoch`, `epoch_start_time`, `epoch_duration`, rewards).
        ///
        /// ATENÇÃO: `epoch_duration` é a duração CONFIGURADA (aplicada às
        /// próximas épocas); após `set_epoch_duration` ela pode diferir da
        /// época aberta. O fim real da época aberta, usado pelo gate de
        /// `distribute_rewards`, é `get_epoch_end_time()`.
        #[ink(message)]
        pub fn get_current_epoch_info(&self) -> (u32, Timestamp, Timestamp, Balance) {
            let rewards = self.epoch_rewards.get(self.current_epoch).unwrap_or(0);
            (
                self.current_epoch,
                self.epoch_start_time,
                self.epoch_duration,
                rewards,
            )
        }

        /// Fim da época atual (ms). É o mesmo valor que o gate de
        /// `distribute_rewards` usa: a época só pode ser distribuída quando
        /// `block_timestamp >= get_epoch_end_time()`.
        #[ink(message)]
        pub fn get_epoch_end_time(&self) -> Timestamp {
            self.epoch_end_time
        }

        /// Quanto `trader` ainda pode reivindicar da época `epoch_id`.
        /// 0 para época aberta, já reivindicada, sem peso ou sem rewards.
        /// (Calculado dos pesos; `epoch_trader_rewards` não é usado.)
        #[ink(message)]
        pub fn get_epoch_rewards(&self, epoch_id: u32, trader: AccountId) -> Balance {
            if epoch_id >= self.current_epoch {
                return 0;
            }
            let weight = self
                .epoch_trader_weight
                .get((epoch_id, trader))
                .unwrap_or(0);
            // Overflow -> 0 aqui; o claim correspondente retornaria Err(Overflow)
            self.epoch_share(epoch_id, weight).unwrap_or(0)
        }

        // === FUNÇÕES ANTI-FRAUDE ===

        /// Adiciona endereço à blacklist (apenas admin)
        #[ink(message)]
        pub fn blacklist_address(&mut self, address: AccountId) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if address == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }
            self.blacklisted_addresses.insert(address, &true);
            self.total_suspicious_flags = self
                .total_suspicious_flags
                .checked_add(1)
                .ok_or(TradingRewardsError::Overflow)?;
            Ok(())
        }

        /// Remove endereço da blacklist (apenas admin)
        #[ink(message)]
        pub fn unblacklist_address(
            &mut self,
            address: AccountId,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.blacklisted_addresses.remove(address);
            Ok(())
        }

        /// Verifica se endereço está blacklisted
        #[ink(message)]
        pub fn is_blacklisted(&self, address: AccountId) -> bool {
            self.blacklisted_addresses.get(address).unwrap_or(false)
        }

        /// Obtém estatísticas de segurança
        #[ink(message)]
        pub fn get_security_stats(&self) -> (u32, u32) {
            (self.total_suspicious_flags, self.active_trader_count)
        }

        /// Marca endereço como suspeito (apenas admin)
        #[ink(message)]
        pub fn flag_suspicious_address(
            &mut self,
            address: AccountId,
            flag: u8,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if let Some(mut position) = self.trading_positions.get(address) {
                position.suspicious_flags |= flag;
                self.trading_positions.insert(address, &position);

                // Se acumular muitas flags, blacklist automaticamente
                if position.suspicious_flags >= constants::SUSPICIOUS_FLAG_BLACKLISTED {
                    self.blacklist_address(address)?;
                }
            }
            Ok(())
        }

        // === INTEGRAÇÃO COM STAKING ===

        /// Define o endereço do contrato de staking (apenas admin)
        #[ink(message)]
        pub fn set_staking_contract(
            &mut self,
            staking_address: AccountId,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if staking_address == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }
            self.staking_contract = Some(staking_address);
            Ok(())
        }

        /// Remove o contrato de staking (apenas admin). Saída de emergência
        /// quando o staking está pausado ou com ABI incompatível (toda
        /// `receive_fee_allocation` reverteria): a partir daí 100% vai para o
        /// `rewards_pool`. Idempotente. Sem evento (o setter também não emite).
        #[ink(message)]
        pub fn clear_staking_contract(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            self.staking_contract = None;
            Ok(())
        }

        /// Anula o peso de um trader ATUALMENTE em blacklist numa época
        /// (apenas admin; funciona com o contrato pausado). Retorna o peso
        /// anulado (0 = nada a anular, sem mudança de estado e sem evento).
        ///
        /// - Época aberta (`epoch_id == current_epoch`): o peso sai de
        ///   `epoch_total_weight` e o trader sai de `epoch_active_traders`.
        /// - Época fechada (`epoch_id < current_epoch`): a fração do trader
        ///   (mesma conta do claim) sai de `reserved_rewards` e volta para o
        ///   `rewards_pool` (próxima distribuição), e é subtraída de
        ///   `total_distributed`. O total de peso e `epoch_rewards` da época
        ///   fechada não mudam, então as frações dos demais ficam intactas.
        ///
        /// ORDEM: anule PRIMEIRO a época aberta e DEPOIS as fechadas. Void de
        /// época fechada com o trader ainda pesando na época aberta é recusado
        /// (`OpenEpochWeightPending`): a fração devolvida ao pool seria
        /// redistribuída em parte ao próprio trader.
        ///
        /// Regra operacional (não imposta on-chain): após anular peso de época
        /// fechada, NÃO faça unblacklist do trader antes do próximo
        /// `distribute_rewards`. Senão ele volta a operar na época aberta e
        /// concorre à própria fração que acabou de ser devolvida ao pool.
        ///
        /// Todo void efetivo também zera a janela de tier do trader
        /// (`monthly_volume = 0`, `tier = Bronze`, nova âncora mensal), para
        /// que o volume anulado não infle o multiplicador após um unblacklist.
        ///
        /// Contabilidade: os eventos `RewardsDistributed` são brutos;
        /// `BlacklistedWeightVoided.returned_to_pool` é o lançamento de ajuste.
        ///
        /// A entrada de peso é removida, então um claim posterior (após
        /// unblacklist) dessa época paga 0.
        #[ink(message)]
        pub fn void_blacklisted_weight(
            &mut self,
            trader: AccountId,
            epoch_id: u32,
        ) -> Result<Balance, TradingRewardsError> {
            self.ensure_admin()?;
            // Único ponto de acquire e único ponto de release (Ok e Err)
            self.acquire_reentrancy_guard()?;
            let result = self.void_blacklisted_weight_inner(trader, epoch_id);
            self.release_reentrancy_guard();
            result
        }

        fn void_blacklisted_weight_inner(
            &mut self,
            trader: AccountId,
            epoch_id: u32,
        ) -> Result<Balance, TradingRewardsError> {
            if !self.blacklisted_addresses.get(trader).unwrap_or(false) {
                return Err(TradingRewardsError::NotBlacklisted);
            }

            let weight = self
                .epoch_trader_weight
                .get((epoch_id, trader))
                .unwrap_or(0);
            if weight == 0 {
                return Ok(0);
            }

            let current_epoch = self.current_epoch;
            let current_time = Self::env().block_timestamp();

            // R4-3: janela de tier zerada (preparada; gravada após os checks).
            // total_volume, daily_volume, last_trade_timestamp e o cursor de
            // claim não mudam. Sem posição, nada a zerar.
            let reset_position = self.trading_positions.get(trader).map(|mut position| {
                position.monthly_volume = 0;
                position.tier = TradingTier::Bronze;
                position.monthly_window_start = current_time;
                position
            });

            // Cada ramo faz TODOS os checks e o cálculo checked antes da
            // primeira escrita; depois do `match` nada mais pode falhar.
            let returned_to_pool = match epoch_id.cmp(&current_epoch) {
                core::cmp::Ordering::Equal => {
                    let new_total = self
                        .epoch_total_weight
                        .get(epoch_id)
                        .unwrap_or(0)
                        .checked_sub(weight)
                        .ok_or(TradingRewardsError::Overflow)?;
                    let new_active = self
                        .epoch_active_traders
                        .get(epoch_id)
                        .unwrap_or(0)
                        .checked_sub(1)
                        .ok_or(TradingRewardsError::Overflow)?;

                    self.epoch_trader_weight.remove((epoch_id, trader));
                    self.epoch_total_weight.insert(epoch_id, &new_total);
                    self.epoch_active_traders.insert(epoch_id, &new_active);
                    0
                }
                core::cmp::Ordering::Less => {
                    // R4-2: com peso na época aberta, a fração devolvida ao pool
                    // voltaria em parte ao próprio trader na próxima distribuição
                    if self
                        .epoch_trader_weight
                        .get((current_epoch, trader))
                        .unwrap_or(0)
                        > 0
                    {
                        return Err(TradingRewardsError::OpenEpochWeightPending);
                    }
                    // Mesma conta do claim (`take_epoch_reward`)
                    let share = self.epoch_share(epoch_id, weight)?;
                    let new_reserved = self
                        .reserved_rewards
                        .checked_sub(share)
                        .ok_or(TradingRewardsError::Overflow)?;
                    let new_pool = self
                        .rewards_pool
                        .checked_add(share)
                        .ok_or(TradingRewardsError::Overflow)?;
                    // R4-4: a fração volta ao pool e será distribuída de novo;
                    // sem isto seria contada duas vezes em `total_distributed`
                    let new_total_distributed = self
                        .total_distributed
                        .checked_sub(share)
                        .ok_or(TradingRewardsError::Overflow)?;

                    self.epoch_trader_weight.remove((epoch_id, trader));
                    self.reserved_rewards = new_reserved;
                    self.rewards_pool = new_pool;
                    self.total_distributed = new_total_distributed;
                    share
                }
                core::cmp::Ordering::Greater => {
                    // Época futura: nunca há peso (track só escreve na atual)
                    return Ok(0);
                }
            };

            if let Some(position) = reset_position {
                self.trading_positions.insert(trader, &position);
            }

            Self::env().emit_event(BlacklistedWeightVoided {
                trader,
                epoch_id,
                weight,
                returned_to_pool,
                timestamp: current_time,
            });

            Ok(weight)
        }

        /// Recebe fee allocation do pair contract e distribui 10% para staking.
        ///
        /// Com staking configurado, os 10% são enviados via
        /// `fund_staking_rewards` (o staking contabiliza em
        /// `trading_rewards_pool`); qualquer falha dessa chamada reverte a
        /// mensagem inteira (`StakingFundingFailed`). Sem staking configurado,
        /// 100% vai para o `rewards_pool` (nada fica sem contabilização).
        #[ink(message, payable)]
        pub fn receive_fee_allocation(&mut self) -> Result<(), TradingRewardsError> {
            self.ensure_not_paused()?;
            // Único ponto de acquire e único ponto de release (Ok e Err).
            //
            // ATENÇÃO (reentrância): em ink! 4.3 o struct raiz (incluindo
            // `reentrancy_guard` e `rewards_pool`) só é gravado em storage no
            // FIM da mensagem. Durante a chamada externa ao staking o guard está
            // ativo apenas em memória: um frame que reentrasse leria o valor
            // antigo do storage (`false`). A proteção real on-chain é o
            // pallet-contracts negar reentrada por padrão (`build_call` sem
            // `CallFlags::ALLOW_REENTRY`). Este contrato NUNCA deve usar
            // `allow_reentry(true)`.
            self.acquire_reentrancy_guard()?;
            let result = self.receive_fee_allocation_inner();
            self.release_reentrancy_guard();
            result
        }

        fn receive_fee_allocation_inner(&mut self) -> Result<(), TradingRewardsError> {
            let amount = Self::env().transferred_value();
            if amount == 0 {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            let staking_target = self.staking_contract;
            let (trading_rewards_amount, staking_rewards_amount) = match staking_target {
                Some(_) => {
                    // 90% fica no pool de trading rewards
                    let trading = amount
                        .checked_mul(90)
                        .ok_or(TradingRewardsError::Overflow)?
                        .checked_div(100)
                        .ok_or(TradingRewardsError::Overflow)?;
                    // 10% vai para staking
                    let staking = amount
                        .checked_sub(trading)
                        .ok_or(TradingRewardsError::Overflow)?;
                    (trading, staking)
                }
                None => (amount, 0),
            };

            // Atualiza o pool em memória antes da chamada externa. Não é visível
            // a um frame reentrante (o struct raiz só é gravado no fim da
            // mensagem); ver nota de reentrância em `receive_fee_allocation`.
            self.rewards_pool = self
                .rewards_pool
                .checked_add(trading_rewards_amount)
                .ok_or(TradingRewardsError::Overflow)?;

            if let Some(staking_address) = staking_target {
                if staking_rewards_amount > 0 {
                    self.fund_staking_rewards_call(staking_address, staking_rewards_amount)?;
                }
            }

            Self::env().emit_event(RewardsPoolFunded {
                total_amount: amount,
                trading_amount: trading_rewards_amount,
                staking_amount: staking_rewards_amount,
                timestamp: Self::env().block_timestamp(),
            });

            Ok(())
        }

        /// Resgata LUNES NÃO contabilizados (apenas admin).
        ///
        /// Só pode mover o excedente `saldo - rewards_pool - reserved_rewards`:
        /// nunca toca rewards fundados nem rewards devidos a traders.
        #[ink(message)]
        pub fn rescue_native(
            &mut self,
            to: AccountId,
            amount: Balance,
        ) -> Result<(), TradingRewardsError> {
            self.ensure_admin()?;
            if to == AccountId::from([0u8; 32]) {
                return Err(TradingRewardsError::ZeroAddress);
            }

            let surplus = self.rescuable_surplus();
            if amount == 0 || amount > surplus {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            if Self::env().transfer(to, amount).is_err() {
                return Err(TradingRewardsError::InsufficientBalance);
            }

            Self::env().emit_event(NativeRescued {
                to,
                amount,
                timestamp: Self::env().block_timestamp(),
            });

            Ok(())
        }

        /// Contabilidade de rewards (somente leitura):
        /// (`rewards_pool`, `reserved_rewards`, excedente resgatável por
        /// `rescue_native`, saturando em 0)
        #[ink(message)]
        pub fn get_reward_accounting(&self) -> (Balance, Balance, Balance) {
            (
                self.rewards_pool,
                self.reserved_rewards,
                self.rescuable_surplus(),
            )
        }

        // === FUNÇÕES HELPER ===

        /// Excedente não contabilizado = saldo - rewards_pool - reserved_rewards.
        /// Saldo abaixo das obrigações => 0. Fonte única para `rescue_native`
        /// e `get_reward_accounting`.
        fn rescuable_surplus(&self) -> Balance {
            Self::env()
                .balance()
                .saturating_sub(self.rewards_pool)
                .saturating_sub(self.reserved_rewards)
        }

        /// Chama `fund_staking_rewards()` (payable) no staking com `amount`.
        ///
        /// Decode do retorno sem depender da crate do staking: o callee
        /// retorna `MessageResult<Result<(), StakingError>>` e `StakingError`
        /// é um enum sem campos (SCALE = 1 byte de índice), então é lido como
        /// `Result<(), u8>`. Só `Ok(Ok(Ok(())))` conta como sucesso; qualquer
        /// outra forma (erro de ambiente, decode inválido, LangError, Err do
        /// callee) => `StakingFundingFailed`.
        fn fund_staking_rewards_call(
            &self,
            staking: AccountId,
            amount: Balance,
        ) -> Result<(), TradingRewardsError> {
            #[cfg(not(test))]
            {
                use ink::env::call::{build_call, ExecutionInput, Selector};
                let result = build_call::<ink::env::DefaultEnvironment>()
                    .call(staking)
                    .gas_limit(0)
                    .transferred_value(amount)
                    .exec_input(ExecutionInput::new(Selector::new(
                        STAKING_FUND_STAKING_REWARDS_SELECTOR,
                    )))
                    .returns::<core::result::Result<(), u8>>()
                    .try_invoke();
                if Self::staking_call_succeeded(result) {
                    Ok(())
                } else {
                    Err(TradingRewardsError::StakingFundingFailed)
                }
            }
            #[cfg(test)]
            {
                // Stand-in determinístico: move o valor como a chamada real
                // faria (transferred_value) e responde Ok, ou falha sob demanda.
                // Registra o guard EM MEMÓRIA no momento da chamada externa
                // (prova o formato acquire/inner/release; não prova proteção
                // on-chain, que vem do pallet negar reentrada por padrão).
                test_mocks::record_guard_during_staking_call(self.reentrancy_guard);
                if test_mocks::staking_call_fails() {
                    return Err(TradingRewardsError::StakingFundingFailed);
                }
                Self::env()
                    .transfer(staking, amount)
                    .map_err(|_| TradingRewardsError::StakingFundingFailed)
            }
        }

        /// Classifica o resultado da chamada ao staking (fail-closed): apenas
        /// "callee retornou Ok(())" é sucesso.
        fn staking_call_succeeded(
            result: ink::env::Result<ink::MessageResult<Result<(), u8>>>,
        ) -> bool {
            matches!(result, Ok(Ok(Ok(()))))
        }

        /// Primitivo ÚNICO de claim: lê e REMOVE o peso do trader na época
        /// fechada e devolve a fração `epoch_rewards * peso / peso_total`
        /// (floor). 0 se não houver entrada ou rewards. Como a entrada é
        /// removida, uma fração nunca é paga duas vezes.
        fn take_epoch_reward(
            &mut self,
            epoch: u32,
            trader: AccountId,
        ) -> Result<Balance, TradingRewardsError> {
            if epoch >= self.current_epoch {
                return Ok(0);
            }
            let weight = match self.epoch_trader_weight.take((epoch, trader)) {
                Some(w) => w,
                None => return Ok(0),
            };
            self.epoch_share(epoch, weight)
        }

        /// Fração de `weight` nos rewards da época (floor, checked).
        fn epoch_share(&self, epoch: u32, weight: Balance) -> Result<Balance, TradingRewardsError> {
            let rewards = self.epoch_rewards.get(epoch).unwrap_or(0);
            if rewards == 0 || weight == 0 {
                return Ok(0);
            }
            let total_weight = self.epoch_total_weight.get(epoch).unwrap_or(0);
            rewards
                .checked_mul(weight)
                .ok_or(TradingRewardsError::Overflow)?
                .checked_div(total_weight)
                .ok_or(TradingRewardsError::Overflow)
        }

        /// Multiplicador (base 100) do tier
        fn tier_multiplier(tier: TradingTier) -> Balance {
            let multiplier = match tier {
                TradingTier::Bronze => constants::BRONZE_MULTIPLIER,
                TradingTier::Silver => constants::SILVER_MULTIPLIER,
                TradingTier::Gold => constants::GOLD_MULTIPLIER,
                TradingTier::Platinum => constants::PLATINUM_MULTIPLIER,
            };
            multiplier as Balance
        }

        /// Calcula tier baseado no volume mensal
        fn calculate_tier(&self, monthly_volume: Balance) -> TradingTier {
            if monthly_volume >= constants::PLATINUM_THRESHOLD {
                TradingTier::Platinum
            } else if monthly_volume >= constants::GOLD_THRESHOLD {
                TradingTier::Gold
            } else if monthly_volume >= constants::SILVER_THRESHOLD {
                TradingTier::Silver
            } else {
                TradingTier::Bronze
            }
        }

        /// Atualiza cache quando trader muda de tier
        fn update_weight_cache(
            &mut self,
            old_weight: Balance,
            new_weight: Balance,
        ) -> Result<(), TradingRewardsError> {
            // Remove o peso antigo e adiciona o novo.
            //
            // `saturating_sub` é intencional: quando um trader é novo, o cache ainda
            // está em 0 e `old_weight > cached_total_weight`, o que causaria underflow.
            // Saturar em 0 (em vez de retornar Err) mantém o invariante "peso >= 0"
            // sem quebrar o fluxo normal de primeiros traders.
            //
            // `checked_add` para new_weight é mantido: um peso astronomicamente
            // grande ainda deve ser rejeitado explicitamente.
            self.cached_total_weight = self
                .cached_total_weight
                .saturating_sub(old_weight)
                .checked_add(new_weight)
                .ok_or(TradingRewardsError::Overflow)?;

            self.weight_cache_timestamp = Self::env().block_timestamp();
            Ok(())
        }

        /// Calcula peso para um tier e volume específicos.
        ///
        /// `saturating_mul` é usado em vez de `checked_mul` pois esta função retorna
        /// `Balance` (não `Result`). Na prática, overflow só ocorreria com volumes
        /// astronomicamente grandes (> 10^36 LUNES); saturating ao `u128::MAX` mantém
        /// a proporção correcta em distribuições relativas.
        /// `checked_div(100)` nunca falha (divisor != 0); o `.unwrap_or(0)` é morto.
        fn calculate_tier_weight(&self, tier: TradingTier, monthly_volume: Balance) -> Balance {
            monthly_volume
                .saturating_mul(Self::tier_multiplier(tier))
                .checked_div(100)
                .unwrap_or(0)
        }

        /// Verifica se é admin
        fn ensure_admin(&self) -> Result<(), TradingRewardsError> {
            if Self::env().caller() != self.admin {
                return Err(TradingRewardsError::AccessDenied);
            }
            Ok(())
        }

        /// Verifica se é router autorizado
        fn ensure_authorized_router(&self) -> Result<(), TradingRewardsError> {
            if Self::env().caller() != self.authorized_router {
                return Err(TradingRewardsError::AccessDenied);
            }
            Ok(())
        }

        /// Rejeita endereço em blacklist
        fn ensure_not_blacklisted(&self, account: AccountId) -> Result<(), TradingRewardsError> {
            if self.blacklisted_addresses.get(account).unwrap_or(false) {
                return Err(TradingRewardsError::SuspiciousAddress);
            }
            Ok(())
        }

        /// Verifica se contrato não está pausado
        fn ensure_not_paused(&self) -> Result<(), TradingRewardsError> {
            if self.paused {
                return Err(TradingRewardsError::ContractPaused);
            }
            Ok(())
        }

        /// Adquire reentrancy guard (padrão acquire/release).
        ///
        /// O guard vive no struct raiz, que em ink! 4.3 só é gravado no fim da
        /// mensagem: ele NÃO é visível a um frame reentrante. A proteção
        /// on-chain contra reentrada é o pallet-contracts negar reentrada por
        /// padrão (nunca usar `allow_reentry(true)` neste contrato).
        fn acquire_reentrancy_guard(&mut self) -> Result<(), TradingRewardsError> {
            if self.reentrancy_guard {
                return Err(TradingRewardsError::ReentrancyGuardActive);
            }
            self.reentrancy_guard = true;
            Ok(())
        }

        /// Libera reentrancy guard
        fn release_reentrancy_guard(&mut self) {
            self.reentrancy_guard = false;
        }

        /// Emite evento de atualização de parâmetros anti-fraude
        fn emit_antifraud_parameters_updated(&self) {
            Self::env().emit_event(AntifraudParametersUpdated {
                min_trade_volume: self.min_trade_volume,
                trade_cooldown: self.trade_cooldown,
                max_daily_volume: self.max_daily_volume,
                admin: self.admin,
                timestamp: Self::env().block_timestamp(),
            });
        }
    }

    /// Stand-in determinístico da chamada cross-contract ao staking (não há
    /// contratos reais no env de teste do ink). O caminho real
    /// (`build_call` + decode do resultado) NÃO é exercitado por unit tests.
    #[cfg(test)]
    pub(crate) mod test_mocks {
        use std::cell::Cell;

        thread_local! {
            static STAKING_CALL_FAILS: Cell<bool> = const { Cell::new(false) };
            static GUARD_DURING_STAKING_CALL: Cell<Option<bool>> = const { Cell::new(None) };
        }

        /// Faz o próximo `fund_staking_rewards` simulado falhar
        pub fn set_staking_call_fails(fails: bool) {
            STAKING_CALL_FAILS.with(|f| f.set(fails));
        }

        pub fn staking_call_fails() -> bool {
            STAKING_CALL_FAILS.with(|f| f.get())
        }

        /// Estado do reentrancy guard observado na última chamada simulada
        /// ao staking (`None` = nenhuma chamada desde o último reset)
        pub fn record_guard_during_staking_call(active: bool) {
            GUARD_DURING_STAKING_CALL.with(|g| g.set(Some(active)));
        }

        pub fn take_guard_during_staking_call() -> Option<bool> {
            GUARD_DURING_STAKING_CALL.with(|g| g.take())
        }
    }

    /// Testes unitários
    #[cfg(test)]
    // Aritmética de teste (tempos, saldos esperados) em valores pequenos e
    // controlados; o lint de `arithmetic_side_effects` vale para o contrato.
    #[allow(clippy::arithmetic_side_effects)]
    mod tests {
        use super::*;

        fn default_accounts() -> ink::env::test::DefaultAccounts<ink::env::DefaultEnvironment> {
            ink::env::test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn set_next_caller(caller: AccountId) {
            ink::env::test::set_caller::<ink::env::DefaultEnvironment>(caller);
        }

        fn set_balance(account: AccountId, balance: Balance) {
            ink::env::test::set_account_balance::<ink::env::DefaultEnvironment>(account, balance);
        }

        // Isolamento completo de tempo entre testes usando thread_local!
        use std::cell::Cell;

        thread_local! {
            static TEST_TIME: Cell<u64> = const { Cell::new(1000) };
        }

        fn reset_test_time_with_seed(seed: u64) {
            let initial_time = 1000 + (seed * 100000000); // Cada teste começa em um timestamp único
            TEST_TIME.with(|time| time.set(initial_time));
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(initial_time);
        }

        fn advance_time(ms: u64) {
            TEST_TIME.with(|time| {
                let current = time.get();
                let new_time = current + ms;
                time.set(new_time);
                ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(new_time);
            });
        }

        // === HELPERS DE CONTABILIDADE (saldo real no env off-chain) ===

        type Env = ink::env::DefaultEnvironment;
        type Event = <TradingRewardsContract as ink::reflect::ContractEventBase>::Type;

        const L: Balance = constants::DECIMALS_8; // 1 LUNES

        /// Conta dedicada do contrato. No env off-chain o callee padrão é
        /// alice (= admin nos testes), o que misturaria os saldos.
        fn contract_account() -> AccountId {
            AccountId::from([0xC0; 32])
        }

        fn use_contract_account() {
            ink::env::test::set_callee::<Env>(contract_account());
            set_balance(contract_account(), 0);
        }

        fn balance_of(account: AccountId) -> Balance {
            ink::env::test::get_account_balance::<Env>(account).unwrap_or(0)
        }

        /// `set_value_transferred` não move saldo no env off-chain: credita o
        /// saldo da conta do contrato explicitamente antes da mensagem payable.
        fn credit_contract(amount: Balance) {
            set_balance(contract_account(), balance_of(contract_account()) + amount);
            ink::env::test::set_value_transferred::<Env>(amount);
        }

        fn fund_pool(contract: &mut TradingRewardsContract, amount: Balance) {
            let accounts = default_accounts();
            set_next_caller(accounts.alice);
            credit_contract(amount);
            contract.fund_rewards_pool().unwrap();
            ink::env::test::set_value_transferred::<Env>(0);
        }

        fn track(contract: &mut TradingRewardsContract, trader: AccountId, volume: Balance) {
            set_next_caller(default_accounts().bob);
            advance_time(61_000); // passa do cooldown padrão (60 s, em ms)
            contract.track_trading_volume(trader, volume).unwrap();
            assert!(!contract.reentrancy_guard);
        }

        /// Avança o relógio até exatamente `epoch_end_time` (fim da época
        /// atual, o mesmo valor do gate), se ainda não chegou lá
        fn advance_to_epoch_end(contract: &TradingRewardsContract) {
            let end = contract.epoch_end_time;
            let now = TEST_TIME.with(|t| t.get());
            if end > now {
                advance_time(end - now);
            }
        }

        fn distribute(contract: &mut TradingRewardsContract) {
            advance_to_epoch_end(contract);
            set_next_caller(default_accounts().alice);
            contract.distribute_rewards().unwrap();
            assert!(!contract.reentrancy_guard);
        }

        fn claim(contract: &mut TradingRewardsContract, trader: AccountId) -> Balance {
            set_next_caller(trader);
            let amount = contract.claim_rewards().unwrap();
            assert!(!contract.reentrancy_guard);
            amount
        }

        /// Invariante de solvência: saldo >= pool + reservado
        fn assert_solvent(contract: &TradingRewardsContract) {
            assert!(
                balance_of(contract_account()) >= contract.rewards_pool + contract.reserved_rewards,
                "insolvente: saldo {} < pool {} + reservado {}",
                balance_of(contract_account()),
                contract.rewards_pool,
                contract.reserved_rewards
            );
        }

        /// Invariante: soma dos pesos dos traders == peso total da época
        fn assert_weight_invariant(
            contract: &TradingRewardsContract,
            epoch: u32,
            traders: &[AccountId],
        ) {
            let sum: Balance = traders
                .iter()
                .map(|t| contract.epoch_trader_weight.get((epoch, *t)).unwrap_or(0))
                .sum();
            assert_eq!(sum, contract.epoch_total_weight.get(epoch).unwrap_or(0));
        }

        fn decoded_events() -> Vec<Event> {
            ink::env::test::recorded_events()
                .map(|e| <Event as scale::Decode>::decode(&mut &e.data[..]).unwrap())
                .collect()
        }

        #[ink::test]
        fn test_new_contract() {
            let accounts = default_accounts();
            let contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            assert_eq!(contract.admin, accounts.alice);
            assert_eq!(contract.authorized_router, accounts.bob);
            assert_eq!(contract.rewards_pool, 0);
            assert!(!contract.paused);
        }

        #[ink::test]
        fn test_track_trading_volume() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Simula chamada do router
            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial

            let volume = 5_000 * constants::DECIMALS_8; // 5k LUNES (acima do mínimo)
            contract
                .track_trading_volume(accounts.charlie, volume)
                .unwrap();

            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.total_volume, volume);
            assert_eq!(position.monthly_volume, volume);
            assert_eq!(position.daily_volume, volume);
            assert_eq!(position.tier, TradingTier::Bronze);
            assert_eq!(position.trade_count, 1);
        }

        #[ink::test]
        fn test_tier_upgrade() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial

            // Volume para Silver tier
            let volume = 15_000 * constants::DECIMALS_8; // 15k LUNES
            contract
                .track_trading_volume(accounts.charlie, volume)
                .unwrap();

            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.tier, TradingTier::Silver);
        }

        #[ink::test]
        fn test_fund_and_distribute_rewards() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Configura balance
            set_balance(accounts.alice, 1000 * constants::DECIMALS_8);

            // Admin funda o pool
            set_next_caller(accounts.alice);
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(
                100 * constants::DECIMALS_8,
            );
            contract.fund_rewards_pool().unwrap();
            assert_eq!(contract.rewards_pool, 100 * constants::DECIMALS_8);

            // Adiciona trader
            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial
            contract
                .track_trading_volume(accounts.charlie, 10_000 * constants::DECIMALS_8)
                .unwrap();

            // Distribui rewards (após o fim da época)
            advance_to_epoch_end(&contract);
            set_next_caller(accounts.alice);
            contract.distribute_rewards().unwrap();

            assert_eq!(contract.rewards_pool, 0);
            // O pool distribuído fica reservado para a época 0 (não some)
            assert_eq!(contract.reserved_rewards, 100 * constants::DECIMALS_8);
            assert_eq!(
                contract.epoch_rewards.get(0).unwrap_or(0),
                100 * constants::DECIMALS_8
            );
            assert_eq!(contract.current_epoch, 1);

            let _position = contract.get_trading_position(accounts.charlie).unwrap();
            // position.pending_rewards é sempre >= 0 por ser Balance (unsigned)
        }

        #[ink::test]
        fn test_claim_rewards() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Setup: conta própria do contrato (no env off-chain o callee
            // padrão é alice, que também é o admin) com saldo = pool fundado
            use_contract_account();
            set_balance(accounts.alice, 1000 * constants::DECIMALS_8);
            set_balance(accounts.charlie, 0);

            // Fund pool
            fund_pool(&mut contract, 100 * constants::DECIMALS_8);

            // Add trader e distribui
            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial
            contract
                .track_trading_volume(accounts.charlie, 10_000 * constants::DECIMALS_8)
                .unwrap();

            advance_to_epoch_end(&contract); // distribuição só após o fim da época
            set_next_caller(accounts.alice);
            contract.distribute_rewards().unwrap();

            // Claim rewards: único trader da época recebe o pool inteiro,
            // creditado pela distribuição real (sem simulação manual)
            set_next_caller(accounts.charlie);
            let claimed = contract.claim_rewards().unwrap();
            assert_eq!(claimed, 100 * constants::DECIMALS_8);
            assert_eq!(balance_of(accounts.charlie), 100 * constants::DECIMALS_8);
            assert_eq!(balance_of(contract_account()), 0);
            assert_eq!(contract.reserved_rewards, 0);

            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.pending_rewards, 0);
            assert_eq!(position.claimed_rewards, claimed);
            assert_solvent(&contract);
        }

        #[ink::test]
        fn test_access_control() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Non-router tenta track volume
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.track_trading_volume(accounts.alice, 1000),
                Err(TradingRewardsError::AccessDenied)
            );

            // Non-admin tenta pausar
            assert_eq!(
                contract.pause_contract(),
                Err(TradingRewardsError::AccessDenied)
            );
        }

        #[ink::test]
        fn test_zero_address_validation() {
            let accounts = default_accounts();

            // Constructor com zero address
            let result = TradingRewardsContract::new(AccountId::from([0u8; 32]), accounts.bob);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), TradingRewardsError::ZeroAddress);

            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Track volume com zero address
            set_next_caller(accounts.bob);
            assert_eq!(
                contract.track_trading_volume(AccountId::from([0u8; 32]), 1000),
                Err(TradingRewardsError::ZeroAddress)
            );
        }

        #[ink::test]
        fn test_contract_pause() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Pausa contrato
            set_next_caller(accounts.alice);
            contract.pause_contract().unwrap();

            // Tenta track volume (deve falhar)
            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8),
                Err(TradingRewardsError::ContractPaused)
            );

            // Despausa
            set_next_caller(accounts.alice);
            contract.unpause_contract().unwrap();

            // Agora deve funcionar
            set_next_caller(accounts.bob);
            contract
                .track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8)
                .unwrap();
        }

        #[ink::test]
        fn test_anti_fraud_measures() {
            // RESET COMPLETO DO TEMPO COM SEED ÚNICA PARA ESTE TESTE
            reset_test_time_with_seed(999);

            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            set_next_caller(accounts.bob);
            advance_time(100_000); // Avança tempo inicial (ms)

            // 1. Teste volume muito pequeno
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 50 * constants::DECIMALS_8),
                Err(TradingRewardsError::VolumeTooSmall)
            );

            // 2. Primeiro trade bem sucedido
            contract
                .track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8)
                .unwrap();

            // 3. Teste cooldown (deve falhar) - agora Charlie já tem timestamp do último trade
            advance_time(30_000); // Avança apenas 30 s em ms (menos que o cooldown de 60 s)
            let result =
                contract.track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8);
            assert_eq!(result, Err(TradingRewardsError::TradeCooldownActive));

            // 4. Avança tempo suficiente e testa novamente
            advance_time(100_000); // 100 s em ms - bem mais que o cooldown de 60 s
            contract
                .track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8)
                .unwrap();

            // 5. Testa blacklist
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();

            set_next_caller(accounts.bob);
            advance_time(61_000);
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 500 * constants::DECIMALS_8),
                Err(TradingRewardsError::SuspiciousAddress)
            );

            // 6. Remove da blacklist
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            assert!(!contract.is_blacklisted(accounts.charlie));
        }

        #[ink::test]
        fn test_daily_limit() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            set_next_caller(accounts.bob);
            advance_time(1000); // Avança tempo inicial

            // Primeiro trade grande (mas dentro do limite)
            let large_volume = 800_000 * constants::DECIMALS_8; // 800k LUNES
            contract
                .track_trading_volume(accounts.charlie, large_volume)
                .unwrap();

            // Tentar outro trade que excede o limite diário
            advance_time(61_000); // Passa do cooldown (ms)
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 300_000 * constants::DECIMALS_8), // 800k + 300k = 1.1M > 1M
                Err(TradingRewardsError::DailyLimitExceeded)
            );

            // Avança um dia completo
            advance_time(24 * 60 * 60 * 1000); // 1 dia em ms

            // Agora deve funcionar
            contract
                .track_trading_volume(accounts.charlie, 2_000 * constants::DECIMALS_8)
                .unwrap();
        }

        #[ink::test]
        fn test_configurable_antifraud_parameters() {
            // RESET COMPLETO DO TEMPO COM SEED ÚNICA PARA ESTE TESTE
            reset_test_time_with_seed(888);

            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Verifica valores padrão
            let (min_vol, cooldown, max_daily) = contract.get_antifraud_parameters();
            assert_eq!(min_vol, constants::DEFAULT_MIN_TRADE_VOLUME);
            assert_eq!(cooldown, constants::DEFAULT_TRADE_COOLDOWN);
            assert_eq!(max_daily, constants::DEFAULT_MAX_DAILY_VOLUME);

            // Atualiza parâmetros (apenas admin)
            set_next_caller(accounts.alice);
            contract
                .set_min_trade_volume(200 * constants::DECIMALS_8)
                .unwrap(); // 200 LUNES
            contract.set_trade_cooldown(120_000).unwrap(); // 2 minutos (ms)
            contract
                .set_max_daily_volume(500_000 * constants::DECIMALS_8)
                .unwrap(); // 500k LUNES

            // Verifica novos valores
            let (new_min_vol, new_cooldown, new_max_daily) = contract.get_antifraud_parameters();
            assert_eq!(new_min_vol, 200 * constants::DECIMALS_8);
            assert_eq!(new_cooldown, 120_000);
            assert_eq!(new_max_daily, 500_000 * constants::DECIMALS_8);

            // Testa com novos parâmetros
            set_next_caller(accounts.bob);
            advance_time(1000);

            // Volume muito pequeno (novo mínimo)
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 100 * constants::DECIMALS_8),
                Err(TradingRewardsError::VolumeTooSmall)
            );

            // Volume ok
            contract
                .track_trading_volume(accounts.charlie, 300 * constants::DECIMALS_8)
                .unwrap();

            // Cooldown de 2 minutos (120 segundos)
            advance_time(30_000); // Avança 30 s em ms - ainda em cooldown
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 300 * constants::DECIMALS_8),
                Err(TradingRewardsError::TradeCooldownActive)
            );

            advance_time(100_000); // Avança mais 100 s em ms - total 130 s > cooldown de 120 s
            contract
                .track_trading_volume(accounts.charlie, 300 * constants::DECIMALS_8)
                .unwrap();
        }

        #[ink::test]
        fn test_epoch_system() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Verifica época inicial
            let (epoch_id, _start_time, duration, rewards) = contract.get_current_epoch_info();
            assert_eq!(epoch_id, 0);
            assert_eq!(duration, constants::DEFAULT_EPOCH_DURATION);
            assert_eq!(rewards, 0);

            // Inicia nova época (apenas admin)
            set_next_caller(accounts.alice);
            let new_epoch = contract.start_new_epoch().unwrap();
            assert_eq!(new_epoch, 1);

            // Verifica nova época
            let (epoch_id, _, _, _) = contract.get_current_epoch_info();
            assert_eq!(epoch_id, 1);

            // Define nova duração
            contract.set_epoch_duration(3_600_000).unwrap(); // 1 hora (ms)

            // Não-admin não pode iniciar época
            set_next_caller(accounts.bob);
            assert_eq!(
                contract.start_new_epoch(),
                Err(TradingRewardsError::AccessDenied)
            );

            // Testa claim de época inexistente
            assert_eq!(
                contract.claim_epoch_rewards(999),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
        }

        #[ink::test]
        fn test_admin_events() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            // Testa transferência de admin
            set_next_caller(accounts.alice);
            contract.transfer_admin(accounts.charlie).unwrap();

            // Verifica que charlie é o novo admin
            set_next_caller(accounts.charlie);
            contract.pause_contract().unwrap(); // Deve funcionar

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.pause_contract(),
                Err(TradingRewardsError::AccessDenied)
            ); // Alice não é mais admin

            // Testa mudança de router
            set_next_caller(accounts.charlie);
            contract.unpause_contract().unwrap(); // Despausa primeiro
            contract.set_authorized_router(accounts.alice).unwrap();

            // Verifica que alice é o novo router
            set_next_caller(accounts.alice);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.bob, 500 * constants::DECIMALS_8)
                .unwrap();

            set_next_caller(accounts.bob);
            assert_eq!(
                contract.track_trading_volume(accounts.alice, 500 * constants::DECIMALS_8),
                Err(TradingRewardsError::AccessDenied)
            ); // Bob não é mais router
        }

        // ========================================
        // WP-3: GUARD, CONTABILIDADE POR ÉPOCA, RESGATE, STAKING
        // ========================================

        /// A-04a: o guard é liberado em todos os caminhos (Ok e Err) e duas
        /// rodadas completas nunca encontram `ReentrancyGuardActive`.
        #[ink::test]
        fn test_guard_released_on_every_path_and_two_rounds() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            // --- caminhos Err ---
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::InsufficientBalance)
            );
            assert!(!contract.reentrancy_guard);

            fund_pool(&mut contract, 100 * L);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::NoActiveTraders)
            );
            assert!(!contract.reentrancy_guard);

            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert!(!contract.reentrancy_guard);

            set_next_caller(accounts.bob);
            advance_time(61_000);
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 1),
                Err(TradingRewardsError::VolumeTooSmall)
            );
            assert!(!contract.reentrancy_guard);

            // --- duas rodadas completas: fund -> track -> distribute -> claim ---
            for round in 0..2u32 {
                if round == 1 {
                    fund_pool(&mut contract, 100 * L);
                }
                track(&mut contract, accounts.charlie, 5_000 * L);
                distribute(&mut contract);
                let before = balance_of(accounts.charlie);
                assert_eq!(claim(&mut contract, accounts.charlie), 100 * L);
                assert_eq!(balance_of(accounts.charlie), before + 100 * L);

                set_next_caller(accounts.charlie);
                assert_eq!(
                    contract.claim_rewards(),
                    Err(TradingRewardsError::NoRewardsToClaim)
                );
                assert!(!contract.reentrancy_guard);
                assert_solvent(&contract);
            }
            assert_eq!(contract.current_epoch, 2);
            assert_eq!(contract.reserved_rewards, 0);
        }

        /// A-04b: dois traders com pesos diferentes (um em tier superior)
        /// recebem exatamente o floor da sua fração do pool.
        #[ink::test]
        fn test_end_to_end_proportional_shares() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L); // Bronze 1.0x
            track(&mut contract, accounts.django, 60_000 * L); // Gold 1.5x
            assert_eq!(
                contract.get_trader_tier(accounts.charlie),
                TradingTier::Bronze
            );
            assert_eq!(contract.get_trader_tier(accounts.django), TradingTier::Gold);

            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.django)),
                Some(90_000 * L)
            );
            assert_eq!(contract.epoch_total_weight.get(0), Some(95_000 * L));
            assert_eq!(contract.epoch_active_traders.get(0), Some(2));
            assert_weight_invariant(&contract, 0, &[accounts.charlie, accounts.django]);

            distribute(&mut contract);
            assert_eq!(contract.rewards_pool, 0);
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_eq!(contract.epoch_rewards.get(0), Some(100 * L));
            assert_eq!(contract.current_epoch, 1);
            assert_solvent(&contract);

            // floor(100e8 * 5_000e8 / 95_000e8) e floor(100e8 * 90_000e8 / 95_000e8)
            let expected_charlie: Balance = 526_315_789;
            let expected_django: Balance = 9_473_684_210;
            assert_eq!(expected_charlie, 100 * L * (5_000 * L) / (95_000 * L));
            assert_eq!(expected_django, 100 * L * (90_000 * L) / (95_000 * L));
            assert_eq!(
                contract.get_epoch_rewards(0, accounts.charlie),
                expected_charlie
            );
            assert_eq!(
                contract.get_epoch_rewards(0, accounts.django),
                expected_django
            );

            let c_before = balance_of(accounts.charlie);
            let d_before = balance_of(accounts.django);
            let paid_c = claim(&mut contract, accounts.charlie);
            assert_eq!(paid_c, expected_charlie);
            assert_eq!(balance_of(accounts.charlie), c_before + expected_charlie);
            assert_eq!(contract.reserved_rewards, 100 * L - expected_charlie);
            assert_solvent(&contract);

            let paid_d = claim(&mut contract, accounts.django);
            assert_eq!(paid_d, expected_django);
            assert_eq!(balance_of(accounts.django), d_before + expected_django);
            assert!(paid_c + paid_d <= 100 * L);
            assert_eq!(contract.reserved_rewards, 100 * L - paid_c - paid_d); // poeira = 1
            assert_eq!(contract.reserved_rewards, 1);
            assert_eq!(balance_of(contract_account()), 1);
            assert_eq!(contract.get_epoch_rewards(0, accounts.charlie), 0);
            assert_eq!(
                contract
                    .get_trading_position(accounts.django)
                    .unwrap()
                    .claimed_rewards,
                expected_django
            );
            assert_solvent(&contract);
        }

        /// Distribuir sem peso na época falha sem mudar estado.
        #[ink::test]
        fn test_distribute_without_weight_fails_without_state_change() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            let last_distribution = contract.last_distribution;
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::NoActiveTraders)
            );
            assert_eq!(contract.rewards_pool, 100 * L);
            assert_eq!(contract.current_epoch, 0);
            assert_eq!(contract.reserved_rewards, 0);
            assert_eq!(contract.total_distributed, 0);
            assert_eq!(contract.last_distribution, last_distribution);
            assert_eq!(contract.epoch_rewards.get(0), None);

            // Época 0 com peso é distribuída; época 1 sem trades falha
            track(&mut contract, accounts.charlie, 5_000 * L);
            distribute(&mut contract);
            fund_pool(&mut contract, 50 * L);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::NoActiveTraders)
            );
            assert_eq!(contract.rewards_pool, 50 * L);
            assert_eq!(contract.current_epoch, 1);
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_eq!(contract.total_distributed, 100 * L);
            assert_solvent(&contract);
        }

        /// Nenhuma fração é paga duas vezes, em qualquer ordem de mensagens.
        #[ink::test]
        fn test_no_double_pay_between_claim_paths() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);

            // claim_rewards cobre a época 0 -> claim_epoch_rewards(0) não paga
            assert_eq!(claim(&mut contract, accounts.charlie), 50 * L);
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert!(!contract.reentrancy_guard);

            // Ordem inversa: claim_epoch_rewards(0) primeiro
            let d_before = balance_of(accounts.django);
            set_next_caller(accounts.django);
            assert_eq!(contract.claim_epoch_rewards(0), Ok(50 * L));
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert!(!contract.reentrancy_guard);
            // claim_rewards só avança o cursor (Ok(0)), não paga de novo
            assert_eq!(contract.claim_rewards(), Ok(0));
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert_eq!(balance_of(accounts.django), d_before + 50 * L);
            assert_eq!(
                contract
                    .get_trading_position(accounts.django)
                    .unwrap()
                    .claimed_rewards,
                50 * L
            );
            assert_eq!(contract.reserved_rewards, 0);
            assert_solvent(&contract);
        }

        /// Peso não é "stale": volume só na época N não rende nada na N+1.
        #[ink::test]
        fn test_no_stale_weight_across_epochs() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            // Época 0: charlie e django (pesos iguais)
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);

            // Época 1: só django
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            assert_eq!(
                contract.epoch_trader_weight.get((1, accounts.charlie)),
                None
            );
            assert_eq!(contract.epoch_active_traders.get(1), Some(1));
            distribute(&mut contract);

            assert_eq!(contract.get_epoch_rewards(1, accounts.charlie), 0);
            assert_eq!(contract.get_epoch_rewards(1, accounts.django), 100 * L);

            assert_eq!(claim(&mut contract, accounts.charlie), 50 * L);
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_epoch_rewards(1),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert_eq!(claim(&mut contract, accounts.django), 150 * L);
            assert_eq!(contract.reserved_rewards, 0);
            assert_solvent(&contract);
        }

        /// Cursor: trader ocioso por mais de MAX_EPOCHS_PER_CLAIM épocas
        /// fechadas alcança reward posterior em chamadas repetidas (Ok(0)).
        #[ink::test]
        fn test_claim_cursor_progresses_over_long_idle_gap() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            let idle_epochs: u32 = constants::MAX_EPOCHS_PER_CLAIM + 8; // 40

            // Época 0: charlie e django; charlie liquida a época 0 via
            // claim_epoch_rewards (cursor dele continua em 0)
            fund_pool(&mut contract, L);
            track(&mut contract, accounts.charlie, 1_000 * L);
            track(&mut contract, accounts.django, 1_000 * L);
            distribute(&mut contract);
            set_next_caller(accounts.charlie);
            assert_eq!(contract.claim_epoch_rewards(0), Ok(L / 2));

            // Épocas 1..=40: só django
            for _ in 0..idle_epochs {
                fund_pool(&mut contract, L);
                track(&mut contract, accounts.django, 1_000 * L);
                distribute(&mut contract);
            }

            // Época 41: charlie volta
            fund_pool(&mut contract, 10 * L);
            track(&mut contract, accounts.charlie, 1_000 * L);
            track(&mut contract, accounts.django, 1_000 * L);
            let charlie_w = contract
                .epoch_trader_weight
                .get((idle_epochs + 1, accounts.charlie))
                .unwrap();
            let total_w = contract.epoch_total_weight.get(idle_epochs + 1).unwrap();
            distribute(&mut contract);
            assert_eq!(contract.current_epoch, idle_epochs + 2);
            let expected_last = 10 * L * charlie_w / total_w;
            assert!(expected_last > 0);

            let before = balance_of(accounts.charlie);
            // 1ª chamada: épocas 0..32 sem nada a pagar -> Ok(0), cursor avança
            assert_eq!(claim(&mut contract, accounts.charlie), 0);
            assert_eq!(
                contract.next_claim_epoch.get(accounts.charlie),
                Some(constants::MAX_EPOCHS_PER_CLAIM)
            );
            assert_eq!(balance_of(accounts.charlie), before);
            // 2ª chamada: alcança a época 41
            assert_eq!(claim(&mut contract, accounts.charlie), expected_last);
            assert_eq!(
                contract.next_claim_epoch.get(accounts.charlie),
                Some(idle_epochs + 2)
            );
            assert_eq!(balance_of(accounts.charlie), before + expected_last);
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::NoRewardsToClaim)
            );

            // django liquida tudo em duas chamadas (32 + 10 épocas)
            let d_first = claim(&mut contract, accounts.django);
            let d_second = claim(&mut contract, accounts.django);
            assert!(d_first > 0 && d_second > 0);
            let funded = L + Balance::from(idle_epochs) * L + 10 * L;
            let paid = L / 2 + expected_last + d_first + d_second;
            assert!(paid <= funded);
            assert_eq!(contract.reserved_rewards, funded - paid);
            assert_eq!(balance_of(contract_account()), funded - paid);
            assert_solvent(&contract);
        }

        /// rescue_native só move o excedente não contabilizado.
        #[ink::test]
        fn test_rescue_native_only_moves_unaccounted_surplus() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            distribute(&mut contract); // reservado: 100
            fund_pool(&mut contract, 10 * L); // pool: 10
                                              // 5 LUNES enviados por transferência simples (não contabilizados)
            set_balance(contract_account(), balance_of(contract_account()) + 5 * L);
            assert_eq!(balance_of(contract_account()), 115 * L);

            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.rescue_native(accounts.frank, 5 * L),
                Err(TradingRewardsError::AccessDenied)
            );

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.rescue_native(AccountId::from([0u8; 32]), 5 * L),
                Err(TradingRewardsError::ZeroAddress)
            );
            assert_eq!(
                contract.rescue_native(accounts.frank, 0),
                Err(TradingRewardsError::InsufficientBalance)
            );
            // O saldo (115) cobriria 6, mas o excedente é só 5
            assert_eq!(
                contract.rescue_native(accounts.frank, 5 * L + 1),
                Err(TradingRewardsError::InsufficientBalance)
            );
            assert_eq!(balance_of(accounts.frank), 0);

            assert_eq!(contract.rescue_native(accounts.frank, 5 * L), Ok(()));
            assert_eq!(balance_of(accounts.frank), 5 * L);
            assert_eq!(balance_of(contract_account()), 110 * L);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::NativeRescued(NativeRescued { to, amount, .. })
                    if *to == accounts.frank && *amount == 5 * L
            )));
            assert_eq!(
                contract.rescue_native(accounts.frank, 1),
                Err(TradingRewardsError::InsufficientBalance)
            );
            assert_eq!(contract.rewards_pool, 10 * L);
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_solvent(&contract);

            // Claims pendentes continuam pagando integralmente
            let before = balance_of(accounts.charlie);
            assert_eq!(claim(&mut contract, accounts.charlie), 100 * L);
            assert_eq!(balance_of(accounts.charlie), before + 100 * L);
            assert_solvent(&contract);
        }

        /// M-12: com staking configurado, 10% vai ao staking via
        /// `fund_staking_rewards` (stand-in de teste); sem staking, 100% no pool.
        #[ink::test]
        fn test_receive_fee_allocation_with_and_without_staking() {
            let accounts = default_accounts();
            test_mocks::set_staking_call_fails(false);

            // --- sem staking: 100% no pool, staking_amount 0 ---
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            set_next_caller(accounts.charlie);
            credit_contract(1_000 * L);
            assert_eq!(contract.receive_fee_allocation(), Ok(()));
            assert_eq!(contract.rewards_pool, 1_000 * L);
            assert_eq!(balance_of(contract_account()), 1_000 * L);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::RewardsPoolFunded(RewardsPoolFunded {
                    total_amount,
                    trading_amount,
                    staking_amount: 0,
                    ..
                }) if *total_amount == 1_000 * L && *trading_amount == 1_000 * L
            )));
            assert_solvent(&contract);

            // --- com staking: 90% pool, 10% staking ---
            set_next_caller(accounts.alice);
            contract.set_staking_contract(accounts.eve).unwrap();
            set_balance(accounts.eve, 0);
            set_next_caller(accounts.charlie);
            credit_contract(1_000 * L);
            assert_eq!(contract.receive_fee_allocation(), Ok(()));
            assert_eq!(contract.rewards_pool, 1_000 * L + 900 * L);
            assert_eq!(balance_of(accounts.eve), 100 * L);
            assert_eq!(balance_of(contract_account()), 1_900 * L);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::RewardsPoolFunded(RewardsPoolFunded {
                    total_amount,
                    trading_amount,
                    staking_amount,
                    ..
                }) if *total_amount == 1_000 * L
                    && *trading_amount == 900 * L
                    && *staking_amount == 100 * L
            )));
            assert_solvent(&contract);

            // --- falha do staking -> StakingFundingFailed (reverte on-chain) ---
            test_mocks::set_staking_call_fails(true);
            credit_contract(1_000 * L);
            assert_eq!(
                contract.receive_fee_allocation(),
                Err(TradingRewardsError::StakingFundingFailed)
            );
            test_mocks::set_staking_call_fails(false);
            assert_eq!(balance_of(accounts.eve), 100 * L);
        }

        /// O selector hardcoded bate com o label da mensagem do staking.
        #[ink::test]
        fn test_staking_selector_matches_label() {
            assert_eq!(
                STAKING_FUND_STAKING_REWARDS_SELECTOR,
                ink::selector_bytes!("fund_staking_rewards"),
            );
        }

        /// Só "callee retornou Ok(())" conta como sucesso (fail-closed).
        #[ink::test]
        fn test_staking_call_result_classification() {
            use scale::{Decode, Encode};
            type Out = ink::MessageResult<Result<(), u8>>;

            assert!(TradingRewardsContract::staking_call_succeeded(Ok(Ok(Ok(
                ()
            )))));
            // Err do callee (ex.: StakingError::AccessDenied = índice 4)
            assert!(!TradingRewardsContract::staking_call_succeeded(Ok(Ok(
                Err(4)
            ))));
            // LangError
            assert!(!TradingRewardsContract::staking_call_succeeded(Ok(Err(
                ink::LangError::CouldNotReadInput
            ))));
            // Erros de ambiente
            assert!(!TradingRewardsContract::staking_call_succeeded(Err(
                ink::env::Error::CalleeTrapped
            )));
            assert!(!TradingRewardsContract::staking_call_succeeded(Err(
                ink::env::Error::TransferFailed
            )));

            // Layout SCALE: Ok(Ok(())) = [0, 0]; Err do callee = [0, 1, idx]
            let ok: Out = Ok(Ok(()));
            assert_eq!(ok.encode(), vec![0u8, 0u8]);
            assert_eq!(Out::decode(&mut &[0u8, 1, 4][..]).unwrap(), Ok(Err(4)));
            // Saída vazia (ex.: staking apontando para conta sem código) não
            // decodifica -> erro de ambiente -> falha
            assert!(Out::decode(&mut &[][..]).is_err());
            assert!(Out::decode(&mut &[0u8][..]).is_err());
        }

        // ========================================
        // WP-3 R2: UNIDADES DE TEMPO (ms), ÉPOCAS, BLACKLIST, GUARD, GETTER
        // ========================================

        /// M-14: `block_timestamp()` é em ms; cooldown padrão = 60 s = 60_000 ms.
        #[ink::test]
        fn test_trade_cooldown_is_in_milliseconds() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            assert_eq!(constants::DEFAULT_TRADE_COOLDOWN, 60_000);

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 500 * L)
                .unwrap();

            advance_time(6_000); // 6 s depois: ainda em cooldown
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 500 * L),
                Err(TradingRewardsError::TradeCooldownActive)
            );
            assert!(!contract.reentrancy_guard);

            advance_time(54_000); // 60_000 ms desde o 1º trade
            contract
                .track_trading_volume(accounts.charlie, 500 * L)
                .unwrap();
        }

        /// M-14: o teto diário não zera em 90 s; zera após 1 dia em ms.
        #[ink::test]
        fn test_daily_limit_window_is_one_day_in_milliseconds() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            assert_eq!(constants::DAILY_RESET_PERIOD, 86_400_000);

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 800_000 * L)
                .unwrap();

            advance_time(90_000);
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 300_000 * L),
                Err(TradingRewardsError::DailyLimitExceeded)
            );

            // Exatamente 1 dia desde o reset: ainda não zera (regra é `>`)
            advance_time(86_400_000 - 90_000);
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 300_000 * L),
                Err(TradingRewardsError::DailyLimitExceeded)
            );

            advance_time(1);
            contract
                .track_trading_volume(accounts.charlie, 300_000 * L)
                .unwrap();
            assert_eq!(
                contract
                    .get_trading_position(accounts.charlie)
                    .unwrap()
                    .daily_volume,
                300_000 * L
            );
        }

        /// M-14: o volume mensal não zera após minutos; zera após 30 dias em ms.
        #[ink::test]
        fn test_monthly_reset_is_thirty_days_in_milliseconds() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            assert_eq!(constants::MONTHLY_RESET_PERIOD, 2_592_000_000);

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();

            advance_time(45 * 60 * 1000); // 45 min
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 12_000 * L);
            assert_eq!(position.tier, TradingTier::Silver);

            advance_time(2_592_000_000 + 1); // > 30 dias desde a âncora da janela mensal
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 6_000 * L);
            assert_eq!(position.tier, TradingTier::Bronze);
        }

        /// M-14: duração mínima de época = 1 h em ms; padrão = 7 dias em ms.
        #[ink::test]
        fn test_epoch_duration_bounds_are_in_milliseconds() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            assert_eq!(constants::DEFAULT_EPOCH_DURATION, 604_800_000);
            assert_eq!(constants::MIN_EPOCH_DURATION, 3_600_000);

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.set_epoch_duration(3_599_999),
                Err(TradingRewardsError::VolumeTooSmall)
            );
            assert_eq!(contract.get_current_epoch_info().2, 604_800_000);
            assert_eq!(contract.set_epoch_duration(3_600_000), Ok(()));
            assert_eq!(contract.get_current_epoch_info().2, 3_600_000);
        }

        /// `start_new_epoch` não fecha época com peso (não confisca); época
        /// sem peso continua avançando.
        #[ink::test]
        fn test_start_new_epoch_rejects_epoch_with_weight() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            track(&mut contract, accounts.charlie, 5_000 * L);
            let epoch_start = contract.epoch_start_time;
            advance_time(1000);

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.start_new_epoch(),
                Err(TradingRewardsError::EpochHasPendingWeight)
            );
            assert_eq!(contract.current_epoch, 0);
            assert_eq!(contract.epoch_start_time, epoch_start);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));
            assert_eq!(contract.epoch_active_traders.get(0), Some(1));

            // A época só fecha via distribute: o trader recebe 100%
            fund_pool(&mut contract, 100 * L);
            distribute(&mut contract);
            let before = balance_of(accounts.charlie);
            assert_eq!(claim(&mut contract, accounts.charlie), 100 * L);
            assert_eq!(balance_of(accounts.charlie), before + 100 * L);

            // Época 1 sem peso: start_new_epoch segue avançando
            set_next_caller(accounts.alice);
            assert_eq!(contract.start_new_epoch(), Ok(2));
            assert_eq!(contract.current_epoch, 2);
            assert_solvent(&contract);
        }

        /// Blacklist bloqueia os dois caminhos de claim sem consumir peso,
        /// cursor ou reservado; unblacklist devolve o direito.
        #[ink::test]
        fn test_blacklisted_trader_cannot_claim_until_unblacklisted() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();

            let before = balance_of(accounts.charlie);
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::SuspiciousAddress)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::SuspiciousAddress)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), Some(0));
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_eq!(balance_of(accounts.charlie), before);
            assert_eq!(contract.get_epoch_rewards(0, accounts.charlie), 50 * L);
            assert_solvent(&contract);

            // Outro trader não é afetado
            assert_eq!(claim(&mut contract, accounts.django), 50 * L);

            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            assert_eq!(claim(&mut contract, accounts.charlie), 50 * L);
            assert_eq!(balance_of(accounts.charlie), before + 50 * L);
            assert_eq!(contract.reserved_rewards, 0);
            assert_solvent(&contract);
        }

        /// O guard em memória está ativo durante a chamada externa de
        /// `receive_fee_allocation` (formato acquire -> inner -> release) e é
        /// liberado nos caminhos Ok e `StakingFundingFailed`.
        ///
        /// Isto NÃO prova proteção contra reentrada on-chain: em ink! 4.3 o
        /// struct raiz só é gravado no fim da mensagem, então um frame
        /// reentrante leria `reentrancy_guard == false` do storage. A proteção
        /// real é o pallet-contracts negar reentrada por padrão (o contrato
        /// nunca deve usar `allow_reentry(true)`).
        #[ink::test]
        fn test_receive_fee_allocation_is_guarded() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            test_mocks::set_staking_call_fails(false);
            let _ = test_mocks::take_guard_during_staking_call();

            set_next_caller(accounts.alice);
            contract.set_staking_contract(accounts.eve).unwrap();
            set_balance(accounts.eve, 0);

            set_next_caller(accounts.charlie);
            credit_contract(1_000 * L);
            assert_eq!(contract.receive_fee_allocation(), Ok(()));
            assert!(!contract.reentrancy_guard);
            assert_eq!(test_mocks::take_guard_during_staking_call(), Some(true));

            test_mocks::set_staking_call_fails(true);
            credit_contract(1_000 * L);
            assert_eq!(
                contract.receive_fee_allocation(),
                Err(TradingRewardsError::StakingFundingFailed)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(test_mocks::take_guard_during_staking_call(), Some(true));
            test_mocks::set_staking_call_fails(false);

            // Chamada seguinte funciona normalmente
            credit_contract(1_000 * L);
            assert_eq!(contract.receive_fee_allocation(), Ok(()));
            assert!(!contract.reentrancy_guard);
            assert_eq!(balance_of(accounts.eve), 200 * L);
            assert_solvent(&contract);
        }

        /// Getter de contabilidade: (pool, reservado, excedente resgatável).
        #[ink::test]
        fn test_get_reward_accounting() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            assert_eq!(contract.get_reward_accounting(), (0, 0, 0));

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            distribute(&mut contract);
            set_balance(contract_account(), balance_of(contract_account()) + 5 * L);
            assert_eq!(contract.get_reward_accounting(), (0, 100 * L, 5 * L));

            fund_pool(&mut contract, 10 * L);
            assert_eq!(contract.get_reward_accounting(), (10 * L, 100 * L, 5 * L));

            assert_eq!(claim(&mut contract, accounts.charlie), 100 * L);
            assert_eq!(contract.get_reward_accounting(), (10 * L, 0, 5 * L));

            set_next_caller(accounts.alice);
            contract.rescue_native(accounts.frank, 5 * L).unwrap();
            assert_eq!(contract.get_reward_accounting(), (10 * L, 0, 0));

            // Saldo abaixo das obrigações satura em 0
            set_balance(contract_account(), 3 * L);
            assert_eq!(contract.get_reward_accounting(), (10 * L, 0, 0));
        }

        // ========================================
        // WP-3 R3: PESO DE BLACKLIST, TIME GATE, JANELA MENSAL, COOLDOWN,
        // UNSET DO STAKING
        // ========================================

        /// R3-1: peso anulado na época aberta -> traders honestos recebem 100%;
        /// época só com peso anulado volta a poder ser fechada por
        /// `start_new_epoch`.
        #[ink::test]
        fn test_void_blacklisted_weight_open_epoch() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(5_000 * L)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                None
            );
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));
            assert_eq!(contract.epoch_active_traders.get(0), Some(1));
            assert_weight_invariant(&contract, 0, &[accounts.charlie, accounts.django]);
            assert_eq!(contract.rewards_pool, 100 * L);
            assert_eq!(contract.reserved_rewards, 0);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::BlacklistedWeightVoided(BlacklistedWeightVoided {
                    trader,
                    epoch_id: 0,
                    weight,
                    returned_to_pool: 0,
                    ..
                }) if *trader == accounts.charlie && *weight == 5_000 * L
            )));

            // Segunda chamada: Ok(0), sem mudança de estado
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 0), Ok(0));
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));
            assert_eq!(contract.epoch_active_traders.get(0), Some(1));
            assert_eq!(contract.rewards_pool, 100 * L);

            distribute(&mut contract);
            let before = balance_of(accounts.django);
            assert_eq!(claim(&mut contract, accounts.django), 100 * L);
            assert_eq!(balance_of(accounts.django), before + 100 * L);
            assert_eq!(contract.reserved_rewards, 0);
            assert_solvent(&contract);

            // Época 1 só com peso de um trader depois blacklisted: anular
            // destrava `start_new_epoch`
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            track(&mut contract, accounts.charlie, 5_000 * L);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert_eq!(
                contract.start_new_epoch(),
                Err(TradingRewardsError::EpochHasPendingWeight)
            );
            // O void da época 0 zerou a janela mensal do trader (R4-3): este
            // trade recomeça em Bronze (1.0x), sem herdar o volume anulado
            assert_eq!(
                contract.epoch_trader_weight.get((1, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 1),
                Ok(5_000 * L)
            );
            assert_eq!(contract.epoch_total_weight.get(1), Some(0));
            assert_eq!(contract.epoch_active_traders.get(1), Some(0));
            assert_eq!(contract.start_new_epoch(), Ok(2));
            assert_solvent(&contract);
        }

        /// R3-1: peso anulado em época fechada -> a fração exata sai do
        /// reservado e volta ao pool; o trader nunca mais a reivindica.
        #[ink::test]
        fn test_void_blacklisted_weight_closed_epoch_returns_share_to_pool() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            let share = contract.get_epoch_rewards(0, accounts.charlie);
            assert_eq!(share, 50 * L);
            assert_eq!(contract.get_reward_accounting(), (0, 100 * L, 0));

            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(5_000 * L)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.reserved_rewards, 100 * L - share);
            assert_eq!(contract.rewards_pool, share);
            assert_eq!(contract.get_reward_accounting(), (50 * L, 50 * L, 0));
            // Total da época fechada não muda: frações dos demais intactas
            assert_eq!(contract.epoch_total_weight.get(0), Some(10_000 * L));
            assert_eq!(contract.get_epoch_rewards(0, accounts.django), 50 * L);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                None
            );
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::BlacklistedWeightVoided(BlacklistedWeightVoided {
                    trader,
                    epoch_id: 0,
                    returned_to_pool,
                    ..
                }) if *trader == accounts.charlie && *returned_to_pool == 50 * L
            )));
            assert_solvent(&contract);

            // Idempotente: Ok(0) sem mudança de estado
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 0), Ok(0));
            assert_eq!(contract.get_reward_accounting(), (50 * L, 50 * L, 0));

            // Após unblacklist o trader não reivindica a época anulada
            contract.unblacklist_address(accounts.charlie).unwrap();
            let c_before = balance_of(accounts.charlie);
            set_next_caller(accounts.charlie);
            assert_eq!(contract.claim_rewards(), Ok(0)); // cursor 0 -> 1, nada pago
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert_eq!(contract.get_epoch_rewards(0, accounts.charlie), 0);
            assert_eq!(balance_of(accounts.charlie), c_before);

            // O trader honesto recebe sua fração; a fração anulada vai para a
            // próxima distribuição
            assert_eq!(claim(&mut contract, accounts.django), 50 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);
            assert_eq!(claim(&mut contract, accounts.django), 50 * L);
            assert_eq!(contract.get_reward_accounting(), (0, 0, 0));
            assert_solvent(&contract);
        }

        /// R3-1: só admin; só trader em blacklist; guard liberado.
        #[ink::test]
        fn test_void_blacklisted_weight_access_and_preconditions() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            track(&mut contract, accounts.charlie, 5_000 * L);

            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Err(TradingRewardsError::AccessDenied)
            );

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Err(TradingRewardsError::NotBlacklisted)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));
            assert_eq!(contract.epoch_active_traders.get(0), Some(1));

            // Blacklisted mas sem peso naquela época (época futura): Ok(0)
            contract.blacklist_address(accounts.charlie).unwrap();
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 7), Ok(0));
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));
        }

        /// R3-2: distribute só no fim da época, sem mudança de estado antes.
        #[ink::test]
        fn test_distribute_requires_epoch_end() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            let end = contract.epoch_start_time + contract.epoch_duration;
            let now = TEST_TIME.with(|t| t.get());
            advance_time(end - 1 - now); // 1 ms antes do fim
            let last_distribution = contract.last_distribution;

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.rewards_pool, 100 * L);
            assert_eq!(contract.reserved_rewards, 0);
            assert_eq!(contract.total_distributed, 0);
            assert_eq!(contract.current_epoch, 0);
            assert_eq!(contract.last_distribution, last_distribution);
            assert_eq!(contract.epoch_rewards.get(0), None);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(contract.epoch_total_weight.get(0), Some(5_000 * L));

            // Exatamente no fim da época: sucesso
            advance_time(1);
            assert_eq!(contract.distribute_rewards(), Ok(()));
            assert_eq!(contract.current_epoch, 1);
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_eq!(contract.epoch_start_time, end);

            // A nova época também precisa durar `epoch_duration`
            fund_pool(&mut contract, 10 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert_eq!(contract.rewards_pool, 10 * L);
            assert_eq!(contract.current_epoch, 1);
            assert_solvent(&contract);
        }

        /// R3-3: trades a cada 20 dias nunca acumulam além de uma janela de 30
        /// dias; o tier volta a cair.
        #[ink::test]
        fn test_monthly_window_is_anchored_for_active_trader() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            let day = constants::DAY_MS;

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();
            let anchor0 = contract
                .get_trading_position(accounts.charlie)
                .unwrap()
                .monthly_window_start;

            for i in 1..=10u64 {
                advance_time(20 * day);
                let w_before = contract
                    .epoch_trader_weight
                    .get((0, accounts.charlie))
                    .unwrap();
                contract
                    .track_trading_volume(accounts.charlie, 6_000 * L)
                    .unwrap();
                let position = contract.get_trading_position(accounts.charlie).unwrap();
                assert!(position.monthly_volume <= 12_000 * L);
                if i % 2 == 0 {
                    // 40 dias desde a âncora: janela nova
                    assert_eq!(position.monthly_volume, 6_000 * L);
                    assert_eq!(position.tier, TradingTier::Bronze);
                    assert_eq!(position.monthly_window_start, anchor0 + 20 * day * i);
                    // peso deste trade com multiplicador Bronze (1.0x)
                    let w_after = contract
                        .epoch_trader_weight
                        .get((0, accounts.charlie))
                        .unwrap();
                    assert_eq!(w_after - w_before, 6_000 * L);
                } else {
                    assert_eq!(position.monthly_volume, 12_000 * L);
                    assert_eq!(position.tier, TradingTier::Silver);
                }
            }
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.total_volume, 66_000 * L); // vitalício segue somando
            assert_eq!(position.tier, TradingTier::Bronze);
        }

        /// R3-3: fronteira da janela mensal ancorada: exatamente 30 dias desde
        /// a âncora não zera; depois disso zera mesmo com trade recente.
        #[ink::test]
        fn test_monthly_window_boundary_uses_anchor() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();

            advance_time(constants::MONTHLY_RESET_PERIOD); // exatamente 30 dias
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();
            assert_eq!(
                contract
                    .get_trading_position(accounts.charlie)
                    .unwrap()
                    .monthly_volume,
                12_000 * L
            );

            // 60 s depois (último trade recente), mas > 30 dias desde a âncora
            advance_time(60_000);
            contract
                .track_trading_volume(accounts.charlie, 6_000 * L)
                .unwrap();
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 6_000 * L);
            assert_eq!(position.tier, TradingTier::Bronze);
        }

        /// R3-4: dois trades no mesmo timestamp -> o segundo está no cooldown
        /// e não muda estado.
        #[ink::test]
        fn test_cooldown_applies_at_same_timestamp() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();

            set_next_caller(accounts.bob);
            advance_time(1000);
            contract
                .track_trading_volume(accounts.charlie, 500 * L)
                .unwrap();
            let position_before = contract.get_trading_position(accounts.charlie).unwrap();
            let weight_before = contract.epoch_trader_weight.get((0, accounts.charlie));
            let total_before = contract.epoch_total_weight.get(0);
            let active_before = contract.epoch_active_traders.get(0);

            // Sem avançar o relógio
            assert_eq!(
                contract.track_trading_volume(accounts.charlie, 500 * L),
                Err(TradingRewardsError::TradeCooldownActive)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(
                contract.get_trading_position(accounts.charlie).unwrap(),
                position_before
            );
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                weight_before
            );
            assert_eq!(contract.epoch_total_weight.get(0), total_before);
            assert_eq!(contract.epoch_active_traders.get(0), active_before);
        }

        /// R3-5: admin pode remover o staking; depois disso 100% vai ao pool.
        #[ink::test]
        fn test_clear_staking_contract() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            test_mocks::set_staking_call_fails(false);

            set_next_caller(accounts.alice);
            contract.set_staking_contract(accounts.eve).unwrap();
            set_balance(accounts.eve, 0);

            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.clear_staking_contract(),
                Err(TradingRewardsError::AccessDenied)
            );
            assert_eq!(contract.staking_contract, Some(accounts.eve));

            set_next_caller(accounts.alice);
            assert_eq!(contract.clear_staking_contract(), Ok(()));
            assert_eq!(contract.staking_contract, None);

            // Staking falharia, mas não é mais chamado
            test_mocks::set_staking_call_fails(true);
            set_next_caller(accounts.charlie);
            credit_contract(1_000 * L);
            assert_eq!(contract.receive_fee_allocation(), Ok(()));
            test_mocks::set_staking_call_fails(false);
            assert_eq!(contract.rewards_pool, 1_000 * L);
            assert_eq!(balance_of(accounts.eve), 0);
            assert_eq!(contract.get_reward_accounting(), (1_000 * L, 0, 0));
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::RewardsPoolFunded(RewardsPoolFunded {
                    total_amount,
                    trading_amount,
                    staking_amount: 0,
                    ..
                }) if *total_amount == 1_000 * L && *trading_amount == 1_000 * L
            )));
            assert_solvent(&contract);

            // Idempotente
            set_next_caller(accounts.alice);
            assert_eq!(contract.clear_staking_contract(), Ok(()));
            assert_eq!(contract.staking_contract, None);
        }

        // ========================================
        // WP-3 R4: VOID (cobertura + R4-2/3/4) E GATE DE ÉPOCA (R4-1)
        // ========================================

        fn count_voided_events() -> usize {
            decoded_events()
                .iter()
                .filter(|e| matches!(e, Event::BlacklistedWeightVoided(_)))
                .count()
        }

        /// Campos do último `BlacklistedWeightVoided`:
        /// (trader, epoch_id, weight, returned_to_pool, timestamp)
        fn last_voided_event() -> (AccountId, u32, Balance, Balance, Timestamp) {
            decoded_events()
                .into_iter()
                .rev()
                .find_map(|e| match e {
                    Event::BlacklistedWeightVoided(v) => Some((
                        v.trader,
                        v.epoch_id,
                        v.weight,
                        v.returned_to_pool,
                        v.timestamp,
                    )),
                    _ => None,
                })
                .expect("nenhum BlacklistedWeightVoided emitido")
        }

        /// T1: claim, blacklist e void da mesma época fechada -> Ok(0) sem
        /// nenhum efeito.
        #[ink::test]
        fn test_void_after_claim_is_noop() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);
            assert_eq!(claim(&mut contract, accounts.charlie), 50 * L);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            let pool = contract.rewards_pool;
            let reserved = contract.reserved_rewards;
            let distributed = contract.total_distributed;
            let balance = balance_of(contract_account());
            let events = count_voided_events();
            let position = contract.get_trading_position(accounts.charlie);
            assert!(position.is_some());

            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 0), Ok(0));
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.rewards_pool, pool);
            assert_eq!(contract.reserved_rewards, reserved);
            assert_eq!(contract.total_distributed, distributed);
            assert_eq!(balance_of(contract_account()), balance);
            assert_eq!(count_voided_events(), events);
            assert_eq!(count_voided_events(), 0);
            // R4b (G14): Ok(0) não toca a janela de tier
            assert_eq!(contract.get_trading_position(accounts.charlie), position);

            // Época futura (sem peso): também Ok(0) sem efeito
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 5), Ok(0));
            assert_eq!(contract.get_trading_position(accounts.charlie), position);
            assert_eq!(count_voided_events(), 0);
        }

        /// T2: frações não divisíveis (pool de 100 unidades, 3 pesos iguais).
        #[ink::test]
        fn test_void_with_non_divisible_shares() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100); // 100 unidades, não 100 * L
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            track(&mut contract, accounts.eve, 5_000 * L);
            distribute(&mut contract);
            assert_eq!(contract.get_epoch_rewards(0, accounts.eve), 33); // floor(100/3)

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.eve).unwrap();
            assert_eq!(
                contract.void_blacklisted_weight(accounts.eve, 0),
                Ok(5_000 * L)
            );
            assert_eq!(contract.rewards_pool, 33);
            assert_eq!(contract.reserved_rewards, 67);

            assert_eq!(claim(&mut contract, accounts.charlie), 33);
            assert_eq!(claim(&mut contract, accounts.django), 33);
            assert_eq!(contract.reserved_rewards, 1); // poeira: 100 - 3 * 33
            assert_eq!(contract.rewards_pool, 33);
            assert_solvent(&contract);
        }

        /// T3: o saldo do contrato não muda num void (aberto e fechado).
        #[ink::test]
        fn test_void_does_not_move_contract_balance() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            // Ramo aberto
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            let balance = balance_of(contract_account());
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(5_000 * L)
            );
            assert_eq!(balance_of(contract_account()), balance);
            distribute(&mut contract);

            // Ramo fechado (época 1)
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            let balance = balance_of(contract_account());
            assert!(
                contract
                    .void_blacklisted_weight(accounts.charlie, 1)
                    .unwrap()
                    > 0
            );
            assert_eq!(balance_of(contract_account()), balance);
            assert_solvent(&contract);
        }

        /// T4: void na época aberta, unblacklist e novo trade na mesma época:
        /// peso recomeça do zero em Bronze (R4-3).
        #[ink::test]
        fn test_open_void_then_retrade_restarts_at_bronze() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            track(&mut contract, accounts.charlie, 6_000 * L); // Bronze: 6_000
            track(&mut contract, accounts.charlie, 6_000 * L); // 12k mensal -> Silver: 7_200
            track(&mut contract, accounts.django, 5_000 * L);
            assert_eq!(
                contract.get_trader_tier(accounts.charlie),
                TradingTier::Silver
            );

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            // R4b (G2/G3): snapshot antes do void
            let before = contract.get_trading_position(accounts.charlie).unwrap();
            let cursor = contract.next_claim_epoch.get(accounts.charlie);
            let old_anchor = before.monthly_window_start;
            advance_time(5_000); // void num instante distinto da âncora antiga
            let now = TEST_TIME.with(|t| t.get());
            assert!(now > old_anchor);
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(13_200 * L)
            );
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 0);
            assert_eq!(position.tier, TradingTier::Bronze);
            assert_eq!(position.total_volume, 12_000 * L); // vitalício intacto
            assert_eq!(contract.epoch_active_traders.get(0), Some(1));
            // Nova âncora mensal = instante do void; demais campos intactos
            assert_eq!(position.monthly_window_start, now);
            assert_eq!(position.daily_volume, before.daily_volume);
            assert_eq!(position.last_trade_timestamp, before.last_trade_timestamp);
            assert_eq!(position.last_daily_reset, before.last_daily_reset);
            assert_eq!(position.trade_count, before.trade_count);
            let mut expected = before.clone();
            expected.monthly_volume = 0;
            expected.tier = TradingTier::Bronze;
            expected.monthly_window_start = now;
            assert_eq!(position, expected);
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), cursor);
            // G4: campos do evento no ramo aberto
            assert_eq!(
                last_voided_event(),
                (accounts.charlie, 0, 13_200 * L, 0, now)
            );

            contract.unblacklist_address(accounts.charlie).unwrap();
            track(&mut contract, accounts.charlie, 6_000 * L);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(6_000 * L) // Bronze 1.0x, recomeçando do zero
            );
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 6_000 * L);
            assert_eq!(position.tier, TradingTier::Bronze);
            assert_eq!(contract.epoch_active_traders.get(0), Some(2));
            assert_eq!(contract.epoch_total_weight.get(0), Some(11_000 * L));
            assert_weight_invariant(&contract, 0, &[accounts.charlie, accounts.django]);
        }

        /// T5: void na época aberta, distribute, unblacklist -> nada a receber.
        #[ink::test]
        fn test_open_void_then_unblacklist_claims_nothing() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            contract
                .void_blacklisted_weight(accounts.charlie, 0)
                .unwrap();
            distribute(&mut contract);

            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            let before = balance_of(accounts.charlie);
            set_next_caller(accounts.charlie);
            assert_eq!(contract.claim_rewards(), Ok(0));
            assert_eq!(
                contract.claim_epoch_rewards(0),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert_eq!(balance_of(accounts.charlie), before);
            assert_eq!(claim(&mut contract, accounts.django), 100 * L);
            assert_solvent(&contract);
        }

        /// T6 (R4-2): void de época fechada é recusado enquanto o trader tem
        /// peso na época aberta; a ordem correta é aberta -> fechadas.
        #[ink::test]
        fn test_void_closed_epoch_requires_open_epoch_voided_first() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract); // época 0 fechada (50/50)

            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();

            let pool = contract.rewards_pool;
            let reserved = contract.reserved_rewards;
            let w0 = contract.epoch_trader_weight.get((0, accounts.charlie));
            let w1 = contract.epoch_trader_weight.get((1, accounts.charlie));
            let t1 = contract.epoch_total_weight.get(1);
            // R4b (G3/G13): snapshot completo antes do Err
            let distributed = contract.total_distributed;
            let position = contract.get_trading_position(accounts.charlie);
            assert!(position.is_some());
            let cursor = contract.next_claim_epoch.get(accounts.charlie);
            let active1 = contract.epoch_active_traders.get(1);
            let events = count_voided_events();
            advance_time(5_000); // um reset prematuro gravaria outra âncora
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Err(TradingRewardsError::OpenEpochWeightPending)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.rewards_pool, pool);
            assert_eq!(contract.reserved_rewards, reserved);
            assert_eq!(contract.epoch_trader_weight.get((0, accounts.charlie)), w0);
            assert_eq!(contract.epoch_trader_weight.get((1, accounts.charlie)), w1);
            assert_eq!(contract.epoch_total_weight.get(1), t1);
            assert_eq!(contract.total_distributed, distributed);
            assert_eq!(contract.get_trading_position(accounts.charlie), position);
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), cursor);
            assert_eq!(contract.epoch_active_traders.get(1), active1);
            assert_eq!(count_voided_events(), events);

            // Ordem correta: época aberta, depois a fechada
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 1),
                Ok(w1.unwrap())
            );
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(5_000 * L)
            );
            assert_eq!(contract.rewards_pool, 50 * L);
            assert_eq!(contract.reserved_rewards, 50 * L);

            distribute(&mut contract); // época 1: só django, pool = 50 devolvido
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            let before = balance_of(accounts.charlie);
            assert_eq!(claim(&mut contract, accounts.charlie), 0);
            assert_eq!(balance_of(accounts.charlie), before);
            assert_eq!(claim(&mut contract, accounts.django), 100 * L);
            assert_eq!(contract.get_reward_accounting(), (0, 0, 0));
            assert_solvent(&contract);
        }

        /// T7: NotBlacklisted numa época fechada não muda nada.
        #[ink::test]
        fn test_void_closed_epoch_not_blacklisted_is_rejected() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Err(TradingRewardsError::NotBlacklisted)
            );
            assert!(!contract.reentrancy_guard);
            assert_eq!(contract.rewards_pool, 0);
            assert_eq!(contract.reserved_rewards, 100 * L);
            assert_eq!(contract.total_distributed, 100 * L);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(5_000 * L)
            );
            assert_eq!(count_voided_events(), 0);
        }

        /// T8: exatamente um evento por void efetivo; nenhum nos caminhos Ok(0).
        #[ink::test]
        fn test_void_event_count() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert_eq!(count_voided_events(), 0);

            assert!(
                contract
                    .void_blacklisted_weight(accounts.charlie, 0)
                    .unwrap()
                    > 0
            );
            assert_eq!(count_voided_events(), 1);
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 0), Ok(0));
            assert_eq!(count_voided_events(), 1);
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 9), Ok(0));
            assert_eq!(count_voided_events(), 1);

            distribute(&mut contract);
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);
            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert!(
                contract
                    .void_blacklisted_weight(accounts.charlie, 1)
                    .unwrap()
                    > 0
            );
            assert_eq!(count_voided_events(), 2);
            assert_eq!(contract.void_blacklisted_weight(accounts.charlie, 1), Ok(0));
            assert_eq!(count_voided_events(), 2);
        }

        /// T9 (R4-4): total_distributed sem dupla contagem; excedente de
        /// rescue intacto; void funciona com o contrato pausado.
        #[ink::test]
        fn test_void_total_distributed_surplus_and_pause() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract);
            assert_eq!(contract.total_distributed, 100 * L);
            set_balance(contract_account(), balance_of(contract_account()) + 5 * L);
            assert_eq!(contract.get_reward_accounting().2, 5 * L);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            contract.pause_contract().unwrap();
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(5_000 * L)
            );
            assert_eq!(contract.total_distributed, 50 * L);
            assert_eq!(contract.get_reward_accounting(), (50 * L, 50 * L, 5 * L));
            contract.unpause_contract().unwrap();

            assert_eq!(claim(&mut contract, accounts.django), 50 * L);
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract); // redistribui os 50 devolvidos
                                       // Total financiado = 100; nada contado duas vezes
            assert_eq!(contract.total_distributed, 100 * L);
            assert_eq!(contract.get_reward_accounting(), (0, 50 * L, 5 * L));
            assert_solvent(&contract);
        }

        /// T10: cursor sobre época anulada entre duas pagáveis: paga N-1 e N+1,
        /// nada de N, e o cursor passa das três.
        #[ink::test]
        fn test_claim_cursor_skips_voided_epoch() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            for _ in 0..3 {
                fund_pool(&mut contract, 100 * L);
                track(&mut contract, accounts.charlie, 5_000 * L);
                track(&mut contract, accounts.django, 5_000 * L);
                distribute(&mut contract);
            }
            assert_eq!(contract.current_epoch, 3);
            let e0 = contract.get_epoch_rewards(0, accounts.charlie);
            let e2 = contract.get_epoch_rewards(2, accounts.charlie);
            assert_eq!(e0, 50 * L);
            assert_eq!(e2, 50 * L);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert!(
                contract
                    .void_blacklisted_weight(accounts.charlie, 1)
                    .unwrap()
                    > 0
            );
            contract.unblacklist_address(accounts.charlie).unwrap();
            assert_eq!(contract.get_epoch_rewards(1, accounts.charlie), 0);

            let before = balance_of(accounts.charlie);
            assert_eq!(claim(&mut contract, accounts.charlie), e0 + e2);
            assert_eq!(balance_of(accounts.charlie), before + e0 + e2);
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), Some(3));
            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.claim_rewards(),
                Err(TradingRewardsError::NoRewardsToClaim)
            );
            assert_solvent(&contract);
        }

        /// T11 (R4-1): start_new_epoch fixa início e fim; o gate usa esse fim.
        #[ink::test]
        fn test_start_new_epoch_sets_epoch_end_and_gate_uses_it() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            advance_time(5_000);
            let now = TEST_TIME.with(|t| t.get());
            set_next_caller(accounts.alice);
            assert_eq!(contract.start_new_epoch(), Ok(1));
            assert_eq!(contract.epoch_start_time, now);
            assert_eq!(
                contract.epoch_end_time,
                now + constants::DEFAULT_EPOCH_DURATION
            );
            assert_eq!(contract.get_epoch_end_time(), contract.epoch_end_time);

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert_eq!(contract.rewards_pool, 100 * L);
            assert_eq!(contract.current_epoch, 1);

            let now = TEST_TIME.with(|t| t.get());
            advance_time(contract.epoch_end_time - 1 - now);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            advance_time(1); // exatamente epoch_end_time
            assert_eq!(contract.distribute_rewards(), Ok(()));
            assert_eq!(contract.current_epoch, 2);
        }

        /// T12 (R4-1): set_epoch_duration não move o fim da época aberta; só a
        /// próxima época usa a nova duração.
        #[ink::test]
        fn test_set_epoch_duration_does_not_move_open_epoch_end() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            let start0 = contract.epoch_start_time;
            let end0 = contract.epoch_end_time;
            assert_eq!(end0, start0 + constants::DEFAULT_EPOCH_DURATION);

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);

            // Encurtar para 1h não libera a distribuição antes de end0
            set_next_caller(accounts.alice);
            contract.set_epoch_duration(3_600_000).unwrap();
            assert_eq!(contract.epoch_end_time, end0);
            // R4b (G7/G12): aqui start0 + epoch_duration (fórmula antiga)
            // diverge do fim real
            assert_ne!(start0 + contract.epoch_duration, end0);
            assert_eq!(contract.get_epoch_end_time(), end0);
            let now = TEST_TIME.with(|t| t.get());
            advance_time(start0 + 2 * 3_600_000 - now); // 2h após o início
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert_eq!(contract.current_epoch, 0);
            assert_eq!(contract.rewards_pool, 100 * L);

            // Alongar para 14 dias não atrasa: distribui exatamente em end0
            let fourteen_days = 14 * constants::DAY_MS;
            contract.set_epoch_duration(fourteen_days).unwrap();
            assert_eq!(contract.epoch_end_time, end0);
            assert_ne!(start0 + contract.epoch_duration, end0);
            assert_eq!(contract.get_epoch_end_time(), end0);
            let now = TEST_TIME.with(|t| t.get());
            advance_time(end0 - now);
            assert_eq!(contract.distribute_rewards(), Ok(()));

            // A próxima época usa a nova duração
            assert_eq!(contract.epoch_start_time, end0);
            assert_eq!(contract.epoch_end_time, end0 + fourteen_days);
            assert_eq!(contract.get_epoch_end_time(), end0 + fourteen_days);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::EpochStarted(EpochStarted {
                    epoch_id: 1,
                    start_time,
                    duration,
                }) if *start_time == end0 && *duration == fourteen_days
            )));
        }

        /// T13 (R4-1): duração máxima de época = 90 dias em ms.
        #[ink::test]
        fn test_set_epoch_duration_upper_bound() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            assert_eq!(constants::MAX_EPOCH_DURATION, 7_776_000_000);

            set_next_caller(accounts.alice);
            assert_eq!(
                contract.set_epoch_duration(constants::MAX_EPOCH_DURATION + 1),
                Err(TradingRewardsError::VolumeTooSmall)
            );
            assert_eq!(
                contract.set_epoch_duration(u64::MAX),
                Err(TradingRewardsError::VolumeTooSmall)
            );
            assert_eq!(
                contract.get_current_epoch_info().2,
                constants::DEFAULT_EPOCH_DURATION
            );
            assert_eq!(
                contract.set_epoch_duration(constants::MAX_EPOCH_DURATION),
                Ok(())
            );
            assert_eq!(
                contract.get_current_epoch_info().2,
                constants::MAX_EPOCH_DURATION
            );

            set_next_caller(accounts.charlie);
            assert_eq!(
                contract.set_epoch_duration(constants::MIN_EPOCH_DURATION),
                Err(TradingRewardsError::AccessDenied)
            );
        }

        // ========================================
        // WP-3 R4b: LACUNAS DE TESTE (só testes, sem mudança de produção)
        // ========================================

        /// R4b (G1/G8/G4): void de época FECHADA também zera a janela de tier;
        /// os demais campos da posição e o cursor de claim ficam intactos, e
        /// o evento traz weight / returned_to_pool / timestamp corretos.
        #[ink::test]
        fn test_closed_void_resets_tier_window() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            // Época 0: charlie reivindica e o cursor vai para 1
            fund_pool(&mut contract, 10 * L);
            track(&mut contract, accounts.charlie, 1_000 * L);
            track(&mut contract, accounts.django, 1_000 * L);
            distribute(&mut contract);
            assert_eq!(claim(&mut contract, accounts.charlie), 5 * L);
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), Some(1));

            // Época 1: charlie chega a Silver (1k + 6k + 6k = 13k mensal)
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 6_000 * L); // 7k: Bronze 6_000
            track(&mut contract, accounts.charlie, 6_000 * L); // 13k: Silver 7_200
            track(&mut contract, accounts.django, 5_000 * L);
            assert_eq!(
                contract.get_trader_tier(accounts.charlie),
                TradingTier::Silver
            );
            distribute(&mut contract);
            let share = contract.get_epoch_rewards(1, accounts.charlie);
            assert!(share > 0);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            let before = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(before.monthly_volume, 13_000 * L);
            let pool = contract.rewards_pool;
            let reserved = contract.reserved_rewards;
            let distributed = contract.total_distributed;
            let now = TEST_TIME.with(|t| t.get());
            assert!(now > before.monthly_window_start);

            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 1),
                Ok(13_200 * L)
            );
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 0);
            assert_eq!(position.tier, TradingTier::Bronze);
            assert_eq!(position.monthly_window_start, now);
            assert_eq!(position.total_volume, 13_000 * L);
            assert_eq!(position.daily_volume, before.daily_volume);
            assert_eq!(position.last_trade_timestamp, before.last_trade_timestamp);
            assert_eq!(position.last_daily_reset, before.last_daily_reset);
            assert_eq!(position.trade_count, before.trade_count);
            let mut expected = before.clone();
            expected.monthly_volume = 0;
            expected.tier = TradingTier::Bronze;
            expected.monthly_window_start = now;
            assert_eq!(position, expected);
            assert_eq!(contract.next_claim_epoch.get(accounts.charlie), Some(1));
            assert_eq!(contract.rewards_pool, pool + share);
            assert_eq!(contract.reserved_rewards, reserved - share);
            assert_eq!(contract.total_distributed, distributed - share);
            assert_eq!(
                last_voided_event(),
                (accounts.charlie, 1, 13_200 * L, share, now)
            );

            // Ordem operacional: unblacklist só após o próximo distribute
            track(&mut contract, accounts.django, 5_000 * L);
            distribute(&mut contract); // época 2
            set_next_caller(accounts.alice);
            contract.unblacklist_address(accounts.charlie).unwrap();
            track(&mut contract, accounts.charlie, 6_000 * L);
            assert_eq!(contract.current_epoch, 3);
            assert_eq!(
                contract.epoch_trader_weight.get((3, accounts.charlie)),
                Some(6_000 * L) // Bronze 1.0x: o volume anulado não conta
            );
            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 6_000 * L);
            assert_eq!(position.tier, TradingTier::Bronze);
            assert_solvent(&contract);
        }

        /// R4b (G2): a nova âncora gravada pelo void reinicia a janela mensal
        /// (comportamental: sem ela o reset de 30 dias dispararia cedo demais).
        #[ink::test]
        fn test_void_restarts_monthly_window_anchor() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            track(&mut contract, accounts.charlie, 6_000 * L); // âncora original
            advance_time(20 * constants::DAY_MS);

            set_next_caller(accounts.alice);
            contract.blacklist_address(accounts.charlie).unwrap();
            assert_eq!(
                contract.void_blacklisted_weight(accounts.charlie, 0),
                Ok(6_000 * L)
            );
            contract.unblacklist_address(accounts.charlie).unwrap();

            // Bronze: 6_000
            track(&mut contract, accounts.charlie, 6_000 * L);
            // 35 dias após a âncora original, 15 após a do void
            advance_time(15 * constants::DAY_MS);
            track(&mut contract, accounts.charlie, 6_000 * L); // 12k: Silver 7_200

            let position = contract.get_trading_position(accounts.charlie).unwrap();
            assert_eq!(position.monthly_volume, 12_000 * L);
            assert_eq!(position.tier, TradingTier::Silver);
            assert_eq!(
                contract.epoch_trader_weight.get((0, accounts.charlie)),
                Some(13_200 * L)
            );
            assert_weight_invariant(&contract, 0, &[accounts.charlie]);
        }

        /// R4b (G5): com relógio não-zero no deploy, o fim da primeira época é
        /// deploy + DEFAULT_EPOCH_DURATION, e o gate usa esse valor.
        #[ink::test]
        fn test_constructor_epoch_end_uses_nonzero_deploy_time() {
            let accounts = default_accounts();
            advance_time(1_700_000_000_000);
            let deploy = TEST_TIME.with(|t| t.get());
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            let end = deploy + constants::DEFAULT_EPOCH_DURATION;
            assert_eq!(contract.epoch_start_time, deploy);
            assert_eq!(contract.epoch_end_time, end);
            assert_eq!(contract.get_epoch_end_time(), end);

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            let now = TEST_TIME.with(|t| t.get());
            advance_time(end - 1 - now);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert_eq!(contract.current_epoch, 0);
            advance_time(1);
            assert_eq!(contract.distribute_rewards(), Ok(()));
            assert_eq!(contract.current_epoch, 1);
        }

        /// R4b (G6/G11): start_new_epoch aplica a duração CONFIGURADA (não a
        /// padrão) ao fim da nova época, no campo, no getter, no evento e no gate.
        #[ink::test]
        fn test_start_new_epoch_uses_configured_duration() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            let one_hour = 3_600_000;

            set_next_caller(accounts.alice);
            contract.set_epoch_duration(one_hour).unwrap();
            advance_time(5_000);
            let now = TEST_TIME.with(|t| t.get());
            assert_eq!(contract.start_new_epoch(), Ok(1));
            assert_eq!(contract.epoch_start_time, now);
            assert_eq!(contract.epoch_end_time, now + one_hour);
            assert_eq!(contract.get_epoch_end_time(), now + one_hour);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::EpochStarted(EpochStarted {
                    epoch_id: 1,
                    start_time,
                    duration,
                }) if *start_time == now && *duration == one_hour
            )));

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            let t = TEST_TIME.with(|t| t.get());
            advance_time(now + one_hour - 1 - t);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            advance_time(1);
            assert_eq!(contract.distribute_rewards(), Ok(()));
            assert_eq!(contract.current_epoch, 2);
        }

        /// R4b (G10): distribute atrasado ancora o fim da próxima época no
        /// instante de abertura (agora), não no fim antigo.
        #[ink::test]
        fn test_late_distribute_anchors_next_epoch_end_on_open_time() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();

            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            let end0 = contract.epoch_end_time;
            let now = TEST_TIME.with(|t| t.get());
            advance_time(end0 + 8 * constants::DAY_MS - now); // 8 dias de atraso
            let late = TEST_TIME.with(|t| t.get());
            set_next_caller(accounts.alice);
            assert_eq!(contract.distribute_rewards(), Ok(()));

            assert_eq!(contract.current_epoch, 1);
            assert_eq!(contract.epoch_start_time, late);
            assert_eq!(
                contract.epoch_end_time,
                late + constants::DEFAULT_EPOCH_DURATION
            );
            assert_eq!(
                contract.get_epoch_end_time(),
                late + constants::DEFAULT_EPOCH_DURATION
            );
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::EpochStarted(EpochStarted {
                    epoch_id: 1,
                    start_time,
                    duration,
                }) if *start_time == late && *duration == constants::DEFAULT_EPOCH_DURATION
            )));

            // A época recém-aberta não pode ser fechada logo em seguida
            fund_pool(&mut contract, 100 * L);
            track(&mut contract, accounts.charlie, 5_000 * L);
            set_next_caller(accounts.alice);
            assert_eq!(
                contract.distribute_rewards(),
                Err(TradingRewardsError::EpochNotFinished)
            );
            assert_eq!(contract.current_epoch, 1);
            assert_eq!(contract.rewards_pool, 100 * L);
        }

        /// R4b (G16): start_new_epoch emite EpochEnded só quando há época > 0
        /// vencida, e EpochStarted com início e duração configurada.
        #[ink::test]
        fn test_start_new_epoch_emits_epoch_events() {
            let accounts = default_accounts();
            let mut contract = TradingRewardsContract::new(accounts.alice, accounts.bob).unwrap();
            use_contract_account();
            let count_ended = || {
                decoded_events()
                    .iter()
                    .filter(|e| matches!(e, Event::EpochEnded(_)))
                    .count()
            };

            set_next_caller(accounts.alice);
            advance_time(5_000);
            assert_eq!(contract.start_new_epoch(), Ok(1));
            assert_eq!(count_ended(), 0); // época 0 não é finalizada aqui

            let fourteen_days = 14 * constants::DAY_MS;
            contract.set_epoch_duration(fourteen_days).unwrap();
            // Época 1 abriu com 7 dias; 8 dias depois ela venceu
            advance_time(8 * constants::DAY_MS);
            let now = TEST_TIME.with(|t| t.get());
            assert_eq!(contract.start_new_epoch(), Ok(2));

            assert_eq!(count_ended(), 1);
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::EpochEnded(EpochEnded {
                    epoch_id: 1,
                    end_time,
                    ..
                }) if *end_time == now
            )));
            assert!(decoded_events().iter().any(|e| matches!(
                e,
                Event::EpochStarted(EpochStarted {
                    epoch_id: 2,
                    start_time,
                    duration,
                }) if *start_time == now && *duration == fourteen_days
            )));
            assert_eq!(contract.epoch_start_time, now);
            assert_eq!(contract.epoch_end_time, now + fourteen_days);
        }

        /// R4b (G17): índices SCALE dos erros são ABI; o novo erro é o último.
        #[ink::test]
        fn test_error_scale_indices() {
            use TradingRewardsError as E;
            let cases = [
                (E::AccessDenied, 0u8),
                (E::ContractPaused, 1),
                (E::ZeroAddress, 2),
                (E::NoRewardsToClaim, 3),
                (E::Overflow, 4),
                (E::InsufficientBalance, 5),
                (E::ReentrancyGuardActive, 6),
                (E::VolumeTooSmall, 7),
                (E::TradeCooldownActive, 8),
                (E::DailyLimitExceeded, 9),
                (E::SuspiciousAddress, 10),
                (E::NoActiveTraders, 11),
                (E::StakingFundingFailed, 12),
                (E::EpochHasPendingWeight, 13),
                (E::NotBlacklisted, 14),
                (E::EpochNotFinished, 15),
                (E::OpenEpochWeightPending, 16),
            ];
            for (error, index) in cases {
                assert_eq!(scale::Encode::encode(&error), vec![index]);
                assert_eq!(
                    <E as scale::Decode>::decode(&mut &[index][..]).unwrap(),
                    error
                );
            }
            // OpenEpochWeightPending é o último: 17 não decodifica
            assert!(<E as scale::Decode>::decode(&mut &[17u8][..]).is_err());
        }
    }
}
