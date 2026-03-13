import React, { useState } from 'react'
import styled, { css } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import * as B from '../../components/bases'
import PageLayout from '../../components/layout'
import { useLiquidity } from '../../hooks'
import { useSDK } from '../../context/SDKContext'
import TradeSubNav from '../../components/tradeSubNav'
import TokenIcon from '../../components/TokenIcon'

const ProBanner = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px 18px;
  border-radius: 14px;
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.08);
  cursor: pointer;
  transition: all 0.18s;

  &:hover {
    background: rgba(99, 102, 241, 0.16);
    border-color: rgba(99, 102, 241, 0.6);
  }
`

const ProBannerLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const ProBannerIcon = styled.span`
  font-size: 20px;
`

const ProBannerText = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`

const ProBannerTitle = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const ProBannerSubtitle = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const ProBannerArrow = styled.span`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

// Real deployed token addresses
const availableTokens = [
  { address: process.env.REACT_APP_TOKEN_WLUNES || '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo', symbol: 'WLUNES', name: 'Wrapped Lunes', decimals: 8, icon: '/img/lunes.svg' },
  { address: process.env.REACT_APP_TOKEN_LUSDT || '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf', symbol: 'LUSDT', name: 'Lunes USD', decimals: 6, icon: '/img/lusdt.svg' },
  { address: process.env.REACT_APP_TOKEN_LBTC || '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg', symbol: 'LBTC', name: 'Lunes BTC', decimals: 8, icon: '/img/lbtc.svg' },
  { address: process.env.REACT_APP_TOKEN_LETH || '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS', symbol: 'LETH', name: 'Lunes ETH', decimals: 18, icon: '/img/leth.svg' },
  { address: process.env.REACT_APP_TOKEN_GMC || '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ', symbol: 'GMC', name: 'GameCoin', decimals: 8, icon: '/img/gmc.svg' },
  { address: process.env.REACT_APP_TOKEN_LUP || '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3', symbol: 'LUP', name: 'Lunex Protocol', decimals: 8, icon: '/img/lup.svg' },
]





const TabContainer = styled.div`
  display: flex;
  gap: 8px;
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 4px;
`

const Tab = styled.button<{ active: boolean }>`
  flex: 1;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
  
  background: ${({ active, theme }) => active ? theme.colors.themeColors[800] : 'transparent'};
  color: ${({ active, theme }) => active ? theme.colors.themeColors[100] : theme.colors.themeColors[200]};
  
  &:hover {
    background: ${({ active, theme }) => active ? theme.colors.themeColors[800] : theme.colors.themeColors[400]};
  }
`

const InputContainer = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 16px;
  padding: 16px;
`

const InputHeader = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
`

const Label = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const Balance = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const InputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const Input = styled.input`
  flex: 1;
  background: transparent;
  border: none;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  outline: none;
  
  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[200]};
  }
  
  &:disabled {
    opacity: 0.5;
  }
`

const TokenButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${({ theme }) => theme.colors.themeColors[400]};
  border: none;
  border-radius: 16px;
  padding: 8px 12px;
  cursor: pointer;
  
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  
  img {
    width: 24px;
    height: 24px;
  }
  
  &:hover {
    opacity: 0.9;
  }
`

const PlusIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const PoolInfoContainer = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 16px;
`

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  
  span {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    color: ${({ theme }) => theme.colors.themeColors[200]};
    
    &:last-child {
      color: ${({ theme }) => theme.colors.themeColors[100]};
    }
  }
`

const ActionButton = styled.button`
  width: 100%;
  padding: 16px 24px;
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: none;
  border-radius: 16px;
  cursor: pointer;
  
  font-family: 'Space Grotesk', sans-serif;
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

const MaxButton = styled.button`
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  
  &:hover {
    opacity: 0.9;
  }
`

const ErrorMessage = styled.div`
  padding: 12px;
  background: rgba(255, 0, 0, 0.1);
  border: 1px solid rgba(255, 0, 0, 0.3);
  border-radius: 8px;
  color: #ff6b6b;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
`

const TokenSelectModal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`

const ModalContent = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 16px;
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  overflow: hidden;
`

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[300]};
  
  h3 {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 18px;
    color: ${({ theme }) => theme.colors.themeColors[100]};
    margin: 0;
  }
`

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 24px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  cursor: pointer;
  
  &:hover {
    color: ${({ theme }) => theme.colors.themeColors[100]};
  }
`

const TokenList = styled.div`
  max-height: 400px;
  overflow-y: auto;
`

const TokenItem = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  cursor: pointer;
  
  &:hover {
    background: ${({ theme }) => theme.colors.themeColors[600]};
  }
  
  img {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: contain;
  }
  
  div {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 2px;
    
    span {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 16px;
      line-height: 1;
      color: ${({ theme }) => theme.colors.themeColors[100]};
    }
    
    small {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      line-height: 1;
      color: ${({ theme }) => theme.colors.themeColors[200]};
    }
  }
`

