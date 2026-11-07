/**
 * Pure helpers for the WalletConnect (v2) Polkadot namespace.
 *
 * No I/O and no WalletConnect imports here: this module is the request /
 * response mapping between polkadot.js `Signer` calls and the WalletConnect
 * JSON-RPC methods, kept side-effect free so it can be reasoned about (and
 * unit-tested) in isolation. Spec:
 * https://docs.walletconnect.com/advanced/multichain/rpc-reference/polkadot-rpc
 */
import type { Signer, SignerResult } from '@polkadot/api/types'
import { u8aEq } from '@polkadot/util'
import { decodeAddress } from '@polkadot/util-crypto'

export type SignerPayloadJSON = Parameters<
  NonNullable<Signer['signPayload']>
>[0]
export type SignerPayloadRaw = Parameters<NonNullable<Signer['signRaw']>>[0]

export const POLKADOT_METHODS = [
  'polkadot_signTransaction',
  'polkadot_signMessage'
] as const
export const POLKADOT_EVENTS = ['chainChanged', 'accountsChanged'] as const

type PolkadotMethod = (typeof POLKADOT_METHODS)[number]

export type WalletConnectRequest = {
  method: PolkadotMethod
  params: Record<string, unknown>
}

/**
 * CAIP-2 chain id for a Substrate chain: `polkadot:` + the first 32 hex
 * chars (16 bytes) of the genesis hash, lower-case, without `0x`.
 */
export const chainIdFromGenesis = (genesisHash: string): string => {
  const hex = genesisHash.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{32,}$/.test(hex)) {
    throw new Error('Invalid genesis hash for WalletConnect chain id')
  }
  return `polkadot:${hex.slice(0, 32)}`
}

/** Namespace requested from the wallet when pairing. */
export const polkadotNamespace = (chainId: string) => ({
  polkadot: {
    methods: [...POLKADOT_METHODS],
    chains: [chainId],
    events: [...POLKADOT_EVENTS]
  }
})

/** Same account, whatever SS58 prefix each side encoded it with. */
export const sameAccount = (a: string, b: string): boolean => {
  try {
    return u8aEq(decodeAddress(a), decodeAddress(b))
  } catch {
    return false
  }
}

/** Session context a request is checked against before reaching the wallet. */
export type SessionTarget = { address: string; chainId: string }

/**
 * `signer.signPayload(payload)` → `polkadot_signTransaction`. Refuses a
 * payload for another account or another chain than the paired session, so
 * a wallet is never asked to sign something the session was not opened for.
 */
export const signTransactionRequest = (
  payload: SignerPayloadJSON,
  target: SessionTarget
): WalletConnectRequest => {
  if (!sameAccount(payload.address, target.address)) {
    throw new Error('Transaction signer does not match the connected account')
  }
  if (chainIdFromGenesis(payload.genesisHash) !== target.chainId) {
    throw new Error('Transaction is for a different chain than the session')
  }
  return {
    method: 'polkadot_signTransaction',
    params: { address: target.address, transactionPayload: payload }
  }
}

/**
 * `signer.signRaw({ address, data })` → `polkadot_signMessage`. `data` is
 * forwarded untouched (same input the browser extension receives); the
 * wallet applies the usual `<Bytes>…</Bytes>` wrapping before signing.
 */
export const signMessageRequest = (
  raw: Pick<SignerPayloadRaw, 'address' | 'data'>,
  target: SessionTarget
): WalletConnectRequest => {
  if (!sameAccount(raw.address, target.address)) {
    throw new Error('Message signer does not match the connected account')
  }
  return {
    method: 'polkadot_signMessage',
    params: { address: target.address, message: raw.data }
  }
}

/** Validate a wallet response and turn it into a polkadot.js SignerResult. */
export const toSignerResult = (response: unknown, id: number): SignerResult => {
  const signature =
    response && typeof response === 'object'
      ? (response as { signature?: unknown }).signature
      : undefined
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error('Wallet returned an invalid signature')
  }
  return { id, signature: signature as `0x${string}` }
}

/**
 * Addresses the session grants on `chainId`, from CAIP-10 entries
 * (`polkadot:<genesis-prefix>:<ss58 address>`), de-duplicated, in order.
 */
export const sessionAccounts = (
  namespaces: Record<string, { accounts?: string[] }> | undefined,
  chainId: string
): string[] => {
  const accounts = namespaces?.polkadot?.accounts ?? []
  const prefix = `${chainId}:`
  const out: string[] = []
  for (const entry of accounts) {
    if (!entry.startsWith(prefix)) continue
    const address = entry.slice(prefix.length)
    if (address && !out.includes(address)) out.push(address)
  }
  return out
}
