"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const copytradeService_1 = require("../services/copytradeService");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
router.get('/leaders/:leaderId/api-key/challenge', async (req, res) => {
    try {
        const parsed = validation_1.CopyTradeApiKeyChallengeSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.createApiKeyChallenge(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.get('/vaults', async (_req, res) => {
    try {
        const vaults = await copytradeService_1.copytradeService.listVaults();
        res.json({ vaults });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/positions', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const positions = await copytradeService_1.copytradeService.getUserPositions(address);
        res.json({ positions });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/activity', async (req, res) => {
    try {
        const parsed = validation_1.CopyTradeActivityQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const activity = await copytradeService_1.copytradeService.getActivity(parsed.data.address, parsed.data.limit);
        res.json({ activity });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/vaults/:leaderId', async (req, res) => {
    try {
        const vault = await copytradeService_1.copytradeService.getVaultByLeader(req.params.leaderId);
        res.json({ vault });
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
router.get('/vaults/:leaderId/executions', async (req, res) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const executions = await copytradeService_1.copytradeService.getVaultExecutions(req.params.leaderId, limit);
        res.json({ executions });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/leaders/:leaderId/api-key', async (req, res) => {
    try {
        const parsed = validation_1.CopyTradeApiKeySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.createOrRotateApiKey(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/vaults/:leaderId/deposit', async (req, res) => {
    try {
        const parsed = validation_1.CopyVaultDepositSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.depositToVault(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/vaults/:leaderId/withdraw', async (req, res) => {
    try {
        const parsed = validation_1.CopyVaultWithdrawSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.withdrawFromVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
router.post('/vaults/:leaderId/signals', async (req, res) => {
    try {
        const parsed = validation_1.CopyTradeSignalSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        if (parsed.data.source === 'API') {
            const apiKey = req.header('x-api-key');
            if (!apiKey) {
                return res.status(401).json({ error: 'x-api-key header required for API signals' });
            }
            await copytradeService_1.copytradeService.validateLeaderApiKey(req.params.leaderId, apiKey);
        }
        const result = await copytradeService_1.copytradeService.createSignal(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=copytrade.js.map