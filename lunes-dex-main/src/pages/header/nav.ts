/**
 * Shared navigation config for the desktop header, the settings menu and
 * the mobile tab bar / More sheet (prototype `navItems`, `moreItems`,
 * `hdrGroups`).
 */

export type NavItem = {
  key: string
  label: string
  to: string
  /** Extra pathnames that mark this item active. */
  match?: string[]
}

export type MoreItem = NavItem & { note: string }

export const PRIMARY_NAV: NavItem[] = [
  { key: 'swap', label: 'Swap', to: '/swap', match: ['/trade'] },
  {
    key: 'pools',
    label: 'Pools',
    to: '/pools',
    match: ['/pool', '/liquidity', '/pool/asymmetric']
  },
  { key: 'staking', label: 'Staking', to: '/staking', match: ['/stake'] },
  { key: 'activity', label: 'Activity', to: '/activity' }
]

export const MORE_NAV: MoreItem[] = [
  { key: 'spot', label: 'Spot', note: 'Orderbook', to: '/spot' },
  {
    key: 'social',
    label: 'Social Trade',
    note: 'Copy traders',
    to: '/social',
    match: ['/spot/copytrade']
  },
  {
    key: 'strategies',
    label: 'Strategies',
    note: 'Marketplace',
    to: '/strategies'
  },
  {
    key: 'agent',
    label: 'Agent',
    note: 'AI trading',
    to: '/agent',
    match: ['/agents/get-started']
  },
  {
    key: 'rewards',
    label: 'Rewards',
    note: 'Tiers & claims',
    to: '/rewards',
    match: ['/community']
  },
  {
    key: 'affiliates',
    label: 'Affiliates',
    note: 'Referrals',
    to: '/affiliates',
    match: ['/referral']
  },
  {
    key: 'governance',
    label: 'Governance',
    note: 'Voting',
    to: '/governance'
  },
  {
    key: 'revenue',
    label: 'Revenue',
    note: 'Protocol stats',
    to: '/protocol-stats'
  },
  { key: 'listing', label: 'Token listing', note: 'Apply', to: '/listing' },
  { key: 'docs', label: 'Docs', note: 'Guides', to: '/docs' }
]

export type MenuLink = {
  label: string
  to?: string
  href?: string
  /** PLACEHOLDER: link not defined yet — shows a "coming soon" toast. */
  soon?: boolean
}

export const SETTINGS_GROUPS: { title: string; items: MenuLink[] }[] = [
  {
    title: 'Navigation',
    items: [
      { label: 'Swap', to: '/swap' },
      { label: 'Spot', to: '/spot' },
      { label: 'Pools', to: '/pools' },
      { label: 'Staking', to: '/staking' }
    ]
  },
  {
    title: 'Resources',
    items: [
      { label: 'Docs', to: '/docs' },
      { label: 'Revenue', to: '/protocol-stats' },
      { label: 'Token listing', to: '/listing' },
      { label: 'Agents guide', to: '/agents/get-started' }
    ]
  },
  {
    title: 'Community',
    items: [
      { label: 'X / Twitter', href: 'https://twitter.com/LunesPlatform' },
      // PLACEHOLDER: no official Telegram URL in the codebase yet
      { label: 'Telegram', soon: true },
      { label: 'Discord', href: 'https://discord.gg/lunes' }
    ]
  }
]

export const isActive = (item: NavItem, pathname: string) =>
  pathname === item.to ||
  pathname.startsWith(item.to + '/') ||
  !!item.match?.some(m => pathname === m || pathname.startsWith(m + '/'))

/** Active primary key, or null when on a More route. */
export const activePrimary = (pathname: string) =>
  PRIMARY_NAV.find(n => isActive(n, pathname))?.key ?? null

export const inMore = (pathname: string) =>
  !activePrimary(pathname) && MORE_NAV.some(m => isActive(m, pathname))
