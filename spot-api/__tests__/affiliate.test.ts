/**
 * Affiliate Commission Logic Tests (S3)
 *
 * Tests: referral code generation, commission rate math, distributeCommissions chain.
 */
import { affiliateService } from '../src/services/affiliateService'
import prisma from '../src/db'

const REFERRER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const REFEREE = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'

describe('Affiliate Commission Logic', () => {
    beforeAll(async () => {
        await prisma.affiliateCommission.deleteMany({ where: { sourceAddr: REFEREE } })
        await prisma.referral.deleteMany({
            where: { OR: [{ refereeAddress: REFEREE }, { referrerAddress: REFERRER }] },
        })
    })

    afterAll(async () => {
        await prisma.affiliateCommission.deleteMany({ where: { sourceAddr: REFEREE } })
        await prisma.referral.deleteMany({
            where: { OR: [{ refereeAddress: REFEREE }, { referrerAddress: REFERRER }] },
        })
        await prisma.$disconnect()
    })

    describe('getOrCreateReferralCode', () => {
        it('should generate an 8-char uppercase code from an address', async () => {
            const code = await affiliateService.getOrCreateReferralCode(REFERRER)
            expect(code).toMatch(/^[A-F0-9]{8}$/)
        })

        it('should return the same code on repeated calls', async () => {
            const code1 = await affiliateService.getOrCreateReferralCode(REFERRER)
            const code2 = await affiliateService.getOrCreateReferralCode(REFERRER)
            expect(code1).toBe(code2)
        })
    })

    describe('registerReferral', () => {
        it('should register a new referral', async () => {
            const code = await affiliateService.getOrCreateReferralCode(REFERRER)
            const referral = await affiliateService.registerReferral(REFEREE, code)
            expect(referral.refereeAddress).toBe(REFEREE)
            expect(referral.referralCode).toBe(code)
            expect(referral.level).toBe(1)
        })

        it('should reject duplicate referral for same referee', async () => {
            const code = await affiliateService.getOrCreateReferralCode(REFERRER)
            await expect(affiliateService.registerReferral(REFEREE, code))
                .rejects.toThrow('already has a referrer')
        })
    })

    describe('distributeCommissions', () => {
        it('should distribute at 4% (400 bps) for level-1 affiliate on SPOT trade', async () => {
            const fee = 100 // 100 LUSDT fee
            const commissions = await affiliateService.distributeCommissions(
                REFEREE, 'LUSDT', fee, 'SPOT',
            )

            expect(commissions.length).toBe(1)
            // Level 1 = 400 bps = 4% of 100 = 4
            expect(parseFloat(commissions[0].commissionAmount.toString())).toBeCloseTo(4.0, 2)
        })

        it('should return empty array for zero fee', async () => {
            const commissions = await affiliateService.distributeCommissions(
                REFEREE, 'LUSDT', 0, 'SPOT',
            )
            expect(commissions).toHaveLength(0)
        })

        it('should return empty array for address with no referrer', async () => {
            const commissions = await affiliateService.distributeCommissions(
                '5NoReferrerAddress', 'LUSDT', 100, 'SPOT',
            )
            expect(commissions).toHaveLength(0)
        })
    })

    describe('getDashboard', () => {
        it('should return dashboard with correct structure', async () => {
            const dashboard = await affiliateService.getDashboard(REFERRER)
            expect(dashboard).toHaveProperty('referralCode')
            expect(dashboard).toHaveProperty('directReferrals')
            expect(dashboard).toHaveProperty('earningsByLevel')
            expect(dashboard).toHaveProperty('totalUnpaid')
            expect(dashboard).toHaveProperty('totalPaid')
            expect(typeof dashboard.totalUnpaid).toBe('number')
        })
    })

    describe('getReferralTree', () => {
        it('should return tree with correct shape', async () => {
            const tree = await affiliateService.getReferralTree(REFERRER, 2)
            expect(Array.isArray(tree)).toBe(true)
            if (tree.length > 0) {
                const node = tree[0] as { address: string; subReferrals: number; children: unknown[] }
                expect(node).toHaveProperty('address')
                expect(node).toHaveProperty('subReferrals')
                expect(Array.isArray(node.children)).toBe(true)
            }
        })
    })
})
