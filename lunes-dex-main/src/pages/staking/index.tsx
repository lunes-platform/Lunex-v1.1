import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css, keyframes } from 'styled-components'
import * as B from '../../components/bases'
import { useSDK, parseBlockchainError } from '../../context/SDKContext'
import PageLayout from '../../components/layout'
import TradeSubNav from '../../components/tradeSubNav'
import { CONTRACTS, TOKENS } from '../../config/contracts'

// ─── Transaction Phase ───────────────────────────────────────────
type TxPhase = 'idle' | 'signing' | 'processing' | 'success' | 'error'

// ─── Animations ──────────────────────────────────────────────────
const spin = keyframes`
  to { transform: rotate(360deg); }
`

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
`

// ─── Styled Components ──────────────────────────────────────────

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
  font-family: 'Space Grotesk', sans-serif;
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
  border: 1px solid transparent;
  outline: none;
  transition: all 0.2s;

  &:focus-within {
    background-color: ${({ theme }) => theme.colors.themeColors[500]};
    border: 1px solid ${({ theme }) => theme.colors.themeColors[800]};
    box-shadow: 0px 0px 0px 1px rgba(0, 0, 0, 0.6), 0px 0px 0px 4px rgba(108, 56, 255, 0.3);
  }
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

const Input = styled.input`
  width: 100%;
  background: transparent;
  border: none;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  outline: none;
  border-radius: 0;
  
  &:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }
  
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
  animation: ${fadeIn} 0.3s ease;
`

const SuccessMessage = styled.div`
  padding: 12px;
  background: rgba(38, 208, 124, 0.1);
  border: 1px solid rgba(38, 208, 124, 0.3);
  border-radius: 8px;
  color: #26d07c;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  animation: ${fadeIn} 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
`

const InfoSection = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 16px;
`

const InfoTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
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

// ─── Coming Soon Banner ──────────────────────────────────────────
const ComingSoonBanner = styled.div`
  padding: 20px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 14px;
  text-align: center;
  animation: ${fadeIn} 0.4s ease;
`

const ComingSoonTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0 0 8px 0;
`

const ComingSoonText = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin: 0;
  line-height: 1.5;
`

// ─── Transaction Status Banner ──────────────────────────────────
const TxStatusBanner = styled.div<{ phase: TxPhase }>`
  padding: 14px 16px;
  border-radius: 12px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  animation: ${fadeIn} 0.3s ease;
  
  ${({ phase }) => {
    switch (phase) {
      case 'signing':
        return css`
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.35);
          color: #a78bfa;
        `
      case 'processing':
        return css`
          background: rgba(251, 191, 36, 0.1);
          border: 1px solid rgba(251, 191, 36, 0.35);
          color: #fbbf24;
        `
      case 'success':
        return css`
          background: rgba(38, 208, 124, 0.1);
          border: 1px solid rgba(38, 208, 124, 0.3);
          color: #26d07c;
        `
      case 'error':
        return css`
          background: rgba(255, 0, 0, 0.1);
          border: 1px solid rgba(255, 0, 0, 0.3);
          color: #ff6b6b;
        `
      default:
        return ''
    }
  }}
`

const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
  flex-shrink: 0;
