"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../middleware/auth', () => ({
    ...jest.requireActual('../../middleware/auth'),
    verifyWalletActionSignature: jest.fn().mockResolvedValue({ ok: true, message: 'signed-message' }),
}));
const signedBody = {
    nonce: '1700000000001',
    timestamp: 1700000000001,
    signature: 'signed-payload',
};
jest.mock('../../services/copytradeService', () => ({
    copytradeService: {
        createApiKeyChallenge: jest.fn().mockResolvedValue({ challengeId: 'ch-1', message: 'challenge' }),
        listVaults: jest.fn().mockResolvedValue([]),
        getUserPositions: jest.fn().mockResolvedValue([]),
        getActivity: jest.fn().mockResolvedValue([]),
        getVaultByLeader: jest.fn().mockRejectedValue(new Error('Vault not found')),
        getVaultExecutions: jest.fn().mockResolvedValue([]),
        createOrRotateApiKey: jest.fn().mockResolvedValue({ apiKey: 'key-123' }),
        depositToVault: jest.fn().mockResolvedValue({ deposit: 'ok' }),
        withdrawFromVault: jest.fn().mockResolvedValue({ withdrawal: 'ok' }),
        createSignal: jest.fn().mockResolvedValue({ signal: 'ok' }),
        validateLeaderApiKey: jest.fn().mockResolvedValue(true),
    },
}));
describe('Copytrade API E2E', () => {
    describe('GET /api/v1/copytrade/vaults', () => {
        it('should return empty vaults list', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/vaults');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('vaults');
            expect(Array.isArray(res.body.vaults)).toBe(true);
        });
    });
    describe('GET /api/v1/copytrade/positions', () => {
        it('should return 400 without address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/positions');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'address required');
        });
        it('should return 200 with valid address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/positions?address=test-addr');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('positions');
        });
    });
    describe('GET /api/v1/copytrade/activity', () => {
        it('should return 200 with default params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/activity');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('activity');
        });
        it('should accept address filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/activity?address=test-addr');
            expect(res.status).toBe(200);
        });
    });
    describe('GET /api/v1/copytrade/vaults/:leaderId', () => {
        it('should return 404 when vault not found', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/vaults/nonexistent-leader');
            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty('error');
        });
    });
    describe('GET /api/v1/copytrade/vaults/:leaderId/executions', () => {
        it('should return executions list', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/vaults/leader-1/executions');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('executions');
        });
    });
    describe('POST /api/v1/copytrade/vaults/:leaderId/deposit', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/deposit')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid deposit', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/deposit')
                .send({
                followerAddress: 'follower-addr-123',
                token: 'USDT',
                amount: '100',
                ...signedBody,
            });
            expect(res.status).toBe(201);
        });
    });
    describe('POST /api/v1/copytrade/vaults/:leaderId/withdraw', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/withdraw')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 200 on valid withdrawal', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/withdraw')
                .send({
                followerAddress: 'follower-addr-123',
                shares: '50',
                ...signedBody,
            });
            expect(res.status).toBe(200);
        });
    });
    describe('POST /api/v1/copytrade/vaults/:leaderId/signals', () => {
        it('should return 400 on invalid signal', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/signals')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 401 for API source without x-api-key', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/signals')
                .send({
                pairSymbol: 'LUNES/USDT',
                side: 'BUY',
                source: 'API',
                amountIn: '100',
                amountOutMin: '90',
            });
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('error', 'x-api-key header required for API signals');
        });
        it('should return 201 for signed WEB3 source signal', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/copytrade/vaults/leader-1/signals')
                .send({
                leaderAddress: 'leader-wallet-123',
                pairSymbol: 'LUNES/USDT',
                side: 'BUY',
                source: 'WEB3',
                amountIn: '100',
                amountOutMin: '90',
                ...signedBody,
            });
            expect(res.status).toBe(201);
        });
    });
    describe('GET /api/v1/copytrade/leaders/:leaderId/api-key/challenge', () => {
        it('should return 400 without leaderAddress', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/leaders/leader-1/api-key/challenge');
            expect(res.status).toBe(400);
        });
        it('should return challenge with valid params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/copytrade/leaders/leader-1/api-key/challenge?leaderAddress=leader-addr');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('challengeId');
        });
    });
});
//# sourceMappingURL=copytrade.e2e.test.js.map