/**
 * Centralized contract address configuration.
 *
 * All contract addresses should be imported from here,
 * NOT scattered across individual components/pages.
 *
 * Missing addresses stay empty so production builds cannot silently target
 * stale test deployments.
 */

// Vite only replaces `process.env.REACT_APP_*` when the variable is defined
// at build time; an undefined one would throw ReferenceError in the browser,
// so optional vars added for the spot beta are read defensively.
const readSpotSettlementContract = (): string => {
  try {
    return process.env.REACT_APP_SPOT_SETTLEMENT_CONTRACT || ''
  } catch {
    return ''
  }
}
const readMarginFlag = (): string => {
  try {
    return process.env.REACT_APP_FEATURE_MARGIN || ''
  } catch {
    return ''
  }
}

// ─── Core Protocol Contracts ─────────────────────────────────────
// Vite replaces explicit public env accesses at build time. Dynamic
// process.env[key] reads become an empty object in the production bundle.
export const CONTRACTS = {
  FACTORY: process.env.REACT_APP_FACTORY_CONTRACT || '',
  ROUTER: process.env.REACT_APP_ROUTER_CONTRACT || '',
  WNATIVE: process.env.REACT_APP_WNATIVE_CONTRACT || '',
  STAKING: process.env.REACT_APP_STAKING_CONTRACT || '',
  REWARDS: process.env.REACT_APP_REWARDS_CONTRACT || '',
  COPY_VAULT: process.env.REACT_APP_COPY_VAULT_CONTRACT || '',
  /** ListingManager (list_token). Empty = on-chain listing disabled. */
  LISTING_MANAGER: process.env.REACT_APP_LISTING_MANAGER_CONTRACT || '',
  /**
   * Fallback only: the page reads the fee token from ListingManager
   * `lunes_token()`. Used before that read resolves. Empty = WLUNES.
   */
  LISTING_FEE_TOKEN: process.env.REACT_APP_LISTING_FEE_TOKEN || '',
  /**
   * spot_settlement vault (spot orderbook custody). Empty = vault panel
   * disabled. Must equal the contract spot-api settles against
   * (GET /api/v1/balances/settlement) or deposits stay blocked.
   */
  SPOT_SETTLEMENT: readSpotSettlementContract()
} as const

// ─── Feature Flags ───────────────────────────────────────────────
export const FEATURES = {
  /**
   * Margin tab in the spot order form. Off by default: margin collateral is
   * still DB-only (not backed by vault balances), so it is hidden for beta.
   */
  MARGIN: readMarginFlag() === 'true'
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
