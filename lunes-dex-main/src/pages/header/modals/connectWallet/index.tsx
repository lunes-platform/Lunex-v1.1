import React, { useEffect, useState } from 'react'
//Styles
import * as S from './styles'
import * as B from 'components/bases'
//Mocks
import { network, wallet } from './mock'

export type ModalConnectWalletProps = {
  close: () => void
  connectNetwork: (walletSource?: string) => void
  connectWallet: (walletSource?: string) => void
}

const ConnectWallet = ({
  close,
  connectNetwork,
  connectWallet
}: ModalConnectWalletProps) => {
  const [installedWallets, setInstalledWallets] = useState<Set<string>>(new Set())

  // Detect installed wallet extensions
  useEffect(() => {
    const detect = () => {
      const injected = (window as any).injectedWeb3 || {}
      setInstalledWallets(new Set(Object.keys(injected)))
    }
    detect()
    const timer = setTimeout(detect, 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <S.Modal
      width="592px"
      justify="space-between"
      divider
      closeX={close}
      closeExternal={close}
      titleModal="Connect Wallet"
      description="Select the network and wallet you want to connect"
    >
      <S.Content>
        <B.SubTitle weight={600} size="16px">
          Choose the network
        </B.SubTitle>
        {network.map(item => {
          return (
            <S.Network
              key={item.id}
              title={item.shorty}
              onClick={connectNetwork}
              disabled={item.disabled}
              status={item.id == 0 ? 'tertiary' : 'default'}
            >
              <img src={item.icon} alt={item.network} />
              {item.network}
              <strong>{item.shorty}</strong>
            </S.Network>
          )
        })}
      </S.Content>

      <S.Content>
        <B.SubTitle weight={600} size="16px">
          Choose the wallet
        </B.SubTitle>
        {wallet.map(item => {
          const isInstalled = installedWallets.has(item.source)

          return (
            <S.Network
              key={item.id}
              title={item.shorty}
              onClick={() => {
                if (isInstalled || item.source === 'polkadot-js') {
                  connectWallet(item.source)
                } else {
                  window.open(item.installUrl, '_blank')
                }
              }}
              disabled={item.disabled}
              status={isInstalled || item.source === 'polkadot-js' ? 'tertiary' : 'default'}
            >
              <img src={item.icon} alt={item.wallet} />
              {item.wallet}
              <strong>
                {item.disabled
                  ? item.shorty
                  : isInstalled || item.source === 'polkadot-js'
                    ? ''
                    : '(install)'}
              </strong>
            </S.Network>
          )
        })}
      </S.Content>

      <S.Paragraph>
        By connecting to Lunes, you agree
        <br /> to our
        <strong> Terms of Services.</strong>
      </S.Paragraph>
    </S.Modal>
  )
}

export default ConnectWallet
