import request from 'supertest'

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest.fn(),
}))

jest.mock('../../services/copytradeService', () => ({
  copytradeService: {
    depositToVault: jest.fn(),
    withdrawFromVault: jest.fn(),
    createSignal: jest.fn(),
    validateLeaderApiKey: jest.fn(),
    listVaults: jest.fn().mockResolvedValue([]),
    getUserPositions: jest.fn().mockResolvedValue([]),
    getActivity: jest.fn().mockResolvedValue([]),
    getVaultByLeader: jest.fn().mockRejectedValue(new Error('Vault not found')),
    getVaultExecutions: jest.fn().mockResolvedValue([]),
    createApiKeyChallenge: jest.fn().mockResolvedValue({ challengeId: 'ch-1', message: 'challenge' }),
    createOrRotateApiKey: jest.fn().mockResolvedValue({ apiKey: 'key-123' }),
  },
}))

jest.mock('../../services/socialService', () => ({
  socialService: {
    getStats: jest.fn().mockResolvedValue({
      totalLeaders: 0,
      totalFollowers: 0,
      totalIdeas: 0,
      totalTrades: 0,
    }),
    listLeaders: jest.fn().mockResolvedValue([]),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    listIdeas: jest.fn().mockResolvedValue([]),
    likeIdea: jest.fn().mockResolvedValue({ success: true }),
    unlikeIdea: jest.fn().mockResolvedValue({ success: true }),
    commentOnIdea: jest.fn().mockResolvedValue({ id: 'comment-1' }),
    getFollowedLeaders: jest.fn().mockResolvedValue([]),
    getLeaderProfileByAddress: jest.fn().mockResolvedValue(null),
    upsertLeaderProfile: jest.fn().mockResolvedValue({ id: 'leader-1' }),
    getLeaderProfile: jest.fn().mockResolvedValue(null),
    followLeader: jest.fn().mockResolvedValue({ success: true }),
    unfollowLeader: jest.fn().mockResolvedValue({ success: true }),
    depositToVault: jest.fn().mockResolvedValue({ deposit: 'ok' }),
    withdrawFromVault: jest.fn().mockResolvedValue({ withdrawal: 'ok' }),
  },
}))

jest.mock('../../services/marginService', () => ({
  marginService: {
    getOverview: jest.fn().mockResolvedValue({ account: null, positions: [], risk: {} }),
    getPriceHealth: jest.fn().mockReturnValue({ summary: {}, pairs: [] }),
    getPriceHealthSummary: jest.fn().mockReturnValue({}),
    getPriceHealthMetrics: jest.fn().mockReturnValue(''),
    resetPriceHealthMonitor: jest.fn().mockReturnValue({ summary: {}, pairs: [] }),
    depositCollateral: jest.fn().mockResolvedValue({ transfer: 'ok' }),
    withdrawCollateral: jest.fn().mockResolvedValue({ transfer: 'ok' }),
    openPosition: jest.fn().mockResolvedValue({ position: 'ok' }),
    closePosition: jest.fn().mockResolvedValue({ overview: 'ok' }),
    liquidatePosition: jest.fn().mockResolvedValue({ overview: 'ok' }),
  },
}))

jest.mock('../../services/agentService', () => ({
  agentService: {
    registerAgent: jest.fn().mockResolvedValue({ id: 'agent-1', walletAddress: 'agent-wallet-123', agentType: 'AI_AGENT' }),
    listAgents: jest.fn().mockResolvedValue({ agents: [], total: 0 }),
    getAgentProfile: jest.fn().mockResolvedValue({ id: 'agent-1', walletAddress: 'agent-wallet-123', agentType: 'AI_AGENT' }),
    getAgentByWallet: jest.fn().mockResolvedValue(null),
    createApiKey: jest.fn().mockResolvedValue({ id: 'key-1', key: 'api-key-123', prefix: 'lunx' }),
    revokeApiKey: jest.fn().mockResolvedValue(undefined),
    verifyApiKey: jest.fn().mockResolvedValue(null),
    getApiKeys: jest.fn().mockResolvedValue([]),
    recordStake: jest.fn().mockResolvedValue({ stakeId: 'stake-1' }),
    STAKING_TIERS: [],
  },
}))

import app from './testApp'
import { agentService } from '../../services/agentService'
import { verifyWalletActionSignature } from '../../middleware/auth'
import { copytradeService } from '../../services/copytradeService'
import { marginService } from '../../services/marginService'
import { socialService } from '../../services/socialService'

const agentServiceMock = agentService as jest.Mocked<typeof agentService>
const verifyWalletActionSignatureMock = verifyWalletActionSignature as jest.MockedFunction<typeof verifyWalletActionSignature>
const copytradeServiceMock = copytradeService as jest.Mocked<typeof copytradeService>
const marginServiceMock = marginService as jest.Mocked<typeof marginService>
const socialServiceMock = socialService as jest.Mocked<typeof socialService>

const signedBody = {
  nonce: '1700000000001',
  timestamp: 1700000000001,
  signature: 'signed-payload',
}

