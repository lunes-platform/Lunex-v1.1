import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import { AnimatedNumber } from '../../components/ui/AnimatedNumber'
import {
  Badge,
  Button,
  C,
  Card,
  Col,
  Empty,
  H1,
  Muted,
  Page,
  Row,
  SkeletonLine,
  Sub,
  TabPanel,
  Tabs,
  grotesk,
  short
} from '../../components/ui/kit'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../utils/signing'
import { requestWalletConnect } from 'pages/header/modals/wallets'
import { readSessionFetch } from '../../services/sessionService'
import { useReadSession } from '../../hooks/useReadSession'
import { SPOT_API_URL } from '../../config/api'
import {
  LUNES_DECIMALS,
  MIN_PROPOSAL_POWER_PLANCK,
  MIN_VOTES_FOR_APPROVAL,
  VOTE_COST_PLANCK,
  proposalIdsFor
} from '../../utils/staking'
import type { GovernanceProposal } from '../../utils/staking'

type Proposal = GovernanceProposal

type GovTab = 'active' | 'closed'
type Status = 'active' | 'approved' | 'rejected' | 'pending'

// Display mirrors of the staking contract rules (enforced on-chain).
const LUNES = 10 ** LUNES_DECIMALS
const VOTE_COST = Number(VOTE_COST_PLANCK) / LUNES // 10 LUNES per vote
const MIN_PROPOSAL_POWER = Number(MIN_PROPOSAL_POWER_PLANCK) / LUNES

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const fmt = (n: number, max = 2) =>
  n.toLocaleString('en-US', { maximumFractionDigits: max })

const fmtCompact = (n: number) =>
  n >= 1_000_000
    ? `${fmt(n / 1_000_000)}M`
    : n >= 1_000
      ? `${fmt(n / 1_000, 1)}K`
      : fmt(n, 0)

const statusOf = (p: Proposal): Status => {
  if (p.active && Date.now() < p.votingDeadline) return 'active'
  if (!p.executed) return 'pending'
  return p.votesYes >= MIN_VOTES_FOR_APPROVAL ? 'approved' : 'rejected'
}

const timeLeft = (deadline: number) => {
  const diff = deadline - Date.now()
  if (diff <= 0) return 'Voting ended'
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return d > 0
    ? `Ends in ${d}d ${h}h`
    : h > 0
      ? `Ends in ${h}h ${m}m`
      : `Ends in ${m}m`
}

const STATUS_UI: Record<Status, { color: string }> = {
  active: { color: C.warning },
  approved: { color: C.successText },
  rejected: { color: C.criticalText2 },
  pending: { color: C.muted }
}

// ─── Styles ──────────────────────────────────────────────────────

const PowerCard = styled(Card)`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px;
`

const PowerValue = styled.span`
  ${grotesk};
  font-size: 24px;
  font-weight: 600;
`

const ProposalCard = styled(Card)`
  padding: 18px;
`

const TypeTag = styled.span`
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgba(108, 56, 255, 0.16);
  color: ${C.primaryText2};
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
`

const PTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 18px;
`

const PBody = styled.p`
  font-size: 13px;
  line-height: 1.55;
  color: ${C.secondary};
  overflow-wrap: anywhere;
`

const VoteBar = styled.div`
  height: 8px;
  border-radius: 999px;
  background: ${C.criticalText};
  overflow: hidden;
  display: flex;
  > div {
    height: 100%;
    background: ${C.success};
    transition: width 500ms cubic-bezier(0, 0, 0.2, 1);
  }
`

const VoteBtn = styled.button<{ $yes: boolean }>`
  ${grotesk};
  flex: 1;
  height: 42px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 14px;
  border: 1px solid
    ${p => (p.$yes ? 'rgba(38,208,124,0.5)' : 'rgba(255,93,105,0.5)')};
  background: ${p => (p.$yes ? 'rgba(38,208,124,0.1)' : 'rgba(255,40,76,0.1)')};
  color: ${p => (p.$yes ? C.successText : C.criticalText2)};
  transition: background 150ms ease;
  &:hover:not(:disabled) {
    background: ${p =>
      p.$yes ? 'rgba(38,208,124,0.18)' : 'rgba(255,40,76,0.18)'};
  }
  &:disabled {
    opacity: 0.5;
  }
