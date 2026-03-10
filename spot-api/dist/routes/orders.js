"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const orderService_1 = require("../services/orderService");
const validation_1 = require("../utils/validation");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/v1/orders — Create a new order
router.post('/', async (req, res) => {
    try {
        const parsed = validation_1.CreateOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildSpotOrderMessage)({
            pairSymbol: parsed.data.pairSymbol,
            side: parsed.data.side,
            type: parsed.data.type,
            price: parsed.data.price,
            stopPrice: parsed.data.stopPrice,
            amount: parsed.data.amount,
            nonce: parsed.data.nonce,
        }), parsed.data.signature, parsed.data.makerAddress);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const order = await orderService_1.orderService.createOrder(parsed.data);
        res.status(201).json({ order });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// DELETE /api/v1/orders/:id — Cancel an order
router.delete('/:id', async (req, res) => {
    try {
        const parsed = validation_1.CancelOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const isValid = await (0, auth_1.verifyAddressSignature)((0, auth_1.buildSpotCancelMessage)(req.params.id), parsed.data.signature, parsed.data.makerAddress);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const order = await orderService_1.orderService.cancelOrder(req.params.id, parsed.data.makerAddress);
        res.json({ order });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// GET /api/v1/orders?makerAddress=...&status=...
router.get('/', async (req, res) => {
    try {
        const { makerAddress, status } = req.query;
        if (!makerAddress || typeof makerAddress !== 'string') {
            return res.status(400).json({ error: 'makerAddress required' });
        }
        const pagination = validation_1.PaginationSchema.safeParse(req.query);
        const limit = pagination.success ? pagination.data.limit : 50;
        const offset = pagination.success ? pagination.data.offset : 0;
        const orders = await orderService_1.orderService.getUserOrders(makerAddress, typeof status === 'string' ? status : undefined, limit, offset);
        res.json({ orders });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=orders.js.map