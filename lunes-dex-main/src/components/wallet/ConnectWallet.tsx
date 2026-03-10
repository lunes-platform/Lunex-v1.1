import React from 'react'
import styled from 'styled-components'
import { useSDK } from '../../context/SDKContext'

const ConnectWallet: React.FC = () => {
  const { isConnected, walletAddress, balance, connectWallet, disconnectWallet, isLoading } = useSDK()

  // Formatar endereço para exibição
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  if (isConnected && walletAddress) {
    return (
      <WalletContainer>
        <BalanceDisplay>
          <span>{Number(balance).toLocaleString()} LUNES</span>
        </BalanceDisplay>
        <WalletButton onClick={disconnectWallet}>
          <WalletIcon>
            <img src="/img/wallet-icon.svg" alt="Wallet" />
          </WalletIcon>
          <span>{formatAddress(walletAddress)}</span>
        </WalletButton>
      </WalletContainer>
    )
  }

  return (
    <ConnectButton onClick={connectWallet} disabled={isLoading}>
      {isLoading ? 'Conectando...' : 'Conectar Wallet'}
    </ConnectButton>
  )
}

// Styled Components
const WalletContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const BalanceDisplay = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 16px;
  padding: 16px;
  
  span {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    font-size: 16px;
    color: ${({ theme }) => theme.colors.themeColors[100]};
  }
`

const WalletButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: none;
  border-radius: 16px;
  padding: 8px 16px;
  cursor: pointer;
  transition: opacity 0.2s;
  
  &:hover {
    opacity: 0.9;
  }
  
  span {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    font-size: 14px;
    color: ${({ theme }) => theme.colors.themeColors[100]};
  }
`

const WalletIcon = styled.div`
  width: 24px;
  height: 24px;
  
  img {
    width: 100%;
    height: 100%;
  }
`

const ConnectButton = styled.button`
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: none;
  border-radius: 16px;
  padding: 16px 24px;
  cursor: pointer;
  transition: opacity 0.2s;
  
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

export default ConnectWallet
