#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)] // ink! interno gera cfg conditions que não podem ser suprimidas de outra forma
#![allow(clippy::cast_possible_truncation)]
#![warn(clippy::arithmetic_side_effects)]

// ========================================
// PSP22 CROSS-CONTRACT CALL TRAIT
// ========================================
// Trait para chamadas cross-contract aos tokens PSP22.
// Permite que o Pair Contract interaja com tokens externos.

use ink::env::call::{build_call, ExecutionInput, Selector};
use ink::env::DefaultEnvironment;

// ========================================
// PSP22 ERROR TYPE (DEFINIDO LOCALMENTE)
// ========================================
// Compatível com ink! 4.2.1 (psp22 v2.0 requer ink! 5.x)

/// Erros padrão PSP22 conforme especificação
#[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
#[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
pub enum PSP22Error {
    /// Erro personalizado com mensagem
    Custom(ink::prelude::string::String),
    /// Saldo insuficiente
    InsufficientBalance,
    /// Allowance insuficiente
    InsufficientAllowance,
    /// Endereço zero não permitido
    ZeroRecipientAddress,
    /// Endereço zero não permitido
    ZeroSenderAddress,
    /// Erro de transferência segura
    SafeTransferCheckFailed(ink::prelude::string::String),
}

/// Wrapper para chamadas cross-contract PSP22
pub struct PSP22Ref;

impl PSP22Ref {
    /// Obtém o saldo de um token PSP22 para uma conta
    ///
    /// # Parâmetros
    /// - `token`: Endereço do contrato PSP22
    /// - `account`: Conta para consultar o saldo
    ///
    /// # Retorna
    /// - `Ok(Balance)`: Saldo da conta
    /// - `Err(ink::env::Error)`: Erro na chamada
    pub fn balance_of(token: AccountId, account: AccountId) -> Result<Balance, ink::env::Error> {
        // PSP22::balance_of selector = 0x6568382f (conforme PSP22 spec)
        build_call::<DefaultEnvironment>()
            .call(token)
            .gas_limit(0) // Sem limite explícito - usa gas disponível
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("PSP22::balance_of")))
                    .push_arg(account),
            )
            .returns::<Balance>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Transfere tokens PSP22 para um destinatário
    ///
    /// # Parâmetros
    /// - `token`: Endereço do contrato PSP22
    /// - `to`: Destinatário dos tokens
    /// - `amount`: Quantidade a transferir
    ///
    /// # Retorna
    /// - `Ok(())`: Transferência bem-sucedida
    /// - `Err(ink::env::Error)`: Erro na chamada
    pub fn transfer(
        token: AccountId,
        to: AccountId,
        amount: Balance,
    ) -> Result<(), ink::env::Error> {
        // PSP22::transfer selector (conforme PSP22 spec)
        // Parâmetros: to, value, data (Vec<u8> vazio)
        let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
        build_call::<DefaultEnvironment>()
            .call(token)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("PSP22::transfer")))
                    .push_arg(to)
                    .push_arg(amount)
                    .push_arg(data),
            )
            .returns::<Result<(), PSP22Error>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Transfere tokens PSP22 de uma conta para outra (requer allowance)
    ///
    /// # Parâmetros
    /// - `token`: Endereço do contrato PSP22
    /// - `from`: Conta de origem
    /// - `to`: Conta de destino
    /// - `amount`: Quantidade a transferir
    ///
    /// # Retorna
    /// - `Ok(())`: Transferência bem-sucedida
    /// - `Err(ink::env::Error)`: Erro na chamada
    pub fn transfer_from(
        token: AccountId,
        from: AccountId,
        to: AccountId,
        amount: Balance,
    ) -> Result<(), ink::env::Error> {
        // PSP22::transfer_from selector (conforme PSP22 spec)
        let data: ink::prelude::vec::Vec<u8> = ink::prelude::vec::Vec::new();
        build_call::<DefaultEnvironment>()
            .call(token)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("PSP22::transfer_from")))
                    .push_arg(from)
                    .push_arg(to)
                    .push_arg(amount)
                    .push_arg(data),
            )
            .returns::<Result<(), PSP22Error>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }
}

/// Tipo auxiliar para AccountId
type AccountId = <DefaultEnvironment as ink::env::Environment>::AccountId;
/// Tipo auxiliar para Balance
type Balance = <DefaultEnvironment as ink::env::Environment>::Balance;

#[ink::contract]
pub mod pair_contract {
    use super::{PSP22Error, PSP22Ref};

    // ========================================
    // PAIR CONTRACT - AUTOMATED MARKET MAKER (AMM)
    // ========================================
    //
    // Este contrato implementa um par de liquidez seguindo o modelo Uniswap V2.
    //
    // ## Funcionalidades Principais:
    // - **Mint**: Criar liquidez inicial ou adicionar liquidez
    // - **Burn**: Remover liquidez e resgatar tokens subjacentes
    // - **Swap**: Trocar um token por outro usando a fórmula de produto constante
    // - **LP Tokens**: Tokens de liquidez que representam a participação no pool
    //
    // ## Segurança:
    // - Proteção contra reentrância com lock/unlock pattern
    // - Aritmética segura com overflow protection
    // - K-invariant check para prevenir manipulação de preços
    // - Minimum liquidity lock para evitar divisão por zero
    //
    // ## Fórmula AMM:
    // `k = reserve_0 * reserve_1` (produto constante)

    // ========================================
    // EVENTOS (PARA INDEXADORES E UIS)
    // ========================================

    /// Emitido quando liquidez é adicionada ao pool
    #[ink(event)]
    pub struct Mint {
        #[ink(topic)]
        pub sender: AccountId,
        /// Quantidade do token_0 adicionada
        pub amount_0: Balance,
        /// Quantidade do token_1 adicionada
        pub amount_1: Balance,
    }

    /// Emitido quando liquidez é removida do pool
    #[ink(event)]
    pub struct Burn {
        #[ink(topic)]
        pub sender: AccountId,
        #[ink(topic)]
        pub to: AccountId,
        /// Quantidade do token_0 removida
        pub amount_0: Balance,
        /// Quantidade do token_1 removida
        pub amount_1: Balance,
    }

    /// Emitido quando tokens são trocados
    #[ink(event)]
    pub struct Swap {
        #[ink(topic)]
        pub sender: AccountId,
        #[ink(topic)]
        pub to: AccountId,
        /// Token_0 enviado para o swap
        pub amount_0_in: Balance,
        /// Token_1 enviado para o swap
        pub amount_1_in: Balance,
        /// Token_0 recebido do swap
        pub amount_0_out: Balance,
        /// Token_1 recebido do swap
        pub amount_1_out: Balance,
    }

    /// Emitido quando reserves são atualizadas
    #[ink(event)]
    pub struct Sync {
        /// Nova reserve do token_0
        pub reserve_0: Balance,
        /// Nova reserve do token_1
        pub reserve_1: Balance,
    }

    /// Emitido quando LP tokens são transferidos (PSP22)
    #[ink(event)]
    pub struct Transfer {
        #[ink(topic)]
        pub from: Option<AccountId>,
        #[ink(topic)]
        pub to: Option<AccountId>,
        pub amount: Balance,
    }

