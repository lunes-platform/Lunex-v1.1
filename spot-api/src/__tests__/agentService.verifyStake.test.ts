jest.mock('../db', () => ({
  __esModule: true,
  default: {
    agentStake: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    agent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import prisma from '../db';
import { agentService, setStakeChainVerifier } from '../services/agentService';
import type { StakeChainVerifier } from '../services/agentService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

const PENDING_STAKE = {
  id: 'stake-1',
  agentId: 'agent-1',
  amount: '500', // user-supplied amount recorded at recordStake time
  token: 'LUNES',
  txHash: '0xabc',
  status: 'PENDING_VERIFICATION',
  agent: {
    id: 'agent-1',
    walletAddress: '5GrwvaEF...alice',
    stakedAmount: '0',
  },
};

describe('agentService.verifyStake — on-chain verification (fail-closed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default (unconfigured) verifier between tests.
    setStakeChainVerifier(null);
    mockPrisma.$transaction.mockResolvedValue([]);
    mockPrisma.agentStake.update.mockResolvedValue({});
    mockPrisma.agent.update.mockResolvedValue({});
  });

  it('refuses to credit the tier when no on-chain verifier is configured (fail-closed)', async () => {
    mockPrisma.agentStake.findUnique.mockResolvedValue(PENDING_STAKE);

    await expect(agentService.verifyStake('stake-1')).rejects.toThrow(
      /on-chain verification/i,
    );

    // Critical: tier must NOT be credited and the stake must NOT be marked STAKED.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.agent.update).not.toHaveBeenCalled();
  });

  it('does NOT credit the tier when the on-chain stake is missing / txHash unverifiable', async () => {
    mockPrisma.agentStake.findUnique.mockResolvedValue(PENDING_STAKE);

    const verifier: StakeChainVerifier = {
      isConfigured: () => true,
      // No stake found on-chain for this account.
      getOnChainStakeAmount: jest.fn().mockResolvedValue(null),
    };
    setStakeChainVerifier(verifier);

    await expect(agentService.verifyStake('stake-1')).rejects.toThrow(
      /on-chain stake (not found|could not be verified)/i,
    );

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.agent.update).not.toHaveBeenCalled();
  });

  it('does NOT credit the tier when the recorded (forged) amount exceeds the on-chain amount', async () => {
    // Recorded amount 500, but the chain only shows 1 LUNES staked — forged.
    mockPrisma.agentStake.findUnique.mockResolvedValue(PENDING_STAKE);

    const verifier: StakeChainVerifier = {
      isConfigured: () => true,
      getOnChainStakeAmount: jest.fn().mockResolvedValue(1),
    };
    setStakeChainVerifier(verifier);

    await expect(agentService.verifyStake('stake-1')).rejects.toThrow(
      /does not match|exceeds|forged|mismatch/i,
    );

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.agent.update).not.toHaveBeenCalled();
  });

  it('credits the tier using the ON-CHAIN amount (not the user-supplied amount) when verified', async () => {
    mockPrisma.agentStake.findUnique.mockResolvedValue(PENDING_STAKE);

    const verifier: StakeChainVerifier = {
      isConfigured: () => true,
      // Chain confirms 500 staked for this account.
      getOnChainStakeAmount: jest.fn().mockResolvedValue(500),
    };
    setStakeChainVerifier(verifier);

    const result = await agentService.verifyStake('stake-1');

    expect(verifier.getOnChainStakeAmount).toHaveBeenCalledWith(
      '5GrwvaEF...alice',
    );
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // tier 2 threshold is 100..1000 -> 500 lands on tier 2 (index 2 minStake 1000? no -> tier index for 500)
    expect(result.newStakedAmount).toBe(500);
  });
});
