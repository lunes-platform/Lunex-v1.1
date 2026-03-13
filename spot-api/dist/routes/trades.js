"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tradeService_1 = require("../services/tradeService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
router.get('/settlement/status', async (req, res, next) => {
    try {
        const parsed = validation_1.TradeSettlementQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const trades = await tradeService_1.tradeService.getTradesBySettlementStatus(parsed.data.status, parsed.data.limit, parsed.data.offset);
        res.json({ trades });
    }
    catch (err) {
        next(err);
    }
});
router.post('/settlement/retry', async (req, res, next) => {
    try {
        const parsed = validation_1.RetryTradeSettlementsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await tradeService_1.tradeService.retryTradeSettlements(parsed.data.limit);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:symbol', async (req, res, next) => {
    try {
        const symbol = req.query.symbol ?? req.params.symbol;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const trades = await tradeService_1.tradeService.getRecentTrades(symbol, limit);
        res.json({ trades });
    }
    catch (err) {
        next(err);
    }
});
router.get('/', async (req, res, next) => {
    try {
        // If ?symbol= is provided, return recent trades for that pair
        if (req.query.symbol && typeof req.query.symbol === 'string') {
            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
            const trades = await tradeService_1.tradeService.getRecentTrades(req.query.symbol, limit);
            return res.json({ trades });
        }
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
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=trades.js.map