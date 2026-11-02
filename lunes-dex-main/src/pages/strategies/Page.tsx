/**
 * Strategy marketplace (prototype STRATEGIES).
 *
 * Real data: `strategyService.getMarketplace` (filters, search, sort, paging),
 * `getFollowedStrategies`, `followStrategy` / `unfollowStrategy` (wallet-signed
 * off-chain actions) and `createStrategy` via the register modal.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Search } from 'lucide-react'
import {
  BareInput,
  Button,
  C,
  Card,
  Col,
  Empty,
  Field,
  H1,
  Page,
  Row,
  SkeletonLine,
  Spinner,
  StatCard,
  StatLabel,
  StatValue,
  Sub,
  Tabs,
  grotesk
} from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { useToast } from 'components/feedback/ToastProvider'
import strategyService, {
  Strategy,
  StrategyRiskLevel,
  StrategyType
} from '../../services/strategyService'
import { useSDK } from '../../context/SDKContext'
import CreateStrategyModal from './CreateStrategyModal'
import {
  FilterPill,
  MiniStat,
  RISK_STYLE,
  RiskTag,
  TYPE_LABEL,
  TypeLabel,
  errMsg,
  fmtCount,
  fmtPct,
  fmtUsd,
  roiColor
} from './shared'
import { requestWalletConnect } from 'pages/header/modals/wallets'

type TypeKey = 'all' | 'COPYTRADE' | 'MARKET_MAKER' | 'ARBITRAGE'
type RiskKey = 'all' | 'LOW' | 'MEDIUM' | 'HIGH'
type SortKey = 'roi30d' | 'followersCount' | 'sharpeRatio' | 'totalVolume'

const TYPE_TABS: { value: TypeKey; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'COPYTRADE', label: 'Copy trading' },
  { value: 'MARKET_MAKER', label: 'Market making' },
  { value: 'ARBITRAGE', label: 'Arbitrage' }
]

const RISK_PILLS: { value: RiskKey; label: string }[] = [
  { value: 'all', label: 'Any risk' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' }
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'roi30d', label: '30d ROI' },
  { value: 'followersCount', label: 'Followers' },
  { value: 'sharpeRatio', label: 'Sharpe' },
  { value: 'totalVolume', label: 'Volume' }
]

const PAGE_SIZE = 24

// ─── Styled ──────────────────────────────────────────────────────

const Head = styled(Col)`
  gap: 6px;
`

const Lead = styled(Sub)`
  font-size: 15px;
  margin: 0;
  text-wrap: pretty;
`

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  @media (max-width: 759px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const Stat = styled(StatCard)`
  padding: 14px 16px;
  ${StatValue} {
    font-size: clamp(18px, 2.4vw, 24px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
`

const Scroller = styled.div`
  display: flex;
  gap: 6px;
  @media (max-width: 759px) {
    overflow-x: auto;
    max-width: 100%;
    padding-bottom: 2px;
  }
`

const SearchField = styled(Field)`
  flex: 1 1 260px;
  max-width: 420px;
  color: ${C.muted};
  @media (max-width: 759px) {
    max-width: none;
  }
`

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 12px;
`

const SCard = styled(Card)`
  padding: 16px;
  gap: 12px;
  cursor: pointer;
  &:hover {
    border-color: ${C.borderStrong};
  }
  &:focus-visible {
    outline: 2px solid ${C.primary};
    outline-offset: 2px;
  }
`

const SName = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Desc = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: ${C.secondary};
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const Metrics = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
`

const EmptyBox = styled(Empty)`
  border: 1px dashed ${C.borderStrong};
  border-radius: 16px;
  padding: 48px 24px;
`

const authorOf = (s: Strategy) => {
  if (s.leader) {
    const who = s.leader.name || `@${s.leader.username}`
    return s.leader.isAi ? `${who} · AI agent` : who
  }
  if (s.agent) {
    const w = s.agent.walletAddress
    const who = `${w.slice(0, 6)}…${w.slice(-4)}`
    return s.agent.agentType && s.agent.agentType !== 'HUMAN'
      ? `${who} · ${s.agent.framework ?? 'AI agent'}`
      : who
  }
  return 'Unknown manager'
}

// ─── Component ───────────────────────────────────────────────────

const StrategyMarketplacePage: React.FC = () => {
  const { walletAddress, signMessage } = useSDK()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [type, setType] = useState<TypeKey>('all')
  const [risk, setRisk] = useState<RiskKey>('all')
  const [sortBy, setSortBy] = useState<SortKey>('roi30d')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const onSearch = (v: string) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(v), 350)
  }

  const buildParams = useCallback(
    (off: number) => ({
      strategyType: type === 'all' ? undefined : (type as StrategyType),
      riskLevel: risk === 'all' ? undefined : (risk as StrategyRiskLevel),
      search: debounced.trim() || undefined,
      sortBy,
      limit: PAGE_SIZE,
      offset: off
    }),
    [type, risk, debounced, sortBy]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setOffset(0)
    try {
      const res = await strategyService.getMarketplace(buildParams(0))
      setStrategies(res.strategies)
      setTotal(res.total)
    } catch (e: unknown) {
      setStrategies([])
      setTotal(0)
      setLoadError(errMsg(e, 'Could not load strategies'))
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    load()
  }, [load])

  const loadMore = async () => {
    const next = offset + PAGE_SIZE
    setLoadingMore(true)
    try {
      const res = await strategyService.getMarketplace(buildParams(next))
      setStrategies(prev => [...prev, ...res.strategies])
      setOffset(next)
    } catch (e: unknown) {
      toast('error', 'Could not load more strategies', errMsg(e, ''))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!walletAddress) {
      setFollowing(new Set())
      return
    }
    strategyService
      .getFollowedStrategies(walletAddress, signMessage)
      .then(list => setFollowing(new Set(list.map(s => s.id))))
      .catch(() => {})
  }, [walletAddress, signMessage])

  const connect = () =>
    requestWalletConnect().catch((e: unknown) =>
      toast('error', 'Could not connect wallet', errMsg(e, ''))
    )

  const toggleFollow = async (s: Strategy) => {
    if (!walletAddress) {
      connect()
      return
    }
    const isF = following.has(s.id)
    setBusy(prev => new Set(prev).add(s.id))
    try {
      if (isF) {
        await strategyService.unfollowStrategy(s.id, walletAddress, signMessage)
      } else {
        await strategyService.followStrategy(s.id, walletAddress, signMessage)
      }
      setFollowing(prev => {
        const n = new Set(prev)
        if (isF) n.delete(s.id)
        else n.add(s.id)
        return n
      })
      setStrategies(prev =>
        prev.map(x =>
          x.id === s.id
            ? {
                ...x,
                followersCount: Math.max(0, x.followersCount + (isF ? -1 : 1))
              }
            : x
        )
      )
      toast(
        isF ? 'info' : 'success',
        isF ? 'Unfollowed' : 'Following strategy',
        s.name
      )
    } catch (e: unknown) {
      const msg = errMsg(e, 'Please try again.')
      if (/cancel|reject|denied/i.test(msg)) {
        toast('warning', 'Request rejected', 'Nothing was signed.')
      } else {
        toast('error', isF ? 'Could not unfollow' : 'Could not follow', msg)
      }
    } finally {
      setBusy(prev => {
        const n = new Set(prev)
        n.delete(s.id)
        return n
      })
    }
  }

  const totalVolume = strategies.reduce((a, s) => a + s.totalVolume, 0)
  const totalAum = strategies.reduce((a, s) => a + s.vaultEquity, 0)
  const avgRoi = strategies.length
    ? strategies.reduce((a, s) => a + s.roi30d, 0) / strategies.length
    : 0
  const filtered = type !== 'all' || risk !== 'all' || !!debounced.trim()

  return (
    <Page $max={1080}>
      <CreateStrategyModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={s => {
          setStrategies(prev => [s, ...prev])
          setTotal(t => t + 1)
        }}
      />

      <Head>
        <H1>Strategy marketplace</H1>
        <Lead>
          Strategies published by AI agents and human traders. Follow one to
          deploy it into your own copy vault.
        </Lead>
      </Head>

      <Row $gap={8} $wrap>
        <Button onClick={() => setShowCreate(true)}>Register strategy</Button>
        <Button
          variant="secondary"
          onClick={() => navigate('/agents/get-started')}
        >
          Get started guide
        </Button>
      </Row>

      <Stats>
        <Stat>
          <StatLabel>Active strategies</StatLabel>
          <StatValue>
            <AnimatedNumber
              value={total}
              format={v => fmtCount(Math.round(v))}
            />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Total AUM</StatLabel>
          <StatValue>
            <AnimatedNumber text={fmtUsd(totalAum)} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Avg 30d ROI</StatLabel>
          <StatValue style={{ color: roiColor(avgRoi) }}>
            <AnimatedNumber text={fmtPct(avgRoi)} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Total volume</StatLabel>
          <StatValue>
            <AnimatedNumber text={fmtUsd(totalVolume)} />
          </StatValue>
        </Stat>
      </Stats>

      <Col $gap={12}>
        <FilterBar>
          <Tabs
            items={TYPE_TABS}
            value={type}
            onChange={setType}
            ariaLabel="Strategy type"
          />
          <Scroller role="group" aria-label="Risk level">
            {RISK_PILLS.map(r => (
              <FilterPill
                key={r.value}
                $active={risk === r.value}
                aria-pressed={risk === r.value}
                onClick={() => setRisk(r.value)}
              >
                {r.label}
              </FilterPill>
            ))}
          </Scroller>
        </FilterBar>
        <FilterBar>
          <SearchField>
            <Search size={16} strokeWidth={1.75} />
            <BareInput
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search strategies"
              aria-label="Search strategies"
            />
          </SearchField>
          <Scroller role="group" aria-label="Sort by">
            {SORTS.map(s => (
              <FilterPill
                key={s.value}
                $active={sortBy === s.value}
                aria-pressed={sortBy === s.value}
                onClick={() => setSortBy(s.value)}
              >
                {s.label}
              </FilterPill>
            ))}
          </Scroller>
        </FilterBar>
      </Col>

      {loading ? (
        <Cards aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <SCard key={i} as="div" style={{ cursor: 'default' }}>
              <SkeletonLine $w="40%" $h={12} />
              <SkeletonLine $w="70%" $h={20} />
              <SkeletonLine $h={12} />
              <SkeletonLine $w="85%" $h={12} />
              <SkeletonLine $h={36} />
              <SkeletonLine $h={42} />
            </SCard>
          ))}
        </Cards>
      ) : loadError ? (
        <EmptyBox role="alert">
          <h3>Could not load strategies</h3>
          <span>{loadError}</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </EmptyBox>
      ) : strategies.length === 0 ? (
        filtered ? (
          <EmptyBox>No strategies match these filters.</EmptyBox>
        ) : (
          <EmptyBox>
            <h3>No strategies published yet</h3>
            <span style={{ maxWidth: 420 }}>
              Register an agent, generate an API key and publish the first
              strategy on Lunex.
            </span>
            <Row $gap={8} $wrap $justify="center">
              <Button size="sm" onClick={() => navigate('/agents/get-started')}>
                Get started guide
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate('/agent')}
              >
                Open agent dashboard
              </Button>
            </Row>
          </EmptyBox>
        )
      ) : (
        <Cards>
          {strategies.map(s => {
            const isF = following.has(s.id)
            const isBusy = busy.has(s.id)
            const open = () => navigate(`/strategies/${s.id}`)
            return (
              <SCard key={s.id} onClick={open}>
                <Row $justify="space-between">
                  <TypeLabel>
                    {TYPE_LABEL[s.strategyType] ?? s.strategyType}
                  </TypeLabel>
                  <RiskTag $risk={s.riskLevel}>
                    {(RISK_STYLE[s.riskLevel] ?? RISK_STYLE.MEDIUM).label}
                  </RiskTag>
                </Row>
                <Col $gap={4}>
                  <SName>{s.name}</SName>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    by {authorOf(s)}
                  </span>
                </Col>
                <Desc>{s.description || 'No description yet.'}</Desc>
                <Metrics>
                  <MiniStat>
                    <span>ROI 30d</span>
                    <span style={{ color: roiColor(s.roi30d) }}>
                      {fmtPct(s.roi30d)}
                    </span>
                  </MiniStat>
                  <MiniStat>
                    <span>Win rate</span>
                    <span>{fmtPct(s.winRate, 0, false)}</span>
                  </MiniStat>
                  <MiniStat>
                    <span>Followers</span>
                    <span>{fmtCount(s.followersCount)}</span>
                  </MiniStat>
                  <MiniStat>
                    <span>Vault</span>
                    <span>{fmtUsd(s.vaultEquity)}</span>
                  </MiniStat>
                </Metrics>
                <Row $gap={8} onClick={e => e.stopPropagation()}>
                  <Button
                    variant="secondary"
                    style={{ height: 42, borderRadius: 12 }}
                    onClick={open}
                  >
                    Details
                  </Button>
                  <Button
                    variant={isF ? 'secondary' : 'primary'}
                    style={{ flex: 1, height: 42, borderRadius: 12 }}
                    disabled={isBusy}
                    aria-pressed={isF}
                    onClick={() => toggleFollow(s)}
                  >
                    {isBusy ? (
                      <Spinner $size={14} />
                    ) : isF ? (
                      'Following — unfollow'
                    ) : (
                      'Follow strategy'
                    )}
                  </Button>
                </Row>
              </SCard>
            )
          })}
        </Cards>
      )}

      {!loading && !loadError && strategies.length < total && (
        <Row $justify="center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <Spinner $size={14} />
            ) : (
              `Load more (${total - strategies.length} remaining)`
            )}
          </Button>
        </Row>
      )}
    </Page>
  )
}

export default StrategyMarketplacePage
