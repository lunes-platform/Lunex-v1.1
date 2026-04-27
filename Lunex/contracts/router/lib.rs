#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)] // ink! interno gera cfg conditions que não podem ser suprimidas de outra forma
#![allow(clippy::cast_possible_truncation)]
#![warn(clippy::arithmetic_side_effects)]

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

// ========================================
// CROSS-CONTRACT CALL WRAPPERS
// ========================================

use ink::env::call::{build_call, ExecutionInput, Selector};
use ink::env::DefaultEnvironment;

/// Tipo auxiliar para AccountId
type AccountId = <DefaultEnvironment as ink::env::Environment>::AccountId;
/// Tipo auxiliar para Balance
type Balance = <DefaultEnvironment as ink::env::Environment>::Balance;

/// Wrapper para chamadas cross-contract ao Factory
pub struct FactoryRef;

impl FactoryRef {
    /// Obtém o endereço do par para dois tokens
    pub fn get_pair(
        factory: AccountId,
        token_a: AccountId,
        token_b: AccountId,
    ) -> Result<AccountId, ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(factory)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("get_pair")))
                    .push_arg(token_a)
                    .push_arg(token_b),
            )
            .returns::<Option<AccountId>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
            .and_then(|opt| opt.ok_or(ink::env::Error::CalleeTrapped))
    }
}

/// Wrapper para chamadas cross-contract ao Pair
pub struct PairRef;

impl PairRef {
    /// Obtém as reserves do par
    pub fn get_reserves(pair: AccountId) -> Result<(Balance, Balance, u64), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(ExecutionInput::new(Selector::new(ink::selector_bytes!(
                "get_reserves"
            ))))
            .returns::<(Balance, Balance, u64)>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Chama mint no pair
    pub fn mint(pair: AccountId, to: AccountId) -> Result<Balance, ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("mint"))).push_arg(to),
            )
            .returns::<Balance>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Chama burn no pair
    pub fn burn(pair: AccountId, to: AccountId) -> Result<(Balance, Balance), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("burn"))).push_arg(to),
            )
            .returns::<(Balance, Balance)>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Chama swap no pair
    pub fn swap(
        pair: AccountId,
        amount_0_out: Balance,
        amount_1_out: Balance,
        to: AccountId,
    ) -> Result<(), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("swap")))
                    .push_arg(amount_0_out)
                    .push_arg(amount_1_out)
                    .push_arg(to),
            )
            .returns::<()>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Obtém token_0 do par
    pub fn token_0(pair: AccountId) -> Result<AccountId, ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(ExecutionInput::new(Selector::new(ink::selector_bytes!(
                "token_0"
            ))))
            .returns::<AccountId>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Obtém token_1 do par
    pub fn token_1(pair: AccountId) -> Result<AccountId, ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(pair)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(ExecutionInput::new(Selector::new(ink::selector_bytes!(
                "token_1"
            ))))
            .returns::<AccountId>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }
}

/// Wrapper para chamadas cross-contract PSP22
pub struct PSP22Ref;

impl PSP22Ref {
    /// Transfere tokens PSP22 para um destinatário
    pub fn transfer(
        token: AccountId,
        to: AccountId,
        amount: Balance,
    ) -> Result<(), ink::env::Error> {
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
    pub fn transfer_from(
        token: AccountId,
        from: AccountId,
        to: AccountId,
        amount: Balance,
    ) -> Result<(), ink::env::Error> {
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

/// Wrapper para chamadas cross-contract ao WNative
pub struct WNativeRef;

impl WNativeRef {
    /// Deposita tokens nativos no WNative (wrap)
    pub fn deposit(wnative: AccountId, amount: Balance) -> Result<(), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(wnative)
            .gas_limit(0)
            .transferred_value(amount)
            .exec_input(ExecutionInput::new(Selector::new(ink::selector_bytes!(
                "deposit"
            ))))
            .returns::<Result<(), ()>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Retira tokens nativos do WNative (unwrap)
    pub fn withdraw(wnative: AccountId, amount: Balance) -> Result<(), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(wnative)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("withdraw")))
                    .push_arg(amount),
            )
            .returns::<Result<(), ()>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }

    /// Transfere WNative tokens
    pub fn transfer(
        wnative: AccountId,
        to: AccountId,
        amount: Balance,
    ) -> Result<(), ink::env::Error> {
        build_call::<DefaultEnvironment>()
            .call(wnative)
            .gas_limit(0)
            .transferred_value(0)
            .exec_input(
                ExecutionInput::new(Selector::new(ink::selector_bytes!("transfer")))
                    .push_arg(to)
                    .push_arg(amount),
            )
            .returns::<Result<(), ()>>()
            .try_invoke()
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)?
            .map_err(|_| ink::env::Error::CalleeTrapped)
    }
}

#[ink::contract]
pub mod router_contract {
    use super::{FactoryRef, PSP22Error, PSP22Ref, PairRef, WNativeRef};
    use ink::prelude::vec;
    use ink::prelude::vec::Vec;

    // ========================================
    // ROUTER CONTRACT - DEX OPERATIONS COORDINATOR
    // ========================================
    //
    // Este contrato coordena operações complexas do DEX:
    // - Add/Remove Liquidity: Gerencia tokens e LP tokens
    // - Swaps: Coordena trocas através de múltiplos pares
    // - Slippage Protection: Validações min/max amounts
    // - Multi-hop: Swaps através de múltiplos pares
    //
    // ## Segurança:
    // - Deadline verification para prevenir transações antigas
    // - Slippage protection em todas operações
    // - Safe arithmetic em todos os cálculos
    // - Input validation rigorosa
    // - Cross-contract calls com verificação de erros

    // ========================================
    // EVENTOS (PARA INDEXADORES E UIS)
    // ========================================

    /// Emitido quando liquidez é adicionada
    #[ink(event)]
    pub struct LiquidityAdded {
        #[ink(topic)]
        pub token_a: AccountId,
        #[ink(topic)]
        pub token_b: AccountId,
        pub amount_a: Balance,
        pub amount_b: Balance,
        pub liquidity: Balance,
        #[ink(topic)]
        pub to: AccountId,
    }

    /// Emitido quando liquidez é removida
    #[ink(event)]
    pub struct LiquidityRemoved {
        #[ink(topic)]
        pub token_a: AccountId,
        #[ink(topic)]
        pub token_b: AccountId,
        pub amount_a: Balance,
        pub amount_b: Balance,
        pub liquidity: Balance,
        #[ink(topic)]
        pub to: AccountId,
    }

    /// Emitido quando swap é realizado
    #[ink(event)]
    pub struct Swap {
        #[ink(topic)]
        pub sender: AccountId,
        pub amount_in: Balance,
        pub amount_out: Balance,
        pub path: Vec<AccountId>,
        #[ink(topic)]
        pub to: AccountId,
    }

    // ========================================
    // ERROS ESPECÍFICOS DO ROUTER CONTRACT
    // ========================================

    /// Emitido quando o roteador é pausado (circuit breaker)
    #[ink(event)]
    pub struct RouterPaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    /// Emitido quando o roteador é despausado
    #[ink(event)]
    pub struct RouterUnpaused {
        #[ink(topic)]
        pub by: AccountId,
    }

    /// Erros que podem ocorrer nas operações do Router
    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    #[allow(clippy::cast_possible_truncation)]
    pub enum RouterError {
        /// Deadline da transação expirou
        Expired,
        /// Amount insuficiente de A
        InsufficientAAmount,
        /// Amount insuficiente de B
        InsufficientBAmount,
        /// Output amount insuficiente no swap
        InsufficientOutputAmount,
        /// Liquidez insuficiente
        InsufficientLiquidity,
        /// Path de swap inválido
        InvalidPath,
        /// Token addresses iguais
        IdenticalAddresses,
        /// Endereço zero não permitido
        ZeroAddress,
        /// Input amount excessivo
        ExcessiveInputAmount,
        /// Par não existe no Factory
        PairNotExists,
        /// Erro PSP22 subjacente
        PSP22(PSP22Error),
        /// Contrato travado (proteção reentrância)
        Locked,
        /// Path muito longo (DoS protection)
        PathTooLong,
        /// Protocolo pausado por emergência (circuit breaker)
        ProtocolPaused,
        /// Impacto de preço excede limite configurado
        PriceImpactTooHigh,
        /// Acesso não autorizado
        Unauthorized,
        /// Overflow em cálculo matemático
        Overflow,
    }