`

// ─── Contract availability check ────────────────────────────────
const stakingAvailable = CONTRACTS.STAKING.length >= 10

// ─── Interfaces ─────────────────────────────────────────────────
interface StakingInfo {
  totalStaked: string
  userStaked: string
  pendingRewards: string
  apr: string
  lockPeriod: number
}

// ─── Component ──────────────────────────────────────────────────
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
  const [lpTokenAddress, setLpTokenAddress] = useState<string>('')
  const [txPhase, setTxPhase] = useState<TxPhase>('idle')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Clear success message after 5s
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [successMsg])

  // Buscar LP token address dinamicamente do Factory (WLUNES/LUSDT pair)
  const fetchLpBalance = useCallback(async () => {
    if (!sdk.walletAddress || !sdk.isConnected) return

    try {
      // Buscar o par LP do Factory (WLUNES/LUSDT)
      const pairInfo = await sdk.getPairInfo(TOKENS.WLUNES, TOKENS.LUSDT)

      if (pairInfo?.address) {
        setLpTokenAddress(pairInfo.address)
        // Buscar balance de LP tokens do par encontrado
        const balance = await sdk.getTokenBalance(pairInfo.address, sdk.walletAddress)
        setLpBalance(sdk.formatAmount(balance, 8))
      }
    } catch (err: unknown) {
      console.error('Error fetching LP balance:', err)
      // Silently fail — LP balance stays at '0'
    }
  }, [sdk])

  // Buscar informações de staking (separado do LP balance)
  const fetchStakingInfo = useCallback(async () => {
    if (!sdk.walletAddress) return

    setIsLoading(true)
    try {
      // LP balance é buscado independente do contrato de staking
      await fetchLpBalance()

      // Staking info só se o contrato estiver deployado
      if (stakingAvailable) {
        const userInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
        if (userInfo) {
          setStakingInfo(userInfo)
        }
      }
    } catch (err: unknown) {
      console.error('Error fetching staking info:', err)
      setError(parseBlockchainError(err))
    } finally {
      setIsLoading(false)
    }
  }, [sdk, fetchLpBalance])

  useEffect(() => {
    fetchStakingInfo()
  }, [fetchStakingInfo])

  // Handler para stake
  const handleStake = async () => {
    if (!stakeAmount || !sdk.walletAddress || !stakingAvailable) return

    // Input validation
    const amount = Number(stakeAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Enter a valid positive amount')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccessMsg(null)
    setTxPhase('signing')

    try {
      const rawAmount = sdk.parseAmount(stakeAmount, 8)

      setTxPhase('processing')
      const success = await sdk.stake(rawAmount)

      if (success) {
        setTxPhase('success')
        setSuccessMsg('Stake successful! Your LP tokens have been staked.')
        setStakeAmount('')
        await fetchStakingInfo()
      } else {
        setTxPhase('error')
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setTxPhase('error')
      setError(parseBlockchainError(err))
    } finally {
      setIsLoading(false)
      // Reset phase after delay (keep success/error visible)
      setTimeout(() => setTxPhase('idle'), 4000)
    }
  }

  // Handler para unstake
  const handleUnstake = async () => {
    if (!unstakeAmount || !sdk.walletAddress || !stakingAvailable) return

    const amount = Number(unstakeAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Enter a valid positive amount')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccessMsg(null)
    setTxPhase('signing')

    try {
      const rawAmount = sdk.parseAmount(unstakeAmount, 8)

      setTxPhase('processing')
      const success = await sdk.unstake(rawAmount)

      if (success) {
        setTxPhase('success')
        setSuccessMsg('Unstake successful! Your LP tokens have been returned.')
        setUnstakeAmount('')
        await fetchStakingInfo()
      } else {
        setTxPhase('error')
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setTxPhase('error')
      setError(parseBlockchainError(err))
    } finally {
      setIsLoading(false)
      setTimeout(() => setTxPhase('idle'), 4000)
    }
  }

  // Handler para claim rewards
  const handleClaimRewards = async () => {
    if (!sdk.walletAddress || !stakingInfo?.pendingRewards || !stakingAvailable) return

    setIsLoading(true)
    setError(null)
    setSuccessMsg(null)
    setTxPhase('signing')

    try {
      setTxPhase('processing')
      const success = await sdk.claimRewards()
      if (success) {
        setTxPhase('success')
        setSuccessMsg('Rewards claimed successfully!')
        await fetchStakingInfo()
      } else {
        setTxPhase('error')
        setError('Transaction failed')
      }
    } catch (err: unknown) {
      setTxPhase('error')
      setError(parseBlockchainError(err))
    } finally {
      setIsLoading(false)
      setTimeout(() => setTxPhase('idle'), 4000)
    }
  }

  // ─── Transaction Phase Label ──────────────────────────────────
  const getTxPhaseLabel = (): string => {
    switch (txPhase) {
      case 'signing': return 'Waiting for wallet signature...'
      case 'processing': return 'Processing transaction on blockchain...'
      case 'success': return 'Transaction confirmed!'
      case 'error': return 'Transaction failed'
      default: return ''
    }
  }

  return (
    <PageLayout maxWidth="592px">
      {/* Navigation Header */}
      <TradeSubNav active="staking" />

      <Header>
        <Title>Staking</Title>
        <Subtitle>Stake LP tokens and earn rewards</Subtitle>
      </Header>

      {/* Contract Not Deployed Banner */}
      {!stakingAvailable && (
        <ComingSoonBanner>
          <ComingSoonTitle>⏳ Staking — Coming Soon</ComingSoonTitle>
          <ComingSoonText>
            The staking contract is being prepared for deployment on the Lunes blockchain.
            Once deployed, you'll be able to stake your LP tokens and earn LUNES rewards.
          </ComingSoonText>
        </ComingSoonBanner>
      )}

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
                <ClaimButton onClick={handleClaimRewards} disabled={isLoading || !stakingAvailable}>
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
            disabled={!stakingAvailable}
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
            disabled={!stakingAvailable}
          />
          <HelpText>
            Staked: {stakingInfo ? sdk.formatAmount(stakingInfo.userStaked, 8) : '0'} LP
          </HelpText>
        </InputContainer>
      )}

      {/* Transaction Phase Status */}
      {txPhase !== 'idle' && (
        <TxStatusBanner phase={txPhase}>
          {(txPhase === 'signing' || txPhase === 'processing') && <Spinner />}
          {txPhase === 'success' && '✓'}
          {txPhase === 'error' && '✕'}
          {getTxPhaseLabel()}
        </TxStatusBanner>
      )}

      {/* Success Message */}
      {successMsg && txPhase === 'idle' && (
        <SuccessMessage>✓ {successMsg}</SuccessMessage>
      )}

      {/* Error Message */}
      {error && txPhase === 'idle' && <ErrorMessage>{error}</ErrorMessage>}

      {!sdk.isConnected ? (
        <B.Button onClick={() => sdk.connectWallet()} width="100%" padding="16px 24px" margin="0" style={{ borderRadius: '16px' }}>
          Connect Wallet
        </B.Button>
      ) : activeTab === 'stake' ? (
        <B.Button
          onClick={handleStake}
          disabled={isLoading || !stakeAmount || Number(stakeAmount) <= 0 || !stakingAvailable}
          width="100%"
          padding="16px 24px"
          margin="0"
          style={{ borderRadius: '16px' }}
        >
          {isLoading ? 'Processing...' : !stakingAvailable ? 'Coming Soon' : 'Stake'}
        </B.Button>
      ) : (
        <B.Button
          onClick={handleUnstake}
          disabled={isLoading || !unstakeAmount || Number(unstakeAmount) <= 0 || !stakingAvailable}
          width="100%"
          padding="16px 24px"
          margin="0"
          style={{ borderRadius: '16px' }}
        >
          {isLoading ? 'Processing...' : !stakingAvailable ? 'Coming Soon' : 'Unstake'}
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
