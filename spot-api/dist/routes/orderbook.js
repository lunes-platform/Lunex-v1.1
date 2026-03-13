"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const orderbook_1 = require("../utils/orderbook");
const router = (0, express_1.Router)();
function handleOrderbook(req, res, next) {
    try {
        const symbol = req.query.symbol ?? req.params.symbol;
        if (!symbol)
            return res.status(400).json({ error: 'symbol required' });
        const depth = Math.min(parseInt(req.query.depth, 10) || 25, 200);
        const book = orderbook_1.orderbookManager.get(symbol);
        if (!book)
            return res.json({ bids: [], asks: [], spread: null });
        const snapshot = book.getSnapshot(depth);
        res.json({
            ...snapshot,
            spread: book.getSpread(),
            bestBid: book.getBestBid(),
            bestAsk: book.getBestAsk(),
        });
    }
    catch (err) {
        next(err);
    }
}
// Support both ?symbol=LUNES/LUSDT and /:symbol (URL-encoded: LUNES%2FLUSDT)
router.get('/', handleOrderbook);
router.get('/:symbol', handleOrderbook);
exports.default = router;
//# sourceMappingURL=orderbook.js.map