/**
 * WalletConnect (v2) adapter — loaded with a dynamic import only when the
 * user picks WalletConnect or a stored session is restored, so extension
 * users never download the WalletConnect SDK.
 *
 * Keys stay on the user's phone: every extrinsic (`polkadot_signTransaction`)
 * and message (`polkadot_signMessage`) is approved in the wallet app.
 */
import UniversalProvider from '@walletconnect/universal-provider'
import type { Signer } from '@polkadot/api/types'
import type { WalletAdapter } from './types'
import { appMetadata, walletConnectProjectId } from './config'
import {
  chainIdFromGenesis,
  polkadotNamespace,
  sameAccount,
  sessionAccounts,
  signMessageRequest,
  signTransactionRequest,
  toSignerResult,
  type SessionTarget,
  type WalletConnectRequest
} from './walletConnectRequests'

type Provider = Awaited<ReturnType<typeof UniversalProvider.init>>
type Session = NonNullable<Provider['session']>

export type WalletConnectHandlers = {
  /** The wallet ended the session (or it expired / lost our account). */
  onRemoteDisconnect: () => void
}

let providerPromise: Promise<Provider> | null = null
let handlers: WalletConnectHandlers | null = null
let target: SessionTarget | null = null

const remoteDisconnect = () => {
  const cb = handlers?.onRemoteDisconnect
  target = null
  handlers = null
  cb?.()
}

const getProvider = (): Promise<Provider> => {
  if (!providerPromise) {
    const projectId = walletConnectProjectId()
    if (!projectId) {
      return Promise.reject(new Error('WalletConnect is not configured'))
    }
    providerPromise = UniversalProvider.init({
      projectId,
      metadata: appMetadata(),
      logger: 'error'
    }).then(provider => {
      provider.on('session_delete', remoteDisconnect)
      provider.client.on('session_expire', ({ topic }) => {
        if (!provider.session || topic === provider.session.topic)
          remoteDisconnect()
      })
      provider.on('accountsChanged', (accounts: string[]) => {
        if (!target) return
        const t = target
        if (
          !accounts.some(a => sameAccount(a.split(':').pop() || a, t.address))
        )
          remoteDisconnect()
      })
      provider.on('session_update', () => {
        if (!target) return
        const t = target
        const granted = sessionAccounts(provider.session?.namespaces, t.chainId)
        if (!granted.some(a => sameAccount(a, t.address))) remoteDisconnect()
      })
      return provider
    })
    providerPromise.catch(() => {
      providerPromise = null
    })
  }
  return providerPromise
}

const isSessionLive = (provider: Provider, session: Session): boolean =>
  session.expiry * 1000 > Date.now() &&
  provider.client.session.keys.includes(session.topic)

const buildAdapter = (
  provider: Provider,
  address: string,
  chainId: string,
  walletName: string
): WalletAdapter => {
  const sessionTarget: SessionTarget = { address, chainId }
  let nextId = 0
  const request = async (args: WalletConnectRequest) =>
    toSignerResult(await provider.request(args, chainId), ++nextId)

  const signer: Signer = {
    signPayload: payload =>
      request(signTransactionRequest(payload, sessionTarget)),
    signRaw: raw => request(signMessageRequest(raw, sessionTarget))
  }

  return {
    kind: 'walletconnect',
    address,
    name: walletName,
    signer,
    signMessage: async message => {
      const { signature } = await request(
        signMessageRequest({ address, data: message }, sessionTarget)
      )
      return signature
    },
    disconnect: async () => {
      target = null
      handlers = null
      if (!provider.session) return
      try {
        await provider.disconnect()
      } catch {
        // Session already gone on the relay; local state is cleared anyway.
      }
    }
  }
}

const peerName = (session: Session): string => {
  const name = session.peer?.metadata?.name?.trim()
  return name ? `${name} (WalletConnect)` : 'WalletConnect'
}

const activate = (
  provider: Provider,
  session: Session,
  chainId: string,
  preferred: string | null,
  next: WalletConnectHandlers
): WalletAdapter => {
  const accounts = sessionAccounts(session.namespaces, chainId)
  if (accounts.length === 0) {
    throw new Error('The wallet did not share an account on the Lunes network')
  }
  const address =
    (preferred && accounts.find(a => sameAccount(a, preferred))) || accounts[0]
  target = { address, chainId }
  handlers = next
  return buildAdapter(provider, address, chainId, peerName(session))
}

/**
 * Pair a wallet: `onUri` receives the `wc:` URI to render as a QR code; the
 * promise resolves once the wallet approves the session.
 */
export const connectWalletConnect = async (opts: {
  genesisHash: string
  onUri: (uri: string) => void
  handlers: WalletConnectHandlers
}): Promise<WalletAdapter> => {
  const chainId = chainIdFromGenesis(opts.genesisHash)
  const provider = await getProvider()

  // A leftover session here is stale (app-level disconnect ends sessions).
  if (provider.session) {
    target = null
    handlers = null
    try {
      await provider.disconnect()
    } catch {
      // ignore — we are replacing it
    }
  }

  const onUri = (uri: string) => opts.onUri(uri)
  provider.on('display_uri', onUri)
  try {
    const session = await provider.connect({
      optionalNamespaces: polkadotNamespace(chainId)
    })
    if (!session) throw new Error('Wallet did not approve the connection')
    try {
      return activate(provider, session, chainId, null, opts.handlers)
    } catch (err) {
      await provider.disconnect().catch(() => undefined)
      throw err
    }
  } finally {
    provider.off('display_uri', onUri)
  }
}

/** Abort a pending pairing (user closed the QR). */
export const abortWalletConnect = async (): Promise<void> => {
  if (!providerPromise) return
  const provider = await providerPromise.catch(() => null)
  provider?.abortPairingAttempt()
}

/**
 * Restore the session UniversalProvider kept in storage. Returns an adapter
 * only if the session is still live, unexpired and grants an account on this
 * chain; otherwise the stale session is dropped and null is returned.
 */
export const restoreWalletConnect = async (opts: {
  genesisHash: string
  preferredAddress: string | null
  handlers: WalletConnectHandlers
}): Promise<WalletAdapter | null> => {
  const chainId = chainIdFromGenesis(opts.genesisHash)
  const provider = await getProvider()
  const session = provider.session
  if (!session) return null
  if (
    !isSessionLive(provider, session) ||
    sessionAccounts(session.namespaces, chainId).length === 0
  ) {
    await provider.disconnect().catch(() => undefined)
    return null
  }
  return activate(
    provider,
    session,
    chainId,
    opts.preferredAddress,
    opts.handlers
  )
}
