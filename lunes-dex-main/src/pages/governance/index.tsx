import React, { useState, useEffect, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useSDK } from '../../context/SDKContext'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'
import * as B from '../../components/bases'

// Types
interface Proposal {
  id: number
  name: string
  description: string
  tokenAddress: string
  proposer: string
  votesYes: number
  votesNo: number
  votingDeadline: number
  executed: boolean
  active: boolean
  fee: string
}

type ProposalFilter = 'active' | 'approved' | 'rejected' | 'all'
type VoteType = 'yes' | 'no' | null

// Constants
const VOTE_COST = 10 // 10 LUNES per vote
const MIN_VOTES_FOR_APPROVAL = 10000 // 10,000 YES votes to be approved
const VOTE_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour in milliseconds

// Vote distribution:
// - 30% → Stakers (Rewards Pool)
// - 20% → Project Liquidity Pool
// - 10% → Treasury
// - 40% → Team

// Animations
const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 80px 24px 48px;
`

const PageContainer = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #00ff88, #00d4ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const PageSubtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8a8a8e;
  margin: 0;
`

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const slideUp = keyframes`
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`

const Header = styled.div`
  text-align: center;
  padding-bottom: 4px;
`

const Title = styled.h1`
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 6px 0;
`

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 13px;
  margin: 0;
`

const StatsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`

const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 20px 16px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.05);
`

const StatValue = styled.div`
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
`

const StatLabel = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[200]};
  font-size: 11px;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const FilterTabs = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-top: 24px;
  margin-bottom: 24px;
`

const FilterTab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 10px 16px;
  border-radius: 12px;
  border: none;
  background: ${props => (props.$active ? '#00ff88' : 'transparent')};
  color: ${props =>
    props.$active ? '#1A1A1A' : props.theme.colors.themeColors[100]};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: ${props => (props.$active ? '700' : '500')};
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    background: ${props =>
      props.$active ? '#00ff88' : 'rgba(255,255,255,0.05)'};
    color: ${props => (props.$active ? '#1A1A1A' : '#fff')};
  }
`

const ProposalsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ProposalCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.2s ease-in-out;
  border: 1px solid rgba(255, 255, 255, 0.05);

  &:hover {
    border-color: rgba(0, 255, 136, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }
`

const ProposalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
`

const ProposalTitle = styled.h3`
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  margin: 0;
`

const ProposalStatus = styled.span<{
  $status: 'active' | 'approved' | 'rejected' | 'pending'
}>`
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: ${props => {
    switch (props.$status) {
      case 'active':
        return '#00d4ff20'
      case 'approved':
        return '#00ff8820'
      case 'rejected':
        return '#ff6b6b20'
      default:
        return '#ffa50020'
    }
  }};
  color: ${props => {
    switch (props.$status) {
      case 'active':
        return '#00d4ff'
      case 'approved':
        return '#00ff88'
      case 'rejected':
        return '#ff6b6b'
      default:
        return '#ffa500'
    }
  }};
`

const ProposalDescription = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  margin: 0 0 16px 0;
  line-height: 1.5;
`

const ProposalMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const MetaItem = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
`

const VotingSection = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 10px;
  padding: 16px;
`

const VoteStats = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
`

const VoteStat = styled.div<{ $type: 'yes' | 'no' }>`
  text-align: ${props => (props.$type === 'yes' ? 'left' : 'right')};
`

const VoteLabel = styled.div<{ $type: 'yes' | 'no' }>`
  color: ${props => (props.$type === 'yes' ? '#00ff88' : '#ff6b6b')};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
`

const VoteCount = styled.div`
  color: #fff;
  font-size: 18px;
  font-weight: 700;
`

const VoteBar = styled.div`
  height: 8px;
  border-radius: 4px;
  background: #333;
  overflow: hidden;
  display: flex;
  margin-bottom: 16px;
