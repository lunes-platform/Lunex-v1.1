/**
 * Agent Registration E2E Tests
 *
 * Flow: register agent → generate API key → execute trade → verify recorded
 */
import request from 'supertest'
import app from '../src/index'
import prisma from '../src/db'

const TEST_WALLET = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

describe('Agent Registration Flow', () => {
    let agentId: string
    let apiKey: string
    let apiKeyHash: string

    afterAll(async () => {
        // Cleanup test data
        if (agentId) {
            await prisma.agentApiKey.deleteMany({ where: { agentId } })
            await prisma.agent.deleteMany({ where: { id: agentId } })
        }
        await prisma.$disconnect()
    })

    describe('POST /api/v1/agents/register', () => {
        it('should register a new agent', async () => {
            const res = await request(app)
                .post('/api/v1/agents/register')
                .send({
                    name: 'TestBot-E2E',
                    walletAddress: TEST_WALLET,
                    type: 'BOT',
                    strategy: 'Grid trading on BTC/USDT',
                })

            expect(res.status).toBe(201)
            expect(res.body).toHaveProperty('id')
            expect(res.body).toHaveProperty('name', 'TestBot-E2E')
            expect(res.body).toHaveProperty('tier', 0)
            agentId = res.body.id
        })

        it('should reject duplicate wallet registration', async () => {
            const res = await request(app)
                .post('/api/v1/agents/register')
                .send({
                    name: 'TestBot-Duplicate',
                    walletAddress: TEST_WALLET,
                    type: 'BOT',
                })

            expect(res.status).toBe(409)
            expect(res.body).toHaveProperty('code')
        })
    })

    describe('POST /api/v1/agents/:id/api-keys', () => {
        it('should generate an API key for the agent', async () => {
            const res = await request(app)
                .post(`/api/v1/agents/${agentId}/api-keys`)
                .send({ walletAddress: TEST_WALLET })

            expect(res.status).toBe(201)
            expect(res.body).toHaveProperty('apiKey')
            expect(res.body.apiKey).toHaveLength(64) // SHA-256 hex
            apiKey = res.body.apiKey
        })
    })

    describe('GET /api/v1/agents/:id/profile', () => {
        it('should return agent profile', async () => {
            const res = await request(app)
                .get(`/api/v1/agents/${agentId}/profile`)

            expect(res.status).toBe(200)
            expect(res.body).toHaveProperty('name', 'TestBot-E2E')
            expect(res.body).toHaveProperty('tier', 0)
            expect(res.body).toHaveProperty('totalTrades', 0)
        })
    })

    describe('GET /api/v1/agents/leaderboard', () => {
        it('should return agent leaderboard with pagination', async () => {
            const res = await request(app)
                .get('/api/v1/agents/leaderboard')
                .query({ limit: 10, page: 1 })

            expect(res.status).toBe(200)
            expect(Array.isArray(res.body)).toBe(true)
        })
    })
})
