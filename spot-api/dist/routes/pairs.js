"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const orderbook_1 = require("../utils/orderbook");
const factoryService_1 = require("../services/factoryService");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const adminGuard_1 = require("../middleware/adminGuard");
const router = (0, express_1.Router)();
// ─── Public routes ───────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
    try {
        const pairs = await db_1.default.pair.findMany({
            where: { isActive: true },
            orderBy: { symbol: 'asc' },
        });
        res.json({ pairs });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:symbol/ticker', async (req, res, next) => {
    try {
        const { symbol } = req.params;
        const pair = await db_1.default.pair.findUnique({ where: { symbol } });
        if (!pair)
            return res.status(404).json({ error: 'Pair not found' });
        const since = new Date(Date.now() - 86400000);
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
            lastPrice, high24h, low24h, volume24h, quoteVolume24h,
            change24h: parseFloat(change24h.toFixed(2)),
            tradeCount: trades.length,
            bestBid: book?.getBestBid() ?? null,
            bestAsk: book?.getBestAsk() ?? null,
            spread: book?.getSpread() ?? null,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin routes ────────────────────────────────────────────────
router.get('/on-chain', adminGuard_1.requireAdmin, async (_req, res, next) => {
    try {
        if (!config_1.config.blockchain.factoryContractAddress) {
            return res.status(503).json({
                error: 'FACTORY_CONTRACT_ADDRESS not set. On-chain discovery unavailable.',
            });
        }
        const [length, pairs] = await Promise.all([
            factoryService_1.factoryService.getAllPairsLength(),
            factoryService_1.factoryService.getAllPairs(),
        ]);
        res.json({ totalOnChain: length, pairs });
    }
    catch (err) {
        next(err);
    }
});
router.post('/register', adminGuard_1.requireAdmin, async (req, res, next) => {
    try {
        const { symbol, baseToken, quoteToken, baseName, quoteName, baseDecimals = 8, quoteDecimals = 8, isNativeBase = false, isNativeQuote = false, makerFeeBps = 10, takerFeeBps = 25, } = req.body;
        if (!symbol || !baseToken || !quoteToken || !baseName || !quoteName) {
            return res.status(400).json({
                error: 'Missing required fields: symbol, baseToken, quoteToken, baseName, quoteName',
            });
        }
        const existing = await db_1.default.pair.findUnique({ where: { symbol } });
        if (existing) {
            return res.status(409).json({ error: `Pair "${symbol}" is already registered`, pair: existing });
        }
        let pairAddress = null;
        if (config_1.config.blockchain.factoryContractAddress) {
            pairAddress = await factoryService_1.factoryService.getPair(baseToken, quoteToken);
            if (!pairAddress) {
                return res.status(400).json({
                    error: `Pair (${baseToken} / ${quoteToken}) not found on-chain. Call factory.create_pair first.`,
                    hint: 'Use polkadot.js apps or the Lunex admin CLI to call create_pair on the Factory contract.',
                });
            }
            logger_1.log.info({ pairAddress }, '[Pairs] On-chain validation passed');
        }
        else {
            logger_1.log.warn('[Pairs] FACTORY_CONTRACT_ADDRESS not set — skipping on-chain validation');
        }
        const pair = await db_1.default.pair.create({
            data: {
                symbol, baseToken, quoteToken, pairAddress,
                baseName, quoteName, baseDecimals, quoteDecimals,
                isNativeBase, isNativeQuote, makerFeeBps, takerFeeBps, isActive: true,
            },
        });
        logger_1.log.info({ symbol, pairAddress: pairAddress ?? 'N/A' }, '[Pairs] Registered pair');
        res.status(201).json({ pair });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:symbol/sync', adminGuard_1.requireAdmin, async (req, res, next) => {
    try {
        const { symbol } = req.params;
        const pair = await db_1.default.pair.findUnique({ where: { symbol } });
        if (!pair)
            return res.status(404).json({ error: 'Pair not found' });
        if (!config_1.config.blockchain.factoryContractAddress) {
            return res.status(503).json({ error: 'FACTORY_CONTRACT_ADDRESS not configured' });
        }
        const pairAddress = await factoryService_1.factoryService.getPair(pair.baseToken, pair.quoteToken);
        if (!pairAddress) {
            return res.status(400).json({
                error: `Pair not found on-chain for tokens (${pair.baseToken} / ${pair.quoteToken})`,
            });
        }
        const updated = await db_1.default.pair.update({ where: { symbol }, data: { pairAddress } });
        res.json({ pair: updated });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=pairs.js.map