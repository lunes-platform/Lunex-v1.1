/**
 * Centralized contract address configuration.
 *
 * All contract addresses should be imported from here,
 * NOT scattered across individual components/pages.
 *
 * Missing addresses stay empty so production builds cannot silently target
 * stale test deployments.
 */

const env = (key: string) => process.env[key] || ''

// ─── Core Protocol Contracts ─────────────────────────────────────
export const CONTRACTS = {
  FACTORY: env('REACT_APP_FACTORY_CONTRACT'),
  ROUTER: env('REACT_APP_ROUTER_CONTRACT'),
  WNATIVE: env('REACT_APP_WNATIVE_CONTRACT'),
  STAKING: env('REACT_APP_STAKING_CONTRACT'),
  REWARDS: env('REACT_APP_REWARDS_CONTRACT'),
  COPY_VAULT: env('REACT_APP_COPY_VAULT_CONTRACT')
} as const

// ─── Token Addresses ─────────────────────────────────────────────
export const TOKENS = {
  WLUNES: env('REACT_APP_TOKEN_WLUNES'),
  LUSDT: env('REACT_APP_TOKEN_LUSDT'),
  LBTC: env('REACT_APP_TOKEN_LBTC'),
  LETH: env('REACT_APP_TOKEN_LETH'),
  GMC: env('REACT_APP_TOKEN_GMC'),
  LUP: env('REACT_APP_TOKEN_LUP')
} as const

// ─── Network Configuration ──────────────────────────────────────
export const NETWORK = {
  name: (process.env.REACT_APP_NETWORK || 'testnet') as 'testnet' | 'mainnet',
  rpc: {
    testnet: process.env.REACT_APP_RPC_TESTNET || 'wss://ws-test.lunes.io',
    mainnet: process.env.REACT_APP_RPC_MAINNET || 'wss://ws.lunes.io'
  }
} as const
