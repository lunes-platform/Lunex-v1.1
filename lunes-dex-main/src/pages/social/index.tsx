import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Search } from 'lucide-react'
import {
  BareInput,
  Button,
  C,
  Field,
  H1,
  Notice,
  Page,
  PillChip,
  Row,
  SkeletonLine,
  Sub,
  TabPanel,
  Tabs
} from 'components/ui/kit'
import { useSDK } from '../../context/SDKContext'
import { useToast } from '../../components/feedback/ToastProvider'
import socialApi, { CopytradePosition } from '../../services/socialService'
import CopyModal from '../copytrade/CopyModal'
import { useCopyPositions, useCopyWithdraw } from '../copytrade/useCopytrade'
import { Trader } from './types'
import TraderCard, { CardShell, TraderGrid } from './TraderCard'
import { DashedEmpty, fmtCompactUsd } from './shared'

type Tab = 'top' | 'copying'
type Kind = 'all' | 'traders' | 'bots'
type SortKey = 'roi30d' | 'followers' | 'winRate' | 'sharpe'

const SORTS: [SortKey, string][] = [
  ['roi30d', 'ROI 30d'],
  ['winRate', 'Win rate'],
  ['sharpe', 'Sharpe'],
  ['followers', 'Copiers']
]

const KINDS: [Kind, string][] = [
  ['all', 'All'],
  ['traders', 'Traders'],
  ['bots', 'AI agents']
]

const Filters = styled.div`
  display: flex;
  gap: 8px 12px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
`

const SearchField = styled(Field)`
  flex: 1 1 240px;
  max-width: 360px;
  color: ${C.muted};
  @media (max-width: 759px) {
    max-width: none;
  }
`

const SkeletonCard: React.FC = () => (
  <CardShell aria-hidden="true">
    <Row $gap={12}>
      <SkeletonLine $w="42px" $h={42} style={{ borderRadius: '50%' }} />
      <div style={{ flex: 1, display: 'grid', gap: 6 }}>
        <SkeletonLine $w="60%" />
        <SkeletonLine $w="40%" $h={10} />
      </div>
    </Row>
    <SkeletonLine $h={40} />
    <SkeletonLine $h={28} />
    <SkeletonLine $h={44} />
  </CardShell>
)

