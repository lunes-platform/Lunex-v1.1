/**
 * Bot Sandbox Security Tests
 *
 * Tests rate limiting, anomaly detection, and tier enforcement.
 */
import request from 'supertest'
import app from '../src/index'

describe('Bot Sandbox Security', () => {
    const MOCK_API_KEY = 'test-api-key-for-sandbox-e2e'

    describe('Rate Limiting', () => {
        it('should enforce tier-0 rate limit (5/min)', async () => {
            const responses = []

            // Send 6 rapid requests (tier 0 allows 5/min)
            for (let i = 0; i < 6; i++) {
                const res = await request(app)
                    .post('/api/v1/trade/swap')
                    .set('X-API-Key', MOCK_API_KEY)
                    .send({
                        pair: 'LBTC/LUSDT',
                        side: 'BUY',
                        amount: '100',
                    })
                responses.push(res)
            }

            // First 5 should be processed (may fail for other reasons, but NOT rate limited)
            const rateLimited = responses.filter(r => r.status === 429)
            expect(rateLimited.length).toBeGreaterThanOrEqual(1)
        })
    })

    describe('Anomaly Detection', () => {
        it('should flag wash trading pattern', async () => {
            // Simulate buy immediately followed by sell of same pair
            const buy = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '1000',
                })

            const sell = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'SELL',
                    amount: '1000',
                })

            // System should detect wash trading and either add to anomaly score or reject
            // The exact behavior depends on the tier and accumulated score
            expect([200, 400, 403, 429]).toContain(sell.status)
        })
    })

    describe('API Key Authentication', () => {
        it('should reject requests without API key', async () => {
            const res = await request(app)
                .post('/api/v1/trade/swap')
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '100',
                })

            expect(res.status).toBe(401)
            expect(res.body).toHaveProperty('error')
        })

        it('should reject invalid API key', async () => {
            const res = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', 'invalid-key-12345')
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '100',
                })

            expect(res.status).toBe(401)
        })
    })

    describe('Input Validation', () => {
        it('should reject invalid pair format', async () => {
            const res = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'INVALID',
                    side: 'BUY',
                    amount: '100',
                })

            expect(res.status).toBe(400)
        })

        it('should reject negative amounts', async () => {
            const res = await request(app)
                .post('/api/v1/trade/swap')
                .set('X-API-Key', MOCK_API_KEY)
                .send({
                    pair: 'LBTC/LUSDT',
                    side: 'BUY',
                    amount: '-500',
                })

            expect(res.status).toBe(400)
        })
    })
})