    impl From<PSP22Error> for RouterError {
        fn from(error: PSP22Error) -> Self {
            RouterError::PSP22(error)
        }
    }

    // ========================================
    // CONSTANTES DO PROTOCOLO ROUTER
    // ========================================
    mod constants {
        /// Minimum liquidity para cálculos (mesmo valor do Pair - PRODUÇÃO)
        pub const MINIMUM_LIQUIDITY: u128 = 1000;

        /// Fee para swaps (0.5% = 995/1000) - conforme Lunex DEX
        pub const FEE_DENOMINATOR: u128 = 1000;
        pub const FEE_NUMERATOR: u128 = 995;

        /// Limite máximo de hops no path (DoS protection)
        /// Previne consumo excessivo de gas em multi-hop swaps
        pub const MAX_PATH_LENGTH: usize = 4;
    }

    // ========================================
    // STORAGE DO ROUTER CONTRACT
    // ========================================

    /// Storage principal do Router Contract
    #[ink(storage)]
    pub struct RouterContract {
        /// Endereço do Factory Contract
        factory: AccountId,
        /// Endereço do WNative Contract
        wnative: AccountId,
        /// Reentrancy protection flag
        unlocked: bool,
        /// Circuit breaker: pausa todas as operações do Router
        paused: bool,
        /// Admin autorizado a pausar/despausar e configurar limites
        admin: AccountId,
        /// Limite máximo de impacto de preço por hop (basis points, 0 = desabilitado)
        max_price_impact_bps: u32,
    }

    impl RouterContract {
        /// Construtor do Router Contract
        #[ink(constructor)]
        pub fn new(factory: AccountId, wnative: AccountId) -> Self {
            Self {
                factory,
                wnative,
                unlocked: true,
                paused: false,
                admin: Self::env().caller(),
                max_price_impact_bps: 500, // 5% padrão
            }
        }

        // ========================================
        // REENTRANCY PROTECTION
        // ========================================

        /// Adquire lock para proteção contra reentrância
        fn lock(&mut self) -> Result<(), RouterError> {
            if !self.unlocked {
                return Err(RouterError::Locked);
            }
            self.unlocked = false;
            Ok(())
        }

        /// Libera lock após operação
        fn unlock(&mut self) {
            self.unlocked = true;
        }

        /// Verifica se o router está pausado
        fn ensure_not_paused(&self) -> Result<(), RouterError> {
            if self.paused {
                return Err(RouterError::ProtocolPaused);
            }
            Ok(())
        }

        /// Verifica se o caller é o admin
        fn ensure_admin(&self) -> Result<(), RouterError> {
            if self.env().caller() != self.admin {
                return Err(RouterError::Unauthorized);
            }
            Ok(())
        }

        /// Pausa o router em caso de emergência (somente admin)
        #[ink(message)]
        pub fn pause(&mut self) -> Result<(), RouterError> {
            self.ensure_admin()?;
            self.paused = true;
            self.env().emit_event(RouterPaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Despauza o router (somente admin)
        #[ink(message)]
        pub fn unpause(&mut self) -> Result<(), RouterError> {
            self.ensure_admin()?;
            self.paused = false;
            self.env().emit_event(RouterUnpaused {
                by: self.env().caller(),
            });
            Ok(())
        }

        /// Retorna true se o router estiver pausado
        #[ink(message)]
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        /// Configura o limite máximo de impacto de preço (0 = desabilitado)
        #[ink(message)]
        pub fn set_max_price_impact_bps(&mut self, bps: u32) -> Result<(), RouterError> {
            self.ensure_admin()?;
            self.max_price_impact_bps = bps;
            Ok(())
        }

        /// Retorna o limite atual de impacto de preço
        #[ink(message)]
        pub fn get_max_price_impact_bps(&self) -> u32 {
            self.max_price_impact_bps
        }

        /// Retorna o endereço do admin
        #[ink(message)]
        pub fn admin(&self) -> AccountId {
            self.admin
        }

        // ========================================
        // QUERIES (READ-ONLY)
        // ========================================

        /// Retorna o endereço do Factory
        #[ink(message)]
        pub fn factory(&self) -> AccountId {
            self.factory
        }

        /// Retorna o endereço do WNative
        #[ink(message)]
        pub fn wnative(&self) -> AccountId {
            self.wnative
        }

        // ========================================
        // OPERAÇÕES DE LIQUIDEZ
        // ========================================

        /// Adiciona liquidez a um par de tokens
        ///
        /// # Parâmetros
        /// - `token_a`: Primeiro token do par
        /// - `token_b`: Segundo token do par  
        /// - `amount_a_desired`: Amount desejado do token A
        /// - `amount_b_desired`: Amount desejado do token B
        /// - `amount_a_min`: Amount mínimo do token A (slippage protection)
        /// - `amount_b_min`: Amount mínimo do token B (slippage protection)
        /// - `to`: Destinatário dos LP tokens
        /// - `deadline`: Timestamp limite para execução
        ///
        /// # Lógica Real:
        /// 1. Obtém o par do Factory (ou cria se não existir)
        /// 2. Calcula amounts ótimos baseado nas reserves
        /// 3. Transfere tokens para o par
        /// 4. Chama mint() no par
        ///
        /// # Segurança:
        /// - Reentrancy protection via lock/unlock
        #[ink(message)]
        pub fn add_liquidity(
            &mut self,
            token_a: AccountId,
            token_b: AccountId,
            amount_a_desired: Balance,
            amount_b_desired: Balance,
            amount_a_min: Balance,
            amount_b_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance, Balance), RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result = self.add_liquidity_internal(
                token_a,
                token_b,
                amount_a_desired,
                amount_b_desired,
                amount_a_min,
                amount_b_min,
                to,
                deadline,
            );
            self.unlock();
            result
        }

        /// Implementação interna do add_liquidity
        fn add_liquidity_internal(
            &mut self,
            token_a: AccountId,
            token_b: AccountId,
            amount_a_desired: Balance,
            amount_b_desired: Balance,
            amount_a_min: Balance,
            amount_b_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance, Balance), RouterError> {
            // Validações iniciais
            self.ensure_deadline(deadline)?;
            self.validate_addresses(token_a, token_b)?;
            if amount_a_desired == 0 || amount_a_desired < amount_a_min {
                return Err(RouterError::InsufficientAAmount);
            }
            if amount_b_desired == 0 || amount_b_desired < amount_b_min {
                return Err(RouterError::InsufficientBAmount);
            }

            // Ordenar tokens (Factory usa ordem canônica)
            let (token_0, token_1) = self.sort_tokens(token_a, token_b);
            let (amount_0_desired, amount_1_desired) = if token_a == token_0 {
                (amount_a_desired, amount_b_desired)
            } else {
                (amount_b_desired, amount_a_desired)
            };
            let (amount_0_min, amount_1_min) = if token_a == token_0 {
                (amount_a_min, amount_b_min)
            } else {
                (amount_b_min, amount_a_min)
            };

            // Obter par do Factory
            let pair = FactoryRef::get_pair(self.factory, token_0, token_1)
                .map_err(|_| RouterError::PairNotExists)?;

            // Obter reserves atuais
            let (reserve_0, reserve_1, _) =
                PairRef::get_reserves(pair).map_err(|_| RouterError::PairNotExists)?;

            // Calcular amounts ótimos
            let (amount_0, amount_1) = if reserve_0 == 0 && reserve_1 == 0 {
                // Primeira liquidez - usar amounts desejados
                (amount_0_desired, amount_1_desired)
            } else {
                // Calcular amount_1 ótimo baseado em amount_0_desired
                let amount_1_optimal =
                    self.quote_internal(amount_0_desired, reserve_0, reserve_1)?;

                if amount_1_optimal <= amount_1_desired {
                    // amount_1_optimal é viável
                    if amount_1_optimal < amount_1_min {
                        return Err(RouterError::InsufficientBAmount);
                    }
                    (amount_0_desired, amount_1_optimal)
                } else {
                    // Calcular amount_0 ótimo baseado em amount_1_desired
                    let amount_0_optimal =
                        self.quote_internal(amount_1_desired, reserve_1, reserve_0)?;

                    if amount_0_optimal > amount_0_desired {
                        return Err(RouterError::InsufficientAAmount);
                    }
                    if amount_0_optimal < amount_0_min {
                        return Err(RouterError::InsufficientAAmount);
                    }
                    (amount_0_optimal, amount_1_desired)
                }
            };

            // Converter de volta para token_a/token_b order
            let (amount_a, amount_b) = if token_a == token_0 {
                (amount_0, amount_1)
            } else {
                (amount_1, amount_0)
            };

            // Transferir tokens do usuário para o par
            let caller = self.env().caller();
            PSP22Ref::transfer_from(token_a, caller, pair, amount_a)
                .map_err(|_| RouterError::InsufficientAAmount)?;
            PSP22Ref::transfer_from(token_b, caller, pair, amount_b)
                .map_err(|_| RouterError::InsufficientBAmount)?;

            // Chamar mint no par para obter LP tokens
            let liquidity =
                PairRef::mint(pair, to).map_err(|_| RouterError::InsufficientLiquidity)?;

            // Emitir evento
            self.env().emit_event(LiquidityAdded {
                token_a,
                token_b,
                amount_a,
                amount_b,
                liquidity,
                to,
            });

            Ok((amount_a, amount_b, liquidity))
        }

        /// Remove liquidez de um par de tokens
        ///
        /// # Lógica Real:
        /// 1. Obtém o par do Factory
        /// 2. Transfere LP tokens para o par
        /// 3. Chama burn() no par
        /// 4. Verifica slippage protection
        ///
        /// # Segurança:
        /// - Reentrancy protection via lock/unlock
        #[ink(message)]
        pub fn remove_liquidity(
            &mut self,
            token_a: AccountId,
            token_b: AccountId,
            liquidity: Balance,
            amount_a_min: Balance,
            amount_b_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance), RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result = self.remove_liquidity_internal(
                token_a,
                token_b,
                liquidity,
                amount_a_min,
                amount_b_min,
                to,
                deadline,
            );
            self.unlock();
            result
        }

