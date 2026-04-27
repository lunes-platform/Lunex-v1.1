#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(unexpected_cfgs)]
#![allow(clippy::cast_possible_truncation)]

/// PSP22 Token — Mintable test token for Lunex DEX local testnet.
///
/// Uses the same PSP22 selectors as the wnative contract so the
/// router and pair contracts can interact with it transparently.
///
/// Constructor mints `initial_supply` to the deployer.
/// The owner (deployer) can call `mint` to issue more tokens.
#[ink::contract]
pub mod psp22_token {
    use ink::prelude::string::String;
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    // ── Events ──────────────────────────────────────────────────

    #[ink(event)]
    pub struct Transfer {
        #[ink(topic)]
        pub from: Option<AccountId>,
        #[ink(topic)]
        pub to: Option<AccountId>,
        pub value: Balance,
    }

    #[ink(event)]
    pub struct Approval {
        #[ink(topic)]
        pub owner: AccountId,
        #[ink(topic)]
        pub spender: AccountId,
        pub value: Balance,
    }

    // ── Errors ───────────────────────────────────────────────────

    #[derive(Debug, PartialEq, Eq, scale::Encode, scale::Decode)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum PSP22Error {
        InsufficientBalance,
        InsufficientAllowance,
        ZeroAmount,
        SelfTransfer,
        Overflow,
        NotOwner,
    }

    // ── Storage ──────────────────────────────────────────────────

    #[ink(storage)]
    pub struct PSP22Token {
        owner: AccountId,
        total_supply: Balance,
        balances: Mapping<AccountId, Balance>,
        allowances: Mapping<(AccountId, AccountId), Balance>,
        name: Option<String>,
        symbol: Option<String>,
        decimals: u8,
    }

    impl PSP22Token {
        /// Deploy a new PSP22 token.
        ///
        /// - `initial_supply`: minted to the deployer.
        /// - `decimals`: e.g. 6 for LUSDT, 8 for LBTC.
        #[ink(constructor)]
        pub fn new(
            name: Option<String>,
            symbol: Option<String>,
            decimals: u8,
            initial_supply: Balance,
        ) -> Self {
            let caller = Self::env().caller();
            let mut balances = Mapping::new();
            if initial_supply > 0 {
                balances.insert(caller, &initial_supply);
            }
            Self {
                owner: caller,
                total_supply: initial_supply,
                balances,
                allowances: Mapping::new(),
                name,
                symbol,
                decimals,
            }
        }

        // ── PSP22 Queries ────────────────────────────────────────

        #[ink(message)]
        pub fn total_supply(&self) -> Balance {
            self.total_supply
        }

        /// PSP22 selector: 0x6568382f
        #[ink(message, selector = 0x6568382f)]
        pub fn balance_of(&self, owner: AccountId) -> Balance {
            self.balances.get(owner).unwrap_or(0)
        }

        /// PSP22 selector: 0x4d47d921
        #[ink(message, selector = 0x4d47d921)]
        pub fn allowance(&self, owner: AccountId, spender: AccountId) -> Balance {
            self.allowances.get((owner, spender)).unwrap_or(0)
        }

        #[ink(message)]
        pub fn token_name(&self) -> Option<String> {
            self.name.clone()
        }

        #[ink(message)]
        pub fn token_symbol(&self) -> Option<String> {
            self.symbol.clone()
        }

        #[ink(message)]
        pub fn token_decimals(&self) -> u8 {
            self.decimals
        }

        #[ink(message)]
        pub fn owner(&self) -> AccountId {
            self.owner
        }

        // ── PSP22 Mutations ──────────────────────────────────────

        /// PSP22 selector: 0xdb20f9f5
        #[ink(message, selector = 0xdb20f9f5)]
        pub fn transfer(
            &mut self,
            to: AccountId,
            value: Balance,
            _data: Vec<u8>,
        ) -> Result<(), PSP22Error> {
            let from = self.env().caller();
            self._transfer(from, to, value)
        }

        /// PSP22 selector: 0x54b3c76e
        #[ink(message, selector = 0x54b3c76e)]
        pub fn transfer_from(
            &mut self,
            from: AccountId,
            to: AccountId,
            value: Balance,
            _data: Vec<u8>,
        ) -> Result<(), PSP22Error> {
            let spender = self.env().caller();
            let current = self.allowance(from, spender);
            if current < value {
                return Err(PSP22Error::InsufficientAllowance);
            }
            let new_allowance = current
                .checked_sub(value)
                .ok_or(PSP22Error::InsufficientAllowance)?;

            self._transfer(from, to, value)?;
            self.allowances.insert((from, spender), &new_allowance);
            Ok(())
        }

        /// PSP22 selector: 0xb20f1bbd
        #[ink(message, selector = 0xb20f1bbd)]
        pub fn approve(&mut self, spender: AccountId, value: Balance) -> Result<(), PSP22Error> {
            let owner = self.env().caller();
            if owner == spender {
                return Err(PSP22Error::SelfTransfer);
            }
            self.allowances.insert((owner, spender), &value);
            self.env().emit_event(Approval {
                owner,
                spender,
                value,
            });
            Ok(())
        }

        // ── Owner-only: Mint ─────────────────────────────────────

        /// Mint `amount` tokens to `to`. Only callable by the contract owner.
        /// Used on the local testnet to fund test accounts.
        #[ink(message)]
        pub fn mint(&mut self, to: AccountId, amount: Balance) -> Result<(), PSP22Error> {
            if self.env().caller() != self.owner {
                return Err(PSP22Error::NotOwner);
            }
            self._mint(to, amount)
        }

        // ── Internals ────────────────────────────────────────────

        fn _transfer(
            &mut self,
            from: AccountId,
            to: AccountId,
            value: Balance,
        ) -> Result<(), PSP22Error> {
            if from == to {
                return Err(PSP22Error::SelfTransfer);
            }
            if value == 0 {
                return Ok(());
            }
            let from_bal = self.balance_of(from);
            if from_bal < value {
                return Err(PSP22Error::InsufficientBalance);
            }
            self.balances.insert(
                from,
                &from_bal
                    .checked_sub(value)
                    .ok_or(PSP22Error::InsufficientBalance)?,
            );
            let to_bal = self.balance_of(to);
            self.balances
                .insert(to, &to_bal.checked_add(value).ok_or(PSP22Error::Overflow)?);
            self.env().emit_event(Transfer {
                from: Some(from),
                to: Some(to),
                value,
            });
            Ok(())
        }

        fn _mint(&mut self, to: AccountId, value: Balance) -> Result<(), PSP22Error> {
            if value == 0 {
                return Ok(());
            }
            self.total_supply = self
                .total_supply
                .checked_add(value)
                .ok_or(PSP22Error::Overflow)?;
            let to_bal = self.balance_of(to);
            self.balances
                .insert(to, &to_bal.checked_add(value).ok_or(PSP22Error::Overflow)?);
            self.env().emit_event(Transfer {
                from: None,
                to: Some(to),
                value,
            });
            Ok(())
        }
    }

    // ── Unit tests ────────────────────────────────────────────────

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::DefaultEnvironment;

        fn accounts() -> ink::env::test::DefaultAccounts<DefaultEnvironment> {
            ink::env::test::default_accounts::<DefaultEnvironment>()
        }

        fn set_sender(a: AccountId) {
            ink::env::test::set_caller::<DefaultEnvironment>(a);
        }

        #[ink::test]
        fn initial_supply_goes_to_deployer() {
            let accs = accounts();
            set_sender(accs.alice);
            let token = PSP22Token::new(
                Some("Test USD".into()),
                Some("TUSDT".into()),
                6,
                1_000_000_000_000,
            );
            assert_eq!(token.balance_of(accs.alice), 1_000_000_000_000);
            assert_eq!(token.total_supply(), 1_000_000_000_000);
        }

        #[ink::test]
        fn mint_by_owner_works() {
            let accs = accounts();
            set_sender(accs.alice);
            let mut token = PSP22Token::new(None, None, 6, 0);
            assert!(token.mint(accs.bob, 500_000).is_ok());
            assert_eq!(token.balance_of(accs.bob), 500_000);
        }

        #[ink::test]
        fn mint_by_non_owner_fails() {
            let accs = accounts();
            set_sender(accs.alice);
            let mut token = PSP22Token::new(None, None, 6, 0);
            set_sender(accs.bob);
            assert_eq!(token.mint(accs.bob, 100), Err(PSP22Error::NotOwner));
        }

        #[ink::test]
        fn transfer_works() {
            let accs = accounts();
            set_sender(accs.alice);
            let mut token = PSP22Token::new(None, None, 6, 1000);
            assert!(token.transfer(accs.bob, 400, vec![]).is_ok());
            assert_eq!(token.balance_of(accs.alice), 600);
            assert_eq!(token.balance_of(accs.bob), 400);
        }

        #[ink::test]
        fn approve_and_transfer_from_works() {
            let accs = accounts();
            set_sender(accs.alice);
            let mut token = PSP22Token::new(None, None, 6, 1000);
            assert!(token.approve(accs.bob, 300).is_ok());
            set_sender(accs.bob);
            assert!(token
                .transfer_from(accs.alice, accs.charlie, 200, vec![])
                .is_ok());
            assert_eq!(token.balance_of(accs.alice), 800);
            assert_eq!(token.balance_of(accs.charlie), 200);
            assert_eq!(token.allowance(accs.alice, accs.bob), 100);
        }

        #[ink::test]
        fn failed_transfer_from_does_not_consume_allowance() {
            let accs = accounts();
            set_sender(accs.alice);
            let mut token = PSP22Token::new(None, None, 6, 100);
            assert!(token.approve(accs.bob, 500).is_ok());

            set_sender(accs.bob);
            let result = token.transfer_from(accs.alice, accs.charlie, 200, vec![]);

            assert_eq!(result, Err(PSP22Error::InsufficientBalance));
            assert_eq!(token.balance_of(accs.alice), 100);
            assert_eq!(token.balance_of(accs.charlie), 0);
            assert_eq!(token.allowance(accs.alice, accs.bob), 500);
        }
    }
}
