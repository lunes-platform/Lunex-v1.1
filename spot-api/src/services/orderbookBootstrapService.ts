import prisma from '../db'
import { decimalToNumber } from '../utils/helpers'
import { orderbookManager } from '../utils/orderbook'

const RESTING_ORDER_TYPES = ['LIMIT', 'STOP_LIMIT'] as const
const RESTING_ORDER_STATUSES = ['OPEN', 'PARTIAL'] as const

export async function rehydrateOrderbooks() {
  orderbookManager.clearAll()

  const openOrders = await prisma.order.findMany({
    where: {
      type: { in: [...RESTING_ORDER_TYPES] },
      status: { in: [...RESTING_ORDER_STATUSES] },
    },
    include: {
      pair: {
        select: {
          symbol: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  let restoredOrders = 0

  for (const order of openOrders) {
    const remainingAmount = decimalToNumber(order.remainingAmount)
    const totalAmount = decimalToNumber(order.amount)
    const price = decimalToNumber(order.price)

    if (!order.pair || remainingAmount <= 0 || totalAmount <= 0 || price <= 0) {
      continue
    }

    const book = orderbookManager.getOrCreate(order.pair.symbol)
    book.restoreLimitOrder(
      order.id,
      order.side as 'BUY' | 'SELL',
      price,
      totalAmount,
      remainingAmount,
      order.makerAddress,
      order.createdAt.getTime(),
    )
    restoredOrders += 1
  }

  return {
    restoredOrders,
    restoredBooks: orderbookManager.getAll().size,
  }
}
