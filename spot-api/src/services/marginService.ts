import { Decimal } from '@prisma/client/runtime/library';
/**
 * Margin Service — Lunex Leveraged Trading
 *
 * Manages leveraged positions with automated risk controls:
 *
 * Position Lifecycle:
 *   OPEN → (price moves) → AUTO_LIQUIDATED | MANUALLY_CLOSED
 *
 * Key Concepts:
 *   - Collateral: LUSDT deposited by the trader
 *   - Leverage: 1x-10x (configured per pair)
 *   - Liquidation Price: (entryPrice * (1 ∓ 1/leverage)) ± margin
 *   - Health Factor: collateral / (position size × liquidation margin)
 *   - Funding Rate: periodic cost for holding leveraged positions overnight
 *
 * Liquidations:
 *   - The marginService.checkLiquidations() cron runs on a configurable
 *     interval and marks positions with health factor < 1 as LIQUIDATED.
 *   - Collateral is forfeited; a LIQUIDATION TradeRecord is created.
 *
 * @module marginService
 */
import prisma from '../db';
import { config } from '../config';
import { decimalToNumber } from '../utils/helpers';
import { orderbookManager } from '../utils/orderbook';
import { log } from '../utils/logger';

const prismaAny = prisma as any;
const DEFAULT_COLLATERAL_TOKEN = 'USDT';
const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 10;
const MAINTENANCE_MARGIN_RATIO = 0.1;
const LIQUIDATION_PENALTY_RATIO = 0.025;
const MIN_OPEN_POSITION_HEALTH_FACTOR = 1.25;
const MAX_SAFE_INITIAL_LEVERAGE = Math.min(
  MAX_LEVERAGE,
  Math.floor(
    (1 / (MAINTENANCE_MARGIN_RATIO * MIN_OPEN_POSITION_HEALTH_FACTOR) - 1e-9) *
      10,
  ) / 10,
);

type MarginAccountRecord = {
  id: string;
  address: string;
  collateralToken: string;
  collateralAvailable: Decimal;
  collateralLocked: Decimal;
  totalRealizedPnl: Decimal;
  createdAt: Date;
  updatedAt: Date;
};

const marginPriceMonitor = new Map<string, MarginPriceMonitorState>();

type MarginPositionRecord = {
  id: string;
  accountId: string;
  pairId: string;
  pairSymbol: string;
  side: string;
  status: string;
  collateralAmount: Decimal;
  leverage: Decimal;
  notional: Decimal;
  quantity: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;
  borrowedAmount: Decimal;
  maintenanceMargin: Decimal;
  liquidationPrice: Decimal;
  unrealizedPnl: Decimal;
  realizedPnl: Decimal;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  account?: MarginAccountRecord;
};

type MarginPriceReference = {
  observedAt: number;
  price: number;
  source: 'LAST_TRADE' | 'BOOK_MID';
};

type MarginPriceMetadata = {
  source: 'LAST_TRADE' | 'BOOK_MID';
  observedAt: string;
  ageMs: number;
};

type MarginPriceMonitorState = {
  pairSymbol: string;
  status: 'HEALTHY' | 'UNHEALTHY';
  isOperationallyBlocked: boolean;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  lastResolvedSource: 'LAST_TRADE' | 'BOOK_MID' | null;
  lastResolvedObservedAt: string | null;
  lastResolvedAgeMs: number | null;
  lastResolvedPrice: number | null;
};

type FormattedMarginPosition = {
  id: string;
  pairSymbol: string;
  side: string;
  status: string;
  collateralAmount: number;
  leverage: number;
  notional: number;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  borrowedAmount: number;
  maintenanceMargin: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  equity: number;
  healthFactor: number | null;
  isLiquidatable: boolean;
  markPriceMeta?: MarginPriceMetadata;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
};

function toDecimal(value: number | string) {
  return new Decimal(typeof value === 'number' ? value.toFixed(18) : value);
}

function getBpsDistance(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return null;
  }

  return (Math.abs(a - b) / b) * 10_000;
}

