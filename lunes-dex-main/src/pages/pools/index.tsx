import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import {
  C,
  Page,
  PageHead,
  H1,
  Sub,
  Button,
  Tabs,
  TabPanel,
  StatCard,
  StatLabel,
  StatValue,
  SkeletonLine,
  Field,
  BareInput,
  grotesk,
  tabular
} from '../../components/ui/kit'
import AnimatedNumber from '../../components/ui/AnimatedNumber'
import TokenIcon from '../../components/TokenIcon'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { usePools, Pool, PoolPosition } from '../../hooks/usePools'
import { useSDK } from '../../context/SDKContext'
import { usd } from '../pool/format'
import { openWalletModal } from '../header/modals/wallets'

type PoolTab = 'all' | 'mine'

const COLS = 'minmax(220px, 2fr) repeat(3, minmax(0, 1fr)) 200px'

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 8px;
`

const SmallStat = styled(StatCard)`
  padding: 14px 16px;
  ${StatValue} {
    font-size: clamp(18px, 3vw, 26px);
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
`

const SearchField = styled(Field)`
  width: 100%;
  max-width: 280px;
  background: ${C.surface};
  border-color: ${C.borderStrong};
  @media (max-width: 759px) {
    max-width: none;
  }
`

const TableWrap = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
  background: ${C.bg};
`

const HeadRow = styled.div`
  display: grid;
  grid-template-columns: ${COLS};
  gap: 12px;
  padding: 14px 20px;
  background: ${C.surface};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${C.muted};
  span:not(:first-child) {
    text-align: right;
  }
`

const BodyRow = styled.div`
  display: grid;
  grid-template-columns: ${COLS};
  gap: 12px;
  align-items: center;
  padding: 16px 20px;
  border-top: 1px solid ${C.border};
  transition: background-color 150ms ease;
  ${tabular};
  &:hover {
    background: ${C.surface};
  }
  > .num {
    text-align: right;
    font-weight: 500;
  }
`

const Apr = styled.span`
  ${grotesk};
  ${tabular};
  text-align: right;
  font-weight: 600;
  color: ${C.success};
`

const PairCell = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`

const Icons = styled.div<{ $ring: string }>`
  display: flex;
  flex-shrink: 0;
  img + img {
    margin-left: -10px;
    border: 2px solid ${p => p.$ring};
    box-sizing: content-box;
  }
`

const PairName = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  b {
    ${grotesk};
    font-weight: 600;
    font-size: 15px;
  }
  small {
    font-size: 12px;
    color: ${C.muted};
  }
  small.mine {
    color: ${C.primaryText};
  }
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const PoolCard = styled.div`
  padding: 16px;
  border-radius: 16px;
  border: 1px solid ${C.border};
  background: ${C.surface};
  display: flex;
  flex-direction: column;
  gap: 14px;
`

const CardMeta = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: ${C.muted};
  ${tabular};
  b {
    color: #fff;
    font-weight: 500;
  }
`

const SkelRow = styled.div<{ $first: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-top: ${p => (p.$first ? 'none' : `1px solid ${C.border}`)};
`

const EmptyBox = styled.div`
  padding: 56px 24px;
  border-radius: 16px;
  border: 1px dashed ${C.borderStrong};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  h3 {
    ${grotesk};
    font-size: 18px;
    font-weight: 600;
  }
  p {
    font-size: 14px;
    color: ${C.muted};
    max-width: 360px;
    line-height: 1.5;
  }
`

const SKELETON = [
  ['46%', '28%'],
  ['38%', '22%'],
  ['52%', '30%'],
  ['40%', '24%'],
  ['44%', '26%']
]

type Row = {
  pool: Pool
  mine?: PoolPosition
}

const Pools: React.FC = () => {
  const navigate = useNavigate()
  const sdk = useSDK()
  const isMobile = useIsMobile()
  const { pools, isLoading, positions, positionsLoading } = usePools()
  const [tab, setTab] = useState<PoolTab>('all')
  const [search, setSearch] = useState('')

  const connected = !!sdk.walletAddress

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pools
      .filter(
        p =>
          !q ||
          `${p.token0.symbol} ${p.token1.symbol} ${p.token0.name} ${p.token1.name}`
            .toLowerCase()
            .includes(q)
      )
      .map(p => ({
        pool: p,
        mine: connected ? positions[p.pairAddress] : undefined
      }))
      .filter(r => tab === 'all' || !!r.mine)
  }, [pools, search, tab, positions, connected])

  const tvl = pools.reduce((a, p) => a + p.liquidity, 0)
  const vol = pools.reduce((a, p) => a + p.volume24h, 0)
  const myLiq = Object.values(positions).reduce((a, p) => a + p.valueUsd, 0)

  const loading = isLoading || (tab === 'mine' && connected && positionsLoading)
  const mineNoConn = tab === 'mine' && !connected

  const goNew = () => navigate('/pool')
  const goSwap = (p: Pool) =>
    navigate(
      `/swap?from=${encodeURIComponent(p.token1.symbol)}&to=${encodeURIComponent(p.token0.symbol)}`
    )
  const goAdd = (r: Row) =>
    navigate(
      `/pool?a=${encodeURIComponent(r.pool.token0.symbol)}&b=${encodeURIComponent(r.pool.token1.symbol)}${r.mine ? '&tab=remove' : ''}`
    )

  const sub = (r: Row) =>
    r.mine ? (
      <small className="mine">Your position · {usd(r.mine.valueUsd)}</small>
    ) : (
      <small>Fee {r.pool.fee}</small>
    )

  const icons = (p: Pool, ring: string) => (
    <Icons $ring={ring}>
      <TokenIcon
        address={p.token0.address}
        symbol={p.token0.symbol}
        size={32}
      />
      <TokenIcon
        address={p.token1.address}
        symbol={p.token1.symbol}
        size={32}
      />
    </Icons>
  )

  let empty: {
    title: string
    body: string
    cta: string
    on: () => void
  } | null = null
  if (!loading && rows.length === 0) {
    if (mineNoConn)
      empty = {
        title: 'Connect to see your positions',
        body: 'Your liquidity positions appear here once your wallet is connected.',
        cta: 'Connect wallet',
        on: openWalletModal
      }
    else if (tab === 'mine' && !search)
      empty = {
        title: 'No positions yet',
        body: 'Deposit into a pool to start earning a share of swap fees.',
        cta: 'New position',
        on: goNew
      }
    else if (pools.length === 0 && !search)
      empty = {
        title: 'No pools yet',
        body: 'No liquidity pool has been created on Lunex yet. Be the first provider.',
        cta: 'New position',
        on: goNew
      }
    else
      empty = {
        title: 'No pools found',
        body: 'No pool matches that token. You can create one.',
        cta: 'New position',
        on: goNew
      }
  }

  return (
    <Page $max={1080} style={{ gap: 20 }}>
      <PageHead>
        <div>
          <H1>Liquidity pools</H1>
          <Sub style={{ fontSize: 15 }}>
            Deposit token pairs, earn 0.3% of every swap through your pool.
          </Sub>
        </div>
        <Button size="md" onClick={goNew} style={{ height: 44 }}>
          <Plus size={16} strokeWidth={2} />
          New position
        </Button>
      </PageHead>

      <Stats>
        <SmallStat>
          <StatLabel>Total value locked</StatLabel>
          <StatValue>
            {isLoading ? (
              <SkeletonLine $w="70%" $h={24} />
            ) : (
              <AnimatedNumber text={usd(tvl)} />
            )}
          </StatValue>
        </SmallStat>
        <SmallStat>
          <StatLabel>Volume, last 24h</StatLabel>
          <StatValue>
            {isLoading ? (
              <SkeletonLine $w="70%" $h={24} />
            ) : (
              <AnimatedNumber text={usd(vol)} />
            )}
          </StatValue>
        </SmallStat>
        <SmallStat>
          <StatLabel>Your liquidity</StatLabel>
          <StatValue style={{ color: connected ? C.success : C.muted }}>
            {connected ? <AnimatedNumber text={usd(myLiq)} /> : '—'}
          </StatValue>
        </SmallStat>
      </Stats>

      <Toolbar>
        <Tabs<PoolTab>
          ariaLabel="Pool filter"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'all', label: 'All pools' },
            { value: 'mine', label: 'My positions' }
          ]}
        />
        <SearchField>
          <Search size={16} color={C.muted} strokeWidth={2} />
          <BareInput
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by token"
            aria-label="Search pools"
          />
        </SearchField>
      </Toolbar>

      <TabPanel key={tab}>
        {loading ? (
          <TableWrap aria-busy="true" aria-label="Loading pools">
            {SKELETON.map(([w1, w2], i) => (
              <SkelRow key={i} $first={i === 0}>
                <SkeletonLine
                  $w="36px"
                  $h={36}
                  style={{ borderRadius: '50%' }}
                />
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <SkeletonLine $w={w1} $h={12} />
                  <SkeletonLine $w={w2} $h={10} />
                </div>
                <SkeletonLine $w="72px" $h={12} />
              </SkelRow>
            ))}
          </TableWrap>
        ) : empty ? (
          <EmptyBox>
            <h3>{empty.title}</h3>
            <p>{empty.body}</p>
            <Button size="md" onClick={empty.on} style={{ height: 44 }}>
              {empty.cta}
            </Button>
          </EmptyBox>
        ) : isMobile ? (
          <CardList>
            {rows.map(r => (
              <PoolCard key={r.pool.pairAddress}>
                <PairCell>
                  {icons(r.pool, C.surface)}
                  <PairName style={{ flex: 1 }}>
                    <b>
                      {r.pool.token0.symbol} / {r.pool.token1.symbol}
                    </b>
                    {sub(r)}
                  </PairName>
                  <Apr>{r.pool.apr.toFixed(1)}%</Apr>
                </PairCell>
                <CardMeta>
                  <span>
                    TVL <b>{usd(r.pool.liquidity)}</b>
                  </span>
                  <span>
                    24h <b>{usd(r.pool.volume24h)}</b>
                  </span>
                </CardMeta>
                <Actions>
                  <Button
                    variant="secondary"
                    size="lg"
                    style={{ flex: 1, height: 44 }}
                    onClick={() => goSwap(r.pool)}
                  >
                    Swap
                  </Button>
                  <Button
                    size="lg"
                    style={{ flex: 1, height: 44 }}
                    onClick={() => goAdd(r)}
                  >
                    {r.mine ? 'Manage' : 'Deposit'}
                  </Button>
                </Actions>
              </PoolCard>
            ))}
          </CardList>
        ) : (
          <TableWrap>
            <HeadRow>
              <span>Pool</span>
              <span>TVL</span>
              <span>Volume 24h</span>
              <span>APR</span>
              <span />
            </HeadRow>
            {rows.map(r => (
              <BodyRow key={r.pool.pairAddress}>
                <PairCell>
                  {icons(r.pool, C.bg)}
                  <PairName>
                    <b>
                      {r.pool.token0.symbol} / {r.pool.token1.symbol}
                    </b>
                    {sub(r)}
                  </PairName>
                </PairCell>
                <span className="num">{usd(r.pool.liquidity)}</span>
                <span className="num">{usd(r.pool.volume24h)}</span>
                <Apr>{r.pool.apr.toFixed(1)}%</Apr>
                <Actions>
                  <Button
                    variant="secondary"
                    size="sm"
                    style={{ height: 34 }}
                    onClick={() => goSwap(r.pool)}
                  >
                    Swap
                  </Button>
                  <Button
                    size="sm"
                    style={{ height: 34 }}
                    onClick={() => goAdd(r)}
                  >
                    {r.mine ? 'Manage' : 'Deposit'}
                  </Button>
                </Actions>
              </BodyRow>
            ))}
          </TableWrap>
        )}
      </TabPanel>
    </Page>
  )
}

export default Pools
