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
exports.settlementService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_crypto_1 = require("@polkadot/util-crypto");
const util_1 = require("@polkadot/util");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const txWithTimeout_1 = require("../utils/txWithTimeout");
function normalizeMethodKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function resolveMethodKey(contract, expectedLabel) {
    const expected = normalizeMethodKey(expectedLabel);
    return Object.keys(contract.tx).find((key) => normalizeMethodKey(key).includes(expected)) || null;
}
function resolveMethodKeyByKind(contract, expectedLabel, kind) {
    const expected = normalizeMethodKey(expectedLabel);
    const source = kind === 'tx' ? contract.tx : contract.query;
    return Object.keys(source).find((key) => normalizeMethodKey(key).includes(expected)) || null;
}
function decimalToUnits(value, decimals) {
    const normalized = value.trim();
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [wholePart, fractionPart = ''] = unsigned.split('.');
    const base = 10n ** BigInt(decimals);
    const whole = BigInt(wholePart || '0') * base;
    const fraction = BigInt((fractionPart + '0'.repeat(decimals)).slice(0, decimals) || '0');
    const result = whole + fraction;
    return negative ? -result : result;
}
/**
 * Convert an order signature string to a 64-byte Uint8Array suitable for
 * the on-chain `SignedOrder.signature: [u8; 64]` field.
 *
 * Three cases:
 *   1. Real sr25519 hex signature ("0x…" or bare hex, 128 hex chars = 64 bytes)
 *      → decode directly.
 *   2. Agent-delegated order ("agent:<id>")
 *      → the agent's orders are pre-validated off-chain via the agent registry;
 *        we encode a non-zero sentinel so the contract's blank-signature guard
 *        does not reject it. The first byte is 0x01 (agent marker), remaining
 *        bytes are the UTF-8 of the agent id (up to 63 bytes), zero-padded.
 *   3. Any other unexpected format
 *      → throws, preventing an invalid settlement from reaching the chain.
 */
