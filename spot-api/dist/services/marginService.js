"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.marginService = void 0;
const library_1 = require("@prisma/client/runtime/library");
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const helpers_1 = require("../utils/helpers");
const orderbook_1 = require("../utils/orderbook");
const prismaAny = db_1.default;
const DEFAULT_COLLATERAL_TOKEN = 'USDT';
const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 10;
const MAINTENANCE_MARGIN_RATIO = 0.1;
const LIQUIDATION_PENALTY_RATIO = 0.025;
const MIN_OPEN_POSITION_HEALTH_FACTOR = 1.25;
const MAX_SAFE_INITIAL_LEVERAGE = Math.min(MAX_LEVERAGE, Math.floor((1 / (MAINTENANCE_MARGIN_RATIO * MIN_OPEN_POSITION_HEALTH_FACTOR) - 1e-9) * 10) / 10);
const marginPriceMonitor = new Map();
function toDecimal(value) {
    return new library_1.Decimal(typeof value === 'number' ? value.toFixed(18) : value);
}
function getBpsDistance(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        return null;
    }
    return (Math.abs(a - b) / b) * 10000;
}
function getBookMidReference(pairSymbol, now) {
    const book = orderbook_1.orderbookManager.get(pairSymbol);
    if (!book) {
        return null;
    }
    const bestBid = book.getBestBid();
    const bestAsk = book.getBestAsk();
    const lastUpdatedAt = book.getLastUpdatedAt();
    if (bestBid === null || bestAsk === null || lastUpdatedAt === null) {
        return null;
    }
    if (now - lastUpdatedAt > config_1.config.margin.markPriceMaxAgeMs) {
        return null;
    }
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadBps = getBpsDistance(bestAsk, bestBid);
    if (!Number.isFinite(midPrice) || midPrice <= 0 || spreadBps === null) {
        return null;
    }
    const normalizedSpreadBps = ((bestAsk - bestBid) / midPrice) * 10000;
    if (normalizedSpreadBps > config_1.config.margin.maxBookSpreadBps) {
        return null;
    }
    return {
        observedAt: lastUpdatedAt,
        price: midPrice,
        source: 'BOOK_MID',
    };
}
function getPositionUnrealizedPnl(side, entryPrice, markPrice, quantity) {
    return side === 'BUY'
        ? (markPrice - entryPrice) * quantity
        : (entryPrice - markPrice) * quantity;
}
function getLiquidationPrice(side, entryPrice, collateralAmount, maintenanceMargin, quantity) {
    if (quantity <= 0)
        return entryPrice;
    if (side === 'BUY') {
        return entryPrice + (maintenanceMargin - collateralAmount) / quantity;
    }
    return entryPrice + (collateralAmount - maintenanceMargin) / quantity;
}
function toPriceMetadata(reference, now) {
    return {
        source: reference.source,
        observedAt: new Date(reference.observedAt).toISOString(),
        ageMs: Math.max(now - reference.observedAt, 0),
    };
}
function isOperationallyBlocked(consecutiveFailures) {
    return consecutiveFailures >= config_1.config.margin.operationalBlockAfterFailures;
}
function getOperationalBlockError(pairSymbol) {
    return `Margin price health is operationally blocked for ${pairSymbol}`;
}
function recordPriceResolution(pairSymbol, reference, now) {
    const previous = marginPriceMonitor.get(pairSymbol);
    const next = {
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
        console.info(JSON.stringify({
            event: 'margin.safe_mark_price_restored',
            pairSymbol,
            source: reference.source,
            observedAt: next.lastResolvedObservedAt,
            ageMs: next.lastResolvedAgeMs,
            totalSuccesses: next.totalSuccesses,
            totalFailures: next.totalFailures,
            timestamp: next.lastSuccessAt,
        }));
    }
}
function recordPriceFailure(pairSymbol, reason, now) {
    const previous = marginPriceMonitor.get(pairSymbol);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    const next = {
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
    if (!previous || previous.status === 'HEALTHY' || previous.lastFailureReason !== reason) {
        console.error(JSON.stringify({
            event: 'margin.safe_mark_price_unavailable',
            pairSymbol,
            reason,
            isOperationallyBlocked: next.isOperationallyBlocked,
            consecutiveFailures: next.consecutiveFailures,
            totalFailures: next.totalFailures,
            timestamp: next.lastFailureAt,
        }));
    }
}
function assertPairNotOperationallyBlocked(pairSymbol) {
    const state = marginPriceMonitor.get(pairSymbol);
    if (state?.isOperationallyBlocked) {
        throw new Error(getOperationalBlockError(pairSymbol));
    }
}
function getPriceHealthSnapshot(pairSymbol) {
    const pairs = Array.from(marginPriceMonitor.values())
        .filter((entry) => !pairSymbol || entry.pairSymbol === pairSymbol)
        .sort((a, b) => a.pairSymbol.localeCompare(b.pairSymbol));
    const blockedPairs = pairs.filter((entry) => entry.isOperationallyBlocked).length;
    return {
        generatedAt: new Date().toISOString(),
        summary: {
            trackedPairs: pairs.length,
            healthyPairs: pairs.filter((entry) => entry.status === 'HEALTHY').length,
            unhealthyPairs: pairs.filter((entry) => entry.status === 'UNHEALTHY').length,
            hasActiveAlerts: pairs.some((entry) => entry.status === 'UNHEALTHY'),
            blockedPairs,
            operationalBlockAfterFailures: config_1.config.margin.operationalBlockAfterFailures,
        },
        pairs,
    };
}
async function resolveReferencePriceWithClient(client, pairId, pairSymbol) {
    const now = Date.now();
    try {
        const lastTrade = await client.trade.findFirst({
            where: { pairId },
            orderBy: { createdAt: 'desc' },
        });
        const bookReference = getBookMidReference(pairSymbol, now);
        let tradeReference = null;
        if (lastTrade) {
            const observedAt = lastTrade.createdAt ? new Date(lastTrade.createdAt).getTime() : now;
            tradeReference = {
                observedAt,
                price: (0, helpers_1.decimalToNumber)(lastTrade.price),
                source: 'LAST_TRADE',
            };
        }
        if (tradeReference && now - tradeReference.observedAt <= config_1.config.margin.markPriceMaxAgeMs) {
            if (bookReference) {
                const deviationBps = getBpsDistance(tradeReference.price, bookReference.price);
                if (deviationBps !== null && deviationBps > config_1.config.margin.maxTradeToBookDeviationBps) {
                    throw new Error(`Mark price circuit breaker triggered for ${pairSymbol}`);
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
    }
    catch (error) {
        recordPriceFailure(pairSymbol, error.message, now);
        throw error;
    }
}
async function getReferencePriceWithClient(client, pairId, pairSymbol) {
    const reference = await resolveReferencePriceWithClient(client, pairId, pairSymbol);
    return reference.price;
}
async function getReferencePrice(pairId, pairSymbol) {
    return getReferencePriceWithClient(prismaAny, pairId, pairSymbol);
}
async function getOrCreateMarginAccountWithClient(client, address) {
    let account = await client.marginAccount.findUnique({ where: { address } });
    if (!account) {
        account = await client.marginAccount.create({
            data: {
                address,
                collateralToken: DEFAULT_COLLATERAL_TOKEN,
                collateralAvailable: new library_1.Decimal('0'),
                collateralLocked: new library_1.Decimal('0'),
                totalRealizedPnl: new library_1.Decimal('0'),
            },
        });
    }
    return account;
}
async function getOrCreateMarginAccount(address) {
    return getOrCreateMarginAccountWithClient(prismaAny, address);
}
function formatPosition(position) {
    const collateralAmount = (0, helpers_1.decimalToNumber)(position.collateralAmount);
    const notional = (0, helpers_1.decimalToNumber)(position.notional);
    const unrealizedPnl = (0, helpers_1.decimalToNumber)(position.unrealizedPnl);
    const maintenanceMargin = (0, helpers_1.decimalToNumber)(position.maintenanceMargin);
    const equity = collateralAmount + unrealizedPnl;
    const healthFactor = maintenanceMargin > 0 ? equity / maintenanceMargin : null;
    return {
        id: position.id,
        pairSymbol: position.pairSymbol,
        side: position.side,
        status: position.status,
        collateralAmount,
        leverage: (0, helpers_1.decimalToNumber)(position.leverage),
        notional,
        quantity: (0, helpers_1.decimalToNumber)(position.quantity),
        entryPrice: (0, helpers_1.decimalToNumber)(position.entryPrice),
        markPrice: (0, helpers_1.decimalToNumber)(position.markPrice),
        borrowedAmount: (0, helpers_1.decimalToNumber)(position.borrowedAmount),
        maintenanceMargin,
        liquidationPrice: (0, helpers_1.decimalToNumber)(position.liquidationPrice),
        unrealizedPnl,
        realizedPnl: (0, helpers_1.decimalToNumber)(position.realizedPnl),
        equity,
        healthFactor,
        isLiquidatable: equity <= maintenanceMargin,
        openedAt: position.openedAt,
        closedAt: position.closedAt,
        updatedAt: position.updatedAt,
    };
}
function formatPositionWithPriceMetadata(position, priceMetadata) {
    return {
        ...formatPosition(position),
        markPriceMeta: priceMetadata,
    };
}
async function refreshPositionWithClient(client, position) {
    if (position.status !== 'OPEN') {
        return formatPosition(position);
    }
    const reference = await resolveReferencePriceWithClient(client, position.pairId, position.pairSymbol);
    const markPrice = reference.price;
    const metadata = toPriceMetadata(reference, Date.now());
    const entryPrice = (0, helpers_1.decimalToNumber)(position.entryPrice);
    const quantity = (0, helpers_1.decimalToNumber)(position.quantity);
    const collateralAmount = (0, helpers_1.decimalToNumber)(position.collateralAmount);
    const maintenanceMargin = (0, helpers_1.decimalToNumber)(position.maintenanceMargin);
    const unrealizedPnl = getPositionUnrealizedPnl(position.side, entryPrice, markPrice, quantity);
    const liquidationPrice = getLiquidationPrice(position.side, entryPrice, collateralAmount, maintenanceMargin, quantity);
    const updated = await client.marginPosition.update({
        where: { id: position.id },
        data: {
            markPrice: toDecimal(markPrice),
            unrealizedPnl: toDecimal(unrealizedPnl),
            liquidationPrice: toDecimal(liquidationPrice),
        },
    });
    return formatPositionWithPriceMetadata(updated, metadata);
}
async function refreshPosition(position) {
    return refreshPositionWithClient(prismaAny, position);
}
async function getAccountRiskSnapshot(client, account) {
    const openPositions = await client.marginPosition.findMany({
        where: {
            accountId: account.id,
            status: 'OPEN',
        },
        orderBy: { openedAt: 'desc' },
    });
    const refreshedOpenPositions = [];
    for (const position of openPositions) {
        refreshedOpenPositions.push(await refreshPositionWithClient(client, position));
    }
    const totalUnrealizedPnl = refreshedOpenPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    const totalMaintenanceMargin = refreshedOpenPositions.reduce((sum, position) => sum + position.maintenanceMargin, 0);
    const totalEquity = (0, helpers_1.decimalToNumber)(account.collateralAvailable) + (0, helpers_1.decimalToNumber)(account.collateralLocked) + totalUnrealizedPnl;
    return {
        positions: refreshedOpenPositions,
        totalUnrealizedPnl,
        totalMaintenanceMargin,
        totalEquity,
    };
}
async function getAccountPositions(accountId) {
    const positions = await prismaAny.marginPosition.findMany({
        where: { accountId },
        orderBy: { openedAt: 'desc' },
    });
    const formatted = [];
    for (const position of positions) {
        formatted.push(await refreshPosition(position));
    }
    return formatted;
}
function getOverviewPriceHealth(positions) {
    const openPositions = positions.filter((position) => position.status === 'OPEN' && position.markPriceMeta);
    if (openPositions.length === 0) {
        return null;
    }
    const latestObservedAt = openPositions.reduce((latest, position) => {
        const observedAt = position.markPriceMeta ? new Date(position.markPriceMeta.observedAt).getTime() : 0;
        return Math.max(latest, observedAt);
    }, 0);
    const maxAgeMs = openPositions.reduce((maxAge, position) => {
        const ageMs = position.markPriceMeta?.ageMs ?? 0;
        return Math.max(maxAge, ageMs);
    }, 0);
    const sources = Array.from(new Set(openPositions.map((position) => position.markPriceMeta?.source).filter(Boolean)));
    return {
        sources,
        latestObservedAt: latestObservedAt > 0 ? new Date(latestObservedAt).toISOString() : null,
        maxAgeMs,
        hasStaleMarks: maxAgeMs > config_1.config.margin.markPriceMaxAgeMs,
    };
}
function escapePrometheusLabel(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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
        `lunex_margin_mark_price_active_alerts ${snapshot.summary.hasActiveAlerts ? 1 : 0}`,
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
        lines.push(`lunex_margin_mark_price_pair_status{${pairLabel}} ${pair.status === 'HEALTHY' ? 1 : 0}`);
        lines.push(`lunex_margin_mark_price_pair_operationally_blocked{${pairLabel}} ${pair.isOperationallyBlocked ? 1 : 0}`);
        lines.push(`lunex_margin_mark_price_pair_consecutive_failures{${pairLabel}} ${pair.consecutiveFailures}`);
        lines.push(`lunex_margin_mark_price_pair_total_failures{${pairLabel}} ${pair.totalFailures}`);
        lines.push(`lunex_margin_mark_price_pair_total_successes{${pairLabel}} ${pair.totalSuccesses}`);
        lines.push(`lunex_margin_mark_price_pair_last_resolved_age_ms{${pairLabel}} ${pair.lastResolvedAgeMs ?? 0}`);
    }
    return `${lines.join('\n')}\n`;
}
exports.marginService = {
    getPriceHealth(pairSymbol) {
        return getPriceHealthSnapshot(pairSymbol);
    },
    getPriceHealthSummary() {
        return getPriceHealthSnapshot().summary;
    },
    getPriceHealthMetrics() {
        return toPrometheusMetrics();
    },
    resetPriceHealthMonitor(pairSymbol) {
        if (pairSymbol) {
            marginPriceMonitor.delete(pairSymbol);
            return getPriceHealthSnapshot(pairSymbol);
        }
        marginPriceMonitor.clear();
        return getPriceHealthSnapshot();
    },
    async getOverview(address) {
        const account = await getOrCreateMarginAccount(address);
        const positions = await getAccountPositions(account.id);
        const openPositions = positions.filter((position) => position.status === 'OPEN');
        const totalUnrealizedPnl = openPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
        const totalEquity = (0, helpers_1.decimalToNumber)(account.collateralAvailable) + (0, helpers_1.decimalToNumber)(account.collateralLocked) + totalUnrealizedPnl;
        const markPriceHealth = getOverviewPriceHealth(positions);
        return {
            account: {
                id: account.id,
                address: account.address,
                collateralToken: account.collateralToken,
                collateralAvailable: (0, helpers_1.decimalToNumber)(account.collateralAvailable),
                collateralLocked: (0, helpers_1.decimalToNumber)(account.collateralLocked),
                totalRealizedPnl: (0, helpers_1.decimalToNumber)(account.totalRealizedPnl),
                totalEquity,
                updatedAt: account.updatedAt,
            },
            positions,
            risk: {
                openPositions: openPositions.length,
                totalUnrealizedPnl,
                liquidatablePositions: openPositions.filter((position) => position.isLiquidatable).length,
                markPriceHealth,
            },
        };
    },
    async depositCollateral(input) {
        const amount = parseFloat(input.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('Collateral amount must be positive');
        const updated = await db_1.default.$transaction(async (tx) => {
            const txAny = tx;
            const account = await getOrCreateMarginAccountWithClient(txAny, input.address);
            const nextAccount = await txAny.marginAccount.update({
                where: { id: account.id },
                data: {
                    collateralAvailable: account.collateralAvailable.plus(input.amount),
                },
            });
            await txAny.marginCollateralTransfer.create({
                data: {
                    accountId: account.id,
                    direction: 'DEPOSIT',
                    status: 'CONFIRMED',
                    token: input.token || DEFAULT_COLLATERAL_TOKEN,
                    amount: new library_1.Decimal(input.amount),
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
                collateralAvailable: (0, helpers_1.decimalToNumber)(updated.collateralAvailable),
                collateralLocked: (0, helpers_1.decimalToNumber)(updated.collateralLocked),
                totalRealizedPnl: (0, helpers_1.decimalToNumber)(updated.totalRealizedPnl),
                updatedAt: updated.updatedAt,
            },
        };
    },
    async withdrawCollateral(input) {
        const amount = parseFloat(input.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('Collateral amount must be positive');
        const updated = await db_1.default.$transaction(async (tx) => {
            const txAny = tx;
            const account = await getOrCreateMarginAccountWithClient(txAny, input.address);
            if ((0, helpers_1.decimalToNumber)(account.collateralAvailable) < amount) {
                throw new Error('Insufficient available collateral');
            }
            const riskSnapshot = await getAccountRiskSnapshot(txAny, account);
            const postWithdrawalEquity = riskSnapshot.totalEquity - amount;
            if (riskSnapshot.totalMaintenanceMargin > 0 && postWithdrawalEquity <= riskSnapshot.totalMaintenanceMargin) {
                throw new Error('Withdrawal would breach maintenance margin requirements');
            }
            const nextAccount = await txAny.marginAccount.update({
                where: { id: account.id },
                data: {
                    collateralAvailable: account.collateralAvailable.minus(input.amount),
                },
            });
            await txAny.marginCollateralTransfer.create({
                data: {
                    accountId: account.id,
                    direction: 'WITHDRAW',
                    status: 'CONFIRMED',
                    token: input.token || DEFAULT_COLLATERAL_TOKEN,
                    amount: new library_1.Decimal(input.amount),
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
                collateralAvailable: (0, helpers_1.decimalToNumber)(updated.collateralAvailable),
                collateralLocked: (0, helpers_1.decimalToNumber)(updated.collateralLocked),
                totalRealizedPnl: (0, helpers_1.decimalToNumber)(updated.totalRealizedPnl),
                updatedAt: updated.updatedAt,
            },
        };
    },
    async openPosition(input) {
        const collateralAmount = parseFloat(input.collateralAmount);
        const leverage = parseFloat(input.leverage);
        if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) {
            throw new Error('Collateral amount must be positive');
        }
        if (!Number.isFinite(leverage) || leverage < MIN_LEVERAGE || leverage > MAX_SAFE_INITIAL_LEVERAGE) {
            throw new Error(`Leverage must be between ${MIN_LEVERAGE}x and ${MAX_SAFE_INITIAL_LEVERAGE.toFixed(2)}x`);
        }
        assertPairNotOperationallyBlocked(input.pairSymbol);
        const position = await db_1.default.$transaction(async (tx) => {
            const txAny = tx;
            const pair = await tx.pair.findUnique({ where: { symbol: input.pairSymbol } });
            if (!pair || !pair.isActive) {
                throw new Error(`Pair ${input.pairSymbol} not found or inactive`);
            }
            const account = await getOrCreateMarginAccountWithClient(txAny, input.address);
            if ((0, helpers_1.decimalToNumber)(account.collateralAvailable) < collateralAmount) {
                throw new Error('Insufficient available collateral');
            }
            const riskSnapshot = await getAccountRiskSnapshot(txAny, account);
            const entryPrice = await getReferencePriceWithClient(txAny, pair.id, input.pairSymbol);
            const notional = collateralAmount * leverage;
            const quantity = notional / entryPrice;
            const borrowedAmount = Math.max(notional - collateralAmount, 0);
            const maintenanceMargin = notional * MAINTENANCE_MARGIN_RATIO;
            const initialHealthFactor = maintenanceMargin > 0 ? collateralAmount / maintenanceMargin : null;
            if (initialHealthFactor === null || initialHealthFactor <= MIN_OPEN_POSITION_HEALTH_FACTOR) {
                throw new Error('Requested leverage creates insufficient initial margin buffer');
            }
            const postOpenMaintenanceMargin = riskSnapshot.totalMaintenanceMargin + maintenanceMargin;
            if (riskSnapshot.totalEquity <= postOpenMaintenanceMargin) {
                throw new Error('Insufficient account equity for requested margin exposure');
            }
            const liquidationPrice = getLiquidationPrice(input.side, entryPrice, collateralAmount, maintenanceMargin, quantity);
            await txAny.marginAccount.update({
                where: { id: account.id },
                data: {
                    collateralAvailable: account.collateralAvailable.minus(input.collateralAmount),
                    collateralLocked: account.collateralLocked.plus(input.collateralAmount),
                },
            });
            return await txAny.marginPosition.create({
                data: {
                    accountId: account.id,
                    pairId: pair.id,
                    pairSymbol: input.pairSymbol,
                    side: input.side,
                    status: 'OPEN',
                    collateralAmount: new library_1.Decimal(input.collateralAmount),
                    leverage: new library_1.Decimal(input.leverage),
                    notional: toDecimal(notional),
                    quantity: toDecimal(quantity),
                    entryPrice: toDecimal(entryPrice),
                    markPrice: toDecimal(entryPrice),
                    borrowedAmount: toDecimal(borrowedAmount),
                    maintenanceMargin: toDecimal(maintenanceMargin),
                    liquidationPrice: toDecimal(liquidationPrice),
                    unrealizedPnl: new library_1.Decimal('0'),
                    realizedPnl: new library_1.Decimal('0'),
                },
            });
        });
        return {
            position: await refreshPosition(position),
            overview: await this.getOverview(input.address),
        };
    },
    async closePosition(positionId, address) {
        await db_1.default.$transaction(async (tx) => {
            const txAny = tx;
            const position = await txAny.marginPosition.findUnique({
                where: { id: positionId },
                include: { account: true },
            });
            if (!position)
                throw new Error('Margin position not found');
            if (!position.account || position.account.address !== address)
                throw new Error('Not position owner');
            if (position.status !== 'OPEN')
                throw new Error('Position is not open');
            const refreshed = await refreshPositionWithClient(txAny, position);
            const account = await txAny.marginAccount.findUnique({ where: { id: position.account.id } });
            if (!account)
                throw new Error('Margin account not found');
            const netRelease = Math.max(refreshed.collateralAmount + refreshed.unrealizedPnl, 0);
            await txAny.marginAccount.update({
                where: { id: account.id },
                data: {
                    collateralAvailable: account.collateralAvailable.plus(netRelease.toFixed(18)),
                    collateralLocked: account.collateralLocked.minus(position.collateralAmount.toString()),
                    totalRealizedPnl: account.totalRealizedPnl.plus(refreshed.unrealizedPnl.toFixed(18)),
                },
            });
            await txAny.marginPosition.update({
                where: { id: position.id },
                data: {
                    status: 'CLOSED',
                    markPrice: toDecimal(refreshed.markPrice),
                    unrealizedPnl: new library_1.Decimal('0'),
                    realizedPnl: toDecimal(refreshed.unrealizedPnl),
                    closedAt: new Date(),
                },
            });
        });
        return await this.getOverview(address);
    },
    async liquidatePosition(positionId, liquidatorAddress) {
        let ownerAddress = '';
        await db_1.default.$transaction(async (tx) => {
            const txAny = tx;
            const position = await txAny.marginPosition.findUnique({
                where: { id: positionId },
                include: { account: true },
            });
            if (!position)
                throw new Error('Margin position not found');
            if (!position.account)
                throw new Error('Margin account not found');
            if (position.status !== 'OPEN')
                throw new Error('Position is not open');
            const refreshed = await refreshPositionWithClient(txAny, position);
            if (!refreshed.isLiquidatable) {
                throw new Error('Position is not liquidatable');
            }
            const account = await txAny.marginAccount.findUnique({ where: { id: position.account.id } });
            if (!account)
                throw new Error('Margin account not found');
            ownerAddress = account.address;
            const penaltyAmount = Math.min(refreshed.collateralAmount * LIQUIDATION_PENALTY_RATIO, Math.max(refreshed.equity, 0));
            const releasedCollateral = Math.max(refreshed.equity - penaltyAmount, 0);
            await txAny.marginAccount.update({
                where: { id: account.id },
                data: {
                    collateralAvailable: account.collateralAvailable.plus(releasedCollateral.toFixed(18)),
                    collateralLocked: account.collateralLocked.minus(position.collateralAmount.toString()),
                    totalRealizedPnl: account.totalRealizedPnl.plus((refreshed.unrealizedPnl - penaltyAmount).toFixed(18)),
                },
            });
            await txAny.marginPosition.update({
                where: { id: position.id },
                data: {
                    status: 'LIQUIDATED',
                    markPrice: toDecimal(refreshed.markPrice),
                    unrealizedPnl: new library_1.Decimal('0'),
                    realizedPnl: toDecimal(refreshed.unrealizedPnl - penaltyAmount),
                    closedAt: new Date(),
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
//# sourceMappingURL=marginService.js.map