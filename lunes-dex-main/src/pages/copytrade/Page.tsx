import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Copy, RefreshCw } from 'lucide-react'
import {
  Button,
  C,
  Card,
  H1,
  Notice,
  Page,
  Panel,
  PillChip,
  SkeletonLine,
  Spinner,
  Sub,
  grotesk,
  tabular
} from 'components/ui/kit'
import { Dialog } from 'components/ui/Dialog'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { useSDK } from '../../context/SDKContext'
import { useToast } from '../../components/feedback/ToastProvider'
import socialApi, {
  CopytradeActivityItem,
  CopytradeExecution,
  CopytradePosition
} from '../../services/socialService'
import { Trader } from '../social/types'
import {
  aumLabel,
  BackToSocial,
  DashedEmpty,
  fmtCount,
  fmtPct,
  fmtUsd,
  ListBox,
  ListRow,
  MiniStat,
  relTime,
  roiColor,
  SectionTitle,
  SideLabel,
  TraderAvatar,
  traderVaultToken
} from '../social/shared'
import CopyModal from './CopyModal'
import { useCopyPositions, useCopyWithdraw } from './useCopytrade'
import { ReadSessionPrompt } from '../../components/session/ReadSessionPrompt'
import { useReadSession } from '../../hooks/useReadSession'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const VaultRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  padding: 14px 16px;
  background: ${p => (p.$selected ? 'rgba(108,56,255,0.06)' : 'transparent')};
  transition: background-color 150ms ease;
`

const VaultWho = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 200px;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  text-align: left;
  > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  b {
    ${grotesk};
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  span {
    font-size: 12px;
    color: ${C.muted};
  }
  &:hover b {
    color: ${C.primaryText2};
  }
`

const VaultStats = styled.div`
  display: flex;
  gap: 18px;
  flex: 1 1 260px;
  @media (max-width: 759px) {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    flex-basis: 100%;
  }
`

const Columns = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
`

const Col = styled.div<{ $grow: number; $basis: number }>`
  flex: ${p => p.$grow} 1 ${p => p.$basis}px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
`

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`

const PosCard = styled(Card)`
  padding: 14px 16px;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  font-size: 12px;
  color: ${C.muted};
  ${tabular};
  b {
    color: #fff;
    font-weight: 600;
  }
`

const FeedItem = styled.div`
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.45;
`

const Dot = styled.span<{ $c: string }>`
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${p => p.$c};
`

const KeyBox = styled.pre`
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: ${C.terminal};
  border: 1px solid ${C.border};
  color: ${C.primaryText2};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
`

const Select = styled.select`
  height: 32px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  background: ${C.bg};
  color: #fff;
  font-size: 13px;
  max-width: 220px;
`

const SharesInput = styled.input.attrs({ 'data-bare': '' })`
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  ${grotesk};
  ${tabular};
  font-size: 26px;
  font-weight: 500;
  width: 100%;
  min-width: 0;
`

const activityLine = (a: CopytradeActivityItem) => {
  const tok = a.token ?? ''
  if (a.type === 'DEPOSIT')
    return {
      color: C.success,
      what: `received a deposit${a.amount ? ` of ${a.amount.toLocaleString()} ${tok}` : ''}`
    }
  if (a.type === 'WITHDRAWAL')
    return {
      color: C.warning,
      what: `processed a withdrawal${
        a.netAmount ? ` · net ${a.netAmount.toLocaleString()} ${tok}` : ''
      }`
    }
  return {
    color: C.primaryText,
    what: `${a.side === 'SELL' ? 'sold' : a.side === 'BUY' ? 'bought' : 'signalled'} ${
      a.pairSymbol ?? ''
    }${a.slices ? ` in ${a.slices} slices` : ''}`
  }
}

