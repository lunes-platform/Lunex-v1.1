import { NextFunction, Request, Response, Router } from 'express'
import { copytradeService } from '../services/copytradeService'
import { verifyWalletActionSignature } from '../middleware/auth'
import {
  CopyTradeApiKeyChallengeSchema,
  CopyTradeApiKeySchema,
  CopyTradeActivityQuerySchema,
  CopyTradeSignalSchema,
  CopyVaultDepositSchema,
  CopyVaultWithdrawSchema,
  PaginationSchema,
} from '../utils/validation'

const router = Router()

// ─── Read endpoints ───────────────────────────────────────────────

router.get('/leaders/:leaderId/api-key/challenge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyTradeApiKeyChallengeSchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const result = await copytradeService.createApiKeyChallenge(req.params.leaderId, parsed.data)
    res.json(result)
  } catch (err) { next(err) }
})

router.get('/vaults', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const vaults = await copytradeService.listVaults()
    res.json({ vaults })
  } catch (err) { next(err) }
})

router.get('/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.query
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' })
    }
    const positions = await copytradeService.getUserPositions(address)
    res.json({ positions })
  } catch (err) { next(err) }
})

router.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyTradeActivityQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const activity = await copytradeService.getActivity(parsed.data.address, parsed.data.limit)
    res.json({ activity })
  } catch (err) { next(err) }
})

router.get('/vaults/:leaderId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vault = await copytradeService.getVaultByLeader(req.params.leaderId)
    res.json({ vault })
  } catch (err) { next(err) }
})

router.get('/vaults/:leaderId/executions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = PaginationSchema.safeParse(req.query)
    const limit = pagination.success ? pagination.data.limit : 50
    const executions = await copytradeService.getVaultExecutions(req.params.leaderId, limit)
    res.json({ executions })
  } catch (err) { next(err) }
})

// ─── Mutations (signed) ──────────────────────────────────────────

router.post('/leaders/:leaderId/api-key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyTradeApiKeySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const result = await copytradeService.createOrRotateApiKey(req.params.leaderId, parsed.data)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

router.post('/vaults/:leaderId/deposit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyVaultDepositSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const auth = await verifyWalletActionSignature({
      action: 'copytrade.deposit',
      address: parsed.data.followerAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: { leaderId: req.params.leaderId, token: parsed.data.token, amount: parsed.data.amount },
    })
    if (!auth.ok) return res.status(401).json({ error: auth.error })

    const result = await copytradeService.depositToVault(req.params.leaderId, parsed.data)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

router.post('/vaults/:leaderId/withdraw', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyVaultWithdrawSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const auth = await verifyWalletActionSignature({
      action: 'copytrade.withdraw',
      address: parsed.data.followerAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: { leaderId: req.params.leaderId, shares: parsed.data.shares },
    })
    if (!auth.ok) return res.status(401).json({ error: auth.error })

    const result = await copytradeService.withdrawFromVault(req.params.leaderId, parsed.data)
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/vaults/:leaderId/signals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CopyTradeSignalSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }

    if (parsed.data.source === 'API') {
      const apiKey = req.header('x-api-key')
      if (!apiKey) return res.status(401).json({ error: 'x-api-key header required for API signals' })
      await copytradeService.validateLeaderApiKey(req.params.leaderId, apiKey)
    } else {
      if (!parsed.data.leaderAddress || !parsed.data.signature || !parsed.data.nonce || !parsed.data.timestamp) {
        return res.status(401).json({ error: 'WEB3 signals require leaderAddress, nonce, timestamp, and signature' })
      }
      const auth = await verifyWalletActionSignature({
        action: 'copytrade.web3-signal',
        address: parsed.data.leaderAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          leaderId: req.params.leaderId,
          pairSymbol: parsed.data.pairSymbol,
          side: parsed.data.side,
          source: parsed.data.source,
          strategyTag: parsed.data.strategyTag || '',
          amountIn: parsed.data.amountIn,
          amountOutMin: parsed.data.amountOutMin,
          route: parsed.data.route || [],
          maxSlippageBps: parsed.data.maxSlippageBps,
          executionPrice: parsed.data.executionPrice || '',
          realizedPnlPct: parsed.data.realizedPnlPct || '',
        },
      })
      if (!auth.ok) return res.status(401).json({ error: auth.error })
    }

    const result = await copytradeService.createSignal(req.params.leaderId, parsed.data)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

export default router
