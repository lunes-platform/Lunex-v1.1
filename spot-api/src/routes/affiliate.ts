import { NextFunction, Router, Request, Response } from 'express'
import { affiliateService } from '../services/affiliateService'
import { z } from 'zod'

const router = Router()

const RegisterReferralSchema = z.object({
    refereeAddress: z.string().min(3),
    referralCode: z.string().min(4).max(16),
})

const AddressQuerySchema = z.object({
    address: z.string().min(3),
})

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = RegisterReferralSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const referral = await affiliateService.registerReferral(
            parsed.data.refereeAddress,
            parsed.data.referralCode,
        )
        res.status(201).json({ referral })
    } catch (err) { next(err) }
})

router.get('/code', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query)
        if (!parsed.success) return res.status(400).json({ error: 'address required' })
        const code = await affiliateService.getOrCreateReferralCode(parsed.data.address)
        res.json({ code, link: `https://lunex.io/?ref=${code}` })
    } catch (err) { next(err) }
})

router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query)
        if (!parsed.success) return res.status(400).json({ error: 'address required' })
        const dashboard = await affiliateService.getDashboard(parsed.data.address)
        res.json({ dashboard })
    } catch (err) { next(err) }
})

router.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query)
        if (!parsed.success) return res.status(400).json({ error: 'address required' })
        const depth = Math.min(parseInt(req.query.depth as string) || 3, 5)
        const tree = await affiliateService.getReferralTree(parsed.data.address, depth)
        res.json({ tree })
    } catch (err) { next(err) }
})

router.get('/payouts', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = AddressQuerySchema.safeParse(req.query)
        if (!parsed.success) return res.status(400).json({ error: 'address required' })
        const limit = req.pagination?.limit ?? Math.min(parseInt(req.query.limit as string) || 20, 100)
        const payouts = await affiliateService.getPayoutHistory(parsed.data.address, limit)
        res.json({ payouts })
    } catch (err) { next(err) }
})

router.post('/payout/process', async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await affiliateService.processPayoutBatch()
        res.json(result)
    } catch (err) { next(err) }
})

export default router
