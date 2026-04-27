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

const tokens: Token[] = [
  {
    id: 0,
    icon: '/img/lunes-green.svg',
    acronym: 'WLUNES',
    token: 'Wrapped Lunes',
    tokenPrice: '$ 0.00',
    address: TOKEN_ADDRESSES.WLUNES,
    decimals: 8,
    isNative: false
  },
  {
    id: 1,
    icon: '/img/lusdt.svg',
    acronym: 'LUSDT',
    token: 'Lunes USD Tether',
    tokenPrice: '$ 1.00',
    address: TOKEN_ADDRESSES.LUSDT,
    decimals: 6
  },
  {
    id: 2,
    icon: '/img/lbtc.svg',
    acronym: 'LBTC',
    token: 'Lunes Bitcoin',
    tokenPrice: '$ 0.00',
    address: TOKEN_ADDRESSES.LBTC,
    decimals: 8
  },
  {
    id: 3,
    icon: '/img/leth.svg',
    acronym: 'LETH',
    token: 'Lunes Ethereum',
    tokenPrice: '$ 0.00',
    address: TOKEN_ADDRESSES.LETH,
    decimals: 8
  },
  {
    id: 4,
    icon: '/img/gmc.svg',
    acronym: 'GMC',
    token: 'Game Coin',
    tokenPrice: '$ 0.00',
    address: TOKEN_ADDRESSES.GMC,
    decimals: 8
  },
  {
    id: 5,
    icon: '/img/up.svg',
    acronym: 'LUP',
    token: 'Lunes UP',
    tokenPrice: '$ 0.00',
    address: TOKEN_ADDRESSES.LUP,
    decimals: 8
  }
]

export default tokens
