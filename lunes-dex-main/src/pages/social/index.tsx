import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import TraderCard from './components/TraderCard'
import CopyModal from '../copytrade/CopyModal'
import { Trader } from './types'
import { TraderCardSkeleton } from 'components/bases/skeleton'
import { useSDK } from '../../context/SDKContext'
import socialApi, { SocialIdeaFeedItem, SocialStats, PipelineStatus } from '../../services/socialService'
import { pageEntrance, interactiveButton, staggerChildren, interactiveCard, timing, easing } from '../../styles/motion'

// ── SVG Icons ──
const TrophyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M4 22h16" /><path d="M10 22V8a4 4 0 018 0v14" /></svg>
const UsersIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
const BotIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></svg>
const SearchIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
const IdeaIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 019 14" /></svg>
const WalletIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 100 4 2 2 0 000-4z" /></svg>
const HeartIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
const MessageIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>

// ── Styled Components ──

const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding: 80px 24px 48px;
  ${pageEntrance}
`

const Container = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`

const HeroBanner = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #6C38FF, #AD87FF);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const Subtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8A8A8E;
  margin: 0;
  max-width: 560px;
  margin: 0 auto;
  line-height: 1.6;
`

const StatsBar = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 32px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(3, 1fr);
  }

  @media (max-width: 600px) {
    grid-template-columns: repeat(2, 1fr);
  }
`

const StatItem = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
`

const StatValue = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px;
  font-weight: 700;
  color: #FFFFFF;
`

const StatLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #47474A;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
`

const OnChainBadge = styled.span<{ active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  padding: 3px 8px;
  border-radius: 20px;
  background: ${({ active }) => active ? 'rgba(38,208,124,0.12)' : 'rgba(255,165,0,0.1)'};
  color: ${({ active }) => active ? '#26D07C' : '#FFA500'};
  border: 1px solid ${({ active }) => active ? 'rgba(38,208,124,0.2)' : 'rgba(255,165,0,0.2)'};

  &::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: ${({ active }) => active ? 'pulse 2s infinite' : 'none'};
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`

const TabsContainer = styled.div`
  display: flex;
  gap: 4px;
  background: #232323;
  border-radius: 12px;
  padding: 4px;
  border: 1px solid #2A2A2C;
`

const HeaderActions = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
`

const CreateProfileBtn = styled.button`
  background: #6C38FF;
  color: #FFFFFF;
  border: none;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  ${interactiveButton}
`

const Tab = styled.button<{ active: boolean }>`
  flex: 1;
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all ${timing.normal} ${easing.default};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: ${({ active }) => active ? '#6C38FF' : 'transparent'};
  color: ${({ active }) => active ? '#FFFFFF' : '#8A8A8E'};
  position: relative;

  &:hover {
    color: #FFFFFF;
    background: ${({ active }) => active ? '#6C38FF' : 'rgba(108, 56, 255, 0.08)'};
  }

  &:active {
    transform: scale(0.97);
  }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
  ${staggerChildren(60)}
`

const SearchBar = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
`

const SearchInputWrapper = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: #47474A;
  }
`

const SearchInput = styled.input`
  width: 100%;
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  padding: 12px 16px 12px 40px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #FFFFFF;
  outline: none;

  &::placeholder {
    color: #47474A;
  }

  &:focus {
    border-color: #6C38FF;
  }
`

const SortSelect = styled.select`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  padding: 12px 16px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #FFFFFF;
  outline: none;
  cursor: pointer;

  option {
    background: #232323;
  }
`

const EmptyState = styled.div`
  text-align: center;
  padding: 80px 0;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
`

// ── Toast Component ──
const Toast = styled.div`
  position: fixed;
  bottom: 32px;
  right: 32px;
  background: #26D07C;
  color: #1A1A1A;
  padding: 12px 24px;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 32px rgba(38, 208, 124, 0.2);
  z-index: 10000;
  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1), fadeOut 0.3s 2.7s forwards;

  @keyframes slideIn {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes fadeOut {
    to { opacity: 0; pointer-events: none; }
  }
`

const StatusBanner = styled.div`
  background: rgba(254, 146, 63, 0.12);
  border: 1px solid rgba(254, 146, 63, 0.2);
  color: #FE923F;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 24px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
`

const IdeaCard = styled.button`
  width: 100%;
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  padding: 20px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #6C38FF44;
    transform: translateY(-2px);
  }
`

const IdeaHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
`

const IdeaTitle = styled.h3`
  margin: 0;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
`

