"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const copytradeService_1 = require("../services/copytradeService");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const router = (0, express_1.Router)();
// ─── Read endpoints ───────────────────────────────────────────────
router.get('/leaders/:leaderId/api-key/challenge', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyTradeApiKeyChallengeSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.createApiKeyChallenge(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/vaults', async (_req, res, next) => {
    try {
        const vaults = await copytradeService_1.copytradeService.listVaults();
        res.json({ vaults });
    }
    catch (err) {
        next(err);
    }
});
router.get('/positions', async (req, res, next) => {
    try {
        const { address } = req.query;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'address required' });
        }
        const positions = await copytradeService_1.copytradeService.getUserPositions(address);
        res.json({ positions });
    }
    catch (err) {
        next(err);
    }
});
router.get('/activity', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyTradeActivityQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const activity = await copytradeService_1.copytradeService.getActivity(parsed.data.address, parsed.data.limit);
        res.json({ activity });
    }
    catch (err) {
        next(err);
    }
});
router.get('/vaults/:leaderId', async (req, res, next) => {
    try {
        const vault = await copytradeService_1.copytradeService.getVaultByLeader(req.params.leaderId);
        res.json({ vault });
    }
    catch (err) {
        next(err);
    }
});
router.get('/vaults/:leaderId/executions', async (req, res, next) => {
    try {
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const executions = await copytradeService_1.copytradeService.getVaultExecutions(req.params.leaderId, limit);
        res.json({ executions });
    }
    catch (err) {
        next(err);
    }
});
// ─── Mutations (signed) ──────────────────────────────────────────
router.post('/leaders/:leaderId/api-key', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyTradeApiKeySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await copytradeService_1.copytradeService.createOrRotateApiKey(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/vaults/:leaderId/deposit', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyVaultDepositSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'copytrade.deposit',
            address: parsed.data.followerAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId, token: parsed.data.token, amount: parsed.data.amount },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await copytradeService_1.copytradeService.depositToVault(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/vaults/:leaderId/withdraw', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyVaultWithdrawSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'copytrade.withdraw',
            address: parsed.data.followerAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: { leaderId: req.params.leaderId, shares: parsed.data.shares },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const result = await copytradeService_1.copytradeService.withdrawFromVault(req.params.leaderId, parsed.data);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/vaults/:leaderId/signals', async (req, res, next) => {
    try {
        const parsed = validation_1.CopyTradeSignalSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        if (parsed.data.source === 'API') {
            const apiKey = req.header('x-api-key');
            if (!apiKey)
                return res.status(401).json({ error: 'x-api-key header required for API signals' });
            await copytradeService_1.copytradeService.validateLeaderApiKey(req.params.leaderId, apiKey);
        }
        else {
            if (!parsed.data.leaderAddress || !parsed.data.signature || !parsed.data.nonce || !parsed.data.timestamp) {
                return res.status(401).json({ error: 'WEB3 signals require leaderAddress, nonce, timestamp, and signature' });
            }
            const auth = await (0, auth_1.verifyWalletActionSignature)({
                action: 'copytrade.web3-signal',
                address: parsed.data.leaderAddress,
                nonce: parsed.data.nonce,
                timestamp: parsed.data.timestamp,
                signature: parsed.data.signature,
                fields: {
                    leaderId: req.params.leaderId,
                    pairSymbol: parsed.data.pairSymbol,
                    side: parsed.data.side,
                    source: parsed.data.source,
                    strategyTag: parsed.data.strategyTag || '',
                    amountIn: parsed.data.amountIn,
                    amountOutMin: parsed.data.amountOutMin,
                    route: parsed.data.route || [],
                    maxSlippageBps: parsed.data.maxSlippageBps,
                    executionPrice: parsed.data.executionPrice || '',
                    realizedPnlPct: parsed.data.realizedPnlPct || '',
                },
            });
            if (!auth.ok)
                return res.status(401).json({ error: auth.error });
        }
        const result = await copytradeService_1.copytradeService.createSignal(req.params.leaderId, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=copytrade.js.map