/**
 * Static content for the landing page (copy, icons, illustration geometry).
 *
 * No financial figure lives here (P0-8 / BR regulatory note): token prices,
 * 24h changes, TVL and volume come from live sources in `useLandingMarket`
 * (spot-api tickers + on-chain pool reserves via usePools) and render "—"
 * when a source is unavailable. Only protocol constants enforced by the
 * contracts (the 0.5% swap fee and its split) are static.
 */

export type Token = {
  sym: string
  name: string
  icon: string
}

/** Token metadata only — prices are live (see useLandingMarket). */
export const TOKENS: Token[] = [
  { sym: 'WLUNES', name: 'Wrapped Lunes', icon: '/img/lunes-green.svg' },
  { sym: 'LUSDT', name: 'Lunes USD Tether', icon: '/img/lusdt.png' },
  { sym: 'LBTC', name: 'Lunes Bitcoin', icon: '/img/lbtc.svg' },
  { sym: 'LETH', name: 'Lunes Ethereum', icon: '/img/leth.svg' },
  { sym: 'LUP', name: 'Lunes UP', icon: '/img/up.svg' },
  { sym: 'GMC', name: 'Game Coin', icon: '/img/gmc.svg' }
]

export const NO_DATA = '—'

export const fmtPrice = (p: number | null | undefined) =>
  p == null || !Number.isFinite(p) || p <= 0
    ? NO_DATA
    : '$' +
      (p >= 1000
        ? p.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : p >= 1
          ? p.toFixed(2)
          : p.toPrecision(4))

export const fmtChg = (c: number | null | undefined) =>
  c == null || !Number.isFinite(c) ? '' : (c > 0 ? '+' : '') + c.toFixed(2) + '%'
export const chgColor = (c: number | null | undefined) =>
  (c ?? 0) >= 0 ? '#26D07C' : '#FF5D69'

export type StatFmt = 'm' | 'k' | 'pct' | 'int' | 'usd'
export type StatKey = 'tvl' | 'volume24h' | 'activePools' | 'swapFee'
export type StatDef = {
  key: StatKey
  label: string
  fmt: StatFmt
  sub: string
  subColor: string
}

/** Stat band. Values are supplied live; `swapFee` is the Pair-contract constant. */
export const STAT_DEFS: StatDef[] = [
  {
    key: 'tvl',
    label: 'Total value locked',
    fmt: 'usd',
    sub: 'LUSDT-paired pools, on-chain reserves',
    subColor: '#8A8A8E'
  },
  {
    key: 'volume24h',
    label: 'Spot volume, last 24h',
    fmt: 'usd',
    sub: 'LUSDT-quoted orderbook pairs',
    subColor: '#8A8A8E'
  },
  {
    key: 'activePools',
    label: 'Active pools',
    fmt: 'int',
    sub: 'With liquidity on-chain',
    subColor: '#8A8A8E'
  },
  {
    key: 'swapFee',
    label: 'Swap fee',
    fmt: 'pct',
    sub: '60% back to LPs',
    subColor: '#AD87FF'
  }
]

/** Protocol constant (Pair contract): 0.5% per swap. */
export const SWAP_FEE_PCT = 0.5

export const fmtStat = (v: number, fmt: StatFmt) =>
  fmt === 'usd'
    ? v >= 1e6
      ? '$' + (v / 1e6).toFixed(2) + 'M'
      : v >= 1e3
        ? '$' + (v / 1e3).toFixed(1) + 'K'
        : '$' + v.toFixed(0)
    : fmt === 'm'
      ? '$' + (v / 1e6).toFixed(2) + 'M'
      : fmt === 'k'
        ? '$' + (v / 1e3).toFixed(1) + 'K'
        : fmt === 'int'
          ? Math.round(v).toString()
          : v.toFixed(1) + '%'

/** Hero orbit: 5 tokens on 3 rings (inset = ring size, delay = phase). */
export const HERO_ORBITS = [
  {
    sym: 'WLUNES',
    icon: '/img/lunes-green.svg',
    inset: '0%',
    dur: '46s',
    delay: '0s',
    size: '58px',
    glow: 'rgba(38,208,124,0.35)'
  },
  {
    sym: 'LBTC',
    icon: '/img/lbtc.svg',
    inset: '0%',
    dur: '46s',
    delay: '-23s',
    size: '54px',
    glow: 'rgba(247,147,26,0.3)'
  },
  {
    sym: 'LUSDT',
    icon: '/img/lusdt.png',
    inset: '14%',
    dur: '32s',
    delay: '-8s',
    size: '50px',
    glow: 'rgba(38,161,123,0.3)'
  },
  {
    sym: 'LETH',
    icon: '/img/leth.svg',
    inset: '14%',
    dur: '32s',
    delay: '-24s',
    size: '48px',
    glow: 'rgba(173,135,255,0.35)'
  },
  {
    sym: 'LUP',
    icon: '/img/up.svg',
    inset: '30%',
    dur: '20s',
    delay: '-5s',
    size: '40px',
    glow: 'rgba(108,56,255,0.45)'
  }
]

export const ECO_ORBITS = TOKENS.map((t, i) => ({
  sym: t.sym,
  icon: t.icon,
  inset: i % 2 ? '4%' : '-2%',
  dur: (i % 2 ? 38 : 52) + 's',
  delay: (-i * (i % 2 ? 12.6 : 17.3)).toFixed(1) + 's'
}))