    /// Emitido quando allowance é aprovado (PSP22)
    #[ink(event)]
    pub struct Approval {
        #[ink(topic)]
        pub owner: AccountId,
        #[ink(topic)]
        pub spender: AccountId,
        pub amount: Balance,
    }

    /// Emitido quando o pool é pausado (circuit breaker)
    #[ink(event)]
    pub struct PairPaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    /// Emitido quando o pool é despausado
    #[ink(event)]
    pub struct PairUnpaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    // ========================================
    // ERROS ESPECÍFICOS DO PAIR CONTRACT
    // ========================================

    /// Erros que podem ocorrer nas operações do Pair Contract
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[allow(clippy::cast_possible_truncation)]
    pub enum PairError {
        /// Liquidez insuficiente para a operação
        InsufficientLiquidity,
        /// Liquidez insuficiente para burn (quantidade muito baixa)
        InsufficientLiquidityBurned,
        /// Output amount insuficiente no swap
        InsufficientOutputAmount,
        /// Input amount insuficiente no swap
        InsufficientInputAmount,
        /// Amounts de tokens inválidos
        InvalidTokenAmounts,
        /// Acesso não autorizado
        Unauthorized,
        /// K-invariant violado (produto constante diminuiu)
        KValueDecreased,
        /// Overflow em cálculo matemático
        Overflow,
        /// Contrato travado (proteção reentrância)
        Locked,
        /// Erro no token PSP22 subjacente
        PSP22(PSP22Error),
        /// Protocolo pausado por emergência (circuit breaker)
        ProtocolPaused,
        /// Pool sem liquidez real (ghost liquidity)
        GhostLiquidity,
    }

    impl From<PSP22Error> for PairError {
        fn from(error: PSP22Error) -> Self {
            PairError::PSP22(error)
        }
    }

    // ========================================
    // CONSTANTES DO PROTOCOLO AMM
    // ========================================
    #[allow(dead_code)] // Constantes serão usadas na implementação completa de fee distribution
    mod constants {
        /// Liquidez mínima permanentemente bloqueada (previne divisão por zero)
        /// Valor de produção conforme Uniswap V2
        pub const MINIMUM_LIQUIDITY: u128 = 1000;

        /// Precisão decimal para preços cumulativos.
        /// UQ112 exige largura maior que u128 quando multiplicado por saldos reais.
        pub const PRICE_PRECISION: u128 = 1_000_000_000_000;

        /// Nova estrutura de fees (0.5% total = 995/1000)
        pub const FEE_DENOMINATOR: u128 = 1000;
        /// Fee numerator para cálculo de swap (995/1000 = 0.5% fee)
        pub const FEE_NUMERATOR: u128 = 995;

        /// Distribuição das fees (0.5% total):
        /// - 60% para LPs (0.3%)
        /// - 20% para Desenvolvimento (0.1%)
        /// - 20% para Trading Rewards (0.1%)
        pub const LP_FEE_SHARE: u128 = 600; // 60% = 0.3%
        pub const PROTOCOL_FEE_SHARE: u128 = 200; // 20% = 0.1%
        pub const REWARDS_FEE_SHARE: u128 = 200; // 20% = 0.1%
        pub const TOTAL_FEE_SHARES: u128 = 1000; // 100%
    }

    /// Storage principal do contrato otimizado para gas
    #[ink(storage)]
    pub struct PairContract {
        // Tokens do par (frequentemente acessado)
        token_0: AccountId,
        token_1: AccountId,
        factory: AccountId,

        // Reservas e timestamp (frequentemente acessado)
        reserve_0: Balance,
        reserve_1: Balance,
        block_timestamp_last: Timestamp,

        // LP token supply e balances (frequentemente acessado)
        total_supply: Balance,
        balances: ink::storage::Mapping<AccountId, Balance>,
        /// Allowances para PSP22 compliant: (owner, spender) -> amount
        allowances: ink::storage::Mapping<(AccountId, AccountId), Balance>,

        // Reentrancy protection (frequentemente acessado)
        unlocked: bool,
        /// Circuit breaker: pausa o pool em emergências
        paused: bool,
        /// Admin autorizado a pausar/despausar o pool
        admin: AccountId,

        // === CAMPOS RARAMENTE ACESSADOS (LAZY) ===

        // Preços cumulativos (apenas para oracles/analytics)
        price_0_cumulative_last: ink::storage::Lazy<u128>,
        price_1_cumulative_last: ink::storage::Lazy<u128>,

        // Invariante K (apenas para cálculos específicos)
        k_last: ink::storage::Lazy<u128>,

        // Sistema de fee distribution (configurado uma vez, lido raramente)
        protocol_fee_to: ink::storage::Lazy<Option<AccountId>>,
        trading_rewards_contract: ink::storage::Lazy<Option<AccountId>>,

        // Fees acumuladas (atualizadas periodicamente)
        accumulated_protocol_fees_0: ink::storage::Lazy<Balance>,
        accumulated_protocol_fees_1: ink::storage::Lazy<Balance>,
        accumulated_rewards_fees_0: ink::storage::Lazy<Balance>,
        accumulated_rewards_fees_1: ink::storage::Lazy<Balance>,
    }

    /// Default implementation with safe defaults e Lazy optimization
    impl Default for PairContract {
        fn default() -> Self {
            Self {
                // Campos frequentemente acessados (diretos)
                token_0: AccountId::from([0u8; 32]),
                token_1: AccountId::from([0u8; 32]),
                factory: AccountId::from([0u8; 32]),
                reserve_0: 0,
                reserve_1: 0,
                block_timestamp_last: 0,
                total_supply: 0,
                balances: ink::storage::Mapping::default(),
                allowances: ink::storage::Mapping::default(),
                unlocked: true,
                paused: false,
                admin: AccountId::from([0u8; 32]),

                // Campos raramente acessados (Lazy)
                price_0_cumulative_last: ink::storage::Lazy::new(),
                price_1_cumulative_last: ink::storage::Lazy::new(),
                k_last: ink::storage::Lazy::new(),
                protocol_fee_to: ink::storage::Lazy::new(),
                trading_rewards_contract: ink::storage::Lazy::new(),
                accumulated_protocol_fees_0: ink::storage::Lazy::new(),
                accumulated_protocol_fees_1: ink::storage::Lazy::new(),
                accumulated_rewards_fees_0: ink::storage::Lazy::new(),
                accumulated_rewards_fees_1: ink::storage::Lazy::new(),
            }
        }
    }

    impl PairContract {
        /// Constructor do contrato
        #[ink(constructor)]
        pub fn new(factory: AccountId, token_0: AccountId, token_1: AccountId) -> Self {
            let mut instance = Self::default();
            instance.factory = factory;
            instance.token_0 = token_0;
            instance.token_1 = token_1;
            instance.admin = Self::env().caller();

            // Inicializar valores Lazy
            instance.price_0_cumulative_last.set(&0);
            instance.price_1_cumulative_last.set(&0);
            instance.k_last.set(&0);
            instance.protocol_fee_to.set(&None);
            instance.trading_rewards_contract.set(&None);
            instance.accumulated_protocol_fees_0.set(&0);
            instance.accumulated_protocol_fees_1.set(&0);
            instance.accumulated_rewards_fees_0.set(&0);
            instance.accumulated_rewards_fees_1.set(&0);

            instance
        }

