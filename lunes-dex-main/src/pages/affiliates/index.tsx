import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Copy, Send } from 'lucide-react'
import { useSDK } from '../../context/SDKContext'
import { useToast } from '../../components/feedback/ToastProvider'
import { AnimatedNumber } from '../../components/ui/AnimatedNumber'
import {
  Button,
  C,
  Card,
  Col,
  Empty,
  H1,
  H2,
  Muted,
  Page,
  Row,
  SkeletonLine,
  StatCard,
  StatLabel,
  StatValue,
  Sub,
  TabPanel,
  Tabs,
  grotesk,
  short,
  tabular
} from '../../components/ui/kit'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const SPOT_API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

type LevelInfo = { level: number; ratePct: number; rateBps: number }
type EarningByLevel = {
  level: number
  token: string
  totalEarned: number
  tradeCount: number
}
type DashboardData = {
  referralCode: string
  directReferrals: number
  earningsByLevel: EarningByLevel[]
  totalUnpaid: number
  unpaidCount: number
  totalPaid: number
  paidCount: number
  levels: LevelInfo[]
}
type TreeNode = {
  address: string
  joinedAt: string
  level: number
  subReferrals: number
  totalFeeGenerated: number
  children: TreeNode[]
}
type PayoutRow = {
  id: string
  level: number
  token: string
  amount: number
  sourceType: string
  paidAt: string
  batchId: string | null
}

// Fallback when the API has not answered yet — the backend owns the rates.
const DEFAULT_LEVELS: LevelInfo[] = [
  { level: 1, ratePct: 4, rateBps: 400 },
  { level: 2, ratePct: 2, rateBps: 200 },
  { level: 3, ratePct: 1.5, rateBps: 150 },
  { level: 4, ratePct: 1, rateBps: 100 },
  { level: 5, ratePct: 0.5, rateBps: 50 }
]

const LEVEL_COPY: [string, string][] = [
  ['Direct referrals', 'People who join with your link'],
  ['2nd level', 'Referrals of your referrals'],
  ['3rd level', 'Third-degree network'],
  ['4th level', 'Fourth-degree network'],
  ['5th level', 'Maximum depth']
]

const fmtAmt = (n: number) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

/** Flattens the referral tree into rows with their depth level. */
const flatten = (nodes: TreeNode[], depth = 1): (TreeNode & { d: number })[] =>
  nodes.flatMap(n => [
    { ...n, d: n.level || depth },
    ...flatten(n.children || [], depth + 1)
  ])

// ─── Styles ──────────────────────────────────────────────────────

const LinkBox = styled.div`
  flex: 1;
  min-width: 220px;
  height: 46px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid ${C.borderStrong};
  background: ${C.bg};
  display: flex;
  align-items: center;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  @media (max-width: 759px) {
    min-width: 0;
    width: 100%;
    flex-basis: 100%;
  }
`

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  @media (max-width: 479px) {
    grid-template-columns: 1fr 1fr;
  }
`

const ListBox = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  overflow: hidden;
`

const ListRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  font-size: 13px;
  ${tabular};
  & + & {
    border-top: 1px solid ${C.border};
  }
  @media (max-width: 759px) {
    gap: 10px;
    padding: 12px;
  }
`

const LevelNum = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  flex-shrink: 0;
  background: rgba(108, 56, 255, 0.16);
  color: ${C.primaryText2};
  ${grotesk};
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`

const Rate = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 18px;
`

const Right = styled.span<{ $color?: string; $w?: number }>`
  min-width: ${p => p.$w ?? 84}px;
  text-align: right;
  color: ${p => p.$color ?? '#fff'};
  white-space: nowrap;
  @media (max-width: 479px) {
    min-width: 0;
  }
`

const ShareLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid ${C.borderStrong};
  color: ${C.secondary};
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  &:hover {
    color: #fff;
    border-color: ${C.primary};
  }
`

const Mono = styled.span`
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
`

// ─── Component ───────────────────────────────────────────────────

type NetTab = 'network' | 'payouts'

