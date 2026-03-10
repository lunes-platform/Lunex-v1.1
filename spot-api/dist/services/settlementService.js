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
Object.defineProperty(exports, "__esModule", { value: true });
exports.settlementService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_crypto_1 = require("@polkadot/util-crypto");
const config_1 = require("../config");
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
                console.warn('[SpotSettlement] Required contract methods not found in contract metadata');
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
            console.log('[SpotSettlement] On-chain settlement enabled');
            return true;
        }
        catch (error) {
            console.error('[SpotSettlement] Failed to initialize settlement service:', error);
            return false;
        }
    }
    toAccountId(address, isNative) {
        if (!this.api)
            throw new Error('Settlement API not initialized');
        return isNative ? this.api.createType('AccountId', new Uint8Array(32)) : this.api.createType('AccountId', address);
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
        };
    }
    async submitSettlement(input) {
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
        return await new Promise((resolve, reject) => {
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
                console.error(`[SpotSettlement] Failed to settle trade ${input.tradeId}:`, error);
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
            console.warn('[SpotSettlement] cancel_order_for method not found in contract metadata');
            return null;
        }
        const maker = this.toUserAccountId(makerAddress);
        const nonceValue = nonceToU64(nonce).toString();
        const queryMethod = this.getQueryMethod(this.cancelOrderForMethodKey);
        if (!queryMethod) {
            console.warn('[SpotSettlement] cancel_order_for query binding not found in contract metadata');
            return null;
        }
        const { gasRequired, result } = await queryMethod(this.relayer.address, { gasLimit: -1, storageDepositLimit: null }, maker, nonceValue);
        if (result.isErr) {
            throw new Error(`[SpotSettlement] Failed to simulate cancel_order_for for ${makerAddress}`);
        }
        return await new Promise((resolve, reject) => {
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
    }
}
exports.settlementService = new SpotSettlementService();
//# sourceMappingURL=settlementService.js.map