import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import {
  Activity as ActivityIcon,
  ArrowLeftRight,
  Droplet,
  Layers,
  Users,
  Vote
} from 'lucide-react'
import { useSDK } from '../../context/SDKContext'
import {
  ActivityItem,
  ActivityStatus,
  TxType,
  useTx
} from '../../context/TxContext'
import {
  Button,
  C,
  H1,
  Page,
  PillChip,
  SkeletonLine,
  Spinner,
  Sub,
  grotesk
} from 'components/ui/kit'
import { requestWalletConnect } from 'pages/header/modals/wallets'

type Filter = 'all' | 'swap' | 'liquidity' | 'staking'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'swap', label: 'Swaps' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'staking', label: 'Staking' }
]

/** TxType → filter group (governance / social / other sit with Staking). */
const groupOf = (t: TxType): Exclude<Filter, 'all'> =>
  t === 'swap' || t === 'spot'
    ? 'swap'
    : t === 'liquidity'
      ? 'liquidity'
      : 'staking'

const ICONS: Record<TxType, React.ElementType> = {
  swap: ArrowLeftRight,
  spot: ArrowLeftRight,
  liquidity: Droplet,
  staking: Layers,
  governance: Vote,
  social: Users,
  other: ActivityIcon
}

const CHIP: Record<ActivityStatus, [string, string, string]> = {
  confirmed: ['Confirmed', 'rgba(38,208,124,0.14)', C.successText],
  pending: ['Pending', 'rgba(108,56,255,0.16)', C.primaryText2],
  failed: ['Failed', 'rgba(255,40,76,0.14)', C.criticalText2],
  rejected: ['Rejected', 'rgba(254,146,63,0.14)', C.warning]
}

const SKELETON: [string, string][] = [
  ['46%', '28%'],
  ['38%', '22%'],
  ['52%', '30%'],
  ['40%', '24%'],
  ['44%', '26%']
]

const relTime = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

const Activity: React.FC = () => {
  const { activity } = useTx()
  const sdk = useSDK()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600)
    const i = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [])

  const connected = sdk.isConnected
  const rows = useMemo<ActivityItem[]>(
    () =>
      connected
        ? activity.filter(a => filter === 'all' || groupOf(a.type) === filter)
        : [],
    [activity, filter, connected]
  )

  return (
    <Page $max={760}>
      <div>
        <H1>Activity</H1>
        <Sub>
          Every transaction you sign on Lunex, with its on-chain status.
        </Sub>
      </div>

      <Filters role="tablist" aria-label="Filter activity">
        {FILTERS.map(f => (
          <PillChip
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            $active={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </PillChip>
        ))}
      </Filters>

      {loading ? (
        <List aria-busy="true" aria-label="Loading">
          {SKELETON.map(([w1, w2], i) => (
            <RowItem key={i}>
              <SkeletonLine
                $w="36px"
                $h={36}
                style={{ borderRadius: '50%', flexShrink: 0 }}
              />
              <RowText>
                <SkeletonLine $w={w1} $h={12} />
                <SkeletonLine $w={w2} $h={10} />
              </RowText>
              <SkeletonLine $w="72px" $h={12} />
            </RowItem>
          ))}
        </List>
      ) : rows.length === 0 ? (
        <EmptyBox>
          <EmptyTitle>
            {connected ? 'Nothing here yet' : 'Connect to see your activity'}
          </EmptyTitle>
          <EmptyBody>
            {connected
              ? 'Transactions of this type will show up here.'
              : 'Swaps, deposits and stakes you sign are tracked here with their on-chain status. Connect your wallet from the top right.'}
          </EmptyBody>
          {connected ? (
            <Button size="lg" onClick={() => navigate('/swap')}>
              Make a swap
            </Button>
          ) : (
            <Button size="lg" onClick={() => requestWalletConnect()}>
              Connect wallet
            </Button>
          )}
        </EmptyBox>
      ) : (
        <List>
          {rows.map(a => {
            const Icon = ICONS[a.type] ?? ActivityIcon
            const [label, bg, color] = CHIP[a.status] ?? CHIP.failed
            return (
              <RowItem key={a.id}>
                <IconBox>
                  <Icon size={18} strokeWidth={2} />
                </IconBox>
                <RowText>
                  <Title title={a.title}>{a.title}</Title>
                  <Meta>{relTime(a.ts, now)} · Lunes</Meta>
                </RowText>
                <StatusChip style={{ background: bg, color }}>
                  {a.status === 'pending' && (
                    <Spinner $size={10} $color={C.primaryText2} />
                  )}
                  {label}
                </StatusChip>
              </RowItem>
            )
          })}
        </List>
      )}
    </Page>
  )
}

export default Activity

// ─── Styles ──────────────────────────────────────────────────────

const Filters = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  button {
    height: 34px;
    padding: 0 14px;
    font-size: 13px;
  }
`

const List = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
`

const RowItem = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  & + & {
    border-top: 1px solid ${C.border};
  }
`

const IconBox = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 12px;
  background: ${C.surface};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${C.primaryText};
`

const RowText = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const Title = styled.span`
  font-weight: 500;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Meta = styled.span`
  font-size: 12px;
  color: ${C.muted};
`

const StatusChip = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
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
`

const EmptyTitle = styled.div`
  ${grotesk};
  font-size: 18px;
  font-weight: 600;
`

const EmptyBody = styled.div`
  font-size: 14px;
  color: ${C.muted};
  max-width: 360px;
  line-height: 1.5;
`
