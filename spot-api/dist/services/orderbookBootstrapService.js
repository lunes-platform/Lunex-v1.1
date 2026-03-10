"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rehydrateOrderbooks = rehydrateOrderbooks;
const db_1 = __importDefault(require("../db"));
const helpers_1 = require("../utils/helpers");
const orderbook_1 = require("../utils/orderbook");
const RESTING_ORDER_TYPES = ['LIMIT', 'STOP_LIMIT'];
const RESTING_ORDER_STATUSES = ['OPEN', 'PARTIAL'];
async function rehydrateOrderbooks() {
    orderbook_1.orderbookManager.clearAll();
    const openOrders = await db_1.default.order.findMany({
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
        const remainingAmount = (0, helpers_1.decimalToNumber)(order.remainingAmount);
        const totalAmount = (0, helpers_1.decimalToNumber)(order.amount);
        const price = (0, helpers_1.decimalToNumber)(order.price);
        if (!order.pair || remainingAmount <= 0 || totalAmount <= 0 || price <= 0) {
            continue;
        }
        const book = orderbook_1.orderbookManager.getOrCreate(order.pair.symbol);
        book.restoreLimitOrder(order.id, order.side, price, totalAmount, remainingAmount, order.makerAddress, order.createdAt.getTime());
        restoredOrders += 1;
    }
    return {
        restoredOrders,
        restoredBooks: orderbook_1.orderbookManager.getAll().size,
    };
}
//# sourceMappingURL=orderbookBootstrapService.js.map