const SocialTrade: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress, connectWallet } = useSDK()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('top')
  const [kind, setKind] = useState<Kind>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('roi30d')
  const [leaders, setLeaders] = useState<Trader[]>([])
  const [extraLeaders, setExtraLeaders] = useState<Trader[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [copyTarget, setCopyTarget] = useState<Trader | null>(null)
  const copy = useCopyPositions()
  const withdraw = useCopyWithdraw()

  // Leaders (real API, 30s refresh)
  useEffect(() => {
    let alive = true
    const load = async (first: boolean) => {
      if (first) setIsLoading(true)
      try {
        const next = await socialApi.getLeaders({
          tab: kind,
          search,
          sortBy,
          limit: 50
        })
        if (!alive) return
        setLeaders(next)
        setLoadError('')
      } catch (err: unknown) {
        if (!alive) return
        setLoadError(
          err instanceof Error
            ? `${err.message}. Could not load traders.`
            : 'Social API unavailable.'
        )
      } finally {
        if (alive) setIsLoading(false)
      }
    }
    const t = window.setTimeout(() => void load(true), search ? 250 : 0)
    const id = window.setInterval(() => void load(false), 30000)
    return () => {
      alive = false
      window.clearTimeout(t)
      window.clearInterval(id)
    }
  }, [kind, search, sortBy])

  // Wallet changed → previous positions are no longer valid
  useEffect(() => {
    copy.reset()
    setExtraLeaders([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress])

  // Positions need a signed read: load when the user opens "Copying"
  useEffect(() => {
    if (tab !== 'copying' || !walletAddress) return
    if (copy.loadedFor === walletAddress || copy.loading) return
    void copy.load(walletAddress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, walletAddress])

  const positionByLeader = useMemo(() => {
    const m = new Map<string, CopytradePosition>()
    copy.positions.forEach(p => {
      if (p.shareBalance > 0) m.set(p.vault.leaderId, p)
    })
    return m
  }, [copy.positions])

  // Fetch profiles for copied leaders that aren't in the current list
  useEffect(() => {
    const known = new Set([...leaders, ...extraLeaders].map(l => l.id))
    const missing = [...positionByLeader.keys()].filter(id => !known.has(id))
    if (!missing.length) return
    let alive = true
    void Promise.allSettled(
      missing.map(id => socialApi.getLeaderProfile(id))
    ).then(res => {
      if (!alive) return
      const found = res
        .filter(
          (r): r is PromiseFulfilledResult<Trader> => r.status === 'fulfilled'
        )
        .map(r => r.value)
      if (found.length) setExtraLeaders(prev => [...prev, ...found])
    })
    return () => {
      alive = false
    }
  }, [positionByLeader, leaders, extraLeaders])

  const copyingList = useMemo(() => {
    const all = [...leaders, ...extraLeaders]
    const seen = new Set<string>()
    return all.filter(l => {
      if (!positionByLeader.has(l.id) || seen.has(l.id)) return false
      seen.add(l.id)
      return true
    })
  }, [leaders, extraLeaders, positionByLeader])

  const copyCount = positionByLeader.size
  const list = tab === 'top' ? leaders : copyingList

  const refreshPositions = () => {
    if (walletAddress && copy.loadedFor === walletAddress)
      void copy.load(walletAddress)
  }

  const retryPositions = () => {
    if (walletAddress) void copy.load(walletAddress)
  }

  const onCopy = (t: Trader) => {
    const pos = positionByLeader.get(t.id)
    if (pos) {
      withdraw(pos, String(pos.shareBalance), refreshPositions, {
        stop: true
      })
      return
    }
    setCopyTarget(t)
  }

  const connect = () =>
    connectWallet().catch((err: unknown) =>
      toast(
        'error',
        'Wallet not connected',
        err instanceof Error ? err.message : undefined
      )
    )

  const renderCopying = () => {
    if (!walletAddress)
      return (
        <DashedEmpty>
          Connect your wallet to see the traders you copy.
          <div style={{ marginTop: 12 }}>
            <Button size="sm" onClick={connect}>
              Connect wallet
            </Button>
          </div>
        </DashedEmpty>
      )
    if (copy.error && !copy.loading)
      return (
        <DashedEmpty>
          {copy.error}
          <div style={{ marginTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={retryPositions}>
              Try again
            </Button>
          </div>
        </DashedEmpty>
      )
    if (copy.loading && copy.loadedFor !== walletAddress)
      return (
        <TraderGrid>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </TraderGrid>
      )
    if (copy.loadedFor === walletAddress && copyCount === 0)
      return (
        <DashedEmpty style={{ padding: '48px 24px', fontSize: 14 }}>
          You are not copying anyone yet. Pick a trader from Top traders.
        </DashedEmpty>
      )
    return null
  }

  const copyingState = tab === 'copying' ? renderCopying() : null

  return (
    <Page $max={1080} style={{ gap: 16 }}>
      <div>
        <H1>Social trading</H1>
        <Sub style={{ fontSize: 15 }}>
          Copy proven traders and AI agents. Every trade they make is mirrored
          in your wallet, proportional to what you allocate.
        </Sub>
      </div>

      <Row $wrap>
        <Button variant="secondary" onClick={() => navigate('/spot/copytrade')}>
          Copytrade vaults
        </Button>
        <Button variant="secondary" onClick={() => navigate('/social/bots')}>
          Bot registry
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate('/social/settings')}
        >
          My trader profile
        </Button>
      </Row>

      <Tabs<Tab>
        ariaLabel="Social trading"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'top', label: 'Top traders' },
          {
            value: 'copying',
            label:
              copy.loadedFor && copy.loadedFor === walletAddress
                ? `Copying (${copyCount})`
                : 'Copying'
          }
        ]}
      />

      <TabPanel key={tab}>
        {tab === 'top' && (
          <Filters>
            <SearchField>
              <Search size={16} />
              <BareInput
                placeholder="Search traders and agents"
                aria-label="Search traders"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </SearchField>
            <Row $gap={6} $wrap>
              {KINDS.map(([k, l]) => (
                <PillChip
                  key={k}
                  $active={kind === k}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {l}
                </PillChip>
              ))}
              <span
                style={{ width: 1, height: 20, background: C.borderStrong }}
              />
              {SORTS.map(([k, l]) => (
                <PillChip
                  key={k}
                  $active={sortBy === k}
                  aria-pressed={sortBy === k}
                  onClick={() => setSortBy(k)}
                >
                  {l}
                </PillChip>
              ))}
            </Row>
          </Filters>
        )}

        {loadError && <Notice $tone="warning">{loadError}</Notice>}

        {copyingState ??
          (tab === 'top' && isLoading ? (
            <TraderGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </TraderGrid>
          ) : list.length === 0 ? (
            <DashedEmpty style={{ padding: '48px 24px', fontSize: 14 }}>
              {search
                ? 'No traders match your search.'
                : 'No traders listed yet.'}
            </DashedEmpty>
          ) : (
            <TraderGrid>
              {list.map(t => {
                const pos = positionByLeader.get(t.id)
                return (
                  <TraderCard
                    key={t.id}
                    trader={t}
                    copyingLabel={
                      pos
                        ? `Copying · ${fmtCompactUsd(pos.currentValue)} — stop`
                        : undefined
                    }
                    onProfile={() =>
                      navigate(`/social/profile/${t.id}`, {
                        state: { trader: t }
                      })
                    }
                    onCopy={() => onCopy(t)}
                  />
                )
              })}
            </TraderGrid>
          ))}
      </TabPanel>

      <CopyModal
        trader={copyTarget}
        onClose={() => setCopyTarget(null)}
        onSuccess={refreshPositions}
      />
    </Page>
  )
}

export default SocialTrade
