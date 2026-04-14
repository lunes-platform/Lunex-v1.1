import prisma from '../db';
import { config } from '../config';
import {
  EquityPoint,
  buildPnlHistory,
  calculateAverageProfit,
  calculateMaxDrawdown,
  calculateSharpe,
  calculateWinRate,
  getSequentialReturns,
  getWindowRoi,
  roundMetric,
  toFiniteNumber,
} from './socialAnalyticsMath';
import { socialIndexerService } from './socialIndexerService';

type IndexedEventKind =
  | 'SWAP'
  | 'LIQUIDITY_ADD'
  | 'LIQUIDITY_REMOVE'
  | 'TRADE_OPEN'
  | 'TRADE_CLOSE'
  | 'VAULT_DEPOSIT'
  | 'VAULT_WITHDRAW'
  | 'UNKNOWN';

type IndexedEventRecord = {
  kind: IndexedEventKind;
  pallet?: string;
  method?: string;
  accountAddress?: string | null;
  counterpartyAddress?: string | null;
  pairSymbol?: string | null;
  extrinsicHash?: string | null;
  amountIn?: unknown;
  amountOut?: unknown;
  realizedPnl?: unknown;
  timestamp: Date | string;
  blockNumber: number;
  eventIndex: number;
};

function getAnalyticsDb() {
  const db = prisma as any;
  if (
    typeof db.socialIndexedEvent?.findMany !== 'function' ||
    typeof db.leaderAnalyticsSnapshot?.upsert !== 'function'
  ) {
    return null;
  }

  return db;
}

function buildEquityPoints(
  events: IndexedEventRecord[],
  fallbackEquity: number,
): EquityPoint[] {
  if (events.length === 0) {
    return fallbackEquity > 0
      ? [{ timestamp: Date.now(), equity: fallbackEquity }]
      : [];
  }

  const hasCashflowEvents = events.some(
    (event) =>
      event.kind === 'VAULT_DEPOSIT' || event.kind === 'VAULT_WITHDRAW',
  );
  let equity = hasCashflowEvents ? 0 : fallbackEquity;
  const points: EquityPoint[] = [];

  for (const event of events) {
    const amountIn = toFiniteNumber(event.amountIn);
    const amountOut = toFiniteNumber(event.amountOut);
    const realizedPnl = toFiniteNumber(event.realizedPnl);

    if (event.kind === 'VAULT_DEPOSIT') {
      equity += amountIn || amountOut;
    } else if (event.kind === 'VAULT_WITHDRAW') {
      equity -= amountOut || amountIn;
    } else if (event.kind === 'TRADE_CLOSE') {
      equity += realizedPnl;
    } else if (event.kind === 'SWAP' && realizedPnl !== 0) {
      equity += realizedPnl;
    }

    points.push({
      timestamp: new Date(event.timestamp).getTime(),
      equity: Math.max(equity, 0),
    });
  }

  if (points.length === 0 && fallbackEquity > 0) {
    points.push({ timestamp: Date.now(), equity: fallbackEquity });
  }

  return points;
}

function computeTradePnls(events: IndexedEventRecord[]) {
  return events
    .filter(
      (event) =>
        event.kind === 'TRADE_CLOSE' ||
        (event.kind === 'SWAP' && toFiniteNumber(event.realizedPnl) !== 0),
    )
    .map((event) => roundMetric(toFiniteNumber(event.realizedPnl)))
    .filter((value) => value !== 0);
}

function getEventPriority(event: IndexedEventRecord) {
  if (event.pallet === 'contracts.router') return 3;
  if (event.pallet === 'contracts.wnative') return 3;
  if (event.pallet === 'contracts.pair') return 2;
  return 1;
}

function shouldDeduplicateEvent(event: IndexedEventRecord) {
  return (
    Boolean(event.extrinsicHash) &&
    (event.kind === 'SWAP' ||
      event.kind === 'LIQUIDITY_ADD' ||
      event.kind === 'LIQUIDITY_REMOVE')
  );
}

