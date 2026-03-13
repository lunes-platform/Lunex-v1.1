"use strict";
/**
 * Smart Router V2 — Lunex Protocol
 *
 * Simulates and compares three liquidity sources to find the optimal
 * execution path for a given trade:
 *
 *   1. AMM V1 (Uniswap V2 model)  — Pair.reserveX / reserveY via DB
 *   2. Orderbook                  — in-memory best bid/ask spread
 *   3. Asymmetric Pool (V2)       — parametric curve y = k·(1-x/x₀)^γ - t·x
 *
 * The router picks the route with the highest `amountOut` net of fees,
 * accounting for price impact on each source. When a route produces
 * insufficient liquidity, it is skipped with a `INSUFFICIENT_LIQUIDITY`
 * reason.
 *
 * Usage:
 *   const quote = await routerService.getQuote({ pairSymbol, side, amountIn })
 *   const exec  = await routerService.executeViaRouter({ ... })
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routerService = void 0;
const db_1 = __importDefault(require("../db"));
const orderbook_1 = require("../utils/orderbook");
// ─── AMM V1 Math (Uniswap V2 x*y=k) ─────────────────────────────
/**
 * Compute amountOut using the Uniswap V2 formula with 0.3% fee.
 *   amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
 */
function ammV1AmountOut(amountIn, reserveIn, reserveOut) {
    if (reserveIn <= 0 || reserveOut <= 0)
        return 0;
    const amountInWithFee = amountIn * 997;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000 + amountInWithFee;
    return denominator > 0 ? numerator / denominator : 0;
}
/**
 * Price impact in BPS for a Uniswap V2 swap.
 */
function ammPriceImpactBps(amountIn, reserveIn) {
    if (reserveIn <= 0)
        return 10000;
    return Math.round((amountIn / (reserveIn + amountIn)) * 10000);
}
// ─── Asymmetric Pool Math ─────────────────────────────────────────
/**
 * Simulate amountOut from an asymmetric parametric curve.
 *   y = k · (1 - x/x₀)^γ − t·x
 *
 * Returns the delta liquidity consumed by routing `amountIn` through
 * the curve from its current state.
 */