function getBookMidReference(
  pairSymbol: string,
  now: number,
): MarginPriceReference | null {
  const book = orderbookManager.get(pairSymbol);
  if (!book) {
    return null;
  }

  const bestBid = book.getBestBid();
  const bestAsk = book.getBestAsk();
  const lastUpdatedAt = book.getLastUpdatedAt();
  if (bestBid === null || bestAsk === null || lastUpdatedAt === null) {
    return null;
  }

  if (now - lastUpdatedAt > config.margin.markPriceMaxAgeMs) {
    return null;
  }

  const midPrice = (bestBid + bestAsk) / 2;
  const spreadBps = getBpsDistance(bestAsk, bestBid);
  if (!Number.isFinite(midPrice) || midPrice <= 0 || spreadBps === null) {
    return null;
  }

  const normalizedSpreadBps = ((bestAsk - bestBid) / midPrice) * 10_000;
  if (normalizedSpreadBps > config.margin.maxBookSpreadBps) {
    return null;
  }

  return {
    observedAt: lastUpdatedAt,
    price: midPrice,
    source: 'BOOK_MID',
  };
}

function getPositionUnrealizedPnl(
  side: string,
  entryPrice: number,
  markPrice: number,
  quantity: number,
) {
  return side === 'BUY'
    ? (markPrice - entryPrice) * quantity
    : (entryPrice - markPrice) * quantity;
}

function getLiquidationPrice(
  side: string,
  entryPrice: number,
  collateralAmount: number,
  maintenanceMargin: number,
  quantity: number,
) {
  if (quantity <= 0) return entryPrice;

  if (side === 'BUY') {
    return entryPrice + (maintenanceMargin - collateralAmount) / quantity;
  }

  return entryPrice + (collateralAmount - maintenanceMargin) / quantity;
}

function toPriceMetadata(
  reference: MarginPriceReference,
  now: number,
): MarginPriceMetadata {
  return {
    source: reference.source,
    observedAt: new Date(reference.observedAt).toISOString(),
    ageMs: Math.max(now - reference.observedAt, 0),
  };
}

function isOperationallyBlocked(consecutiveFailures: number) {
  return consecutiveFailures >= config.margin.operationalBlockAfterFailures;
}

function getOperationalBlockError(pairSymbol: string) {
  return `Margin price health is operationally blocked for ${pairSymbol}`;
}

function recordPriceResolution(
  pairSymbol: string,
  reference: MarginPriceReference,
  now: number,
) {
  const previous = marginPriceMonitor.get(pairSymbol);
  const next: MarginPriceMonitorState = {
    pairSymbol,
    status: 'HEALTHY',
    isOperationallyBlocked: false,
    totalSuccesses: (previous?.totalSuccesses ?? 0) + 1,
    totalFailures: previous?.totalFailures ?? 0,
    consecutiveFailures: 0,
    lastSuccessAt: new Date(now).toISOString(),
    lastFailureAt: previous?.lastFailureAt ?? null,
    lastFailureReason: previous?.lastFailureReason ?? null,
    lastResolvedSource: reference.source,
    lastResolvedObservedAt: new Date(reference.observedAt).toISOString(),
    lastResolvedAgeMs: Math.max(now - reference.observedAt, 0),
    lastResolvedPrice: reference.price,
  };

  marginPriceMonitor.set(pairSymbol, next);

  if (previous?.status === 'UNHEALTHY') {
    console.info(
      JSON.stringify({
        event: 'margin.safe_mark_price_restored',
        pairSymbol,
        source: reference.source,
        observedAt: next.lastResolvedObservedAt,
        ageMs: next.lastResolvedAgeMs,
        totalSuccesses: next.totalSuccesses,
        totalFailures: next.totalFailures,
        timestamp: next.lastSuccessAt,
      }),
    );
  }
}

function recordPriceFailure(pairSymbol: string, reason: string, now: number) {
  const previous = marginPriceMonitor.get(pairSymbol);
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  const next: MarginPriceMonitorState = {
    pairSymbol,
    status: 'UNHEALTHY',
    isOperationallyBlocked: isOperationallyBlocked(consecutiveFailures),
    totalSuccesses: previous?.totalSuccesses ?? 0,
    totalFailures: (previous?.totalFailures ?? 0) + 1,
    consecutiveFailures,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastFailureAt: new Date(now).toISOString(),
    lastFailureReason: reason,
    lastResolvedSource: previous?.lastResolvedSource ?? null,
    lastResolvedObservedAt: previous?.lastResolvedObservedAt ?? null,
    lastResolvedAgeMs: previous?.lastResolvedAgeMs ?? null,
    lastResolvedPrice: previous?.lastResolvedPrice ?? null,
  };

  marginPriceMonitor.set(pairSymbol, next);

  if (
    !previous ||
    previous.status === 'HEALTHY' ||
    previous.lastFailureReason !== reason
  ) {
    log.error(
      {
        event: 'margin.safe_mark_price_unavailable',
        pairSymbol,
        reason,
        isOperationallyBlocked: next.isOperationallyBlocked,
        consecutiveFailures: next.consecutiveFailures,
        totalFailures: next.totalFailures,
        timestamp: next.lastFailureAt,
      },
      'Safe mark price unavailable',
    );
  }
}