`

const Meta = styled.div`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: ${C.muted};
  span b {
    font-family: ui-monospace, monospace;
    font-weight: 500;
    color: ${C.secondary};
  }
`

// ─── Component ───────────────────────────────────────────────────

export const Governance: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const navigate = useNavigate()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk

  const [tab, setTab] = useState<GovTab>('active')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [power, setPower] = useState<number | null>(null)
  // Proposals this wallet already voted on (server history). The contract
  // allows ONE vote per proposal per wallet (AlreadyVoted).
  const [lastVotes, setLastVotes] = useState<Record<number, number>>({})
  const [myVotes, setMyVotes] = useState<Record<number, 'yes' | 'no'>>({})
  const [proposalFee, setProposalFee] = useState<number | null>(null)

  const address = sdk.walletAddress
  const connected = sdk.isConnected && !!address
  const { hasSession } = useReadSession()

  const signAction = useCallback(
    async (action: string, fields?: Record<string, string | number>) => {
      const s = sdkRef.current
      if (!s.walletAddress) throw new Error('Connect your wallet first')
      const meta = createSignedActionMetadata()
      const signature = await s.signMessage(
        buildWalletActionMessage({
          action,
          address: s.walletAddress,
          nonce: meta.nonce,
          timestamp: meta.timestamp,
          fields
        })
      )
      return { ...meta, signature }
    },
    []
  )

  // Proposals are public on-chain reads.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const s = sdkRef.current
        const [stats, fee] = await Promise.all([
          s.getListingStats(),
          s.getProposalFee()
        ])
        if (alive) setProposalFee(Number(fee) / LUNES)
        // Proposal ids start at 1 (next_proposal_id = 1 in the contract).
        const ids = proposalIdsFor(stats?.totalProposals ?? 0)
        const loaded = await Promise.all(ids.map(id => s.getProposal(id)))
        if (alive)
          setProposals(loaded.filter((p): p is Proposal => !!p).reverse())
      } catch (err) {
        console.error('Error loading proposals:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Voting power + server-side vote history (cooldown).
  useEffect(() => {
    if (!connected || !address) {
      setPower(null)
      setLastVotes({})
      return
    }
    let alive = true
    ;(async () => {
      const s = sdkRef.current
      try {
        const vp = await s.getVotingPower(address)
        let n = Number(vp) / 1e8
        if (!n) {
          const info = await s.getStakingUserInfo(address)
          n = info ? Number(info.userStaked) / 1e8 : 0
        }
        if (alive) setPower(Number.isFinite(n) ? n : 0)
      } catch {
        if (alive) setPower(0)
      }
      try {
        // Private read via the read session — never prompts the wallet.
        // Without a session the cooldown display is skipped (the server
        // still enforces it when recording a vote).
        if (!hasSession) return
        const { votes } = await readSessionFetch<{
          votes?: Array<{ proposalId: number; votedAt: string }>
        }>(
          address,
          `/api/v1/governance/vote/history?walletAddress=${encodeURIComponent(
            address
          )}`
        )
        if (alive) {
          const rec: Record<number, number> = {}
          for (const v of votes || []) {
            const ts = new Date(v.votedAt).getTime()
            if (!rec[v.proposalId] || ts > rec[v.proposalId])
              rec[v.proposalId] = ts
          }
          setLastVotes(rec)
        }
      } catch {
        // Server unavailable — cooldown is still enforced when recording.
      }
    })()
    return () => {
      alive = false
    }
  }, [connected, address, hasSession])

  const hasStake = (power ?? 0) > 0
  const canPropose = (power ?? 0) >= MIN_PROPOSAL_POWER

  const vote = (p: Proposal, choice: 'yes' | 'no') => {
    if (!connected) {
      requestWalletConnect()
      return
    }
    const approve = choice === 'yes'
    tx.run({
      type: 'governance',
      title: 'Submitting vote',
      summary: `${approve ? 'Yes' : 'No'} · ${p.name} · costs ${VOTE_COST} LUNES`,
      actTitle: `Vote ${choice} on “${p.name}”`,
      successTitle: 'Vote recorded',
      errorText: 'The vote did not complete.',
      steps: [
        {
          label: 'Sign vote in your wallet',
          wallet: true,
          run: () => sdkRef.current.voteOnProposal(p.id, approve)
        },
        { label: 'Waiting for finalization' }
      ],
      onSuccess: () => {
        const now = Date.now()
        setLastVotes(prev => ({ ...prev, [p.id]: now }))
        setMyVotes(prev => ({ ...prev, [p.id]: choice }))
        ;(async () => {
          const s = sdkRef.current
          const updated = await s.getProposal(p.id)
          if (updated)
            setProposals(prev => prev.map(x => (x.id === p.id ? updated : x)))
          // Mirror the finalized vote in spot-api (UX history only — the
          // contract is the source of truth). Signed wallet action
          // `governance.vote.record` (spot-api/src/routes/governance.ts).
          try {
            const voteType = approve ? 'YES' : 'NO'
            const auth = await signAction('governance.vote.record', {
              proposalId: p.id,
              voteType
            })
            const res = await fetch(
              `${SPOT_API_URL}/api/v1/governance/vote/record`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  walletAddress: s.walletAddress,
                  proposalId: p.id,
                  voteType,
                  ...auth
                })
              }
            )
            if (!res.ok)
              console.warn('governance vote/record failed:', res.status)
          } catch (err) {
            console.warn('governance vote/record unavailable:', err)
          }
        })()
      }
    })
  }

  const list = proposals.filter(p =>
    tab === 'active' ? statusOf(p) === 'active' : statusOf(p) !== 'active'
  )
  const activeCount = proposals.filter(p => statusOf(p) === 'active').length

  return (
    <Page $max={900}>
      <div>
        <H1>Governance</H1>
        <Sub>
          Vote on new token listings. You need an active LUNES stake to vote;
          each vote costs {VOTE_COST} LUNES (one vote per proposal). Proposing
          costs {proposalFee === null ? '…' : fmt(proposalFee)} LUNES and
          needs {fmt(MIN_PROPOSAL_POWER)} LUNES staked.
        </Sub>
      </div>

      <PowerCard>
        <Col $gap={2}>
          <Muted $size={12}>Your voting power</Muted>
          <PowerValue>
            {!connected ? (
              'Connect wallet'
            ) : power === null ? (
              <SkeletonLine $w="120px" $h={26} />
            ) : (
              <AnimatedNumber value={power} format={v => `${fmt(v)} LUNES`} />
            )}
          </PowerValue>
        </Col>
        <Row $gap={8} $wrap>
          {connected ? (
            <Button variant="secondary" onClick={() => navigate('/staking')}>
              Stake to increase
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => requestWalletConnect()}>
              Connect wallet
            </Button>
          )}
          <Button
            onClick={() => navigate('/listing')}
            title={
              connected && !canPropose
                ? `Requires ${fmt(MIN_PROPOSAL_POWER)} LUNES staked`
                : undefined
            }
          >
            Propose a listing
          </Button>
        </Row>
      </PowerCard>

      <Tabs<GovTab>
        ariaLabel="Proposals"
        value={tab}
        onChange={setTab}
        items={[
          {
            value: 'active',
            label: `Active${activeCount ? ` (${activeCount})` : ''}`
          },
          { value: 'closed', label: 'Closed' }
        ]}
      />

      <TabPanel key={tab}>
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <ProposalCard key={i}>
              <SkeletonLine $w="80px" />
              <SkeletonLine $w="60%" $h={20} />
              <SkeletonLine />
              <SkeletonLine $h={8} />
            </ProposalCard>
          ))
        ) : list.length === 0 ? (
          <Card>
            <Empty>
              <h3>
                {tab === 'active' ? 'No open proposals' : 'No closed proposals'}
              </h3>
              {tab === 'active'
                ? 'Want your token on Lunex? Submit a listing for a community vote.'
                : 'Finished votes will show up here.'}
              {tab === 'active' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/listing')}
                >
                  Propose a listing
                </Button>
              )}
            </Empty>
          </Card>
        ) : (
          list.map(p => {
            const st = statusOf(p)
            const total = p.votesYes + p.votesNo
            const yes = total ? Math.round((p.votesYes / total) * 100) : 50
            const voted = !!lastVotes[p.id] || !!myVotes[p.id]
            const mine = myVotes[p.id]
            const statusLabel =
              st === 'active'
                ? timeLeft(p.votingDeadline)
                : st === 'approved'
                  ? 'Passed'
                  : st === 'rejected'
                    ? 'Rejected'
                    : Date.now() < p.executionTime
                      ? `Executable ${fmtDate(p.executionTime)}`
                      : 'Awaiting execution'
            return (
              <ProposalCard key={p.id}>
                <Row $justify="space-between" $gap={8} $wrap>
                  <TypeTag>{p.isFeeChange ? 'Fee change' : 'Listing'}</TypeTag>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: STATUS_UI[st].color
                    }}
                  >
                    {statusLabel}
                  </span>
                </Row>
                <Col $gap={6}>
                  <PTitle>{p.name}</PTitle>
                  {p.description && <PBody>{p.description}</PBody>}
                  <Meta>
                    <span>
                      Token <b>{short(p.tokenAddress, 6, 4)}</b>
                    </span>
                    <span>
                      Proposer <b>{short(p.proposer, 6, 4)}</b>
                    </span>
                    <span>
                      Voting ends <b>{fmtDate(p.votingDeadline)}</b>
                    </span>
                  </Meta>
                </Col>
                <Col $gap={6}>
                  <VoteBar
                    role="img"
                    aria-label={`Yes ${yes}%, No ${100 - yes}%`}
                  >
                    <div style={{ width: `${yes}%` }} />
                  </VoteBar>
                  <Row $justify="space-between" style={{ fontSize: 12 }}>
                    <span style={{ color: C.successText, fontWeight: 600 }}>
                      Yes {yes}%
                    </span>
                    <span style={{ color: C.muted }} className="num">
                      {fmtCompact(p.votesYes)}/{fmtCompact(MIN_VOTES_FOR_APPROVAL)}{' '}
                      yes · {fmtCompact(total)} votes
                    </span>
                    <span style={{ color: C.criticalText2, fontWeight: 600 }}>
                      No {100 - yes}%
                    </span>
                  </Row>
                </Col>
                {st === 'active' &&
                  (voted ? (
                    <Row $gap={8} $wrap style={{ fontSize: 13 }}>
                      <Badge $tone="neutral">
                        {mine ? `You voted ${mine}` : 'You already voted'}
                      </Badge>
                    </Row>
                  ) : connected && power !== null && !hasStake ? (
                    <Row $gap={8} $wrap style={{ fontSize: 13 }}>
                      <span style={{ color: C.muted }}>
                        Voting requires an active stake.
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate('/staking')}
                      >
                        Stake LUNES
                      </Button>
                    </Row>
                  ) : (
                    <Col $gap={6}>
                      <Row $gap={8}>
                        <VoteBtn $yes onClick={() => vote(p, 'yes')}>
                          Vote yes
                        </VoteBtn>
                        <VoteBtn $yes={false} onClick={() => vote(p, 'no')}>
                          Vote no
                        </VoteBtn>
                      </Row>
                      <Muted $size={12}>
                        Each vote costs {VOTE_COST} LUNES · one vote per
                        proposal
                      </Muted>
                    </Col>
                  ))}
              </ProposalCard>
            )
          })
        )}
      </TabPanel>
    </Page>
  )
}

export default Governance