const CopytradePage: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress, signMessage } = useSDK()
  const { toast } = useToast()
  const [leaders, setLeaders] = useState<Trader[]>([])
  const [loadingLeaders, setLoadingLeaders] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [executions, setExecutions] = useState<CopytradeExecution[]>([])
  const [execLoading, setExecLoading] = useState(false)
  const [copyTarget, setCopyTarget] = useState<Trader | null>(null)
  const [withdrawPos, setWithdrawPos] = useState<CopytradePosition | null>(null)
  const [shares, setShares] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyLoading, setKeyLoading] = useState(false)
  const [noLeader, setNoLeader] = useState(false)
  const copy = useCopyPositions()
  const { hasSession } = useReadSession()
  const withdraw = useCopyWithdraw()

  const refreshLeaders = async () => {
    try {
      const next = await socialApi.getLeaders({ limit: 20, sortBy: 'roi30d' })
      setLeaders(next)
      setLoadError('')
      setSelectedId(cur => cur || next[0]?.id || '')
    } catch (err: unknown) {
      setLoadError(
        err instanceof Error
          ? `${err.message}. Could not load vaults.`
          : 'Copytrade API unavailable.'
      )
    } finally {
      setLoadingLeaders(false)
    }
  }

  useEffect(() => {
    void refreshLeaders()
  }, [])

  // Follower dashboard: private reads via the read session (no wallet
  // prompt); re-runs when the wallet or the session changes.
  useEffect(() => {
    copy.reset()
    setApiKey('')
    setNoLeader(false)
    if (walletAddress) void copy.load(walletAddress, { withActivity: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, hasSession])

  const loadExecutions = async (leaderId: string) => {
    setExecLoading(true)
    try {
      setExecutions(await socialApi.getVaultExecutions(leaderId, 20))
    } catch {
      setExecutions([])
    } finally {
      setExecLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setExecutions([])
      return
    }
    void loadExecutions(selectedId)
  }, [selectedId])

  const positionByLeader = useMemo(() => {
    const m = new Map<string, CopytradePosition>()
    copy.positions.forEach(p => {
      if (p.shareBalance > 0) m.set(p.vault.leaderId, p)
    })
    return m
  }, [copy.positions])

  const activePositions = copy.positions.filter(p => p.shareBalance > 0)
  const selected = leaders.find(l => l.id === selectedId) ?? null
  const myLeader = walletAddress
    ? (leaders.find(l => l.address === walletAddress) ?? null)
    : null

  const afterTx = () => {
    if (walletAddress) void copy.load(walletAddress, { withActivity: true })
    void refreshLeaders()
    if (selectedId) void loadExecutions(selectedId)
  }

  const connect = () =>
    requestWalletConnect().catch((err: unknown) =>
      toast(
        'error',
        'Wallet not connected',
        err instanceof Error ? err.message : undefined
      )
    )

  const onDeposit = (t: Trader) => {
    if (!walletAddress) {
      void connect()
      return
    }
    if (positionByLeader.has(t.id)) {
      toast(
        'info',
        'Already deposited',
        'Manage it in the follower dashboard below.'
      )
      return
    }
    setCopyTarget(t)
  }

  const openWithdraw = (p: CopytradePosition) => {
    setShares(String(p.shareBalance))
    setWithdrawPos(p)
  }

  const confirmWithdraw = () => {
    if (!withdrawPos) return
    const p = withdrawPos
    setWithdrawPos(null)
    withdraw(p, shares, afterTx)
  }

  const generateKey = async () => {
    if (!walletAddress) {
      void connect()
      return
    }
    setKeyLoading(true)
    try {
      const leader =
        myLeader ??
        (await socialApi
          .getLeaderProfileByAddress(walletAddress)
          .catch(() => null))
      if (!leader || leader.address !== walletAddress) {
        setNoLeader(true)
        return
      }
      const challenge = await socialApi.getApiKeyChallenge(leader.id, {
        leaderAddress: walletAddress
      })
      const signature = await signMessage(challenge.message)
      const res = await socialApi.rotateLeaderApiKey(leader.id, {
        leaderAddress: walletAddress,
        challengeId: challenge.challengeId,
        signature
      })
      setApiKey(res.apiKey)
      toast(
        'success',
        apiKey ? 'Leader key rotated' : 'Leader key created',
        'Copy it now — it will not be shown again.'
      )
    } catch (err: unknown) {
      toast(
        'error',
        'Could not generate the key',
        err instanceof Error ? err.message : undefined
      )
    } finally {
      setKeyLoading(false)
    }
  }

  const sharesNum = Number(shares)
  const sharesOk =
    !!withdrawPos &&
    sharesNum > 0 &&
    sharesNum <= withdrawPos.shareBalance + 1e-12
  const estValue =
    withdrawPos && withdrawPos.shareBalance > 0
      ? (withdrawPos.currentValue *
          Math.min(sharesNum || 0, withdrawPos.shareBalance)) /
        withdrawPos.shareBalance
      : 0

  const renderDashboard = () => {
    if (!walletAddress)
      return (
        <DashedEmpty>
          Connect your wallet to see your deposits.
          <div style={{ marginTop: 12 }}>
            <Button size="sm" onClick={() => void connect()}>
              Connect wallet
            </Button>
          </div>
        </DashedEmpty>
      )
    if (copy.needsSignIn)
      return (
        <DashedEmpty>
          <ReadSessionPrompt
            compact
            message="Sign in to see your vault deposits"
          />
        </DashedEmpty>
      )
    if (copy.loading && copy.loadedFor !== walletAddress)
      return (
        <>
          <SkeletonLine $h={64} style={{ borderRadius: 16 }} />
          <SkeletonLine $h={64} style={{ borderRadius: 16 }} />
        </>
      )
    if (copy.error && copy.loadedFor !== walletAddress)
      return (
        <DashedEmpty>
          {copy.error}
          <div style={{ marginTop: 12 }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void copy.load(walletAddress, { withActivity: true })
              }
            >
              Try again
            </Button>
          </div>
        </DashedEmpty>
      )
    if (activePositions.length === 0)
      return <DashedEmpty>You have no vault deposits yet.</DashedEmpty>
    return activePositions.map(p => {
      const pnl = p.currentValue - p.netDeposited
      return (
        <PosCard key={p.id}>
          <span
            style={{
              fontFamily: 'Space Grotesk',
              fontWeight: 600,
              fontSize: 14,
              color: '#fff',
              flex: '1 1 140px',
              minWidth: 0
            }}
          >
            {p.vault.leaderName || p.vault.name} Vault
          </span>
          <span>
            Deposited <b>{fmtUsd(p.netDeposited)}</b>
          </span>
          <span>
            Value{' '}
            <b>
              <AnimatedNumber text={fmtUsd(p.currentValue)} />
            </b>
          </span>
          <span style={{ fontWeight: 600, color: roiColor(pnl) }}>
            {pnl >= 0 ? '+' : '−'}
            {fmtUsd(Math.abs(pnl))}
          </span>
          <Button size="sm" variant="secondary" onClick={() => openWithdraw(p)}>
            Withdraw
          </Button>
        </PosCard>
      )
    })
  }

  return (
    <Page $max={1080} style={{ gap: 16 }}>
      <BackToSocial />
      <div>
        <H1>Copytrade vaults</H1>
        <Sub style={{ fontSize: 15 }}>
          Deposit into a leader’s on-chain vault. Trades are mirrored
          proportionally and you can withdraw at any time.
        </Sub>
      </div>

      {loadError && <Notice $tone="warning">{loadError}</Notice>}

      <SectionTitle>Vault marketplace</SectionTitle>
      {loadingLeaders ? (
        <ListBox aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <VaultRow key={i}>
              <SkeletonLine $w="36px" $h={36} style={{ borderRadius: '50%' }} />
              <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                <SkeletonLine $w="35%" />
                <SkeletonLine $w="25%" $h={10} />
              </div>
            </VaultRow>
          ))}
        </ListBox>
      ) : leaders.length === 0 ? (
        <DashedEmpty>No vaults listed yet.</DashedEmpty>
      ) : (
        <ListBox>
          {leaders.map(l => {
            const on = positionByLeader.has(l.id)
            const token = traderVaultToken(l)
            const min = l.vault?.minDeposit ?? 0
            return (
              <VaultRow key={l.id} $selected={l.id === selectedId}>
                <VaultWho
                  type="button"
                  onClick={() =>
                    navigate(`/social/profile/${l.id}`, {
                      state: { trader: l }
                    })
                  }
                >
                  <TraderAvatar
                    name={l.name}
                    avatar={l.avatar}
                    ai={l.isAI}
                    size={36}
                  />
                  <div>
                    <b>{l.name} Vault</b>
                    <span>
                      {l.isAI ? 'AI agent' : 'Human trader'} ·{' '}
                      {fmtCount(l.followers)} followers
                    </span>
                  </div>
                </VaultWho>
                <VaultStats>
                  <MiniStat>
                    <span>ROI 30d</span>
                    <span style={{ color: roiColor(l.roi30d) }}>
                      {fmtPct(l.roi30d)}
                    </span>
                  </MiniStat>
                  <MiniStat>
                    <span>AUM</span>
                    <span>{aumLabel(l.aum)}</span>
                  </MiniStat>
                  <MiniStat>
                    <span>Perf. fee</span>
                    <span>{l.fee}%</span>
                  </MiniStat>
                  <MiniStat>
                    <span>Min.</span>
                    <span>
                      {min > 0 ? `${min.toLocaleString()} ${token}` : '—'}
                    </span>
                  </MiniStat>
                </VaultStats>
                <Button
                  size="sm"
                  variant={on ? 'secondary' : 'primary'}
                  style={{ height: 38, padding: '0 16px' }}
                  onClick={() => onDeposit(l)}
                >
                  {on ? 'Deposited' : 'Deposit'}
                </Button>
              </VaultRow>
            )
          })}
        </ListBox>
      )}

      <Columns>
        <Col $grow={1.3} $basis={360}>
          <SectionHead>
            <SectionTitle>Follower dashboard</SectionTitle>
            {walletAddress && copy.loadedFor === walletAddress && (
              <Button
                size="sm"
                variant="ghost"
                disabled={copy.loading}
                onClick={() =>
                  void copy.load(walletAddress, { withActivity: true })
                }
              >
                {copy.loading ? (
                  <Spinner $size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
                Refresh
              </Button>
            )}
          </SectionHead>
          {renderDashboard()}

          <SectionHead style={{ paddingTop: 8 }}>
            <SectionTitle>Execution history</SectionTitle>
            {leaders.length > 0 && (
              <Select
                aria-label="Vault"
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              >
                {leaders.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} Vault
                  </option>
                ))}
              </Select>
            )}
          </SectionHead>
          {execLoading ? (
            <SkeletonLine $h={120} style={{ borderRadius: 16 }} />
          ) : executions.length === 0 ? (
            <DashedEmpty>
              {selected
                ? `No executions for ${selected.name} Vault yet.`
                : 'Pick a vault to see its executions.'}
            </DashedEmpty>
          ) : (
            <ListBox>
              {executions.map(ex => (
                <ListRow key={ex.id}>
                  <SideLabel $buy={ex.side === 'BUY'}>
                    {ex.side === 'BUY' ? 'Buy' : 'Sell'}
                  </SideLabel>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {ex.pairSymbol} · {ex.amountIn.toLocaleString()} @{' '}
                    {ex.executionPrice.toLocaleString()}
                    {ex.totalSlices > 1
                      ? ` · slice ${ex.sliceIndex}/${ex.totalSlices}`
                      : ''}
                  </span>
                  <span style={{ color: C.muted, whiteSpace: 'nowrap' }}>
                    {relTime(ex.createdAt)}
                  </span>
                </ListRow>
              ))}
            </ListBox>
          )}
        </Col>

        <Col $grow={1} $basis={280}>
          <SectionTitle>Activity feed</SectionTitle>
          <Card $pad={16} style={{ gap: 10 }}>
            {!walletAddress ? (
              <span style={{ fontSize: 13, color: C.muted }}>
                Connect your wallet to see activity on your vaults.
              </span>
            ) : copy.needsSignIn ? (
              <span style={{ fontSize: 13, color: C.muted }}>
                Sign in to see activity on your vaults.
              </span>
            ) : copy.loading && copy.loadedFor !== walletAddress ? (
              <>
                <SkeletonLine />
                <SkeletonLine $w="80%" />
                <SkeletonLine $w="60%" />
              </>
            ) : copy.activity.length === 0 ? (
              <span style={{ fontSize: 13, color: C.muted }}>
                No recent activity.
              </span>
            ) : (
              copy.activity.map((a, i) => {
                const line = activityLine(a)
                return (
                  <FeedItem key={`${a.type}-${a.createdAt}-${i}`}>
                    <Dot $c={line.color} />
                    <span style={{ flex: 1 }}>
                      <b style={{ fontWeight: 600 }}>{a.leaderName}</b>{' '}
                      <span style={{ color: C.secondary }}>{line.what}</span>
                      <br />
                      <span style={{ fontSize: 11, color: C.muted }}>
                        {relTime(a.createdAt)}
                      </span>
                    </span>
                  </FeedItem>
                )
              })
            )}
          </Card>

          <SectionTitle style={{ paddingTop: 8 }}>
            Leader / agent API key
          </SectionTitle>
          <Card $pad={16} style={{ gap: 10 }}>
            <span style={{ fontSize: 13, color: C.secondary, lineHeight: 1.5 }}>
              Leaders sign trade signals with a restricted key. Followers’
              vaults execute them automatically.
            </span>
            {walletAddress && noLeader && (
              <Notice $tone="neutral">
                This wallet has no leader profile yet. Create one to get a key.
              </Notice>
            )}
            {apiKey && (
              <>
                <KeyBox>{`X-API-Key: ${apiKey}\npermissions: COPYTRADE_SIGNAL`}</KeyBox>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(apiKey)
                      .then(() => toast('success', 'API key copied'))
                      .catch(() => toast('error', 'Could not copy the key'))
                  }
                >
                  <Copy size={14} /> Copy key
                </Button>
              </>
            )}
            <Button
              disabled={keyLoading}
              style={{ height: 42 }}
              onClick={() =>
                walletAddress && noLeader
                  ? navigate('/social/settings')
                  : void generateKey()
              }
            >
              {keyLoading ? (
                <>
                  <Spinner $size={14} /> Sign in your wallet…
                </>
              ) : !walletAddress ? (
                'Connect wallet'
              ) : noLeader ? (
                'Create trader profile'
              ) : apiKey ? (
                'Rotate key'
              ) : (
                'Generate leader key'
              )}
            </Button>
          </Card>
        </Col>
      </Columns>

      <CopyModal
        trader={copyTarget}
        onClose={() => setCopyTarget(null)}
        onSuccess={afterTx}
      />

      <Dialog
        open={!!withdrawPos}
        onClose={() => setWithdrawPos(null)}
        width={420}
        title={
          withdrawPos
            ? `Withdraw from ${withdrawPos.vault.leaderName || withdrawPos.vault.name} Vault`
            : 'Withdraw'
        }
        description="Shares are redeemed at the current vault value. The leader fee applies only to profit above the high-water mark."
      >
        {withdrawPos && (
          <>
            <Panel>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: C.muted
                }}
              >
                <span>Shares</span>
                <span className="num">
                  Balance {withdrawPos.shareBalance.toFixed(4)}
                </span>
              </div>
              <SharesInput
                value={shares}
                onChange={e => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(v)) setShares(v)
                }}
                inputMode="decimal"
                aria-label="Shares to withdraw"
                placeholder="0"
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[25, 50, 75, 100].map(pct => (
                  <PillChip
                    key={pct}
                    $active={
                      Math.abs(
                        sharesNum - (withdrawPos.shareBalance * pct) / 100
                      ) < 1e-9
                    }
                    onClick={() =>
                      setShares(
                        pct === 100
                          ? String(withdrawPos.shareBalance)
                          : String(
                              +((withdrawPos.shareBalance * pct) / 100).toFixed(
                                6
                              )
                            )
                      )
                    }
                  >
                    {pct === 100 ? 'Max' : `${pct}%`}
                  </PillChip>
                ))}
              </div>
            </Panel>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13
              }}
            >
              <span style={{ color: C.muted }}>Estimated value</span>
              <span className="num" style={{ fontWeight: 600 }}>
                ≈ {fmtUsd(estValue)}
              </span>
            </div>
            <Button
              size="xl"
              block
              disabled={!sharesOk}
              onClick={confirmWithdraw}
            >
              {!sharesNum
                ? 'Enter shares'
                : !sharesOk
                  ? 'Exceeds your shares'
                  : `Withdraw ≈ ${fmtUsd(estValue)}`}
            </Button>
          </>
        )}
      </Dialog>
    </Page>
  )
}

export default CopytradePage