function assertPairNotOperationallyBlocked(pairSymbol: string) {
  const state = marginPriceMonitor.get(pairSymbol);
  if (state?.isOperationallyBlocked) {
    throw new Error(getOperationalBlockError(pairSymbol));
  }
}

function getPriceHealthSnapshot(pairSymbol?: string) {
  const pairs = Array.from(marginPriceMonitor.values())
    .filter((entry) => !pairSymbol || entry.pairSymbol === pairSymbol)
    .sort((a, b) => a.pairSymbol.localeCompare(b.pairSymbol));

  const blockedPairs = pairs.filter(
    (entry) => entry.isOperationallyBlocked,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      trackedPairs: pairs.length,
      healthyPairs: pairs.filter((entry) => entry.status === 'HEALTHY').length,
      unhealthyPairs: pairs.filter((entry) => entry.status === 'UNHEALTHY')
        .length,
      hasActiveAlerts: pairs.some((entry) => entry.status === 'UNHEALTHY'),
      blockedPairs,
      operationalBlockAfterFailures:
        config.margin.operationalBlockAfterFailures,
    },
    pairs,
  };
}

async function resolveReferencePriceWithClient(
  client: any,
  pairId: string,
  pairSymbol: string,
): Promise<MarginPriceReference> {
  const now = Date.now();

  try {
    const lastTrade = await client.trade.findFirst({
      where: { pairId },
      orderBy: { createdAt: 'desc' },
    });

    const bookReference = getBookMidReference(pairSymbol, now);

    let tradeReference: MarginPriceReference | null = null;
    if (lastTrade) {
      const observedAt = lastTrade.createdAt
        ? new Date(lastTrade.createdAt).getTime()
        : now;
      tradeReference = {
        observedAt,
        price: decimalToNumber(lastTrade.price),
        source: 'LAST_TRADE',
      };
    }

    if (
      tradeReference &&
      now - tradeReference.observedAt <= config.margin.markPriceMaxAgeMs
    ) {
      if (bookReference) {
        const deviationBps = getBpsDistance(
          tradeReference.price,
          bookReference.price,
        );
        if (
          deviationBps !== null &&
          deviationBps > config.margin.maxTradeToBookDeviationBps
        ) {
          throw new Error(
            `Mark price circuit breaker triggered for ${pairSymbol}`,
          );
        }
      }

      recordPriceResolution(pairSymbol, tradeReference, now);
      return tradeReference;
    }

    if (bookReference) {
      recordPriceResolution(pairSymbol, bookReference, now);
      return bookReference;
    }

    if (tradeReference) {
      throw new Error(`Mark price stale for ${pairSymbol}`);
    }

    throw new Error(`Unable to determine safe mark price for ${pairSymbol}`);
  } catch (error: any) {
    recordPriceFailure(pairSymbol, error.message, now);
    throw error;
  }
}

async function getReferencePriceWithClient(
  client: any,
  pairId: string,
  pairSymbol: string,
): Promise<number> {
  const reference = await resolveReferencePriceWithClient(
    client,
    pairId,
    pairSymbol,
  );
  return reference.price;
}

async function getOrCreateMarginAccountWithClient(
  client: any,
  address: string,
) {
  let account = (await client.marginAccount.findUnique({
    where: { address },
  })) as MarginAccountRecord | null;
  if (!account) {
    account = (await client.marginAccount.create({
      data: {
        address,
        collateralToken: DEFAULT_COLLATERAL_TOKEN,
        collateralAvailable: new Decimal('0'),
        collateralLocked: new Decimal('0'),
        totalRealizedPnl: new Decimal('0'),
      },
    })) as MarginAccountRecord;
  }
  return account;
}

async function getOrCreateMarginAccount(address: string) {
  return getOrCreateMarginAccountWithClient(prismaAny, address);
}