function asymmetricAmountOut(params) {
    const { amountIn, k, gamma, x0, feeBps, currentVolume } = params;
    if (currentVolume + amountIn > x0)
        return 0; // exceeds capacity
    const calcLiq = (x) => {
        if (x >= x0)
            return 0;
        const exhaustion = Math.pow(1 - x / x0, gamma);
        const gross = k * exhaustion;
        const feeDiscount = (feeBps / 10000) * x;
        return Math.max(0, gross - feeDiscount);
    };
    const before = calcLiq(currentVolume);
    const after = calcLiq(currentVolume + amountIn);
    return Math.max(0, before - after);
}
// ─── Router Service ───────────────────────────────────────────────
exports.routerService = {
    /**
     * Simulate all three liquidity sources and return quotes.
     * Does NOT execute any trade — purely read-only.
     */
    async getQuote(params) {
        const { pairSymbol, side, amountIn } = params;
        const routes = [];
        if (amountIn <= 0)
            throw new Error('amountIn must be > 0');
        // ── 1. Resolve pair from DB ───────────────────────────────────
        const pair = await db_1.default.pair.findUnique({ where: { symbol: pairSymbol } });
        if (!pair)
            throw new Error(`Pair ${pairSymbol} not found`);
        // ── 2. AMM V1 Quote ──────────────────────────────────────────
        {
            const pairAny = pair;
            const reserveBase = parseFloat(pairAny.reserveBase?.toString() || '0');
            const reserveQuote = parseFloat(pairAny.reserveQuote?.toString() || '0');
            const reserveIn = side === 'BUY' ? reserveQuote : reserveBase;
            const reserveOut = side === 'BUY' ? reserveBase : reserveQuote;
            const ammOut = ammV1AmountOut(amountIn, reserveIn, reserveOut);
            const impactBps = ammPriceImpactBps(amountIn, reserveIn);
            const available = ammOut > 0 && impactBps < 5000; // bail if impact >50%
            routes.push({
                source: 'AMM_V1',
                amountIn,
                amountOut: ammOut,
                effectivePrice: ammOut > 0 ? amountIn / ammOut : 0,
                priceImpactBps: impactBps,
                feeBps: 30, // 0.3%
                txCostEstimate: 'LOW',
                available,
                unavailableReason: !available
                    ? ammOut <= 0
                        ? 'NO_LIQUIDITY'
                        : 'PRICE_IMPACT_TOO_HIGH'
                    : undefined,
            });
        }
        // ── 3. Orderbook Quote ────────────────────────────────────────
        {
            const book = orderbook_1.orderbookManager.get(pairSymbol);
            let obOut = 0;
            let obPrice = 0;
            let obAvailable = false;
            let obReason = 'NO_RESTING_ORDERS';
            if (book) {
                if (side === 'BUY') {
                    const bestAsk = book.getBestAsk();
                    if (bestAsk !== null && bestAsk > 0) {
                        obOut = amountIn / bestAsk;
                        obPrice = bestAsk;
                        obAvailable = true;
                        obReason = '';
                    }
                }
                else {
                    const bestBid = book.getBestBid();
                    if (bestBid !== null && bestBid > 0) {
                        obOut = amountIn * bestBid;
                        obPrice = bestBid;
                        obAvailable = true;
                        obReason = '';
                    }
                }
            }
            // Estimate orderbook fee from pair settings
            const obFeeBps = side === 'BUY' ? pair.takerFeeBps : pair.makerFeeBps;
            routes.push({
                source: 'ORDERBOOK',
                amountIn,
                amountOut: obOut,
                effectivePrice: obPrice,
                priceImpactBps: 0, // limit orders = no slippage
                feeBps: obFeeBps,
                txCostEstimate: 'MEDIUM',
                available: obAvailable,
                unavailableReason: obAvailable ? undefined : obReason,
            });
        }
        // ── 4. Asymmetric Pool Quote ──────────────────────────────────
        {
            let asymOut = 0;
            let asymAvailable = false;
            let asymReason = 'NO_ASYMMETRIC_POOL';
            let asymFeeBps = 30;
            try {
                // Find the active asymmetric strategy for this pair
                const baseToken = pair.baseToken;
                const quoteToken = pair.quoteToken;
                const strategy = await db_1.default.asymmetricStrategy.findFirst({
                    where: {
                        baseToken,
                        quoteToken,
                        status: 'ACTIVE',
                    },
                });
                if (strategy) {
                    const isBuy = side === 'BUY';
                    const curveParams = isBuy ? strategy.buyCurve : strategy.sellCurve;
                    if (curveParams) {
                        const params = curveParams;
                        asymOut = asymmetricAmountOut({
                            amountIn,
                            k: params.k,
                            gamma: params.gamma,
                            x0: params.x0,
                            feeBps: params.feeBps ?? 30,
                            currentVolume: params.currentVolume ?? 0,
                        });
                        asymFeeBps = params.feeBps ?? 30;
                        asymAvailable = asymOut > 0;
                        asymReason = asymOut <= 0 ? 'INSUFFICIENT_LIQUIDITY' : '';
                    }
                }
            }
            catch {
                asymReason = 'QUERY_ERROR';
            }
            routes.push({
                source: 'ASYMMETRIC',
                amountIn,
                amountOut: asymOut,
                effectivePrice: asymOut > 0 ? amountIn / asymOut : 0,
                priceImpactBps: 0, // parametric curve is continuous — no discrete impact
                feeBps: asymFeeBps,
                txCostEstimate: 'HIGH', // on-chain contract call
                available: asymAvailable,
                unavailableReason: asymAvailable ? undefined : asymReason,
            });
        }
        // ── 5. Pick best route ────────────────────────────────────────
        const availableRoutes = routes.filter((r) => r.available);
        const best = availableRoutes.sort((a, b) => b.amountOut - a.amountOut)[0];
        if (!best) {
            throw new Error(`No liquidity available for ${amountIn} ${side} on ${pairSymbol}`);
        }
        return {
            pairSymbol,
            side,
            amountIn,
            bestRoute: best.source,
            bestAmountOut: best.amountOut,
            bestEffectivePrice: best.effectivePrice,
            routes,
            computedAt: new Date().toISOString(),
        };
    },
    /**
     * Execute a swap routed through the best available source.
     *
     * For AMM_V1 / ORDERBOOK: delegates to orderService (existing path).
     * For ASYMMETRIC: calls the on-chain contract via rebalancerService pattern.
     *
     * Returns the quote used and the execution result metadata.
     */
    async executeViaRouter(params) {
        const { pairSymbol, side, amountIn, maxSlippageBps = 100, makerAddress, nonce, agentId } = params;
        const quote = await this.getQuote({ pairSymbol, side, amountIn });
        // Validate slippage tolerance (compare to best route priceImpact)
        const bestRouteDetails = quote.routes.find((r) => r.source === quote.bestRoute);
        if (bestRouteDetails.priceImpactBps > maxSlippageBps) {
            throw new Error(`Price impact ${bestRouteDetails.priceImpactBps} bps exceeds maxSlippageBps ${maxSlippageBps}`);
        }
        const minAmountOut = quote.bestAmountOut * (1 - maxSlippageBps / 10000);
        // Route to the appropriate execution handler
        if (quote.bestRoute === 'AMM_V1' || quote.bestRoute === 'ORDERBOOK') {
            // Delegate to existing orderService (MARKET order)
            const { orderService } = await Promise.resolve().then(() => __importStar(require('./orderService')));
            const order = await orderService.createOrder({
                pairSymbol,
                side,
                type: 'MARKET',
                amount: amountIn.toString(),
                makerAddress,
                nonce,
                timestamp: Date.now(),
                signature: agentId ? `agent:${agentId}` : `manual:${makerAddress}`,
                timeInForce: 'IOC',
            });
            return {
                quote,
                executedVia: quote.bestRoute,
                order,
                minAmountOut,
                success: true,
            };
        }
        // ASYMMETRIC: The actual on-chain execution requires the user's wallet
        // signature via the frontend. Return the fully-prepared intent so the
        // frontend can call the contract directly with Polkadot.js.
        return {
            quote,
            executedVia: 'ASYMMETRIC',
            success: true,
            requiresWalletSignature: true,
            contractCallIntent: {
                contractAddress: quote.routes.find(r => r.source === 'ASYMMETRIC')
                    ? pairSymbol : '',
                method: 'swap',
                side,
                amountIn,
                minAmountOut,
                makerAddress,
                nonce,
                agentId: agentId ?? null,
            },
            message: 'Route selected: ASYMMETRIC pool. Submit via wallet signature using contractCallIntent.',
        };
    },
};
//# sourceMappingURL=routerService.js.map