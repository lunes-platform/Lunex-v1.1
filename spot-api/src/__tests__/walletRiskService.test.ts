const mockPrisma = {
  bannedWallet: {
    findFirst: jest.fn(),
  },
  agent: {
    findFirst: jest.fn(),
  },
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { walletRiskService } from '../services/walletRiskService';

describe('walletRiskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.bannedWallet.findFirst.mockResolvedValue(null);
    mockPrisma.agent.findFirst.mockResolvedValue(null);
  });

  it('allows wallets with no wallet or agent ban record', async () => {
    await expect(
      walletRiskService.assertWalletCanAct('wallet-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks wallets listed in the admin wallet ban registry', async () => {
    mockPrisma.bannedWallet.findFirst.mockResolvedValue({
      address: 'banned-wallet',
      reason: 'market abuse',
    });

    await expect(
      walletRiskService.assertWalletCanAct('banned-wallet'),
    ).rejects.toThrow('Wallet is banned: market abuse');
  });

  it('blocks banned agent wallets from signed financial actions', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue({
      isBanned: true,
      banReason: 'market abuse',
    });

    await expect(
      walletRiskService.assertWalletCanAct('banned-wallet'),
    ).rejects.toThrow('Wallet is banned: market abuse');
  });
});
