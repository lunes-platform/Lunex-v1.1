"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tokenRegistryService_1 = require("../services/tokenRegistryService");
const adminGuard_1 = require("../middleware/adminGuard");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// ── GET /api/v1/tokens ───────────────────────────────────────────
router.get('/', async (req, res, next) => {
    try {
        const verified = req.query.verified === 'true' ? true : req.query.verified === 'false' ? false : undefined;
        const trusted = req.query.trusted === 'true' ? true : req.query.trusted === 'false' ? false : undefined;
        const tokens = await (0, tokenRegistryService_1.getAllTokens)({ verified, trusted });
        res.json({ tokens });
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/tokens/search?q= ────────────────────────────────
router.get('/search', async (req, res, next) => {
    try {
        const q = String(req.query.q ?? '');
        const tokens = await (0, tokenRegistryService_1.searchTokens)(q);
        res.json({ tokens });
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/tokens/:address ──────────────────────────────────
router.get('/:address', async (req, res, next) => {
    try {
        const token = await (0, tokenRegistryService_1.getToken)(req.params.address);
        if (!token)
            return res.status(404).json({ error: 'Token not found in registry' });
        res.json(token);
    }
    catch (err) {
        next(err);
    }
});
// ── POST /api/v1/tokens (admin) ──────────────────────────────────
const RegisterSchema = zod_1.z.object({
    address: zod_1.z.string().min(1),
    symbol: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    decimals: zod_1.z.number().optional(),
    logoURI: zod_1.z.string().optional(),
    isVerified: zod_1.z.boolean().optional(),
    isTrusted: zod_1.z.boolean().optional(),
    source: zod_1.z.string().optional(),
});
router.post('/', adminGuard_1.requireAdmin, async (req, res, next) => {
    try {
        const parsed = RegisterSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const token = await (0, tokenRegistryService_1.registerToken)(parsed.data);
        res.status(201).json({ message: 'Token registered', token });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=tokenRegistry.js.map