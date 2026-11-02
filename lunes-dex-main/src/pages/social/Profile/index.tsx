import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'
import { BadgeCheck, ExternalLink, Share2 } from 'lucide-react'
import {
  Button,
  C,
  Card,
  Page,
  SkeletonLine,
  Spinner,
  TabPanel,
  Tabs,
  grotesk,
  tabular
} from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { useSDK } from '../../../context/SDKContext'
import { useToast } from '../../../components/feedback/ToastProvider'
import socialApi, {
  buildFollowLeaderMessage,
  buildUnfollowLeaderMessage,
  createSignedActionMetadata
} from '../../../services/socialService'
import CopyModal from '../../copytrade/CopyModal'
import { LeaderFollower, Trader } from '../types'
import {
  AIBadge,
  aumLabel,
  BackToSocial,
  DashedEmpty,
  fmtCount,
  fmtPct,
  handle,
  ListBox,
  ListRow,
  relTime,
  roiColor,
  SectionTitle,
  SideLabel,
  TraderAvatar
} from '../shared'
import PnLChart from './PnLChart'
import IdeaItem from './IdeaItem'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const Header = styled(Card)`
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
`

const HeadInfo = styled.div`
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const Name = styled.h1`
  ${grotesk};
  font-size: 26px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  @media (max-width: 759px) {
    font-size: 22px;
  }
`

const Bio = styled.p`
  font-size: 14px;
  color: ${C.secondary};
  line-height: 1.5;
`

const Links = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${C.primaryText};
    text-decoration: none;
  }
  a:hover {
    color: ${C.primaryText2};
  }
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  @media (max-width: 759px) {
    width: 100%;
    > button:last-child {
      flex: 1;
    }
  }
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
  @media (max-width: 759px) {
    grid-template-columns: repeat(2, 1fr);
  }
`