/** How it works: [path, color, step from which it lights up]. */
export const FLOWS: { d: string; color: string; from: number }[] = [
  { d: 'M122 82 C 160 90, 170 120, 182 142', color: '#6C38FF', from: 1 },
  { d: 'M176 226 C 150 262, 112 276, 96 298', color: '#26D07C', from: 3 },
  { d: 'M200 236 L200 306', color: '#6C38FF', from: 3 },
  { d: 'M224 226 C 250 262, 288 276, 304 298', color: '#AD87FF', from: 3 },
  { d: 'M330 300 C 392 210, 318 40, 124 62', color: '#AD87FF', from: 4 }
]

export const STEPS = [
  {
    kicker: 'Connect',
    title: 'Connect your wallet',
    body: 'Plug in Lunes Wallet, SubWallet or Talisman. Your keys never leave your device and every action is a transaction you approve.'
  },
  {
    kicker: 'Swap',
    title: 'Route through the pools',
    body: 'Your trade flows through Lunex liquidity pools at the best available price. Price impact and the minimum you receive are shown before you sign.'
  },
  {
    kicker: 'Split',
    title: 'Fees flow back to the community',
    body: 'Every swap pays 0.5%: 0.3% to liquidity providers, 0.1% to the protocol and 0.1% to LUNES stakers — enforced by the Pair contract.'
  },
  {
    kicker: 'Earn',
    title: 'Stake and orbit back',
    body: 'Stake LP tokens to earn WLUNES every block, boosted up to 3× by your trading tier. Rewards flow straight back to your wallet.'
  }
]

export const STEP_CAPTIONS = [
  '',
  'STEP 1 · CONNECT',
  'STEP 2 · SWAP',
  'STEP 3 · FEE SPLIT',
  'STEP 4 · STAKE & EARN'
]

/** Lucide paths (inline so the SVGs match the prototype stroke exactly). */
const ICON = {
  shield: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    'm9 12 2 2 4-4'
  ],
  receipt: [
    'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z',
    'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8',
    'M12 17.5v-11'
  ],
  drop: [
    'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'
  ],
  layers: [
    'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
    'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
    'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'
  ],
  bot: [
    'M12 8V4H8',
    'M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    'M9 13v2M15 13v2M2 14h2M20 14h2'
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0'
  ]
}

export const BENEFITS = [
  {
    paths: ICON.shield,
    title: 'Non-custodial',
    big: '100%',
    bigSub: 'your keys',
    body: 'Funds never leave your wallet. Contracts are open source and every action needs your signature.',
    color: '#CAAFFF',
    glow: 'rgba(108,56,255,0.4)'
  },
  {
    paths: ICON.receipt,
    title: 'Transparent fees',
    big: '0.5%',
    bigSub: 'per swap',
    body: 'One flat swap fee with its split shown before you sign. No hidden spreads, no surprise costs.',
    color: '#CAAFFF',
    glow: 'rgba(108,56,255,0.35)'
  },
  {
    paths: ICON.drop,
    title: 'Earn as a provider',
    big: '0.3%',
    bigSub: 'of every swap',
    body: 'Deposit a pair and collect 60% of the fee generated by the volume routed through your pool.',
    color: '#57E290',
    glow: 'rgba(38,208,124,0.35)'
  },
  {
    paths: ICON.layers,
    title: 'Boosted staking',
    big: '3×',
    bigSub: 'max boost',
    body: 'Stake LP to earn WLUNES every block. Trading volume lifts your tier from Bronze 1× to Platinum 3×.',
    color: '#57E290',
    glow: 'rgba(38,208,124,0.3)'
  },
  {
    paths: ICON.bot,
    title: 'AI agents, your limits',
    big: '24/7',
    bigSub: 'execution',
    body: 'Connect a bot through the MCP SDK. Keys trade only within the limits you sign and can never withdraw.',
    color: '#CAAFFF',
    glow: 'rgba(108,56,255,0.4)'
  },
  {
    paths: ICON.users,
    title: 'Copy proven traders',
    big: '5',
    bigSub: 'referral levels',
    body: 'Mirror top traders and AI strategies on-chain, and earn up to 4% on trades from people you refer.',
    color: '#CAAFFF',
    glow: 'rgba(108,56,255,0.35)'
  }
]

export const MODES = [
  {
    kicker: 'Swap',
    title: 'Instant swaps',
    body: 'Best route across every pool with impact and minimum received up front.',
    color: '#26D07C',
    tint: 'rgba(38,208,124,0.14)',
    ring: 'rgba(38,208,124,0.35)',
    paths: ['M8 3 4 7l4 4', 'M4 7h16m-4 14 4-4-4-4m4 4H4'],
    speed: 0.06,
    to: '/swap'
  },
  {
    kicker: 'Spot',
    title: 'On-chain orderbook',
    body: 'Limit, market, stop and stop-limit orders with maker 0.10% and taker 0.25%.',
    color: '#AD87FF',
    tint: 'rgba(108,56,255,0.14)',
    ring: 'rgba(108,56,255,0.4)',
    paths: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9M13 17V5M8 17v-3'],
    speed: -0.04,
    to: '/spot'
  },
  {
    kicker: 'Agents',
    title: 'Autonomous AI',
    body: 'Deploy trading bots that execute your strategy around the clock — within your limits.',
    color: '#CAAFFF',
    tint: 'rgba(108,56,255,0.14)',
    ring: 'rgba(108,56,255,0.4)',
    paths: [
      'M12 8V4H8',
      'M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'
    ],
    speed: 0.08,
    to: '/agents/get-started'
  },
  {
    kicker: 'Copy',
    title: 'Social trading',
    body: 'Allocate to top traders and vaults, mirrored proportionally, withdraw any time.',
    color: '#57E290',
    tint: 'rgba(38,208,124,0.14)',
    ring: 'rgba(38,208,124,0.35)',
    paths: [
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0'
    ],
    speed: -0.06,
    to: '/social'
  }
]
