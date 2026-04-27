jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(undefined),
  signatureVerify: jest.fn(),
}));

jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();

  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    _clear: () => store.clear(),
  };

  return {
    getRedis: jest.fn(() => mockRedis),
    disconnectRedis: jest.fn(async () => undefined),
    __mockRedis: mockRedis,
  };
});

jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: {
    assertWalletCanAct: jest.fn().mockResolvedValue(undefined),
  },
}));

import { signatureVerify } from '@polkadot/util-crypto';
import { verifyWalletActionSignature } from '../../middleware/auth';
import * as redisModule from '../../utils/redis';
import { walletRiskService } from '../../services/walletRiskService';

const signatureVerifyMock = signatureVerify as jest.MockedFunction<
  typeof signatureVerify
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = (redisModule as any).__mockRedis as {
  set: jest.Mock;
  _clear: () => void;
};
const walletRiskServiceMock = walletRiskService as jest.Mocked<
  typeof walletRiskService
>;

describe('verifyWalletActionSignature security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis._clear();
    walletRiskServiceMock.assertWalletCanAct.mockResolvedValue(undefined);
  });

  it('rejects invalid signatures', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: false } as ReturnType<
      typeof signatureVerify
    >);

    const result = await verifyWalletActionSignature({
      action: 'copytrade.deposit',
      address: '5FakeAddress1111111111111111111111111111111111',
      nonce: 'nonce-invalid-signature',
      timestamp: Date.now(),
      signature: 'bad-signature',
      fields: {
        leaderId: 'leader-1',
        token: 'USDT',
        amount: '100',
      },
    });

    expect(result).toEqual({ ok: false, error: 'Invalid signature' });
  });

  it('rejects expired signatures before verification', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);

    const result = await verifyWalletActionSignature({
      action: 'social.follow-leader',
      address: '5ExpiredAddress111111111111111111111111111111111',
      nonce: 'nonce-expired-signature',
      timestamp: Date.now() - 10 * 60 * 1000,
      signature: 'signed-payload',
      fields: {
        leaderId: 'leader-1',
      },
    });

    expect(result).toEqual({ ok: false, error: 'Expired signature' });
    expect(signatureVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects replayed signed actions with the same action, address, and nonce', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);

    const input = {
      action: 'copytrade.withdraw',
      address: '5ReplayAddress1111111111111111111111111111111111',
      nonce: 'nonce-replay-same-action',
      timestamp: Date.now(),
      signature: 'signed-payload',
      fields: {
        leaderId: 'leader-1',
        shares: '50',
      },
    };

    const first = await verifyWalletActionSignature(input);
    const second = await verifyWalletActionSignature(input);

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      error: 'Signature nonce already used',
    });
    expect(signatureVerifyMock).toHaveBeenCalledTimes(1);
  });

  it('rejects banned wallets after signature validation and before nonce consumption', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);
    walletRiskServiceMock.assertWalletCanAct.mockRejectedValueOnce(
      new Error('Wallet is banned: market abuse'),
    );

    const result = await verifyWalletActionSignature({
      action: 'margin.deposit',
      address: '5BannedAddress111111111111111111111111111111111',
      nonce: 'nonce-banned-wallet',
      timestamp: Date.now(),
      signature: 'signed-payload',
      fields: {
        amount: '100',
      },
    });

    expect(result).toEqual({
      ok: false,
      error: 'Wallet is banned: market abuse',
    });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
