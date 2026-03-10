"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderService = void 0;
const db_1 = __importDefault(require("../db"));
const orderbook_1 = require("../utils/orderbook");
const helpers_1 = require("../utils/helpers");
const tradeService_1 = require("./tradeService");
const library_1 = require("@prisma/client/runtime/library");
const settlementService_1 = require("./settlementService");
const STOP_PENDING_STATUS = 'PENDING_TRIGGER';
function decimalToUnits(value, decimals) {
    const normalized = value.trim();
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [wholePart, fractionPart = ''] = unsigned.split('.');
    const base = 10n ** BigInt(decimals);
    const whole = BigInt(wholePart || '0') * base;
    const fraction = BigInt((fractionPart + '0'.repeat(decimals)).slice(0, decimals) || '0');
    const result = whole + fraction;
    return negative ? -result : result;
}
async function getReferencePrice(pairId, pairSymbol) {
    const lastTrade = await db_1.default.trade.findFirst({
        where: { pairId },
        orderBy: { createdAt: 'desc' },
    });
    if (lastTrade) {
        return (0, helpers_1.decimalToNumber)(lastTrade.price);
    }
    const book = orderbook_1.orderbookManager.get(pairSymbol);
    if (!book)
        return null;
    const bestBid = book.getBestBid();
    const bestAsk = book.getBestAsk();
    if (bestBid !== null && bestAsk !== null) {
        return (bestBid + bestAsk) / 2;
    }
    return bestBid ?? bestAsk ?? null;
}
function isStopTriggered(order, referencePrice) {
    const stopPrice = order.stopPrice ? (0, helpers_1.decimalToNumber)(order.stopPrice) : 0;
    if (stopPrice <= 0)
        return false;
    return order.side === 'BUY'
        ? referencePrice >= stopPrice
        : referencePrice <= stopPrice;
}
async function finalizeMarketLikeOrder(orderId) {
    const updatedOrder = await db_1.default.order.findUnique({ where: { id: orderId } });
    if (!updatedOrder)
        throw new Error('Order not found after execution');
    if (updatedOrder.remainingAmount.gt(0) && updatedOrder.status !== 'FILLED') {
        return db_1.default.order.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' },
        });
    }
    return updatedOrder;
}
async function executeOrderOnBook(pairId, pairSymbol, order) {
    const executableAmount = (0, helpers_1.decimalToNumber)(order.remainingAmount);
    if (executableAmount <= 0) {
        return db_1.default.order.findUnique({ where: { id: order.id } });
    }
    const book = orderbook_1.orderbookManager.getOrCreate(pairSymbol);
    let matches;
    if (order.type === 'MARKET' || order.type === 'STOP') {
        matches = book.addMarketOrder(order.id, order.side, executableAmount, order.makerAddress);
    }
    else {
        matches = book.addLimitOrder(order.id, order.side, (0, helpers_1.decimalToNumber)(order.price), executableAmount, order.makerAddress);
    }
    if (matches.length > 0) {
        await tradeService_1.tradeService.processMatches(pairId, matches);
    }
    if (order.type === 'MARKET' || order.type === 'STOP') {
        return finalizeMarketLikeOrder(order.id);
    }
    return db_1.default.order.findUnique({ where: { id: order.id } });
}
async function processTriggeredOrders(pairId, pairSymbol) {
    let iteration = 0;
    while (iteration < 20) {
        iteration += 1;
        const referencePrice = await getReferencePrice(pairId, pairSymbol);
        if (referencePrice === null)
            return;
        const pendingOrders = await db_1.default.order.findMany({
            where: {
                pairId,
                type: { in: ['STOP', 'STOP_LIMIT'] },
                status: STOP_PENDING_STATUS,
            },
            orderBy: { createdAt: 'asc' },
        });
        const triggeredOrder = pendingOrders.find((order) => isStopTriggered(order, referencePrice));
        if (!triggeredOrder)
            return;
        const activatedOrder = await db_1.default.order.update({
            where: { id: triggeredOrder.id },
            data: { status: 'OPEN' },
        });
        await executeOrderOnBook(pairId, pairSymbol, activatedOrder);
    }
}
async function estimateRequiredQuoteUnits(pair, order) {
    let executionPrice = parseFloat(order.price?.toString() || '0');
    if (executionPrice <= 0 && (order.type === 'STOP' || order.type === 'STOP_LIMIT')) {
        executionPrice = parseFloat(order.stopPrice?.toString() || '0');
    }
    if (executionPrice <= 0) {
        executionPrice = (await getReferencePrice(pair.id, pair.symbol)) || 0;
    }
    if (executionPrice <= 0) {
        throw new Error('Unable to estimate quote required for BUY order from on-chain vault state');
    }
    const quoteEstimate = executionPrice * parseFloat(order.amount.toString());
    return decimalToUnits(quoteEstimate.toFixed(pair.quoteDecimals), pair.quoteDecimals);
}
async function getReservedVaultAmounts(makerAddress, tokenAddress, side) {
    const relevantOrders = await db_1.default.order.findMany({
        where: {
            makerAddress,
            status: { in: ['OPEN', 'PARTIAL', STOP_PENDING_STATUS] },
        },
        include: {
            pair: true,
        },
    });
    let reserved = 0n;
    for (const order of relevantOrders) {
        if (side === 'SELL' && order.side === 'SELL' && order.pair.baseToken === tokenAddress) {
            reserved += decimalToUnits(order.remainingAmount.toString(), order.pair.baseDecimals);
        }
        if (side === 'BUY' && order.side === 'BUY' && order.pair.quoteToken === tokenAddress) {
            reserved += await estimateRequiredQuoteUnits({
                id: order.pair.id,
                symbol: order.pair.symbol,
                quoteDecimals: order.pair.quoteDecimals,
            }, {
                type: order.type,
                price: order.price,
                stopPrice: order.stopPrice,
                amount: order.remainingAmount,
            });
        }
    }
    return reserved;
}
async function assertValidOnChainState(pair, input) {
    const settlementEnabled = settlementService_1.settlementService.isEnabled();
    const onChainNonceUsed = await settlementService_1.settlementService.isNonceUsed(input.makerAddress, input.nonce);
    if (settlementEnabled && onChainNonceUsed === null) {
        throw new Error('On-chain nonce validation unavailable');
    }
    if (onChainNonceUsed)
        throw new Error('Nonce already used on-chain');
    const onChainNonceCancelled = await settlementService_1.settlementService.isNonceCancelled(input.makerAddress, input.nonce);
    if (settlementEnabled && onChainNonceCancelled === null) {
        throw new Error('On-chain cancel validation unavailable');
    }
    if (onChainNonceCancelled)
        throw new Error('Nonce already cancelled on-chain');
    const requiredBase = input.side === 'SELL'
        ? decimalToUnits(input.amount, pair.baseDecimals)
        : 0n;
    let requiredQuote = 0n;
    if (input.side === 'BUY') {
        requiredQuote = await estimateRequiredQuoteUnits(pair, {
            type: input.type,
            price: input.price,
            stopPrice: input.stopPrice,
            amount: input.amount,
        });
    }
    if (requiredBase > 0n) {
        const baseBalance = await settlementService_1.settlementService.getVaultBalance(input.makerAddress, pair.baseToken, pair.isNativeBase);
        if (settlementEnabled && baseBalance === null) {
            throw new Error('On-chain base balance validation unavailable');
        }
        const reservedBase = await getReservedVaultAmounts(input.makerAddress, pair.baseToken, 'SELL');
        if (baseBalance !== null && baseBalance - reservedBase < requiredBase) {
            throw new Error('Insufficient base token balance in Spot vault');
        }
    }
    if (requiredQuote > 0n) {
        const quoteBalance = await settlementService_1.settlementService.getVaultBalance(input.makerAddress, pair.quoteToken, pair.isNativeQuote);
        if (settlementEnabled && quoteBalance === null) {
            throw new Error('On-chain quote balance validation unavailable');
        }
        const reservedQuote = await getReservedVaultAmounts(input.makerAddress, pair.quoteToken, 'BUY');
        if (quoteBalance !== null && quoteBalance - reservedQuote < requiredQuote) {
            throw new Error('Insufficient quote token balance in Spot vault');
        }
    }
}
exports.orderService = {
    /**
     * Create a new order, attempt matching, persist to DB
     */
    async createOrder(input) {
        // 1. Find pair
        const pair = await db_1.default.pair.findUnique({
            where: { symbol: input.pairSymbol },
        });
        if (!pair)
            throw new Error(`Pair ${input.pairSymbol} not found`);
        if (!pair.isActive)
            throw new Error(`Pair ${input.pairSymbol} is not active`);
        // 2. Validate price for executable order types
        const price = input.price || '0';
        if ((input.type === 'LIMIT' || input.type === 'STOP_LIMIT') && parseFloat(price) <= 0) {
            throw new Error('Price required for LIMIT/STOP_LIMIT orders');
        }
        if ((input.type === 'STOP' || input.type === 'STOP_LIMIT') && parseFloat(input.stopPrice || '0') <= 0) {
            throw new Error('stopPrice required for STOP/STOP_LIMIT orders');
        }
        // 3. Compute order hash
        const orderHash = (0, helpers_1.computeOrderHash)({
            makerAddress: input.makerAddress,
            pairSymbol: input.pairSymbol,
            side: input.side,
            type: input.type,
            price,
            stopPrice: input.stopPrice,
            amount: input.amount,
            nonce: input.nonce,
            timeInForce: input.timeInForce,
            expiresAt: input.expiresAt || null,
        });
        // 4. Check nonce uniqueness
        const existing = await db_1.default.order.findFirst({
            where: {
                makerAddress: input.makerAddress,
                nonce: input.nonce,
            },
        });
        if (existing)
            throw new Error('Nonce already used');
        await assertValidOnChainState(pair, input);
        // 5. Create order in DB
        const order = await db_1.default.order.create({
            data: {
                pairId: pair.id,
                makerAddress: input.makerAddress,
                side: input.side,
                type: input.type,
                price: new library_1.Decimal(price),
                stopPrice: input.stopPrice ? new library_1.Decimal(input.stopPrice) : null,
                amount: new library_1.Decimal(input.amount),
                remainingAmount: new library_1.Decimal(input.amount),
                filledAmount: new library_1.Decimal('0'),
                status: input.type === 'STOP' || input.type === 'STOP_LIMIT' ? STOP_PENDING_STATUS : 'OPEN',
                signature: input.signature,
                nonce: input.nonce,
                orderHash,
                timeInForce: input.timeInForce,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            },
        });
        // 6. Add active orders to the in-memory book and attempt matching
        if (input.type === 'LIMIT' || input.type === 'MARKET') {
            await executeOrderOnBook(pair.id, pair.symbol, order);
        }
        await processTriggeredOrders(pair.id, pair.symbol);
        return db_1.default.order.findUnique({ where: { id: order.id } });
    },
    /**
     * Cancel an order
     */
    async cancelOrder(orderId, makerAddress) {
        const order = await db_1.default.order.findUnique({ where: { id: orderId } });
        if (!order)
            throw new Error('Order not found');
        if (order.makerAddress !== makerAddress)
            throw new Error('Not order owner');
        if (order.status === 'FILLED')
            throw new Error('Order already filled');
        if (order.status === 'CANCELLED')
            throw new Error('Order already cancelled');
        // Remove from in-memory orderbook
        const pair = await db_1.default.pair.findUnique({ where: { id: order.pairId } });
        if (pair) {
            const book = orderbook_1.orderbookManager.get(pair.symbol);
            if (book)
                book.cancelOrder(orderId);
        }
        await settlementService_1.settlementService.cancelOrderFor(makerAddress, order.nonce);
        // Update DB
        const updated = await db_1.default.order.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' },
        });
        return updated;
    },
    /**
     * Get orders for a user
     */
    async getUserOrders(makerAddress, status, limit = 50, offset = 0) {
        const where = { makerAddress };
        if (status)
            where.status = status;
        return db_1.default.order.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: { pair: { select: { symbol: true } } },
        });
    },
    /**
     * Get open orders for a pair (for API)
     */
    async getOpenOrders(pairSymbol, limit = 50) {
        const pair = await db_1.default.pair.findUnique({ where: { symbol: pairSymbol } });
        if (!pair)
            throw new Error('Pair not found');
        return db_1.default.order.findMany({
            where: { pairId: pair.id, status: { in: ['OPEN', 'PARTIAL'] } },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
};
//# sourceMappingURL=orderService.js.map