function getCanonicalEventKey(event: IndexedEventRecord) {
  if (!shouldDeduplicateEvent(event)) {
    return `${event.blockNumber}:${event.eventIndex}`;
  }

  return [
    event.extrinsicHash,
    event.kind,
    event.accountAddress ?? '',
    event.counterpartyAddress ?? '',
    event.pairSymbol ?? '',
    toFiniteNumber(event.amountIn),
    toFiniteNumber(event.amountOut),
    toFiniteNumber(event.realizedPnl),
  ].join(':');
}

function selectCanonicalEvents(events: IndexedEventRecord[]) {
  const deduplicated = new Map<string, IndexedEventRecord>();

  for (const event of events) {
    const key = getCanonicalEventKey(event);
    const existing = deduplicated.get(key);

    if (!existing) {
      deduplicated.set(key, event);
      continue;
    }

    const eventPriority = getEventPriority(event);
    const existingPriority = getEventPriority(existing);

    if (eventPriority > existingPriority) {
      deduplicated.set(key, event);
      continue;
    }

    if (
      eventPriority === existingPriority &&
      event.eventIndex < existing.eventIndex
    ) {
      deduplicated.set(key, event);
    }
  }

  return [...deduplicated.values()].sort((left, right) => {
    if (
      new Date(left.timestamp).getTime() !== new Date(right.timestamp).getTime()
    ) {
      return (
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
    }

    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }

    return left.eventIndex - right.eventIndex;
  });
}

function getTradeEventNotional(event: IndexedEventRecord) {
  return Math.max(
    toFiniteNumber(event.amountIn),
    toFiniteNumber(event.amountOut),
  );
}