const Pool: React.FC = () => {
  const sdk = useSDK()
  const liquidity = useLiquidity()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add')
  const [showTokenSelectA, setShowTokenSelectA] = useState(false)
  const [showTokenSelectB, setShowTokenSelectB] = useState(false)
  const [lpAmountToRemove, setLpAmountToRemove] = useState('')

  // Handlers
  const handleSelectTokenA = (token: typeof availableTokens[0]) => {
    liquidity.setTokenA(token)
    setShowTokenSelectA(false)
  }

  const handleSelectTokenB = (token: typeof availableTokens[0]) => {
    liquidity.setTokenB(token)
    setShowTokenSelectB(false)
  }

  const handleAddLiquidity = async () => {
    const success = await liquidity.addLiquidity()
    if (success) {
      alert('Liquidity added successfully!')
    }
  }

  const handleRemoveLiquidity = async () => {
    if (!lpAmountToRemove) return
    const success = await liquidity.removeLiquidity(lpAmountToRemove)
    if (success) {
      alert('Liquidity removed successfully!')
      setLpAmountToRemove('')
    }
  }

  return (
    <PageLayout maxWidth="592px">
      {/* Navigation Header - shared sub-nav identical to home page */}
      <TradeSubNav active="pool" />

      {/* Pro Mode Banner */}
      <ProBanner onClick={() => navigate('/pool/asymmetric')}>
        <ProBannerLeft>
          <ProBannerIcon><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></ProBannerIcon>
          <ProBannerText>
            <ProBannerTitle>Asymmetric Liquidity — Pro Mode</ProBannerTitle>
            <ProBannerSubtitle>Parametric curves, templates &amp; AI delegation</ProBannerSubtitle>
          </ProBannerText>
        </ProBannerLeft>
        <ProBannerArrow>›</ProBannerArrow>
      </ProBanner>

      {/* Tabs */}
      <TabContainer>
        <Tab active={activeTab === 'add'} onClick={() => setActiveTab('add')}>
          Add Liquidity
        </Tab>
        <Tab active={activeTab === 'remove'} onClick={() => setActiveTab('remove')}>
          Remove Liquidity
        </Tab>
      </TabContainer>

      {activeTab === 'add' ? (
        <>
          {/* Token A Input */}
          <InputContainer>
            <InputHeader>
              <Label>Token A</Label>
              {sdk.walletAddress && liquidity.tokenA && (
                <Balance>Balance: 0</Balance>
              )}
            </InputHeader>
            <InputRow>
              <Input
                type="number"
                placeholder="0.0"
                value={liquidity.amountA}
                onChange={(e) => liquidity.setAmountA(e.target.value)}
                disabled={!liquidity.tokenA}
              />
              <TokenButton onClick={() => setShowTokenSelectA(true)}>
                {liquidity.tokenA ? (
                  <>
                    <TokenIcon address={liquidity.tokenA.address} symbol={liquidity.tokenA.symbol} size={24} />
                    {liquidity.tokenA.symbol}
                  </>
                ) : (
                  'Select'
                )}
                <img src="/img/arrow-down.svg" alt="Select" />
              </TokenButton>
            </InputRow>
          </InputContainer>

          {/* Plus Icon */}
          <PlusIcon>+</PlusIcon>

          {/* Token B Input */}
          <InputContainer>
            <InputHeader>
              <Label>Token B</Label>
              {sdk.walletAddress && liquidity.tokenB && (
                <Balance>Balance: 0</Balance>
              )}
            </InputHeader>
            <InputRow>
              <Input
                type="number"
                placeholder="0.0"
                value={liquidity.amountB}
                onChange={(e) => liquidity.setAmountB(e.target.value)}
                disabled={!liquidity.tokenB}
              />
              <TokenButton onClick={() => setShowTokenSelectB(true)}>
                {liquidity.tokenB ? (
                  <>
                    <TokenIcon address={liquidity.tokenB.address} symbol={liquidity.tokenB.symbol} size={24} />
                    {liquidity.tokenB.symbol}
                  </>
                ) : (
                  'Select'
                )}
                <img src="/img/arrow-down.svg" alt="Select" />
              </TokenButton>
            </InputRow>
          </InputContainer>

          {/* Pool Info */}
          {liquidity.poolInfo && (
            <PoolInfoContainer>
              <InfoRow>
                <span>Price</span>
                <span>
                  1 {liquidity.tokenA?.symbol} = {Number(liquidity.poolInfo.token0Price).toFixed(6)} {liquidity.tokenB?.symbol}
                </span>
              </InfoRow>
              <InfoRow>
                <span>Pool Share</span>
                <span>{liquidity.poolInfo.poolShare}%</span>
              </InfoRow>
              <InfoRow>
                <span>Your LP Balance</span>
                <span>{sdk.formatAmount(liquidity.poolInfo.lpBalance, 8)}</span>
              </InfoRow>
            </PoolInfoContainer>
          )}

          {/* Action Button */}
          {!sdk.isConnected ? (
            <ActionButton onClick={() => sdk.connectWallet()}>
              Connect Wallet
            </ActionButton>
          ) : (
            <ActionButton
              onClick={handleAddLiquidity}
              disabled={!liquidity.tokenA || !liquidity.tokenB || !liquidity.amountA || liquidity.isLoading}
            >
              {liquidity.isLoading ? 'Processing...' : 'Add Liquidity'}
            </ActionButton>
          )}
        </>
      ) : (
        <>
          {/* Remove Liquidity */}
          <InputContainer>
            <InputHeader>
              <Label>LP Tokens to remove</Label>
              {liquidity.poolInfo && (
                <Balance>Balance: {sdk.formatAmount(liquidity.poolInfo.lpBalance, 8)}</Balance>
              )}
            </InputHeader>
            <InputRow>
              <Input
                type="number"
                placeholder="0.0"
                value={lpAmountToRemove}
                onChange={(e) => setLpAmountToRemove(e.target.value)}
              />
              <MaxButton onClick={() => {
                if (liquidity.poolInfo) {
                  setLpAmountToRemove(liquidity.poolInfo.lpBalance)
                }
              }}>
                MAX
              </MaxButton>
            </InputRow>
          </InputContainer>

          {/* Expected Output */}
          {liquidity.poolInfo && lpAmountToRemove && (
            <PoolInfoContainer>
              <InfoRow>
                <span>You will receive (estimated)</span>
              </InfoRow>
              <InfoRow>
                <span>{liquidity.tokenA?.symbol}</span>
                <span>~{calculateExpectedAmount(lpAmountToRemove, liquidity.poolInfo.reserve0, liquidity.poolInfo.totalSupply)}</span>
              </InfoRow>
              <InfoRow>
                <span>{liquidity.tokenB?.symbol}</span>
                <span>~{calculateExpectedAmount(lpAmountToRemove, liquidity.poolInfo.reserve1, liquidity.poolInfo.totalSupply)}</span>
              </InfoRow>
            </PoolInfoContainer>
          )}

          {/* Action Button */}
          {!sdk.isConnected ? (
            <ActionButton onClick={() => sdk.connectWallet()}>
              Connect Wallet
            </ActionButton>
          ) : (
            <ActionButton
              onClick={handleRemoveLiquidity}
              disabled={!lpAmountToRemove || liquidity.isLoading}
            >
              {liquidity.isLoading ? 'Processing...' : 'Remove Liquidity'}
            </ActionButton>
          )}
        </>
      )}

      {liquidity.error && <ErrorMessage>{liquidity.error}</ErrorMessage>}

      {/* Token Select Modal A */}
      {showTokenSelectA && (
        <TokenSelectModal>
          <ModalContent>
            <ModalHeader>
              <h3>Selecionar Token</h3>
              <CloseButton onClick={() => setShowTokenSelectA(false)}>×</CloseButton>
            </ModalHeader>
            <TokenList>
              {availableTokens.map(token => (
                <TokenItem key={token.address} onClick={() => handleSelectTokenA(token)}>
                  <TokenIcon address={token.address} symbol={token.symbol} size={36} />
                  <div>
                    <span>{token.symbol}</span>
                    <small>{token.name}</small>
                  </div>
                </TokenItem>
              ))}
            </TokenList>
          </ModalContent>
        </TokenSelectModal>
      )}

      {/* Token Select Modal B */}
      {showTokenSelectB && (
        <TokenSelectModal>
          <ModalContent>
            <ModalHeader>
              <h3>Selecionar Token</h3>
              <CloseButton onClick={() => setShowTokenSelectB(false)}>×</CloseButton>
            </ModalHeader>
            <TokenList>
              {availableTokens.map(token => (
                <TokenItem key={token.address} onClick={() => handleSelectTokenB(token)}>
                  <TokenIcon address={token.address} symbol={token.symbol} size={36} />
                  <div>
                    <span>{token.symbol}</span>
                    <small>{token.name}</small>
                  </div>
                </TokenItem>
              ))}
            </TokenList>
          </ModalContent>
        </TokenSelectModal>
      )}
    </PageLayout>
  )
}

// Helper function
const calculateExpectedAmount = (lpAmount: string, reserve: string, totalSupply: string): string => {
  try {
    const lp = BigInt(lpAmount)
    const res = BigInt(reserve)
    const total = BigInt(totalSupply)
    if (total === BigInt(0)) return '0'
    const result = (lp * res) / total
    return result.toString()
  } catch {
    return '0'
  }
}

export default Pool
