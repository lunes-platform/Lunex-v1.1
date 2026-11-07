/**
 * Supported Substrate wallet extensions. `source` is the key the extension
 * registers in `window.injectedWeb3` and the value passed to
 * `sdk.connectWallet(source)` (matched against `account.meta.source`).
 */
export type WalletDef = {
  source: string
  name: string
  icon: string
  installUrl: string
}

export const WALLETS: WalletDef[] = [
  {
    source: 'polkadot-js',
    name: 'Lunes Wallet',
    icon: '/img/lunes-wallet.svg',
    installUrl:
      'https://chrome.google.com/webstore/detail/polkadotjs-extension/mopnmbcafieddcagagdcbnhejhlodfdd'
  },
  {
    source: 'subwallet-js',
    name: 'SubWallet',
    icon: '/img/subwallet.svg',
    installUrl: 'https://subwallet.app/download.html'
  },
  {
    source: 'talisman',
    name: 'Talisman',
    icon: '/img/talisman.svg',
    installUrl: 'https://talisman.xyz/download'
  }
]

/** Source key SDKContext stores for WalletConnect sessions. */
export const WALLETCONNECT_SOURCE = 'walletconnect'

// WalletConnect logo (inline SVG, rendered via a data URI so <img> works).
const WALLETCONNECT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
  '<rect width="40" height="40" rx="10" fill="#3B99FC"/>' +
  '<path fill="#fff" d="M12.6 15.3c4.1-4 10.7-4 14.8 0l.5.5c.2.2.2.5 0 ' +
  '.7l-1.7 1.6c-.1.1-.3.1-.4 0l-.7-.7c-2.8-2.8-7.4-2.8-10.3 0l-.7.7c-.1.1' +
  '-.3.1-.4 0L12 16.5c-.2-.2-.2-.5 0-.7l.6-.5Zm18.3 3.4 1.5 1.5c.2.2.2.5 ' +
  '0 .7l-6.8 6.6c-.2.2-.5.2-.7 0l-4.8-4.7c-.1-.1-.1-.1-.2 0l-4.8 4.7c-.2.2' +
  '-.5.2-.7 0l-6.8-6.6c-.2-.2-.2-.5 0-.7l1.5-1.5c.2-.2.5-.2.7 0l4.8 4.7c.1' +
  '.1.1.1.2 0l4.8-4.7c.2-.2.5-.2.7 0l4.8 4.7c.1.1.1.1.2 0l4.8-4.7c.2-.2.5' +
  '-.2.7 0Z"/></svg>'

export const WALLETCONNECT_WALLET: WalletDef = {
  source: WALLETCONNECT_SOURCE,
  name: 'WalletConnect',
  icon: `data:image/svg+xml;utf8,${encodeURIComponent(WALLETCONNECT_SVG)}`,
  installUrl: 'https://walletconnect.network/'
}

export const detectInstalled = (): Set<string> => {
  const injected =
    (window as unknown as { injectedWeb3?: Record<string, unknown> })
      .injectedWeb3 || {}
  return new Set(Object.keys(injected))
}

/** Wallet used for the current session (persisted by SDKContext). */
export const currentWallet = (): WalletDef => {
  let source = ''
  try {
    source = localStorage.getItem('lunex_last_wallet_source') || ''
  } catch {
    // storage unavailable
  }
  if (source === WALLETCONNECT_SOURCE) return WALLETCONNECT_WALLET
  return WALLETS.find(w => w.source === source) ?? WALLETS[0]
}

/** Other components can open the connect modal with this event. */
export const OPEN_WALLET_EVENT = 'lunex:open-wallet'

export const openWalletModal = () =>
  window.dispatchEvent(new Event(OPEN_WALLET_EVENT))

/**
 * Promise-returning variant for screens: opens the header's Connect wallet
 * modal (network + wallet picker) instead of connecting silently to the
 * first extension account. Resolves once the request is dispatched.
 */
export const requestWalletConnect = (): Promise<void> => {
  openWalletModal()
  return Promise.resolve()
}
