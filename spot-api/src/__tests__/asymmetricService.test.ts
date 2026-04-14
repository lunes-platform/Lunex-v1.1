const mockPrisma = {
  asymmetricStrategy: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  asymmetricRebalanceLog: {
    create: jest.fn(),
    findMany: jest.fn()
  }
}

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma
}))

jest.mock('../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}))

import {
  asymmetricService,
  isCoolingDown,
  isProfitableToRebalance
} from '../services/asymmetricService'

function decimalLike(value: string | number) {
  return {
    toString: () => String(value)
  }
}

function baseStrategy(overrides: Record<string, any> = {}) {
  return {
    id: 'strategy-1',
    userAddress: '5Fuser',
    pairAddress: '5Fpair',
    agentId: null,
    status: 'ACTIVE',
    isAutoRebalance: true,
    pendingAmount: decimalLike('0'),
    lastRebalancedAt: null,
    buyK: decimalLike('1000'),
    buyGamma: 3,
    buyMaxCapacity: decimalLike('10000'),
    buyFeeTargetBps: 30,
    sellGamma: 2,
    sellMaxCapacity: decimalLike('8000'),
    sellFeeTargetBps: 35,
    sellProfitTargetBps: 500,
    retryCount: 0,
    lastError: null,
    createdAt: new Date('2026-04-14T10:00:00Z'),
    updatedAt: new Date('2026-04-14T10:00:00Z'),
    ...overrides
  }
}

describe('asymmetricService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records MANUAL audit log when user updates curve params', async () => {
    ;(mockPrisma.asymmetricStrategy.findUnique as jest.Mock).mockResolvedValue(
      baseStrategy()
    )
    ;(mockPrisma.asymmetricStrategy.update as jest.Mock).mockResolvedValue(
      baseStrategy({ buyGamma: 4, buyMaxCapacity: decimalLike('12000') })
    )

    const updated = await asymmetricService.updateCurveParams(
      'strategy-1',
      '5Fuser',
      {
        isBuySide: true,
        newGamma: 4,
        newMaxCapacity: '12000'
      }
    )

    expect(updated.buyCurve.gamma).toBe(4)
    expect(mockPrisma.asymmetricRebalanceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          strategyId: 'strategy-1',
          trigger: 'MANUAL',
          side: 'BUY',
          status: 'SUCCESS'
        })
      })
    )
  })

  it('normalizes stored logs to canonical trigger/status', async () => {
    ;(mockPrisma.asymmetricRebalanceLog.findMany as jest.Mock).mockResolvedValue(
      [
        {
          id: 'log-1',
          strategyId: 'strategy-1',
          side: 'SELL',
          trigger: 'manual',
          acquiredAmount: decimalLike('0'),
          newCapacity: decimalLike('8500'),
          txHash: null,
          gasConsumed: null,
          status: 'auto_rebalance_enabled',
          createdAt: new Date('2026-04-14T11:00:00Z')
        }
      ]
    )

    const logs = await asymmetricService.getRebalanceLogs('strategy-1', 10)

    expect(logs).toHaveLength(1)
    expect(logs[0].trigger).toBe('MANUAL')
    expect(logs[0].status).toBe('SUCCESS')
    expect(logs[0].newCapacity).toBe('8500')
  })

  it('builds canonical status with additive fields while keeping legacy fields', () => {
    const strategy = {
      id: 'strategy-1',
      userAddress: '5Fuser',
      pairAddress: '5Fpair',
      agentId: 'agent-1',
      status: 'ACTIVE' as const,
      isAutoRebalance: true,
      pendingRebalanceAmount: '20',
      lastRebalancedAt: null,
      buyCurve: {
        gamma: 3,
        maxCapacity: '10000',
        feeTargetBps: 30,
        baseLiquidity: '1000'
      },
      sellCurve: {
        gamma: 2,
        maxCapacity: '9000',
        feeTargetBps: 35,
        profitTargetBps: 500
      },
      retryCount: 0,
      lastError: null,
      agentManaged: true,
      createdAt: new Date('2026-04-14T10:00:00Z'),
      updatedAt: new Date('2026-04-14T10:00:00Z')
    }

    const canonical = asymmetricService.buildCanonicalStatus(strategy, {
      checkedAt: '2026-04-14T12:00:00.000Z',
      liveState: {
        available: true,
        reason: null,
        source: 'on-chain',
        checkedAt: '2026-04-14T12:00:00.000Z',
        managerAddress: '5Fmanager',
        relayerAddress: '5Fmanager',
        delegatedToRelayer: true,
        buyCurve: {
          k: 1000,
          gamma: 3,
          maxCapacity: 10000,
          feeBps: 30,
          currentVolume: 250
        },
        sellCurve: {
          k: 500,
          gamma: 2,
          maxCapacity: 9000,
          feeBps: 35,
          currentVolume: 100
        }
      }
    })

    expect(canonical.id).toBe('strategy-1')
    expect(canonical.persistedConfig.strategyId).toBe('strategy-1')
    expect(canonical.liveState.available).toBe(true)
    expect(canonical.delegation.requiredScope).toBe('MANAGE_ASYMMETRIC')
    expect(canonical.delegation.delegatedToRelayer).toBe(true)
  })

  it('evaluates cooldown windows deterministically', () => {
    const now = Date.now()
    expect(isCoolingDown(new Date(now - 1_000), 5_000)).toBe(true)
    expect(isCoolingDown(new Date(now - 10_000), 5_000)).toBe(false)
  })

  it('applies profitability threshold guardrails for rebalance decisions', () => {
    expect(isProfitableToRebalance(0.1, 0.05)).toBe(false)
    expect(isProfitableToRebalance(0.25, 0.05)).toBe(true)
  })
})
