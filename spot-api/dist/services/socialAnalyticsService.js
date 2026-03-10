"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialAnalyticsService = void 0;
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const socialAnalyticsMath_1 = require("./socialAnalyticsMath");
const socialIndexerService_1 = require("./socialIndexerService");
function getAnalyticsDb() {
    const db = db_1.default;
    if (typeof db.socialIndexedEvent?.findMany !== 'function' ||
        typeof db.leaderAnalyticsSnapshot?.upsert !== 'function') {
        return null;
    }
    return db;
}
function buildEquityPoints(events, fallbackEquity) {
    if (events.length === 0) {
        return fallbackEquity > 0 ? [{ timestamp: Date.now(), equity: fallbackEquity }] : [];
    }
    const hasCashflowEvents = events.some((event) => event.kind === 'VAULT_DEPOSIT' || event.kind === 'VAULT_WITHDRAW');
    let equity = hasCashflowEvents ? 0 : fallbackEquity;
    const points = [];
    for (const event of events) {
        const amountIn = (0, socialAnalyticsMath_1.toFiniteNumber)(event.amountIn);
        const amountOut = (0, socialAnalyticsMath_1.toFiniteNumber)(event.amountOut);
        const realizedPnl = (0, socialAnalyticsMath_1.toFiniteNumber)(event.realizedPnl);
        if (event.kind === 'VAULT_DEPOSIT') {
            equity += amountIn || amountOut;
        }
        else if (event.kind === 'VAULT_WITHDRAW') {
            equity -= amountOut || amountIn;
        }
        else if (event.kind === 'TRADE_CLOSE') {
            equity += realizedPnl;
        }
        else if (event.kind === 'SWAP' && realizedPnl !== 0) {
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
function computeTradePnls(events) {
    return events
        .filter((event) => event.kind === 'TRADE_CLOSE' || (event.kind === 'SWAP' && (0, socialAnalyticsMath_1.toFiniteNumber)(event.realizedPnl) !== 0))
        .map((event) => (0, socialAnalyticsMath_1.roundMetric)((0, socialAnalyticsMath_1.toFiniteNumber)(event.realizedPnl)))
        .filter((value) => value !== 0);
}
function getEventPriority(event) {
    if (event.pallet === 'contracts.router')
        return 3;
    if (event.pallet === 'contracts.wnative')
        return 3;
    if (event.pallet === 'contracts.pair')
        return 2;
    return 1;
}
function shouldDeduplicateEvent(event) {
    return Boolean(event.extrinsicHash) && (event.kind === 'SWAP' ||
        event.kind === 'LIQUIDITY_ADD' ||
        event.kind === 'LIQUIDITY_REMOVE');
}
function getCanonicalEventKey(event) {
    if (!shouldDeduplicateEvent(event)) {
        return `${event.blockNumber}:${event.eventIndex}`;
    }
    return [
        event.extrinsicHash,
        event.kind,
        event.accountAddress ?? '',
        event.counterpartyAddress ?? '',
        event.pairSymbol ?? '',
        (0, socialAnalyticsMath_1.toFiniteNumber)(event.amountIn),
        (0, socialAnalyticsMath_1.toFiniteNumber)(event.amountOut),
        (0, socialAnalyticsMath_1.toFiniteNumber)(event.realizedPnl),
    ].join(':');
}
function selectCanonicalEvents(events) {
    const deduplicated = new Map();
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
        if (eventPriority === existingPriority && event.eventIndex < existing.eventIndex) {
            deduplicated.set(key, event);
        }
    }
    return [...deduplicated.values()].sort((left, right) => {
        if (new Date(left.timestamp).getTime() !== new Date(right.timestamp).getTime()) {
            return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
        }
        if (left.blockNumber !== right.blockNumber) {
            return left.blockNumber - right.blockNumber;
        }
        return left.eventIndex - right.eventIndex;
    });
}
function getTradeEventNotional(event) {
    return Math.max((0, socialAnalyticsMath_1.toFiniteNumber)(event.amountIn), (0, socialAnalyticsMath_1.toFiniteNumber)(event.amountOut));
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
            where: { chain: config_1.config.socialAnalytics.chainName },
            orderBy: [{ blockNumber: 'desc' }, { eventIndex: 'desc' }],
        });
        let updatedLeaders = 0;
        for (const leader of leaders) {
            const rawEvents = await db.socialIndexedEvent.findMany({
                where: {
                    chain: config_1.config.socialAnalytics.chainName,
                    accountAddress: leader.address,
                },
                orderBy: [{ timestamp: 'asc' }, { blockNumber: 'asc' }, { eventIndex: 'asc' }],
            });
            const events = selectCanonicalEvents(rawEvents);
            const fallbackEquity = Math.max((0, socialAnalyticsMath_1.toFiniteNumber)(leader?.vault?.totalEquity), (0, socialAnalyticsMath_1.toFiniteNumber)(leader.totalAum));
            const equityPoints = buildEquityPoints(events, fallbackEquity);
            const tradePnls = computeTradePnls(events);
            const returns = (0, socialAnalyticsMath_1.getSequentialReturns)(equityPoints);
            const currentEquity = equityPoints[equityPoints.length - 1]?.equity ?? fallbackEquity;
            const initialEquity = equityPoints[0]?.equity ?? fallbackEquity;
            const winningTrades = tradePnls.filter((value) => value > 0).length;
            const losingTrades = tradePnls.filter((value) => value < 0).length;
            const tradedVolume = (0, socialAnalyticsMath_1.roundMetric)(events
                .filter((event) => event.kind === 'SWAP' || event.kind === 'TRADE_OPEN' || event.kind === 'TRADE_CLOSE')
                .reduce((total, event) => total + getTradeEventNotional(event), 0), 6);
            const grossProfit = (0, socialAnalyticsMath_1.roundMetric)(tradePnls.filter((value) => value > 0).reduce((total, value) => total + value, 0), 6);
            const grossLoss = (0, socialAnalyticsMath_1.roundMetric)(Math.abs(tradePnls.filter((value) => value < 0).reduce((total, value) => total + value, 0)), 6);
            const realizedPnl = (0, socialAnalyticsMath_1.roundMetric)(tradePnls.reduce((total, value) => total + value, 0), 6);
            const roi30d = (0, socialAnalyticsMath_1.getWindowRoi)(equityPoints, 30);
            const roi90d = (0, socialAnalyticsMath_1.getWindowRoi)(equityPoints, 90);
            const maxDrawdown = (0, socialAnalyticsMath_1.calculateMaxDrawdown)(equityPoints);
            const winRate = (0, socialAnalyticsMath_1.calculateWinRate)(winningTrades, tradePnls.length);
            const avgProfit = (0, socialAnalyticsMath_1.calculateAverageProfit)(tradePnls);
            const sharpe = (0, socialAnalyticsMath_1.calculateSharpe)(returns);
            const pnlHistory = (0, socialAnalyticsMath_1.buildPnlHistory)(equityPoints);
            const lastEventAt = events[events.length - 1]?.timestamp ? new Date(events[events.length - 1].timestamp) : null;
            await db.leaderAnalyticsSnapshot.upsert({
                where: {
                    leaderId_sourceChain: {
                        leaderId: leader.id,
                        sourceChain: config_1.config.socialAnalytics.chainName,
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
                    sourceChain: config_1.config.socialAnalytics.chainName,
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
        const indexerStatus = await socialIndexerService_1.socialIndexerService.getStatus();
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
            db.socialIndexedEvent.count({ where: { chain: config_1.config.socialAnalytics.chainName } }),
            db.leaderAnalyticsSnapshot.count({ where: { sourceChain: config_1.config.socialAnalytics.chainName } }),
            db.socialIndexedEvent.findFirst({
                where: { chain: config_1.config.socialAnalytics.chainName },
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
exports.socialAnalyticsService = new SocialAnalyticsService();
//# sourceMappingURL=socialAnalyticsService.js.map