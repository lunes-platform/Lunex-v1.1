"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../db', () => ({
    __esModule: true,
    default: {
        leader: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            upsert: jest.fn(),
        },
        socialIdea: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        socialIdeaLike: {
            create: jest.fn(),
            delete: jest.fn(),
        },
        socialIdeaComment: {
            create: jest.fn(),
        },
        leaderFollow: {
            create: jest.fn(),
            delete: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        copyVault: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        leaderTrade: {
            count: jest.fn().mockResolvedValue(0),
        },
    },
}));
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
        upsertLeaderProfile: jest.fn().mockResolvedValue({
            id: 'leader-1',
            name: 'Test Leader',
            username: 'testleader',
        }),
        getLeaderProfile: jest.fn().mockResolvedValue(null),
        followLeader: jest.fn().mockResolvedValue({ success: true }),
        unfollowLeader: jest.fn().mockResolvedValue({ success: true }),
    },
}));
describe('Social API E2E', () => {
    describe('GET /api/v1/social/stats', () => {
        it('should return social stats', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/stats');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('stats');
            expect(res.body.stats).toHaveProperty('totalLeaders');
            expect(res.body.stats).toHaveProperty('totalIdeas');
        });
    });
    describe('GET /api/v1/social/leaders', () => {
        it('should return leaders list with default params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/leaders');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('leaders');
            expect(Array.isArray(res.body.leaders)).toBe(true);
        });
        it('should accept filter params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/leaders?tab=bots&sortBy=winRate&limit=10');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('leaders');
        });
    });
    describe('GET /api/v1/social/leaderboard', () => {
        it('should return leaderboard', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/leaderboard');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('leaderboard');
        });
    });
    describe('GET /api/v1/social/ideas', () => {
        it('should return ideas list', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/ideas');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('ideas');
            expect(Array.isArray(res.body.ideas)).toBe(true);
        });
    });
    describe('POST /api/v1/social/ideas/:ideaId/like', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/ideas/idea-1/like')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
        it('should return 200 on valid like', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/ideas/idea-1/like')
                .send({ address: 'test-address-123' });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
        });
    });
    describe('POST /api/v1/social/ideas/:ideaId/comments', () => {
        it('should return 400 on missing content', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/ideas/idea-1/comments')
                .send({ address: 'test-addr' });
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid comment', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/ideas/idea-1/comments')
                .send({ address: 'test-addr-123', content: 'Great idea!' });
            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('comment');
        });
    });
    describe('GET /api/v1/social/following', () => {
        it('should return 400 without address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/following');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'address required');
        });
        it('should return 200 with address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/social/following?address=test-addr');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('leaders');
        });
    });
    describe('POST /api/v1/social/leaders/profile', () => {
        it('should return 400 on invalid profile data', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/leaders/profile')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid profile', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/leaders/profile')
                .send({
                address: 'test-address-123',
                name: 'Test Leader',
                username: 'testleader',
                bio: 'A great trader',
                fee: 15,
            });
            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('leader');
        });
    });
    describe('POST /api/v1/social/leaders/:leaderId/follow', () => {
        it('should return 400 on missing address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/leaders/leader-1/follow')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 200 on valid follow', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/social/leaders/leader-1/follow')
                .send({ address: 'follower-addr-123' });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
        });
    });
    describe('DELETE /api/v1/social/leaders/:leaderId/follow', () => {
        it('should return 400 without address query', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .delete('/api/v1/social/leaders/leader-1/follow');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'address required');
        });
        it('should return 200 on valid unfollow', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .delete('/api/v1/social/leaders/leader-1/follow?address=follower-addr');
            expect(res.status).toBe(200);
        });
    });
});
//# sourceMappingURL=social.e2e.test.js.map