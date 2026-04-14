import request from 'supertest'
import app from './testApp'
import { buildSignedBody, buildSignedQuery } from './authTestUtils'
import { asymmetricService } from '../../services/asymmetricService'
import { rebalancerService } from '../../services/rebalancerService'

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-message' }),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' })
}))

jest.mock('../../middleware/agentAuth', () => ({
  optionalAgentAuth: () => (_req: any, _res: any, next: any) => next(),
  agentAuth: () => (req: any, _res: any, next: any) => {
    req.agent = {
      id: 'agent-1',
      walletAddress: '5Fuser123'
    }
    next()
  }
}))

const mockedAsymmetricService = asymmetricService as jest.Mocked<
  typeof asymmetricService
>
const mockedRebalancerService = rebalancerService as jest.Mocked<
  typeof rebalancerService
>

jest.mock('../../services/asymmetricService', () => ({
  asymmetricService: {
    listUserStrategies: jest.fn().mockResolvedValue([]),
    getStrategyForUser: jest.fn().mockResolvedValue(true),
    getStrategyForAgent: jest.fn().mockResolvedValue(true),
    linkStrategyToAgent: jest.fn().mockResolvedValue({
      id: 'strategy-1',
      userAddress: '5Fuser123',
      pairAddress: '5Fpair123',
      agentId: 'agent-1',
      status: 'ACTIVE'
    }),
    getStrategy: jest.fn().mockResolvedValue({
      id: 'strategy-1',
      userAddress: '5Fuser123',
      pairAddress: '5Fpair',
      agentId: 'agent-1',
      status: 'ACTIVE',
      isAutoRebalance: true,
      pendingRebalanceAmount: '0',
      lastRebalancedAt: null,
      buyCurve: {
        gamma: 3,
        maxCapacity: '10000',
        feeTargetBps: 30,
        baseLiquidity: '1000'
      },
      sellCurve: {
        gamma: 2,
        maxCapacity: '8000',
        feeTargetBps: 30,
        profitTargetBps: 500
      },
      retryCount: 0,
      lastError: null,
      agentManaged: true,
      createdAt: new Date('2026-04-14T10:00:00.000Z'),
      updatedAt: new Date('2026-04-14T10:00:00.000Z')
    }),
    getRebalanceLogs: jest.fn().mockResolvedValue([
      {
        id: 'log-1',
        strategyId: 'strategy-1',
        side: 'SELL',
        trigger: 'AI_AGENT',
        acquiredAmount: '0',
        newCapacity: '8000',
        txHash: '0xtx',
        gasConsumed: null,
        status: 'SUCCESS',
        createdAt: new Date('2026-04-14T11:00:00.000Z')
      }
    ]),
    buildCanonicalStatus: jest.fn().mockImplementation((strategy, input) => ({
      ...strategy,
      persistedConfig: {
        strategyId: strategy.id,
        userAddress: strategy.userAddress,
        pairAddress: strategy.pairAddress,
        agentId: strategy.agentId,
        status: strategy.status,
        isAutoRebalance: strategy.isAutoRebalance,
        pendingRebalanceAmount: strategy.pendingRebalanceAmount,
        lastRebalancedAt: strategy.lastRebalancedAt,
        retryCount: strategy.retryCount,
        lastError: strategy.lastError,
        buyCurve: strategy.buyCurve,
        sellCurve: strategy.sellCurve,
        createdAt: strategy.createdAt,
        updatedAt: strategy.updatedAt
      },
      liveState: input.liveState,
      delegation: {
        agentManaged: strategy.agentManaged,
        agentId: strategy.agentId,
        walletAddress: strategy.userAddress,
        requiredScope: 'MANAGE_ASYMMETRIC',
        managerAddress: input.liveState.managerAddress,
        relayerAddress: input.liveState.relayerAddress,
        delegatedToRelayer: input.liveState.delegatedToRelayer,
        checkedAt: input.checkedAt
      }
    }))
  }
}))