const Stat = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: ${C.surface};
  border: 1px solid ${C.border};
  min-width: 0;
  > div:first-child {
    font-size: 12px;
    color: ${C.muted};
    margin-bottom: 6px;
  }
  > div:last-child {
    ${grotesk};
    ${tabular};
    font-size: clamp(17px, 2.2vw, 22px);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Followers = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const FollowerChip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  border: 1px solid ${C.border};
  background: ${C.surface};
  font-size: 12px;
  > span:first-child {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: ${C.borderStrong};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 10px;
  }
  small {
    color: ${C.muted};
    margin-left: 4px;
  }
`

interface ProfileLocationState {
  trader?: Trader
}

type Tab = 'trades' | 'ideas'

const Profile: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { walletAddress, signMessage } = useSDK()
  const { toast } = useToast()
  const [trader, setTrader] = useState<Trader | null>(
    () => (location.state as ProfileLocationState | null)?.trader ?? null
  )
  const [followers, setFollowers] = useState<LeaderFollower[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [followLoading, setFollowLoading] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const [tab, setTab] = useState<Tab>('trades')
  const signedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!id) {
      setIsLoading(false)
      return
    }
    const passed = (location.state as ProfileLocationState | null)?.trader
    setTrader(prev =>
      prev?.id === id ? prev : passed?.id === id ? passed : null
    )
    setIsLoading(true)
    let alive = true
    // The viewer-specific (signed) read runs once per leader + wallet; the
    // 30s refresh is unsigned so it never re-prompts the wallet.
    const load = async (signed: boolean) => {
      try {
        const [next, nextFollowers] = await Promise.all([
          signed && walletAddress
            ? socialApi.getLeaderProfile(id, walletAddress, signMessage)
            : socialApi.getLeaderProfile(id),
          socialApi.getLeaderFollowers(id, 8)
        ])
        if (!alive) return
        setTrader(prev =>
          signed || prev?.id !== next.id
            ? next
            : { ...next, isFollowing: prev?.isFollowing ?? next.isFollowing }
        )
        setFollowers(nextFollowers)
        if (signed) signedFor.current = `${id}:${walletAddress ?? ''}`
      } catch {
        // keep the trader passed through navigation state (if any)
      } finally {
        if (alive) setIsLoading(false)
      }
    }
    const key = `${id}:${walletAddress ?? ''}`
    void load(signedFor.current !== key)
    const t = window.setInterval(() => void load(false), 30000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, walletAddress])

  const onFollow = async () => {
    if (!id || !trader) return
    if (!walletAddress) {
      requestWalletConnect().catch((err: unknown) =>
        toast(
          'error',
          'Wallet not connected',
          err instanceof Error ? err.message : undefined
        )
      )
      return
    }
    setFollowLoading(true)
    const following = !!trader.isFollowing
    try {
      const auth = createSignedActionMetadata()
      const build = following
        ? buildUnfollowLeaderMessage
        : buildFollowLeaderMessage
      const signature = await signMessage(
        build({
          leaderId: id,
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )
      const payload = {
        address: walletAddress,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature
      }
      if (following) await socialApi.unfollowLeader(id, payload)
      else await socialApi.followLeader(id, payload)
      setTrader(t =>
        t
          ? {
              ...t,
              isFollowing: !following,
              followers: Math.max(t.followers + (following ? -1 : 1), 0)
            }
          : t
      )
      socialApi
        .getLeaderFollowers(id, 8)
        .then(setFollowers)
        .catch(() => undefined)
      toast(
        'info',
        following ? 'Unfollowed' : 'Following',
        following
          ? `You stopped following ${trader.name}.`
          : `You now follow ${trader.name}.`
      )
    } catch (err: unknown) {
      toast(
        'error',
        'Could not update follow',
        err instanceof Error ? err.message : undefined
      )
    } finally {
      setFollowLoading(false)
    }
  }

  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('success', 'Profile link copied')
    } catch {
      toast('error', 'Could not copy the link')
    }
  }

  if (isLoading && !trader)
    return (
      <Page $max={1000} style={{ gap: 16 }} aria-busy="true">
        <BackToSocial />
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <SkeletonLine $w="64px" $h={64} style={{ borderRadius: '50%' }} />
            <div style={{ flex: 1, display: 'grid', gap: 8 }}>
              <SkeletonLine $w="40%" $h={22} />
              <SkeletonLine $w="60%" />
            </div>
          </div>
        </Card>
        <StatsGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonLine key={i} $h={72} style={{ borderRadius: 14 }} />
          ))}
        </StatsGrid>
        <SkeletonLine $h={240} style={{ borderRadius: 16 }} />
      </Page>
    )

  if (!trader)
    return (
      <Page $max={1000} style={{ gap: 16 }}>
        <BackToSocial />
        <DashedEmpty style={{ padding: '48px 24px', fontSize: 14 }}>
          Trader not found.
        </DashedEmpty>
      </Page>
    )

  const color = roiColor(trader.roi30d)
  const links = trader.socialLinks ?? {}
  const stats: { label: string; value: string; color?: string }[] = [
    { label: 'ROI 30d', value: fmtPct(trader.roi30d), color },
    {
      label: 'ROI 90d',
      value: fmtPct(trader.roi90d),
      color: roiColor(trader.roi90d)
    },
    { label: 'Win rate', value: `${(trader.winRate ?? 0).toFixed(0)}%` },
    { label: 'Sharpe', value: (trader.sharpe ?? 0).toFixed(1) },
    { label: 'AUM', value: aumLabel(trader.aum) },
    {
      label: 'Max drawdown',
      value: `−${Math.abs(trader.drawdown ?? 0).toFixed(1)}%`,
      color: C.warning
    }
  ]

  return (
    <Page $max={1000} style={{ gap: 16 }}>
      <BackToSocial />

      <Header>
        <TraderAvatar
          name={trader.name}
          avatar={trader.avatar}
          ai={trader.isAI}
          size={64}
        />
        <HeadInfo>
          <Name>
            {trader.name}
            {trader.isAI && <AIBadge $lg />}
            {trader.isVerified && (
              <BadgeCheck
                size={18}
                color={C.primaryText}
                aria-label="Verified"
              />
            )}
          </Name>
          <span style={{ fontSize: 13, color: C.muted }}>
            {handle(trader.username)} · {fmtCount(trader.followers)} copiers
            {trader.memberSince ? ` · since ${trader.memberSince}` : ''} ·{' '}
            {trader.fee}% perf. fee
          </span>
          {trader.bio && <Bio>{trader.bio}</Bio>}
          {(links.twitterUrl || links.telegramUrl || links.discordUrl) && (
            <Links>
              {links.twitterUrl && (
                <a href={links.twitterUrl} target="_blank" rel="noreferrer">
                  X / Twitter <ExternalLink size={12} />
                </a>
              )}
              {links.telegramUrl && (
                <a href={links.telegramUrl} target="_blank" rel="noreferrer">
                  Telegram <ExternalLink size={12} />
                </a>
              )}
              {links.discordUrl && (
                <a href={links.discordUrl} target="_blank" rel="noreferrer">
                  Discord <ExternalLink size={12} />
                </a>
              )}
            </Links>
          )}
        </HeadInfo>
        <Actions>
          <Button
            variant="ghost"
            aria-label="Copy profile link"
            onClick={() => void onShare()}
            style={{ height: 44, width: 44, padding: 0 }}
          >
            <Share2 size={16} />
          </Button>
          <Button
            variant="secondary"
            style={{ height: 44 }}
            disabled={followLoading}
            aria-pressed={!!trader.isFollowing}
            onClick={() => void onFollow()}
          >
            {followLoading ? (
              <Spinner />
            ) : trader.isFollowing ? (
              'Following'
            ) : (
              'Follow'
            )}
          </Button>
          <Button
            variant="secondary"
            style={{ height: 44 }}
            onClick={() => navigate('/spot/copytrade')}
          >
            Vault
          </Button>
          <Button style={{ height: 44 }} onClick={() => setShowCopy(true)}>
            Copy trader
          </Button>
        </Actions>
      </Header>

      <StatsGrid>
        {stats.map(s => (
          <Stat key={s.label}>
            <div>{s.label}</div>
            <div style={{ color: s.color ?? '#fff' }}>
              <AnimatedNumber text={s.value} />
            </div>
          </Stat>
        ))}
      </StatsGrid>

      <Card $pad={16} style={{ gap: 10 }}>
        <span
          style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15 }}
        >
          PnL performance (30 days)
        </span>
        <PnLChart data={trader.pnlHistory} color={color} />
      </Card>

      <Tabs<Tab>
        ariaLabel="Trader activity"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'trades', label: 'Recent trades' },
          { value: 'ideas', label: `Ideas (${trader.ideas.length})` }
        ]}
      />

      <TabPanel key={tab}>
        {tab === 'trades' ? (
          trader.trades.length === 0 ? (
            <DashedEmpty>No trades yet.</DashedEmpty>
          ) : (
            <ListBox>
              {trader.trades.slice(0, 20).map((t, i) => (
                <ListRow key={`${t.date}-${t.pair}-${i}`}>
                  <SideLabel $buy={t.side === 'Buy'}>{t.side}</SideLabel>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {t.pair} · {t.entry.toLocaleString()} →{' '}
                    {t.status === 'Open' ? 'open' : t.exit.toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 600, color: roiColor(t.pnl) }}>
                    {fmtPct(t.pnl, 2)}
                  </span>
                  <span
                    style={{
                      color: C.muted,
                      minWidth: 72,
                      textAlign: 'right'
                    }}
                  >
                    {t.date}
                  </span>
                </ListRow>
              ))}
            </ListBox>
          )
        ) : trader.ideas.length === 0 ? (
          <DashedEmpty>No ideas published yet.</DashedEmpty>
        ) : (
          trader.ideas.map(idea => <IdeaItem key={idea.id} idea={idea} />)
        )}
      </TabPanel>

      <SectionTitle style={{ fontSize: 15 }}>Latest followers</SectionTitle>
      {followers.length === 0 ? (
        <span style={{ fontSize: 13, color: C.muted }}>No followers yet.</span>
      ) : (
        <Followers>
          {followers.map(f => (
            <FollowerChip key={f.id}>
              <span>{f.initials}</span>
              <span>
                {f.name}
                <small>
                  {f.username ? handle(f.username) : relTime(f.followedAt)}
                </small>
              </span>
            </FollowerChip>
          ))}
        </Followers>
      )}

      <CopyModal
        trader={showCopy ? trader : null}
        onClose={() => setShowCopy(false)}
      />
    </Page>
  )
}

export default Profile