function formatPosition(
  position: MarginPositionRecord,
): FormattedMarginPosition {
  const collateralAmount = decimalToNumber(position.collateralAmount);
  const notional = decimalToNumber(position.notional);
  const unrealizedPnl = decimalToNumber(position.unrealizedPnl);
  const maintenanceMargin = decimalToNumber(position.maintenanceMargin);
  const equity = collateralAmount + unrealizedPnl;
  const healthFactor =
    maintenanceMargin > 0 ? equity / maintenanceMargin : null;

  return {
    id: position.id,
    pairSymbol: position.pairSymbol,
    side: position.side,
    status: position.status,
    collateralAmount,
    leverage: decimalToNumber(position.leverage),
    notional,
    quantity: decimalToNumber(position.quantity),
    entryPrice: decimalToNumber(position.entryPrice),
    markPrice: decimalToNumber(position.markPrice),
    borrowedAmount: decimalToNumber(position.borrowedAmount),
    maintenanceMargin,
    liquidationPrice: decimalToNumber(position.liquidationPrice),
    unrealizedPnl,
    realizedPnl: decimalToNumber(position.realizedPnl),
    equity,
    healthFactor,
    isLiquidatable: equity <= maintenanceMargin,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    updatedAt: position.updatedAt,
  };
}

function formatPositionWithPriceMetadata(
  position: MarginPositionRecord,
  priceMetadata: MarginPriceMetadata,
): FormattedMarginPosition {
  return {
    ...formatPosition(position),
    markPriceMeta: priceMetadata,
  };
}

async function refreshPositionWithClient(
  client: any,
  position: MarginPositionRecord,
): Promise<FormattedMarginPosition> {
  if (position.status !== 'OPEN') {
    return formatPosition(position);
  }

  const reference = await resolveReferencePriceWithClient(
    client,
    position.pairId,
    position.pairSymbol,
  );
  const markPrice = reference.price;
  const metadata = toPriceMetadata(reference, Date.now());
  const entryPrice = decimalToNumber(position.entryPrice);
  const quantity = decimalToNumber(position.quantity);
  const collateralAmount = decimalToNumber(position.collateralAmount);
  const maintenanceMargin = decimalToNumber(position.maintenanceMargin);
  const unrealizedPnl = getPositionUnrealizedPnl(
    position.side,
    entryPrice,
    markPrice,
    quantity,
  );
  const liquidationPrice = getLiquidationPrice(
    position.side,
    entryPrice,
    collateralAmount,
    maintenanceMargin,
    quantity,
  );

  const updated = (await client.marginPosition.update({
    where: { id: position.id },
    data: {
      markPrice: toDecimal(markPrice),
      unrealizedPnl: toDecimal(unrealizedPnl),
      liquidationPrice: toDecimal(liquidationPrice),
    },
  })) as MarginPositionRecord;

  return formatPositionWithPriceMetadata(updated, metadata);
}

async function refreshPosition(
  position: MarginPositionRecord,
): Promise<FormattedMarginPosition> {
  return refreshPositionWithClient(prismaAny, position);
}

async function getAccountRiskSnapshot(
  client: any,
  account: MarginAccountRecord,
) {
  const openPositions = (await client.marginPosition.findMany({
    where: {
      accountId: account.id,
      status: 'OPEN',
    },
    orderBy: { openedAt: 'desc' },
  })) as MarginPositionRecord[];

  const refreshedOpenPositions = [];
  for (const position of openPositions) {
    refreshedOpenPositions.push(
      await refreshPositionWithClient(client, position),
    );
  }

  const totalUnrealizedPnl = refreshedOpenPositions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  const totalMaintenanceMargin = refreshedOpenPositions.reduce(
    (sum, position) => sum + position.maintenanceMargin,
    0,
  );
  const totalEquity =
    decimalToNumber(account.collateralAvailable) +
    decimalToNumber(account.collateralLocked) +
    totalUnrealizedPnl;

  return {
    positions: refreshedOpenPositions,
    totalUnrealizedPnl,
    totalMaintenanceMargin,
    totalEquity,
  };
}

async function getAccountPositions(
  accountId: string,
): Promise<FormattedMarginPosition[]> {
  const positions = (await prismaAny.marginPosition.findMany({
    where: { accountId },
    orderBy: { openedAt: 'desc' },
  })) as MarginPositionRecord[];

  const formatted: FormattedMarginPosition[] = [];
  for (const position of positions) {
    formatted.push(await refreshPosition(position));
  }
  return formatted;
}

