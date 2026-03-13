"use strict";
/**
 * Market Info API
 *
 * GET /api/v1/markets/:pairSymbol/info — aggregated pair info
 *
 * Combines: Prisma Pair model + SubQuery pairStats + ticker cache
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const subqueryClient_1 = require("../services/subqueryClient");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
router.get('/:pairSymbol/info', async (req, res, next) => {
    try {
        const symbol = decodeURIComponent(req.params.pairSymbol);
        // Fetch pair metadata from DB
        const pair = await prisma.pair.findUnique({ where: { symbol } });
        if (!pair) {
            return res.status(404).json({ error: 'Pair not found' });
        }
        // Fetch on-chain stats from SubQuery (graceful fallback)
        let pairStats = null;
        try {
            if (subqueryClient_1.subqueryClient.isEnabled()) {
                pairStats = await subqueryClient_1.subqueryClient.getPairStats(symbol);
            }
        }
        catch {
            // SubQuery offline — continue with DB-only data
        }
        res.json({
            pair: {
                symbol: pair.symbol,
                baseName: pair.baseName,
                quoteName: pair.quoteName,
                baseToken: pair.baseToken,
                quoteToken: pair.quoteToken,
                pairAddress: pair.pairAddress || null,
                baseDecimals: pair.baseDecimals,
                quoteDecimals: pair.quoteDecimals,
                makerFeeBps: pair.makerFeeBps,
                takerFeeBps: pair.takerFeeBps,
                listingDate: pair.createdAt,
            },
            onChain: pairStats ? {
                swapCount: pairStats.swapCount,
                volumeToken0: pairStats.volumeToken0,
                volumeToken1: pairStats.volumeToken1,
                lastSwapAt: pairStats.lastSwapAt,
            } : null,
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=marketInfo.js.map