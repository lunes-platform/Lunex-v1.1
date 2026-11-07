import type { Signer } from '@polkadot/api/types'

export type WalletKind = 'extension' | 'walletconnect'

/**
 * The one signing abstraction of the app. Every extrinsic and every
 * off-chain message is signed through the active adapter's `signer` /
 * `signMessage`, so each signature is approved in the user's own wallet
 * (browser extension or phone via WalletConnect). Lunex never holds keys.
 */
export interface WalletAdapter {
  kind: WalletKind
  /** SS58 address of the connected account. */
  address: string
  /** Wallet label for the UI (e.g. "SubWallet", "WalletConnect"). */
  name: string
  /** polkadot.js Signer passed to `signAndSend(address, { signer })`. */
  signer: Signer
  /** Sign an off-chain message (spot-api auth); returns the hex signature. */
  signMessage: (message: string) => Promise<string>
  disconnect: () => Promise<void>
}
