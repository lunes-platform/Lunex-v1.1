"use strict";
/**
 * CopyVault On-Chain Service
 *
 * Handles real blockchain interactions with the CopyVault ink! smart contract.
 * Replaces the mock DB-only deposit/withdraw pattern in socialService.
 *
 * Flow:
 *   1. User signs deposit/withdraw request
 *   2. This service calls the CopyVault contract via Polkadot.js
 *   3. Waits for on-chain confirmation (inBlock or isFinalized)
 *   4. Returns the tx hash — caller updates DB only AFTER confirmation
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
exports.copyVaultService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_1 = require("@polkadot/api");
const api_contract_1 = require("@polkadot/api-contract");
const util_crypto_1 = require("@polkadot/util-crypto");
const util_1 = require("@polkadot/util");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const txWithTimeout_1 = require("../utils/txWithTimeout");
// ─── Constants ──────────────────────────────────────────────────
const COPY_VAULT_ABI_PATH = path.resolve(__dirname, '../../../lunes-dex-main/src/abis/CopyVault.json');
const PLANCKS_PER_UNIT = new util_1.BN('100000000'); // 10^8 for LUNES
// ─── Service ────────────────────────────────────────────────────
class CopyVaultService {
    constructor() {
        this.api = null;
        this.relayer = null;
        this.abi = null;
        this.initPromise = null;
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
            // Load CopyVault ABI
            if (fs.existsSync(COPY_VAULT_ABI_PATH)) {
                const raw = fs.readFileSync(COPY_VAULT_ABI_PATH, 'utf-8');
                this.abi = JSON.parse(raw);
                logger_1.log.info('[CopyVault] Service initialized — on-chain mode');
            }
            else {
                logger_1.log.warn('[CopyVault] ABI not found — service disabled');
                return false;
            }
            return true;
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[CopyVault] Initialization failed');
            return false;
        }
    }
    /**
     * Call the CopyVault contract's `deposit()` method on-chain.
     * The contract mints shares proportional to deposited amount.
     */
    async deposit(vaultAddress, depositorAddress, amount) {
        const ready = await this.ensureReady();
        if (!ready || !this.api || !this.relayer || !this.abi) {
            throw new Error('[CopyVault] Service not ready for on-chain calls');
        }
        const contract = new api_contract_1.ContractPromise(this.api, this.abi, vaultAddress);
        const value = new util_1.BN(amount).mul(PLANCKS_PER_UNIT);
        // Dry-run for gas estimate
        const { gasRequired, result } = await contract.query.deposit(depositorAddress, { gasLimit: -1, storageDepositLimit: null, value });
        if (result.isErr) {
            throw new Error(`[CopyVault] Deposit dry-run failed: ${result.toString()}`);
        }
        // Execute real transaction
        const depositPromise = new Promise((resolve, reject) => {
            let unsub;
            contract.tx
                .deposit({ gasLimit: gasRequired, storageDepositLimit: null, value })
                .signAndSend(this.relayer, (txResult) => {
                if (txResult.dispatchError) {
                    if (unsub)
                        unsub();
                    reject(new Error(`[CopyVault] Deposit failed: ${txResult.dispatchError.toString()}`));
                    return;
                }
                if (txResult.status.isInBlock || txResult.status.isFinalized) {
                    const txHash = txResult.txHash.toHex();
                    const blockHash = txResult.status.isInBlock
                        ? txResult.status.asInBlock.toHex()
                        : txResult.status.asFinalized.toHex();
                    if (unsub)
                        unsub();
                    resolve({
                        txHash,
                        blockHash,
                        shares: '0', // Parsed from events by caller
                        success: true,
                    });
                }
            })
                .then((unsubscribe) => { unsub = unsubscribe; })
                .catch(reject);
        });
        return (0, txWithTimeout_1.withTxTimeout)(`vault_deposit:${vaultAddress}:${depositorAddress}`, depositPromise);
    }
    /**
     * Call the CopyVault contract's `withdraw()` method on-chain.
     * Burns shares and returns the proportional underlying tokens.
     */
    async withdraw(vaultAddress, withdrawerAddress, shares) {
        const ready = await this.ensureReady();
        if (!ready || !this.api || !this.relayer || !this.abi) {
            throw new Error('[CopyVault] Service not ready for on-chain calls');
        }
        const contract = new api_contract_1.ContractPromise(this.api, this.abi, vaultAddress);
        const shareBN = new util_1.BN(shares).mul(PLANCKS_PER_UNIT);
        // Dry-run
        const { gasRequired, result } = await contract.query.withdraw(withdrawerAddress, { gasLimit: -1, storageDepositLimit: null }, shareBN);
        if (result.isErr) {
            throw new Error(`[CopyVault] Withdraw dry-run failed: ${result.toString()}`);
        }
        const withdrawPromise = new Promise((resolve, reject) => {
            let unsub;
            contract.tx
                .withdraw({ gasLimit: gasRequired, storageDepositLimit: null }, shareBN)
                .signAndSend(this.relayer, (txResult) => {
                if (txResult.dispatchError) {
                    if (unsub)
                        unsub();
                    reject(new Error(`[CopyVault] Withdraw failed: ${txResult.dispatchError.toString()}`));
                    return;
                }
                if (txResult.status.isInBlock || txResult.status.isFinalized) {
                    const txHash = txResult.txHash.toHex();
                    const blockHash = txResult.status.isInBlock
                        ? txResult.status.asInBlock.toHex()
                        : txResult.status.asFinalized.toHex();
                    if (unsub)
                        unsub();
                    resolve({
                        txHash,
                        blockHash,
                        amount: '0', // Parsed from events by caller
                        success: true,
                    });
                }
            })
                .then((unsubscribe) => { unsub = unsubscribe; })
                .catch(reject);
        });
        return (0, txWithTimeout_1.withTxTimeout)(`vault_withdraw:${vaultAddress}:${withdrawerAddress}`, withdrawPromise);
    }
}
exports.copyVaultService = new CopyVaultService();
//# sourceMappingURL=copyVaultService.js.map