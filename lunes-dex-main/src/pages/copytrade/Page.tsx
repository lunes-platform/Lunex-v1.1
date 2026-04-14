import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import CopyModal from './CopyModal'
import { useSDK } from '../../context/SDKContext'
import socialApi, {
  buildWalletActionMessage,
  buildCopytradeWithdrawMessage,
  CopytradeActivityItem,
  CopytradeExecution,
  CopytradePosition,
  createSignedActionMetadata,
  SocialStats
} from '../../services/socialService'
import { Trader } from '../social/types'

const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 84px 24px 48px;
`

const Container = styled.div`
  max-width: 1280px;
  margin: 0 auto;
`

const Hero = styled.div`
  margin-bottom: 28px;
`

const Title = styled.h1`
  margin: 0 0 8px 0;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 40px;
  font-weight: 700;
`

const Subtitle = styled.p`
  margin: 0;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  line-height: 1.6;
`

const Banner = styled.div<{ tone?: 'error' | 'success' }>`
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid
    ${({ tone }) =>
      tone === 'success' ? 'rgba(38,208,124,0.25)' : 'rgba(254,146,63,0.2)'};
  background: ${({ tone }) =>
    tone === 'success' ? 'rgba(38,208,124,0.1)' : 'rgba(254,146,63,0.12)'};
  color: ${({ tone }) => (tone === 'success' ? '#26D07C' : '#FE923F')};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin: 24px 0 28px;
`

const Card = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 18px;
  padding: 20px;
`

const StatValue = styled.div`
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
`

const StatLabel = styled.div`
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
`

const Section = styled.div`
  margin-bottom: 24px;
`

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
`

const SectionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
`

const Actions = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`

const Button = styled.button<{ secondary?: boolean }>`
  border: 1px solid ${({ secondary }) => (secondary ? '#2A2A2C' : '#6C38FF')};
  background: ${({ secondary }) => (secondary ? '#232323' : '#6C38FF')};
  color: #ffffff;
  border-radius: 10px;
  padding: 10px 14px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  opacity: ${({ disabled }) => (disabled ? 0.6 : 1)};
`

const LeaderGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
`

const LeaderName = styled.div`
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
`

const Meta = styled.div`
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  margin: 6px 0 12px;
`

const Tags = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
`

const Tag = styled.span`
  background: #2a2a2c;
  color: #ad87ff;
  border-radius: 999px;
  padding: 4px 10px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 700;
`

const Metrics = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
`

const Metric = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const MetricValue = styled.span<{ positive?: boolean }>`
  color: ${({ positive }) =>
    positive === undefined ? '#FFFFFF' : positive ? '#26D07C' : '#FF284C'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
`

const MetricLabel = styled.span`
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
`

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 20px;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`

const Stack = styled.div`
  display: grid;
  gap: 20px;
`

const PositionGrid = styled.div`
  display: grid;
  gap: 14px;
`

const InputRow = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 12px;
`

const Input = styled.input`
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  border-radius: 10px;
  padding: 12px 14px;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
`

const FeedList = styled.div`
  display: grid;
  gap: 12px;
`

const FeedItem = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
`

const FeedTitle = styled.div`
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
`

const FeedMeta = styled.div`
  margin-top: 6px;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  line-height: 1.6;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`

const Th = styled.th`
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  text-align: left;
  padding-bottom: 10px;
  border-bottom: 1px solid #2a2a2c;
`

const Td = styled.td`
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
`

const CodeBox = styled.pre`
  margin: 12px 0 0;
  background: #111111;
  border: 1px solid #2a2a2c;
  border-radius: 12px;
  padding: 14px;
  color: #26d07c;
  font-family: monospace;
  font-size: 12px;
  overflow: auto;
