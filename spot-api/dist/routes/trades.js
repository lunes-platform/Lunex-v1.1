"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tradeService_1 = require("../services/tradeService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
router.get('/settlement/status', async (req, res) => {
    try {
        const parsed = validation_1.TradeSettlementQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const trades = await tradeService_1.tradeService.getTradesBySettlementStatus(parsed.data.status, parsed.data.limit, parsed.data.offset);
        res.json({ trades });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/settlement/retry', async (req, res) => {
    try {
        const parsed = validation_1.RetryTradeSettlementsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await tradeService_1.tradeService.retryTradeSettlements(parsed.data.limit);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/trades/:symbol — Recent trades for a pair
router.get('/:symbol', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const trades = await tradeService_1.tradeService.getRecentTrades(req.params.symbol, limit);
        res.json({ trades });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// GET /api/v1/trades?address=... — User trade history
router.get('/', async (req, res) => {
    try {
        const { address } = req.query;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const offset = pagination.success ? pagination.data.offset : 0;
        const trades = await tradeService_1.tradeService.getUserTrades(address, limit, offset);
        res.json({ trades });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=trades.js.map