class SocialAnalyticsService {
  async recomputeLeaderSnapshots() {
    const db = getAnalyticsDb();
    if (!db) {
      return { updatedLeaders: 0, prismaReady: false };
    }

    const leaders = await db.leader.findMany({
      include: {
        vault: true,
      },
    });

    const latestIndexedEvent = await db.socialIndexedEvent.findFirst({
      where: { chain: config.socialAnalytics.chainName },
      orderBy: [{ blockNumber: 'desc' }, { eventIndex: 'desc' }],
    });

    let updatedLeaders = 0;

    for (const leader of leaders) {
      const rawEvents = await db.socialIndexedEvent.findMany({
        where: {
          chain: config.socialAnalytics.chainName,
          accountAddress: leader.address,
        },
        orderBy: [
          { timestamp: 'asc' },
          { blockNumber: 'asc' },
          { eventIndex: 'asc' },
        ],
      });

      const events = selectCanonicalEvents(rawEvents);

      const fallbackEquity = Math.max(
        toFiniteNumber(leader?.vault?.totalEquity),
        toFiniteNumber(leader.totalAum),
      );

      const equityPoints = buildEquityPoints(events, fallbackEquity);
      const tradePnls = computeTradePnls(events);
      const returns = getSequentialReturns(equityPoints);
      const currentEquity =
        equityPoints[equityPoints.length - 1]?.equity ?? fallbackEquity;
      const initialEquity = equityPoints[0]?.equity ?? fallbackEquity;
      const winningTrades = tradePnls.filter((value) => value > 0).length;
      const losingTrades = tradePnls.filter((value) => value < 0).length;
      const tradedVolume = roundMetric(
        events
          .filter(
            (event: IndexedEventRecord) =>
              event.kind === 'SWAP' ||
              event.kind === 'TRADE_OPEN' ||
              event.kind === 'TRADE_CLOSE',
          )
          .reduce(
            (total: number, event: IndexedEventRecord) =>
              total + getTradeEventNotional(event),
            0,
          ),
        6,
      );
      const grossProfit = roundMetric(
        tradePnls
          .filter((value) => value > 0)
          .reduce((total, value) => total + value, 0),
        6,
      );
      const grossLoss = roundMetric(
        Math.abs(
          tradePnls
            .filter((value) => value < 0)
            .reduce((total, value) => total + value, 0),
        ),
        6,
      );
      const realizedPnl = roundMetric(
        tradePnls.reduce((total, value) => total + value, 0),
        6,
      );
      const roi30d = getWindowRoi(equityPoints, 30);
      const roi90d = getWindowRoi(equityPoints, 90);
      const maxDrawdown = calculateMaxDrawdown(equityPoints);
      const winRate = calculateWinRate(winningTrades, tradePnls.length);
      const avgProfit = calculateAverageProfit(tradePnls);
      const sharpe = calculateSharpe(returns);
      const pnlHistory = buildPnlHistory(equityPoints);
      const lastEventAt = events[events.length - 1]?.timestamp
        ? new Date(events[events.length - 1].timestamp)
        : null;

      await db.leaderAnalyticsSnapshot.upsert({
        where: {
          leaderId_sourceChain: {
            leaderId: leader.id,
            sourceChain: config.socialAnalytics.chainName,
          },
        },
        update: {
          sourceMode: 'INDEXER',
          asOfBlock: latestIndexedEvent?.blockNumber ?? 0,
          asOfTime: new Date(),
          initialEquity,
          currentEquity,
          realizedPnl,
          unrealizedPnl: 0,
          tradedVolume,
          grossProfit,
          grossLoss,
          roi30d,
          roi90d,
          maxDrawdown,
          winRate,
          avgProfit,
          sharpe,
          totalTrades: tradePnls.length,
          winningTrades,
          losingTrades,
          pnlHistory,
          lastEventAt,
        },
        create: {
          leaderId: leader.id,
          sourceChain: config.socialAnalytics.chainName,
          sourceMode: 'INDEXER',
          asOfBlock: latestIndexedEvent?.blockNumber ?? 0,
          asOfTime: new Date(),
          initialEquity,
          currentEquity,
          realizedPnl,
          unrealizedPnl: 0,
          tradedVolume,
          grossProfit,
          grossLoss,
          roi30d,
          roi90d,
          maxDrawdown,
          winRate,
          avgProfit,
          sharpe,
          totalTrades: tradePnls.length,
          winningTrades,
          losingTrades,
          pnlHistory,
          lastEventAt,
        },
      });

      await db.leader.update({
        where: { id: leader.id },
        data: {
          roi30d,
          roi90d,
          totalAum: currentEquity,
          drawdown: maxDrawdown,
          winRate,
          avgProfit,
          sharpe,
          pnlHistory,
        },
      });

      // Sync agent metrics if leader is linked to an agent
      try {
        const agent = await db.agent.findFirst({
          where: { leaderId: leader.id },
        });
        if (agent) {
          await db.agent.update({
            where: { id: agent.id },
            data: {
              roi: roi90d ?? roi30d ?? 0,
              sharpe: sharpe ?? 0,
              maxDrawdown: maxDrawdown ?? 0,
              totalTrades: tradePnls.length,
              totalVolume: tradedVolume,
              lastActiveAt: lastEventAt ?? new Date(),
            },
          });
        }
      } catch {
        // Agent metrics are best-effort — don't block leader updates
      }

      updatedLeaders += 1;
    }

    return {
      updatedLeaders,
      latestBlock: latestIndexedEvent?.blockNumber ?? 0,
      prismaReady: true,
    };
  }

  async getPipelineStatus() {
    const db = getAnalyticsDb();
    const indexerStatus = await socialIndexerService.getStatus();

    if (!db) {
      return {
        ...indexerStatus,
        prismaReady: false,
        indexedEvents: 0,
        snapshots: 0,
        latestIndexedEvent: null,
      };
    }

    const [indexedEvents, snapshots, latestIndexedEvent] = await Promise.all([
      db.socialIndexedEvent.count({
        where: { chain: config.socialAnalytics.chainName },
      }),
      db.leaderAnalyticsSnapshot.count({
        where: { sourceChain: config.socialAnalytics.chainName },
      }),
      db.socialIndexedEvent.findFirst({
        where: { chain: config.socialAnalytics.chainName },
        orderBy: [{ blockNumber: 'desc' }, { eventIndex: 'desc' }],
      }),
    ]);

    return {
      ...indexerStatus,
      prismaReady: true,
      indexedEvents,
      snapshots,
      latestIndexedEvent,
    };
  }
}

export const socialAnalyticsService = new SocialAnalyticsService();
