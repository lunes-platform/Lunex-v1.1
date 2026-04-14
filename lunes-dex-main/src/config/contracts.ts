/**
 * Centralized contract address configuration.
 *
 * All contract addresses should be imported from here,
 * NOT scattered across individual components/pages.
 *
 * Environment variables override defaults.
 */

const env = (key: string, fallback: string) => process.env[key] || fallback

// ─── Core Protocol Contracts ─────────────────────────────────────
export const CONTRACTS = {
  FACTORY: env(
    'REACT_APP_FACTORY_CONTRACT',
    '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2'
  ),
  ROUTER: env(
    'REACT_APP_ROUTER_CONTRACT',
    '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B'
  ),
  WNATIVE: env(
    'REACT_APP_WNATIVE_CONTRACT',
    '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'
  ),
  STAKING: env('REACT_APP_STAKING_CONTRACT', ''),
  REWARDS: env('REACT_APP_REWARDS_CONTRACT', ''),
  COPY_VAULT: env('REACT_APP_COPY_VAULT_CONTRACT', '')
} as const

// ─── Token Addresses ─────────────────────────────────────────────
export const TOKENS = {
  WLUNES: env(
    'REACT_APP_TOKEN_WLUNES',
    '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'
  ),
  LUSDT: env(
    'REACT_APP_TOKEN_LUSDT',
    '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'
  ),
  LBTC: env(
    'REACT_APP_TOKEN_LBTC',
    '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg'
  ),
  LETH: env(
    'REACT_APP_TOKEN_LETH',
    '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS'
  ),
  GMC: env(
    'REACT_APP_TOKEN_GMC',
    '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ'
  ),
  LUP: env(
    'REACT_APP_TOKEN_LUP',
    '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3'
  )
} as const

// ─── Network Configuration ──────────────────────────────────────
export const NETWORK = {
  name: env('REACT_APP_NETWORK', 'testnet') as 'testnet' | 'mainnet',
  rpc: {
    testnet: env('REACT_APP_RPC_TESTNET', 'wss://ws-test.lunes.io'),
    mainnet: env('REACT_APP_RPC_MAINNET', 'wss://ws.lunes.io')
  }
} as const
