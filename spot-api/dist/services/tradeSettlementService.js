"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradeSettlementService = void 0;
exports.serializeSettlementInput = serializeSettlementInput;
exports.deserializeSettlementInput = deserializeSettlementInput;
const db_1 = __importDefault(require("../db"));
const settlementService_1 = require("./settlementService");
const prismaAny = db_1.default;
const RETRY_DELAYS_MS = [5000, 15000, 60000, 300000, 900000];
const STALE_SETTLING_MS = 60000;
function serializeSettlementInput(input) {
    return {
        ...input,
        makerOrder: {
            ...input.makerOrder,
            expiresAt: input.makerOrder.expiresAt ? input.makerOrder.expiresAt.toISOString() : null,
        },
        takerOrder: {
            ...input.takerOrder,
            expiresAt: input.takerOrder.expiresAt ? input.takerOrder.expiresAt.toISOString() : null,
        },
    };
}
function deserializeSettlementInput(payload) {
    return {
        ...payload,
        makerOrder: {
            ...payload.makerOrder,
            expiresAt: payload.makerOrder.expiresAt ? new Date(payload.makerOrder.expiresAt) : null,
        },
        takerOrder: {
            ...payload.takerOrder,
            expiresAt: payload.takerOrder.expiresAt ? new Date(payload.takerOrder.expiresAt) : null,
        },
    };
}
function getNextRetryAt(attempts) {
    const delay = RETRY_DELAYS_MS[attempts - 1];
    if (!delay)
        return null;
    return new Date(Date.now() + delay);
}
async function markTradesSkipped(inputs) {
    for (const input of inputs) {
        await prismaAny.trade.update({
            where: { id: input.tradeId },
            data: {
                settlementStatus: 'SKIPPED',
                settlementPayload: serializeSettlementInput(input),
                settlementError: null,
                nextSettlementRetryAt: null,
            },
        });
    }
}
async function markTradesSettling(inputs) {
    const attemptsByTradeId = new Map();
    const startedAt = new Date();
    for (const input of inputs) {
        const updatedTrade = await prismaAny.trade.update({
            where: { id: input.tradeId },
            data: {
                settlementStatus: 'SETTLING',
                settlementAttempts: { increment: 1 },
                settlementPayload: serializeSettlementInput(input),
                settlementError: null,
                lastSettlementAttemptAt: startedAt,
                nextSettlementRetryAt: null,
            },
            select: {
                id: true,
                settlementAttempts: true,
            },
        });
        attemptsByTradeId.set(updatedTrade.id, updatedTrade.settlementAttempts);
    }
    return attemptsByTradeId;
}
async function applySettlementResults(results, attemptsByTradeId) {
    const settledAt = new Date();
    for (const result of results) {
        if (result.status === 'SETTLED') {
            await prismaAny.trade.update({
                where: { id: result.tradeId },
                data: {
                    settlementStatus: 'SETTLED',
                    txHash: result.txHash,
                    settledAt,
                    settlementError: null,
                    nextSettlementRetryAt: null,
                },
            });
            continue;
        }
        if (result.status === 'SKIPPED') {
            await prismaAny.trade.update({
                where: { id: result.tradeId },
                data: {
                    settlementStatus: 'SKIPPED',
                    settlementError: result.error || null,
                    nextSettlementRetryAt: null,
                },
            });
            continue;
        }
        const attempts = attemptsByTradeId.get(result.tradeId) || 1;
        await prismaAny.trade.update({
            where: { id: result.tradeId },
            data: {
                settlementStatus: 'FAILED',
                settlementError: result.error || 'Unknown settlement failure',
                nextSettlementRetryAt: getNextRetryAt(attempts),
            },
        });
    }
}
async function processAttempt(inputs) {
    const attemptsByTradeId = await markTradesSettling(inputs);
    const results = await settlementService_1.settlementService.settleTrades(inputs);
    await applySettlementResults(results, attemptsByTradeId);
    return results;
}
exports.tradeSettlementService = {
    async processNewTradeSettlements(inputs) {
        if (inputs.length === 0)
            return [];
        if (!settlementService_1.settlementService.isEnabled()) {
            await markTradesSkipped(inputs);
            return inputs.map((input) => ({
                tradeId: input.tradeId,
                status: 'SKIPPED',
                error: 'On-chain settlement disabled for this environment',
            }));
        }
        return processAttempt(inputs);
    },
    async retryPendingSettlements(limit = 25) {
        if (!settlementService_1.settlementService.isEnabled()) {
            return {
                processed: 0,
                settled: 0,
                failed: 0,
            };
        }
        const now = new Date();
        const staleSettlingBefore = new Date(now.getTime() - STALE_SETTLING_MS);
        const trades = await prismaAny.trade.findMany({
            where: {
                settlementPayload: { not: null },
                OR: [
                    { settlementStatus: 'PENDING' },
                    { settlementStatus: 'FAILED', nextSettlementRetryAt: { lte: now } },
                    { settlementStatus: 'SETTLING', lastSettlementAttemptAt: { lte: staleSettlingBefore } },
                ],
            },
            orderBy: [{ lastSettlementAttemptAt: 'asc' }, { createdAt: 'asc' }],
            take: limit,
            select: {
                id: true,
                settlementPayload: true,
            },
        });
        const inputs = trades
            .filter((trade) => Boolean(trade.settlementPayload))
            .map((trade) => deserializeSettlementInput(trade.settlementPayload));
        if (inputs.length === 0) {
            return {
                processed: 0,
                settled: 0,
                failed: 0,
            };
        }
        const results = await processAttempt(inputs);
        return {
            processed: results.length,
            settled: results.filter((result) => result.status === 'SETTLED').length,
            failed: results.filter((result) => result.status === 'FAILED').length,
        };
    },
};
//# sourceMappingURL=tradeSettlementService.js.map