"use strict";
/**
 * Reward Payout Service — Real On-Chain Integration
 *
 * Handles actual LUNES transfers using the relayer wallet:
 * 1. fund_staking_rewards — payable call to send LUNES into staking pool
 * 2. distribute_trading_rewards_paginated — trigger staker reward distribution
 * 3. transferNative — direct LUNES transfer to leader wallets
 *
 * Uses the same ApiPromise + relayer pattern as settlementService.
 * Follows ink! 4.x best practices (https://use.ink/docs/v4/).
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewardPayoutService = void 0;
exports.lunesToPlancks = lunesToPlancks;
exports.plancksToLunes = plancksToLunes;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_crypto_1 = require("@polkadot/util-crypto");
const util_1 = require("@polkadot/util");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const txWithTimeout_1 = require("../utils/txWithTimeout");
// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeMethodKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function resolveMethod(contract, label, kind) {
    const expected = normalizeMethodKey(label);
    const source = kind === 'tx' ? contract.tx : contract.query;
    return Object.keys(source).find(k => normalizeMethodKey(k).includes(expected)) || null;
}
// LUNES has 8 decimals (like BTC)
const LUNES_DECIMALS = 8;
const PLANCKS_PER_LUNES = BigInt(10 ** LUNES_DECIMALS);
/** Convert a human-readable LUNES amount to plancks (smallest unit). */
function lunesToPlancks(amount) {
    // Use string manipulation to avoid floating point issues
    const str = amount.toFixed(LUNES_DECIMALS);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = (frac + '0'.repeat(LUNES_DECIMALS)).slice(0, LUNES_DECIMALS);
    return BigInt(whole) * PLANCKS_PER_LUNES + BigInt(paddedFrac);
}
/** Convert plancks to human-readable LUNES. */
function plancksToLunes(plancks) {
    const whole = plancks / PLANCKS_PER_LUNES;
    const frac = plancks % PLANCKS_PER_LUNES;
    return Number(whole) + Number(frac) / Number(PLANCKS_PER_LUNES);
}
// ─── Service ─────────────────────────────────────────────────────────────────
class RewardPayoutService {
    constructor() {
        this.api = null;
        this.stakingContract = null;
        this.relayer = null;
        this.initPromise = null;
        // Resolved method keys
        this.fundMethodKey = null;
        this.distributeMethodKey = null;
        this.distributePaginatedMethodKey = null;
    }
    // ─── Configuration Check ───────────────────────────────────────────────
    isConfigured() {
        return Boolean(config_1.config.blockchain.wsUrl &&
            config_1.config.blockchain.relayerSeed &&
            config_1.config.rewards.stakingContractAddress);
    }
    isEnabled() {
        return config_1.config.rewards.enabled && this.isConfigured();
    }
    // ─── Initialization ────────────────────────────────────────────────────
    async ensureReady() {
        if (!this.isConfigured())
            return false;
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }
    async initialize() {
        try {
            await (0, util_crypto_1.cryptoWaitReady)();
            const metadataPath = path.resolve(config_1.config.rewards.stakingContractMetadataPath);
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
            const provider = new api_1.WsProvider(config_1.config.blockchain.wsUrl);
            const api = await api_1.ApiPromise.create({ provider });
            await api.isReady;
            const keyring = new api_1.Keyring({ type: 'sr25519' });
            const relayer = keyring.addFromUri(config_1.config.blockchain.relayerSeed);
            const contract = new api_contract_1.ContractPromise(api, metadata, config_1.config.rewards.stakingContractAddress);
            // Resolve method keys from ABI
            this.fundMethodKey = resolveMethod(contract, 'fund_staking_rewards', 'tx');
            this.distributeMethodKey = resolveMethod(contract, 'distribute_trading_rewards', 'tx');
            this.distributePaginatedMethodKey = resolveMethod(contract, 'distribute_trading_rewards_paginated', 'tx');
            if (!this.fundMethodKey) {
                logger_1.log.warn('[RewardPayout] fund_staking_rewards method not found in Staking ABI');
                return false;
            }
            if (!this.distributeMethodKey && !this.distributePaginatedMethodKey) {
                logger_1.log.warn('[RewardPayout] distribute_trading_rewards method not found in Staking ABI');
                return false;
            }
            this.api = api;
            this.stakingContract = contract;
            this.relayer = relayer;
            logger_1.log.info({
                relayerAddress: relayer.address,
                stakingContract: config_1.config.rewards.stakingContractAddress,
                fundMethod: this.fundMethodKey,
                distributeMethod: this.distributePaginatedMethodKey || this.distributeMethodKey,
            }, '[RewardPayout] On-chain reward payout service initialized');
            return true;
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[RewardPayout] Failed to initialize');
            return false;
        }
    }
    // ─── Balance Queries ───────────────────────────────────────────────────
    /** Get the relayer wallet's native LUNES balance (in plancks). */
    async getRelayerBalance() {
        if (!this.api || !this.relayer) {
            throw new Error('[RewardPayout] Service not initialized');
        }
        const { data: { free } } = await this.api.query.system.account(this.relayer.address);
        return BigInt(free.toString());
    }
    /** Get the relayer's available balance in LUNES (human-readable). */
    async getRelayerBalanceLunes() {
        const plancks = await this.getRelayerBalance();
        return plancksToLunes(plancks);
    }
    // ─── Fund Staking Rewards (Payable) ────────────────────────────────────
    /**
     * Send LUNES to the Staking contract via fund_staking_rewards.
     * This is a PAYABLE call — the LUNES value is attached to the transaction.
     *
     * @param amountLunes Human-readable amount (e.g., 1000.5)
     * @returns PayoutResult with txHash
     */
    async fundStakingRewards(amountLunes) {
        const ready = await this.ensureReady();
        if (!ready || !this.api || !this.stakingContract || !this.relayer || !this.fundMethodKey) {
            return { success: false, txHash: null, error: 'Payout service not initialized' };
        }
        if (amountLunes <= 0) {
            return { success: false, txHash: null, error: 'Amount must be positive' };
        }
        const amountPlancks = lunesToPlancks(amountLunes);
        // Safety: check relayer has enough balance
        const balance = await this.getRelayerBalance();
        const minRequired = amountPlancks + BigInt(1000000); // +0.01 LUNES for gas
        if (balance < minRequired) {
            const errMsg = `Insufficient relayer balance: has ${plancksToLunes(balance)} LUNES, needs ${amountLunes}`;
            logger_1.log.error(errMsg);
            return { success: false, txHash: null, error: errMsg };
        }
        try {
            const queryMethod = this.stakingContract.query[this.fundMethodKey];
            const txMethod = this.stakingContract.tx[this.fundMethodKey];
            if (!queryMethod || !txMethod) {
                return { success: false, txHash: null, error: 'Contract method binding missing' };
            }
            // Dry-run to estimate gas (payable: attach value)
            const value = new util_1.BN(amountPlancks.toString());
            const { gasRequired, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null, value });
            if (result.isErr) {
                return { success: false, txHash: null, error: `Dry-run failed: ${result.toString()}` };
            }
            // Submit real transaction
            const txHash = await this.signAndSendContract(txMethod, { gasLimit: gasRequired, storageDepositLimit: null, value }, [], `fund_staking_rewards:${amountLunes}`);
            logger_1.log.info({ txHash, amountLunes }, '[RewardPayout] Funded staking rewards');
            return { success: true, txHash, error: null };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            logger_1.log.error({ err: error, amountLunes }, '[RewardPayout] fund_staking_rewards failed');
            return { success: false, txHash: null, error: errMsg };
        }
    }
    // ─── Distribute Trading Rewards ────────────────────────────────────────
    /**
     * Trigger on-chain distribution of rewards to stakers.
     * Uses paginated version if available to avoid gas limits.
     *
     * @param startIndex Optional pagination start
     * @param batchSize Optional pagination batch size
     */
    async distributeRewards(startIndex, batchSize) {
        const ready = await this.ensureReady();
        if (!ready || !this.api || !this.stakingContract || !this.relayer) {
            return { success: false, txHash: null, error: 'Payout service not initialized' };
        }
        const methodKey = this.distributePaginatedMethodKey || this.distributeMethodKey;
        if (!methodKey) {
            return { success: false, txHash: null, error: 'distribute method not found' };
        }
        try {
            const queryMethod = this.stakingContract.query[methodKey];
            const txMethod = this.stakingContract.tx[methodKey];
            if (!queryMethod || !txMethod) {
                return { success: false, txHash: null, error: 'Contract method binding missing' };
            }
            // Build args for paginated vs non-paginated
            const args = [];
            if (this.distributePaginatedMethodKey === methodKey) {
                args.push(startIndex ?? null); // Option<u32>
                args.push(batchSize ?? null); // Option<u32>
            }
            const { gasRequired, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, ...args);
            if (result.isErr) {
                return { success: false, txHash: null, error: `Dry-run failed: ${result.toString()}` };
            }
            const txHash = await this.signAndSendContract(txMethod, { gasLimit: gasRequired, storageDepositLimit: null }, args, `distribute_trading_rewards${startIndex != null ? `:${startIndex}` : ''}`);
            logger_1.log.info({ txHash, startIndex, batchSize }, '[RewardPayout] Distributed trading rewards');
            return { success: true, txHash, error: null };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            logger_1.log.error({ err: error }, '[RewardPayout] distribute_trading_rewards failed');
            return { success: false, txHash: null, error: errMsg };
        }
    }
    // ─── Native LUNES Transfer (for Leader Rewards) ────────────────────────
    /**
     * Transfer native LUNES to a wallet address.
     * Used for leader copytrade rewards (direct to wallet, no contract needed).
     *
     * Uses `api.tx.balances.transferKeepAlive` (safer than `transfer`
     * because it keeps the sender account alive).
     *
     * @param toAddress Destination wallet
     * @param amountLunes Human-readable amount
     */
    async transferNative(toAddress, amountLunes) {
        const ready = await this.ensureReady();
        if (!ready || !this.api || !this.relayer) {
            return { success: false, txHash: null, error: 'Payout service not initialized' };
        }
        if (amountLunes <= 0) {
            return { success: false, txHash: null, error: 'Amount must be positive' };
        }
        const amountPlancks = lunesToPlancks(amountLunes);
        // Safety: balance check
        const balance = await this.getRelayerBalance();
        const minRequired = amountPlancks + BigInt(1000000);
        if (balance < minRequired) {
            const errMsg = `Insufficient relayer balance for transfer: has ${plancksToLunes(balance)}, needs ${amountLunes}`;
            logger_1.log.error(errMsg);
            return { success: false, txHash: null, error: errMsg };
        }
        try {
            const txPromise = new Promise((resolve, reject) => {
                let unsub;
                this.api.tx.balances
                    .transferKeepAlive(toAddress, new util_1.BN(amountPlancks.toString()))
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
                    .then((unsubscribe) => {
                    unsub = unsubscribe;
                })
                    .catch(reject);
            });
            const txHash = await (0, txWithTimeout_1.withTxTimeout)(`transfer:${toAddress}:${amountLunes}`, txPromise);
            logger_1.log.info({ txHash, toAddress, amountLunes }, '[RewardPayout] Native LUNES transferred');
            return { success: true, txHash, error: null };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            logger_1.log.error({ err: error, toAddress, amountLunes }, '[RewardPayout] Native transfer failed');
            return { success: false, txHash: null, error: errMsg };
        }
    }
    // ─── Shared signAndSend for Contract Calls ─────────────────────────────
    async signAndSendContract(txMethod, options, args, label) {
        const txPromise = new Promise((resolve, reject) => {
            let unsub;
            txMethod(options, ...args)
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
                .then((unsubscribe) => {
                unsub = unsubscribe;
            })
                .catch(reject);
        });
        return (0, txWithTimeout_1.withTxTimeout)(label, txPromise);
    }
}
exports.rewardPayoutService = new RewardPayoutService();
//# sourceMappingURL=rewardPayoutService.js.map