describe('Auth attack simulation E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('blocks wallet impersonation on copytrade deposit when signature verification fails', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Invalid signature' })

    const res = await request(app)
      .post('/api/v1/copytrade/vaults/leader-1/deposit')
      .send({
        followerAddress: 'victim-wallet-address',
        token: 'USDT',
        amount: '100',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Invalid signature')
    expect(copytradeServiceMock.depositToVault).not.toHaveBeenCalled()
  })

  it('blocks replayed copytrade withdrawal attempts when nonce was already used', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Signature nonce already used' })

    const res = await request(app)
      .post('/api/v1/copytrade/vaults/leader-1/withdraw')
      .send({
        followerAddress: 'follower-addr-123',
        shares: '50',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Signature nonce already used')
    expect(copytradeServiceMock.withdrawFromVault).not.toHaveBeenCalled()
  })

  it('blocks replay on social follow before state mutation', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Signature nonce already used' })

    const res = await request(app)
      .post('/api/v1/social/leaders/leader-1/follow')
      .send({
        address: 'follower-addr-123',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Signature nonce already used')
    expect(socialServiceMock.followLeader).not.toHaveBeenCalled()
  })

  it('blocks margin collateral deposit when signature verification fails', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Invalid signature' })

    const res = await request(app)
      .post('/api/v1/margin/collateral/deposit')
      .send({
        address: 'victim-wallet-address',
        token: 'USDT',
        amount: '1000',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Invalid signature')
    expect(marginServiceMock.depositCollateral).not.toHaveBeenCalled()
  })

  it('blocks replayed margin position open before state mutation', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Signature nonce already used' })

    const res = await request(app)
      .post('/api/v1/margin/positions')
      .send({
        address: 'trader-wallet-123',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '500',
        leverage: '5',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Signature nonce already used')
    expect(marginServiceMock.openPosition).not.toHaveBeenCalled()
  })

  it('blocks unauthenticated agent registration when wallet signature verification fails', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Invalid signature' })

    const res = await request(app)
      .post('/api/v1/agents/register')
      .send({
        walletAddress: 'agent-wallet-123',
        agentType: 'AI_AGENT',
        framework: 'OpenClaw',
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Invalid signature')
    expect(agentServiceMock.registerAgent).not.toHaveBeenCalled()
  })

  it('blocks replayed bootstrap API key creation before issuing a first agent key', async () => {
    verifyWalletActionSignatureMock.mockResolvedValue({ ok: false, error: 'Signature nonce already used' })
    agentServiceMock.getAgentProfile.mockResolvedValueOnce({
      id: 'agent-1',
      walletAddress: 'agent-wallet-123',
      agentType: 'AI_AGENT',
    } as Awaited<ReturnType<typeof agentService.getAgentProfile>>)

    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys')
      .send({
        walletAddress: 'agent-wallet-123',
        label: 'bootstrap',
        permissions: ['READ_ONLY'],
        ...signedBody,
      })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error', 'Signature nonce already used')
    expect(agentServiceMock.createApiKey).not.toHaveBeenCalled()
  })

  it('blocks wallet bootstrap API key creation once the agent already has an active key', async () => {
    agentServiceMock.getAgentProfile.mockResolvedValueOnce({
      id: 'agent-1',
      walletAddress: 'agent-wallet-123',
      agentType: 'AI_AGENT',
    } as Awaited<ReturnType<typeof agentService.getAgentProfile>>)
    agentServiceMock.getApiKeys.mockResolvedValueOnce([
      {
        id: 'key-1',
        label: 'default',
        prefix: 'lunx',
        permissions: ['READ_ONLY'],
        expiresAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
        isActive: true,
      },
    ] as Awaited<ReturnType<typeof agentService.getApiKeys>>)

    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys')
      .send({
        walletAddress: 'agent-wallet-123',
        label: 'bootstrap',
        permissions: ['READ_ONLY'],
        ...signedBody,
      })

    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error', 'Existing API keys require authenticated agent key management')
    expect(verifyWalletActionSignatureMock).not.toHaveBeenCalled()
    expect(agentServiceMock.createApiKey).not.toHaveBeenCalled()
  })

  it('blocks cross-agent API key listing when authenticated agent does not match target agent', async () => {
    agentServiceMock.verifyApiKey.mockResolvedValueOnce({
      agent: {
        id: 'agent-1',
        walletAddress: 'agent-wallet-123',
        agentType: 'AI_AGENT',
        stakingTier: 0,
        dailyTradeLimit: 10,
        maxPositionSize: 1000,
        maxOpenOrders: 5,
      },
      permissions: ['READ_ONLY'],
      keyId: 'key-1',
    } as unknown as Awaited<ReturnType<typeof agentService.verifyApiKey>>)

    const res = await request(app)
      .get('/api/v1/agents/agent-2/api-keys')
      .set('X-API-Key', 'agent-1-key')

    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error', 'Authenticated agent does not match target agent')
    expect(agentServiceMock.getApiKeys).not.toHaveBeenCalled()
  })
})
