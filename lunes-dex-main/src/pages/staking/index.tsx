import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css } from 'styled-components'
import * as B from '../../components/bases'
import { useSDK } from '../../context/SDKContext'
import PageLayout from '../../components/layout'
import TradeSubNav from '../../components/tradeSubNav'






const Header = styled.div`
  text-align: center;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 32px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0 0 8px 0;
`

const Subtitle = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin: 0;
`

const StatsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
`

const StatCard = styled.div<{ highlight?: boolean }>`
  background: ${({ theme, highlight }) => highlight ? theme.colors.themeColors[800] : theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 16px;
  text-align: center;
`

const StatLabel = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin-bottom: 4px;
`

const StatValue = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const UserInfoContainer = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 16px;
`

const UserInfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  
  &:not(:last-child) {
    border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[300]};
  }
  
  span {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    
    &:first-child {
      color: ${({ theme }) => theme.colors.themeColors[200]};
    }
    
    &:last-child {
      color: ${({ theme }) => theme.colors.themeColors[100]};
      font-weight: 600;
    }
  }
`

const RewardsValue = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-weight: 600;
`

const ClaimButton = styled.button`
  background: #26d07c;
  border: none;
  border-radius: 8px;
  padding: 4px 12px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #000;
  cursor: pointer;
  
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

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
  font-family: 'Inter', sans-serif;
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
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const MaxButton = styled.button`
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  
  &:hover {
    opacity: 0.9;
  }
`

const Input = styled.input`
  width: 100%;
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
`

const HelpText = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin-top: 8px;
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

const InfoSection = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 16px;
`

const InfoTitle = styled.h3`
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0 0 12px 0;
`

const InfoList = styled.ul`
  margin: 0;
  padding-left: 20px;
  
  li {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    color: ${({ theme }) => theme.colors.themeColors[200]};
    margin-bottom: 8px;
    
    &:last-child {
      margin-bottom: 0;
    }
  }
`

interface StakingInfo {
  totalStaked: string
  userStaked: string
  pendingRewards: string
  apr: string
  lockPeriod: number
}