jest.mock('../../services/rebalancerService', () => ({
  rebalancerService: {
    isEnabled: jest.fn(),
    isManagedByRelayer: jest.fn(),
    getCurveState: jest.fn(),
    getManager: jest.fn(),
    getRelayerAddress: jest.fn()
  }
}))

describe('Asymmetric API E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns additive canonical status while preserving legacy fields on signed user read', async () => {
    mockedRebalancerService.isEnabled.mockReturnValue(false)

    const res = await request(app)
      .get('/api/v1/asymmetric/strategies/strategy-1')
      .query(buildSignedQuery('userAddress', '5Fuser123'))

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id', 'strategy-1')
    expect(res.body).toHaveProperty('status', 'ACTIVE')
    expect(res.body).toHaveProperty('liveState.available', false)
    expect(res.body).toHaveProperty('liveState.reason', 'REBALANCER_DISABLED')
    expect(res.body).toHaveProperty('persistedConfig.strategyId', 'strategy-1')
    expect(res.body).toHaveProperty('delegation.requiredScope', 'MANAGE_ASYMMETRIC')
  })

  it('uses same canonical status contract on agent strategy-status endpoint', async () => {
    mockedRebalancerService.isEnabled.mockReturnValue(true)
    mockedRebalancerService.getCurveState
      .mockResolvedValueOnce({
        k: 1000,
        gamma: 3,
        maxCapacity: 10000,
        feeBps: 30,
        currentVolume: 200
      } as any)
      .mockResolvedValueOnce({
        k: 500,
        gamma: 2,
        maxCapacity: 8000,
        feeBps: 30,
        currentVolume: 90
      } as any)
    mockedRebalancerService.getManager.mockResolvedValue('5Fmanager')
    mockedRebalancerService.getRelayerAddress.mockResolvedValue('5Fmanager')

    const res = await request(app).get(
      '/api/v1/asymmetric/agent/strategy-status/strategy-1'
    )

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('success', true)
    expect(res.body).toHaveProperty('strategy.id', 'strategy-1')
    expect(res.body).toHaveProperty('strategy.liveState.available', true)
    expect(res.body).toHaveProperty('strategy.delegation.delegatedToRelayer', true)
    expect(res.body).toHaveProperty('recentLogs')
    expect(Array.isArray(res.body.recentLogs)).toBe(true)

    expect(mockedAsymmetricService.buildCanonicalStatus).toHaveBeenCalled()
  })

  it('returns 400 on invalid signed query payload', async () => {
    const res = await request(app)
      .get('/api/v1/asymmetric/strategies/strategy-1')
      .query(buildSignedBody({ userAddress: '' }))

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error', 'Validation failed')
  })

  it('blocks link-strategy when on-chain delegation is incomplete', async () => {
    mockedRebalancerService.isManagedByRelayer.mockResolvedValue(false)

    const res = await request(app)
      .post('/api/v1/asymmetric/agent/link-strategy')
      .send({
        strategyId: '11111111-1111-1111-1111-111111111111',
        pairAddress: '5Fpair123'
      })

    expect(res.status).toBe(409)
    expect(res.body).toHaveProperty(
      'error',
      'On-chain manager delegation is incomplete. Apply set_manager to the relayer before linking the strategy.'
    )
  })

  it('links strategy when relayer delegation is confirmed on-chain', async () => {
    mockedRebalancerService.isManagedByRelayer.mockResolvedValue(true)

    const res = await request(app)
      .post('/api/v1/asymmetric/agent/link-strategy')
      .send({
        strategyId: '11111111-1111-1111-1111-111111111111',
        pairAddress: '5Fpair123'
      })

    expect(res.status).toBe(201)
    expect(mockedAsymmetricService.linkStrategyToAgent).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'agent-1',
      '5Fuser123',
      '5Fpair123'
    )
  })
})
