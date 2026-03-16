import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSDK } from '../../../../context/SDKContext'

// ──────────────────── Animations ────────────────────

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`

// ──────────────────── Styled Components ────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.15s ease;
`

const Modal = styled.div`
  background: #111115;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  width: 460px;
  max-width: 95vw;
  padding: 28px 28px 24px;
  animation: ${slideUp} 0.22s ease;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
`

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 6px;
`

const Title = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  margin: 0;
  font-family: 'Space Grotesk', sans-serif;
`

const Subtitle = styled.p`
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  margin: 0 0 24px;
  line-height: 1.5;
`

const CloseBtn = styled.button`
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }
`

const SectionLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
`

const NetworkGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 24px;
`

const NetworkCard = styled.button<{ $active?: boolean; $disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  border-radius: 12px;
  border: 1px solid ${({ $active }) => $active ? 'rgba(108,56,255,0.5)' : 'rgba(255,255,255,0.07)'};
  background: ${({ $active }) => $active ? 'rgba(108,56,255,0.12)' : 'rgba(255,255,255,0.03)'};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  opacity: ${({ $disabled }) => $disabled ? 0.45 : 1};
  transition: all 0.15s;

  &:not(:disabled):hover {
    border-color: rgba(108,56,255,0.4);
    background: rgba(108,56,255,0.1);
  }

  img {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    object-fit: contain;
  }
`

const NetworkName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.85);
`

const ComingSoon = styled.span`
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  font-weight: 500;
`

const WalletList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
`

const WalletCard = styled.button<{ $loading?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.03);
  cursor: ${({ $loading }) => $loading ? 'wait' : 'pointer'};
  transition: all 0.15s;
  text-align: left;
  width: 100%;

  &:hover:not(:disabled) {
    border-color: rgba(108,56,255,0.4);
    background: rgba(108,56,255,0.08);
  }

  &:disabled {
    cursor: not-allowed;
  }

  img {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    flex-shrink: 0;
    object-fit: contain;
  }
`

const WalletInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const WalletName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  margin-bottom: 2px;
`

const WalletStatus = styled.div<{ $installed: boolean }>`
  font-size: 11px;
  font-weight: 500;
  color: ${({ $installed }) => $installed ? '#00C076' : 'rgba(255,255,255,0.35)'};
`

const WalletAction = styled.a<{ $isInstall?: boolean }>`
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;

  ${({ $isInstall }) => $isInstall ? `
    border-color: rgba(247, 183, 49, 0.35);
    background: rgba(247, 183, 49, 0.08);
    color: #F7B731;
    &:hover { background: rgba(247, 183, 49, 0.15); }
  ` : `
    border-color: rgba(108,56,255,0.35);
    background: rgba(108,56,255,0.1);
    color: #a78bfa;
    &:hover { background: rgba(108,56,255,0.18); }
  `}
`

const LoadingSpinner = styled.div`
  width: 18px;
  height: 18px;
  border: 2px solid rgba(108,56,255,0.3);
  border-top-color: #6C38FF;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`

const ErrorBox = styled.div`
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255,75,85,0.08);
  border: 1px solid rgba(255,75,85,0.2);
  color: #FF6B75;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 16px;
`

const Divider = styled.div`
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 20px 0 16px;
`

const Terms = styled.p`
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  text-align: center;
  margin: 0;
  line-height: 1.5;

  strong {
    color: #6C38FF;
    cursor: pointer;
  }
`

// ──────────────────── Config ────────────────────

const WALLETS = [
  {
    id: 'polkadot-js',
    name: 'Lunes Wallet',
    icon: '/img/lunes-wallet.svg',
    installUrl: 'https://chrome.google.com/webstore/detail/polkadotjs-extension/mopnmbcafieddcagagdcbnhejhlodfdd',
    source: 'polkadot-js',
  },
  {
    id: 'subwallet-js',
    name: 'SubWallet',
    icon: '/img/subwallet.svg',
    installUrl: 'https://subwallet.app/download.html',
    source: 'subwallet-js',
  },
  {
    id: 'talisman',
    name: 'Talisman',
    icon: '/img/talisman.svg',
    installUrl: 'https://talisman.xyz/download',
    source: 'talisman',
  },
]

// ──────────────────── Types ────────────────────

export type ModalConnectWalletProps = {
  close: () => void
  connectNetwork: (walletSource?: string) => void
  connectWallet: (walletSource?: string) => void
}

// ──────────────────── Component ────────────────────

const ConnectWallet: React.FC<ModalConnectWalletProps> = ({ close, connectWallet }) => {
  const sdk = useSDK()
  const [installedWallets, setInstalledWallets] = useState<Set<string>>(new Set())
  const [connectingSource, setConnectingSource] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  // Detect installed wallet extensions via window.injectedWeb3
  useEffect(() => {
    const detect = () => {
      const injected = (window as any).injectedWeb3 || {}
      const installed = new Set<string>(Object.keys(injected))
      setInstalledWallets(installed)
    }

    detect()
    // Some extensions inject late — re-check after a short delay
    const timer = setTimeout(detect, 500)
    return () => clearTimeout(timer)
  }, [])

  const handleConnect = async (source: string) => {
    setLocalError(null)
    setConnectingSource(source)
    try {
      await connectWallet(source)
      // If no error thrown, close will be handled by header when connected
    } catch (err: any) {
      setLocalError(err?.message || 'Connection failed')
    } finally {
      setConnectingSource(null)
    }
  }

  const errorMsg = localError || sdk.error

  return (
    <Overlay onClick={close}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <div>
            <Title>Connect Wallet</Title>
            <Subtitle>Select the network and wallet you want to connect</Subtitle>
          </div>
          <CloseBtn onClick={close}>✕</CloseBtn>
        </Header>

        {/* Error */}
        {errorMsg && <ErrorBox>{errorMsg}</ErrorBox>}

        {/* Network */}
        <SectionLabel>Choose the network</SectionLabel>
        <NetworkGrid>
          <NetworkCard $active onClick={() => handleConnect('polkadot-js')}>
            <img src="/img/lunes.svg" alt="Lunes" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <NetworkName>Lunes</NetworkName>
          </NetworkCard>
          <NetworkCard $disabled disabled>
            <img src="/img/ethereum.svg" alt="Ethereum" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <NetworkName>Ethereum</NetworkName>
            <ComingSoon>coming soon</ComingSoon>
          </NetworkCard>
          <NetworkCard $disabled disabled>
            <img src="/img/solana.svg" alt="Solana" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <NetworkName>Solana</NetworkName>
            <ComingSoon>coming soon</ComingSoon>
          </NetworkCard>
        </NetworkGrid>

        <Divider />

        {/* Wallets */}
        <SectionLabel>Choose the wallet</SectionLabel>
        <WalletList>
          {WALLETS.map(wallet => {
            const isInstalled = installedWallets.has(wallet.id)
            const isConnecting = connectingSource === wallet.source
            const isLoading = sdk.isLoading && isConnecting

            return (
              <WalletCard
                key={wallet.id}
                $loading={isLoading}
                disabled={isLoading}
                onClick={() => isInstalled && !isLoading ? handleConnect(wallet.source) : undefined}
                style={{ cursor: isInstalled ? 'pointer' : 'default' }}
              >
                <img
                  src={wallet.icon}
                  alt={wallet.name}
                  onError={e => { (e.target as HTMLImageElement).src = '/img/lunes-green.svg' }}
                />
                <WalletInfo>
                  <WalletName>{wallet.name}</WalletName>
                  <WalletStatus $installed={isInstalled}>
                    {isLoading ? 'Connecting…' : isInstalled ? 'Detected' : 'Not installed'}
                  </WalletStatus>
                </WalletInfo>
                {isLoading ? (
                  <LoadingSpinner />
                ) : isInstalled ? (
                  <WalletAction as="button" onClick={e => { e.stopPropagation(); handleConnect(wallet.source) }}>
                    Connect
                  </WalletAction>
                ) : (
                  <WalletAction
                    $isInstall
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                  >
                    Install
                  </WalletAction>
                )}
              </WalletCard>
            )
          })}
        </WalletList>

        <Terms>
          By connecting to Lunes, you agree to our{' '}
          <strong>Terms of Services.</strong>
        </Terms>
      </Modal>
    </Overlay>
  )
}

export default ConnectWallet