`

const EmptyState = styled.div`
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
`

const getEmptyStats = (): SocialStats => ({
  totalAum: 0,
  activeTraders: 0,
  aiAgents: 0,
  totalFollowers: 0,
  totalIdeas: 0,
  totalVaultEquity: 0
})

const formatMoney = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const formatDateTime = (value: string) => new Date(value).toLocaleString()

const renderActivityTitle = (item: CopytradeActivityItem) => {
  if (item.type === 'DEPOSIT') return `${item.leaderName} received a deposit`
  if (item.type === 'WITHDRAWAL')
    return `${item.leaderName} processed a withdrawal`
  return `${item.leaderName} executed ${item.side ?? 'SIGNAL'} ${
    item.pairSymbol ?? 'trade'
  }`
}

const CopytradePage: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress, connectWallet, signMessage } = useSDK()
  const [leaders, setLeaders] = useState<Trader[]>([])
  const [stats, setStats] = useState<SocialStats>(getEmptyStats())
  const [positions, setPositions] = useState<CopytradePosition[]>([])
  const [activity, setActivity] = useState<CopytradeActivityItem[]>([])
  const [executions, setExecutions] = useState<CopytradeExecution[]>([])
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>('')
  const [copyTarget, setCopyTarget] = useState<Trader | null>(null)
  const [withdrawInputs, setWithdrawInputs] = useState<Record<string, string>>(
    {}
  )
  const [statusMessage, setStatusMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [, setIsLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [leaderApiKey, setLeaderApiKey] = useState('')

  const selectedLeader = useMemo(
    () =>
      leaders.find(leader => leader.id === selectedLeaderId) ??
      leaders[0] ??
      null,
    [leaders, selectedLeaderId]
  )

  const refreshOverview = async () => {
    try {
      const [nextStats, nextLeaders] = await Promise.all([
        socialApi.getStats(),
        socialApi.getLeaders({ limit: 20, sortBy: 'roi30d' })
      ])
      setStats(nextStats)
      setLeaders(nextLeaders)
      if (!selectedLeaderId && nextLeaders[0])
        setSelectedLeaderId(nextLeaders[0].id)
    } catch (err) {
      setStatusMessage(
        err instanceof Error
          ? `${err.message}. Could not load leaders.`
          : 'Copytrade API unavailable.'
      )
    }
  }

  const refreshFollowerDashboard = async (address: string) => {
    setDashboardLoading(true)
    try {
      const signedPositions = createSignedActionMetadata()
      const positionsSignature = await signMessage(
        buildWalletActionMessage({
          action: 'copytrade.positions',
          address,
          nonce: signedPositions.nonce,
          timestamp: signedPositions.timestamp
        })
      )
      const positionsAuth = {
        address,
        nonce: signedPositions.nonce,
        timestamp: signedPositions.timestamp,
        signature: positionsSignature
      }

      const signedActivity = createSignedActionMetadata()
      const activitySignature = await signMessage(
        buildWalletActionMessage({
          action: 'copytrade.activity',
          address,
          nonce: signedActivity.nonce,
          timestamp: signedActivity.timestamp,
          fields: { limit: 20 }
        })
      )
      const activityAuth = {
        address,
        nonce: signedActivity.nonce,
        timestamp: signedActivity.timestamp,
        signature: activitySignature
      }

      const [nextPositions, nextActivity] = await Promise.all([
        socialApi.getPositions(address, positionsAuth),
        socialApi.getActivity(address, activityAuth, 20)
      ])
      setPositions(nextPositions)
      setActivity(nextActivity)
    } catch (err) {
      setPositions([])
      setActivity([])
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to load follower dashboard'
      )
    } finally {
      setDashboardLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      setIsLoading(true)
      await refreshOverview()
      setIsLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!walletAddress) {
      setPositions([])
      setActivity([])
      return
    }
    void refreshFollowerDashboard(walletAddress)
  }, [walletAddress])

  useEffect(() => {
    if (!selectedLeader?.id) {
      setExecutions([])
      return
    }
    void (async () => {
      try {
        const nextExecutions = await socialApi.getVaultExecutions(
          selectedLeader.id,
          20
        )
        setExecutions(nextExecutions)
      } catch (err) {
        setExecutions([])
        setStatusMessage(
          err instanceof Error ? err.message : 'Failed to load vault executions'
        )
      }
    })()
  }, [selectedLeader?.id])

  const handleWithdraw = async (position: CopytradePosition) => {
    const shares = withdrawInputs[position.id]
    if (!shares || Number(shares) <= 0) return
    try {
      if (!walletAddress) {
        await connectWallet()
        setStatusMessage('Wallet connected. Click withdraw again to continue.')
        return
      }

      const auth = createSignedActionMetadata()
      const signature = await signMessage(
        buildCopytradeWithdrawMessage({
          leaderId: position.vault.leaderId,
          followerAddress: position.followerAddress,
          shares,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )

      const result = await socialApi.withdrawFromVault(
        position.vault.leaderId,
        {
          followerAddress: position.followerAddress,
          shares,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature
        }
      )
      setSuccessMessage(
        `Withdraw successful. Net received: ${formatMoney(result.netAmount)}`
      )
      if (walletAddress) await refreshFollowerDashboard(walletAddress)
      if (selectedLeader?.id === position.vault.leaderId) {
        const nextExecutions = await socialApi.getVaultExecutions(
          position.vault.leaderId,
          20
        )
        setExecutions(nextExecutions)
      }
      setWithdrawInputs(current => ({ ...current, [position.id]: '' }))
      await refreshOverview()
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to withdraw from vault'
      )
    }
  }

  const handleGenerateApiKey = async () => {
    if (!selectedLeader) return
    setLeaderApiKey('')
    setSuccessMessage('')

    if (!walletAddress) {
      await connectWallet()
      setStatusMessage('Wallet connected. Click again to generate the API key.')
      return
    }

    if (walletAddress !== selectedLeader.address) {
      setStatusMessage(
        'Connect the wallet that owns this leader profile to rotate the API key.'
      )
      return
    }

    setApiKeyLoading(true)
    try {
      const challenge = await socialApi.getApiKeyChallenge(selectedLeader.id, {
        leaderAddress: walletAddress
      })
      const signature = await signMessage(challenge.message)
      const result = await socialApi.rotateLeaderApiKey(selectedLeader.id, {
        leaderAddress: walletAddress,
        challengeId: challenge.challengeId,
        signature
      })
      setLeaderApiKey(result.apiKey)
      setSuccessMessage(
        'API key generated. Save it now — it is only shown once.'
      )
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to rotate the API key'
      )
    } finally {
      setApiKeyLoading(false)
    }
  }

  return (
    <Page>
      <Container>
        <Hero>
          <Title>Copytrade Vaults</Title>
          <Subtitle>
            Dedicated vault marketplace, follower dashboard, execution feed,
            withdrawals and API key management for leaders and AI agents.
          </Subtitle>
          {statusMessage ? <Banner>{statusMessage}</Banner> : null}
          {successMessage ? (
            <Banner tone="success">{successMessage}</Banner>
          ) : null}
        </Hero>

        <StatsGrid>
          <Card>
            <StatValue>{formatMoney(stats.totalAum)}</StatValue>
            <StatLabel>Total AUM</StatLabel>
          </Card>
          <Card>
            <StatValue>{stats.activeTraders}</StatValue>
            <StatLabel>Human Traders</StatLabel>
          </Card>
          <Card>
            <StatValue>{stats.aiAgents}</StatValue>
            <StatLabel>AI Agents</StatLabel>
          </Card>
          <Card>
            <StatValue>{stats.totalFollowers.toLocaleString()}</StatValue>
            <StatLabel>Total Followers</StatLabel>
          </Card>
        </StatsGrid>

        <Section>
          <SectionHeader>
            <SectionTitle>Vault Marketplace</SectionTitle>
            <Actions>
              <Button secondary onClick={() => navigate('/social')}>
                Open Social
              </Button>
            </Actions>
          </SectionHeader>
          <LeaderGrid>
            {leaders.map(leader => (
              <Card key={leader.id}>
                <LeaderName>{leader.name}</LeaderName>
                <Meta>
                  @{leader.username} · {leader.fee}% Fee ·{' '}
                  {leader.vault?.collateralToken ?? 'USDT'}
                </Meta>
                <Tags>
                  {leader.tags.slice(0, 3).map(tag => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Tags>
                <Metrics>
                  <Metric>
                    <MetricValue positive>{`+${leader.roi30d}%`}</MetricValue>
                    <MetricLabel>30d ROI</MetricLabel>
                  </Metric>
                  <Metric>
                    <MetricValue>{leader.aum}</MetricValue>
                    <MetricLabel>AUM</MetricLabel>
                  </Metric>
                  <Metric>
                    <MetricValue>{leader.followers}</MetricValue>
                    <MetricLabel>Followers</MetricLabel>
                  </Metric>
                  <Metric>
                    <MetricValue positive={false}>
                      {leader.drawdown}%
                    </MetricValue>
                    <MetricLabel>Drawdown</MetricLabel>
                  </Metric>
                </Metrics>
                <Actions>
                  <Button
                    secondary
                    onClick={() => setSelectedLeaderId(leader.id)}
                  >
                    Select
                  </Button>
                  <Button
                    secondary
                    onClick={() =>
                      navigate(`/social/profile/${leader.id}`, {
                        state: { trader: leader }
                      })
                    }
                  >
                    Profile
                  </Button>
                  <Button onClick={() => setCopyTarget(leader)}>Copy</Button>
                </Actions>
              </Card>
            ))}
          </LeaderGrid>
        </Section>

        <ContentGrid>
          <Stack>
            <Section>
              <SectionHeader>
                <SectionTitle>Follower Dashboard</SectionTitle>
                <Actions>
                  {!walletAddress ? (
                    <Button
                      onClick={() => {
                        connectWallet().catch(() => undefined)
                      }}
                    >
                      Connect Wallet
                    </Button>
                  ) : (
                    <Button
                      secondary
                      onClick={() => {
                        refreshFollowerDashboard(walletAddress).catch(
                          () => undefined
                        )
                      }}
                    >
                      Refresh
                    </Button>
                  )}
                </Actions>
              </SectionHeader>
              <Card>
                {!walletAddress ? (
                  <EmptyState>
                    Connect your wallet to load your copytrade positions and
                    activity.
                  </EmptyState>
                ) : dashboardLoading ? (
                  <EmptyState>Loading follower dashboard...</EmptyState>
                ) : (
                  <PositionGrid>
                    {positions.map(position => (
                      <Card key={position.id}>
                        <LeaderName>{position.vault.leaderName}</LeaderName>
                        <Meta>
                          {position.vault.name} ·{' '}
                          {position.vault.collateralToken}
                        </Meta>
                        <Metrics>
                          <Metric>
                            <MetricValue>
                              {formatMoney(position.currentValue)}
                            </MetricValue>
                            <MetricLabel>Current Value</MetricLabel>
                          </Metric>
                          <Metric>
                            <MetricValue>
                              {position.shareBalance.toFixed(4)}
                            </MetricValue>
                            <MetricLabel>Shares</MetricLabel>
                          </Metric>
                          <Metric>
                            <MetricValue>
                              {formatMoney(position.netDeposited)}
                            </MetricValue>
                            <MetricLabel>Net Deposited</MetricLabel>
                          </Metric>
                          <Metric>
                            <MetricValue positive={position.realizedPnl >= 0}>
                              {formatMoney(position.realizedPnl)}
                            </MetricValue>
                            <MetricLabel>Realized PnL</MetricLabel>
                          </Metric>
                        </Metrics>
                        <InputRow>
                          <Input
                            type="number"
                            placeholder="Shares to withdraw"
                            value={withdrawInputs[position.id] ?? ''}
                            onChange={event =>
                              setWithdrawInputs(current => ({
                                ...current,
                                [position.id]: event.target.value
                              }))
                            }
                          />
                          <Button
                            secondary
                            onClick={() =>
                              setWithdrawInputs(current => ({
                                ...current,
                                [position.id]: String(position.shareBalance)
                              }))
                            }
                          >
                            Max
                          </Button>
                          <Button
                            onClick={() => {
                              handleWithdraw(position).catch(() => undefined)
                            }}
                          >
                            Withdraw
                          </Button>
                        </InputRow>
                      </Card>
                    ))}
                    {positions.length === 0 ? (
                      <EmptyState>
                        No active copytrade positions for this wallet yet.
                      </EmptyState>
                    ) : null}
                  </PositionGrid>
                )}
              </Card>
            </Section>

            <Section>
              <SectionHeader>
                <SectionTitle>Activity Feed</SectionTitle>
              </SectionHeader>
              <Card>
                <FeedList>
                  {activity.map((item, index) => (
                    <FeedItem key={`${item.type}-${item.createdAt}-${index}`}>
                      <FeedTitle>{renderActivityTitle(item)}</FeedTitle>
                      <FeedMeta>
                        {item.amount
                          ? `Amount: ${item.amount} ${item.token ?? ''} · `
                          : ''}
                        {item.netAmount
                          ? `Net: ${item.netAmount} ${item.token ?? ''} · `
                          : ''}
                        {item.slices ? `Slices: ${item.slices} · ` : ''}
                        {formatDateTime(item.createdAt)}
                      </FeedMeta>
                    </FeedItem>
                  ))}
                  {activity.length === 0 ? (
                    <EmptyState>No recent activity to show.</EmptyState>
                  ) : null}
                </FeedList>
              </Card>
            </Section>
          </Stack>

          <Stack>
            <Section>
              <SectionHeader>
                <SectionTitle>
                  {selectedLeader?.name ?? 'Vault Details'}
                </SectionTitle>
              </SectionHeader>
              <Card>
                {selectedLeader ? (
                  <>
                    <Meta>
                      @{selectedLeader.username} ·{' '}
                      {selectedLeader.vault?.collateralToken ?? 'USDT'} Vault ·{' '}
                      {selectedLeader.fee}% Performance Fee
                    </Meta>
                    <Tags>
                      {selectedLeader.tags.map(tag => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </Tags>
                    <Metrics>
                      <Metric>
                        <MetricValue>{selectedLeader.aum}</MetricValue>
                        <MetricLabel>AUM</MetricLabel>
                      </Metric>
                      <Metric>
                        <MetricValue>{selectedLeader.winRate}%</MetricValue>
                        <MetricLabel>Win Rate</MetricLabel>
                      </Metric>
                      <Metric>
                        <MetricValue>
                          {selectedLeader.vault?.minDeposit ?? 0}
                        </MetricValue>
                        <MetricLabel>Min Deposit</MetricLabel>
                      </Metric>
                      <Metric>
                        <MetricValue>
                          {selectedLeader.vault?.maxSlippageBps ?? 0} bps
                        </MetricValue>
                        <MetricLabel>Max Slippage</MetricLabel>
                      </Metric>
                    </Metrics>
                  </>
                ) : (
                  <EmptyState>Select a leader to inspect the vault.</EmptyState>
                )}
              </Card>
            </Section>

            <Section>
              <SectionHeader>
                <SectionTitle>Execution History</SectionTitle>
              </SectionHeader>
              <Card>
                {executions.length > 0 ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Pair</Th>
                        <Th>Side</Th>
                        <Th>Slice</Th>
                        <Th>Amount In</Th>
                        <Th>Price</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.map(execution => (
                        <tr key={execution.id}>
                          <Td>{execution.pairSymbol}</Td>
                          <Td>{execution.side}</Td>
                          <Td>
                            {execution.sliceIndex}/{execution.totalSlices}
                          </Td>
                          <Td>{execution.amountIn.toLocaleString()}</Td>
                          <Td>{execution.executionPrice.toLocaleString()}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <EmptyState>
                    No executions available for this vault yet.
                  </EmptyState>
                )}
              </Card>
            </Section>

            <Section>
              <SectionHeader>
                <SectionTitle>Leader / Agent API Key</SectionTitle>
                <Actions>
                  <Button
                    disabled={!selectedLeader || apiKeyLoading}
                    onClick={() => {
                      handleGenerateApiKey().catch(() => undefined)
                    }}
                  >
                    {apiKeyLoading ? 'Signing...' : 'Generate / Rotate'}
                  </Button>
                </Actions>
              </SectionHeader>
              <Card>
                <Meta>
                  {selectedLeader
                    ? `Connected wallet must match ${selectedLeader.address}`
                    : 'Select a leader to manage the API key.'}
                </Meta>
                {leaderApiKey ? (
                  <CodeBox>{leaderApiKey}</CodeBox>
                ) : (
                  <EmptyState>No API key generated in this session.</EmptyState>
                )}
              </Card>
            </Section>
          </Stack>
        </ContentGrid>

        <CopyModal
          trader={copyTarget as any}
          onClose={() => setCopyTarget(null)}
          onConfirm={async () => {
            if (walletAddress) {
              await refreshFollowerDashboard(walletAddress)
            }
            await refreshOverview()
          }}
        />
      </Container>
    </Page>
  )
}

export default CopytradePage
