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
 *   - BUY  order reserves `price × remainingAmount` (+ max fee) of QUOTE.
 *   - With on-chain settlement enabled, unsettled trades (PENDING / SETTLING / RECONCILE_REQUIRED /
 *     FAILED) keep the seller's base and the buyer's quote + max fee locked
 *     until the vault debit finalizes.
 *
 * @module balanceService
 */
import prisma from '../db';
import { Decimal } from '@prisma/client/runtime/library';
import { settlementService } from './settlementService';
import {
  spotAssetKey,
  quoteReserveUnits,
  spotUnitsToDecimal,
} from '../utils/spotReservation';
import {
  accountAddressFilter,
  isSameAccount,
  toCanonicalAddress,
} from '../utils/validation';

const RESERVING_ORDER_STATUSES = [
  'OPEN',
  'PARTIAL',
  'PENDING_TRIGGER',
] as const;

/** Trades matched off-chain whose vault debit has not finalized on-chain.
 *  FAILED is retried; RECONCILE_REQUIRED may or may not have landed — both
 *  still owe the debit until the reconciler resolves them. */
const UNSETTLED_TRADE_STATUSES = [
  'PENDING',
  'SETTLING',
  'FAILED',
  'RECONCILE_REQUIRED',
] as const;

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
  // M-09: one account in any encoding — canonical rows (post-fix) plus
  // legacy rows under the string given.
  const account = accountAddressFilter(address);
  const orders = await prisma.order.findMany({
    where: {
      makerAddress: account,
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

  // Matched off-chain but not yet debited on-chain: a filled order no longer
  // reserves funds, yet the vault still holds them until `settle_trade`
  // finalizes. Keep the fill locked so the same vault balance cannot back a
  // second order whose settlement would then revert (InsufficientBalance).
  // Only debits are counted; incoming credits count once they settle.
  // Ledger mode (settlement disabled) marks trades SKIPPED — nothing to add.
  if (settlementService.isEnabled()) {
    const trades = await prisma.trade.findMany({
      where: {
        settlementStatus: { in: [...UNSETTLED_TRADE_STATUSES] },
        OR: [{ makerAddress: account }, { takerAddress: account }],
      },
      include: { pair: true },
    });
    for (const trade of trades) {
      // Trade.side is the TAKER side.
      const buyer =
        trade.side === 'BUY' ? trade.takerAddress : trade.makerAddress;
      const seller =
        trade.side === 'BUY' ? trade.makerAddress : trade.takerAddress;
      if (isSameAccount(seller, address)) {
        add(
          spotAssetKey(trade.pair.baseToken, trade.pair.isNativeBase),
          new Decimal(trade.amount.toString()),
        );
      }
      if (isSameAccount(buyer, address)) {
        // Same conservative bound as a resting BUY: principal + max fee.
        add(
          spotAssetKey(trade.pair.quoteToken, trade.pair.isNativeQuote),
          spotUnitsToDecimal(
            quoteReserveUnits(
              trade.price.toString(),
              trade.amount.toString(),
              trade.pair,
            ),
            trade.pair.quoteDecimals,
          ),
        );
      }
    }
  }

  for (const order of orders) {
    if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) continue;
    if (order.side === 'SELL') {
      // Reserves BASE token: the remaining amount still on the book.
      add(
        spotAssetKey(order.pair.baseToken, order.pair.isNativeBase),
        new Decimal(order.remainingAmount.toString()),
      );
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
        spotAssetKey(order.pair.quoteToken, order.pair.isNativeQuote),
        spotUnitsToDecimal(
          quoteReserveUnits(
            price.toString(),
            order.remainingAmount.toString(),
            order.pair,
          ),
          order.pair.quoteDecimals,
        ),
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
  if (settlementService.isEnabled()) {
    const [pairs, locked] = await Promise.all([
      prisma.pair.findMany(),
      computeLockedByToken(address, token),
    ]);
    const assets = new Map<
      string,
      { address: string; decimals: number; native: boolean }
    >();
    for (const pair of pairs) {
      assets.set(spotAssetKey(pair.baseToken, pair.isNativeBase), {
        address: pair.baseToken,
        decimals: pair.baseDecimals,
        native: pair.isNativeBase,
      });
      assets.set(spotAssetKey(pair.quoteToken, pair.isNativeQuote), {
        address: pair.quoteToken,
        decimals: pair.quoteDecimals,
        native: pair.isNativeQuote,
      });
    }
    const balances = await Promise.all(
      [...assets]
        .filter(([key]) => !token || key === token)
        .map(async ([key, asset]) => {
          const units = await settlementService.getVaultBalance(
            toCanonicalAddress(address) ?? address,
            asset.address,
            asset.native,
          );
          if (units === null) throw new Error('Spot vault balance unavailable');
          const total = spotUnitsToDecimal(units, asset.decimals);
          const reserved = locked.get(key) ?? new Decimal(0);
          return {
            token: key,
            total: total.toString(),
            locked: reserved.toString(),
            available: total.minus(reserved).toString(),
          };
        }),
    );
    return balances.sort((a, b) => a.token.localeCompare(b.token));
  }

  const [ledgerRows, lockedByToken] = await Promise.all([
    prisma.userBalance.findMany({
      where: token
        ? { address: accountAddressFilter(address), token }
        : { address: accountAddressFilter(address) },
    }),
    computeLockedByToken(address, token),
  ]);

  const totals = new Map<string, Decimal>();
  for (const row of ledgerRows) {
    // total = available + locked recorded on the ledger row; an account
    // with rows in two encodings (pre-migration) sums them.
    totals.set(
      row.token,
      (totals.get(row.token) ?? new Decimal(0))
        .plus(row.available.toString())
        .plus(row.locked.toString()),
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
