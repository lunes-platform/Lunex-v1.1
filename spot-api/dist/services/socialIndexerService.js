"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialIndexerService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const ACCOUNT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const PAIR_REGEX = /[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}/;
const REPO_ROOT = path_1.default.resolve(__dirname, '../../..');
const DEPLOYED_ADDRESSES_PATH = path_1.default.resolve(REPO_ROOT, 'spot-api', 'deployed-addresses.json');
const ROUTER_ABI_PATH = path_1.default.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'Router.json');
const PAIR_ABI_PATH = path_1.default.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'Pair.json');
const WNATIVE_ABI_PATH = path_1.default.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'WNative.json');
function getAnalyticsDb() {
    const db = db_1.default;
    if (typeof db.socialAnalyticsCursor?.findUnique !== 'function' ||
        typeof db.socialIndexedEvent?.findFirst !== 'function') {
        return null;
    }
    return db;
}
function toSerializable(value) {
    if (value == null)
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (Array.isArray(value))
        return value.map((entry) => toSerializable(entry));
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toSerializable(entry)]));
    }
    return String(value);
}
function collectPrimitiveValues(value, output = []) {
    if (value == null)
        return output;
    if (typeof value === 'string' || typeof value === 'number') {
        output.push(value);
        return output;
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => collectPrimitiveValues(entry, output));
        return output;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach((entry) => collectPrimitiveValues(entry, output));
    }
    return output;
}
function extractAddresses(payload, signer) {
    const values = collectPrimitiveValues(payload);
    const addresses = values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => ACCOUNT_REGEX.test(value));
    if (signer && ACCOUNT_REGEX.test(signer)) {
        addresses.unshift(signer);
    }
    return Array.from(new Set(addresses));
}
function extractNumbers(payload) {
    return collectPrimitiveValues(payload)
        .map((value) => {
        if (typeof value === 'number')
            return value;
        const normalized = value.replace(/,/g, '').trim();
        if (!normalized)
            return Number.NaN;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
    })
        .filter((value) => Number.isFinite(value));
}
function extractPairSymbol(payload) {
    const values = collectPrimitiveValues(payload);
    const matched = values
        .filter((value) => typeof value === 'string')
        .map((value) => value.match(PAIR_REGEX)?.[0])
        .find(Boolean);
    return matched || null;
}
function deriveKind(section, method) {
    const key = `${section}.${method}`.toLowerCase();
    if (key.includes('swap'))
        return 'SWAP';
    if (key.includes('liquidityadd') || key.includes('minted'))
        return 'LIQUIDITY_ADD';
    if (key.includes('liquidityremove') || key.includes('burned'))
        return 'LIQUIDITY_REMOVE';
    if (key.includes('tradeopen') || key.includes('positionopened'))
        return 'TRADE_OPEN';
    if (key.includes('tradeclose') || key.includes('positionclosed') || key.includes('settled'))
        return 'TRADE_CLOSE';
    if (key.includes('deposit'))
        return 'VAULT_DEPOSIT';
    if (key.includes('withdraw'))
        return 'VAULT_WITHDRAW';
    return 'UNKNOWN';
}
function shouldTrackEvent(section, method) {
    const pallet = section.toLowerCase();
    const eventName = method.toLowerCase();
    const kind = deriveKind(section, method);
    if (kind !== 'UNKNOWN')
        return true;
    if (config_1.config.socialAnalytics.trackedPallets.includes(pallet))
        return true;
    if (config_1.config.socialAnalytics.trackedMethods.includes(eventName))
        return true;
    return false;
}
function getBlockTimestamp(extrinsics) {
    const timestampExtrinsic = extrinsics.find((extrinsic) => {
        const method = extrinsic.method;
        return method?.section?.toString() === 'timestamp' && method?.method?.toString() === 'set';
    });
    const raw = timestampExtrinsic?.method?.args?.[0];
    const timestamp = Number(raw?.toString?.() ?? Date.now());
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}
async function readJsonFile(filePath) {
    const content = await promises_1.default.readFile(filePath, 'utf-8');
    return JSON.parse(content);
}
function normalizeTokenSymbol(key) {
    if (key.toLowerCase() === 'wnative')
        return 'WLUNES';
    return key.toUpperCase();
}
function getTokenAliases(key, symbol) {
    return Array.from(new Set([key.toLowerCase(), symbol.toLowerCase()]));
}
function derivePairSymbolFromDeploymentKey(key, tokens) {
    if (!key.toLowerCase().startsWith('pair'))
        return null;
    const suffix = key.slice(4).toLowerCase();
    for (const left of tokens) {
        for (const leftAlias of left.aliases) {
            if (!suffix.startsWith(leftAlias))
                continue;
            const remaining = suffix.slice(leftAlias.length);
            for (const right of tokens) {
                for (const rightAlias of right.aliases) {
                    if (remaining === rightAlias) {
                        return `${left.symbol}/${right.symbol}`;
                    }
                }
            }
        }
    }
    return null;
}
class SocialIndexerService {
    constructor() {
        this.api = null;
        this.initPromise = null;
        this.knownContracts = new Map();
        this.tokenSymbolsByAddress = new Map();
    }
    isEnabled() {
        return config_1.config.socialAnalytics.enabled && Boolean(config_1.config.blockchain.wsUrl);
    }
    async initialize() {
        try {
            const provider = new api_1.WsProvider(config_1.config.blockchain.wsUrl);
            this.api = await api_1.ApiPromise.create({ provider });
            await this.api.isReady;
            await this.loadKnownContracts();
            console.log('[SocialIndexer] Connected to blockchain node');
            return true;
        }
        catch (error) {
            console.error('[SocialIndexer] Failed to initialize:', error);
            return false;
        }
    }
    async ensureReady() {
        if (!this.isEnabled()) {
            return false;
        }
        if (this.api) {
            return true;
        }
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }
    async getOrCreateCursor() {
        const db = getAnalyticsDb();
        if (!db)
            return null;
        const existing = await db.socialAnalyticsCursor.findUnique({
            where: { chain: config_1.config.socialAnalytics.chainName },
        });
        if (existing)
            return existing;
        return db.socialAnalyticsCursor.create({
            data: {
                chain: config_1.config.socialAnalytics.chainName,
                status: this.isEnabled() ? 'IDLE' : 'DISABLED',
            },
        });
    }
    async getStatus() {
        const db = getAnalyticsDb();
        const cursor = db
            ? await db.socialAnalyticsCursor.findUnique({ where: { chain: config_1.config.socialAnalytics.chainName } })
            : null;
        return {
            enabled: this.isEnabled(),
            chain: config_1.config.socialAnalytics.chainName,
            cursor,
            ready: Boolean(this.api),
        };
    }
    async updateCursor(data) {
        const db = getAnalyticsDb();
        if (!db)
            return null;
        const cursor = await this.getOrCreateCursor();
        if (!cursor)
            return null;
        return db.socialAnalyticsCursor.update({
            where: { chain: config_1.config.socialAnalytics.chainName },
            data,
        });
    }
    async loadKnownContracts() {
        if (!this.api)
            return;
        try {
            const [deployedAddresses, routerAbi, pairAbi, wnativeAbi] = await Promise.all([
                readJsonFile(DEPLOYED_ADDRESSES_PATH),
                readJsonFile(ROUTER_ABI_PATH),
                readJsonFile(PAIR_ABI_PATH),
                readJsonFile(WNATIVE_ABI_PATH),
            ]);
            const tokenEntries = Object.entries(deployedAddresses)
                .filter(([key, value]) => {
                if (typeof value !== 'string' || !ACCOUNT_REGEX.test(value))
                    return false;
                if (key === 'router' || key === 'factory' || key === 'staking' || key === 'rewards')
                    return false;
                if (key === 'pairCodeHash' || key.toLowerCase().startsWith('pair'))
                    return false;
                return true;
            })
                .map(([key, address]) => {
                const symbol = normalizeTokenSymbol(key);
                return {
                    key,
                    address: String(address),
                    symbol,
                    aliases: getTokenAliases(key, symbol),
                };
            });
            this.tokenSymbolsByAddress = new Map(tokenEntries.map((entry) => [entry.address, entry.symbol]));
            this.knownContracts = new Map();
            if (typeof deployedAddresses.router === 'string' && ACCOUNT_REGEX.test(deployedAddresses.router)) {
                this.knownContracts.set(deployedAddresses.router, {
                    kind: 'router',
                    contract: new api_contract_1.ContractPromise(this.api, routerAbi, deployedAddresses.router),
                });
            }
            if (typeof deployedAddresses.wnative === 'string' && ACCOUNT_REGEX.test(deployedAddresses.wnative)) {
                this.knownContracts.set(deployedAddresses.wnative, {
                    kind: 'wnative',
                    contract: new api_contract_1.ContractPromise(this.api, wnativeAbi, deployedAddresses.wnative),
                });
            }
            for (const [key, value] of Object.entries(deployedAddresses)) {
                if (!key.toLowerCase().startsWith('pair') || typeof value !== 'string' || !ACCOUNT_REGEX.test(value)) {
                    continue;
                }
                this.knownContracts.set(value, {
                    kind: 'pair',
                    pairSymbol: derivePairSymbolFromDeploymentKey(key, tokenEntries),
                    contract: new api_contract_1.ContractPromise(this.api, pairAbi, value),
                });
            }
        }
        catch (error) {
            console.warn('[SocialIndexer] Failed to load known contract decoders:', error);
        }
    }
    getTokenSymbol(address) {
        if (!address)
            return null;
        return this.tokenSymbolsByAddress.get(address) ?? null;
    }
    getPairSymbolFromPath(pathValue) {
        if (!Array.isArray(pathValue) || pathValue.length < 2)
            return null;
        const addresses = pathValue.map((entry) => String(entry));
        const first = this.getTokenSymbol(addresses[0]);
        const last = this.getTokenSymbol(addresses[addresses.length - 1]);
        if (!first || !last)
            return null;
        return `${first}/${last}`;
    }
    buildDecodedPayload(decoded) {
        const eventArgs = Array.isArray(decoded?.args) ? decoded.args : [];
        const metadataArgs = (Array.isArray(decoded?.event?.args) ? decoded.event.args : []);
        return metadataArgs.reduce((acc, metaArg, index) => {
            const label = String(metaArg?.label ?? metaArg?.name ?? `arg${index}`);
            const value = eventArgs[index];
            acc[label] = toSerializable(value?.toJSON ? value.toJSON() : value?.toHuman ? value.toHuman() : value?.toString?.() ?? value);
            return acc;
        }, {});
    }
    normalizeDecodedContractEvent(contractKind, method, payload, signer, pairSymbol) {
        if (contractKind === 'router' && method === 'LiquidityAdded') {
            return {
                pallet: 'contracts.router',
                method,
                kind: 'LIQUIDITY_ADD',
                accountAddress: signer || String(payload.to ?? ''),
                counterpartyAddress: String(payload.to ?? ''),
                pairSymbol: this.getPairSymbolFromPath([payload.token_a, payload.token_b]) || pairSymbol || null,
                amountIn: Number(payload.amount_a ?? 0),
                amountOut: Number(payload.amount_b ?? 0),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'router' && method === 'LiquidityRemoved') {
            return {
                pallet: 'contracts.router',
                method,
                kind: 'LIQUIDITY_REMOVE',
                accountAddress: signer || String(payload.to ?? ''),
                counterpartyAddress: String(payload.to ?? ''),
                pairSymbol: this.getPairSymbolFromPath([payload.token_a, payload.token_b]) || pairSymbol || null,
                amountIn: Number(payload.amount_a ?? 0),
                amountOut: Number(payload.amount_b ?? 0),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'router' && method === 'Swap') {
            return {
                pallet: 'contracts.router',
                method,
                kind: 'SWAP',
                accountAddress: String(payload.sender ?? signer ?? ''),
                counterpartyAddress: String(payload.to ?? ''),
                pairSymbol: this.getPairSymbolFromPath(payload.path) || pairSymbol || null,
                amountIn: Number(payload.amount_in ?? 0),
                amountOut: Number(payload.amount_out ?? 0),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'pair' && method === 'Mint') {
            return {
                pallet: 'contracts.pair',
                method,
                kind: 'LIQUIDITY_ADD',
                accountAddress: String(payload.sender ?? signer ?? ''),
                counterpartyAddress: null,
                pairSymbol: pairSymbol || null,
                amountIn: Math.max(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
                amountOut: Math.min(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'pair' && method === 'Burn') {
            return {
                pallet: 'contracts.pair',
                method,
                kind: 'LIQUIDITY_REMOVE',
                accountAddress: String(payload.sender ?? signer ?? ''),
                counterpartyAddress: String(payload.to ?? ''),
                pairSymbol: pairSymbol || null,
                amountIn: Math.max(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
                amountOut: Math.min(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'pair' && method === 'Swap') {
            return {
                pallet: 'contracts.pair',
                method,
                kind: 'SWAP',
                accountAddress: String(payload.sender ?? signer ?? ''),
                counterpartyAddress: String(payload.to ?? ''),
                pairSymbol: pairSymbol || null,
                amountIn: Math.max(Number(payload.amount_0_in ?? 0), Number(payload.amount_1_in ?? 0)),
                amountOut: Math.max(Number(payload.amount_0_out ?? 0), Number(payload.amount_1_out ?? 0)),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'wnative' && method === 'Deposit') {
            return {
                pallet: 'contracts.wnative',
                method,
                kind: 'VAULT_DEPOSIT',
                accountAddress: String(payload.dst ?? signer ?? ''),
                counterpartyAddress: null,
                pairSymbol: null,
                amountIn: Number(payload.wad ?? 0),
                amountOut: null,
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        if (contractKind === 'wnative' && method === 'Withdrawal') {
            return {
                pallet: 'contracts.wnative',
                method,
                kind: 'VAULT_WITHDRAW',
                accountAddress: String(payload.src ?? signer ?? ''),
                counterpartyAddress: null,
                pairSymbol: null,
                amountIn: null,
                amountOut: Number(payload.wad ?? 0),
                price: null,
                realizedPnl: null,
                payload,
            };
        }
        return {
            pallet: `contracts.${contractKind}`,
            method,
            kind: deriveKind(contractKind, method),
            accountAddress: signer || null,
            counterpartyAddress: null,
            pairSymbol: pairSymbol || null,
            amountIn: null,
            amountOut: null,
            price: null,
            realizedPnl: null,
            payload,
        };
    }
    tryDecodeContractEvent(contractAddress, eventData, signer) {
        const decoder = this.knownContracts.get(contractAddress);
        if (!decoder)
            return null;
        try {
            const decoded = decoder.contract.abi.decodeEvent(eventData);
            const method = String(decoded?.event?.identifier ?? decoded?.event?.label ?? 'Unknown');
            const payload = this.buildDecodedPayload(decoded);
            return this.normalizeDecodedContractEvent(decoder.kind, method, payload, signer, decoder.pairSymbol);
        }
        catch (error) {
            console.warn(`[SocialIndexer] Failed to decode contract event for ${contractAddress}:`, error);
            return null;
        }
    }
    normalizeEvent(section, method, payload, signer) {
        const addresses = extractAddresses(payload, signer);
        const numbers = extractNumbers(payload);
        return {
            pallet: section,
            method,
            kind: deriveKind(section, method),
            accountAddress: signer || addresses[0] || null,
            counterpartyAddress: addresses.find((address) => address !== signer) || null,
            pairSymbol: extractPairSymbol(payload),
            amountIn: numbers[0] ?? null,
            amountOut: numbers[1] ?? null,
            price: numbers[2] ?? null,
            realizedPnl: numbers[3] ?? null,
            payload,
        };
    }
    isPrunedBlockError(error) {
        const message = error instanceof Error ? error.message : String(error);
        const normalized = message.toLowerCase();
        return normalized.includes('state already discarded') || normalized.includes('unknown block');
    }
    getRecoveryStartBlock(latestBlock) {
        return Math.max(latestBlock - config_1.config.socialAnalytics.maxBlocksPerRun + 1, 1);
    }
    async processRange(startBlock, endBlock) {
        let totalIndexedEvents = 0;
        let lastProcessedHash = null;
        for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber += 1) {
            const summary = await this.processBlock(blockNumber);
            totalIndexedEvents += summary.indexedEvents;
            lastProcessedHash = summary.blockHash;
            await this.updateCursor({
                lastProcessedBlock: blockNumber,
                lastProcessedHash: summary.blockHash,
                lastProcessedAt: new Date(),
            });
        }
        return {
            processedBlocks: endBlock - startBlock + 1,
            indexedEvents: totalIndexedEvents,
            lastProcessedBlock: endBlock,
            lastProcessedHash,
        };
    }
    async processBlock(blockNumber) {
        if (!this.api) {
            throw new Error('Indexer API is not initialized');
        }
        const db = getAnalyticsDb();
        if (!db) {
            return { blockHash: null, indexedEvents: 0 };
        }
        const blockHash = (await this.api.rpc.chain.getBlockHash(blockNumber)).toString();
        const [signedBlock, eventRecords] = await Promise.all([
            this.api.rpc.chain.getBlock(blockHash),
            this.api.query.system.events.at(blockHash),
        ]);
        const extrinsics = signedBlock.block.extrinsics;
        const eventRecordList = Array.from(eventRecords);
        const blockTimestamp = getBlockTimestamp(extrinsics);
        let indexedEvents = 0;
        for (let eventIndex = 0; eventIndex < eventRecordList.length; eventIndex += 1) {
            const record = eventRecordList[eventIndex];
            const event = record.event;
            const section = String(event.section);
            const method = String(event.method);
            const isContractEmitted = section === 'contracts' && method === 'ContractEmitted';
            if (!isContractEmitted && !shouldTrackEvent(section, method)) {
                continue;
            }
            const phase = record.phase;
            const extrinsicIndex = phase?.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : null;
            const extrinsic = extrinsicIndex != null ? extrinsics[extrinsicIndex] : null;
            const signer = extrinsic && extrinsic.isSigned ? extrinsic.signer.toString() : null;
            const extrinsicHash = extrinsic ? extrinsic.hash.toHex() : null;
            const eventData = Array.from(event.data ?? []);
            let normalized = null;
            if (section === 'contracts' && method === 'ContractEmitted' && eventData.length >= 2) {
                normalized = this.tryDecodeContractEvent(String(eventData[0]), eventData[1], signer);
            }
            const payload = normalized?.payload ?? toSerializable(event.toHuman ? event.toHuman() : event.toJSON());
            if (!normalized) {
                if (!shouldTrackEvent(section, method)) {
                    continue;
                }
                normalized = this.normalizeEvent(section, method, payload, signer);
            }
            const existing = await db.socialIndexedEvent.findFirst({
                where: {
                    chain: config_1.config.socialAnalytics.chainName,
                    blockNumber,
                    eventIndex,
                },
            });
            if (existing) {
                continue;
            }
            await db.socialIndexedEvent.create({
                data: {
                    chain: config_1.config.socialAnalytics.chainName,
                    blockNumber,
                    blockHash,
                    eventIndex,
                    extrinsicIndex,
                    extrinsicHash,
                    pallet: normalized.pallet,
                    method: normalized.method,
                    kind: normalized.kind,
                    accountAddress: normalized.accountAddress,
                    counterpartyAddress: normalized.counterpartyAddress,
                    pairSymbol: normalized.pairSymbol,
                    amountIn: normalized.amountIn,
                    amountOut: normalized.amountOut,
                    price: normalized.price,
                    realizedPnl: normalized.realizedPnl,
                    timestamp: new Date(blockTimestamp),
                    payload,
                },
            });
            indexedEvents += 1;
        }
        return { blockHash, indexedEvents };
    }
    async syncOnce() {
        if (!this.isEnabled()) {
            await this.updateCursor({ status: 'DISABLED' });
            return { enabled: false, processedBlocks: 0, indexedEvents: 0 };
        }
        const db = getAnalyticsDb();
        if (!db) {
            return { enabled: true, processedBlocks: 0, indexedEvents: 0, prismaReady: false };
        }
        const isReady = await this.ensureReady();
        if (!isReady || !this.api) {
            await this.updateCursor({ status: 'ERROR', lastError: 'Blockchain API unavailable' });
            return { enabled: true, processedBlocks: 0, indexedEvents: 0, prismaReady: true };
        }
        const latestHeader = await this.api.rpc.chain.getHeader();
        const latestBlock = latestHeader.number.toNumber();
        const cursor = await this.getOrCreateCursor();
        if (!cursor) {
            return { enabled: true, processedBlocks: 0, indexedEvents: 0, prismaReady: true };
        }
        const startBlock = cursor.lastProcessedBlock > 0
            ? cursor.lastProcessedBlock + 1
            : Math.max(config_1.config.socialAnalytics.startBlock, Math.max(latestBlock - config_1.config.socialAnalytics.backfillBlocks + 1, 1));
        if (startBlock > latestBlock) {
            await this.updateCursor({ status: 'IDLE', lastProcessedAt: new Date(), lastError: null });
            return {
                enabled: true,
                processedBlocks: 0,
                indexedEvents: 0,
                latestBlock,
                lastProcessedBlock: cursor.lastProcessedBlock,
            };
        }
        const endBlock = Math.min(latestBlock, startBlock + config_1.config.socialAnalytics.maxBlocksPerRun - 1);
        await this.updateCursor({ status: 'RUNNING', lastError: null });
        try {
            const summary = await this.processRange(startBlock, endBlock);
            await this.updateCursor({ status: 'IDLE', lastError: null });
            return {
                enabled: true,
                processedBlocks: summary.processedBlocks,
                indexedEvents: summary.indexedEvents,
                latestBlock,
                lastProcessedBlock: summary.lastProcessedBlock,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown indexing error';
            if (this.isPrunedBlockError(error)) {
                const recoveryStartBlock = this.getRecoveryStartBlock(latestBlock);
                if (recoveryStartBlock > startBlock) {
                    await this.updateCursor({
                        status: 'RUNNING',
                        lastProcessedBlock: recoveryStartBlock - 1,
                        lastProcessedHash: null,
                        lastProcessedAt: new Date(),
                        lastError: `Historical backfill skipped. Node pruned older state. Resuming from block ${recoveryStartBlock}. Original error: ${message}`,
                    });
                    try {
                        const recoveryEndBlock = Math.min(latestBlock, recoveryStartBlock + config_1.config.socialAnalytics.maxBlocksPerRun - 1);
                        const recoveredSummary = await this.processRange(recoveryStartBlock, recoveryEndBlock);
                        await this.updateCursor({ status: 'IDLE', lastError: null });
                        return {
                            enabled: true,
                            processedBlocks: recoveredSummary.processedBlocks,
                            indexedEvents: recoveredSummary.indexedEvents,
                            latestBlock,
                            lastProcessedBlock: recoveredSummary.lastProcessedBlock,
                            recovered: true,
                        };
                    }
                    catch (recoveryError) {
                        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown indexing error';
                        await this.updateCursor({ status: 'ERROR', lastError: recoveryMessage });
                        throw recoveryError;
                    }
                }
            }
            await this.updateCursor({ status: 'ERROR', lastError: message });
            throw error;
        }
    }
}
exports.socialIndexerService = new SocialIndexerService();
//# sourceMappingURL=socialIndexerService.js.map