const DirectionBadge = styled.span<{ bullish: boolean }>`
  color: ${({ bullish }) => bullish ? '#26D07C' : '#FF284C'};
  background: ${({ bullish }) => bullish ? 'rgba(38,208,124,0.1)' : 'rgba(255,40,76,0.1)'};
  padding: 4px 10px;
  border-radius: 6px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 700;
`

const IdeaLeader = styled.div`
  color: #AD87FF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
`

const IdeaDescription = styled.p`
  margin: 0 0 14px 0;
  color: #8A8A8E;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
`

const IdeaMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  align-items: center;
`

const IdeaMetaItem = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
`

const IdeaTag = styled.span`
  background: #2A2A2C;
  color: #8A8A8E;
  padding: 3px 8px;
  border-radius: 6px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
`

// ── Component ──

type TabType = 'all' | 'traders' | 'bots' | 'ideas' | 'leaderboard'

const getEmptyStats = (): SocialStats => ({
  totalAum: 0,
  activeTraders: 0,
  aiAgents: 0,
  totalFollowers: 0,
  totalIdeas: 0,
  totalVaultEquity: 0,
})

const formatAumLabel = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M+`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K+`
  return value.toFixed(0)
}

const SocialTrade: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress } = useSDK()
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('roi30d')
  const [copyTarget, setCopyTarget] = useState<Trader | null>(null)
  const [leaders, setLeaders] = useState<Trader[]>([])
  const [ideas, setIdeas] = useState<SocialIdeaFeedItem[]>([])
  const [stats, setStats] = useState<SocialStats>(getEmptyStats())
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadStats = async () => {
      try {
        const [nextStats, nextPipeline] = await Promise.allSettled([
          socialApi.getStats(),
          socialApi.getPipelineStatus(),
        ])
        if (isMounted) {
          if (nextStats.status === 'fulfilled') setStats(nextStats.value)
          if (nextPipeline.status === 'fulfilled') setPipeline(nextPipeline.value)
        }
      } catch {
        // Stats remain empty on failure
      }
    }

    void loadStats()

    const intervalId = window.setInterval(() => {
      void loadStats()
    }, 30000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)
      setStatusMessage('')

      try {
        if (activeTab === 'ideas') {
          const nextIdeas = await socialApi.getIdeas(50)
          if (isMounted) setIdeas(nextIdeas)
        } else if (activeTab === 'leaderboard') {
          const nextLeaders = await socialApi.getLeaderboard(20)
          if (isMounted) setLeaders(nextLeaders)
        } else {
          const nextLeaders = await socialApi.getLeaders({
            tab: activeTab,
            search,
            sortBy: sortBy as 'roi30d' | 'followers' | 'winRate' | 'sharpe',
            limit: 50,
          })
          if (isMounted) setLeaders(nextLeaders)
        }
      } catch (err) {
        if (!isMounted) return
        setStatusMessage(err instanceof Error ? `${err.message}. Could not load data.` : 'API unavailable.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void loadData()

    const intervalId = window.setInterval(() => {
      void loadData()
    }, 30000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [activeTab, search, sortBy, walletAddress])

  return (
    <Page>
      <Container>
        <HeroBanner>
          <Title>
            <span>Social Trade</span>
          </Title>
          <Subtitle>
            Follow top traders and autonomous AI agents. Copy their strategies,
            share ideas, and grow with the community.
          </Subtitle>
        </HeroBanner>

        <StatsBar>
          <StatItem>
            <StatValue>${formatAumLabel(stats.totalAum)}</StatValue>
            <StatLabel><WalletIcon /> Total AUM</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{stats.activeTraders}</StatValue>
            <StatLabel><UsersIcon /> Active Traders</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{stats.aiAgents}</StatValue>
            <StatLabel><BotIcon /> AI Agents</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{stats.totalFollowers.toLocaleString()}</StatValue>
            <StatLabel><UsersIcon /> Total Followers</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{stats.totalIdeas}</StatValue>
            <StatLabel><IdeaIcon /> Published Ideas</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>${formatAumLabel(stats.totalVaultEquity)}</StatValue>
            <StatLabel><TrophyIcon /> Vault Equity</StatLabel>
          </StatItem>
        </StatsBar>

        {pipeline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', justifyContent: 'flex-end' }}>
            <OnChainBadge active={pipeline.indexedEvents > 0}>
              {pipeline.indexedEvents > 0
                ? `⚡ On-chain: ${pipeline.indexedEvents.toLocaleString()} events indexed · block ${pipeline.latestIndexedEvent?.blockNumber?.toLocaleString() ?? '—'}`
                : '⏳ Waiting for on-chain events'}
            </OnChainBadge>
            {pipeline.snapshots > 0 && (
              <OnChainBadge active>
                {pipeline.snapshots} analytics snapshots
              </OnChainBadge>
            )}
          </div>
        )}

        {statusMessage && <StatusBanner>{statusMessage}</StatusBanner>}

        <HeaderActions>
          <TabsContainer>
            <Tab active={activeTab === 'all'} onClick={() => setActiveTab('all')}><TrophyIcon /> All</Tab>
            <Tab active={activeTab === 'traders'} onClick={() => setActiveTab('traders')}><UsersIcon /> Traders</Tab>
            <Tab active={activeTab === 'bots'} onClick={() => setActiveTab('bots')}><BotIcon /> AI Bots</Tab>
            <Tab active={activeTab === 'leaderboard'} onClick={() => setActiveTab('leaderboard')}><TrophyIcon /> Leaderboard</Tab>
            <Tab active={activeTab === 'ideas'} onClick={() => setActiveTab('ideas')}><IdeaIcon /> Ideas</Tab>
          </TabsContainer>

          <CreateProfileBtn onClick={() => navigate('/social/settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="19" y1="8" x2="23" y2="8" /><line x1="21" y1="6" x2="21" y2="10" /></svg>
            Become a Leader
          </CreateProfileBtn>
        </HeaderActions>

        {activeTab !== 'ideas' ? (
          <>
            {activeTab === 'leaderboard' && (
              <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(108,56,255,0.08)', border: '1px solid rgba(108,56,255,0.2)', borderRadius: '10px', fontSize: '13px', color: '#AD87FF', fontFamily: "'Space Grotesk', sans-serif" }}>
                🏆 <strong>Leaderboard</strong> — ranked by risk-adjusted performance (Sharpe ratio), computed from on-chain activity via the Lunes blockchain indexer.
              </div>
            )}
            <SearchBar>
              <SearchInputWrapper>
                <SearchIcon />
                <SearchInput
                  placeholder="Search traders, bots, or strategies..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </SearchInputWrapper>
              <SortSelect value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="roi30d">Sort by ROI (30d)</option>
                <option value="followers">Sort by Followers</option>
                <option value="winRate">Sort by Win Rate</option>
                <option value="sharpe">Sort by Sharpe Ratio</option>
              </SortSelect>
            </SearchBar>

            <Grid>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <TraderCardSkeleton key={`skeleton-${i}`} />)
              ) : (
                leaders.map((trader, i) => (
                  <TraderCard
                    key={trader.id}
                    trader={trader}
                    rank={i + 1}
                    onCopy={setCopyTarget}
                  />
                ))
              )}
            </Grid>

            {!isLoading && leaders.length === 0 && (
              <EmptyState>No traders found matching your search.</EmptyState>
            )}
          </>
        ) : (
          <Grid>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <TraderCardSkeleton key={`idea-skeleton-${i}`} />)
            ) : (
              ideas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  onClick={() => idea.leader ? navigate(`/social/profile/${idea.leader.id}`) : undefined}
                >
                  <IdeaHeader>
                    <IdeaTitle>{idea.title}</IdeaTitle>
                    <DirectionBadge bullish={idea.direction === 'Bullish'}>{idea.direction}</DirectionBadge>
                  </IdeaHeader>
                  {idea.leader ? <IdeaLeader>@{idea.leader.username}</IdeaLeader> : null}
                  <IdeaDescription>{idea.description}</IdeaDescription>
                  <IdeaMeta>
                    <IdeaMetaItem><HeartIcon /> {idea.likes}</IdeaMetaItem>
                    <IdeaMetaItem><MessageIcon /> {idea.comments}</IdeaMetaItem>
                    <IdeaMetaItem>{idea.pair}</IdeaMetaItem>
                    <IdeaMetaItem>{idea.date}</IdeaMetaItem>
                    {idea.tags.map((tag) => <IdeaTag key={tag}>{tag}</IdeaTag>)}
                  </IdeaMeta>
                </IdeaCard>
              ))
            )}
          </Grid>
        )}

        {activeTab === 'ideas' && !isLoading && ideas.length === 0 && (
          <EmptyState>No ideas published yet.</EmptyState>
        )}

        <CopyModal
          trader={copyTarget as any}
          onClose={() => setCopyTarget(null)}
          onConfirm={(amount) => {
            const token = copyTarget?.vault?.collateralToken ?? 'USDT'
            setToastMessage(`Success: Deposited ${String(amount)} ${token} into ${copyTarget?.name ?? ''}'s Vault!`)
            setCopyTarget(null)
            setTimeout(() => setToastMessage(''), 3000)
          }}
        />

        {toastMessage && (
          <Toast>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            {toastMessage}
          </Toast>
        )}
      </Container>
    </Page>
  )
}

export default SocialTrade
