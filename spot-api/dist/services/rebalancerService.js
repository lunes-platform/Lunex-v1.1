"use strict";
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
exports.rebalancerService = void 0;
const library_1 = require("@prisma/client/runtime/library");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_crypto_1 = require("@polkadot/util-crypto");
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const asymmetricService_1 = require("./asymmetricService");
// ─── Constants ──────────────────────────────────────────────────
const EXPONENTIAL_BACKOFF_BASE_MS = 10000; // 10s → 20s → 40s
const ASYMMETRIC_PAIR_ABI_PATH = path.resolve(__dirname, '../../../lunes-dex-main/src/abis/AsymmetricPair.json');
const ACCOUNT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
// ─── Rebalancer Service ─────────────────────────────────────────
class RebalancerService {
    constructor() {
        this.api = null;
        this.relayer = null;
        this.initPromise = null;
        this.asymmetricPairAbi = null;
    }
    isConfigured() {
        return Boolean(config_1.config.blockchain.wsUrl &&
            config_1.config.blockchain.relayerSeed);
    }
    isEnabled() {
        return this.isConfigured();
    }
    async ensureReady() {
        if (!this.isConfigured())
            return false;
        if (!this.initPromise)
            this.initPromise = this.initialize();
        return this.initPromise;
    }
    async initialize() {
        try {
            await (0, util_crypto_1.cryptoWaitReady)();
            const provider = new api_1.WsProvider(config_1.config.blockchain.wsUrl);
            this.api = await api_1.ApiPromise.create({ provider });
            await this.api.isReady;
            const keyring = new api_1.Keyring({ type: 'sr25519' });
            this.relayer = keyring.addFromUri(config_1.config.blockchain.relayerSeed);
            // Load ABI if available (graceful — contract may not be deployed yet)
            try {
                const raw = await fs.readFile(ASYMMETRIC_PAIR_ABI_PATH, 'utf-8');
                this.asymmetricPairAbi = JSON.parse(raw);
            }
            catch {
                logger_1.log.warn('[Rebalancer] AsymmetricPair ABI not found — on-chain updates disabled');
            }
            logger_1.log.info('[Rebalancer] Sentinel ready');
            return true;
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[Rebalancer] Failed to initialize');
            return false;
        }
    }
    // ─── Main entry point called by socialIndexerService ──────────
    /**
     * Triggered when the on-chain indexer detects an AsymmetricSwapExecuted event.
     * Runs the full Sentinel safety pipeline before calling the Relayer.
     */
    async handleCurveExecution(pairAddress, userAddress, acquiredAmount) {
        const strategy = await db_1.default.asymmetricStrategy.findFirst({
            where: {
                pairAddress,
                userAddress,
                isAutoRebalance: true,
                status: { in: ['ACTIVE', 'COOLING_DOWN'] },
            },
        });
        if (!strategy)
            return; // AI agent managing this — backend stays out
        await this.safeRebalance(strategy, acquiredAmount);
    }
    // ─── Sentinel safety pipeline ──────────────────────────────────
    async safeRebalance(strategy, acquiredAmount) {
        // 1. Cooldown — accumulate, don't send
        if ((0, asymmetricService_1.isCoolingDown)(strategy.lastRebalancedAt)) {
            await asymmetricService_1.asymmetricService.accumulatePending(strategy.id, acquiredAmount);
            return;
        }
        // 2. Profitability — avoid burning gas on dust
        const pendingTotal = parseFloat(strategy.pendingAmount.toString()) + acquiredAmount;
        if (!(0, asymmetricService_1.isProfitableToRebalance)(pendingTotal)) {
            await asymmetricService_1.asymmetricService.accumulatePending(strategy.id, acquiredAmount);
            return;
        }
        // 3. Health check — reuse the existing /health endpoint data
        try {
            const health = await this.getSystemHealth(strategy.pairAddress);
            if (health.spread > 1000 || health.oracleAge > 120) {
                logger_1.log.warn({ pairAddress: strategy.pairAddress }, '[Sentinel] High volatility. Rebalance deferred');
                return;
            }
        }
        catch {
            logger_1.log.warn('[Sentinel] Health check unavailable. Rebalance deferred');
            return;
        }
        // 4. Execute with exponential backoff retry
        await this.executeWithRetry(strategy, pendingTotal);
    }
    async executeWithRetry(strategy, totalAmount) {
        const isReady = await this.ensureReady();
        if (!isReady || !this.relayer || !this.api || !this.asymmetricPairAbi) {
            logger_1.log.warn('[Sentinel] Not ready for on-chain execution — skipping');
            return;
        }
        for (let attempt = 0; attempt < asymmetricService_1.asymmetricService.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = EXPONENTIAL_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
                    await sleep(delay);
                }
                const txHash = await this.sendUpdateCurveTx(strategy, totalAmount);
                await asymmetricService_1.asymmetricService.markRebalancedSuccess(strategy.id);
                // Log success
                await db_1.default.asymmetricRebalanceLog.create({
                    data: {
                        strategyId: strategy.id,
                        side: 'SELL', // After buy accumulation, we update the sell curve
                        trigger: 'AUTO_REBALANCER',
                        acquiredAmount: new library_1.Decimal(totalAmount),
                        newCapacity: new library_1.Decimal(totalAmount),
                        txHash,
                        status: 'SUCCESS',
                    },
                });
                logger_1.log.info({ userAddress: strategy.userAddress, txHash }, '[Sentinel] Rebalanced successfully');
                return;
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger_1.log.error({ attempt: attempt + 1, errorMsg }, '[Sentinel] Rebalance attempt failed');
                const suspended = await asymmetricService_1.asymmetricService.recordFailure(strategy.id, errorMsg);
                await db_1.default.asymmetricRebalanceLog.create({
                    data: {
                        strategyId: strategy.id,
                        side: 'SELL',
                        trigger: 'AUTO_REBALANCER',
                        acquiredAmount: new library_1.Decimal(totalAmount),
                        newCapacity: new library_1.Decimal(0),
                        status: 'FAILED',
                        lastError: errorMsg,
                    },
                });
                if (suspended) {
                    logger_1.log.error({ strategyId: strategy.id, maxRetries: asymmetricService_1.asymmetricService.MAX_RETRIES }, '[Sentinel] Strategy SUSPENDED_ERROR after max failures');
                    return;
                }
            }
        }
    }
    async sendUpdateCurveTx(strategy, newCapacity) {
        if (!this.api || !this.relayer || !this.asymmetricPairAbi) {
            throw new Error('Rebalancer not initialized');
        }
        const contract = new api_contract_1.ContractPromise(this.api, this.asymmetricPairAbi, strategy.pairAddress);
        // Dry-run to estimate gas (same pattern as settlementService.ts)
        const { gasRequired, result } = await contract.query.updateCurveParameters(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, false, // isBuy = false — updating sell curve after buy accumulation
        BigInt(Math.floor(newCapacity * 1e8)), strategy.sellGamma, strategy.sellFeeTargetBps);
        if (result.isErr) {
            throw new Error(`[Rebalancer] Gas dry-run failed: ${result.toString()}`);
        }
        return new Promise((resolve, reject) => {
            let unsub;
            contract.tx
                .updateCurveParameters({ gasLimit: gasRequired, storageDepositLimit: null }, false, BigInt(Math.floor(newCapacity * 1e8)), strategy.sellGamma, strategy.sellFeeTargetBps)
                .signAndSend(this.relayer, (txResult) => {
                if (txResult.dispatchError) {
                    if (unsub)
                        unsub();
                    reject(new Error(txResult.dispatchError.toString()));
                    return;
                }
                if (txResult.status.isInBlock || txResult.status.isFinalized) {
                    const txHash = txResult.txHash.toHex();
                    if (unsub)
                        unsub();
                    resolve(txHash);
                }
            })
                .then((unsubscribe) => { unsub = unsubscribe; })
                .catch(reject);
        });
    }
    // ─── Health check (reuses existing /health logic) ──────────────
    async getSystemHealth(pairAddress) {
        if (!ACCOUNT_REGEX.test(pairAddress)) {
            return { spread: 0, oracleAge: 0 };
        }
        // Look up the pair symbol from the strategy to query margin health
        const strategy = await db_1.default.asymmetricStrategy.findFirst({
            where: { pairAddress, status: { in: ['ACTIVE', 'COOLING_DOWN'] } },
            select: { pairAddress: true },
        });
        // Try to derive spread from the orderbook if we can resolve a pair symbol
        const pair = await db_1.default.pair.findFirst({
            where: { contractAddress: pairAddress },
            select: { symbol: true },
        });
        let spread = 0;
        let oracleAge = 0;
        if (pair?.symbol) {
            // 1. Orderbook spread
            const { orderbookManager } = await Promise.resolve().then(() => __importStar(require('../utils/orderbook')));
            const book = orderbookManager.get(pair.symbol);
            if (book) {
                const bestBid = book.getBestBid();
                const bestAsk = book.getBestAsk();
                const lastUpdated = book.getLastUpdatedAt();
                if (bestBid !== null && bestAsk !== null && bestBid > 0) {
                    const mid = (bestBid + bestAsk) / 2;
                    spread = Math.round(((bestAsk - bestBid) / mid) * 10000); // BPS
                }
                if (lastUpdated !== null) {
                    oracleAge = Math.floor((Date.now() - lastUpdated) / 1000); // seconds
                }
            }
            // 2. Margin price health monitor (check if pair is operationally blocked)
            const { marginService } = await Promise.resolve().then(() => __importStar(require('./marginService')));
            const health = marginService.getPriceHealth(pair.symbol);
            if (health.pairs.length > 0) {
                const pairHealth = health.pairs[0];
                if (pairHealth.isOperationallyBlocked) {
                    spread = 10000; // Force-defer: treat blocked pair as extreme spread
                }
            }
        }
        return { spread, oracleAge };
    }
}
// ─── Utility ────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.rebalancerService = new RebalancerService();
//# sourceMappingURL=rebalancerService.js.map