const Affiliates: React.FC = () => {
  const sdk = useSDK()
  const { toast } = useToast()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk

  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [referralCode, setReferralCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [netTab, setNetTab] = useState<NetTab>('network')

  const address = sdk.walletAddress || ''
  const connected = sdk.isConnected && !!address

  const signRead = useCallback(
    async (action: string, fields?: Record<string, string | number>) => {
      const s = sdkRef.current
      const addr = s.walletAddress
      if (!addr) throw new Error('Wallet address required')
      const meta = createSignedActionMetadata()
      const signature = await s.signMessage(
        buildWalletActionMessage({
          action,
          address: addr,
          nonce: meta.nonce,
          timestamp: meta.timestamp,
          fields
        })
      )
      return new URLSearchParams({
        address: addr,
        nonce: meta.nonce,
        timestamp: String(meta.timestamp),
        signature,
        ...Object.fromEntries(
          Object.entries(fields ?? {}).map(([k, v]) => [k, String(v)])
        )
      }).toString()
    },
    []
  )

  useEffect(() => {
    if (!connected) {
      setDashboard(null)
      setTree([])
      setPayouts([])
      setReferralCode('')
      return
    }
    let alive = true

    // Local code first (same SHA-256 derivation as the backend), API overrides.
    ;(async () => {
      try {
        const buf = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(address)
        )
        const hex = Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        if (alive) setReferralCode(p => p || hex.slice(0, 8).toUpperCase())
      } catch {
        if (alive) setReferralCode(p => p || address.slice(2, 10).toUpperCase())
      }
    })()

    const load = async () => {
      setLoading(true)
      try {
        const q = await signRead('affiliate.code')
        const r = await fetch(`${SPOT_API}/api/v1/affiliate/code?${q}`)
        const d = await r.json()
        if (alive && d.code) setReferralCode(d.code)
      } catch {
        /* keep local code */
      }
      try {
        const q = await signRead('affiliate.dashboard')
        const r = await fetch(`${SPOT_API}/api/v1/affiliate/dashboard?${q}`)
        const d = await r.json()
        if (alive && d.dashboard) {
          setDashboard(d.dashboard)
          if (d.dashboard.referralCode)
            setReferralCode(d.dashboard.referralCode)
        }
      } catch (err) {
        console.error('Failed to fetch affiliate dashboard:', err)
      } finally {
        if (alive) setLoading(false)
      }
      try {
        const q = await signRead('affiliate.tree', { depth: 3 })
        const r = await fetch(`${SPOT_API}/api/v1/affiliate/tree?${q}`)
        const d = await r.json()
        if (alive) setTree(d.tree || [])
      } catch (err) {
        console.error('Failed to fetch referral tree:', err)
      }
      try {
        const q = await signRead('affiliate.payouts', { limit: 20 })
        const r = await fetch(`${SPOT_API}/api/v1/affiliate/payouts?${q}`)
        const d = await r.json()
        if (alive) setPayouts(d.payouts || [])
      } catch (err) {
        console.error('Failed to fetch payouts:', err)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [connected, address, signRead])

  const referralLink = referralCode
    ? `${window.location.origin}/?ref=${referralCode}`
    : ''
  const displayLink = referralLink.replace(/^https?:\/\//, '')

  const copyLink = async () => {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      toast('success', 'Link copied', displayLink, { silent: true })
    } catch {
      toast('error', 'Could not copy', 'Copy the link manually.', {
        silent: true
      })
    }
  }

  const shareText = `Trade on Lunex DEX and earn together! Join via my referral link: ${referralLink}`
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    referralLink
  )}&text=${encodeURIComponent('Join Lunex DEX with my referral!')}`

  const levels = dashboard?.levels?.length ? dashboard.levels : DEFAULT_LEVELS
  const earnedAt = (lvl: number) =>
    (dashboard?.earningsByLevel || [])
      .filter(e => e.level === lvl)
      .reduce((s, e) => s + e.totalEarned, 0)
  const totalEarned = dashboard
    ? dashboard.totalPaid + dashboard.totalUnpaid
    : 0
  const netRows = flatten(tree)

  const stats: { label: string; node: React.ReactNode; color?: string }[] = [
    {
      label: 'Direct referrals',
      node: dashboard ? (
        <AnimatedNumber value={dashboard.directReferrals} />
      ) : (
        '—'
      )
    },
    {
      label: 'Network size',
      node: dashboard ? <AnimatedNumber value={netRows.length} /> : '—'
    },
    {
      label: 'Total earned',
      color: dashboard && totalEarned > 0 ? C.success : undefined,
      node: dashboard ? (
        <AnimatedNumber value={totalEarned} format={v => `$${fmtAmt(v)}`} />
      ) : (
        '—'
      )
    },
    {
      label: 'Unpaid (next payout)',
      node: dashboard ? (
        <AnimatedNumber
          value={dashboard.totalUnpaid}
          format={v => `$${fmtAmt(v)}`}
        />
      ) : (
        '—'
      )
    }
  ]

  return (
    <Page $max={960}>
      <div>
        <H1>Affiliates</H1>
        <Sub>
          Refer traders and earn on every trade they make — up to 5 levels deep,
          from 4% down to 0.5%.
        </Sub>
      </div>

      <Card>
        <span
          style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 16 }}
        >
          Your referral link
        </span>
        {connected ? (
          referralLink ? (
            <>
              <Row $gap={8} $wrap>
                <LinkBox title={referralLink}>{displayLink}</LinkBox>
                <Button size="lg" onClick={copyLink} style={{ height: 46 }}>
                  <Copy size={16} strokeWidth={2} />
                  Copy link
                </Button>
              </Row>
              <Row $gap={8} $wrap>
                <ShareLink
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Share on X
                </ShareLink>
                <ShareLink
                  href={telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Send size={14} strokeWidth={2} />
                  Telegram
                </ShareLink>
              </Row>
            </>
          ) : (
            <SkeletonLine $h={46} />
          )
        ) : (
          <Row $justify="space-between" $gap={12} $wrap>
            <Muted $size={14}>Connect a wallet to generate your link.</Muted>
            <Button size="lg" onClick={() => requestWalletConnect()}>
              Connect wallet
            </Button>
          </Row>
        )}
      </Card>

      <StatGrid>
        {stats.map(s => (
          <StatCard key={s.label} style={{ padding: '14px 16px' }}>
            <StatLabel>{s.label}</StatLabel>
            <StatValue
              style={{ color: s.color ?? (dashboard ? '#fff' : C.muted) }}
            >
              {connected && loading && !dashboard ? (
                <SkeletonLine $w="70%" $h={24} />
              ) : (
                s.node
              )}
            </StatValue>
          </StatCard>
        ))}
      </StatGrid>

      <Col $gap={10}>
        <H2 style={{ fontSize: 18 }}>Commission tiers</H2>
        <ListBox>
          {levels.map(lv => {
            const [label, desc] = LEVEL_COPY[lv.level - 1] ?? [
              `Level ${lv.level}`,
              ''
            ]
            const earned = earnedAt(lv.level)
            return (
              <ListRow key={lv.level}>
                <LevelNum>{lv.level}</LevelNum>
                <Col $gap={2} style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
                  <Muted $size={12}>{desc}</Muted>
                </Col>
                <Rate className="num">{lv.ratePct}%</Rate>
                {connected && (
                  <Right $color={earned > 0 ? C.success : C.muted}>
                    {earned > 0 ? `$${fmtAmt(earned)}` : '—'}
                  </Right>
                )}
              </ListRow>
            )
          })}
        </ListBox>
      </Col>

      {connected && (
        <Col $gap={10}>
          <Row $justify="space-between" $gap={12} $wrap>
            <H2 style={{ fontSize: 18 }}>Referral network</H2>
            <Tabs<NetTab>
              ariaLabel="Referral data"
              value={netTab}
              onChange={setNetTab}
              items={[
                { value: 'network', label: 'Network' },
                { value: 'payouts', label: 'Payouts' }
              ]}
            />
          </Row>
          <TabPanel key={netTab}>
            {netTab === 'network' ? (
              <ListBox>
                {netRows.length === 0 ? (
                  <Empty>
                    No referrals yet. Share your link to start building your
                    network.
                  </Empty>
                ) : (
                  netRows.map((n, i) => (
                    <ListRow key={`${n.address}-${i}`}>
                      <Mono title={n.address}>{short(n.address, 6, 4)}</Mono>
                      <Muted>L{n.d}</Muted>
                      <Right $w={80} $color={C.secondary}>
                        {n.subReferrals} refs
                      </Right>
                      <Right
                        $w={80}
                        $color={n.totalFeeGenerated > 0 ? C.success : C.muted}
                        style={{ fontWeight: 600 }}
                      >
                        ${fmtAmt(n.totalFeeGenerated)}
                      </Right>
                    </ListRow>
                  ))
                )}
              </ListBox>
            ) : (
              <ListBox>
                {payouts.length === 0 ? (
                  <Empty>
                    Payouts are processed every 7 days automatically.
                    {dashboard && dashboard.totalUnpaid > 0
                      ? ` You have $${fmtAmt(dashboard.totalUnpaid)} pending.`
                      : ''}
                  </Empty>
                ) : (
                  payouts.map(p => (
                    <ListRow key={p.id}>
                      <span style={{ flex: 1, fontWeight: 600 }}>
                        {p.token}
                      </span>
                      <Muted>L{p.level}</Muted>
                      <Right $w={90} $color={C.muted}>
                        {new Date(p.paidAt).toLocaleDateString()}
                      </Right>
                      <Right $color={C.success} style={{ fontWeight: 600 }}>
                        ${fmtAmt(p.amount)}
                      </Right>
                    </ListRow>
                  ))
                )}
              </ListBox>
            )}
          </TabPanel>
        </Col>
      )}

      {connected && !referralCode && !loading && (
        <Empty>
          Unable to generate a referral code — the affiliate service is not
          reachable.
        </Empty>
      )}
    </Page>
  )
}

export default Affiliates
