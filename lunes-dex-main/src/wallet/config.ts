/**
 * WalletConnect / desktop runtime configuration. Kept free of WalletConnect
 * imports so the main bundle can read it without loading the SDK.
 */

import { readEnv } from '../utils/env'

// `process.env.REACT_APP_*` is replaced at build time by vite.config.ts;
// readEnv keeps an unset variable from touching `process` at runtime.
const WALLETCONNECT_PROJECT_ID = readEnv(
  () => process.env.REACT_APP_WALLETCONNECT_PROJECT_ID
)

const GENESIS_HASH_OVERRIDE = readEnv(
  () => process.env.REACT_APP_LUNES_GENESIS_HASH
)

export const walletConnectProjectId = (): string =>
  WALLETCONNECT_PROJECT_ID.trim()

export const isWalletConnectConfigured = (): boolean =>
  walletConnectProjectId().length > 0

export const genesisHashOverride = (): string => GENESIS_HASH_OVERRIDE.trim()

/** True inside the Electron desktop app (no browser extensions there). */
export const isDesktopApp = (): boolean =>
  typeof window !== 'undefined' && window.lunexDesktop?.isDesktop === true

export const appMetadata = () => {
  const origin =
    typeof window !== 'undefined' && window.location.origin.startsWith('http')
      ? window.location.origin
      : 'https://lunex.io'
  return {
    name: 'Lunex',
    description: 'Lunex DEX on the Lunes blockchain',
    url: origin,
    icons: [`${origin}/img/lunes-green.svg`]
  }
}
