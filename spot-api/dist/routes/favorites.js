"use strict";
/**
 * Favorite Pairs API
 *
 * GET    /api/v1/user/:address/favorites          — list all favorites
 * POST   /api/v1/user/:address/favorites          — add a favorite
 * DELETE /api/v1/user/:address/favorites/:symbol   — remove a favorite
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)({ mergeParams: true });
const AddFavoriteSchema = zod_1.z.object({
    pairSymbol: zod_1.z.string().min(1),
});
// ─── List favorites ─────────────────────────────────────────────
router.get('/:address/favorites', async (req, res, next) => {
    try {
        const { address } = req.params;
        const favorites = await prisma.favorite.findMany({
            where: { walletAddress: address },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ favorites: favorites.map(f => f.pairSymbol) });
    }
    catch (err) {
        next(err);
    }
});
// ─── Add favorite ───────────────────────────────────────────────
router.post('/:address/favorites', async (req, res, next) => {
    try {
        const { address } = req.params;
        const parsed = AddFavoriteSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        await prisma.favorite.upsert({
            where: {
                walletAddress_pairSymbol: {
                    walletAddress: address,
                    pairSymbol: parsed.data.pairSymbol,
                },
            },
            update: {},
            create: {
                walletAddress: address,
                pairSymbol: parsed.data.pairSymbol,
            },
        });
        res.status(201).json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
// ─── Remove favorite ────────────────────────────────────────────
router.delete('/:address/favorites/:symbol', async (req, res, next) => {
    try {
        const { address, symbol } = req.params;
        const decoded = decodeURIComponent(symbol);
        await prisma.favorite.deleteMany({
            where: { walletAddress: address, pairSymbol: decoded },
        });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=favorites.js.map