        /// Implementação interna do remove_liquidity
        fn remove_liquidity_internal(
            &mut self,
            token_a: AccountId,
            token_b: AccountId,
            liquidity: Balance,
            amount_a_min: Balance,
            amount_b_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance), RouterError> {
            // Validações iniciais
            self.ensure_deadline(deadline)?;
            self.validate_addresses(token_a, token_b)?;

            if liquidity == 0 {
                return Err(RouterError::InsufficientLiquidity);
            }

            // Ordenar tokens
            let (token_0, token_1) = self.sort_tokens(token_a, token_b);

            // Obter par do Factory
            let pair = FactoryRef::get_pair(self.factory, token_0, token_1)
                .map_err(|_| RouterError::PairNotExists)?;

            // Transferir LP tokens do usuário para o par
            let caller = self.env().caller();
            PSP22Ref::transfer_from(pair, caller, pair, liquidity)
                .map_err(|_| RouterError::InsufficientLiquidity)?;

            // Chamar burn no par
            let (amount_0, amount_1) =
                PairRef::burn(pair, to).map_err(|_| RouterError::InsufficientLiquidity)?;

            // Converter para token_a/token_b order
            let (amount_a, amount_b) = if token_a == token_0 {
                (amount_0, amount_1)
            } else {
                (amount_1, amount_0)
            };

            // Validar slippage protection
            if amount_a < amount_a_min {
                return Err(RouterError::InsufficientAAmount);
            }
            if amount_b < amount_b_min {
                return Err(RouterError::InsufficientBAmount);
            }

            // Emitir evento
            self.env().emit_event(LiquidityRemoved {
                token_a,
                token_b,
                amount_a,
                amount_b,
                liquidity,
                to,
            });

            Ok((amount_a, amount_b))
        }

        // ========================================
        // OPERAÇÕES DE SWAP
        // ========================================

        /// Swap com input amount exato
        ///
        /// # Lógica Real:
        /// 1. Calcula amounts para cada hop no path
        /// 2. Transfere token de entrada para o primeiro par
        /// 3. Executa swaps sequenciais através do path
        ///
        /// # Segurança:
        /// - Reentrancy protection via lock/unlock
        /// - Deadline validation
        /// - Slippage protection
        #[ink(message)]
        pub fn swap_exact_tokens_for_tokens(
            &mut self,
            amount_in: Balance,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result =
                self.swap_exact_tokens_internal(amount_in, amount_out_min, path, to, deadline);
            self.unlock();
            result
        }

        /// Implementação interna do swap_exact_tokens_for_tokens
        fn swap_exact_tokens_internal(
            &mut self,
            amount_in: Balance,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            // Validações iniciais
            self.ensure_deadline(deadline)?;
            self.validate_path(&path)?;

            if amount_in == 0 {
                return Err(RouterError::InsufficientOutputAmount);
            }

            // Calcular amounts para cada hop usando reserves reais (com verificação de price impact)
            let amounts = self.get_amounts_out_checked(amount_in, &path)?;

            // Validar slippage protection
            let final_amount = *amounts.last().ok_or(RouterError::InvalidPath)?;
            if final_amount < amount_out_min {
                return Err(RouterError::InsufficientOutputAmount);
            }

            // Transferir token de entrada para o primeiro par
            let caller = self.env().caller();
            let pair = FactoryRef::get_pair(self.factory, path[0], path[1])
                .map_err(|_| RouterError::PairNotExists)?;

            PSP22Ref::transfer_from(path[0], caller, pair, amounts[0])
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            // Executar swaps sequenciais
            self.execute_swaps(&amounts, &path, to)?;

            // Emitir evento
            self.env().emit_event(Swap {
                sender: caller,
                amount_in: amounts[0],
                amount_out: final_amount,
                path: path.clone(),
                to,
            });

            Ok(amounts)
        }

        /// Swap com output amount exato
        ///
        /// # Lógica Real:
        /// 1. Calcula amounts necessários para obter output exato
        /// 2. Verifica se input está dentro do máximo permitido
        /// 3. Executa swaps
        ///
        /// # Segurança:
        /// - Reentrancy protection via lock/unlock
        /// - Deadline validation
        /// - Slippage protection
        #[ink(message)]
        pub fn swap_tokens_for_exact_tokens(
            &mut self,
            amount_out: Balance,
            amount_in_max: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result =
                self.swap_tokens_for_exact_internal(amount_out, amount_in_max, path, to, deadline);
            self.unlock();
            result
        }

        /// Implementação interna do swap_tokens_for_exact_tokens
        fn swap_tokens_for_exact_internal(
            &mut self,
            amount_out: Balance,
            amount_in_max: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            // Validações iniciais
            self.ensure_deadline(deadline)?;
            self.validate_path(&path)?;

            if amount_out == 0 {
                return Err(RouterError::InsufficientOutputAmount);
            }
            if amount_in_max == 0 {
                return Err(RouterError::ExcessiveInputAmount);
            }

            // Calcular amounts necessários (reverso)
            let amounts = self.get_amounts_in(amount_out, &path)?;

            // Validar slippage protection
            if amounts[0] > amount_in_max {
                return Err(RouterError::ExcessiveInputAmount);
            }

            // Transferir token de entrada para o primeiro par
            let caller = self.env().caller();
            let pair = FactoryRef::get_pair(self.factory, path[0], path[1])
                .map_err(|_| RouterError::PairNotExists)?;

            PSP22Ref::transfer_from(path[0], caller, pair, amounts[0])
                .map_err(|_| RouterError::ExcessiveInputAmount)?;

            // Executar swaps sequenciais
            self.execute_swaps(&amounts, &path, to)?;

            let final_amount = *amounts.last().ok_or(RouterError::InvalidPath)?;

            // Emitir evento
            self.env().emit_event(Swap {
                sender: caller,
                amount_in: amounts[0],
                amount_out: final_amount,
                path: path.clone(),
                to,
            });

            Ok(amounts)
        }

