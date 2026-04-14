import React, { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import { Wallet, Copy, ExternalLink, ChevronDown, X } from 'lucide-react'

/**
 * Abbreviate large numbers for the navbar:
 *   999         → "999"
 *   1_500       → "1.5K"
 *   500_000     → "500K"
 *   1_200_000   → "1.2M"
 *   500_000_000 → "500M"
 *   1_500_000_000 → "1.5B"
 *   1_000_000_000_000 → "1T"
 */
function abbreviateBalance(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num) || num === 0) return '0'

  const abs = Math.abs(num)
  const sign = num < 0 ? '-' : ''

  if (abs >= 1_000_000_000_000)
    return `${sign}${(abs / 1_000_000_000_000).toFixed(abs % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)
    return `${sign}${(abs / 1_000_000_000).toFixed(abs % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)
    return `${sign}${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)
    return `${sign}${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}K`
  if (abs >= 1_000)
    return `${sign}${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  return `${sign}${abs.toFixed(2)}`
}

const ConnectWallet: React.FC = () => {
  const {
    isConnected,
    walletAddress,
    balance,
    connectWallet,
    disconnectWallet,
    isLoading
  } = useSDK()
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const formatAddress = (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const fullBalance = Number(balance).toLocaleString(undefined, {
    maximumFractionDigits: 2
  })

  if (isConnected && walletAddress) {
    return (
      <>
        <WalletContainer>
          <BalanceDisplay onClick={() => setShowModal(true)}>
            <img
              src="/img/lunes-green.svg"
              alt="LUNES"
              width={16}
              height={16}
            />
            <span>{abbreviateBalance(balance)}</span>
            <ChevronDown size={12} />
          </BalanceDisplay>
          <WalletButton onClick={() => setShowModal(true)}>
            <WalletIconWrap>
              <Wallet size={16} />
            </WalletIconWrap>
            <span>{formatAddress(walletAddress)}</span>
          </WalletButton>
        </WalletContainer>

        {/* Wallet Balances Modal */}
        {showModal && (
          <Overlay onClick={() => setShowModal(false)}>
            <Modal onClick={e => e.stopPropagation()}>
              <ModalHeader>
                <h3>Wallet</h3>
                <CloseBtn onClick={() => setShowModal(false)}>
                  <X size={18} />
                </CloseBtn>
              </ModalHeader>

              {/* Address */}
              <AddressRow>
                <AddressText>{formatAddress(walletAddress)}</AddressText>
                <AddressActions>
                  <ActionBtn onClick={copyAddress} title="Copy address">
                    <Copy size={14} />
                    {copied && <CopiedTooltip>Copied!</CopiedTooltip>}
                  </ActionBtn>
                  <ActionBtn
                    as="a"
                    href={`https://explorer.lunes.io/account/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on explorer"
                  >
                    <ExternalLink size={14} />
                  </ActionBtn>
                </AddressActions>
              </AddressRow>

              {/* Balances */}
              <BalanceList>
                <BalanceRow>
                  <TokenInfo>
                    <TokenIcon src="/img/lunes-green.svg" alt="LUNES" />
                    <div>
                      <TokenName>LUNES</TokenName>
                      <TokenSub>Native</TokenSub>
                    </div>
                  </TokenInfo>
                  <TokenAmount>
                    <span className="amount">{fullBalance}</span>
                    <span className="usd">
                      ≈ $
                      {(Number(balance) * 0.045).toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })}
                    </span>
                  </TokenAmount>
                </BalanceRow>

                <BalanceRow>
                  <TokenInfo>
                    <TokenIcon src="/img/lusdt.svg" alt="lUSDT" />
                    <div>
                      <TokenName>lUSDT</TokenName>
                      <TokenSub>PSP22</TokenSub>
                    </div>
                  </TokenInfo>
                  <TokenAmount>
                    <span className="amount">0.00</span>
                    <span className="usd">≈ $0.00</span>
                  </TokenAmount>
                </BalanceRow>
              </BalanceList>

              {/* Actions */}
              <ModalActions>
                <DisconnectBtn
                  onClick={() => {
                    disconnectWallet()
                    setShowModal(false)
                  }}
                >
                  Disconnect Wallet
                </DisconnectBtn>
              </ModalActions>
            </Modal>
          </Overlay>
        )}
      </>
    )
  }

  return (
    <ConnectButton onClick={() => connectWallet()} disabled={isLoading}>
      <Wallet size={16} />
      {isLoading ? 'Connecting...' : 'Connect Wallet'}
    </ConnectButton>
  )
}

// ─── Styled Components ──────────────────────────────────────────

const WalletContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const BalanceDisplay = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 7px 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(0, 229, 160, 0.2);
  }

  img {
    flex-shrink: 0;
  }

  span {
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-weight: 600;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.9);
    white-space: nowrap;
  }

  svg {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }
`

const WalletButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border: none;
  border-radius: 20px;
  padding: 7px 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    filter: brightness(1.15);
  }

  span {
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-weight: 600;
    font-size: 13px;
    color: #fff;
  }
`

const WalletIconWrap = styled.div`
  display: flex;
  align-items: center;
  color: #fff;
`

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const slideUp = keyframes`
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 70px 20px 20px;
  z-index: 9999;
  animation: ${fadeIn} 0.15s ease;
`

const Modal = styled.div`
  width: 360px;
  max-width: 95vw;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
  animation: ${slideUp} 0.2s ease;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
`

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);

  h3 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    margin: 0;
  }
`

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 4px;
  border-radius: 8px;
  display: flex;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`

const AddressRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.02);
`

const AddressText = styled.span`
  font-family: 'Space Grotesk', monospace;
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
`

const AddressActions = styled.div`
  display: flex;
  gap: 6px;
`

const ActionBtn = styled.button`
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 8px;
  padding: 6px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  position: relative;
  transition: all 0.2s;
  text-decoration: none;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #00e5a0;
  }
`

const CopiedTooltip = styled.span`
  position: absolute;
  top: -28px;
  left: 50%;
  transform: translateX(-50%);
  background: #00e5a0;
  color: #000;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  animation: ${fadeIn} 0.15s ease;
`

const BalanceList = styled.div`
  padding: 8px 0;
`

const BalanceRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
`

const TokenInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const TokenIcon = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px;
`

const TokenName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
`

const TokenSub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 1px;
`

const TokenAmount = styled.div`
  text-align: right;

  .amount {
    display: block;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }

  .usd {
    display: block;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
    margin-top: 1px;
  }
`

const ModalActions = styled.div`
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
`

const DisconnectBtn = styled.button`
  width: 100%;
  padding: 10px;
  background: rgba(255, 60, 60, 0.08);
  border: 1px solid rgba(255, 60, 60, 0.15);
  border-radius: 10px;
  color: #ff5c5c;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 60, 60, 0.15);
    border-color: rgba(255, 60, 60, 0.3);
  }
`

const ConnectButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #00e5a0, #00c88a);
  border: none;
  border-radius: 20px;
  padding: 8px 18px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Space Grotesk', 'Inter', sans-serif;
  font-weight: 600;
  font-size: 13px;
  color: #000;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

export default ConnectWallet
