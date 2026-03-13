import { NextFunction, Router, Request, Response } from 'express'
import { orderService } from '../services/orderService'
import { CreateOrderSchema, CancelOrderSchema, PaginationSchema } from '../utils/validation'
import {
  buildSpotCancelMessage,
  buildSpotOrderMessage,
  verifyAddressSignature,
  isNonceUsed,
  markNonceUsed,
} from '../middleware/auth'

const SIGNED_ORDER_TTL_MS = 5 * 60 * 1000

const router = Router()

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }

    // Validate timestamp freshness
    if (Math.abs(Date.now() - parsed.data.timestamp) > SIGNED_ORDER_TTL_MS) {
      return res.status(401).json({ error: 'Expired order signature' })
    }

    // Prevent nonce replay
    const nonceKey = `nonce:spot-order:${parsed.data.makerAddress}:${parsed.data.nonce}`
    if (await isNonceUsed(nonceKey)) {
      return res.status(401).json({ error: 'Order nonce already used' })
    }

    const isValid = await verifyAddressSignature(
      buildSpotOrderMessage({
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        type: parsed.data.type,
        price: parsed.data.price,
        stopPrice: parsed.data.stopPrice,
        amount: parsed.data.amount,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
      }),
      parsed.data.signature,
      parsed.data.makerAddress,
    )
    if (!isValid) return res.status(401).json({ error: 'Invalid signature' })

    await markNonceUsed(nonceKey)

    const order = await orderService.createOrder(parsed.data)
    res.status(201).json({ order })
  } catch (err) { next(err) }
})

// ─── Anti-Spoofing: cancel rate limiter (max 20 cancels/min per address) ─────
const CANCEL_RATE_WINDOW_MS = 60_000
const CANCEL_RATE_MAX = 20
const cancelTimestamps = new Map<string, number[]>()

function isCancelRateLimited(address: string): boolean {
  const now = Date.now()
  const timestamps = cancelTimestamps.get(address) ?? []
  const recent = timestamps.filter(ts => now - ts < CANCEL_RATE_WINDOW_MS)

  if (recent.length >= CANCEL_RATE_MAX) {
    cancelTimestamps.set(address, recent)
    return true
  }

  recent.push(now)
  cancelTimestamps.set(address, recent)
  return false
}

// Periodic cleanup to prevent memory leak (every 5 min)
setInterval(() => {
  const now = Date.now()
  for (const [addr, timestamps] of cancelTimestamps.entries()) {
    const recent = timestamps.filter(ts => now - ts < CANCEL_RATE_WINDOW_MS)
    if (recent.length === 0) cancelTimestamps.delete(addr)
    else cancelTimestamps.set(addr, recent)
  }
}, 5 * 60_000)

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CancelOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }

    // Anti-spoofing: rate limit cancellations
    if (isCancelRateLimited(parsed.data.makerAddress)) {
      return res.status(429).json({ error: 'Too many cancellations. Max 20 per minute.' })
    }

    const isValid = await verifyAddressSignature(
      buildSpotCancelMessage(req.params.id),
      parsed.data.signature,
      parsed.data.makerAddress,
    )
    if (!isValid) return res.status(401).json({ error: 'Invalid signature' })

    const order = await orderService.cancelOrder(req.params.id, parsed.data.makerAddress)
    res.json({ order })
  } catch (err) { next(err) }
})

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { makerAddress, status } = req.query
    if (!makerAddress || typeof makerAddress !== 'string') {
      return res.status(400).json({ error: 'makerAddress required' })
    }

    const pagination = PaginationSchema.safeParse(req.query)
    const limit = pagination.success ? pagination.data.limit : 50
    const offset = pagination.success ? pagination.data.offset : 0

    const orders = await orderService.getUserOrders(
      makerAddress,
      typeof status === 'string' ? status : undefined,
      limit,
      offset,
    )
    res.json({ orders })
  } catch (err) { next(err) }
})

export default router
