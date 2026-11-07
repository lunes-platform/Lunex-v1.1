import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import type { WalletAdapter } from './types'

/**
 * Browser-extension adapter (Lunes Wallet / polkadot-js, SubWallet,
 * Talisman). Wraps the injector exactly as the app used it before: the
 * extension signer for extrinsics and `signRaw({ type: 'bytes' })` for
 * off-chain messages.
 */
export const createExtensionAdapter = async (
  account: InjectedAccountWithMeta,
  name: string
): Promise<WalletAdapter> => {
  const { web3FromSource } = await import('@polkadot/extension-dapp')
  const injector = await web3FromSource(account.meta.source)
  const signer = injector?.signer
  if (!signer) throw new Error('Signer not available in the connected wallet')

  return {
    kind: 'extension',
    address: account.address,
    name,
    signer,
    signMessage: async message => {
      if (!signer.signRaw) {
        throw new Error('Signer not available in the connected wallet')
      }
      const { signature } = await signer.signRaw({
        address: account.address,
        data: message,
        type: 'bytes'
      })
      return signature
    },
    // Extensions keep their own authorization; nothing to tear down.
    disconnect: async () => undefined
  }
}