        /// Executa swaps sequenciais através do path
        fn execute_swaps(
            &self,
            amounts: &Vec<Balance>,
            path: &Vec<AccountId>,
            final_to: AccountId,
        ) -> Result<(), RouterError> {
            for i in 0..(path.len() - 1) {
                let (input, output) = (path[i], path[i + 1]);
                let (token_0, _) = self.sort_tokens(input, output);
                let amount_out = amounts[i + 1];

                // Determinar direction do swap
                let (amount_0_out, amount_1_out) = if input == token_0 {
                    (0, amount_out)
                } else {
                    (amount_out, 0)
                };

                // Destino: próximo par ou destinatário final
                let to = if i < path.len() - 2 {
                    FactoryRef::get_pair(self.factory, output, path[i + 2])
                        .map_err(|_| RouterError::PairNotExists)?
                } else {
                    final_to
                };

                // Executar swap no par
                let pair = FactoryRef::get_pair(self.factory, input, output)
                    .map_err(|_| RouterError::PairNotExists)?;

                PairRef::swap(pair, amount_0_out, amount_1_out, to)
                    .map_err(|_| RouterError::InsufficientOutputAmount)?;
            }

            Ok(())
        }

        // ========================================
        // FUNÇÕES COM NATIVE TOKEN (LUNES)
        // ========================================
        // Estas funções permitem interagir diretamente com o token
        // nativo da blockchain (LUNES) usando WLUNES como intermediário.

        /// Adiciona liquidez com token nativo (LUNES)
        /// O token nativo enviado é automaticamente convertido em WLUNES
        #[ink(message, payable)]
        pub fn add_liquidity_native(
            &mut self,
            token: AccountId,
            amount_token_desired: Balance,
            amount_token_min: Balance,
            amount_native_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance, Balance), RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result = self.add_liquidity_native_internal(
                token,
                amount_token_desired,
                amount_token_min,
                amount_native_min,
                to,
                deadline,
            );
            self.unlock();
            result
        }

        fn add_liquidity_native_internal(
            &mut self,
            token: AccountId,
            amount_token_desired: Balance,
            amount_token_min: Balance,
            amount_native_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance, Balance), RouterError> {
            self.ensure_deadline(deadline)?;

            let amount_native = self.env().transferred_value();
            if amount_native == 0 {
                return Err(RouterError::InsufficientAAmount);
            }
            self.validate_addresses(token, self.wnative)?;
            if amount_token_desired == 0 || amount_token_desired < amount_token_min {
                return Err(RouterError::InsufficientAAmount);
            }
            if amount_native < amount_native_min {
                return Err(RouterError::InsufficientBAmount);
            }

            // Wrap native token para WNATIVE
            WNativeRef::deposit(self.wnative, amount_native)
                .map_err(|_| RouterError::InsufficientAAmount)?;

            // Adicionar liquidez usando WNATIVE
            let result = self.add_liquidity_internal(
                token,
                self.wnative,
                amount_token_desired,
                amount_native,
                amount_token_min,
                amount_native_min,
                to,
                deadline,
            );

            // Se falhar, fazer unwrap e devolver native tokens
            if result.is_err() {
                let _ = WNativeRef::withdraw(self.wnative, amount_native);
            }

            result
        }