function getOverviewPriceHealth(positions: FormattedMarginPosition[]) {
  const openPositions = positions.filter(
    (position) => position.status === 'OPEN' && position.markPriceMeta,
  );
  if (openPositions.length === 0) {
    return null;
  }

  const latestObservedAt = openPositions.reduce((latest, position) => {
    const observedAt = position.markPriceMeta
      ? new Date(position.markPriceMeta.observedAt).getTime()
      : 0;
    return Math.max(latest, observedAt);
  }, 0);

  const maxAgeMs = openPositions.reduce((maxAge, position) => {
    const ageMs = position.markPriceMeta?.ageMs ?? 0;
    return Math.max(maxAge, ageMs);
  }, 0);

  const sources = Array.from(
    new Set(
      openPositions
        .map((position) => position.markPriceMeta?.source)
        .filter(Boolean),
    ),
  );

  return {
    sources,
    latestObservedAt:
      latestObservedAt > 0 ? new Date(latestObservedAt).toISOString() : null,
    maxAgeMs,
    hasStaleMarks: maxAgeMs > config.margin.markPriceMaxAgeMs,
  };
}

function escapePrometheusLabel(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function toPrometheusMetrics() {
  const snapshot = getPriceHealthSnapshot();
  const lines = [
    '# HELP lunex_margin_mark_price_tracked_pairs Number of pairs tracked by the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_tracked_pairs gauge',
    `lunex_margin_mark_price_tracked_pairs ${snapshot.summary.trackedPairs}`,
    '# HELP lunex_margin_mark_price_healthy_pairs Number of pairs currently healthy in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_healthy_pairs gauge',
    `lunex_margin_mark_price_healthy_pairs ${snapshot.summary.healthyPairs}`,
    '# HELP lunex_margin_mark_price_unhealthy_pairs Number of pairs currently unhealthy in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_unhealthy_pairs gauge',
    `lunex_margin_mark_price_unhealthy_pairs ${snapshot.summary.unhealthyPairs}`,
    '# HELP lunex_margin_mark_price_active_alerts Whether the margin safe mark price monitor has active alerts',
    '# TYPE lunex_margin_mark_price_active_alerts gauge',
    `lunex_margin_mark_price_active_alerts ${
      snapshot.summary.hasActiveAlerts ? 1 : 0
    }`,
    '# HELP lunex_margin_mark_price_blocked_pairs Number of pairs currently under operational block in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_blocked_pairs gauge',
    `lunex_margin_mark_price_blocked_pairs ${snapshot.summary.blockedPairs}`,
    '# HELP lunex_margin_mark_price_pair_status Pair-level status for the margin safe mark price monitor (1=healthy, 0=unhealthy)',
    '# TYPE lunex_margin_mark_price_pair_status gauge',
    '# HELP lunex_margin_mark_price_pair_operationally_blocked Pair-level operational block state for the margin safe mark price monitor (1=blocked, 0=not blocked)',
    '# TYPE lunex_margin_mark_price_pair_operationally_blocked gauge',
    '# HELP lunex_margin_mark_price_pair_consecutive_failures Consecutive failures per pair in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_pair_consecutive_failures gauge',
    '# HELP lunex_margin_mark_price_pair_total_failures Total failures per pair in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_pair_total_failures counter',
    '# HELP lunex_margin_mark_price_pair_total_successes Total successful resolutions per pair in the margin safe mark price monitor',
    '# TYPE lunex_margin_mark_price_pair_total_successes counter',
    '# HELP lunex_margin_mark_price_pair_last_resolved_age_ms Last resolved mark price age in milliseconds per pair',
    '# TYPE lunex_margin_mark_price_pair_last_resolved_age_ms gauge',
  ];

  for (const pair of snapshot.pairs) {
    const pairLabel = `pair_symbol="${escapePrometheusLabel(pair.pairSymbol)}"`;
    lines.push(
      `lunex_margin_mark_price_pair_status{${pairLabel}} ${
        pair.status === 'HEALTHY' ? 1 : 0
      }`,
    );
    lines.push(
      `lunex_margin_mark_price_pair_operationally_blocked{${pairLabel}} ${
        pair.isOperationallyBlocked ? 1 : 0
      }`,
    );
    lines.push(
      `lunex_margin_mark_price_pair_consecutive_failures{${pairLabel}} ${pair.consecutiveFailures}`,
    );
    lines.push(
      `lunex_margin_mark_price_pair_total_failures{${pairLabel}} ${pair.totalFailures}`,
    );
    lines.push(
      `lunex_margin_mark_price_pair_total_successes{${pairLabel}} ${pair.totalSuccesses}`,
    );
    lines.push(
      `lunex_margin_mark_price_pair_last_resolved_age_ms{${pairLabel}} ${
        pair.lastResolvedAgeMs ?? 0
      }`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export const marginService = {
  getPriceHealth(pairSymbol?: string) {
    return getPriceHealthSnapshot(pairSymbol);
  },

  getPriceHealthSummary() {
    return getPriceHealthSnapshot().summary;
  },

  getPriceHealthMetrics() {
    return toPrometheusMetrics();
  },

  resetPriceHealthMonitor(pairSymbol?: string) {
    if (pairSymbol) {
      marginPriceMonitor.delete(pairSymbol);
      return getPriceHealthSnapshot(pairSymbol);
    }

    marginPriceMonitor.clear();
    return getPriceHealthSnapshot();
  },

  async getOverview(address: string) {
    const account = await getOrCreateMarginAccount(address);
    const positions = await getAccountPositions(account.id);
    const openPositions = positions.filter(
      (position) => position.status === 'OPEN',
    );
    const totalUnrealizedPnl = openPositions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0,
    );
    const totalEquity =
      decimalToNumber(account.collateralAvailable) +
      decimalToNumber(account.collateralLocked) +
      totalUnrealizedPnl;
    const markPriceHealth = getOverviewPriceHealth(positions);

    return {
      account: {
        id: account.id,
        address: account.address,
        collateralToken: account.collateralToken,
        collateralAvailable: decimalToNumber(account.collateralAvailable),
        collateralLocked: decimalToNumber(account.collateralLocked),
        totalRealizedPnl: decimalToNumber(account.totalRealizedPnl),
        totalEquity,
        updatedAt: account.updatedAt,
      },
      positions,
      risk: {
        openPositions: openPositions.length,
        totalUnrealizedPnl,
        liquidatablePositions: openPositions.filter(
          (position) => position.isLiquidatable,
        ).length,
        markPriceHealth,
      },
    };
  },

  async depositCollateral(input: {
    address: string;
    token?: string;
    amount: string;
    signature: string;
  }) {
    const amount = parseFloat(input.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('Collateral amount must be positive');

    const updated = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const account = await getOrCreateMarginAccountWithClient(
        txAny,
        input.address,
      );
      const nextAccount = (await txAny.marginAccount.update({
        where: { id: account.id },
        data: {
          collateralAvailable: account.collateralAvailable.plus(input.amount),
        },
      })) as MarginAccountRecord;

      await txAny.marginCollateralTransfer.create({
        data: {
          accountId: account.id,
          direction: 'DEPOSIT',
          status: 'CONFIRMED',
          token: input.token || DEFAULT_COLLATERAL_TOKEN,
          amount: new Decimal(input.amount),
          signature: input.signature,
        },
      });

      return nextAccount;
    });

    return {
      account: {
        id: updated.id,
        address: updated.address,
        collateralToken: updated.collateralToken,
        collateralAvailable: decimalToNumber(updated.collateralAvailable),
        collateralLocked: decimalToNumber(updated.collateralLocked),
        totalRealizedPnl: decimalToNumber(updated.totalRealizedPnl),
        updatedAt: updated.updatedAt,
      },
    };
  },

  async withdrawCollateral(input: {
    address: string;
    token?: string;
    amount: string;
    signature: string;
  }) {
    const amount = parseFloat(input.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('Collateral amount must be positive');

    const updated = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const account = await getOrCreateMarginAccountWithClient(
        txAny,
        input.address,
      );
      if (decimalToNumber(account.collateralAvailable) < amount) {
        throw new Error('Insufficient available collateral');
      }

      const riskSnapshot = await getAccountRiskSnapshot(txAny, account);
      const postWithdrawalEquity = riskSnapshot.totalEquity - amount;
      if (
        riskSnapshot.totalMaintenanceMargin > 0 &&
        postWithdrawalEquity <= riskSnapshot.totalMaintenanceMargin
      ) {
        throw new Error(
          'Withdrawal would breach maintenance margin requirements',
        );
      }

      const nextAccount = (await txAny.marginAccount.update({
        where: { id: account.id },
        data: {
          collateralAvailable: account.collateralAvailable.minus(input.amount),
        },
      })) as MarginAccountRecord;

      await txAny.marginCollateralTransfer.create({
        data: {
          accountId: account.id,
          direction: 'WITHDRAW',
          status: 'CONFIRMED',
          token: input.token || DEFAULT_COLLATERAL_TOKEN,
          amount: new Decimal(input.amount),
          signature: input.signature,
        },
      });

      return nextAccount;
    });

    return {
      account: {
        id: updated.id,
        address: updated.address,
        collateralToken: updated.collateralToken,
        collateralAvailable: decimalToNumber(updated.collateralAvailable),
        collateralLocked: decimalToNumber(updated.collateralLocked),
        totalRealizedPnl: decimalToNumber(updated.totalRealizedPnl),
        updatedAt: updated.updatedAt,
      },
    };
  },

  async openPosition(input: {
    address: string;
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    collateralAmount: string;
    leverage: string;
    signature: string;
  }) {
    const collateralAmount = parseFloat(input.collateralAmount);
    const leverage = parseFloat(input.leverage);

    if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) {
      throw new Error('Collateral amount must be positive');
    }

    if (
      !Number.isFinite(leverage) ||
      leverage < MIN_LEVERAGE ||
      leverage > MAX_SAFE_INITIAL_LEVERAGE
    ) {
      throw new Error(
        `Leverage must be between ${MIN_LEVERAGE}x and ${MAX_SAFE_INITIAL_LEVERAGE.toFixed(
          2,
        )}x`,
      );
    }

    assertPairNotOperationallyBlocked(input.pairSymbol);

    const position = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const pair = await tx.pair.findUnique({
        where: { symbol: input.pairSymbol },
      });
      if (!pair || !pair.isActive) {
        throw new Error(`Pair ${input.pairSymbol} not found or inactive`);
      }

      const account = await getOrCreateMarginAccountWithClient(
        txAny,
        input.address,
      );
      if (decimalToNumber(account.collateralAvailable) < collateralAmount) {
        throw new Error('Insufficient available collateral');
      }

      const riskSnapshot = await getAccountRiskSnapshot(txAny, account);
      const entryPrice = await getReferencePriceWithClient(
        txAny,
        pair.id,
        input.pairSymbol,
      );
      const notional = collateralAmount * leverage;
      const quantity = notional / entryPrice;
      const borrowedAmount = Math.max(notional - collateralAmount, 0);
      const maintenanceMargin = notional * MAINTENANCE_MARGIN_RATIO;
      const initialHealthFactor =
        maintenanceMargin > 0 ? collateralAmount / maintenanceMargin : null;
      if (
        initialHealthFactor === null ||
        initialHealthFactor <= MIN_OPEN_POSITION_HEALTH_FACTOR
      ) {
        throw new Error(
          'Requested leverage creates insufficient initial margin buffer',
        );
      }

      const postOpenMaintenanceMargin =
        riskSnapshot.totalMaintenanceMargin + maintenanceMargin;
      if (riskSnapshot.totalEquity <= postOpenMaintenanceMargin) {
        throw new Error(
          'Insufficient account equity for requested margin exposure',
        );
      }

      const liquidationPrice = getLiquidationPrice(
        input.side,
        entryPrice,
        collateralAmount,
        maintenanceMargin,
        quantity,
      );

      await txAny.marginAccount.update({
        where: { id: account.id },
        data: {
          collateralAvailable: account.collateralAvailable.minus(
            input.collateralAmount,
          ),
          collateralLocked: account.collateralLocked.plus(
            input.collateralAmount,
          ),
        },
      });

      return (await txAny.marginPosition.create({
        data: {
          accountId: account.id,
          pairId: pair.id,
          pairSymbol: input.pairSymbol,
          side: input.side,
          status: 'OPEN',
          collateralAmount: new Decimal(input.collateralAmount),
          leverage: new Decimal(input.leverage),
          notional: toDecimal(notional),
          quantity: toDecimal(quantity),
          entryPrice: toDecimal(entryPrice),
          markPrice: toDecimal(entryPrice),
          borrowedAmount: toDecimal(borrowedAmount),
          maintenanceMargin: toDecimal(maintenanceMargin),
          liquidationPrice: toDecimal(liquidationPrice),
          unrealizedPnl: new Decimal('0'),
          realizedPnl: new Decimal('0'),
        },
      })) as MarginPositionRecord;
    });

    return {
      position: await refreshPosition(position),
      overview: await this.getOverview(input.address),
    };
  },

  async closePosition(positionId: string, address: string) {
    await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const position = (await txAny.marginPosition.findUnique({
        where: { id: positionId },
        include: { account: true },
      })) as MarginPositionRecord | null;

      if (!position) throw new Error('Margin position not found');
      if (!position.account || position.account.address !== address)
        throw new Error('Not position owner');
      if (position.status !== 'OPEN') throw new Error('Position is not open');

      const refreshed = await refreshPositionWithClient(txAny, position);
      const account = (await txAny.marginAccount.findUnique({
        where: { id: position.account.id },
      })) as MarginAccountRecord | null;
      if (!account) throw new Error('Margin account not found');
      const netRelease = Math.max(
        refreshed.collateralAmount + refreshed.unrealizedPnl,
        0,
      );

      await txAny.marginAccount.update({
        where: { id: account.id },
        data: {
          collateralAvailable: account.collateralAvailable.plus(
            netRelease.toFixed(18),
          ),
          collateralLocked: account.collateralLocked.minus(
            position.collateralAmount.toString(),
          ),
          totalRealizedPnl: account.totalRealizedPnl.plus(
            refreshed.unrealizedPnl.toFixed(18),
          ),
        },
      });

      await txAny.marginPosition.update({
        where: { id: position.id },
        data: {
          status: 'CLOSED',
          markPrice: toDecimal(refreshed.markPrice),
          unrealizedPnl: new Decimal('0'),
          realizedPnl: toDecimal(refreshed.unrealizedPnl),
          closedAt: new Date(),
        },
      });
    });

    return await this.getOverview(address);
  },

  async liquidatePosition(positionId: string, liquidatorAddress: string) {
    let ownerAddress = '';

    await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const position = (await txAny.marginPosition.findUnique({
        where: { id: positionId },
        include: { account: true },
      })) as MarginPositionRecord | null;

      if (!position) throw new Error('Margin position not found');
      if (!position.account) throw new Error('Margin account not found');
      if (position.status !== 'OPEN') throw new Error('Position is not open');

      const refreshed = await refreshPositionWithClient(txAny, position);
      if (!refreshed.isLiquidatable) {
        throw new Error('Position is not liquidatable');
      }

      const account = (await txAny.marginAccount.findUnique({
        where: { id: position.account.id },
      })) as MarginAccountRecord | null;
      if (!account) throw new Error('Margin account not found');
      ownerAddress = account.address;
      const penaltyAmount = Math.min(
        refreshed.collateralAmount * LIQUIDATION_PENALTY_RATIO,
        Math.max(refreshed.equity, 0),
      );
      const releasedCollateral = Math.max(refreshed.equity - penaltyAmount, 0);

      // Atomic claim: only one liquidation can win this transition. Default
      // PostgreSQL READ COMMITTED would let two concurrent transactions both
      // pass the `status === 'OPEN'` check above and both succeed with their
      // updates, double-decrementing `collateralLocked`. The `updateMany`
      // with `status: 'OPEN'` filter is the row-level CAS that prevents this.
      const claimed = await txAny.marginPosition.updateMany({
        where: { id: position.id, status: 'OPEN' },
        data: {
          status: 'LIQUIDATED',
          markPrice: toDecimal(refreshed.markPrice),
          unrealizedPnl: new Decimal('0'),
          realizedPnl: toDecimal(refreshed.unrealizedPnl - penaltyAmount),
          closedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        // Lost the race — another transaction already liquidated this position.
        // Throwing rolls back the transaction (no double credit on the account
        // and no duplicate marginLiquidation record).
        throw new Error('Position already liquidated');
      }

      await txAny.marginAccount.update({
        where: { id: account.id },
        data: {
          collateralAvailable: account.collateralAvailable.plus(
            releasedCollateral.toFixed(18),
          ),
          collateralLocked: account.collateralLocked.minus(
            position.collateralAmount.toString(),
          ),
          totalRealizedPnl: account.totalRealizedPnl.plus(
            (refreshed.unrealizedPnl - penaltyAmount).toFixed(18),
          ),
        },
      });

      await txAny.marginLiquidation.create({
        data: {
          positionId: position.id,
          liquidatorAddress,
          markPrice: toDecimal(refreshed.markPrice),
          equityBefore: toDecimal(refreshed.equity),
          penaltyAmount: toDecimal(penaltyAmount),
          releasedCollateral: toDecimal(releasedCollateral),
        },
      });
    });

    return await this.getOverview(ownerAddress);
  },
};
