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
exports.factoryService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
/**
 * FactoryService — reads the Factory ink! contract on-chain.
 *
 * The Factory is the source of truth for pair existence.
 * This service is used by the admin pair-registration endpoint
 * to verify a pair exists on-chain before registering it in the DB.
 */
class FactoryService {
    constructor() {
        this.api = null;
        this.contract = null;
        this.initPromise = null;
    }
    isConfigured() {
        return Boolean(config_1.config.blockchain.wsUrl && config_1.config.blockchain.factoryContractAddress && config_1.config.blockchain.factoryContractMetadataPath);
    }
    async initialize() {
        try {
            const metadataPath = path.resolve(config_1.config.blockchain.factoryContractMetadataPath);
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
            const provider = new api_1.WsProvider(config_1.config.blockchain.wsUrl);
            const api = await api_1.ApiPromise.create({ provider });
            await api.isReady;
            this.api = api;
            this.contract = new api_contract_1.ContractPromise(api, metadata, config_1.config.blockchain.factoryContractAddress);
            logger_1.log.info('[Factory] On-chain factory service enabled');
            return true;
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[Factory] Failed to initialize');
            return false;
        }
    }
    async ensureReady() {
        if (!this.isConfigured())
            return false;
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }
    /**
     * Query the Factory contract for the Pair address of (tokenA, tokenB).
     * Returns the pair's AccountId string if it exists, or null if not yet created.
     */
    async getPair(tokenA, tokenB) {
        const ready = await this.ensureReady();
        if (!ready || !this.contract || !this.api)
            return null;
        try {
            const queryCaller = tokenA; // any valid address as read-only query caller
            const { result, output } = await this.contract.query.getPair(queryCaller, { gasLimit: -1, storageDepositLimit: null }, tokenA, tokenB);
            if (result.isErr || !output)
                return null;
            const json = output.toJSON();
            // The result is Option<AccountId>: { ok: null } or { ok: "5D..." }
            const inner = json?.ok ?? json;
            if (!inner || inner === null)
                return null;
            return typeof inner === 'string' ? inner : null;
        }
        catch (e) {
            logger_1.log.error({ err: e }, '[Factory] getPair error');
            return null;
        }
    }
    /**
     * Returns the total number of pairs registered in the Factory.
     */
    async getAllPairsLength() {
        const ready = await this.ensureReady();
        if (!ready || !this.contract || !this.api)
            return 0;
        try {
            const { result, output } = await this.contract.query.allPairsLength(config_1.config.blockchain.factoryContractAddress, { gasLimit: -1, storageDepositLimit: null });
            if (result.isErr || !output)
                return 0;
            const json = output.toJSON();
            const value = json?.ok ?? json;
            return typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10);
        }
        catch (e) {
            logger_1.log.error({ err: e }, '[Factory] allPairsLength error');
            return 0;
        }
    }
    /**
     * Returns all pair addresses from the Factory, in order.
     * Iterates from index 0 to allPairsLength - 1.
     */
    async getAllPairs() {
        const length = await this.getAllPairsLength();
        if (length === 0)
            return [];
        const results = await Promise.all(Array.from({ length }, (_, i) => this.contract.query.allPairs(config_1.config.blockchain.factoryContractAddress, { gasLimit: -1, storageDepositLimit: null }, i).then(({ result, output }) => {
            if (result.isOk && output) {
                const json = output.toJSON();
                const inner = json?.ok ?? json;
                if (inner && typeof inner === 'string')
                    return inner;
            }
            return null;
        }).catch((e) => {
            logger_1.log.error({ err: e, index: i }, '[Factory] allPairs error');
            return null;
        })));
        return results.filter((addr) => addr !== null);
    }
    async disconnect() {
        if (this.api) {
            await this.api.disconnect();
            this.api = null;
            this.contract = null;
            this.initPromise = null;
        }
    }
}
exports.factoryService = new FactoryService();
//# sourceMappingURL=factoryService.js.map