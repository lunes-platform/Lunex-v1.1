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
  return WALLETS.find(w => w.source === source) ?? WALLETS[0]
}

/** Other components can open the connect modal with this event. */
export const OPEN_WALLET_EVENT = 'lunex:open-wallet'

export const openWalletModal = () =>
  window.dispatchEvent(new Event(OPEN_WALLET_EVENT))
