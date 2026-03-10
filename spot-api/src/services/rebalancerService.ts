import { Decimal } from '@prisma/client/runtime/library'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import prisma from '../db'
import { config } from '../config'
import { log } from '../utils/logger'
import {
    asymmetricService,
    isCoolingDown,
    isProfitableToRebalance,
} from './asymmetricService'

// ─── Constants ──────────────────────────────────────────────────

const EXPONENTIAL_BACKOFF_BASE_MS = 10_000  // 10s → 20s → 40s
const ASYMMETRIC_PAIR_ABI_PATH = path.resolve(__dirname, '../../../lunes-dex-main/src/abis/AsymmetricPair.json')
const ACCOUNT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/

// ─── Rebalancer Service ─────────────────────────────────────────

class RebalancerService {
    private api: ApiPromise | null = null
    private relayer: ReturnType<Keyring['addFromUri']> | null = null
    private initPromise: Promise<boolean> | null = null
    private asymmetricPairAbi: any = null

    private isConfigured() {
        return Boolean(
            config.blockchain.wsUrl &&
            config.blockchain.relayerSeed,
        )
    }

    isEnabled() {
        return this.isConfigured()
    }

    async ensureReady() {
        if (!this.isConfigured()) return false
        if (!this.initPromise) this.initPromise = this.initialize()
        return this.initPromise
    }

    private async initialize() {
        try {
            await cryptoWaitReady()
            const provider = new WsProvider(config.blockchain.wsUrl)
            this.api = await ApiPromise.create({ provider })
            await this.api.isReady

            const keyring = new Keyring({ type: 'sr25519' })
            this.relayer = keyring.addFromUri(config.blockchain.relayerSeed)

            // Load ABI if available (graceful — contract may not be deployed yet)
            try {
                const raw = await fs.readFile(ASYMMETRIC_PAIR_ABI_PATH, 'utf-8')
                this.asymmetricPairAbi = JSON.parse(raw)
            } catch {
                log.warn('[Rebalancer] AsymmetricPair ABI not found — on-chain updates disabled')
            }

            log.info('[Rebalancer] Sentinel ready')
            return true
        } catch (error) {
            log.error({ err: error }, '[Rebalancer] Failed to initialize')
            return false
        }
    }

    // ─── Main entry point called by socialIndexerService ──────────

    /**
     * Triggered when the on-chain indexer detects an AsymmetricSwapExecuted event.
     * Runs the full Sentinel safety pipeline before calling the Relayer.
     */
    async handleCurveExecution(pairAddress: string, userAddress: string, acquiredAmount: number) {
        const strategy = await prisma.asymmetricStrategy.findFirst({
            where: {
                pairAddress,
                userAddress,
                isAutoRebalance: true,
                status: { in: ['ACTIVE', 'COOLING_DOWN'] },
            },
        })

        if (!strategy) return  // AI agent managing this — backend stays out

        await this.safeRebalance(strategy, acquiredAmount)
    }

    // ─── Sentinel safety pipeline ──────────────────────────────────

    private async safeRebalance(strategy: any, acquiredAmount: number) {
        // 1. Cooldown — accumulate, don't send
        if (isCoolingDown(strategy.lastRebalancedAt)) {
            await asymmetricService.accumulatePending(strategy.id, acquiredAmount)
            return
        }

        // 2. Profitability — avoid burning gas on dust
        const pendingTotal = parseFloat(strategy.pendingAmount.toString()) + acquiredAmount
        if (!isProfitableToRebalance(pendingTotal)) {
            await asymmetricService.accumulatePending(strategy.id, acquiredAmount)
            return
        }

        // 3. Health check — reuse the existing /health endpoint data
        try {
            const health = await this.getSystemHealth(strategy.pairAddress)
            if (health.spread > 1000 || health.oracleAge > 120) {
                log.warn({ pairAddress: strategy.pairAddress }, '[Sentinel] High volatility. Rebalance deferred')
                return
            }
        } catch {
            log.warn('[Sentinel] Health check unavailable. Rebalance deferred')
            return
        }

        // 4. Execute with exponential backoff retry
        await this.executeWithRetry(strategy, pendingTotal)
    }

    private async executeWithRetry(strategy: any, totalAmount: number) {
        const isReady = await this.ensureReady()
        if (!isReady || !this.relayer || !this.api || !this.asymmetricPairAbi) {
            log.warn('[Sentinel] Not ready for on-chain execution — skipping')
            return
        }

        for (let attempt = 0; attempt < asymmetricService.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = EXPONENTIAL_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
                    await sleep(delay)
                }

                const txHash = await this.sendUpdateCurveTx(strategy, totalAmount)
                await asymmetricService.markRebalancedSuccess(strategy.id)

                // Log success
                await prisma.asymmetricRebalanceLog.create({
                    data: {
                        strategyId: strategy.id,
                        side: 'SELL',  // After buy accumulation, we update the sell curve
                        trigger: 'AUTO_REBALANCER',
                        acquiredAmount: new Decimal(totalAmount),
                        newCapacity: new Decimal(totalAmount),
                        txHash,
                        status: 'SUCCESS',
                    },
                })

                log.info({ userAddress: strategy.userAddress, txHash }, '[Sentinel] Rebalanced successfully')
                return
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error)
                log.error({ attempt: attempt + 1, errorMsg }, '[Sentinel] Rebalance attempt failed')

