"use strict";
/**
 * GET  /api/v1/route/quote  - Simulate routes (no execution)
 * POST /api/v1/route/swap   - Execute via Smart Router V2 (agent auth)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const agentAuth_1 = require("../middleware/agentAuth");
const routerService_1 = require("../services/routerService");
const router = (0, express_1.Router)();
// ─── Schemas ─────────────────────────────────────────────────────
const QuoteSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL']),
    amountIn: zod_1.z.coerce.number().positive(),
});
const SwapSchema = QuoteSchema.extend({
    maxSlippageBps: zod_1.z.coerce.number().int().min(1).max(1000).optional().default(100),
});
// ─── Public: Quote (no auth required) ────────────────────────────
/**
 * GET /api/v1/route/quote?pairSymbol=WLUNES-LUSDT&side=BUY&amountIn=1000
 *
 * Returns the three source simulations and identifies the best route.
 * This endpoint is public — no API key required.
 */
router.get('/quote', async (req, res, next) => {
    try {
        const parsed = QuoteSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const quote = await routerService_1.routerService.getQuote(parsed.data);
        res.json(quote);
    }
    catch (err) {
        next(err);
    }
});
// ─── Protected: Execute (agent auth required) ─────────────────────
router.use((0, agentAuth_1.agentAuth)(['TRADE_SPOT']));
/**
 * POST /api/v1/route/swap
 *
 * Execute a swap via the Smart Router V2. Automatically picks the best
 * source and delegates to the appropriate execution handler.
 *
 * Body: { pairSymbol, side, amountIn, maxSlippageBps? }
 */
router.post('/swap', async (req, res, next) => {
    try {
        const parsed = SwapSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const agent = req.agent;
        const nonce = `router_${agent.id}_${Date.now()}`;
        const result = await routerService_1.routerService.executeViaRouter({
            ...parsed.data,
            makerAddress: agent.walletAddress,
            nonce,
            agentId: agent.id,
        });
        res.status(201).json({ ...result, agentId: agent.id });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=router.js.map