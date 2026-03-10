"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradeService = void 0;
const db_1 = __importDefault(require("../db"));
const candleService_1 = require("./candleService");
const library_1 = require("@prisma/client/runtime/library");
const tradeSettlementService_1 = require("./tradeSettlementService");
const affiliateService_1 = require("./affiliateService");
const prismaAny = db_1.default;
exports.tradeService = {
    /**
     * Process matches from the matching engine.
     * Updates orders, creates trades, updates candles.
     */
    async processMatches(pairId, matches) {
        const trades = [];
        const settlementInputs = [];
        for (const match of matches) {
            const trade = await db_1.default.$transaction(async (tx) => {
                const txAny = tx;
                // 1. Update maker order
                const makerOrder = await tx.order.findUnique({ where: { id: match.makerOrderId } });
                if (!makerOrder)
                    throw new Error('Maker order not found');
                const makerNewFilled = new library_1.Decimal(makerOrder.filledAmount.toString())
                    .plus(match.fillAmount.toString());
                const makerNewRemaining = new library_1.Decimal(makerOrder.amount.toString())
                    .minus(makerNewFilled.toString());
                const makerStatus = makerNewRemaining.lte(0) ? 'FILLED' : 'PARTIAL';
                await tx.order.update({
                    where: { id: match.makerOrderId },
                    data: {
                        filledAmount: makerNewFilled,
                        remainingAmount: makerNewRemaining.lt(0) ? new library_1.Decimal(0) : makerNewRemaining,
                        status: makerStatus,
                    },
                });
                // 2. Update taker order
                const takerOrder = await tx.order.findUnique({ where: { id: match.takerOrderId } });
                if (!takerOrder)
                    throw new Error('Taker order not found');
                const takerNewFilled = new library_1.Decimal(takerOrder.filledAmount.toString())
                    .plus(match.fillAmount.toString());
                const takerNewRemaining = new library_1.Decimal(takerOrder.amount.toString())
                    .minus(takerNewFilled.toString());
                const takerStatus = takerNewRemaining.lte(0) ? 'FILLED' : 'PARTIAL';
                await tx.order.update({
                    where: { id: match.takerOrderId },
                    data: {
                        filledAmount: takerNewFilled,
                        remainingAmount: takerNewRemaining.lt(0) ? new library_1.Decimal(0) : takerNewRemaining,
                        status: takerStatus,
                    },
                });
                // 3. Get pair for fee calculation
                const pair = await tx.pair.findUnique({ where: { id: pairId } });
                if (!pair)
                    throw new Error('Pair not found');
                const quoteAmount = match.fillAmount * match.fillPrice;
                const makerFee = quoteAmount * pair.makerFeeBps / 10000;
                const takerFee = quoteAmount * pair.takerFeeBps / 10000;
                // 4. Determine taker side
                const takerSide = takerOrder.side;
                const settlementInput = {
                    tradeId: 'pending-trade-id',
                    pair: {
                        baseToken: pair.baseToken,
                        quoteToken: pair.quoteToken,
                        isNativeBase: pair.isNativeBase,
                        isNativeQuote: pair.isNativeQuote,
                        baseDecimals: pair.baseDecimals,
                    },
                    makerOrder: {
                        makerAddress: makerOrder.makerAddress,
                        side: makerOrder.side,
                        price: makerOrder.price.toString(),
                        amount: makerOrder.amount.toString(),
                        filledAmount: makerOrder.filledAmount.toString(),
                        nonce: makerOrder.nonce,
                        expiresAt: makerOrder.expiresAt,
                    },
                    takerOrder: {
                        makerAddress: takerOrder.makerAddress,
                        side: takerOrder.side,
                        price: takerOrder.price.toString(),
                        amount: takerOrder.amount.toString(),
                        filledAmount: takerOrder.filledAmount.toString(),
                        nonce: takerOrder.nonce,
                        expiresAt: takerOrder.expiresAt,
                    },
                    fillAmount: match.fillAmount.toString(),
                    fillPrice: match.fillPrice.toString(),
                };
                // 5. Create trade record
                const newTrade = await txAny.trade.create({
                    data: {
                        pairId,
                        makerOrderId: match.makerOrderId,
                        takerOrderId: match.takerOrderId,
                        makerAddress: match.makerAddress,
                        takerAddress: match.takerAddress,
                        side: takerSide,
                        price: new library_1.Decimal(match.fillPrice.toString()),
                        amount: new library_1.Decimal(match.fillAmount.toString()),
                        quoteAmount: new library_1.Decimal(quoteAmount.toString()),
                        makerFee: new library_1.Decimal(makerFee.toString()),
                        takerFee: new library_1.Decimal(takerFee.toString()),
                        settlementStatus: 'PENDING',
                        settlementAttempts: 0,
                        settlementPayload: (0, tradeSettlementService_1.serializeSettlementInput)({
                            ...settlementInput,
                            tradeId: 'trade-id-placeholder',
                        }),
                    },
                });
                const persistedSettlementInput = {
                    ...settlementInput,
                    tradeId: newTrade.id,
                };
                await txAny.trade.update({
                    where: { id: newTrade.id },
                    data: {
                        settlementPayload: (0, tradeSettlementService_1.serializeSettlementInput)(persistedSettlementInput),
                    },
                });
                settlementInputs.push(persistedSettlementInput);
                return newTrade;
            });
            trades.push(trade);
            // 6. Update candles (outside transaction for performance)
            try {
                await candleService_1.candleService.updateCandle(pairId, match.fillPrice, match.fillAmount, match.fillPrice * match.fillAmount);
            }
            catch (err) {
                console.error('Failed to update candle:', err);
            }
        }
        await tradeSettlementService_1.tradeSettlementService.processNewTradeSettlements(settlementInputs);
        // Distribute affiliate commissions for each trade
        for (const trade of trades) {
            try {
                const pair = await db_1.default.pair.findUnique({ where: { id: trade.pairId } });
                if (!pair)
                    continue;
                const takerFee = parseFloat(trade.takerFee.toString());
                const makerFee = parseFloat(trade.makerFee.toString());
                if (takerFee > 0) {
                    await affiliateService_1.affiliateService.distributeCommissions(trade.takerAddress, pair.quoteName, takerFee, 'SPOT', trade.id);
                }
                if (makerFee > 0) {
                    await affiliateService_1.affiliateService.distributeCommissions(trade.makerAddress, pair.quoteName, makerFee, 'SPOT', trade.id);
                }
            }
            catch (err) {
                console.error('Affiliate commission distribution failed for trade', trade.id, err);
            }
        }
        return trades;
    },
    /**
     * Get recent trades for a pair
     */
    async getRecentTrades(pairSymbol, limit = 50) {
        const pair = await db_1.default.pair.findUnique({ where: { symbol: pairSymbol } });
        if (!pair)
            throw new Error('Pair not found');
        return db_1.default.trade.findMany({
            where: { pairId: pair.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
    /**
     * Get trades for a specific user
     */
    async getUserTrades(address, limit = 50, offset = 0) {
        return db_1.default.trade.findMany({
            where: {
                OR: [{ makerAddress: address }, { takerAddress: address }],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: {
                pair: { select: { symbol: true } },
            },
        });
    },
    async getTradesBySettlementStatus(status, limit = 50, offset = 0) {
        return prismaAny.trade.findMany({
            where: status ? { settlementStatus: status } : undefined,
            orderBy: [{ createdAt: 'desc' }],
            take: limit,
            skip: offset,
            include: {
                pair: { select: { symbol: true } },
            },
        });
    },
    async retryTradeSettlements(limit = 25) {
        return tradeSettlementService_1.tradeSettlementService.retryPendingSettlements(limit);
    },
};
//# sourceMappingURL=tradeService.js.map