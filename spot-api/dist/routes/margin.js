"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const marginService_1 = require("../services/marginService");
const validation_1 = require("../utils/validation");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        const parsed = validation_1.MarginOverviewQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const overview = await marginService_1.marginService.getOverview(parsed.data.address);
        res.json(overview);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.get('/price-health', async (req, res) => {
    try {
        const parsed = validation_1.MarginPriceHealthQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const status = marginService_1.marginService.getPriceHealth(parsed.data.pairSymbol);
        res.json(status);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/price-health/reset', async (req, res) => {
    try {
        const parsed = validation_1.MarginPriceHealthResetSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const status = marginService_1.marginService.resetPriceHealthMonitor(parsed.data.pairSymbol);
        res.json(status);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/collateral/deposit', async (req, res) => {
    try {
        const parsed = validation_1.MarginCollateralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildMarginCollateralMessage)({
            action: 'deposit',
            token: parsed.data.token,
            amount: parsed.data.amount,
        }), parsed.data.signature, parsed.data.address);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const result = await marginService_1.marginService.depositCollateral({
            address: parsed.data.address,
            token: parsed.data.token,
            amount: parsed.data.amount,
            signature: parsed.data.signature,
        });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/collateral/withdraw', async (req, res) => {
    try {
        const parsed = validation_1.MarginCollateralSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildMarginCollateralMessage)({
            action: 'withdraw',
            token: parsed.data.token,
            amount: parsed.data.amount,
        }), parsed.data.signature, parsed.data.address);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const result = await marginService_1.marginService.withdrawCollateral({
            address: parsed.data.address,
            token: parsed.data.token,
            amount: parsed.data.amount,
            signature: parsed.data.signature,
        });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/positions', async (req, res) => {
    try {
        const parsed = validation_1.MarginOpenPositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildMarginOpenPositionMessage)({
            pairSymbol: parsed.data.pairSymbol,
            side: parsed.data.side,
            collateralAmount: parsed.data.collateralAmount,
            leverage: parsed.data.leverage,
        }), parsed.data.signature, parsed.data.address);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
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
        res.status(400).json({ error: err.message });
    }
});
router.post('/positions/:id/close', async (req, res) => {
    try {
        const parsed = validation_1.MarginClosePositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildMarginClosePositionMessage)(req.params.id), parsed.data.signature, parsed.data.address);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const overview = await marginService_1.marginService.closePosition(req.params.id, parsed.data.address);
        res.json(overview);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/positions/:id/liquidate', async (req, res) => {
    try {
        const parsed = validation_1.MarginLiquidatePositionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildMarginLiquidatePositionMessage)(req.params.id), parsed.data.signature, parsed.data.liquidatorAddress);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const overview = await marginService_1.marginService.liquidatePosition(req.params.id, parsed.data.liquidatorAddress);
        res.json(overview);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=margin.js.map