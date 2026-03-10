import { NextFunction, Router, Request, Response } from 'express'
import { orderService } from '../services/orderService'
import { CreateOrderSchema, CancelOrderSchema, PaginationSchema } from '../utils/validation'
import {
  buildSpotCancelMessage,
  buildSpotOrderMessage,
  verifyAddressSignature,
} from '../middleware/auth'

const router = Router()

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
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
      }),
      parsed.data.signature,
      parsed.data.makerAddress,
    )
    if (!isValid) return res.status(401).json({ error: 'Invalid signature' })

    const order = await orderService.createOrder(parsed.data)
    res.status(201).json({ order })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CancelOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
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
