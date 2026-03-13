"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const listingService_1 = require("../services/listingService");
const adminGuard_1 = require("../middleware/adminGuard");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// ─── Logo upload config ──────────────────────────────────────────
const TOKENS_DIR = path_1.default.join(__dirname, '..', '..', 'public', 'tokens');
fs_1.default.mkdirSync(TOKENS_DIR, { recursive: true });
const ALLOWED_MIMES = ['image/svg+xml', 'image/png', 'image/webp'];
const MAX_LOGO_SIZE = 200 * 1024; // 200 KB
const logoStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, TOKENS_DIR),
    filename: (req, file, cb) => {
        const addr = req.body?.tokenAddress ?? 'unknown';
        const ext = file.mimetype === 'image/svg+xml' ? '.svg'
            : file.mimetype === 'image/webp' ? '.webp'
                : '.png';
        cb(null, `${addr}${ext}`);
    },
});
const logoUpload = (0, multer_1.default)({
    storage: logoStorage,
    limits: { fileSize: MAX_LOGO_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIMES.includes(file.mimetype)) {
            return cb(new Error('Invalid file type. Accepted: SVG, PNG, WebP'));
        }
        cb(null, true);
    },
});
// ─── Validation schemas ────────────────────────────────────────────
const CreateListingSchema = zod_1.z.object({
    ownerAddress: zod_1.z.string().min(1),
    tokenAddress: zod_1.z.string().min(1),
    tokenName: zod_1.z.string().min(1),
    tokenSymbol: zod_1.z.string().min(1),
    tokenDecimals: zod_1.z.coerce.number().optional(),
    tier: zod_1.z.enum(['BASIC', 'VERIFIED', 'FEATURED']),
    lunesLiquidity: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
    tokenLiquidity: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
    description: zod_1.z.string().optional(),
    website: zod_1.z.string().optional(),
});
// ── GET /api/v1/listing/tiers ─────────────────────────────────────
// Public: returns all tier configs with fee distribution breakdown
router.get('/tiers', async (_req, res, next) => {
    try {
        const tiers = await (0, listingService_1.getAllTierConfigs)();
        res.json({ tiers });
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/listing/stats ─────────────────────────────────────
// Public: aggregate stats (total locked, by tier/status)
router.get('/stats', async (_req, res, next) => {
    try {
        const stats = await (0, listingService_1.getListingStats)();
        res.json(stats);
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/listing ───────────────────────────────────────────
// Public: paginated listing index
router.get('/', async (req, res, next) => {
    try {
        const tier = req.query.tier;
        const status = req.query.status;
        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
        const offset = parseInt(String(req.query.offset ?? '0'), 10);
        const listings = await (0, listingService_1.getListings)({ tier, status, limit, offset });
        res.json({ listings, limit, offset });
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/listing/token/:tokenAddress ───────────────────────
router.get('/token/:tokenAddress', async (req, res, next) => {
    try {
        const listing = await (0, listingService_1.getListingByToken)(req.params.tokenAddress);
        if (!listing)
            return res.status(404).json({ error: 'Token not listed' });
        res.json(listing);
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/listing/owner/:address ───────────────────────────
router.get('/owner/:address', async (req, res, next) => {
    try {
        const listings = await (0, listingService_1.getOwnerListings)(req.params.address);
        res.json({ listings });
    }
    catch (err) {
        next(err);
    }
});
// ── GET /api/v1/listing/:id ───────────────────────────────────────
router.get('/:id', async (req, res, next) => {
    try {
        const listing = await (0, listingService_1.getListingById)(req.params.id);
        if (!listing)
            return res.status(404).json({ error: 'Listing not found' });
        res.json(listing);
    }
    catch (err) {
        next(err);
    }
});
// ── POST /api/v1/listing ──────────────────────────────────────────
// Create a new token listing with optional logo upload
router.post('/', logoUpload.single('logo'), async (req, res, next) => {
    try {
        const parsed = CreateListingSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { tier, ...rest } = parsed.data;
        const tierKey = tier.toUpperCase();
        if (!listingService_1.TIER_CONFIG[tierKey]) {
            return res.status(400).json({ error: `Invalid tier. Valid values: BASIC, VERIFIED, FEATURED` });
        }
        // Build logoURI from uploaded file
        let logoURI;
        if (req.file) {
            logoURI = `/tokens/${req.file.filename}`;
        }
        const listing = await (0, listingService_1.createListing)({ ...rest, tier: tierKey, logoURI });
        res.status(201).json({
            message: 'Listing created — pending on-chain confirmation',
            listing,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already listed') || msg.includes('Insufficient')) {
            return res.status(400).json({ error: msg });
        }
        if (msg.includes('Invalid file type') || msg.includes('File too large')) {
            return res.status(400).json({ error: msg });
        }
        next(err);
    }
});
// ── POST /api/v1/listing/:id/activate ────────────────────────────
// B2 FIX: requires admin auth — called by trusted relayer after on-chain confirmation
router.post('/:id/activate', adminGuard_1.requireAdmin, async (req, res, next) => {
    try {
        const { onChainListingId, pairAddress, lpTokenAddress, lpAmount, txHash } = req.body;
        const input = { onChainListingId, pairAddress, lpTokenAddress, lpAmount, txHash };
        const listing = await (0, listingService_1.activateListing)(req.params.id, input);
        res.json({ message: 'Listing activated', listing });
    }
    catch (err) {
        next(err);
    }
});
// ── POST /api/v1/listing/:id/reject ──────────────────────────────
// B2 FIX: requires admin auth
router.post('/:id/reject', adminGuard_1.requireAdmin, async (req, res, next) => {
    try {
        const listing = await (0, listingService_1.rejectListing)(req.params.id);
        res.json({ message: 'Listing rejected', listing });
    }
    catch (err) {
        next(err);
    }
});
// ── POST /api/v1/listing/lock/:lockId/withdraw ────────────────────
router.post('/lock/:lockId/withdraw', async (req, res, next) => {
    try {
        const { ownerAddress, txHash } = req.body;
        if (!ownerAddress) {
            return res.status(400).json({ error: 'ownerAddress required' });
        }
        const lock = await (0, listingService_1.withdrawLock)(req.params.lockId, ownerAddress, txHash);
        res.json({ message: 'Lock withdrawn', lock });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('Not the lock owner') || msg.includes('Already withdrawn') || msg.includes('expires')) {
            return res.status(400).json({ error: msg });
        }
        next(err);
    }
});
// ── POST /api/v1/listing/admin/process-expired-locks ─────────────
// B2 FIX: requires admin auth — cron trigger, must not be public
router.post('/admin/process-expired-locks', adminGuard_1.requireAdmin, async (_req, res, next) => {
    try {
        const count = await (0, listingService_1.processExpiredLocks)();
        res.json({ message: `Processed ${count} expired locks` });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=listing.js.map