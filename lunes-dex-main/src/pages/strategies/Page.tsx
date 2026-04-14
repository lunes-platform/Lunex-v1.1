import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import strategyService, {
  Strategy,
  StrategyType,
  StrategyRiskLevel
} from '../../services/strategyService'
import CreateStrategyModal from './CreateStrategyModal'
import { useSDK } from '../../context/SDKContext'

// ─── Styled Components ───────────────────────────────────────────

const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 84px 24px 64px;
`

const Container = styled.div`
  max-width: 1280px;
  margin: 0 auto;
`

const Hero = styled.div`
  text-align: center;
  margin-bottom: 40px;
  padding: 32px 0;
`

const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 42px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 12px 0;
  letter-spacing: -1px;

  span {
    background: linear-gradient(135deg, #6c38ff, #ad87ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`

const Subtitle = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8a8a8e;
  margin: 0;
  max-width: 560px;
  margin: 0 auto;
  line-height: 1.6;
`

const Badge = styled.span`
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(116, 97, 255, 0.18);
  border: 1px solid rgba(116, 97, 255, 0.3);
  color: #7461ff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: 12px;
  vertical-align: middle;
`

const FiltersRow = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 28px;
  align-items: center;
`

const FilterSelect = styled.select`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  padding: 8px 14px;
  cursor: pointer;
  outline: none;
  &:focus {
    border-color: #7461ff;
  }
`

const TabRow = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 1px solid #2a2a2c;
  padding-bottom: 0;
`

const Tab = styled.button<{ active?: boolean }>`
  background: none;
  border: none;
  border-bottom: 2px solid
    ${({ active }) => (active ? '#7461FF' : 'transparent')};
  color: ${({ active }) => (active ? '#FFFFFF' : '#8A8A8E')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: ${({ active }) => (active ? '600' : '400')};
  padding: 10px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    color: #ffffff;
  }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
`

const Card = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 20px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
  cursor: pointer;
  &:hover {
    border-color: rgba(116, 97, 255, 0.4);
    transform: translateY(-2px);
  }
`

const CardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`

const CardTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
`

const CardMeta = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
`

const Chip = styled.span<{ color?: string; bg?: string }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 20px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ color }) => color ?? '#8A8A8E'};
  background: ${({ bg }) => bg ?? 'rgba(255,255,255,0.06)'};
  border: 1px solid ${({ color }) => (color ? color + '33' : '#2A2A2C')};
`

