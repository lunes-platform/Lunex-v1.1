import prisma from '../db';
import { decimalToNumber } from '../utils/helpers';
import { orderbookManager } from '../utils/orderbook';

const RESTING_ORDER_TYPES = ['LIMIT', 'STOP_LIMIT'] as const;
const RESTING_ORDER_STATUSES = ['OPEN', 'PARTIAL'] as const;

function restoreOrderIntoBook(
  book: ReturnType<typeof orderbookManager.getOrCreate>,
  order: {
    id: string;
    side: string;
    price: unknown;
    amount: unknown;
    remainingAmount: unknown;
    makerAddress: string;
    createdAt: Date;
  },
) {
  const remainingAmount = decimalToNumber(order.remainingAmount);
  const totalAmount = decimalToNumber(order.amount);
  const price = decimalToNumber(order.price);

  if (remainingAmount <= 0 || totalAmount <= 0 || price <= 0) {
    return false;
  }

  book.restoreLimitOrder(
    order.id,
    order.side as 'BUY' | 'SELL',
    price,
    totalAmount,
    remainingAmount,
    order.makerAddress,
    order.createdAt.getTime(),
  );
  return true;
}

export async function rehydrateOrderbooks() {
  orderbookManager.clearAll();

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
  });

  let restoredOrders = 0;

  for (const order of openOrders) {
    if (!order.pair) {
      continue;
    }

    const book = orderbookManager.getOrCreate(order.pair.symbol);
    if (restoreOrderIntoBook(book, order)) {
      restoredOrders += 1;
    }
  }

  return {
    restoredOrders,
    restoredBooks: orderbookManager.getAll().size,
  };
}

export async function rehydrateOrderbookForPair(
  pairId: string,
  pairSymbol: string,
) {
  const book = orderbookManager.getOrCreate(pairSymbol);
  book.clear();

  const openOrders = await prisma.order.findMany({
    where: {
      pairId,
      type: { in: [...RESTING_ORDER_TYPES] },
      status: { in: [...RESTING_ORDER_STATUSES] },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  let restoredOrders = 0;
  for (const order of openOrders) {
    if (restoreOrderIntoBook(book, order)) {
      restoredOrders += 1;
    }
  }

  return {
    restoredOrders,
    pairSymbol,
  };
}
