/**
 * Balance Service — Lunex Spot Exchange
 *
 * Computes a wallet's spendable balance per token from the off-chain ledger
 * (`UserBalance`) combined with funds reserved by resting orders.
 *
 *   total     = UserBalance.available + UserBalance.locked   (scriptural ledger)
 *   locked    = Σ reserve of OPEN / PARTIAL / PENDING_TRIGGER orders for token
 *   available = total − locked
 *
 * `locked` is DERIVED from live orders (not read from the raw `UserBalance.locked`
 * column, which the matching engine does not keep in sync). This mirrors the
 * reservation logic the order lifecycle enforces: an OPEN order reserves balance
 * (lowering `available`); cancelling it releases the reservation.
 *
 *   - SELL order reserves `remainingAmount` of the pair's BASE token.
 *   - BUY  order reserves `price × remainingAmount` of the pair's QUOTE token.
 *
 * @module balanceService
 */
import prisma from '../db';
import { Decimal } from '@prisma/client/runtime/library';

const RESERVING_ORDER_STATUSES = ['OPEN', 'PARTIAL', 'PENDING_TRIGGER'] as const;

export type TokenBalance = {
  token: string;
  total: string;
  locked: string;
  available: string;
};

/**
 * Effective unit price used to reserve quote for a BUY order.
 * Falls back to stopPrice for STOP / STOP_LIMIT orders that have no limit price.
 */
function effectivePrice(order: {
  type: string;
  price: Decimal;
  stopPrice: Decimal | null;
}): Decimal {
  if (order.price.greaterThan(0)) {
    return order.price;
  }
  if (
    (order.type === 'STOP' || order.type === 'STOP_LIMIT') &&
    order.stopPrice
  ) {
    return order.stopPrice;
  }
  return new Decimal(0);
}

/**
 * Sum the per-token reservation contributed by a wallet's resting orders.
 * Returns a map of token → locked Decimal.
 */
async function computeLockedByToken(
  address: string,
  token?: string,
): Promise<Map<string, Decimal>> {
  const orders = await prisma.order.findMany({
    where: {
      makerAddress: address,
      status: { in: [...RESERVING_ORDER_STATUSES] },
    },
    include: { pair: true },
  });

  const locked = new Map<string, Decimal>();
  const add = (tok: string, amount: Decimal) => {
    if (amount.lessThanOrEqualTo(0)) return;
    if (token && tok !== token) return;
    locked.set(tok, (locked.get(tok) ?? new Decimal(0)).plus(amount));
  };

  for (const order of orders) {
    if (order.side === 'SELL') {
      // Reserves BASE token: the remaining amount still on the book.
      add(order.pair.baseToken, new Decimal(order.remainingAmount.toString()));
    } else if (order.side === 'BUY') {
      // Reserves QUOTE token: price × remaining amount.
      const price = effectivePrice({
        type: order.type,
        price: new Decimal(order.price.toString()),
        stopPrice:
          order.stopPrice !== null
            ? new Decimal(order.stopPrice.toString())
            : null,
      });
      add(
        order.pair.quoteToken,
        price.times(new Decimal(order.remainingAmount.toString())),
      );
    }
  }

  return locked;
}

/**
 * Return spendable balances for a wallet.
 *
 * Tokens are the union of those with a `UserBalance` row and those reserved by
 * resting orders, so a wallet that has locked funds in an order it no longer
 * holds free balance for still reports the lock.
 *
 * @param address  wallet address
 * @param token    optional single-token filter
 */
export async function getBalances(
  address: string,
  token?: string,
): Promise<TokenBalance[]> {
  const [ledgerRows, lockedByToken] = await Promise.all([
    prisma.userBalance.findMany({
      where: token ? { address, token } : { address },
    }),
    computeLockedByToken(address, token),
  ]);

  const totals = new Map<string, Decimal>();
  for (const row of ledgerRows) {
    // total = available + locked recorded on the ledger row.
    totals.set(
      row.token,
      new Decimal(row.available.toString()).plus(row.locked.toString()),
    );
  }

  const tokens = new Set<string>([...totals.keys(), ...lockedByToken.keys()]);

  const result: TokenBalance[] = [];
  for (const tok of tokens) {
    const total = totals.get(tok) ?? new Decimal(0);
    const locked = lockedByToken.get(tok) ?? new Decimal(0);
    const available = total.minus(locked);
    result.push({
      token: tok,
      total: total.toString(),
      locked: locked.toString(),
      available: available.toString(),
    });
  }

  result.sort((a, b) => a.token.localeCompare(b.token));
  return result;
}

export const balanceService = {
  getBalances,
  computeLockedByToken,
};