const ROIBadge = styled.div<{ positive: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: ${({ positive }) => (positive ? '#26D07C' : '#FF4D4D')};
  white-space: nowrap;
`

const StatsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border: 1px solid #2a2a2c;
  border-radius: 14px;
  overflow: hidden;
`

const Stat = styled.div`
  padding: 12px 14px;
  border-right: 1px solid #2a2a2c;
  &:last-child {
    border-right: none;
  }
`

const StatValue = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
`

const StatLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #8a8a8e;
  margin-top: 2px;
`

const AgentRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const Avatar = styled.div<{ url?: string }>`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: ${({ url }) =>
    url
      ? `url(${url}) center/cover`
      : 'linear-gradient(135deg, #7461FF, #26D07C)'};
  flex-shrink: 0;
`

const AgentName = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #cccccc;
`

const FollowBtn = styled.button<{ following?: boolean }>`
  margin-top: auto;
  width: 100%;
  padding: 11px;
  border-radius: 12px;
  border: 1px solid ${({ following }) => (following ? '#2A2A2C' : '#7461FF')};
  background: ${({ following }) =>
    following ? 'transparent' : 'rgba(116,97,255,0.12)'};
  color: ${({ following }) => (following ? '#8A8A8E' : '#7461FF')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover:not(:disabled) {
    background: ${({ following }) =>
      following ? 'rgba(255,77,77,0.08)' : 'rgba(116,97,255,0.22)'};
    border-color: ${({ following }) => (following ? '#FF4D4D' : '#7461FF')};
    color: ${({ following }) => (following ? '#FF4D4D' : '#9983FF')};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

const LoadingGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
`

const Skeleton = styled.div`
  background: linear-gradient(90deg, #232323 25%, #2a2a2a 50%, #232323 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 20px;
  height: 260px;
  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
`

const LoadMoreBtn = styled.button`
  display: block;
  margin: 32px auto 0;
  padding: 12px 40px;
  background: transparent;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover:not(:disabled) {
    border-color: #7461ff;
    color: #7461ff;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

// ─── Onboarding Banner ────────────────────────────────────────────
const OnboardBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: linear-gradient(
    135deg,
    rgba(108, 56, 255, 0.1) 0%,
    rgba(77, 172, 255, 0.06) 100%
  );
  border: 1px solid rgba(108, 56, 255, 0.25);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 28px;
`
const OnboardSteps = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
`
const OnboardStep = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #ad87ff;
  font-weight: 600;
`
const OnboardDivider = styled.span`
  color: #4a4a4c;
  font-size: 12px;
`
const OnboardCTA = styled.button`
  padding: 8px 18px;
  border-radius: 10px;
  border: 1px solid rgba(108, 56, 255, 0.5);
  background: rgba(108, 56, 255, 0.15);
  color: #ad87ff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover {
    background: rgba(108, 56, 255, 0.3);
    color: #fff;
  }
`
const OnboardClose = styled.button`
  background: none;
  border: none;
  color: #4a4a4c;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  &:hover {
    color: #8a8a8e;
  }
`

// ─── Rich Empty State ─────────────────────────────────────────────
const RichEmptyState = styled.div`
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 72px 32px;
  text-align: center;
`
const EmptyIcon = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: rgba(108, 56, 255, 0.1);
  border: 1px solid rgba(108, 56, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  margin-bottom: 20px;
`
const EmptyTitle = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 8px;
`
const EmptyDesc = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8a8a8e;
  max-width: 400px;
  line-height: 1.6;
  margin-bottom: 24px;
`
const EmptyCTA = styled.button`
  padding: 12px 28px;
  border-radius: 12px;
  border: none;
  background: #6c38ff;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    opacity: 0.88;
    transform: translateY(-1px);
  }
`

const StatsBar = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 32px;
`

const StatCard = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 16px;
  padding: 16px 20px;
`

const StatCardValue = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 26px;
  font-weight: 700;
  color: #ffffff;
`

const StatCardLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #8a8a8e;
  margin-top: 4px;
`

// ─── Helpers ─────────────────────────────────────────────────────

const RISK_COLORS: Record<string, { color: string; bg: string }> = {
  LOW: { color: '#26D07C', bg: 'rgba(38,208,124,0.1)' },
  MEDIUM: { color: '#FE923F', bg: 'rgba(254,146,63,0.1)' },
  HIGH: { color: '#FF6B6B', bg: 'rgba(255,107,107,0.1)' },
  AGGRESSIVE: { color: '#FF4D4D', bg: 'rgba(255,77,77,0.1)' }
}

const TYPE_COLORS: Record<string, string> = {
  COPYTRADE: '#26D07C',
  MARKET_MAKER: '#FE923F',
  ARBITRAGE: '#7461FF',
  MOMENTUM: '#4DACFF',
  HEDGE: '#B0B0B0',
  CUSTOM: '#8A8A8E'
}

function fmtRoi(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

// ─── Component ───────────────────────────────────────────────────

type TabKey = 'marketplace' | 'copytrade' | 'market_maker' | 'arbitrage'

const TABS: { key: TabKey; label: string; type?: StrategyType }[] = [
  { key: 'marketplace', label: 'All Strategies' },
  { key: 'copytrade', label: 'Copy Trading', type: 'COPYTRADE' },
  { key: 'market_maker', label: 'Market Making', type: 'MARKET_MAKER' },
  { key: 'arbitrage', label: 'Arbitrage', type: 'ARBITRAGE' }
]

const SearchInput = styled.input`
  flex: 1;
  min-width: 200px;
  background: #141414;
  border: 1px solid #2a2a2c;
  border-radius: 10px;
  padding: 9px 14px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  &:focus {
    border-color: #7461ff;
  }
  &::placeholder {
    color: #555;
  }
`

const PAGE_SIZE = 24

const StrategyMarketplacePage: React.FC = () => {
  const { walletAddress, signMessage } = useSDK()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('marketplace')
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [riskFilter, setRiskFilter] = useState<StrategyRiskLevel | ''>('')
  const [sortBy, setSortBy] = useState<
    'roi30d' | 'followersCount' | 'sharpeRatio' | 'totalVolume'
  >('roi30d')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [followLoading, setFollowLoading] = useState<Set<string>>(new Set())
  const [bannerDismissed, setBannerDismissed] = useState(
    () => sessionStorage.getItem('lunex_strat_banner') === '1'
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeType = TABS.find(t => t.key === tab)?.type

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setSearchQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  const buildParams = useCallback(
    (off: number) => ({
      strategyType: activeType,
      riskLevel: riskFilter || undefined,
      search: debouncedSearch.trim() || undefined,
      sortBy,
      limit: PAGE_SIZE,
      offset: off
    }),
    [activeType, riskFilter, debouncedSearch, sortBy]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setOffset(0)
    try {
      const result = await strategyService.getMarketplace(buildParams(0))
      setStrategies(result.strategies)
      setTotal(result.total)
    } catch (e) {
      console.error('Failed to load strategies:', e)
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    try {
      const result = await strategyService.getMarketplace(
        buildParams(nextOffset)
      )
      setStrategies(prev => [...prev, ...result.strategies])
      setOffset(nextOffset)
    } catch (e) {
      console.error('Failed to load more strategies:', e)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!walletAddress) return
    strategyService
      .getFollowedStrategies(walletAddress, signMessage)
      .then(followed => setFollowing(new Set(followed.map(s => s.id))))
      .catch(() => {})
  }, [walletAddress, signMessage])

  const handleFollow = async (strategyId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!walletAddress) {
      alert('Connect your wallet to follow strategies.')
      return
    }
    setFollowLoading(prev => new Set(prev).add(strategyId))
    try {
      if (following.has(strategyId)) {
        await strategyService.unfollowStrategy(
          strategyId,
          walletAddress,
          signMessage
        )
        setFollowing(prev => {
          const s = new Set(prev)
          s.delete(strategyId)
          return s
        })
        setStrategies(prev =>
          prev.map(s =>
            s.id === strategyId
              ? { ...s, followersCount: Math.max(0, s.followersCount - 1) }
              : s
          )
        )
      } else {
        await strategyService.followStrategy(
          strategyId,
          walletAddress,
          signMessage
        )
        setFollowing(prev => new Set(prev).add(strategyId))
        setStrategies(prev =>
          prev.map(s =>
            s.id === strategyId
              ? { ...s, followersCount: s.followersCount + 1 }
              : s
          )
        )
      }
    } catch (err: any) {
      console.error(err)
    } finally {
      setFollowLoading(prev => {
        const s = new Set(prev)
        s.delete(strategyId)
        return s
      })
    }
  }

  const [showCreate, setShowCreate] = useState(false)

  const totalVolume = strategies.reduce((a, s) => a + s.totalVolume, 0)
  const avgRoi30d = strategies.length
    ? strategies.reduce((a, s) => a + s.roi30d, 0) / strategies.length
    : 0
  const totalAum = strategies.reduce((a, s) => a + s.vaultEquity, 0)

  return (
    <Page>
      {showCreate && (
        <CreateStrategyModal
          onClose={() => setShowCreate(false)}
          onCreated={s => setStrategies(prev => [s, ...prev])}
        />
      )}
      <Container>
        <Hero>
          <Title>
            <span>Strategy Marketplace</span>
            <Badge>AI Trading Network</Badge>
          </Title>
          <Subtitle>
            Discover, follow, and allocate capital to algorithmic &amp;
            AI-powered trading strategies. Built on Lunex Protocol — copy
            vaults, spot settlement, and AMM pools.
          </Subtitle>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              marginTop: 20,
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              background: '#6C38FF',
              color: '#FFFFFF',
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            + Register Strategy
          </button>
        </Hero>

        {/* Onboarding Banner */}
        {!bannerDismissed && (
          <OnboardBanner>
            <OnboardSteps>
              <OnboardStep>1. Create an Agent</OnboardStep>
              <OnboardDivider>&#8594;</OnboardDivider>
              <OnboardStep>2. Generate API Key</OnboardStep>
              <OnboardDivider>&#8594;</OnboardDivider>
              <OnboardStep>3. Register Strategy</OnboardStep>
            </OnboardSteps>
            <OnboardCTA onClick={() => navigate('/agents/get-started')}>
              Learn how &#8594;
            </OnboardCTA>
            <OnboardCTA onClick={() => navigate('/agent')}>
              Create Agent
            </OnboardCTA>
            <OnboardClose
              onClick={() => {
                setBannerDismissed(true)
                sessionStorage.setItem('lunex_strat_banner', '1')
              }}
            >
              &#10005;
            </OnboardClose>
          </OnboardBanner>
        )}

        <StatsBar>
          <StatCard>
            <StatCardValue>{fmtNumber(total)}</StatCardValue>
            <StatCardLabel>Active Strategies</StatCardLabel>
          </StatCard>
          <StatCard>
            <StatCardValue>{fmtUSD(totalAum)}</StatCardValue>
            <StatCardLabel>Total AUM</StatCardLabel>
          </StatCard>
          <StatCard>
            <StatCardValue
              style={{ color: avgRoi30d >= 0 ? '#26D07C' : '#FF4D4D' }}
            >
              {fmtRoi(avgRoi30d)}
            </StatCardValue>
            <StatCardLabel>Avg 30d ROI</StatCardLabel>
          </StatCard>
          <StatCard>
            <StatCardValue>{fmtUSD(totalVolume)}</StatCardValue>
            <StatCardLabel>Total Volume</StatCardLabel>
          </StatCard>
        </StatsBar>

        <TabRow>
          {TABS.map(t => (
            <Tab
              key={t.key}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Tab>
          ))}
        </TabRow>

        <FiltersRow>
          <SearchInput
            placeholder="Search strategies by name or description…"
            value={searchQuery}
            onChange={handleSearchChange}
          />
          <FilterSelect
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value as any)}
          >
            <option value="">All Risk Levels</option>
            <option value="LOW">Low Risk</option>
            <option value="MEDIUM">Medium Risk</option>
            <option value="HIGH">High Risk</option>
            <option value="AGGRESSIVE">Aggressive</option>
          </FilterSelect>
          <FilterSelect
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="roi30d">Sort: 30d ROI</option>
            <option value="followersCount">Sort: Followers</option>
            <option value="sharpeRatio">Sort: Sharpe Ratio</option>
            <option value="totalVolume">Sort: Volume</option>
          </FilterSelect>
        </FiltersRow>

        {loading ? (
          <LoadingGrid>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} />
            ))}
          </LoadingGrid>
        ) : (
          <Grid>
            {strategies.length === 0 ? (
              <RichEmptyState>
                <EmptyIcon>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#6C38FF"
                    strokeWidth="2"
                  >
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                    <polyline points="16 7 22 7 22 13" />
                  </svg>
                </EmptyIcon>
                <EmptyTitle>No strategies published yet</EmptyTitle>
                <EmptyDesc>
                  Be the first to publish a trading strategy on Lunex. Create an
                  Agent, generate an API Key, and register your strategy to the
                  marketplace.
                </EmptyDesc>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    flexWrap: 'wrap',
                    justifyContent: 'center'
                  }}
                >
                  <EmptyCTA onClick={() => navigate('/agents/get-started')}>
                    Get Started Guide
                  </EmptyCTA>
                  <button
                    onClick={() => navigate('/agent')}
                    style={{
                      padding: '12px 24px',
                      borderRadius: 12,
                      border: '1px solid #2A2A2C',
                      background: 'transparent',
                      color: '#8A8A8E',
                      fontFamily: "'Space Grotesk'",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Create Agent
                  </button>
                </div>
              </RichEmptyState>
            ) : (
              strategies.map(s => {
                const risk = RISK_COLORS[s.riskLevel] ?? RISK_COLORS.MEDIUM
                const isFollowing = following.has(s.id)
                const isFollowLoading = followLoading.has(s.id)

                return (
                  <Card
                    key={s.id}
                    onClick={() => navigate(`/strategies/${s.id}`)}
                  >
                    <CardHeader>
                      <div>
                        <CardTitle>{s.name}</CardTitle>
                        <CardMeta>
                          <Chip
                            color={TYPE_COLORS[s.strategyType]}
                            bg={TYPE_COLORS[s.strategyType] + '18'}
                          >
                            {s.strategyType.replace('_', ' ')}
                          </Chip>
                          <Chip color={risk.color} bg={risk.bg}>
                            {s.riskLevel}
                          </Chip>
                          {s.leader?.isAi && (
                            <Chip color="#7461FF" bg="rgba(116,97,255,0.12)">
                              AI
                            </Chip>
                          )}
                          {s.leader?.isVerified && (
                            <Chip color="#26D07C" bg="rgba(38,208,124,0.1)">
                              ✓ Verified
                            </Chip>
                          )}
                        </CardMeta>
                      </div>
                      <ROIBadge positive={s.roi30d >= 0}>
                        {fmtRoi(s.roi30d)}
                      </ROIBadge>
                    </CardHeader>

                    {s.description && (
                      <div
                        style={{
                          color: '#8A8A8E',
                          fontSize: '13px',
                          fontFamily: 'Space Grotesk',
                          lineHeight: 1.5
                        }}
                      >
                        {s.description.slice(0, 120)}
                        {s.description.length > 120 ? '…' : ''}
                      </div>
                    )}

                    <StatsRow>
                      <Stat>
                        <StatValue>{s.sharpeRatio.toFixed(2)}</StatValue>
                        <StatLabel>Sharpe</StatLabel>
                      </Stat>
                      <Stat>
                        <StatValue style={{ color: '#FF6B6B' }}>
                          -{(s.maxDrawdown * 100).toFixed(1)}%
                        </StatValue>
                        <StatLabel>Max DD</StatLabel>
                      </Stat>
                      <Stat>
                        <StatValue>{(s.winRate * 100).toFixed(0)}%</StatValue>
                        <StatLabel>Win Rate</StatLabel>
                      </Stat>
                    </StatsRow>

                    <StatsRow>
                      <Stat>
                        <StatValue>{fmtNumber(s.followersCount)}</StatValue>
                        <StatLabel>Followers</StatLabel>
                      </Stat>
                      <Stat>
                        <StatValue>{fmtUSD(s.vaultEquity)}</StatValue>
                        <StatLabel>Vault AUM</StatLabel>
                      </Stat>
                      <Stat>
                        <StatValue>{fmtNumber(s.totalTrades)}</StatValue>
                        <StatLabel>Trades</StatLabel>
                      </Stat>
                    </StatsRow>

                    {(s.agent || s.leader) && (
                      <AgentRow>
                        <Avatar url={s.leader?.avatar} />
                        <AgentName>
                          {s.leader
                            ? `@${s.leader.username}`
                            : s.agent?.walletAddress.slice(0, 8) + '…'}
                          {s.agent?.agentType !== 'HUMAN' && (
                            <span
                              style={{
                                marginLeft: 6,
                                color: '#7461FF',
                                fontSize: '11px'
                              }}
                            >
                              {s.agent?.framework ?? s.agent?.agentType}
                            </span>
                          )}
                        </AgentName>
                        {s.agent && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              color: '#8A8A8E',
                              fontSize: '12px'
                            }}
                          >
                            Rep {Number(s.agent.reputationScore).toFixed(0)}/100
                          </span>
                        )}
                      </AgentRow>
                    )}

                    <FollowBtn
                      following={isFollowing}
                      disabled={isFollowLoading}
                      onClick={e => handleFollow(s.id, e)}
                    >
                      {isFollowLoading
                        ? '…'
                        : isFollowing
                          ? 'Following · Unfollow'
                          : 'Follow Strategy'}
                    </FollowBtn>
                  </Card>
                )
              })
            )}
          </Grid>
        )}
        {!loading && strategies.length < total && (
          <LoadMoreBtn onClick={loadMore} disabled={loadingMore}>
            {loadingMore
              ? 'Loading…'
              : `Load More (${total - strategies.length} remaining)`}
          </LoadMoreBtn>
        )}
      </Container>
    </Page>
  )
}

export default StrategyMarketplacePage