const Staking: React.FC = () => {
  const sdk = useSDK()
  const navigate = useNavigate()

  // Estado local
  const [stakingInfo, setStakingInfo] = useState<StakingInfo | null>(null)
  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake'>('stake')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lpBalance, setLpBalance] = useState('0')

  // Endereço do contrato de staking (configurável via env)
  const STAKING_CONTRACT = process.env.REACT_APP_STAKING_CONTRACT || ''
  const LP_TOKEN = process.env.REACT_APP_LP_TOKEN_LUNES_USDT || ''

  // Buscar informações de staking
  const fetchStakingInfo = useCallback(async () => {
    if (!sdk.walletAddress) return

    setIsLoading(true)
    try {
      // Obter informações do usuário em staking usando context (que utiliza contractService)
      const userInfo = await sdk.getStakingUserInfo(sdk.walletAddress)

      if (userInfo) {
        setStakingInfo(userInfo)
      }

      // Buscar balance de LP tokens
      if (LP_TOKEN) {
        const balance = await sdk.getTokenBalance(LP_TOKEN, sdk.walletAddress)
        setLpBalance(sdk.formatAmount(balance, 8))
      }
    } catch (err: unknown) {
      console.error('Error fetching staking info:', err)
      setError((err as Error).message || 'Error loading data')
    } finally {
      setIsLoading(false)
    }
  }, [sdk, LP_TOKEN])

  useEffect(() => {
    fetchStakingInfo()
  }, [fetchStakingInfo])

  // Handler para stake
  const handleStake = async () => {
    if (!stakeAmount || !sdk.walletAddress) return

    setIsLoading(true)
    setError(null)

    try {
      // Amount provided assumes it's fully formatted, SDK or ContractService might expect raw big numbers.
      // But assuming `sdk.stake` handles it internally or logs it in placeholder.
      const rawAmount = sdk.parseAmount(stakeAmount, 8)
      const success = await sdk.stake(rawAmount)

      if (success) {
        alert('Stake successful!')
        setStakeAmount('')
        await fetchStakingInfo()
      } else {
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao fazer stake')
    } finally {
      setIsLoading(false)
    }
  }

  // Handler para unstake
  const handleUnstake = async () => {
    if (!unstakeAmount || !sdk.walletAddress) return

    setIsLoading(true)
    setError(null)

    try {
      const rawAmount = sdk.parseAmount(unstakeAmount, 8)
      const success = await sdk.unstake(rawAmount)

      if (success) {
        alert('Unstake successful!')
        setUnstakeAmount('')
        await fetchStakingInfo()
      } else {
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao fazer unstake')
    } finally {
      setIsLoading(false)
    }
  }

  // Handler para claim rewards
  const handleClaimRewards = async () => {
    if (!sdk.walletAddress || !stakingInfo?.pendingRewards) return

    setIsLoading(true)
    setError(null)

    try {
      const success = await sdk.claimRewards()
      if (success) {
        alert('Rewards claimed successfully!')
        await fetchStakingInfo()
      } else {
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Error claiming rewards')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageLayout maxWidth="592px">
      {/* Navigation Header - shared sub-nav identical to home page */}
      <TradeSubNav active="staking" />

      <Header>
        <Title>Staking</Title>
        <Subtitle>Stake LP tokens and earn rewards</Subtitle>
      </Header>

      {/* Stats Cards */}
      <StatsContainer>
        <StatCard>
          <StatLabel>Total Staked</StatLabel>
          <StatValue>
            {stakingInfo ? sdk.formatAmount(stakingInfo.totalStaked, 8) : '0'} LP
          </StatValue>
        </StatCard>
        <StatCard highlight>
          <StatLabel>APR</StatLabel>
          <StatValue>{stakingInfo?.apr || '0'}%</StatValue>
        </StatCard>
        <StatCard>
          <StatLabel>Lock Period</StatLabel>
          <StatValue>{stakingInfo?.lockPeriod || 7} days</StatValue>
        </StatCard>
      </StatsContainer>

      {/* User Info */}
      {sdk.isConnected && stakingInfo && (
        <UserInfoContainer>
          <UserInfoRow>
            <span>Your Stake</span>
            <span>{sdk.formatAmount(stakingInfo.userStaked, 8)} LP</span>
          </UserInfoRow>
          <UserInfoRow>
            <span>Pending Rewards</span>
            <RewardsValue>
              {sdk.formatAmount(stakingInfo.pendingRewards, 8)} LUNES
              {Number(stakingInfo.pendingRewards) > 0 && (
                <ClaimButton onClick={handleClaimRewards} disabled={isLoading}>
                  Claim
                </ClaimButton>
              )}
            </RewardsValue>
          </UserInfoRow>
          <UserInfoRow>
            <span>Available LP Balance</span>
            <span>{lpBalance} LP</span>
          </UserInfoRow>
        </UserInfoContainer>
      )}

      {/* Tabs */}
      <TabContainer>
        <Tab active={activeTab === 'stake'} onClick={() => setActiveTab('stake')}>
          Stake
        </Tab>
        <Tab active={activeTab === 'unstake'} onClick={() => setActiveTab('unstake')}>
          Unstake
        </Tab>
      </TabContainer>

      {/* Input Section */}
      {activeTab === 'stake' ? (
        <InputContainer>
          <InputHeader>
            <Label>Amount to Stake</Label>
            <MaxButton onClick={() => setStakeAmount(lpBalance)}>MAX</MaxButton>
          </InputHeader>
          <Input
            type="number"
            placeholder="0.0"
            value={stakeAmount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStakeAmount(e.target.value)}
          />
          <HelpText>Available LP tokens: {lpBalance}</HelpText>
        </InputContainer>
      ) : (
        <InputContainer>
          <InputHeader>
            <Label>Amount to Unstake</Label>
            <MaxButton onClick={() => {
              if (stakingInfo) {
                setUnstakeAmount(sdk.formatAmount(stakingInfo.userStaked, 8))
              }
            }}>MAX</MaxButton>
          </InputHeader>
          <Input
            type="number"
            placeholder="0.0"
            value={unstakeAmount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUnstakeAmount(e.target.value)}
          />
          <HelpText>
            Staked: {stakingInfo ? sdk.formatAmount(stakingInfo.userStaked, 8) : '0'} LP
          </HelpText>
        </InputContainer>
      )}

      {/* Error Message */}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {!sdk.isConnected ? (
        <B.Button onClick={sdk.connectWallet} width="100%" padding="16px 24px" margin="0" style={{ borderRadius: '16px' }}>
          Connect Wallet
        </B.Button>
      ) : activeTab === 'stake' ? (
        <B.Button
          onClick={handleStake}
          disabled={isLoading || !stakeAmount || Number(stakeAmount) <= 0}
          width="100%"
          padding="16px 24px"
          margin="0"
          style={{ borderRadius: '16px' }}
        >
          {isLoading ? 'Processing...' : 'Stake'}
        </B.Button>
      ) : (
        <B.Button
          onClick={handleUnstake}
          disabled={isLoading || !unstakeAmount || Number(unstakeAmount) <= 0}
          width="100%"
          padding="16px 24px"
          margin="0"
          style={{ borderRadius: '16px' }}
        >
          {isLoading ? 'Processing...' : 'Unstake'}
        </B.Button>
      )}

      {/* Info Section */}
      <InfoSection>
        <InfoTitle>How it works?</InfoTitle>
        <InfoList>
          <li>Add liquidity to the LUNES/USDT pool to receive LP tokens</li>
          <li>Stake LP tokens to earn LUNES rewards</li>
          <li>Current APR: {stakingInfo?.apr || '120'}% per year</li>
          <li>Lock period: {stakingInfo?.lockPeriod || 7} days</li>
          <li>Rewards are distributed every block</li>
        </InfoList>
      </InfoSection>
    </PageLayout>
  )
}

export default Staking
