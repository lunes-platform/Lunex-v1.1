import request from 'supertest';
import app from './testApp';
import { buildSignedBody, buildSignedQuery } from './authTestUtils';
import { copytradeService } from '../../services/copytradeService';

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-message' }),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' }),
}));

const mockedCopytradeService = copytradeService as jest.Mocked<
  typeof copytradeService
>;

jest.mock('../../services/copytradeService', () => ({
  copytradeService: {
    createApiKeyChallenge: jest
      .fn()
      .mockResolvedValue({ challengeId: 'ch-1', message: 'challenge' }),
    listVaults: jest.fn().mockResolvedValue([]),
    getUserPositions: jest.fn().mockResolvedValue([]),
    getActivity: jest.fn().mockResolvedValue([]),
    getVaultByLeader: jest.fn().mockRejectedValue(new Error('Vault not found')),
    getVaultExecutions: jest.fn().mockResolvedValue([]),
    listPendingWalletContinuations: jest
      .fn()
      .mockResolvedValue({ available: true, pending: [] }),
    createOrRotateApiKey: jest.fn().mockResolvedValue({ apiKey: 'key-123' }),
    depositToVault: jest.fn().mockResolvedValue({ deposit: 'ok' }),
    withdrawFromVault: jest.fn().mockResolvedValue({ withdrawal: 'ok' }),
    createSignal: jest.fn().mockResolvedValue({ signal: 'ok' }),
    confirmWalletSignalContinuation: jest
      .fn()
      .mockResolvedValue({ confirmed: true }),
    validateLeaderApiKey: jest.fn().mockResolvedValue(true),
  },
}));