                const suspended = await asymmetricService.recordFailure(strategy.id, errorMsg)

                await prisma.asymmetricRebalanceLog.create({
                    data: {
                        strategyId: strategy.id,
                        side: 'SELL',
                        trigger: 'AUTO_REBALANCER',
                        acquiredAmount: new Decimal(totalAmount),
                        newCapacity: new Decimal(0),
                        status: 'FAILED',
                        lastError: errorMsg,
                    } as any,
                })

                if (suspended) {
                    log.error({ strategyId: strategy.id, maxRetries: asymmetricService.MAX_RETRIES }, '[Sentinel] Strategy SUSPENDED_ERROR after max failures')
                    return
                }
            }
        }
    }

    private async sendUpdateCurveTx(strategy: any, newCapacity: number): Promise<string> {
        if (!this.api || !this.relayer || !this.asymmetricPairAbi) {
            throw new Error('Rebalancer not initialized')
        }

        const contract = new ContractPromise(
            this.api as any,
            this.asymmetricPairAbi,
            strategy.pairAddress,
        )

        // Dry-run to estimate gas (same pattern as settlementService.ts)
        const { gasRequired, result } = await contract.query.updateCurveParameters(
            this.relayer.address,
            { gasLimit: -1, storageDepositLimit: null },
            false,  // isBuy = false — updating sell curve after buy accumulation
            BigInt(Math.floor(newCapacity * 1e8)),
            strategy.sellGamma,
            strategy.sellFeeTargetBps,
        )

        if (result.isErr) {
            throw new Error(`[Rebalancer] Gas dry-run failed: ${result.toString()}`)
        }

        return new Promise<string>((resolve, reject) => {
            let unsub: (() => void) | undefined

            contract.tx
                .updateCurveParameters(
                    { gasLimit: gasRequired, storageDepositLimit: null },
                    false,
                    BigInt(Math.floor(newCapacity * 1e8)),
                    strategy.sellGamma,
                    strategy.sellFeeTargetBps,
                )
                .signAndSend(this.relayer!, (txResult: any) => {
                    if (txResult.dispatchError) {
                        if (unsub) unsub()
                        reject(new Error(txResult.dispatchError.toString()))
                        return
                    }
                    if (txResult.status.isInBlock || txResult.status.isFinalized) {
                        const txHash = txResult.txHash.toHex()
                        if (unsub) unsub()
                        resolve(txHash)
                    }
                })
                .then((unsubscribe: () => void) => { unsub = unsubscribe })
                .catch(reject)
        })
    }

    // ─── Health check (reuses existing /health logic) ──────────────

    private async getSystemHealth(pairAddress: string) {
        if (!ACCOUNT_REGEX.test(pairAddress)) {
            return { spread: 0, oracleAge: 0 }
        }

        // Look up the pair symbol from the strategy to query margin health
        const strategy = await prisma.asymmetricStrategy.findFirst({
            where: { pairAddress, status: { in: ['ACTIVE', 'COOLING_DOWN'] } },
            select: { pairAddress: true },
        })

        // Try to derive spread from the orderbook if we can resolve a pair symbol
        const pair = await (prisma as any).pair.findFirst({
            where: { contractAddress: pairAddress },
            select: { symbol: true },
        })

        let spread = 0
        let oracleAge = 0

        if (pair?.symbol) {
            // 1. Orderbook spread
            const { orderbookManager } = await import('../utils/orderbook')
            const book = orderbookManager.get(pair.symbol)
            if (book) {
                const bestBid = book.getBestBid()
                const bestAsk = book.getBestAsk()
                const lastUpdated = book.getLastUpdatedAt()

                if (bestBid !== null && bestAsk !== null && bestBid > 0) {
                    const mid = (bestBid + bestAsk) / 2
                    spread = Math.round(((bestAsk - bestBid) / mid) * 10_000) // BPS
                }

                if (lastUpdated !== null) {
                    oracleAge = Math.floor((Date.now() - lastUpdated) / 1000) // seconds
                }
            }

            // 2. Margin price health monitor (check if pair is operationally blocked)
            const { marginService } = await import('./marginService')
            const health = marginService.getPriceHealth(pair.symbol)
            if (health.pairs.length > 0) {
                const pairHealth = health.pairs[0]
                if (pairHealth.isOperationallyBlocked) {
                    spread = 10_000 // Force-defer: treat blocked pair as extreme spread
                }
            }
        }

        return { spread, oracleAge }
    }
}

// ─── Utility ────────────────────────────────────────────────────

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export const rebalancerService = new RebalancerService()
