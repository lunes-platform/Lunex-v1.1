import { LUNES_TOKEN } from '../../../../utils/nativeToken'

const TOKEN_ADDRESSES = {
  WLUNES:
    process.env.REACT_APP_TOKEN_WLUNES ||
    process.env.REACT_APP_WNATIVE_CONTRACT ||
    '',
  LUSDT: process.env.REACT_APP_TOKEN_LUSDT || '',
  LBTC: process.env.REACT_APP_TOKEN_LBTC || '',
  LETH: process.env.REACT_APP_TOKEN_LETH || '',
  GMC: process.env.REACT_APP_TOKEN_GMC || '',
  LUP: process.env.REACT_APP_TOKEN_LUP || ''
}

export interface Token {
  id: number
  icon: string
  acronym: string
  token: string
  tokenPrice: string
  address: string
  decimals: number
  isNative?: boolean
}

const allTokens: Token[] = [
  {
    id: 0,
    icon: '/img/lunes-green.svg',
    acronym: 'WLUNES',
    token: 'Wrapped Lunes',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.WLUNES,
    decimals: 8,
    isNative: false
  },
  {
    id: 1,
    icon: '/img/lusdt.svg',
    acronym: 'LUSDT',
    token: 'Lunes USD Tether',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.LUSDT,
    decimals: 6
  },
  {
    id: 2,
    icon: '/img/lbtc.svg',
    acronym: 'LBTC',
    token: 'Lunes Bitcoin',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.LBTC,
    decimals: 8
  },
  {
    id: 3,
    icon: '/img/leth.svg',
    acronym: 'LETH',
    token: 'Lunes Ethereum',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.LETH,
    decimals: 8
  },
  {
    id: 4,
    icon: '/img/gmc.svg',
    acronym: 'GMC',
    token: 'Game Coin',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.GMC,
    decimals: 8
  },
  {
    id: 5,
    icon: '/img/up.svg',
    acronym: 'LUP',
    token: 'Lunes UP',
    tokenPrice: 'Unavailable',
    address: TOKEN_ADDRESSES.LUP,
    decimals: 8
  }
]

// Token sem endereço configurado no env não pode aparecer na UI: selecioná-lo
// produziria queries/aprovações contra address vazio, falhando de forma
// confusa. Filtrar aqui é fail-closed e o warn aponta a env var que falta.
const configuredTokens: Token[] = allTokens.filter((t) => {
  if (t.address) return true
  console.warn(
    `[tokenRegistry] ${t.acronym} sem endereço configurado (REACT_APP_TOKEN_${t.acronym}) — removido da lista de tokens`
  )
  return false
})

// Market-standard native/wrapped UX (ETH/WETH on Uniswap): the native coin
// (LUNES) is the primary, default-listed asset; the wrapped token (WLUNES) is
// hidden from the default list but stays reachable via search so Wrap/Unwrap
// and Spot funding remain possible.
const isWlunesEntry = (t: Token): boolean =>
  t.acronym.toUpperCase() === 'WLUNES'

/** Default selectable list: native LUNES first, WLUNES omitted. */
const tokens: Token[] = [
  LUNES_TOKEN,
  ...configuredTokens.filter((t) => !isWlunesEntry(t))
]

/** Full list including WLUNES — used by the token selector's search so the
 *  wrapped token can still be found and selected when explicitly searched. */
export const searchableTokens: Token[] = [
  LUNES_TOKEN,
  ...configuredTokens.filter((t) => !isWlunesEntry(t)),
  ...configuredTokens.filter(isWlunesEntry)
]

export default tokens
