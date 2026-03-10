"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const candleService_1 = require("../services/candleService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
// GET /api/v1/candles/:symbol?timeframe=1h&limit=200
router.get('/:symbol', async (req, res) => {
    try {
        const parsed = validation_1.CandleQuerySchema.safeParse(req.query);
        const timeframe = parsed.success ? parsed.data.timeframe : '1h';
        const limit = parsed.success ? parsed.data.limit : 200;
        const candles = await candleService_1.candleService.getCandles(req.params.symbol, timeframe, limit);
        res.json({ candles });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=candles.js.map