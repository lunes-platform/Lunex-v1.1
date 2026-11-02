/**
 * Centralized contract address configuration.
 *
 * All contract addresses should be imported from here,
 * NOT scattered across individual components/pages.
 *
 * Missing addresses stay empty so production builds cannot silently target
 * stale test deployments.
 */

// ─── Core Protocol Contracts ─────────────────────────────────────
// Vite replaces explicit public env accesses at build time. Dynamic
// process.env[key] reads become an empty object in the production bundle.
export const CONTRACTS = {
  FACTORY: process.env.REACT_APP_FACTORY_CONTRACT || '',
  ROUTER: process.env.REACT_APP_ROUTER_CONTRACT || '',
  WNATIVE: process.env.REACT_APP_WNATIVE_CONTRACT || '',
  STAKING: process.env.REACT_APP_STAKING_CONTRACT || '',
  REWARDS: process.env.REACT_APP_REWARDS_CONTRACT || '',
  COPY_VAULT: process.env.REACT_APP_COPY_VAULT_CONTRACT || ''
} as const

// ─── Token Addresses ─────────────────────────────────────────────
export const TOKENS = {
  WLUNES: process.env.REACT_APP_TOKEN_WLUNES || '',
  LUSDT: process.env.REACT_APP_TOKEN_LUSDT || '',
  LBTC: process.env.REACT_APP_TOKEN_LBTC || '',
  LETH: process.env.REACT_APP_TOKEN_LETH || '',
  GMC: process.env.REACT_APP_TOKEN_GMC || '',
  LUP: process.env.REACT_APP_TOKEN_LUP || ''
} as const

// ─── Network Configuration ──────────────────────────────────────
export const NETWORK = {
  name: (process.env.REACT_APP_NETWORK || 'testnet') as 'testnet' | 'mainnet',
  rpc: {
    testnet: process.env.REACT_APP_RPC_TESTNET || 'wss://ws-test.lunes.io',
    mainnet: process.env.REACT_APP_RPC_MAINNET || 'wss://ws.lunes.io'
  }
} as const

// ─── Token Precision ──────────────────────────────────────────────
/** Número de casas decimais do token LP emitido pelo contrato pair. */
export const LP_TOKEN_DECIMALS = 8
