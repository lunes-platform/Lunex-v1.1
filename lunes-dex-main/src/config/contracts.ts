/**
 * Centralized contract address configuration.
 *
 * All contract addresses should be imported from here,
 * NOT scattered across individual components/pages.
 *
 * Environment variables override defaults.
 */

const env = (key: string, fallback: string) =>
    process.env[key] || fallback

// ─── Core Protocol Contracts ─────────────────────────────────────
export const CONTRACTS = {
    FACTORY: env('REACT_APP_FACTORY_CONTRACT', '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2'),
    ROUTER: env('REACT_APP_ROUTER_CONTRACT', '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B'),
    WNATIVE: env('REACT_APP_WNATIVE_CONTRACT', '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'),
    STAKING: env('REACT_APP_STAKING_CONTRACT', ''),
    REWARDS: env('REACT_APP_REWARDS_CONTRACT', ''),
    COPY_VAULT: env('REACT_APP_COPY_VAULT_CONTRACT', ''),
} as const

// ─── Token Addresses ─────────────────────────────────────────────
export const TOKENS = {
    WLUNES: env('REACT_APP_TOKEN_WLUNES', '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'),
    LUSDT: env('REACT_APP_TOKEN_LUSDT', '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'),
    LBTC: env('REACT_APP_TOKEN_LBTC', '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg'),
    LETH: env('REACT_APP_TOKEN_LETH', '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS'),
    GMC: env('REACT_APP_TOKEN_GMC', '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ'),
    LUP: env('REACT_APP_TOKEN_LUP', '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3'),
} as const

// ─── Token Metadata ──────────────────────────────────────────────
export interface TokenMeta {
    address: string
    symbol: string
    name: string
    decimals: number
    icon: string
}

export const TOKEN_LIST: TokenMeta[] = [
    { address: TOKENS.WLUNES, symbol: 'WLUNES', name: 'Wrapped Lunes', decimals: 8, icon: '/img/lunes.svg' },
    { address: TOKENS.LUSDT, symbol: 'LUSDT', name: 'Lunes USD', decimals: 6, icon: '/img/lusdt.svg' },
    { address: TOKENS.LBTC, symbol: 'LBTC', name: 'Lunes BTC', decimals: 8, icon: '/img/lbtc.svg' },
    { address: TOKENS.LETH, symbol: 'LETH', name: 'Lunes ETH', decimals: 8, icon: '/img/leth.svg' },
    { address: TOKENS.GMC, symbol: 'GMC', name: 'GameCoin', decimals: 8, icon: '/img/gmc.svg' },
    { address: TOKENS.LUP, symbol: 'LUP', name: 'Lunex Protocol', decimals: 8, icon: '/img/lup.svg' },
]

// ─── Network Configuration ──────────────────────────────────────
export const NETWORK = {
    name: (env('REACT_APP_NETWORK', 'testnet') as 'testnet' | 'mainnet'),
    rpc: {
        testnet: env('REACT_APP_RPC_TESTNET', 'wss://ws-test.lunes.io'),
        mainnet: env('REACT_APP_RPC_MAINNET', 'wss://ws.lunes.io'),
    },
} as const

// ─── API Configuration ──────────────────────────────────────────
export const API = {
    SPOT: env('REACT_APP_SPOT_API_URL', 'http://localhost:4000'),
    SPOT_WS: env('REACT_APP_SPOT_WS_URL', 'ws://localhost:4001'),
    ADMIN: env('REACT_APP_API_URL', 'http://localhost:3002'),
} as const

// ─── Quote Token ─────────────────────────────────────────────────
export const QUOTE_TOKEN = TOKENS.LUSDT