        /// Remove liquidez e recebe token nativo (LUNES)
        /// WNATIVE recebido é automaticamente convertido para LUNES nativo
        #[ink(message)]
        pub fn remove_liquidity_native(
            &mut self,
            token: AccountId,
            liquidity: Balance,
            amount_token_min: Balance,
            amount_native_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance), RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result = self.remove_liquidity_native_internal(
                token,
                liquidity,
                amount_token_min,
                amount_native_min,
                to,
                deadline,
            );
            self.unlock();
            result
        }

        fn remove_liquidity_native_internal(
            &mut self,
            token: AccountId,
            liquidity: Balance,
            amount_token_min: Balance,
            amount_native_min: Balance,
            to: AccountId,
            deadline: u64,
        ) -> Result<(Balance, Balance), RouterError> {
            self.ensure_deadline(deadline)?;

            // Remove liquidez recebendo WNATIVE para este contrato
            let contract_address = self.env().account_id();
            let (amount_token, amount_native) = self.remove_liquidity_internal(
                token,
                self.wnative,
                liquidity,
                amount_token_min,
                amount_native_min,
                contract_address,
                deadline,
            )?;

            // Transferir token para destinatário
            PSP22Ref::transfer(token, to, amount_token)
                .map_err(|_| RouterError::InsufficientBAmount)?;

            // Unwrap WNATIVE e enviar native para destinatário
            WNativeRef::withdraw(self.wnative, amount_native)
                .map_err(|_| RouterError::InsufficientBAmount)?;

            self.env()
                .transfer(to, amount_native)
                .map_err(|_| RouterError::InsufficientBAmount)?;

            Ok((amount_token, amount_native))
        }

        /// Swap de token nativo (LUNES) para tokens
        /// O LUNES enviado é automaticamente convertido em WLUNES
        #[ink(message, payable)]
        pub fn swap_exact_native_for_tokens(
            &mut self,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result =
                self.swap_exact_native_for_tokens_internal(amount_out_min, path, to, deadline);
            self.unlock();
            result
        }

        fn swap_exact_native_for_tokens_internal(
            &mut self,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_deadline(deadline)?;

            // Primeiro token no path deve ser WNATIVE
            if path.is_empty() || path[0] != self.wnative {
                return Err(RouterError::InvalidPath);
            }

            let amount_in = self.env().transferred_value();
            if amount_in == 0 {
                return Err(RouterError::InsufficientOutputAmount);
            }
            self.validate_path(&path)?;

            // Wrap native para WNATIVE
            WNativeRef::deposit(self.wnative, amount_in)
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            // Executar swap (com verificação de price impact)
            let amounts = self.get_amounts_out_checked(amount_in, &path)?;
            let final_amount = *amounts.last().ok_or(RouterError::InvalidPath)?;

            if final_amount < amount_out_min {
                return Err(RouterError::InsufficientOutputAmount);
            }

            // Transferir WNATIVE para o primeiro par
            let pair = FactoryRef::get_pair(self.factory, path[0], path[1])
                .map_err(|_| RouterError::PairNotExists)?;

            WNativeRef::transfer(self.wnative, pair, amounts[0])
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            // Executar swaps
            self.execute_swaps(&amounts, &path, to)?;

            let caller = self.env().caller();
            self.env().emit_event(Swap {
                sender: caller,
                amount_in: amounts[0],
                amount_out: final_amount,
                path: path.clone(),
                to,
            });

            Ok(amounts)
        }

        #[ink(message)]
        pub fn swap_exact_tokens_for_native(
            &mut self,
            amount_in: Balance,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_not_paused()?;
            self.lock()?;
            let result = self.swap_exact_tokens_for_native_internal(
                amount_in,
                amount_out_min,
                path,
                to,
                deadline,
            );
            self.unlock();
            result
        }

        fn swap_exact_tokens_for_native_internal(
            &mut self,
            amount_in: Balance,
            amount_out_min: Balance,
            path: Vec<AccountId>,
            to: AccountId,
            deadline: u64,
        ) -> Result<Vec<Balance>, RouterError> {
            self.ensure_deadline(deadline)?;
            self.validate_path(&path)?;

            // Último token no path deve ser WNATIVE
            let last_token = *path.last().ok_or(RouterError::InvalidPath)?;
            if last_token != self.wnative {
                return Err(RouterError::InvalidPath);
            }
            if amount_in == 0 {
                return Err(RouterError::InsufficientOutputAmount);
            }

            // Calcular amounts
            let amounts = self.get_amounts_out(amount_in, &path)?;
            let final_amount = *amounts.last().ok_or(RouterError::InvalidPath)?;

            if final_amount < amount_out_min {
                return Err(RouterError::InsufficientOutputAmount);
            }

            // Transferir token de entrada para o primeiro par
            let caller = self.env().caller();
            let pair = FactoryRef::get_pair(self.factory, path[0], path[1])
                .map_err(|_| RouterError::PairNotExists)?;

            PSP22Ref::transfer_from(path[0], caller, pair, amounts[0])
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            // Executar swaps - receber WNATIVE neste contrato
            let contract_address = self.env().account_id();
            self.execute_swaps(&amounts, &path, contract_address)?;

            // Unwrap WNATIVE e enviar native para destinatário
            WNativeRef::withdraw(self.wnative, final_amount)
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            self.env()
                .transfer(to, final_amount)
                .map_err(|_| RouterError::InsufficientOutputAmount)?;

            self.env().emit_event(Swap {
                sender: caller,
                amount_in: amounts[0],
                amount_out: final_amount,
                path: path.clone(),
                to,
            });

            Ok(amounts)
        }

        // ========================================
        // FUNÇÕES PÚBLICAS DE CÁLCULO (VIEW)
        // ========================================
        // Estas funções permitem que o frontend/SDK calcule
        // estimativas de swap sem executar transações.

        /// Calcula amount proporcional para adicionar liquidez
        /// Dado um amount de token A, retorna o amount equivalente de token B
        /// baseado nas reserves atuais do pool.
        #[ink(message)]
        pub fn quote(
            &self,
            amount_a: Balance,
            reserve_a: Balance,
            reserve_b: Balance,
        ) -> Result<Balance, RouterError> {
            self.quote_internal(amount_a, reserve_a, reserve_b)
        }

        /// Calcula amount de output para um swap
        /// Dado um amount de input e as reserves, retorna o amount de output
        /// considerando a taxa de 0.5%
        #[ink(message)]
        pub fn get_amount_out(
            &self,
            amount_in: Balance,
            reserve_in: Balance,
            reserve_out: Balance,
        ) -> Result<Balance, RouterError> {
            self.get_amount_out_internal(amount_in, reserve_in, reserve_out)
        }

        /// Calcula amount de input necessário para um output específico
        /// Dado um amount de output desejado e as reserves, retorna o amount de input
        /// necessário considerando a taxa de 0.5%
        #[ink(message)]
        pub fn get_amount_in(
            &self,
            amount_out: Balance,
            reserve_in: Balance,
            reserve_out: Balance,
        ) -> Result<Balance, RouterError> {
            self.get_amount_in_internal(amount_out, reserve_in, reserve_out)
        }

        // ========================================
        // FUNÇÕES INTERNAS (VALIDAÇÕES E CÁLCULOS)
        // ========================================

        /// Valida se o deadline não expirou
        fn ensure_deadline(&self, deadline: u64) -> Result<(), RouterError> {
            let current_time = self.env().block_timestamp();
            if current_time > deadline {
                return Err(RouterError::Expired);
            }
            Ok(())
        }

        /// Valida endereços dos tokens
        fn validate_addresses(
            &self,
            token_a: AccountId,
            token_b: AccountId,
        ) -> Result<(), RouterError> {
            let zero_address = AccountId::from([0u8; 32]);
            if token_a == zero_address || token_b == zero_address {
                return Err(RouterError::ZeroAddress);
            }
            if token_a == token_b {
                return Err(RouterError::IdenticalAddresses);
            }
            Ok(())
        }

        /// Valida path de swap (segurança: limita tamanho máximo para prevenir DoS)
        fn validate_path(&self, path: &Vec<AccountId>) -> Result<(), RouterError> {
            // Mínimo de 2 tokens no path
            if path.len() < 2 {
                return Err(RouterError::InvalidPath);
            }

            // SEGURANÇA: Limitar tamanho máximo do path para prevenir DoS
            // Cada hop adicional consome gas significativo
            if path.len() > constants::MAX_PATH_LENGTH {
                return Err(RouterError::PathTooLong);
            }

            // Validar que nenhum token é zero address
            let zero_address = AccountId::from([0u8; 32]);
            for token in path {
                if *token == zero_address {
                    return Err(RouterError::ZeroAddress);
                }
            }

            Ok(())
        }

        /// Ordena tokens em ordem canônica
        fn sort_tokens(&self, token_a: AccountId, token_b: AccountId) -> (AccountId, AccountId) {
            if token_a < token_b {
                (token_a, token_b)
            } else {
                (token_b, token_a)
            }
        }

        /// Quote interno: calcula amount proporcional (amount_a * reserve_b / reserve_a)
        fn quote_internal(
            &self,
            amount_a: Balance,
            reserve_a: Balance,
            reserve_b: Balance,
        ) -> Result<Balance, RouterError> {
            if amount_a == 0 {
                return Err(RouterError::InsufficientLiquidity);
            }
            if reserve_a == 0 || reserve_b == 0 {
                return Err(RouterError::InsufficientLiquidity);
            }

            amount_a
                .checked_mul(reserve_b)
                .ok_or(RouterError::InsufficientLiquidity)?
                .checked_div(reserve_a)
                .ok_or(RouterError::InsufficientLiquidity)
        }

        /// Calcula amount de output usando fórmula AMM real (interno)
        /// amount_out = (amount_in * fee * reserve_out) / (reserve_in * 1000 + amount_in * fee)
        fn get_amount_out_internal(
            &self,
            amount_in: Balance,
            reserve_in: Balance,
            reserve_out: Balance,
        ) -> Result<Balance, RouterError> {
            if amount_in == 0 {
                return Err(RouterError::InsufficientOutputAmount);
            }
            if reserve_in == 0 || reserve_out == 0 {
                return Err(RouterError::InsufficientLiquidity);
            }

            let amount_in_with_fee = amount_in
                .checked_mul(constants::FEE_NUMERATOR)
                .ok_or(RouterError::InsufficientOutputAmount)?;

            let numerator = amount_in_with_fee
                .checked_mul(reserve_out)
                .ok_or(RouterError::InsufficientOutputAmount)?;

            let denominator = reserve_in
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(RouterError::InsufficientOutputAmount)?
                .checked_add(amount_in_with_fee)
                .ok_or(RouterError::InsufficientOutputAmount)?;

            numerator
                .checked_div(denominator)
                .ok_or(RouterError::InsufficientOutputAmount)
        }

        /// Calcula amount de input necessário para output exato (interno)
        /// amount_in = (reserve_in * amount_out * 1000) / ((reserve_out - amount_out) * fee) + 1
        fn get_amount_in_internal(
            &self,
            amount_out: Balance,
            reserve_in: Balance,
            reserve_out: Balance,
        ) -> Result<Balance, RouterError> {
            if amount_out == 0 {
                return Err(RouterError::ExcessiveInputAmount);
            }
            if reserve_in == 0 || reserve_out == 0 {
                return Err(RouterError::InsufficientLiquidity);
            }
            if amount_out >= reserve_out {
                return Err(RouterError::InsufficientLiquidity);
            }

            let numerator = reserve_in
                .checked_mul(amount_out)
                .ok_or(RouterError::ExcessiveInputAmount)?
                .checked_mul(constants::FEE_DENOMINATOR)
                .ok_or(RouterError::ExcessiveInputAmount)?;

            let denominator = reserve_out
                .checked_sub(amount_out)
                .ok_or(RouterError::InsufficientLiquidity)?
                .checked_mul(constants::FEE_NUMERATOR)
                .ok_or(RouterError::ExcessiveInputAmount)?;

            numerator
                .checked_div(denominator)
                .ok_or(RouterError::ExcessiveInputAmount)?
                .checked_add(1)
                .ok_or(RouterError::ExcessiveInputAmount)
        }

        /// Calcula todos os amounts de output para um path
        fn get_amounts_out(
            &self,
            amount_in: Balance,
            path: &Vec<AccountId>,
        ) -> Result<Vec<Balance>, RouterError> {
            if path.len() < 2 {
                return Err(RouterError::InvalidPath);
            }

            let mut amounts = vec![amount_in];

            for i in 0..(path.len() - 1) {
                let pair = FactoryRef::get_pair(self.factory, path[i], path[i + 1])
                    .map_err(|_| RouterError::PairNotExists)?;

                let (reserve_0, reserve_1, _) =
                    PairRef::get_reserves(pair).map_err(|_| RouterError::PairNotExists)?;

                let (token_0, _) = self.sort_tokens(path[i], path[i + 1]);
                let (reserve_in, reserve_out) = if path[i] == token_0 {
                    (reserve_0, reserve_1)
                } else {
                    (reserve_1, reserve_0)
                };

                let amount_out =
                    self.get_amount_out_internal(amounts[i], reserve_in, reserve_out)?;
                amounts.push(amount_out);
            }

            Ok(amounts)
        }

        /// Igual a get_amounts_out mas valida impacto de preço por hop
        /// Usado internamente nas funções de swap (não em views)
        fn get_amounts_out_checked(
            &self,
            amount_in: Balance,
            path: &Vec<AccountId>,
        ) -> Result<Vec<Balance>, RouterError> {
            if path.len() < 2 {
                return Err(RouterError::InvalidPath);
            }

            let mut amounts = vec![amount_in];

            for i in 0..(path.len() - 1) {
                let pair = FactoryRef::get_pair(self.factory, path[i], path[i + 1])
                    .map_err(|_| RouterError::PairNotExists)?;

                let (reserve_0, reserve_1, _) =
                    PairRef::get_reserves(pair).map_err(|_| RouterError::PairNotExists)?;

                let (token_0, _) = self.sort_tokens(path[i], path[i + 1]);
                let (reserve_in, reserve_out) = if path[i] == token_0 {
                    (reserve_0, reserve_1)
                } else {
                    (reserve_1, reserve_0)
                };

                // Verificação de impacto de preço: impact = amount_in * 10000 / (reserve_in + amount_in)
                if self.max_price_impact_bps > 0 && reserve_in > 0 {
                    let impact = amounts[i]
                        .checked_mul(10_000)
                        .ok_or(RouterError::Overflow)?
                        .checked_div(
                            reserve_in
                                .checked_add(amounts[i])
                                .ok_or(RouterError::Overflow)?,
                        )
                        .ok_or(RouterError::Overflow)?;
                    if impact > self.max_price_impact_bps as u128 {
                        return Err(RouterError::PriceImpactTooHigh);
                    }
                }

                let amount_out =
                    self.get_amount_out_internal(amounts[i], reserve_in, reserve_out)?;
                amounts.push(amount_out);
            }

            Ok(amounts)
        }

        /// Calcula todos os amounts de input para um path (reverso)
        fn get_amounts_in(
            &self,
            amount_out: Balance,
            path: &Vec<AccountId>,
        ) -> Result<Vec<Balance>, RouterError> {
            if path.len() < 2 {
                return Err(RouterError::InvalidPath);
            }

            let mut amounts = vec![0; path.len()];
            amounts[path.len() - 1] = amount_out;

            for i in (1..path.len()).rev() {
                let pair = FactoryRef::get_pair(self.factory, path[i - 1], path[i])
                    .map_err(|_| RouterError::PairNotExists)?;

                let (reserve_0, reserve_1, _) =
                    PairRef::get_reserves(pair).map_err(|_| RouterError::PairNotExists)?;

                let (token_0, _) = self.sort_tokens(path[i - 1], path[i]);
                let (reserve_in, reserve_out) = if path[i - 1] == token_0 {
                    (reserve_0, reserve_1)
                } else {
                    (reserve_1, reserve_0)
                };

                amounts[i - 1] =
                    self.get_amount_in_internal(amounts[i], reserve_in, reserve_out)?;
            }

            Ok(amounts)
        }
    }

    // ========================================
    // TESTES UNITÁRIOS TDD
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

        fn set_timestamp(timestamp: u64) {
            ink::env::test::set_block_timestamp::<DefaultEnvironment>(timestamp);
        }

        fn set_value_transferred(value: Balance) {
            ink::env::test::set_value_transferred::<DefaultEnvironment>(value);
        }

        // ========================================
        // TESTES BÁSICOS DE INICIALIZAÇÃO
        // ========================================

        #[ink::test]
        fn test_new_router_initializes_correctly() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // GREEN: Factory e WNative devem estar configurados corretamente
            assert_eq!(router.factory(), accounts.bob);
            assert_eq!(router.wnative(), accounts.charlie);
        }

        // ========================================
        // TESTES DE VALIDAÇÃO DE DEADLINE
        // ========================================

        #[ink::test]
        fn test_expired_deadline_fails() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000); // Current time

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // RED: Deadline no passado deve falhar
            let result = router.add_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                100,             // amount_a_desired
                100,             // amount_b_desired
                90,              // amount_a_min
                90,              // amount_b_min
                accounts.alice,  // to
                500,             // deadline (no passado)
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::Expired);
        }

        // ========================================
        // TESTES DE ADD LIQUIDITY
        // (Testes com cross-contract calls ignorados - requerem testes on-chain)
        // ========================================

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_add_liquidity_success() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // GREEN: Add liquidity com parâmetros válidos deve funcionar
            let result = router.add_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                100,             // amount_a_desired
                200,             // amount_b_desired
                90,              // amount_a_min
                180,             // amount_b_min
                accounts.alice,  // to
                2000,            // deadline (futuro)
            );

            assert!(result.is_ok());
            let (amount_a, amount_b, liquidity) = result.unwrap();
            assert_eq!(amount_a, 100);
            assert_eq!(amount_b, 200);
            assert!(liquidity > 0);
        }

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_add_liquidity_insufficient_a_amount() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // RED: amount_a_min muito alto deve falhar
            let result = router.add_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                100,             // amount_a_desired
                200,             // amount_b_desired
                150,             // amount_a_min (muito alto)
                180,             // amount_b_min
                accounts.alice,  // to
                2000,            // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientAAmount);
        }

        #[ink::test]
        fn test_add_liquidity_identical_addresses() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // RED: Tokens idênticos devem falhar
            let result = router.add_liquidity(
                accounts.django, // token_a
                accounts.django, // token_b (igual ao A)
                100,             // amount_a_desired
                200,             // amount_b_desired
                90,              // amount_a_min
                180,             // amount_b_min
                accounts.alice,  // to
                2000,            // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::IdenticalAddresses);
        }

        #[ink::test]
        fn test_add_liquidity_rejects_zero_a_desired_before_pair_lookup() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let result = router.add_liquidity(
                accounts.django,
                accounts.eve,
                0,
                200,
                0,
                180,
                accounts.alice,
                2000,
            );

            assert_eq!(result, Err(RouterError::InsufficientAAmount));
        }

        #[ink::test]
        fn test_add_liquidity_rejects_desired_below_min_before_pair_lookup() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let result = router.add_liquidity(
                accounts.django,
                accounts.eve,
                100,
                200,
                150,
                180,
                accounts.alice,
                2000,
            );

            assert_eq!(result, Err(RouterError::InsufficientAAmount));
        }

        #[ink::test]
        fn test_add_liquidity_rejects_native_below_min_before_wrap() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);
            set_value_transferred(80);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let result =
                router.add_liquidity_native(accounts.django, 100, 90, 90, accounts.alice, 2000);

            assert_eq!(result, Err(RouterError::InsufficientBAmount));
        }

        #[ink::test]
        fn test_add_liquidity_native_rejects_wnative_pair_before_wrap() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);
            set_value_transferred(100);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let result = router.add_liquidity_native(
                accounts.charlie, // token equals WNATIVE
                100,
                90,
                90,
                accounts.alice,
                2000,
            );

            assert_eq!(result, Err(RouterError::IdenticalAddresses));
        }

        // ========================================
        // TESTES DE REMOVE LIQUIDITY
        // (Testes com cross-contract calls ignorados - requerem testes on-chain)
        // ========================================

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_remove_liquidity_success() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // GREEN: Remove liquidity com parâmetros válidos deve funcionar
            let result = router.remove_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                200,             // liquidity
                90,              // amount_a_min
                90,              // amount_b_min
                accounts.alice,  // to
                2000,            // deadline
            );

            assert!(result.is_ok());
            let (amount_a, amount_b) = result.unwrap();
            assert_eq!(amount_a, 100); // liquidity / 2
            assert_eq!(amount_b, 100); // liquidity / 2
        }

        #[ink::test]
        fn test_remove_liquidity_zero_liquidity() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // RED: Zero liquidity deve falhar
            let result = router.remove_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                0,               // liquidity (zero)
                90,              // amount_a_min
                90,              // amount_b_min
                accounts.alice,  // to
                2000,            // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientLiquidity);
        }

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_remove_liquidity_insufficient_b_amount() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            // RED: amount_b_min muito alto deve falhar
            let result = router.remove_liquidity(
                accounts.django, // token_a
                accounts.eve,    // token_b
                200,             // liquidity
                90,              // amount_a_min
                150,             // amount_b_min (muito alto)
                accounts.alice,  // to
                2000,            // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientBAmount);
        }

        // ========================================
        // TESTES DE SWAP EXACT TOKENS FOR TOKENS
        // (Testes com cross-contract calls ignorados - requerem testes on-chain)
        // ========================================

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_swap_exact_tokens_success() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // GREEN: Swap com parâmetros válidos deve funcionar
            let result = router.swap_exact_tokens_for_tokens(
                100,            // amount_in
                90,             // amount_out_min
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_ok());
            let amounts = result.unwrap();
            assert_eq!(amounts.len(), 2);
            assert_eq!(amounts[0], 100); // amount_in
            assert!(amounts[1] >= 90); // amount_out >= min
        }

        #[ink::test]
        fn test_swap_exact_tokens_zero_input() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // RED: Zero input deve falhar
            let result = router.swap_exact_tokens_for_tokens(
                0,              // amount_in (zero)
                90,             // amount_out_min
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientOutputAmount);
        }

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_swap_exact_tokens_insufficient_output() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // RED: amount_out_min muito alto deve falhar (slippage protection)
            let result = router.swap_exact_tokens_for_tokens(
                100,            // amount_in
                150,            // amount_out_min (muito alto)
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientOutputAmount);
        }

        #[ink::test]
        fn test_swap_exact_tokens_invalid_path() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django]; // Path muito curto

            // RED: Path inválido deve falhar
            let result = router.swap_exact_tokens_for_tokens(
                100,            // amount_in
                90,             // amount_out_min
                path,           // path (inválido)
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InvalidPath);
        }

        #[ink::test]
        fn test_swap_exact_native_rejects_short_path_before_wrap() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);
            set_value_transferred(100);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);
            let path = vec![accounts.charlie]; // WNATIVE only, no output token

            let result = router.swap_exact_native_for_tokens(90, path, accounts.alice, 2000);

            assert_eq!(result, Err(RouterError::InvalidPath));
        }

        #[ink::test]
        fn test_swap_exact_tokens_for_native_rejects_zero_input_before_pair_lookup() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);
            let path = vec![accounts.django, accounts.charlie];

            let result = router.swap_exact_tokens_for_native(0, 90, path, accounts.alice, 2000);

            assert_eq!(result, Err(RouterError::InsufficientOutputAmount));
        }

        // ========================================
        // TESTES DE SWAP TOKENS FOR EXACT TOKENS
        // (Testes com cross-contract calls ignorados - requerem testes on-chain)
        // ========================================

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_swap_tokens_for_exact_success() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // GREEN: Swap reverso com parâmetros válidos deve funcionar
            let result = router.swap_tokens_for_exact_tokens(
                100,            // amount_out
                110,            // amount_in_max
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_ok());
            let amounts = result.unwrap();
            assert_eq!(amounts.len(), 2);
            assert!(amounts[0] <= 110); // amount_in <= max
            assert_eq!(amounts[1], 100); // amount_out exato
        }

        #[ink::test]
        fn test_swap_tokens_for_exact_zero_output() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // RED: Zero output deve falhar
            let result = router.swap_tokens_for_exact_tokens(
                0,              // amount_out (zero)
                110,            // amount_in_max
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::InsufficientOutputAmount);
        }

        #[ink::test]
        fn test_swap_tokens_for_exact_rejects_zero_max_input_before_pair_lookup() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);
            let path = vec![accounts.django, accounts.eve];

            let result = router.swap_tokens_for_exact_tokens(100, 0, path, accounts.alice, 2000);

            assert_eq!(result, Err(RouterError::ExcessiveInputAmount));
        }

        #[ink::test]
        #[ignore] // Requer cross-contract call ao Factory/Pair
        fn test_swap_tokens_for_exact_excessive_input() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let path = vec![accounts.django, accounts.eve];

            // RED: amount_in_max muito baixo deve falhar (slippage protection)
            let result = router.swap_tokens_for_exact_tokens(
                100,            // amount_out
                90,             // amount_in_max (muito baixo)
                path,           // path
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::ExcessiveInputAmount);
        }

        // ========================================
        // TESTES DE VALIDAÇÃO DE PATH E EDGE CASES
        // ========================================

        #[ink::test]
        fn test_path_with_zero_address() {
            let accounts = default_accounts();
            set_sender(accounts.alice);
            set_timestamp(1000);

            let mut router = RouterContract::new(accounts.bob, accounts.charlie);

            let zero_address = AccountId::from([0u8; 32]);
            let path = vec![accounts.django, zero_address]; // Zero address no path

            // RED: Path com zero address deve falhar
            let result = router.swap_exact_tokens_for_tokens(
                100,            // amount_in
                90,             // amount_out_min
                path,           // path (com zero address)
                accounts.alice, // to
                2000,           // deadline
            );

            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), RouterError::ZeroAddress);
        }

        // ========================================
        // TESTES DE FUNÇÕES AMM
        // ========================================

        #[ink::test]
        fn test_get_amount_out_formula() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Teste da fórmula AMM: amount_out = (amount_in * fee * reserve_out) / (reserve_in * 1000 + amount_in * fee)
            // Com reserves 1000/1000 e input 100, fee 995/1000
            let result = router.get_amount_out(100, 1000, 1000);
            assert!(result.is_ok());
            // amount_out = (100 * 995 * 1000) / (1000 * 1000 + 100 * 995)
            // = 99500000 / 1099500 ≈ 90
            let amount_out = result.unwrap();
            assert!(amount_out > 0 && amount_out < 100); // Deve ser menor que input devido a fee

            // Teste com zero input
            let result = router.get_amount_out(0, 1000, 1000);
            assert!(result.is_err());

            // Teste com zero reserves
            let result = router.get_amount_out(100, 0, 1000);
            assert!(result.is_err());
        }

        #[ink::test]
        fn test_get_amount_in_formula() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Teste da fórmula reversa AMM
            let result = router.get_amount_in(90, 1000, 1000);
            assert!(result.is_ok());
            let amount_in = result.unwrap();
            assert!(amount_in > 90); // Deve ser maior que output devido a fee

            // Teste com zero output
            let result = router.get_amount_in(0, 1000, 1000);
            assert!(result.is_err());

            // Teste com output >= reserve_out
            let result = router.get_amount_in(1000, 1000, 1000);
            assert!(result.is_err());
        }

        #[ink::test]
        fn test_quote_function() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Quote: amount_a * reserve_b / reserve_a
            let result = router.quote(100, 1000, 2000);
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), 200); // 100 * 2000 / 1000 = 200

            // Zero amount
            let result = router.quote(0, 1000, 2000);
            assert!(result.is_err());

            // Zero reserves
            let result = router.quote(100, 0, 2000);
            assert!(result.is_err());
        }

        #[ink::test]
        fn test_sort_tokens() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Ordenação canônica
            let (token_0, token_1) = router.sort_tokens(accounts.bob, accounts.alice);
            assert!(token_0 < token_1);

            let (token_0_rev, token_1_rev) = router.sort_tokens(accounts.alice, accounts.bob);
            assert_eq!(token_0, token_0_rev);
            assert_eq!(token_1, token_1_rev);
        }

        // ========================================
        // TESTES DE TOKENS COM DECIMAIS DIFERENTES
        // ========================================
        //
        // IMPORTANTE: O modelo Uniswap V2 trabalha com raw values (valores brutos).
        // A conversão de decimais é responsabilidade do Frontend/SDK.
        //
        // Exemplo prático:
        // - USDC: 6 decimais (1 USDC = 1_000_000 raw)
        // - WETH: 18 decimais (1 WETH = 1_000_000_000_000_000_000 raw)
        //
        // Para parear 1 USDC com 0.0003 WETH:
        // - reserve_usdc = 1_000_000 (6 decimais)
        // - reserve_weth = 300_000_000_000_000 (18 decimais, = 0.0003 WETH)
        //
        // A fórmula AMM funciona corretamente com raw values.

        #[ink::test]
        fn test_swap_different_decimals_6_vs_18() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Simula USDC (6 decimais) vs WETH (18 decimais)
            // Preço: 1 WETH = 3000 USDC
            // reserve_usdc = 3000 USDC = 3_000_000_000 (6 decimais)
            // reserve_weth = 1 WETH = 1_000_000_000_000_000_000 (18 decimais)
            let reserve_usdc: u128 = 3_000_000_000; // 3000 USDC
            let reserve_weth: u128 = 1_000_000_000_000_000_000; // 1 WETH

            // Swap 100 USDC por WETH
            let amount_in: u128 = 100_000_000; // 100 USDC (6 decimais)

            let result = router.get_amount_out(amount_in, reserve_usdc, reserve_weth);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // Esperado: ~0.033 WETH (100/3000 * 1 WETH, menos fee)
            // Em raw: ~33_000_000_000_000_000 (18 decimais)
            assert!(amount_out > 0);
            assert!(amount_out < reserve_weth); // Não pode exceder reserve

            // Validar que o cálculo está na ordem de magnitude correta
            // 100 USDC deveria dar aproximadamente 0.033 WETH
            let expected_min: u128 = 30_000_000_000_000_000; // 0.03 WETH
            let expected_max: u128 = 35_000_000_000_000_000; // 0.035 WETH
            assert!(amount_out >= expected_min && amount_out <= expected_max);
        }

        #[ink::test]
        fn test_swap_different_decimals_8_vs_18() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Simula LUNES (8 decimais) vs WETH (18 decimais)
            // Preço: 1 WETH = 10000 LUNES
            // reserve_lunes = 10000 LUNES = 1_000_000_000_000 (8 decimais)
            // reserve_weth = 1 WETH = 1_000_000_000_000_000_000 (18 decimais)
            let reserve_lunes: u128 = 1_000_000_000_000; // 10000 LUNES
            let reserve_weth: u128 = 1_000_000_000_000_000_000; // 1 WETH

            // Swap 500 LUNES por WETH
            let amount_in: u128 = 50_000_000_000; // 500 LUNES (8 decimais)

            let result = router.get_amount_out(amount_in, reserve_lunes, reserve_weth);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // Esperado: ~0.05 WETH (500/10000 * 1 WETH, menos fee)
            assert!(amount_out > 0);

            // Validar ordem de magnitude
            let expected_min: u128 = 45_000_000_000_000_000; // 0.045 WETH
            let expected_max: u128 = 50_000_000_000_000_000; // 0.05 WETH
            assert!(amount_out >= expected_min && amount_out <= expected_max);
        }

        #[ink::test]
        fn test_quote_different_decimals() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Quote para adicionar liquidez: USDC (6) vs WETH (18)
            // Se já existe 3000 USDC : 1 WETH no pool
            // E quero adicionar 100 USDC, quanto WETH preciso?
            let reserve_usdc: u128 = 3_000_000_000; // 3000 USDC
            let reserve_weth: u128 = 1_000_000_000_000_000_000; // 1 WETH
            let amount_usdc: u128 = 100_000_000; // 100 USDC

            let result = router.quote(amount_usdc, reserve_usdc, reserve_weth);
            assert!(result.is_ok());

            let amount_weth = result.unwrap();
            // 100 USDC / 3000 USDC * 1 WETH = 0.0333... WETH
            let expected: u128 = 33_333_333_333_333_333; // ~0.0333 WETH
            assert_eq!(amount_weth, expected);
        }

        #[ink::test]
        fn test_swap_decimals_0_indivisible_token() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Token com 0 decimais (como NEO) vs token com 18 decimais
            // NEO é indivisível - 1 NEO = 1 raw
            let reserve_neo: u128 = 100; // 100 NEO (0 decimais)
            let reserve_eth: u128 = 10_000_000_000_000_000_000; // 10 ETH (18 decimais)

            // Swap 1 NEO por ETH
            let amount_in: u128 = 1; // 1 NEO

            let result = router.get_amount_out(amount_in, reserve_neo, reserve_eth);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // 1 NEO deveria dar ~0.1 ETH (menos fee)
            // ~0.099 ETH = 99_000_000_000_000_000
            assert!(amount_out > 90_000_000_000_000_000);
            assert!(amount_out < 100_000_000_000_000_000);
        }

        #[ink::test]
        fn test_swap_decimals_9_solana() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // SOL (9 decimais) vs USDC (6 decimais)
            // Preço: 1 SOL = 150 USDC
            let reserve_sol: u128 = 1_000_000_000_000; // 1000 SOL (9 decimais)
            let reserve_usdc: u128 = 150_000_000_000; // 150000 USDC (6 decimais)

            // Swap 1 SOL por USDC
            let amount_in: u128 = 1_000_000_000; // 1 SOL (9 decimais)

            let result = router.get_amount_out(amount_in, reserve_sol, reserve_usdc);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // 1 SOL deveria dar ~150 USDC (menos fee)
            // ~149 USDC = 149_000_000 (6 decimais)
            assert!(amount_out > 145_000_000); // > 145 USDC
            assert!(amount_out < 150_000_000); // < 150 USDC
        }

        #[ink::test]
        fn test_swap_decimals_8_bitcoin() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // BTC (8 decimais - satoshis) vs USDT (6 decimais)
            // Preço: 1 BTC = 100000 USDT
            let reserve_btc: u128 = 10_00000000; // 10 BTC (8 decimais)
            let reserve_usdt: u128 = 1_000_000_000_000; // 1M USDT (6 decimais)

            // Swap 0.01 BTC por USDT
            let amount_in: u128 = 1_000_000; // 0.01 BTC (8 decimais)

            let result = router.get_amount_out(amount_in, reserve_btc, reserve_usdt);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // 0.01 BTC deveria dar ~1000 USDT (menos fee)
            // ~995 USDT = 995_000_000 (6 decimais)
            assert!(amount_out > 990_000_000); // > 990 USDT
            assert!(amount_out < 1_000_000_000); // < 1000 USDT
        }

        #[ink::test]
        fn test_swap_extreme_decimal_difference_0_vs_18() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Caso extremo: Token com 0 decimais vs 18 decimais
            // Isso testa a precisão máxima do sistema
            let reserve_a: u128 = 1000; // 1000 tokens (0 decimais)
            let reserve_b: u128 = 1000_000_000_000_000_000_000; // 1000 tokens (18 decimais)

            // Swap 1 token A
            let amount_in: u128 = 1;

            let result = router.get_amount_out(amount_in, reserve_a, reserve_b);
            assert!(result.is_ok());

            let amount_out = result.unwrap();
            // Deve retornar aproximadamente 1 token B (menos fee 0.5%)
            // ~0.995 tokens B = 995_000_000_000_000_000
            assert!(amount_out > 900_000_000_000_000_000);
            assert!(amount_out < 1_000_000_000_000_000_000);
        }

        #[ink::test]
        fn test_get_amount_in_different_decimals() {
            let accounts = default_accounts();
            let router = RouterContract::new(accounts.bob, accounts.charlie);

            // Quero receber exatamente 0.01 WETH, quanto USDC preciso?
            // USDC (6 decimais) vs WETH (18 decimais)
            let reserve_usdc: u128 = 3_000_000_000; // 3000 USDC
            let reserve_weth: u128 = 1_000_000_000_000_000_000; // 1 WETH
            let amount_out: u128 = 10_000_000_000_000_000; // 0.01 WETH

            let result = router.get_amount_in(amount_out, reserve_usdc, reserve_weth);
            assert!(result.is_ok());

            let amount_in = result.unwrap();
            // Para receber 0.01 WETH (1% do pool), preciso ~30 USDC + fee
            // ~30.15 USDC = 30_150_000 (6 decimais)
            assert!(amount_in > 30_000_000); // Mais que 30 USDC
            assert!(amount_in < 32_000_000); // Menos que 32 USDC
        }
    }
}