`

const VoteBarYes = styled.div<{ $percent: number }>`
  width: ${props => props.$percent}%;
  background: linear-gradient(90deg, #00ff88, #00cc6a);
  transition: width 0.5s ease;
`

const VoteBarNo = styled.div<{ $percent: number }>`
  width: ${props => props.$percent}%;
  background: linear-gradient(90deg, #ff6b6b, #cc5555);
  transition: width 0.5s ease;
`

const VoteButtons = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`

const VoteButton = styled.button<{ $type: 'yes' | 'no'; $disabled?: boolean }>`
  padding: 14px 20px;
  border-radius: 12px;
  border: 2px solid ${props => (props.$type === 'yes' ? '#00ff88' : '#ff6b6b')};
  background: ${props =>
    props.$disabled
      ? '#33333380'
      : props.$type === 'yes'
        ? '#00ff8815'
        : '#ff6b6b15'};
  color: ${props =>
    props.$disabled ? '#666' : props.$type === 'yes' ? '#00ff88' : '#ff6b6b'};
  font-size: 16px;
  font-weight: 700;
  cursor: ${props => (props.$disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  &:hover {
    ${props =>
      !props.$disabled &&
      `
      background: ${props.$type === 'yes' ? '#00ff8830' : '#ff6b6b30'};
      transform: scale(1.02);
    `}
  }

  span {
    font-size: 11px;
    font-weight: 400;
    opacity: 0.8;
  }
`

const TimeRemaining = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  margin-top: 12px;
`

const CooldownWarning = styled.div`
  text-align: center;
  padding: 12px;
  background: #ffa50020;
  border-radius: 8px;
  color: #ffa500;
  font-size: 13px;
  margin-bottom: 12px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  font-size: 16px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  margin-top: 12px;
`

const ConnectPrompt = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 18px;
`

const ListingCTA = styled.div`
  background: linear-gradient(
    135deg,
    rgba(0, 255, 136, 0.05) 0%,
    rgba(0, 212, 255, 0.05) 100%
  );
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 16px;
  padding: 32px;
  margin-top: 24px;
  text-align: center;
`

const CTAText = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  margin: 0 0 16px 0;
  line-height: 1.6;
`

// Vote Modal Styles
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: ${fadeIn} 0.2s ease;
`

const ModalContent = styled.div`
  background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
  border-radius: 20px;
  padding: 32px;
  width: 100%;
  max-width: 420px;
  border: 1px solid #6c38fe40;
  animation: ${slideUp} 0.3s ease;
`

const ModalHeader = styled.div`
  text-align: center;
  margin-bottom: 24px;
`

const ModalIcon = styled.div<{ $type: 'yes' | 'no' | 'success' | 'loading' }>`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  background: transparent;
  border: 2px solid
    ${props => {
      switch (props.$type) {
        case 'yes':
          return '#00ff88'
        case 'no':
          return '#E8596F'
        case 'success':
          return '#00ff88'
        default:
          return '#00d4ff'
      }
    }};
  animation: ${props =>
    props.$type === 'loading' ? `${pulse.getName()} 1s infinite` : 'none'};
`

const ModalTitle = styled.h2`
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 8px 0;
`

const ModalSubtitle = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  margin: 0;
`

const ModalBody = styled.div`
  margin-bottom: 24px;
`

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #ffffff10;

  &:last-child {
    border-bottom: none;
  }
`

const InfoLabel = styled.span`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
`

const InfoValue = styled.span<{ $highlight?: boolean; $type?: 'yes' | 'no' }>`
  color: ${props => {
    if (props.$type === 'yes') return '#00ff88'
    if (props.$type === 'no') return '#E8596F'
    if (props.$highlight) return '#00ff88'
    return '#fff'
  }};
  font-size: 14px;
  font-weight: ${props => (props.$highlight || props.$type ? '700' : '500')};
`

const DistributionBox = styled.div`
  background: #ffffff08;
  border-radius: 12px;
  padding: 16px;
  margin-top: 16px;
`

const DistributionTitle = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const DistributionItem = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #aaa;
  margin-bottom: 6px;

  &:last-child {
    margin-bottom: 0;
  }
`

const ModalButtons = styled.div`
  display: flex;
  gap: 12px;
`

const ModalButton = styled.button<{ $primary?: boolean; $type?: 'yes' | 'no' }>`
  flex: 1;
  padding: 14px 24px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  ${props =>
    props.$primary
      ? `
      background: #00ff88;
      border: none;
      color: #1a1a1a;
    `
      : `
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
    `}

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const LoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 3px solid #ffffff30;
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

// No mock data — proposals are loaded from the on-chain Staking/Governance contract

export const Governance: React.FC = () => {
  const sdk = useSDK()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ProposalFilter>('active')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasStaking, setHasStaking] = useState(false)
  const [stakedAmount, setStakedAmount] = useState('0')

  // Vote modal state
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(
    null
  )
  const [selectedVote, setSelectedVote] = useState<VoteType>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [voteSuccess, setVoteSuccess] = useState(false)

  // Vote cooldown tracking (per proposal)
  const [lastVotes, setLastVotes] = useState<Record<number, number>>({})

  const signGovernanceAction = useCallback(
    async (action: string, fields?: Record<string, string | number>) => {
      if (!sdk.walletAddress) {
        throw new Error('Connect your wallet first')
      }

      const metadata = createSignedActionMetadata()
      const signature = await sdk.signMessage(
        buildWalletActionMessage({
          action,
          address: sdk.walletAddress,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields
        })
      )

      return { ...metadata, signature }
    },
    [sdk]
  )

  // Load proposals from on-chain contract and check staking status
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        // Get listing stats to know how many proposals exist
        const stats = await sdk.getListingStats()
        const totalProposals = stats?.totalProposals ?? 0

        // Load all proposals from chain
        const loadedProposals: Proposal[] = []
        for (let i = 0; i < totalProposals; i++) {
          const proposal = await sdk.getProposal(i)
          if (proposal) {
            loadedProposals.push(proposal)
          }
        }
        setProposals(loadedProposals)

        // Check staking status
        if (sdk.walletAddress) {
          const stakingInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
          if (stakingInfo && BigInt(stakingInfo.userStaked) > 0) {
            setHasStaking(true)
            const stakedNum = BigInt(stakingInfo.userStaked) / BigInt(1e8)
            setStakedAmount(stakedNum.toString())
          }
        }

        // Load vote history from server (not localStorage)
        if (sdk.walletAddress) {
          try {
            const auth = await signGovernanceAction('governance.vote.history')
            const histRes = await fetch(
              `/api/v1/governance/vote/history?walletAddress=${encodeURIComponent(
                sdk.walletAddress
              )}&nonce=${encodeURIComponent(auth.nonce)}&timestamp=${
                auth.timestamp
              }&signature=${encodeURIComponent(auth.signature)}`
            )
            if (histRes.ok) {
              const { votes } = await histRes.json()
              const record: Record<number, number> = {}
              for (const v of votes) {
                const proposalId = v.proposalId
                const ts = new Date(v.votedAt).getTime()
                if (!record[proposalId] || ts > record[proposalId]) {
                  record[proposalId] = ts
                }
              }
              setLastVotes(record)
            }
          } catch {
            // Server unavailable — canVote defaults to true (safe for UI, enforced on record)
          }
        }
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (sdk.isConnected) {
      loadData()
    }
  }, [sdk, signGovernanceAction])

  // Check if user can vote (1 hour cooldown)
  const canVote = (proposalId: number): boolean => {
    const lastVote = lastVotes[proposalId]
    if (!lastVote) return true
    return Date.now() - lastVote > VOTE_COOLDOWN_MS
  }

  const getTimeUntilNextVote = (proposalId: number): string => {
    const lastVote = lastVotes[proposalId]
    if (!lastVote) return ''
    const remaining = VOTE_COOLDOWN_MS - (Date.now() - lastVote)
    if (remaining <= 0) return ''
    const minutes = Math.ceil(remaining / 60000)
    return `${minutes} min`
  }

  // Filter proposals
  const filteredProposals = proposals.filter(p => {
    const now = Date.now()
    const isActive = p.active && now < p.votingDeadline
    const isApproved = p.executed && p.votesYes >= MIN_VOTES_FOR_APPROVAL
    const isRejected = p.executed && p.votesYes < MIN_VOTES_FOR_APPROVAL

    switch (filter) {
      case 'active':
        return isActive
      case 'approved':
        return isApproved
      case 'rejected':
        return isRejected
      default:
        return true
    }
  })

  // Calculate stats
  const stats = {
    active: proposals.filter(p => p.active && Date.now() < p.votingDeadline)
      .length,
    approved: proposals.filter(
      p => p.executed && p.votesYes >= MIN_VOTES_FOR_APPROVAL
    ).length,
    total: proposals.length
  }

  // Get vote percentages
  const getVotePercentages = (votesYes: number, votesNo: number) => {
    const total = votesYes + votesNo
    if (total === 0) return { yesPercent: 50, noPercent: 50 }
    return {
      yesPercent: Math.round((votesYes / total) * 100),
      noPercent: Math.round((votesNo / total) * 100)
    }
  }

  // Format time remaining
  const formatTimeRemaining = (deadline: number): string => {
    const now = Date.now()
    const diff = deadline - now
    if (diff <= 0) return 'Voting ended'
    const days = Math.floor(diff / (24 * 60 * 60 * 1000))
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
    if (days > 0) return `${days}d ${hours}h remaining`
    return `${hours}h remaining`
  }

  // Get proposal status
  const getProposalStatus = (
    proposal: Proposal
  ): 'active' | 'approved' | 'rejected' | 'pending' => {
    if (proposal.active && Date.now() < proposal.votingDeadline) return 'active'
    if (!proposal.executed) return 'pending'
    if (proposal.votesYes >= MIN_VOTES_FOR_APPROVAL) return 'approved'
    return 'rejected'
  }

  // Open vote modal
  const openVoteModal = (proposal: Proposal, voteType: VoteType) => {
    setSelectedProposal(proposal)
    setSelectedVote(voteType)
    setVoteSuccess(false)
    setShowVoteModal(true)
  }

  // Handle vote confirmation — on-chain transaction via Staking contract
  const handleConfirmVote = async () => {
    if (!selectedProposal || !selectedVote) return

    setIsVoting(true)
    try {
      const approve = selectedVote === 'yes'
      const success = await sdk.voteOnProposal(selectedProposal.id, approve)

      if (success) {
        // Reload the proposal to get updated vote counts from chain
        const updatedProposal = await sdk.getProposal(selectedProposal.id)
        if (updatedProposal) {
          setProposals(prev =>
            prev.map(p => (p.id === selectedProposal.id ? updatedProposal : p))
          )
        }

        // Record vote server-side (enforced cooldown in DB, not localStorage)
        const nowMs = Date.now()
        try {
          const auth = await signGovernanceAction('governance.vote.record', {
            proposalId: selectedProposal.id,
            voteType: selectedVote === 'yes' ? 'YES' : 'NO'
          })
          await fetch('/api/v1/governance/vote/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              walletAddress: sdk.walletAddress,
              proposalId: selectedProposal.id,
              voteType: selectedVote === 'yes' ? 'YES' : 'NO',
              ...auth
            })
          })
        } catch {
          // Best-effort — cooldown enforced server-side; UI will refresh on next load
        }

        // Update local state cache for immediate UI feedback
        setLastVotes(prev => ({ ...prev, [selectedProposal.id]: nowMs }))

        setVoteSuccess(true)
      }
    } catch (error) {
      console.error('Error voting:', error)
      alert('Error submitting vote. Please try again.')
    } finally {
      setIsVoting(false)
    }
  }

  // Close modal
  const closeModal = () => {
    setShowVoteModal(false)
    setSelectedProposal(null)
    setSelectedVote(null)
    setVoteSuccess(false)
  }

  return (
    <Page>
      <PageContainer>
        <HeroBanner>
          <PageTitle>
            Project <span>Governance</span>
          </PageTitle>
          <PageSubtitle>
            Vote on token listing proposals submitted by the community. Shape
            the future of Lunex.
          </PageSubtitle>
        </HeroBanner>
        <Header>
          <Title>Project Voting</Title>
          <Subtitle>
            Vote on token listing proposals submitted by the community
          </Subtitle>
        </Header>

        {!sdk.isConnected ? (
          <ConnectPrompt>
            <p>Connect your wallet to participate in governance</p>
            <B.Button
              onClick={() => sdk.connectWallet()}
              margin="20px auto 0"
              width="auto"
              padding="16px 40px"
            >
              Connect Wallet
            </B.Button>
          </ConnectPrompt>
        ) : isLoading ? (
          <ConnectPrompt>Loading proposals...</ConnectPrompt>
        ) : (
          <>
            <StatsRow>
              <StatCard>
                <StatValue>{stats.active}</StatValue>
                <StatLabel>Active Proposals</StatLabel>
              </StatCard>
              <StatCard>
                <StatValue>{stats.approved}</StatValue>
                <StatLabel>Approved Projects</StatLabel>
              </StatCard>
              <StatCard>
                <StatValue>{hasStaking ? stakedAmount : '0'}</StatValue>
                <StatLabel>Your Staked LUNES</StatLabel>
              </StatCard>
            </StatsRow>

            <FilterTabs>
              <FilterTab
                $active={filter === 'active'}
                onClick={() => setFilter('active')}
              >
                Active ({stats.active})
              </FilterTab>
              <FilterTab
                $active={filter === 'approved'}
                onClick={() => setFilter('approved')}
              >
                Approved
              </FilterTab>
              <FilterTab
                $active={filter === 'rejected'}
                onClick={() => setFilter('rejected')}
              >
                Rejected
              </FilterTab>
              <FilterTab
                $active={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                All
              </FilterTab>
            </FilterTabs>

            <ProposalsList>
              {filteredProposals.length === 0 ? (
                <EmptyState>
                  <div style={{ marginBottom: '16px', opacity: 0.5 }}>
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                  </div>
                  No proposals found for the selected filter
                </EmptyState>
              ) : (
                filteredProposals.map(proposal => {
                  const status = getProposalStatus(proposal)
                  const { yesPercent, noPercent } = getVotePercentages(
                    proposal.votesYes,
                    proposal.votesNo
                  )
                  const isActive = status === 'active'
                  const userCanVote = canVote(proposal.id)
                  const timeUntilVote = getTimeUntilNextVote(proposal.id)

                  return (
                    <ProposalCard key={proposal.id}>
                      <ProposalHeader>
                        <ProposalTitle>{proposal.name}</ProposalTitle>
                        <ProposalStatus $status={status}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </ProposalStatus>
                      </ProposalHeader>

                      <ProposalDescription>
                        {proposal.description}
                      </ProposalDescription>

                      <ProposalMeta>
                        <MetaItem>{proposal.tokenAddress}</MetaItem>
                        <MetaItem>{proposal.proposer}</MetaItem>
                      </ProposalMeta>

                      <VotingSection>
                        <VoteStats>
                          <VoteStat $type="yes">
                            <VoteLabel $type="yes">✓ YES</VoteLabel>
                            <VoteCount>
                              {proposal.votesYes.toLocaleString()}
                            </VoteCount>
                          </VoteStat>
                          <VoteStat $type="no">
                            <VoteLabel $type="no">✗ NO</VoteLabel>
                            <VoteCount>
                              {proposal.votesNo.toLocaleString()}
                            </VoteCount>
                          </VoteStat>
                        </VoteStats>

                        <VoteBar>
                          <VoteBarYes $percent={yesPercent} />
                          <VoteBarNo $percent={noPercent} />
                        </VoteBar>

                        {isActive && (
                          <>
                            {!userCanVote && (
                              <CooldownWarning>
                                ⏱️ You can vote again in {timeUntilVote}
                              </CooldownWarning>
                            )}

                            <VoteButtons>
                              <VoteButton
                                $type="yes"
                                $disabled={!userCanVote}
                                onClick={() =>
                                  userCanVote && openVoteModal(proposal, 'yes')
                                }
                              >
                                YES
                                <span>{VOTE_COST} LUNES</span>
                              </VoteButton>
                              <VoteButton
                                $type="no"
                                $disabled={!userCanVote}
                                onClick={() =>
                                  userCanVote && openVoteModal(proposal, 'no')
                                }
                              >
                                NO
                                <span>{VOTE_COST} LUNES</span>
                              </VoteButton>
                            </VoteButtons>

                            <TimeRemaining>
                              ⏱️ {formatTimeRemaining(proposal.votingDeadline)}
                            </TimeRemaining>
                          </>
                        )}
                      </VotingSection>
                    </ProposalCard>
                  )
                })
              )}
            </ProposalsList>

            <ListingCTA>
              <CTAText>
                Want to list your token on Lunex?
                <br />
                Submit a proposal for community voting.
              </CTAText>
              <B.Button
                onClick={() => navigate('/listing')}
                margin="0 auto"
                width="auto"
                padding="12px 24px"
              >
                List Your Token
              </B.Button>
            </ListingCTA>
          </>
        )}

        {showVoteModal && selectedProposal && (
          <ModalOverlay onClick={closeModal}>
            <ModalContent onClick={e => e.stopPropagation()}>
              {!voteSuccess ? (
                <>
                  <ModalHeader>
                    <ModalIcon
                      $type={isVoting ? 'loading' : (selectedVote ?? 'yes')}
                    >
                      {isVoting ? (
                        <LoadingSpinner />
                      ) : selectedVote === 'yes' ? (
                        'YES'
                      ) : (
                        'NO'
                      )}
                    </ModalIcon>
                    <ModalTitle>
                      {isVoting
                        ? 'Signing Transaction...'
                        : `Vote ${
                            selectedVote ? selectedVote.toUpperCase() : ''
                          }`}
                    </ModalTitle>
                    <ModalSubtitle>
                      {isVoting
                        ? 'Please confirm in your wallet'
                        : `Confirm your vote for ${selectedProposal.name}`}
                    </ModalSubtitle>
                  </ModalHeader>

                  <ModalBody>
                    <InfoRow>
                      <InfoLabel>Project</InfoLabel>
                      <InfoValue>{selectedProposal.name}</InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Your Vote</InfoLabel>
                      <InfoValue $type={selectedVote ?? undefined}>
                        {selectedVote ? selectedVote.toUpperCase() : ''}
                      </InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Vote Cost</InfoLabel>
                      <InfoValue>{VOTE_COST} LUNES</InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Cooldown</InfoLabel>
                      <InfoValue>1 hour</InfoValue>
                    </InfoRow>

                    <DistributionBox>
                      <DistributionTitle>Vote Distribution</DistributionTitle>
                      <DistributionItem>
                        <span>Stakers (Rewards Pool)</span>
                        <span>30% ({VOTE_COST * 0.3} LUNES)</span>
                      </DistributionItem>
                      <DistributionItem>
                        <span>Project Liquidity</span>
                        <span>20% ({VOTE_COST * 0.2} LUNES)</span>
                      </DistributionItem>
                      <DistributionItem>
                        <span>Treasury</span>
                        <span>10% ({VOTE_COST * 0.1} LUNES)</span>
                      </DistributionItem>
                      <DistributionItem>
                        <span>Team</span>
                        <span>40% ({VOTE_COST * 0.4} LUNES)</span>
                      </DistributionItem>
                    </DistributionBox>
                  </ModalBody>

                  <ModalButtons>
                    <ModalButton onClick={closeModal} disabled={isVoting}>
                      Cancel
                    </ModalButton>
                    <ModalButton
                      $primary
                      $type={selectedVote ?? 'yes'}
                      onClick={handleConfirmVote}
                      disabled={isVoting}
                    >
                      {isVoting ? 'Confirming...' : 'Confirm Vote'}
                    </ModalButton>
                  </ModalButtons>
                </>
              ) : (
                <>
                  <ModalHeader>
                    <ModalIcon $type="success">✓</ModalIcon>
                    <ModalTitle>Vote Submitted!</ModalTitle>
                    <ModalSubtitle>
                      Your vote has been recorded successfully
                    </ModalSubtitle>
                  </ModalHeader>

                  <ModalBody>
                    <InfoRow>
                      <InfoLabel>Project</InfoLabel>
                      <InfoValue>{selectedProposal.name}</InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Your Vote</InfoLabel>
                      <InfoValue $type={selectedVote ?? undefined}>
                        {selectedVote ? selectedVote.toUpperCase() : ''}
                      </InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>New YES Votes</InfoLabel>
                      <InfoValue>Confirmed ✓</InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Goal Progress</InfoLabel>
                      <InfoValue $highlight>Refreshing from chain...</InfoValue>
                    </InfoRow>
                    <InfoRow>
                      <InfoLabel>Next Vote In</InfoLabel>
                      <InfoValue>1 hour</InfoValue>
                    </InfoRow>
                  </ModalBody>

                  <ModalButtons>
                    <ModalButton $primary onClick={closeModal}>
                      Done
                    </ModalButton>
                  </ModalButtons>
                </>
              )}
            </ModalContent>
          </ModalOverlay>
        )}
      </PageContainer>
    </Page>
  )
}

export default Governance
