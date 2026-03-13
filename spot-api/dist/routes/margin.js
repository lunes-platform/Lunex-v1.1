"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const marginService_1 = require("../services/marginService");
const validation_1 = require("../utils/validation");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─── Read ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginOverviewQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const overview = await marginService_1.marginService.getOverview(parsed.data.address);
        res.json(overview);
    }
    catch (err) {
        next(err);
    }
});
router.get('/price-health', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginPriceHealthQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const status = marginService_1.marginService.getPriceHealth(parsed.data.pairSymbol);
        res.json(status);
    }
    catch (err) {
        next(err);
    }
});
router.post('/price-health/reset', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginPriceHealthResetSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const status = marginService_1.marginService.resetPriceHealthMonitor(parsed.data.pairSymbol);
        res.json(status);
    }
    catch (err) {
        next(err);
    }
});
// ─── Collateral (signed) ─────────────────────────────────────────
router.post('/collateral/deposit', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginCollateralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'margin.collateral.deposit',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { token: parsed.data.token, amount: parsed.data.amount },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await marginService_1.marginService.depositCollateral({
            address: parsed.data.address,
            token: parsed.data.token,
            amount: parsed.data.amount,
            signature: parsed.data.signature,
        });
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/collateral/withdraw', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginCollateralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'margin.collateral.withdraw',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { token: parsed.data.token, amount: parsed.data.amount },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await marginService_1.marginService.withdrawCollateral({
            address: parsed.data.address,
            token: parsed.data.token,
            amount: parsed.data.amount,
            signature: parsed.data.signature,
        });
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
// ─── Positions (signed) ──────────────────────────────────────────
router.post('/positions', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginOpenPositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'margin.position.open',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: {
                pairSymbol: parsed.data.pairSymbol,
                side: parsed.data.side,
                collateralAmount: parsed.data.collateralAmount,
                leverage: parsed.data.leverage,
            },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await marginService_1.marginService.openPosition({
            address: parsed.data.address,
            pairSymbol: parsed.data.pairSymbol,
            side: parsed.data.side,
            collateralAmount: parsed.data.collateralAmount,
            leverage: parsed.data.leverage,
            signature: parsed.data.signature,
        });
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/positions/:id/close', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginClosePositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'margin.position.close',
            address: parsed.data.address,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { positionId: req.params.id },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const overview = await marginService_1.marginService.closePosition(req.params.id, parsed.data.address);
        res.json(overview);
    }
    catch (err) {
        next(err);
    }
});
router.post('/positions/:id/liquidate', async (req, res, next) => {
    try {
        const parsed = validation_1.MarginLiquidatePositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'margin.position.liquidate',
            address: parsed.data.liquidatorAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { positionId: req.params.id },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const overview = await marginService_1.marginService.liquidatePosition(req.params.id, parsed.data.liquidatorAddress);
        res.json(overview);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=margin.js.map