function signatureToBytes(sig) {
    // Case 1 — real sr25519 signature
    if ((0, util_1.isHex)(sig) || /^[0-9a-fA-F]{128}$/.test(sig)) {
        const hex = sig.startsWith('0x') ? sig : `0x${sig}`;
        const bytes = (0, util_1.hexToU8a)(hex);
        if (bytes.length !== 64) {
            throw new Error(`Invalid sr25519 signature length: expected 64 bytes, got ${bytes.length}. ` +
                `Signature (truncated): ${sig.slice(0, 20)}…`);
        }
        return Array.from(bytes);
    }
    // Case 2 — agent-delegated order: off-chain verification already passed via
    // assertOrderTrustedSource. Encode as non-zero sentinel for contract storage.
    if (sig.startsWith('agent:')) {
        const idBytes = Buffer.from(sig.slice('agent:'.length), 'utf-8').subarray(0, 63);
        const out = new Uint8Array(64);
        out[0] = 0x01; // agent marker — non-zero so the blank-sig guard doesn't fire
        out.set(idBytes, 1);
        return Array.from(out);
    }
    throw new Error(`Unrecognised signature format for settlement: ${sig.slice(0, 20)}…. ` +
        `Expected a 64-byte sr25519 hex signature or "agent:<id>".`);
}
function nonceToU64(nonce) {
    const digits = nonce.replace(/\D/g, '');
    if (!digits) {
        throw new Error(`Invalid numeric nonce: ${nonce}`);
    }
    const trimmed = digits.slice(-20);
    const parsed = BigInt(trimmed);
    const maxU64 = BigInt('18446744073709551615');
    if (parsed > maxU64) {
        return BigInt(trimmed.slice(-19));
    }
    return parsed;
}
class SpotSettlementService {
    constructor() {
        this.api = null;
        this.contract = null;
        this.relayer = null;
        this.settleMethodKey = null;
        this.getBalanceMethodKey = null;
        this.isNonceUsedMethodKey = null;
        this.isNonceCancelledMethodKey = null;
        this.cancelOrderForMethodKey = null;
        this.initPromise = null;
    }
    isConfigured() {
        return Boolean(config_1.config.blockchain.wsUrl &&
            config_1.config.blockchain.spotContractAddress &&
            config_1.config.blockchain.spotContractMetadataPath &&
            config_1.config.blockchain.relayerSeed);
    }
    isEnabled() {
        return this.isConfigured();
    }
    async ensureReady() {
        if (!this.isConfigured()) {
            return false;
        }
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }
    async initialize() {
        try {
            await (0, util_crypto_1.cryptoWaitReady)();
            const metadataPath = path.resolve(config_1.config.blockchain.spotContractMetadataPath);
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
            const provider = new api_1.WsProvider(config_1.config.blockchain.wsUrl);
            const api = await api_1.ApiPromise.create({ provider });
            await api.isReady;
            const keyring = new api_1.Keyring({ type: 'sr25519' });
            const relayer = keyring.addFromUri(config_1.config.blockchain.relayerSeed);
            const contract = new api_contract_1.ContractPromise(api, metadata, config_1.config.blockchain.spotContractAddress);
            const settleMethodKey = resolveMethodKey(contract, 'settle_trade');
            const getBalanceMethodKey = resolveMethodKeyByKind(contract, 'get_balance', 'query');
            const isNonceUsedMethodKey = resolveMethodKeyByKind(contract, 'is_nonce_used', 'query');
            const isNonceCancelledMethodKey = resolveMethodKeyByKind(contract, 'is_nonce_cancelled', 'query');
            const cancelOrderForMethodKey = resolveMethodKeyByKind(contract, 'cancel_order_for', 'tx');
            if (!settleMethodKey || !getBalanceMethodKey || !isNonceUsedMethodKey || !isNonceCancelledMethodKey) {
                logger_1.log.warn('[SpotSettlement] Required contract methods not found in contract metadata');
                return false;
            }
            this.api = api;
            this.contract = contract;
            this.relayer = relayer;
            this.settleMethodKey = settleMethodKey;
            this.getBalanceMethodKey = getBalanceMethodKey;
            this.isNonceUsedMethodKey = isNonceUsedMethodKey;
            this.isNonceCancelledMethodKey = isNonceCancelledMethodKey;
            this.cancelOrderForMethodKey = cancelOrderForMethodKey;
            logger_1.log.info('[SpotSettlement] On-chain settlement enabled');
            return true;
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[SpotSettlement] Failed to initialize settlement service');
            return false;
        }
    }
    toAccountId(address, isNative) {
        if (!this.api)
            throw new Error('Settlement API not initialized');
        if (isNative) {
            // Native token (LUNES) must be represented by a known placeholder AccountId
            // that matches the on-chain constant in the Spot contract (typically 0x00...00 or a specific sentinel).
            // Configure NATIVE_TOKEN_ADDRESS in .env to match the contract's expectation.
            const nativeAddr = config_1.config.blockchain.nativeTokenAddress;
            if (!nativeAddr) {
                logger_1.log.warn('[SpotSettlement] NATIVE_TOKEN_ADDRESS not set in config — falling back to zero AccountId. ' +
                    'This may cause settlement failures for native-token pairs. ' +
                    'Set NATIVE_TOKEN_ADDRESS in your .env to the sentinel address expected by the Spot contract.');
                return this.api.createType('AccountId', new Uint8Array(32));
            }
            return this.api.createType('AccountId', nativeAddr);
        }
        return this.api.createType('AccountId', address);
    }
    toUserAccountId(address) {
        if (!this.api)
            throw new Error('Settlement API not initialized');
        return this.api.createType('AccountId', address);
    }
    getQueryMethod(methodKey) {
        if (!this.contract || !methodKey)
            return null;
        return this.contract.query[methodKey] || null;
    }
    getTxMethod(methodKey) {
        if (!this.contract || !methodKey)
            return null;
        return this.contract.tx[methodKey] || null;
    }
    async getVaultBalance(userAddress, tokenAddress, isNative) {
        const isReady = await this.ensureReady();
        if (!isReady || !this.relayer)
            return null;
        const queryMethod = this.getQueryMethod(this.getBalanceMethodKey);
        if (!queryMethod)
            return null;
        const { output, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, this.toUserAccountId(userAddress), this.toAccountId(tokenAddress, isNative));
        if (result.isErr || !output) {
            throw new Error(`[SpotSettlement] Failed to fetch vault balance for ${userAddress}`);
        }
        return BigInt(output.toString());
    }
    async isNonceUsed(userAddress, nonce) {
        const isReady = await this.ensureReady();
        if (!isReady || !this.relayer)
            return null;
        const queryMethod = this.getQueryMethod(this.isNonceUsedMethodKey);
        if (!queryMethod)
            return null;
        const { output, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, this.toUserAccountId(userAddress), nonceToU64(nonce).toString());
        if (result.isErr || !output) {
            throw new Error(`[SpotSettlement] Failed to fetch nonce usage for ${userAddress}`);
        }
        return output.toString() === 'true';
    }
    async isNonceCancelled(userAddress, nonce) {
        const isReady = await this.ensureReady();
        if (!isReady || !this.relayer)
            return null;
        const queryMethod = this.getQueryMethod(this.isNonceCancelledMethodKey);
        if (!queryMethod)
            return null;
        const { output, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, this.toUserAccountId(userAddress), nonceToU64(nonce).toString());
        if (result.isErr || !output) {
            throw new Error(`[SpotSettlement] Failed to fetch cancelled nonce for ${userAddress}`);
        }
        return output.toString() === 'true';
    }
    toSignedOrder(pair, order) {
        return {
            maker: order.makerAddress,
            base_token: this.toAccountId(pair.baseToken, pair.isNativeBase),
            quote_token: this.toAccountId(pair.quoteToken, pair.isNativeQuote),
            side: order.side === 'BUY' ? 0 : 1,
            price: decimalToUnits(order.price, 8).toString(),
            amount: decimalToUnits(order.amount, pair.baseDecimals).toString(),
            filled_amount: decimalToUnits(order.filledAmount, pair.baseDecimals).toString(),
            nonce: nonceToU64(order.nonce).toString(),
            expiry: order.expiresAt ? String(order.expiresAt.getTime()) : '0',
            // sr25519 signature bytes stored on-chain for auditability.
            // Off-chain verification is done in assertOrderTrustedSource() before
            // this call. See verify_order_signature() in spot_settlement/lib.rs.
            signature: signatureToBytes(order.signature),
        };
    }
    buildOrderSignatureMessage(pair, order) {
        return (0, auth_1.buildSpotOrderMessage)({
            pairSymbol: pair.symbol,
            side: order.side,
            type: order.type,
            price: order.price,
            stopPrice: order.stopPrice || undefined,
            amount: order.amount,
            nonce: order.nonce,
        });
    }
    async assertOrderTrustedSource(pair, order) {
        if (!order.signature || order.signature.length < 8) {
            throw new Error(`Missing order signature for ${order.makerAddress}`);
        }
        if (order.signature.startsWith('agent:')) {
            const agentId = order.signature.slice('agent:'.length);
            if (!agentId) {
                throw new Error(`Malformed agent signature for ${order.makerAddress}`);
            }
            const agent = await db_1.default.agent.findUnique({
                where: { id: agentId },
                select: {
                    id: true,
                    walletAddress: true,
                    isActive: true,
                    isBanned: true,
                },
            });
            if (!agent || agent.walletAddress !== order.makerAddress || !agent.isActive || agent.isBanned) {
                throw new Error(`Untrusted agent order origin for ${order.makerAddress}`);
            }
            return;
        }
        if (order.signature.startsWith('manual:')) {
            throw new Error(`Unsupported synthetic signature for ${order.makerAddress}`);
        }
        const isValid = await (0, auth_1.verifyAddressSignature)(this.buildOrderSignatureMessage(pair, order), order.signature, order.makerAddress);
        if (!isValid) {
            throw new Error(`Invalid order signature for ${order.makerAddress}`);
        }
    }
    async assertSettlementInputTrusted(input) {
        await Promise.all([
            this.assertOrderTrustedSource(input.pair, input.makerOrder),
            this.assertOrderTrustedSource(input.pair, input.takerOrder),
        ]);
    }
    async submitSettlement(input) {
        await this.assertSettlementInputTrusted(input);
        const isReady = await this.ensureReady();
        if (!isReady || !this.contract || !this.relayer || !this.settleMethodKey) {
            return null;
        }
        const queryMethod = this.contract.query[this.settleMethodKey];
        const txMethod = this.contract.tx[this.settleMethodKey];
        if (!queryMethod || !txMethod) {
            throw new Error(`Missing contract method binding for ${this.settleMethodKey}`);
        }
        const makerOrder = this.toSignedOrder(input.pair, input.makerOrder);
        const takerOrder = this.toSignedOrder(input.pair, input.takerOrder);
        const fillAmount = decimalToUnits(input.fillAmount, input.pair.baseDecimals).toString();
        const fillPrice = decimalToUnits(input.fillPrice, 8).toString();
        const { gasRequired, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, makerOrder, takerOrder, fillAmount, fillPrice);
        if (result.isErr) {
            throw new Error(`[SpotSettlement] Query failed for trade ${input.tradeId}: ${result.toString()}`);
        }
        const txPromise = new Promise((resolve, reject) => {
            let unsub;
            txMethod({ gasLimit: gasRequired, storageDepositLimit: null }, makerOrder, takerOrder, fillAmount, fillPrice)
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
        return (0, txWithTimeout_1.withTxTimeout)(`settle_trade:${input.tradeId}`, txPromise);
    }
    async settleTrades(inputs) {
        const settlements = [];
        for (const input of inputs) {
            try {
                const txHash = await this.submitSettlement(input);
                if (txHash) {
                    settlements.push({ tradeId: input.tradeId, status: 'SETTLED', txHash });
                }
                else {
                    settlements.push({
                        tradeId: input.tradeId,
                        status: 'FAILED',
                        error: 'Settlement service unavailable',
                    });
                }
            }
            catch (error) {
                logger_1.log.error({ err: error, tradeId: input.tradeId }, '[SpotSettlement] Failed to settle trade');
                settlements.push({
                    tradeId: input.tradeId,
                    status: 'FAILED',
                    error: error instanceof Error ? error.message : 'Unknown settlement failure',
                });
            }
        }
        return settlements;
    }
    async cancelOrderFor(makerAddress, nonce) {
        const isReady = await this.ensureReady();
        if (!isReady || !this.relayer)
            return null;
        const txMethod = this.getTxMethod(this.cancelOrderForMethodKey);
        if (!txMethod) {
            logger_1.log.warn('[SpotSettlement] cancel_order_for method not found in contract metadata');
            return null;
        }
        const maker = this.toUserAccountId(makerAddress);
        const nonceValue = nonceToU64(nonce).toString();
        const queryMethod = this.getQueryMethod(this.cancelOrderForMethodKey);
        if (!queryMethod) {
            logger_1.log.warn('[SpotSettlement] cancel_order_for query binding not found in contract metadata');
            return null;
        }
        const { gasRequired, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, maker, nonceValue);
        if (result.isErr) {
            throw new Error(`[SpotSettlement] Failed to simulate cancel_order_for for ${makerAddress}`);
        }
        const cancelPromise = new Promise((resolve, reject) => {
            let unsub;
            txMethod({ gasLimit: gasRequired, storageDepositLimit: null }, maker, nonceValue)
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
        return (0, txWithTimeout_1.withTxTimeout)(`cancel_order_for:${makerAddress}:${nonce}`, cancelPromise);
    }
}
exports.settlementService = new SpotSettlementService();
//# sourceMappingURL=settlementService.js.map