describe('Copytrade API E2E', () => {
  describe('GET /api/v1/copytrade/vaults', () => {
    it('should return empty vaults list', async () => {
      const res = await request(app).get('/api/v1/copytrade/vaults');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('vaults');
      expect(Array.isArray(res.body.vaults)).toBe(true);
    });
  });

  describe('GET /api/v1/copytrade/positions', () => {
    it('should return 400 without address', async () => {
      const res = await request(app).get('/api/v1/copytrade/positions');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should return 200 with valid signed read', async () => {
      const res = await request(app)
        .get('/api/v1/copytrade/positions')
        .query(buildSignedQuery('address', 'test-addr-123'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('positions');
    });
  });

  describe('GET /api/v1/copytrade/activity', () => {
    it('should return 400 without signed query', async () => {
      const res = await request(app).get('/api/v1/copytrade/activity');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should accept signed address filter', async () => {
      const res = await request(app)
        .get('/api/v1/copytrade/activity')
        .query(buildSignedQuery('address', 'test-addr-123'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activity');
    });
  });

  describe('GET /api/v1/copytrade/vaults/:leaderId', () => {
    it('should return 404 when vault not found', async () => {
      const res = await request(app).get(
        '/api/v1/copytrade/vaults/nonexistent-leader',
      );

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/copytrade/vaults/:leaderId/executions', () => {
    it('should return executions list', async () => {
      const res = await request(app).get(
        '/api/v1/copytrade/vaults/leader-1/executions',
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('executions');
    });
  });

  describe('GET /api/v1/copytrade/vaults/:leaderId/signals/pending-wallet', () => {
    it('should return 401 without x-api-key', async () => {
      const res = await request(app).get(
        '/api/v1/copytrade/vaults/leader-1/signals/pending-wallet',
      );

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty(
        'error',
        'x-api-key header required for pending wallet signals',
      );
    });

    it('should return pending continuations with leader api key', async () => {
      const res = await request(app)
        .get('/api/v1/copytrade/vaults/leader-1/signals/pending-wallet')
        .set('x-api-key', 'leader-key-123')
        .query({ limit: 25 });

      expect(res.status).toBe(200);
      expect(mockedCopytradeService.validateLeaderApiKey).toHaveBeenCalledWith(
        'leader-1',
        'leader-key-123',
      );
      expect(
        mockedCopytradeService.listPendingWalletContinuations,
      ).toHaveBeenCalledWith('leader-1', 25);
    });
  });

  describe('POST /api/v1/copytrade/vaults/:leaderId/deposit', () => {
    it('should return 400 on invalid body', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/deposit')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 201 on valid deposit', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/deposit')
        .send({
          followerAddress: 'follower-addr-123',
          token: 'USDT',
          amount: '100',
          ...buildSignedBody({}),
        });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/v1/copytrade/vaults/:leaderId/withdraw', () => {
    it('should return 400 on invalid body', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/withdraw')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 200 on valid withdrawal', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/withdraw')
        .send({
          followerAddress: 'follower-addr-123',
          shares: '50',
          ...buildSignedBody({}),
        });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/copytrade/vaults/:leaderId/signals', () => {
    it('should return 400 on invalid signal', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/signals')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 401 for API source without x-api-key', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/signals')
        .send({
          pairSymbol: 'LUNES/USDT',
          side: 'BUY',
          source: 'API',
          amountIn: '100',
          amountOutMin: '90',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty(
        'error',
        'x-api-key header required for API signals',
      );
    });

    it('should return 201 for signed WEB3 source signal', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/signals')
        .send({
          leaderAddress: 'leader-wallet-123',
          pairSymbol: 'LUNES/USDT',
          side: 'BUY',
          positionEffect: 'OPEN',
          source: 'WEB3',
          amountIn: '100',
          amountOutMin: '90',
          ...buildSignedBody({}),
        });

      expect(res.status).toBe(201);
    });

    it('should accept explicit positionEffect for API signals', async () => {
      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/signals')
        .set('x-api-key', 'leader-key-123')
        .send({
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          positionEffect: 'CLOSE',
          signalMode: 'EXECUTE_VAULT',
          source: 'API',
          amountIn: '100',
          amountOutMin: '90',
        });

      expect(res.status).toBe(201);
      expect(mockedCopytradeService.createSignal).toHaveBeenCalledWith(
        'leader-1',
        expect.objectContaining({
          signalMode: 'EXECUTE_VAULT',
          positionEffect: 'CLOSE',
        }),
      );
    });

    it('should return 409 when CLOSE is requested without an open trade to close', async () => {
      mockedCopytradeService.createSignal.mockRejectedValueOnce(
        new Error('No matching open leader trade to close'),
      );

      const res = await request(app)
        .post('/api/v1/copytrade/vaults/leader-1/signals')
        .set('x-api-key', 'leader-key-123')
        .send({
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          positionEffect: 'CLOSE',
          source: 'API',
          amountIn: '100',
          amountOutMin: '90',
        });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty(
        'error',
        'No matching open leader trade to close',
      );
    });
  });

  describe('POST /api/v1/copytrade/vaults/:leaderId/signals/:signalId/wallet-confirmation', () => {
    it('should return 400 on invalid payload', async () => {
      const res = await request(app)
        .post(
          '/api/v1/copytrade/vaults/leader-1/signals/signal-1/wallet-confirmation',
        )
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 200 on valid signed confirmation', async () => {
      const res = await request(app)
        .post(
          '/api/v1/copytrade/vaults/leader-1/signals/signal-1/wallet-confirmation',
        )
        .send({
          leaderAddress: 'leader-wallet-123',
          txHash: '0x1234567890abcdef',
          ...buildSignedBody({}),
        });

      expect(res.status).toBe(200);
      expect(
        mockedCopytradeService.confirmWalletSignalContinuation,
      ).toHaveBeenCalledWith(
        'leader-1',
        'signal-1',
        expect.objectContaining({
          leaderAddress: 'leader-wallet-123',
          txHash: '0x1234567890abcdef',
        }),
      );
    });
  });

  describe('GET /api/v1/copytrade/leaders/:leaderId/api-key/challenge', () => {
    it('should return 400 without leaderAddress', async () => {
      const res = await request(app).get(
        '/api/v1/copytrade/leaders/leader-1/api-key/challenge',
      );

      expect(res.status).toBe(400);
    });

    it('should return challenge with valid params', async () => {
      const res = await request(app).get(
        '/api/v1/copytrade/leaders/leader-1/api-key/challenge?leaderAddress=leader-addr',
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('challengeId');
    });
  });
});
