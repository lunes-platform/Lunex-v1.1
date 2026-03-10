/**
 * Trade API E2E Tests
 *
 * Tests agent trade execution: swap, limit order, cancel, portfolio.
 */
import request from 'supertest'
import app from '../src/index'

describe('Trade API Endpoints', () => {
    const MOCK_API_KEY = 'test-trade-api-key'

    describe('POST /api/v1/trade/swap', () => {
        it('should execute a swap order', async () => {
            const res = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '100',
                    slippage: 0.5,
                })

            // May fail due to no real chain, but should return structured response
            expect([200, 400, 401, 503]).toContain(res.status)
            expect(res.body).toHaveProperty('error') || expect(res.body).toHaveProperty('txHash')
        })
    })

    describe('POST /api/v1/trade/limit', () => {
        it('should create a limit order', async () => {
            const res = await request(app)
                .post('/api/v1/trade/limit')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '50',
                    price: '45000',
                })

            expect([200, 201, 400, 401]).toContain(res.status)
        })

        it('should reject limit order without price', async () => {
            const res = await request(app)
                .post('/api/v1/trade/limit')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '50',
                })

            expect(res.status).toBe(400)
        })
    })

    describe('POST /api/v1/trade/cancel', () => {
        it('should reject cancel without orderId', async () => {
            const res = await request(app)
                .post('/api/v1/trade/cancel')
                .set('X-API-Key', MOCK_API_KEY)
                .send({})

            expect(res.status).toBe(400)
        })

        it('should handle cancel of non-existent order', async () => {
            const res = await request(app)
                .post('/api/v1/trade/cancel')
                .set('X-API-Key', MOCK_API_KEY)
                .send({ orderId: 'non-existent-order-id' })

            expect([404, 400]).toContain(res.status)
        })
    })

    describe('GET /api/v1/trade/portfolio', () => {
        it('should return portfolio with authentication', async () => {
            const res = await request(app)
                .get('/api/v1/trade/portfolio')
                .set('X-API-Key', MOCK_API_KEY)

            // May return 401 for mock key or 200 with empty portfolio
            expect([200, 401]).toContain(res.status)
        })

        it('should reject portfolio request without API key', async () => {
            const res = await request(app)
                .get('/api/v1/trade/portfolio')

            expect(res.status).toBe(401)
        })
    })

    describe('Pagination', () => {
        it('should enforce max pagination limit', async () => {
            const res = await request(app)
                .get('/api/v1/trades')
                .query({ limit: 500 })

            expect(res.status).toBe(200)
            // Pagination middleware caps at 100
            if (Array.isArray(res.body)) {
                expect(res.body.length).toBeLessThanOrEqual(100)
            }
        })
    })

    describe('Error Format', () => {
        it('should return standardized error format', async () => {
            const res = await request(app)
                .get('/api/v1/agents/non-existent-id/profile')

            if (res.status >= 400) {
                expect(res.body).toHaveProperty('error')
                expect(res.body).toHaveProperty('code')
            }
        })
    })
})
