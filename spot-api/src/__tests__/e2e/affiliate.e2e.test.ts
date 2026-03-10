import request from 'supertest'
import app from './testApp'

jest.mock('../../db', () => ({
    __esModule: true,
    default: {
        referral: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation((args: any) => Promise.resolve({
                id: 'ref-1',
                ...args.data,
            })),
            count: jest.fn().mockResolvedValue(0),
        },
        affiliateCommission: {
            groupBy: jest.fn().mockResolvedValue([]),
            aggregate: jest.fn().mockResolvedValue({
                _sum: { commissionAmount: null },
                _count: 0,
            }),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
        },
        affiliatePayoutBatch: {
            create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
            update: jest.fn(),
        },
    },
}))

describe('Affiliate API E2E', () => {
    describe('POST /api/v1/affiliate/register', () => {
        it('should return 400 on invalid body', async () => {
            const res = await request(app)
                .post('/api/v1/affiliate/register')
                .send({})

            expect(res.status).toBe(400)
            expect(res.body).toHaveProperty('error')
        })

        it('should return 400 on short referral code', async () => {
            const res = await request(app)
                .post('/api/v1/affiliate/register')
                .send({ refereeAddress: 'test-addr', referralCode: 'AB' })

            expect(res.status).toBe(400)
        })

        it('should return 201 on valid registration', async () => {
            const res = await request(app)
                .post('/api/v1/affiliate/register')
                .send({ refereeAddress: 'new-user-addr', referralCode: 'ABCD1234' })

            expect(res.status).toBe(201)
            expect(res.body).toHaveProperty('referral')
            expect(res.body.referral).toHaveProperty('refereeAddress', 'new-user-addr')
        })
    })

    describe('GET /api/v1/affiliate/code', () => {
        it('should return 400 without address', async () => {
            const res = await request(app).get('/api/v1/affiliate/code')

            expect(res.status).toBe(400)
            expect(res.body).toHaveProperty('error', 'address required')
        })

        it('should return code and link with valid address', async () => {
            const res = await request(app).get('/api/v1/affiliate/code?address=test-addr-123')

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('code')
            expect(res.body).toHaveProperty('link')
            expect(res.body.code.length).toBe(8)
            expect(res.body.link).toContain('ref=')
        })
    })

    describe('GET /api/v1/affiliate/dashboard', () => {
        it('should return 400 without address', async () => {
            const res = await request(app).get('/api/v1/affiliate/dashboard')

            expect(res.status).toBe(400)
            expect(res.body).toHaveProperty('error', 'address required')
        })

        it('should return dashboard data with valid address', async () => {
            const res = await request(app).get('/api/v1/affiliate/dashboard?address=test-addr')

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('dashboard')
            expect(res.body.dashboard).toHaveProperty('referralCode')
            expect(res.body.dashboard).toHaveProperty('directReferrals')
            expect(res.body.dashboard).toHaveProperty('earningsByLevel')
            expect(res.body.dashboard).toHaveProperty('totalUnpaid')
            expect(res.body.dashboard).toHaveProperty('totalPaid')
            expect(res.body.dashboard).toHaveProperty('levels')
            expect(res.body.dashboard.levels).toHaveLength(5)
        })
    })

    describe('GET /api/v1/affiliate/tree', () => {
        it('should return 400 without address', async () => {
            const res = await request(app).get('/api/v1/affiliate/tree')

            expect(res.status).toBe(400)
            expect(res.body).toHaveProperty('error', 'address required')
        })

        it('should return empty tree for address without referrals', async () => {
            const res = await request(app).get('/api/v1/affiliate/tree?address=test-addr')

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('tree')
            expect(Array.isArray(res.body.tree)).toBe(true)
        })
    })

    describe('GET /api/v1/affiliate/payouts', () => {
        it('should return 400 without address', async () => {
            const res = await request(app).get('/api/v1/affiliate/payouts')

            expect(res.status).toBe(400)
        })

        it('should return empty payouts list', async () => {
            const res = await request(app).get('/api/v1/affiliate/payouts?address=test-addr')

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('payouts')
            expect(Array.isArray(res.body.payouts)).toBe(true)
        })
    })

    describe('POST /api/v1/affiliate/payout/process', () => {
        it('should process payout batch', async () => {
            const res = await request(app).post('/api/v1/affiliate/payout/process')

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('batchId')
            expect(res.body).toHaveProperty('processed')
        })
    })
})
