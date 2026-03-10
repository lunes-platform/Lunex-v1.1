/**
 * Governance Vote Cooldown Tests (S3)
 *
 * Tests the server-side cooldown logic: 1h between votes per wallet+proposal pair.
 */
import request from 'supertest'
import app from '../src/index'
import prisma from '../src/db'

const TEST_WALLET = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'

describe('Governance Vote Cooldown', () => {
    beforeAll(async () => {
        // Clean up any leftover votes for this test wallet
        await prisma.governanceVote.deleteMany({ where: { walletAddress: TEST_WALLET } })
    })

    afterAll(async () => {
        await prisma.governanceVote.deleteMany({ where: { walletAddress: TEST_WALLET } })
        await prisma.$disconnect()
    })

    describe('POST /api/v1/governance/vote/check', () => {
        it('should allow vote when no prior vote exists', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/check')
                .send({ walletAddress: TEST_WALLET, proposalId: 1 })

            expect(res.status).toBe(200)
            expect(res.body.canVote).toBe(true)
            expect(res.body.lastVotedAt).toBeNull()
            expect(res.body.timeUntilNextVote).toBe(0)
        })

        it('should reject missing walletAddress', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/check')
                .send({ proposalId: 1 })

            expect(res.status).toBe(400)
        })

        it('should reject invalid proposalId', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/check')
                .send({ walletAddress: TEST_WALLET, proposalId: -1 })

            expect(res.status).toBe(400)
        })
    })

    describe('POST /api/v1/governance/vote/record', () => {
        it('should record a vote successfully', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/record')
                .send({
                    walletAddress: TEST_WALLET,
                    proposalId: 99,
                    voteType: 'YES',
                    txHash: '0xabc123',
                })

            expect(res.status).toBe(201)
            expect(res.body.vote).toHaveProperty('id')
            expect(res.body.vote.voteType).toBe('YES')
        })

        it('should enforce cooldown after voting', async () => {
            const checkRes = await request(app)
                .post('/api/v1/governance/vote/check')
                .send({ walletAddress: TEST_WALLET, proposalId: 99 })

            expect(checkRes.status).toBe(200)
            expect(checkRes.body.canVote).toBe(false)
            expect(checkRes.body.timeUntilNextVote).toBeGreaterThan(0)
        })

        it('should block second vote on same proposal within cooldown period', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/record')
                .send({
                    walletAddress: TEST_WALLET,
                    proposalId: 99,
                    voteType: 'NO',
                })

            expect(res.status).toBe(429)
            expect(res.body.code).toBe('VOTE_COOLDOWN')
        })

        it('should allow vote on a different proposal', async () => {
            const res = await request(app)
                .post('/api/v1/governance/vote/record')
                .send({
                    walletAddress: TEST_WALLET,
                    proposalId: 100,
                    voteType: 'NO',
                })

            expect(res.status).toBe(201)
        })
    })

    describe('GET /api/v1/governance/vote/history', () => {
        it('should return vote history for wallet', async () => {
            const res = await request(app)
                .get('/api/v1/governance/vote/history')
                .query({ walletAddress: TEST_WALLET })

            expect(res.status).toBe(200)
            expect(Array.isArray(res.body.votes)).toBe(true)
            expect(res.body.votes.length).toBeGreaterThanOrEqual(2)
        })

        it('should reject missing walletAddress', async () => {
            const res = await request(app)
                .get('/api/v1/governance/vote/history')

            expect(res.status).toBe(400)
        })
    })
})
