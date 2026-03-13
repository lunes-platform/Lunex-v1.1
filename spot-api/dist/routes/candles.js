"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const candleService_1 = require("../services/candleService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
function handleCandles(req, res, next) {
    try {
        const symbol = req.query.symbol ?? req.params.symbol;
        if (!symbol)
            return res.status(400).json({ error: 'symbol required' });
        const parsed = validation_1.CandleQuerySchema.safeParse(req.query);
        const timeframe = parsed.success ? parsed.data.timeframe : '1h';
        const limit = parsed.success ? parsed.data.limit : 200;
        candleService_1.candleService.getCandles(symbol, timeframe, limit).then(candles => {
            res.json({ candles });
        }).catch(next);
    }
    catch (err) {
        next(err);
    }
}
// Support both ?symbol=LUNES/LUSDT and /:symbol (URL-encoded: LUNES%2FLUSDT)
router.get('/', handleCandles);
router.get('/:symbol', handleCandles);
exports.default = router;
//# sourceMappingURL=candles.js.map