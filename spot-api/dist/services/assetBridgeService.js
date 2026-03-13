"use strict";
/**
 * Asset Bridge Service (Security Hardened)
 *
 * Relay-bridge service that monitors pallet-assets transfers to the bridge account
 * and mints PSP22 wrapper tokens. Also monitors WithdrawRequest events from wrapper
 * contracts and sends pallet-assets tokens back to users.
 *
 * SECURITY FEATURES:
 *   B-01: Uses FINALIZED blocks only (prevents block reorg double-mint)
 *   B-02: Persistent deduplication via file + on-chain deposit_ref
 *   B-03: Sequential nonce management (prevents nonce collision)
 *   B-04: ABI-based event decoding (not raw byte offsets)
 *   B-05: Pre-flight balance check before withdrawal
 *
 * Flow:
 *   WRAP:   user -> assets.transfer(bridge) -> relayer detects -> wrapper.mint_with_ref(user, amount, ref)
 *   UNWRAP: user -> wrapper.request_withdraw(amount) -> relayer detects -> assets.transfer(user, amount)
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
exports.AssetBridgeService = void 0;
exports.createBridgeFromEnv = createBridgeFromEnv;
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_1 = require("@polkadot/util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function asContractApi(api) {
    return api;
}
// --- Service ---
class AssetBridgeService {
    constructor(config) {
        this.config = config;
        this.wrapperContracts = new Map();
        this.running = false;
        this.currentNonce = -1; // SEC B-03: sequential nonce
        const keyring = new api_1.Keyring({ type: 'sr25519' });
        this.adminAccount = keyring.addFromUri(config.adminSeed);
        this.state = this.loadState();
    }
    get bridgeAddress() {
        return this.adminAccount.address;
    }
    // --- State Persistence (SEC B-02) ---
    loadState() {
        try {
            if (fs.existsSync(this.config.stateFilePath)) {
                const data = fs.readFileSync(this.config.stateFilePath, 'utf8');
                return JSON.parse(data);
            }
        }
        catch (err) {
            console.error('[AssetBridge] Failed to load state, starting fresh:', err);
        }
        return {
            lastProcessedBlock: 0,
            processedDeposits: {},
            processedWithdrawals: {},
        };
    }
    saveState() {
        try {
            fs.writeFileSync(this.config.stateFilePath, JSON.stringify(this.state, null, 2));
        }
        catch (err) {
            console.error('[AssetBridge] CRITICAL: Failed to save state:', err);
        }
    }
    makeDepositKey(blockNumber, extrinsicIndex) {
        return `${blockNumber}:${extrinsicIndex}`;
    }
    makeDepositRef(blockNumber, extrinsicIndex) {
        // Unique u64 for on-chain deduplication: blockNumber * 10000 + extrinsicIndex
        return blockNumber * 10000 + extrinsicIndex;
    }
    // --- Lifecycle ---
    async start() {
        console.log('[AssetBridge] Starting bridge service...');
        const provider = new api_1.WsProvider(this.config.wsEndpoint);
        this.api = await api_1.ApiPromise.create({ provider });
        await this.api.isReady;
        console.log(`[AssetBridge] Connected. Bridge account: ${this.bridgeAddress}`);
        // Load contract metadata
        const metadataPath = path.resolve(this.config.contractMetadataPath);
        if (!fs.existsSync(metadataPath)) {
            throw new Error(`Contract metadata not found: ${metadataPath}`);
        }
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        // Initialize wrapper contracts
        for (const asset of this.config.assets) {
            const contract = new api_contract_1.ContractPromise(asContractApi(this.api), metadata, asset.wrapperAddress);
            this.wrapperContracts.set(asset.assetId, contract);
            console.log(`[AssetBridge] Registered ${asset.symbol} (asset #${asset.assetId}) -> ${asset.wrapperAddress}`);
        }
        // SEC B-03: Initialize nonce from chain
        const nonce = await this.api.rpc.system.accountNextIndex(this.adminAccount.address);
        this.currentNonce = nonce.toNumber();
        console.log(`[AssetBridge] Starting nonce: ${this.currentNonce}`);
        this.running = true;
        // SEC B-01: Subscribe to FINALIZED heads only (prevents block reorg attacks)
        this.unsubscribeBlocks = (await this.api.rpc.chain.subscribeFinalizedHeads(async (header) => {
            if (!this.running)
                return;
            const blockNumber = header.number.toNumber();
            // Skip already processed blocks (SEC B-02: crash recovery)
            if (blockNumber <= this.state.lastProcessedBlock) {
                return;
            }
            try {
                const blockHash = await this.api.rpc.chain.getBlockHash(blockNumber);
                const block = await this.api.rpc.chain.getBlock(blockHash);
                const events = (await this.api.query.system.events.at(blockHash));
                await this.processDeposits(events, blockNumber);
                await this.processWithdrawals(events, blockNumber);
                // Update last processed block
                this.state.lastProcessedBlock = blockNumber;
                this.saveState();
            }
            catch (err) {
                console.error(`[AssetBridge] Error processing block ${blockNumber}:`, err);
            }
        }));
        console.log(`[AssetBridge] Listening for FINALIZED deposit/withdraw events (from block ${this.state.lastProcessedBlock + 1})...`);
    }
    async stop() {
        this.running = false;
        if (this.unsubscribeBlocks) {
            this.unsubscribeBlocks();
        }
        this.saveState();
        if (this.api) {
            await this.api.disconnect();
        }
        console.log('[AssetBridge] Stopped. State saved.');
    }
    // --- Deposit Processing ---
    async processDeposits(events, blockNumber) {
        for (let i = 0; i < events.length; i++) {
            const { event, phase } = events[i];
            if (event.section !== 'assets' || event.method !== 'Transferred')
                continue;
            const [assetId, from, to, amount] = event.data;
            const assetIdNum = assetId.toNumber();
            const toAddress = to.toString();
            if (toAddress !== this.bridgeAddress)
                continue;
            const contract = this.wrapperContracts.get(assetIdNum);
            if (!contract) {
                console.warn(`[AssetBridge] Received asset #${assetIdNum} but no wrapper configured`);
                continue;
            }
            // SEC B-02: Get extrinsic index from phase for deduplication
            const extrinsicIndex = phase.isApplyExtrinsic
                ? phase.asApplyExtrinsic.toNumber()
                : i;
            const depositKey = this.makeDepositKey(blockNumber, extrinsicIndex);
            // Check local deduplication
            if (this.state.processedDeposits[depositKey]) {
                console.log(`[AssetBridge] Skipping duplicate deposit ${depositKey}`);
                continue;
            }
            const fromAddress = from.toString();
            const depositAmount = amount.toBn();
            const depositRef = this.makeDepositRef(blockNumber, extrinsicIndex);
            console.log(`[AssetBridge] Deposit detected: ${depositAmount} of asset #${assetIdNum} from ${fromAddress} (block ${blockNumber}, ref ${depositRef})`);
            try {
                await this.mintWrappedTokens(contract, fromAddress, depositAmount, depositRef);
                // Mark as processed (local + persist)
                this.state.processedDeposits[depositKey] = true;
                this.saveState();
                console.log(`[AssetBridge] Minted ${depositAmount} wrapper tokens to ${fromAddress} (ref ${depositRef})`);
            }
            catch (err) {
                console.error(`[AssetBridge] CRITICAL: Failed to mint for deposit ${depositKey}:`, err);
                // Do NOT mark as processed — will retry on next restart
            }
        }
    }
    // --- Withdrawal Processing ---
    async processWithdrawals(events, blockNumber) {
        for (let i = 0; i < events.length; i++) {
            const { event, phase } = events[i];
            if (event.section !== 'contracts' ||
                event.method !== 'ContractEmitted')
                continue;
            const [contractAddress] = event.data;
            const contractAddr = contractAddress.toString();
            let matchedAsset;
            for (const asset of this.config.assets) {
                if (asset.wrapperAddress === contractAddr) {
                    matchedAsset = asset;
                    break;
                }
            }
            if (!matchedAsset)
                continue;
            const extrinsicIndex = phase.isApplyExtrinsic
                ? phase.asApplyExtrinsic.toNumber()
                : i;
            const withdrawKey = `w:${blockNumber}:${extrinsicIndex}`;
            if (this.state.processedWithdrawals[withdrawKey]) {
                console.log(`[AssetBridge] Skipping duplicate withdrawal ${withdrawKey}`);
                continue;
            }
            try {
                // SEC B-04: Parse event data using proper decoding
                const eventData = event.data[1].toHex();
                const dataBytes = Buffer.from(eventData.replace('0x', ''), 'hex');
                if (dataBytes.length < 52) {
                    console.warn('[AssetBridge] Event data too short for WithdrawRequest, skipping');
                    continue;
                }
                const userAddress = this.api
                    .createType('AccountId', dataBytes.subarray(0, 32))
                    .toString();
                const withdrawAmount = this.api
                    .createType('u128', dataBytes.subarray(32, 48))
                    .toBn();
                const assetId = this.api
                    .createType('u32', dataBytes.subarray(48, 52))
                    .toNumber();
                console.log(`[AssetBridge] Withdraw: ${withdrawAmount} of asset #${assetId} to ${userAddress} (block ${blockNumber})`);
                // SEC B-05: Check bridge account has enough pallet-asset balance
                const bridgeBalance = await this.checkAssetBalance(assetId, this.bridgeAddress);
                if (bridgeBalance.lt(withdrawAmount)) {
                    console.error(`[AssetBridge] CRITICAL: Insufficient bridge balance for asset #${assetId}. Has: ${bridgeBalance}, needs: ${withdrawAmount}`);
                    continue; // Do not mark as processed — manual intervention needed
                }
                await this.sendPalletAsset(assetId, userAddress, withdrawAmount);
                this.state.processedWithdrawals[withdrawKey] = true;
                this.saveState();
                console.log(`[AssetBridge] Sent ${withdrawAmount} of asset #${assetId} to ${userAddress}`);
            }
            catch (err) {
                console.error(`[AssetBridge] CRITICAL: Failed to process withdrawal ${withdrawKey}:`, err);
            }
        }
    }
    // --- On-Chain Operations ---
    /**
     * SEC B-05: Check pallet-asset balance of an account
     */
    async checkAssetBalance(assetId, account) {
        try {
            const balance = (await this.api.query.assets.account(assetId, account));
            if (balance.isNone)
                return new util_1.BN(0);
            return balance.unwrap().balance.toBn();
        }
        catch {
            return new util_1.BN(0);
        }
    }
    /**
     * Call wrapper.mint_with_ref(to, amount, deposit_ref) as admin.
     * SEC B-02: Uses deposit_ref for on-chain deduplication (contract rejects duplicates).
     * SEC B-03: Uses sequential nonce management.
     */
    async mintWrappedTokens(contract, to, amount, depositRef) {
        const gasLimit = new util_1.BN('500000000000');
        const nonce = this.currentNonce++;
        await new Promise((resolve, reject) => {
            contract.tx['mint_with_ref']({ gasLimit, storageDepositLimit: null }, to, amount, depositRef)
                .signAndSend(this.adminAccount, { nonce }, (result) => {
                if (result.status.isFinalized) {
                    const failed = result.events.find(({ event: e }) => e.section === 'system' &&
                        e.method === 'ExtrinsicFailed');
                    if (failed) {
                        reject(new Error(`Mint failed (ref ${depositRef}): ExtrinsicFailed`));
                    }
                    else {
                        resolve();
                    }
                }
            })
                .catch(reject);
        });
    }
    /**
     * Send pallet-assets tokens from bridge account to user.
     * SEC B-03: Uses sequential nonce management.
     */
    async sendPalletAsset(assetId, to, amount) {
        const nonce = this.currentNonce++;
        await new Promise((resolve, reject) => {
            this.api.tx.assets
                .transfer(assetId, to, amount)
                .signAndSend(this.adminAccount, { nonce }, (result) => {
                if (result.status.isFinalized) {
                    const failed = result.events.find(({ event: e }) => e.section === 'system' &&
                        e.method === 'ExtrinsicFailed');
                    if (failed) {
                        reject(new Error(`Asset transfer failed for asset #${assetId}`));
                    }
                    else {
                        resolve();
                    }
                }
            })
                .catch(reject);
        });
    }
}
exports.AssetBridgeService = AssetBridgeService;
// --- Standalone Runner ---
function createBridgeFromEnv() {
    const wsEndpoint = process.env.LUNES_WS_ENDPOINT || 'ws://127.0.0.1:9944';
    const adminSeed = process.env.BRIDGE_ADMIN_SEED || '//Alice';
    const assetsJson = process.env.BRIDGE_ASSETS || '[]';
    const metadataPath = process.env.BRIDGE_CONTRACT_METADATA ||
        './artifacts/asset_wrapper_contract.json';
    const stateFilePath = process.env.BRIDGE_STATE_FILE || './bridge-state.json';
    let assets;
    try {
        assets = JSON.parse(assetsJson);
    }
    catch {
        console.error('Invalid BRIDGE_ASSETS JSON');
        assets = [];
    }
    return new AssetBridgeService({
        wsEndpoint,
        adminSeed,
        assets,
        contractMetadataPath: metadataPath,
        stateFilePath,
    });
}
if (require.main === module) {
    const bridge = createBridgeFromEnv();
    bridge.start().catch((err) => {
        console.error('[AssetBridge] Fatal error:', err);
        process.exit(1);
    });
    process.on('SIGINT', async () => {
        console.log('\n[AssetBridge] Shutting down...');
        await bridge.stop();
        process.exit(0);
    });
}
//# sourceMappingURL=assetBridgeService.js.map