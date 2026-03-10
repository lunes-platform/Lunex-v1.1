"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const orderbook_1 = require("../utils/orderbook");
const router = (0, express_1.Router)();
// GET /api/v1/orderbook/:symbol?depth=25
router.get('/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const depth = parseInt(req.query.depth) || 25;
        const book = orderbook_1.orderbookManager.get(symbol);
        if (!book) {
            return res.json({ bids: [], asks: [], spread: null });
        }
        const snapshot = book.getSnapshot(depth);
        res.json({
            ...snapshot,
            spread: book.getSpread(),
            bestBid: book.getBestBid(),
            bestAsk: book.getBestAsk(),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=orderbook.js.map