"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const orderbook_1 = require("../utils/orderbook");
const router = (0, express_1.Router)();
// GET /api/v1/pairs — List all active pairs
router.get('/', async (_req, res) => {
    try {
        const pairs = await db_1.default.pair.findMany({
            where: { isActive: true },
            orderBy: { symbol: 'asc' },
        });
        res.json({ pairs });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/pairs/:symbol/ticker — 24h ticker for a pair
router.get('/:symbol/ticker', async (req, res) => {
    try {
        const { symbol } = req.params;
        const pair = await db_1.default.pair.findUnique({ where: { symbol } });
        if (!pair)
            return res.status(404).json({ error: 'Pair not found' });
        const since = new Date(Date.now() - 86400000); // 24h ago
        const trades = await db_1.default.trade.findMany({
            where: { pairId: pair.id, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
        });
        const book = orderbook_1.orderbookManager.get(symbol);
        const lastPrice = trades.length > 0 ? parseFloat(trades[0].price.toString()) : 0;
        const firstPrice = trades.length > 0 ? parseFloat(trades[trades.length - 1].price.toString()) : 0;
        const high24h = trades.length > 0 ? Math.max(...trades.map(t => parseFloat(t.price.toString()))) : 0;
        const low24h = trades.length > 0 ? Math.min(...trades.map(t => parseFloat(t.price.toString()))) : 0;
        const volume24h = trades.reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
        const quoteVolume24h = trades.reduce((sum, t) => sum + parseFloat(t.quoteAmount.toString()), 0);
        const change24h = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
        res.json({
            symbol: pair.symbol,
            lastPrice,
            high24h,
            low24h,
            volume24h,
            quoteVolume24h,
            change24h: parseFloat(change24h.toFixed(2)),
            tradeCount: trades.length,
            bestBid: book?.getBestBid() ?? null,
            bestAsk: book?.getBestAsk() ?? null,
            spread: book?.getSpread() ?? null,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=pairs.js.map