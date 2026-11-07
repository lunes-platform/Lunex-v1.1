/**
 * Holder of the active WalletAdapter. Services resolve their signer here
 * instead of talking to `@polkadot/extension-dapp` directly, so extension and
 * WalletConnect sessions share every signing call site.
 */
import { useSyncExternalStore } from 'react'
import type { Signer } from '@polkadot/api/types'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import type { WalletAdapter, WalletKind } from './types'

let active: WalletAdapter | null = null
const listeners = new Set<() => void>()

export const setActiveWallet = (adapter: WalletAdapter | null): void => {
  active = adapter
  listeners.forEach(listener => listener())
}

export const getActiveWallet = (): WalletAdapter | null => active

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Kind of the connected wallet, or null when disconnected. */
export const useActiveWalletKind = (): WalletKind | null =>
  useSyncExternalStore(subscribe, () => active?.kind ?? null)

const requireAdapter = (address: string): WalletAdapter => {
  if (!active || active.address !== address) {
    throw new Error('Reconnect your wallet to enable signing')
  }
  return active
}

/** Signer for `signAndSend(address, { signer })`; throws if not connected. */
export const getSignerFor = (address: string): Signer =>
  requireAdapter(address).signer

/**
 * Account record for code paths typed on the extension account shape.
 * Only the connected address resolves; signing still goes through
 * `getSignerFor`.
 */
export const getWalletAccount = (
  address: string | null | undefined
): InjectedAccountWithMeta | null => {
  if (!address || !active || active.address !== address) return null
  return {
    address: active.address,
    meta: { name: active.name, source: active.kind }
  }
}