        // ========================================
        // FUNÇÕES INTERNAS (LÓGICA MODULARIZADA)
        // ========================================

        /// Modifier para reentrancy protection
        fn lock(&mut self) -> Result<(), PairError> {
            if !self.unlocked {
                return Err(PairError::Locked);
            }
            self.unlocked = false;
            Ok(())
        }

        fn unlock(&mut self) {
            self.unlocked = true;
        }

        /// Verifica se o pool está pausado
        fn ensure_not_paused(&self) -> Result<(), PairError> {
            if self.paused {
                return Err(PairError::ProtocolPaused);
            }
            Ok(())
        }

        /// Pausa o pool (somente admin — emergência)
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), PairError> {
            if self.env().caller() != self.admin {
                return Err(PairError::Unauthorized);
            }
            self.paused = true;
            self.env().emit_event(PairPaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Despauza o pool (somente admin)
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), PairError> {
            if self.env().caller() != self.admin {
                return Err(PairError::Unauthorized);
            }
            self.paused = false;
            self.env().emit_event(PairUnpaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Retorna true se o pool estiver pausado
        #[ink(message)]
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        /// Retorna o endereço do admin do pool
        #[ink(message)]
        pub fn admin(&self) -> AccountId {
            self.admin
        }

        /// Update reserves and cumulative prices
        fn update(&mut self, balance_0: Balance, balance_1: Balance) -> Result<(), PairError> {
            let block_timestamp = self.env().block_timestamp() / 1000;
            let time_elapsed = block_timestamp.saturating_sub(self.block_timestamp_last);

            if time_elapsed > 0 && self.reserve_0 != 0 && self.reserve_1 != 0 {
                // Overflow protection for price calculation
                let price_0 = self
                    .reserve_1
                    .checked_mul(constants::PRICE_PRECISION)
                    .and_then(|p| p.checked_div(self.reserve_0))
                    .ok_or(PairError::Overflow)?;
                let price_1 = self
                    .reserve_0
                    .checked_mul(constants::PRICE_PRECISION)
                    .and_then(|p| p.checked_div(self.reserve_1))
                    .ok_or(PairError::Overflow)?;

                let current_price_0 = self.price_0_cumulative_last.get().unwrap_or(0);
                let new_price_0 = current_price_0
                    .checked_add(
                        price_0
                            .checked_mul(time_elapsed as u128)
                            .ok_or(PairError::Overflow)?,
                    )
                    .ok_or(PairError::Overflow)?;
                self.price_0_cumulative_last.set(&new_price_0);

                let current_price_1 = self.price_1_cumulative_last.get().unwrap_or(0);
                let new_price_1 = current_price_1
                    .checked_add(
                        price_1
                            .checked_mul(time_elapsed as u128)
                            .ok_or(PairError::Overflow)?,
                    )
                    .ok_or(PairError::Overflow)?;
                self.price_1_cumulative_last.set(&new_price_1);
            }

            self.reserve_0 = balance_0;
            self.reserve_1 = balance_1;
            self.block_timestamp_last = block_timestamp;

            self.env().emit_event(Sync {
                reserve_0: balance_0,
                reserve_1: balance_1,
            });

            Ok(())
        }

        /// Calculate square root using Babylonian method
        fn sqrt(y: u128) -> u128 {
            if y > 3 {
                let mut z = y;
                let mut x = y
                    .checked_div(2)
                    .and_then(|half| half.checked_add(1))
                    .unwrap_or(1);
                while x < z {
                    z = x;
                    x = y
                        .checked_div(x)
                        .and_then(|div| div.checked_add(x))
                        .and_then(|sum| sum.checked_div(2))
                        .unwrap_or(x);
                }
                z
            } else if y != 0 {
                1
            } else {
                0
            }
        }

        // ========================================
        // FUNÇÕES PÚBLICAS (INTERFACE)
        // ========================================

        /// Get current reserves and last update timestamp
        #[ink(message)]
        pub fn get_reserves(&self) -> (Balance, Balance, Timestamp) {
            (self.reserve_0, self.reserve_1, self.block_timestamp_last)
        }

        /// Get token 0 address
        #[ink(message)]
        pub fn token_0(&self) -> AccountId {
            self.token_0
        }

        /// Get token 1 address
        #[ink(message)]
        pub fn token_1(&self) -> AccountId {
            self.token_1
        }

        /// Get factory address
        #[ink(message)]
        pub fn factory(&self) -> AccountId {
            self.factory
        }

        /// Get cumulative price for token 0
        #[ink(message)]
        pub fn price_0_cumulative_last(&self) -> u128 {
            self.price_0_cumulative_last.get().unwrap_or(0)
        }

        /// Get cumulative price for token 1
        #[ink(message)]
        pub fn price_1_cumulative_last(&self) -> u128 {
            self.price_1_cumulative_last.get().unwrap_or(0)
        }

        /// Mint LP tokens (simplified version for TDD)
        #[ink(message)]
        pub fn mint(&mut self, to: AccountId) -> Result<Balance, PairError> {
            self.ensure_not_paused()?;
            self.lock()?;

            // Use closure para garantir unlock em todos os caminhos
            let result = self.mint_internal(to);
            self.unlock();
            result
        }

        /// Implementação interna do mint com chamadas cross-contract reais
        ///
        /// # Fluxo:
        /// 1. Obtém saldos reais dos tokens no contrato
        /// 2. Calcula amounts depositados (balance - reserve)
        /// 3. Calcula liquidez a mintar usando fórmula Uniswap V2
        /// 4. Minta LP tokens para o usuário
        /// 5. Atualiza reserves
        fn mint_internal(&mut self, to: AccountId) -> Result<Balance, PairError> {
            let contract_address = self.env().account_id();

            // ========================================
            // OBTER SALDOS REAIS DOS TOKENS (CROSS-CONTRACT)
            // ========================================
            let balance_0 = PSP22Ref::balance_of(self.token_0, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;
            let balance_1 = PSP22Ref::balance_of(self.token_1, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;

            // ========================================
            // CALCULAR AMOUNTS DEPOSITADOS
            // ========================================
            let amount_0 = balance_0
                .checked_sub(self.reserve_0)
                .ok_or(PairError::InsufficientLiquidity)?;
            let amount_1 = balance_1
                .checked_sub(self.reserve_1)
                .ok_or(PairError::InsufficientLiquidity)?;

            // Validar que houve depósito
            if amount_0 == 0 && amount_1 == 0 {
                return Err(PairError::InvalidTokenAmounts);
            }

            // ========================================
            // CALCULAR LIQUIDEZ (FÓRMULA UNISWAP V2)
            // ========================================
            let total_supply = self.total_supply;
            let liquidity = if total_supply == 0 {
                // Primeiro mint: liquidity = sqrt(amount_0 * amount_1) - MINIMUM_LIQUIDITY
                let product = amount_0.checked_mul(amount_1).ok_or(PairError::Overflow)?;
                let sqrt_product = Self::sqrt(product);
                sqrt_product
                    .checked_sub(constants::MINIMUM_LIQUIDITY)
                    .ok_or(PairError::InsufficientLiquidity)?
            } else {
                // Mints subsequentes: min(amount_0 * totalSupply / reserve_0, amount_1 * totalSupply / reserve_1)
                let liquidity_0 = amount_0
                    .checked_mul(total_supply)
                    .and_then(|x| x.checked_div(self.reserve_0))
                    .ok_or(PairError::Overflow)?;
                let liquidity_1 = amount_1
                    .checked_mul(total_supply)
                    .and_then(|x| x.checked_div(self.reserve_1))
                    .ok_or(PairError::Overflow)?;

                // Usar o menor valor para garantir proporcionalidade
                if liquidity_0 < liquidity_1 {
                    liquidity_0
                } else {
                    liquidity_1
                }
            };

            if liquidity == 0 {
                return Err(PairError::InsufficientLiquidity);
            }

            // ========================================
            // MINT MINIMUM_LIQUIDITY (PRIMEIRO MINT APENAS)
            // ========================================
            if total_supply == 0 {
                // Bloquear MINIMUM_LIQUIDITY permanentemente no endereço zero
                // Isso previne ataques de divisão por zero
                self.total_supply = self
                    .total_supply
                    .checked_add(constants::MINIMUM_LIQUIDITY)
                    .ok_or(PairError::Overflow)?;
                self.balances
                    .insert(AccountId::from([0u8; 32]), &constants::MINIMUM_LIQUIDITY);
            }

            // ========================================
            // MINT LP TOKENS PARA O USUÁRIO
            // ========================================
            self.total_supply = self
                .total_supply
                .checked_add(liquidity)
                .ok_or(PairError::Overflow)?;
            let user_balance = self.balances.get(to).unwrap_or(0);
            let new_user_balance = user_balance
                .checked_add(liquidity)
                .ok_or(PairError::Overflow)?;
            self.balances.insert(to, &new_user_balance);

            // ========================================
            // ATUALIZAR RESERVES
            // ========================================
            self.update(balance_0, balance_1)?;

            // ========================================
            // EMITIR EVENTO
            // ========================================
            self.env().emit_event(Mint {
                sender: self.env().caller(),
                amount_0,
                amount_1,
            });

            Ok(liquidity)
        }

        /// Burn LP tokens para remover liquidez
        ///
        /// # Fluxo:
        /// 1. LP tokens devem ser transferidos para este contrato antes de chamar burn
        /// 2. Calcula proporção de tokens a receber
        /// 3. Queima LP tokens
        /// 4. Transfere tokens subjacentes para o destinatário
        #[ink(message)]
        pub fn burn(&mut self, to: AccountId) -> Result<(Balance, Balance), PairError> {
            self.ensure_not_paused()?;
            self.lock()?;

            let result = self.burn_internal(to);
            self.unlock();
            result
        }

        /// Implementação interna do burn com chamadas cross-contract reais
        ///
        /// # Fluxo:
        /// 1. Obtém saldos reais dos tokens no contrato
        /// 2. Obtém quantidade de LP tokens a queimar (transferidos previamente)
        /// 3. Calcula proporção de tokens a devolver
        /// 4. Queima LP tokens
        /// 5. Transfere tokens para o destinatário
        /// 6. Atualiza reserves
        fn burn_internal(&mut self, to: AccountId) -> Result<(Balance, Balance), PairError> {
            let contract_address = self.env().account_id();

            // ========================================
            // OBTER SALDOS REAIS DOS TOKENS (CROSS-CONTRACT)
            // ========================================
            let balance_0 = PSP22Ref::balance_of(self.token_0, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;
            let balance_1 = PSP22Ref::balance_of(self.token_1, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;

            // ========================================
            // OBTER LP TOKENS A QUEIMAR
            // ========================================
            // Os LP tokens devem ter sido transferidos para este contrato antes de chamar burn
            let liquidity = self.balances.get(contract_address).unwrap_or(0);
            let total_supply = self.total_supply;

            // Validação: deve haver LP tokens para queimar
            if liquidity == 0 || total_supply == 0 {
                return Err(PairError::InsufficientLiquidityBurned);
            }

            // ========================================
            // CALCULAR PROPORÇÃO DE TOKENS A DEVOLVER
            // ========================================
            // amount = liquidity * balance / totalSupply
            let amount_0 = liquidity
                .checked_mul(balance_0)
                .and_then(|x| x.checked_div(total_supply))
                .ok_or(PairError::Overflow)?;
            let amount_1 = liquidity
                .checked_mul(balance_1)
                .and_then(|x| x.checked_div(total_supply))
                .ok_or(PairError::Overflow)?;

            // Validação: amounts devem ser > 0
            if amount_0 == 0 || amount_1 == 0 {
                return Err(PairError::InsufficientLiquidityBurned);
            }

            // ========================================
            // QUEIMAR LP TOKENS
            // ========================================
            self.total_supply = self
                .total_supply
                .checked_sub(liquidity)
                .ok_or(PairError::InsufficientLiquidityBurned)?;
            self.balances.insert(contract_address, &0);

            // ========================================
            // TRANSFERIR TOKENS PARA O DESTINATÁRIO (CROSS-CONTRACT)
            // ========================================
            PSP22Ref::transfer(self.token_0, to, amount_0).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "transfer token_0 failed",
                )))
            })?;
            PSP22Ref::transfer(self.token_1, to, amount_1).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "transfer token_1 failed",
                )))
            })?;

            // ========================================
            // ATUALIZAR RESERVES
            // ========================================
            let new_balance_0 = balance_0
                .checked_sub(amount_0)
                .ok_or(PairError::InsufficientLiquidity)?;
            let new_balance_1 = balance_1
                .checked_sub(amount_1)
                .ok_or(PairError::InsufficientLiquidity)?;
            self.update(new_balance_0, new_balance_1)?;

            // ========================================
            // EMITIR EVENTO
            // ========================================
            self.env().emit_event(Burn {
                sender: self.env().caller(),
                to,
                amount_0,
                amount_1,
            });

            Ok((amount_0, amount_1))
        }

        /// Swap tokens usando a fórmula de produto constante (x * y = k)
        ///
        /// # Fluxo:
        /// 1. Tokens de entrada devem ser transferidos para o contrato antes de chamar swap
        /// 2. Valida outputs e reserves
        /// 3. Transfere tokens de saída para o destinatário
        /// 4. Verifica K-invariant (com ajuste de fee)
        /// 5. Atualiza reserves
        ///
        /// # Parâmetros
        /// - `amount_0_out`: Quantidade de token_0 a receber
        /// - `amount_1_out`: Quantidade de token_1 a receber
        /// - `to`: Destinatário dos tokens de saída
        #[ink(message)]
        pub fn swap(
            &mut self,
            amount_0_out: Balance,
            amount_1_out: Balance,
            to: AccountId,
        ) -> Result<(), PairError> {
            self.ensure_not_paused()?;
            self.lock()?;

            let result = self.swap_internal(amount_0_out, amount_1_out, to);
            self.unlock();
            result
        }

        /// Implementação interna do swap com chamadas cross-contract reais
        fn swap_internal(
            &mut self,
            amount_0_out: Balance,
            amount_1_out: Balance,
            to: AccountId,
        ) -> Result<(), PairError> {
            // ========================================
            // VALIDAÇÕES INICIAIS
            // ========================================
            // Guard: pool deve ter liquidez real antes de qualquer swap
            if self.reserve_0 == 0 || self.reserve_1 == 0 {
                return Err(PairError::GhostLiquidity);
            }

            if amount_0_out == 0 && amount_1_out == 0 {
                return Err(PairError::InsufficientOutputAmount);
            }

            if amount_0_out >= self.reserve_0 || amount_1_out >= self.reserve_1 {
                return Err(PairError::InsufficientLiquidity);
            }

            // Validar que destinatário não é um dos tokens (previne exploit)
            if to == self.token_0 || to == self.token_1 {
                return Err(PairError::Unauthorized);
            }

            let contract_address = self.env().account_id();

            // ========================================
            // TRANSFERIR TOKENS DE SAÍDA (CROSS-CONTRACT)
            // ========================================
            // Optimistic transfer: transfere antes de verificar invariant
            if amount_0_out > 0 {
                PSP22Ref::transfer(self.token_0, to, amount_0_out).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer token_0 failed",
                    )))
                })?;
            }
            if amount_1_out > 0 {
                PSP22Ref::transfer(self.token_1, to, amount_1_out).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer token_1 failed",
                    )))
                })?;
            }

            // ========================================
            // OBTER SALDOS ATUAIS (CROSS-CONTRACT)
            // ========================================
            let balance_0 = PSP22Ref::balance_of(self.token_0, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;
            let balance_1 = PSP22Ref::balance_of(self.token_1, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;

            // ========================================
            // CALCULAR AMOUNTS DE ENTRADA
            // ========================================
            // amount_in = balance - (reserve - amount_out)
            let amount_0_in = if balance_0 > self.reserve_0.saturating_sub(amount_0_out) {
                balance_0.saturating_sub(self.reserve_0.saturating_sub(amount_0_out))
            } else {
                0
            };
            let amount_1_in = if balance_1 > self.reserve_1.saturating_sub(amount_1_out) {
                balance_1.saturating_sub(self.reserve_1.saturating_sub(amount_1_out))
            } else {
                0
            };

            // Validar que há input
            if amount_0_in == 0 && amount_1_in == 0 {
                return Err(PairError::InsufficientInputAmount);
            }

            // ========================================
            // VERIFICAR K-INVARIANT COM FEE (0.5%)
            // ========================================
            // Fórmula: (balance_0 * 1000 - amount_0_in * 5) * (balance_1 * 1000 - amount_1_in * 5) >= reserve_0 * reserve_1 * 1000^2
            // Usando FEE_NUMERATOR (995) para 0.5% fee
            let balance_0_adjusted = balance_0
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(PairError::Overflow)?
                .checked_sub(
                    amount_0_in
                        .checked_mul(constants::FEE_DENOMINATOR - constants::FEE_NUMERATOR)
                        .ok_or(PairError::Overflow)?,
                )
                .ok_or(PairError::Overflow)?;
            let balance_1_adjusted = balance_1
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(PairError::Overflow)?
                .checked_sub(
                    amount_1_in
                        .checked_mul(constants::FEE_DENOMINATOR - constants::FEE_NUMERATOR)
                        .ok_or(PairError::Overflow)?,
                )
                .ok_or(PairError::Overflow)?;

            let k_new = balance_0_adjusted
                .checked_mul(balance_1_adjusted)
                .ok_or(PairError::Overflow)?;

            let k_old = self
                .reserve_0
                .checked_mul(self.reserve_1)
                .ok_or(PairError::Overflow)?
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(PairError::Overflow)?
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(PairError::Overflow)?;

            // K-invariant: k_new >= k_old (com fees, k pode aumentar)
            if k_new < k_old {
                return Err(PairError::KValueDecreased);
            }

            // ========================================
            // ACUMULAR FEES PARA DISTRIBUIÇÃO
            // ========================================
            // Fee total: 0.5% (5/1000)
            // - 60% para LPs (fica no pool automaticamente)
            // - 40% para Protocol + Rewards (0.2% total)
            //
            // fee_for_distribution = amount_in * 0.5% * 40% = amount_in * 0.2%
            // fee_for_distribution = amount_in * 2 / 1000
            // Use ok_or instead of unwrap_or(0) so that overflow is surfaced as an
            // error rather than silently zeroing the fee (which would let large swaps
            // pay no protocol fee).
            let fee_0_for_distribution = amount_0_in
                .checked_mul(2)
                .ok_or(PairError::Overflow)?
                .checked_div(1000)
                .ok_or(PairError::Overflow)?;
            let fee_1_for_distribution = amount_1_in
                .checked_mul(2)
                .ok_or(PairError::Overflow)?
                .checked_div(1000)
                .ok_or(PairError::Overflow)?;

            // Acumular fees se houver destino configurado
            if fee_0_for_distribution > 0 || fee_1_for_distribution > 0 {
                self.accumulate_fees(fee_0_for_distribution, fee_1_for_distribution);
            }

            // ========================================
            // ATUALIZAR RESERVES
            // ========================================
            self.update(balance_0, balance_1)?;

            // ========================================
            // EMITIR EVENTO
            // ========================================
            self.env().emit_event(Swap {
                sender: self.env().caller(),
                to,
                amount_0_in,
                amount_1_in,
                amount_0_out,
                amount_1_out,
            });

            Ok(())
        }

        /// Sincroniza reserves com os saldos reais dos tokens
        ///
        /// # Uso:
        /// Força a sincronização das reserves com os saldos reais dos tokens.
        /// Útil em caso de doações diretas ao contrato ou inconsistências.
        #[ink(message)]
        pub fn sync(&mut self) -> Result<(), PairError> {
            // Reentrancy guard: prevent a malicious token callback from calling
            // sync() mid-swap, which would corrupt the reserves used for the
            // K-invariant check and could cause legitimate swaps to revert.
            self.lock()?;
            let contract_address = self.env().account_id();

            // Obter saldos reais dos tokens (cross-contract)
            let balance_0 = PSP22Ref::balance_of(self.token_0, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;
            let balance_1 = PSP22Ref::balance_of(self.token_1, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;

            let result = self.update(balance_0, balance_1);
            self.unlock();
            result
        }

        /// Força saída de tokens em caso de emergência (apenas factory pode chamar)
        ///
        /// # Segurança:
        /// - Esta função permite recuperar tokens enviados incorretamente ao contrato.
        /// - Apenas o factory (admin) pode chamar para prevenir abusos.
        /// - Validação de zero address para prevenir perda de tokens.
        #[ink(message)]
        pub fn skim(&mut self, to: AccountId) -> Result<(), PairError> {
            // Apenas factory pode chamar
            if self.env().caller() != self.factory {
                return Err(PairError::Unauthorized);
            }

            // SEGURANÇA: Validar que destinatário não é zero address
            if to == AccountId::from([0u8; 32]) {
                return Err(PairError::Unauthorized);
            }

            let contract_address = self.env().account_id();

            // Obter saldos reais
            let balance_0 = PSP22Ref::balance_of(self.token_0, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;
            let balance_1 = PSP22Ref::balance_of(self.token_1, contract_address).map_err(|_| {
                PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                    "balance_of failed",
                )))
            })?;

            // Calcular excesso (balance - reserve)
            let excess_0 = balance_0.saturating_sub(self.reserve_0);
            let excess_1 = balance_1.saturating_sub(self.reserve_1);

            // Transferir excesso para destinatário
            if excess_0 > 0 {
                PSP22Ref::transfer(self.token_0, to, excess_0).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }
            if excess_1 > 0 {
                PSP22Ref::transfer(self.token_1, to, excess_1).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }

            Ok(())
        }

        // ========================================
        // FUNÇÕES PSP22 PARA LP TOKENS
        // ========================================

        /// Retorna o total supply de LP tokens
        #[ink(message)]
        pub fn total_supply(&self) -> Balance {
            self.total_supply
        }

        /// Retorna o saldo de LP tokens de uma conta (selector PSP22::balance_of)
        #[ink(message, selector = 0x6568382f)]
        pub fn balance_of(&self, owner: AccountId) -> Balance {
            self.balances.get(owner).unwrap_or(0)
        }

        /// Transfere LP tokens para outra conta (selector PSP22::transfer)
        #[ink(message, selector = 0xdb20f9f5)]
        pub fn transfer(
            &mut self,
            to: AccountId,
            amount: Balance,
            _data: ink::prelude::vec::Vec<u8>,
        ) -> Result<(), PairError> {
            let caller = self.env().caller();
            self.transfer_internal(caller, to, amount)
        }

        /// Aprova um spender para gastar LP tokens em nome do owner (PSP22, selector PSP22::approve)
        #[ink(message, selector = 0xb20f1bbd)]
        pub fn approve(&mut self, spender: AccountId, amount: Balance) -> Result<(), PairError> {
            let caller = self.env().caller();

            // Validar que spender não é zero address
            if spender == AccountId::from([0u8; 32]) {
                return Err(PairError::Unauthorized);
            }

            self.allowances.insert((caller, spender), &amount);

            // Emitir evento de Approval
            self.env().emit_event(Approval {
                owner: caller,
                spender,
                amount,
            });

            Ok(())
        }

        /// Retorna o allowance que owner deu para spender (PSP22, selector PSP22::allowance)
        #[ink(message, selector = 0x4d47d921)]
        pub fn allowance(&self, owner: AccountId, spender: AccountId) -> Balance {
            self.allowances.get((owner, spender)).unwrap_or(0)
        }

        /// Transfere LP tokens de uma conta para outra usando allowance (PSP22, selector PSP22::transfer_from)
        #[ink(message, selector = 0x54b3c76e)]
        pub fn transfer_from(
            &mut self,
            from: AccountId,
            to: AccountId,
            amount: Balance,
            _data: ink::prelude::vec::Vec<u8>,
        ) -> Result<(), PairError> {
            let caller = self.env().caller();

            // Verificar allowance
            let current_allowance = self.allowances.get((from, caller)).unwrap_or(0);
            if current_allowance < amount {
                return Err(PairError::InsufficientLiquidity);
            }

            self.transfer_internal(from, to, amount)?;

            let new_allowance = current_allowance
                .checked_sub(amount)
                .ok_or(PairError::Overflow)?;
            self.allowances.insert((from, caller), &new_allowance);

            Ok(())
        }

        /// Aumenta o allowance de um spender (helper function)
        #[ink(message)]
        pub fn increase_allowance(
            &mut self,
            spender: AccountId,
            delta: Balance,
        ) -> Result<(), PairError> {
            let caller = self.env().caller();
            let current = self.allowances.get((caller, spender)).unwrap_or(0);
            let new_allowance = current.checked_add(delta).ok_or(PairError::Overflow)?;
            self.allowances.insert((caller, spender), &new_allowance);

            self.env().emit_event(Approval {
                owner: caller,
                spender,
                amount: new_allowance,
            });

            Ok(())
        }

        /// Diminui o allowance de um spender (helper function)
        #[ink(message)]
        pub fn decrease_allowance(
            &mut self,
            spender: AccountId,
            delta: Balance,
        ) -> Result<(), PairError> {
            let caller = self.env().caller();
            let current = self.allowances.get((caller, spender)).unwrap_or(0);
            let new_allowance = current.checked_sub(delta).ok_or(PairError::Overflow)?;
            self.allowances.insert((caller, spender), &new_allowance);

            self.env().emit_event(Approval {
                owner: caller,
                spender,
                amount: new_allowance,
            });

            Ok(())
        }

        /// Função interna de transferência
        fn transfer_internal(
            &mut self,
            from: AccountId,
            to: AccountId,
            amount: Balance,
        ) -> Result<(), PairError> {
            // Validar que to não é zero address
            if to == AccountId::from([0u8; 32]) {
                return Err(PairError::Unauthorized);
            }

            let from_balance = self.balances.get(from).unwrap_or(0);
            if from_balance < amount {
                return Err(PairError::InsufficientLiquidity);
            }

            let new_from_balance = from_balance
                .checked_sub(amount)
                .ok_or(PairError::Overflow)?;
            let to_balance = self.balances.get(to).unwrap_or(0);
            let new_to_balance = to_balance.checked_add(amount).ok_or(PairError::Overflow)?;

            self.balances.insert(from, &new_from_balance);
            self.balances.insert(to, &new_to_balance);

            // Emitir evento de Transfer
            self.env().emit_event(Transfer {
                from: Some(from),
                to: Some(to),
                amount,
            });

            Ok(())
        }

        // ========================================
        // CONFIGURAÇÃO DE FEES (ADMIN)
        // ========================================
        // Estas funções só podem ser chamadas pelo factory (admin)

        /// Define o endereço que recebe as protocol fees
        /// Só pode ser chamado pelo factory
        #[ink(message)]
        pub fn set_protocol_fee_to(&mut self, fee_to: AccountId) -> Result<(), PairError> {
            if self.env().caller() != self.factory {
                return Err(PairError::Unauthorized);
            }
            self.protocol_fee_to.set(&Some(fee_to));
            Ok(())
        }

        /// Define o contrato de trading rewards
        /// Só pode ser chamado pelo factory
        #[ink(message)]
        pub fn set_trading_rewards_contract(
            &mut self,
            rewards_contract: AccountId,
        ) -> Result<(), PairError> {
            if self.env().caller() != self.factory {
                return Err(PairError::Unauthorized);
            }
            self.trading_rewards_contract.set(&Some(rewards_contract));
            Ok(())
        }

        /// Retorna o endereço configurado para protocol fees
        #[ink(message)]
        pub fn get_protocol_fee_to(&self) -> Option<AccountId> {
            self.protocol_fee_to.get().unwrap_or(None)
        }

        /// Retorna o contrato de trading rewards
        #[ink(message)]
        pub fn get_trading_rewards_contract(&self) -> Option<AccountId> {
            self.trading_rewards_contract.get().unwrap_or(None)
        }

        // ========================================
        // DISTRIBUIÇÃO DE FEES
        // ========================================
        // Sistema de fees: 0.5% total
        // - 60% para LPs (0.30%)
        // - 20% para Protocol (0.10%)
        // - 20% para Trading Rewards (0.10%)

        /// Retorna as fees acumuladas para o protocolo
        #[ink(message)]
        pub fn get_accumulated_protocol_fees(&self) -> (Balance, Balance) {
            (
                self.accumulated_protocol_fees_0.get().unwrap_or(0),
                self.accumulated_protocol_fees_1.get().unwrap_or(0),
            )
        }

        /// Retorna as fees acumuladas para trading rewards
        #[ink(message)]
        pub fn get_accumulated_rewards_fees(&self) -> (Balance, Balance) {
            (
                self.accumulated_rewards_fees_0.get().unwrap_or(0),
                self.accumulated_rewards_fees_1.get().unwrap_or(0),
            )
        }

        /// Coleta e distribui protocol fees para o endereço configurado
        /// Apenas o factory ou o próprio protocol_fee_to pode acionar a coleta.
        #[ink(message)]
        pub fn collect_protocol_fees(&mut self) -> Result<(Balance, Balance), PairError> {
            let fee_to = self
                .protocol_fee_to
                .get()
                .unwrap_or(None)
                .ok_or(PairError::Unauthorized)?;

            // Only factory or the designated fee recipient may trigger collection.
            // Unrestricted access could allow griefing or reentrancy via a malicious
            // fee_to contract being invoked at an unexpected time.
            let caller = self.env().caller();
            if caller != self.factory && caller != fee_to {
                return Err(PairError::Unauthorized);
            }

            let fees_0 = self.accumulated_protocol_fees_0.get().unwrap_or(0);
            let fees_1 = self.accumulated_protocol_fees_1.get().unwrap_or(0);

            if fees_0 == 0 && fees_1 == 0 {
                return Ok((0, 0));
            }

            // Resetar fees acumuladas
            self.accumulated_protocol_fees_0.set(&0);
            self.accumulated_protocol_fees_1.set(&0);

            // Transferir fees
            if fees_0 > 0 {
                PSP22Ref::transfer(self.token_0, fee_to, fees_0).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }
            if fees_1 > 0 {
                PSP22Ref::transfer(self.token_1, fee_to, fees_1).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }

            Ok((fees_0, fees_1))
        }

        /// Coleta e distribui trading rewards fees para o contrato de rewards
        /// Apenas o factory ou o próprio rewards contract pode acionar a coleta.
        #[ink(message)]
        pub fn collect_rewards_fees(&mut self) -> Result<(Balance, Balance), PairError> {
            let rewards_contract = self
                .trading_rewards_contract
                .get()
                .unwrap_or(None)
                .ok_or(PairError::Unauthorized)?;

            let caller = self.env().caller();
            if caller != self.factory && caller != rewards_contract {
                return Err(PairError::Unauthorized);
            }

            let fees_0 = self.accumulated_rewards_fees_0.get().unwrap_or(0);
            let fees_1 = self.accumulated_rewards_fees_1.get().unwrap_or(0);

            if fees_0 == 0 && fees_1 == 0 {
                return Ok((0, 0));
            }

            // Resetar fees acumuladas
            self.accumulated_rewards_fees_0.set(&0);
            self.accumulated_rewards_fees_1.set(&0);

            // Transferir fees
            if fees_0 > 0 {
                PSP22Ref::transfer(self.token_0, rewards_contract, fees_0).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }
            if fees_1 > 0 {
                PSP22Ref::transfer(self.token_1, rewards_contract, fees_1).map_err(|_| {
                    PairError::PSP22(PSP22Error::Custom(ink::prelude::string::String::from(
                        "transfer failed",
                    )))
                })?;
            }

            Ok((fees_0, fees_1))
        }

        /// Função interna para acumular fees durante o swap
        /// Chamada internamente pela função swap
        fn accumulate_fees(&mut self, fee_amount_0: Balance, fee_amount_1: Balance) {
            // Distribuição: 60% LP (já fica no pool), 20% Protocol, 20% Rewards
            // fee_amount é os 40% que não vão para LPs (0.20% do swap)
            // Dividir igualmente entre Protocol e Rewards

            let protocol_fee_0 = fee_amount_0 / 2;
            let protocol_fee_1 = fee_amount_1 / 2;
            let rewards_fee_0 = fee_amount_0.saturating_sub(protocol_fee_0);
            let rewards_fee_1 = fee_amount_1.saturating_sub(protocol_fee_1);

            // Acumular protocol fees
            if protocol_fee_0 > 0 {
                let current = self.accumulated_protocol_fees_0.get().unwrap_or(0);
                self.accumulated_protocol_fees_0
                    .set(&current.saturating_add(protocol_fee_0));
            }
            if protocol_fee_1 > 0 {
                let current = self.accumulated_protocol_fees_1.get().unwrap_or(0);
                self.accumulated_protocol_fees_1
                    .set(&current.saturating_add(protocol_fee_1));
            }

            // Acumular rewards fees
            if rewards_fee_0 > 0 {
                let current = self.accumulated_rewards_fees_0.get().unwrap_or(0);
                self.accumulated_rewards_fees_0
                    .set(&current.saturating_add(rewards_fee_0));
            }
            if rewards_fee_1 > 0 {
                let current = self.accumulated_rewards_fees_1.get().unwrap_or(0);
                self.accumulated_rewards_fees_1
                    .set(&current.saturating_add(rewards_fee_1));
            }
        }
    }

    // ========================================
    // TESTES UNITÁRIOS
    // ========================================
    //
    // NOTA: Testes que dependem de chamadas cross-contract (PSP22Ref)
    // não podem ser executados em ambiente off-chain.
    // Esses testes devem ser realizados via testes de integração on-chain.
    //
    // Os testes abaixo focam em:
    // - Inicialização do contrato
    // - Validações de entrada
    // - Proteção contra reentrância
    // - Funções de LP token que não dependem de cross-contract
    // - Controle de acesso
    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::test;

        fn default_accounts() -> test::DefaultAccounts<ink::env::DefaultEnvironment> {
            test::default_accounts::<ink::env::DefaultEnvironment>()
        }

        fn set_sender(sender: AccountId) {
            test::set_caller::<ink::env::DefaultEnvironment>(sender);
        }

        fn set_timestamp(timestamp: Timestamp) {
            test::set_block_timestamp::<ink::env::DefaultEnvironment>(timestamp);
        }

        // ========================================
        // TESTES DE INICIALIZAÇÃO
        // ========================================

        #[ink::test]
        fn test_new_pair_initializes_correctly() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let factory = accounts.bob;
            let token_0 = accounts.charlie;
            let token_1 = accounts.django;

            let pair = PairContract::new(factory, token_0, token_1);

            assert_eq!(pair.factory(), factory);
            assert_eq!(pair.token_0(), token_0);
            assert_eq!(pair.token_1(), token_1);
            assert_eq!(pair.get_reserves(), (0, 0, 0));
            assert_eq!(pair.total_supply(), 0);
        }

        #[ink::test]
        fn test_initial_cumulative_prices_are_zero() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            assert_eq!(pair.price_0_cumulative_last(), 0);
            assert_eq!(pair.price_1_cumulative_last(), 0);
        }

        #[ink::test]
        fn test_twap_update_uses_seconds_for_substrate_millisecond_timestamps() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            set_timestamp(1_777_296_714_006);
            assert_eq!(pair.update(5_000_000_000, 2_500_000_000), Ok(()));
            assert_eq!(
                pair.get_reserves(),
                (5_000_000_000, 2_500_000_000, 1_777_296_714)
            );

            set_timestamp(1_777_296_834_006);
            assert_eq!(pair.update(5_100_000_000, 2_451_225_491), Ok(()));
            assert!(pair.price_0_cumulative_last() > 0);
            assert!(pair.price_1_cumulative_last() > 0);
        }

        #[ink::test]
        fn test_failed_twap_update_does_not_partially_write_cumulative_price() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);
            pair.reserve_0 = u128::MAX / constants::PRICE_PRECISION;
            pair.reserve_1 = 1;
            pair.block_timestamp_last = 0;

            set_timestamp(2_000);
            assert_eq!(pair.update(1, 1), Err(PairError::Overflow));
            assert_eq!(pair.price_0_cumulative_last(), 0);
            assert_eq!(pair.price_1_cumulative_last(), 0);
            assert_eq!(
                pair.get_reserves(),
                (u128::MAX / constants::PRICE_PRECISION, 1, 0)
            );
        }

        // ========================================
        // TESTES DE VALIDAÇÃO DE ENTRADA
        // ========================================

        #[ink::test]
        fn test_swap_with_zero_amounts_fails() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            let result = pair.swap(0, 0, accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::GhostLiquidity);
        }

        #[ink::test]
        fn test_swap_exceeds_reserves_fails() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Pair starts with 0 reserves
            assert_eq!(pair.get_reserves(), (0, 0, 0));

            // Swap que excede reserves (0) deve falhar
            let result = pair.swap(1, 0, accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::GhostLiquidity);

            let result = pair.swap(0, 1, accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::GhostLiquidity);
        }

        // ========================================
        // TESTES DE PROTEÇÃO CONTRA REENTRÂNCIA
        // ========================================

        #[ink::test]
        fn test_reentrancy_protection() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Lock manual
            assert!(pair.lock().is_ok());

            // Tentar lock novamente deve falhar
            let result = pair.lock();
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Locked);

            // Unlock deve permitir lock novamente
            pair.unlock();
            assert!(pair.lock().is_ok());
            pair.unlock();
        }

        #[ink::test]
        fn test_mint_fails_when_locked() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Lock manual
            assert!(pair.lock().is_ok());

            // Mint quando locked deve falhar
            let result = pair.mint(accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Locked);

            pair.unlock();
        }

        #[ink::test]
        fn test_burn_fails_when_locked() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Lock manual
            assert!(pair.lock().is_ok());

            // Burn quando locked deve falhar
            let result = pair.burn(accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Locked);

            pair.unlock();
        }

        // ========================================
        // TESTES DE LP TOKEN (SEM CROSS-CONTRACT)
        // ========================================

        #[ink::test]
        fn test_lp_token_balance_of() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Saldo inicial deve ser 0
            assert_eq!(pair.balance_of(accounts.alice), 0);
            assert_eq!(pair.balance_of(accounts.bob), 0);
        }

        #[ink::test]
        fn test_lp_token_transfer() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Manualmente definir saldo para teste
            pair.balances.insert(accounts.alice, &1000);
            pair.total_supply = 1000;

            // Transferir LP tokens
            let result = pair.transfer(accounts.bob, 400, ink::prelude::vec::Vec::new());
            assert!(result.is_ok());

            // Verificar saldos
            assert_eq!(pair.balance_of(accounts.alice), 600);
            assert_eq!(pair.balance_of(accounts.bob), 400);
        }

        #[ink::test]
        fn test_lp_token_transfer_insufficient_balance() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Saldo de Alice é 0
            let result = pair.transfer(accounts.bob, 100, ink::prelude::vec::Vec::new());
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::InsufficientLiquidity);
        }

        #[ink::test]
        fn test_failed_transfer_from_does_not_consume_allowance() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);
            pair.approve(accounts.bob, 100).unwrap();

            set_sender(accounts.bob);
            let result = pair.transfer_from(
                accounts.alice,
                accounts.django,
                50,
                ink::prelude::vec::Vec::new(),
            );

            assert_eq!(result, Err(PairError::InsufficientLiquidity));
            assert_eq!(pair.allowance(accounts.alice, accounts.bob), 100);
        }

        // ========================================
        // TESTES DE CONTROLE DE ACESSO
        // ========================================

        #[ink::test]
        fn test_skim_only_factory_can_call() {
            let accounts = default_accounts();

            // Alice não é factory
            set_sender(accounts.alice);
            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Alice tenta chamar skim - deve falhar
            let result = pair.skim(accounts.alice);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Unauthorized);
        }

        #[ink::test]
        fn test_swap_to_token_address_fails() {
            let accounts = default_accounts();
            set_sender(accounts.alice);

            let mut pair = PairContract::new(accounts.bob, accounts.charlie, accounts.django);

            // Manualmente definir reserves para teste
            pair.reserve_0 = 1000;
            pair.reserve_1 = 1000;

            // Swap para endereço do token deve falhar
            let result = pair.swap(100, 0, accounts.charlie); // charlie é token_0
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Unauthorized);

            let result = pair.swap(0, 100, accounts.django); // django é token_1
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), PairError::Unauthorized);
        }

        // ========================================
        // TESTES DE FUNÇÕES MATEMÁTICAS
        // ========================================

        #[ink::test]
        fn test_sqrt_function() {
            // Testar função sqrt interna
            assert_eq!(PairContract::sqrt(0), 0);
            assert_eq!(PairContract::sqrt(1), 1);
            assert_eq!(PairContract::sqrt(4), 2);
            assert_eq!(PairContract::sqrt(9), 3);
            assert_eq!(PairContract::sqrt(16), 4);
            assert_eq!(PairContract::sqrt(100), 10);
            assert_eq!(PairContract::sqrt(1000000), 1000);

            // Testar com números não-quadrados perfeitos (retorna floor)
            assert_eq!(PairContract::sqrt(2), 1);
            assert_eq!(PairContract::sqrt(5), 2);
            assert_eq!(PairContract::sqrt(10), 3);
        }

        #[ink::test]
        fn test_sqrt_large_numbers() {
            // Testar com números grandes (importante para AMM)
            let large_value: u128 = 1_000_000_000_000_000_000; // 10^18
            let sqrt_large = PairContract::sqrt(large_value);
            assert_eq!(sqrt_large, 1_000_000_000); // 10^9

            // Testar produto típico de AMM
            let amount_0: u128 = 1_000_000_000_000; // 10^12
            let amount_1: u128 = 1_000_000_000_000; // 10^12
            let product = amount_0.checked_mul(amount_1).unwrap();
            let sqrt_product = PairContract::sqrt(product);
            assert_eq!(sqrt_product, 1_000_000_000_000); // 10^12
        }

        // ========================================
        // TESTES DE CONSTANTES
        // ========================================

        #[ink::test]
        fn test_constants() {
            // Verificar constantes do protocolo (produção)
            assert_eq!(constants::MINIMUM_LIQUIDITY, 1000);
            assert_eq!(constants::FEE_DENOMINATOR, 1000);
            assert_eq!(constants::FEE_NUMERATOR, 995); // 0.5% fee

            // Verificar distribuição de fees
            assert_eq!(constants::LP_FEE_SHARE, 600); // 60%
            assert_eq!(constants::PROTOCOL_FEE_SHARE, 200); // 20%
            assert_eq!(constants::REWARDS_FEE_SHARE, 200); // 20%
            assert_eq!(
                constants::LP_FEE_SHARE
                    + constants::PROTOCOL_FEE_SHARE
                    + constants::REWARDS_FEE_SHARE,
                constants::TOTAL_FEE_SHARES
            );
        }
    }
}
