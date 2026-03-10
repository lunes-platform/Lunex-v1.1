import * as fs from 'fs/promises'
import * as path from 'path'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { config } from '../config'
import { log } from '../utils/logger'

/**
 * FactoryService — reads the Factory ink! contract on-chain.
 *
 * The Factory is the source of truth for pair existence.
 * This service is used by the admin pair-registration endpoint
 * to verify a pair exists on-chain before registering it in the DB.
 */
class FactoryService {
    private api: ApiPromise | null = null
    private contract: ContractPromise | null = null
    private initPromise: Promise<boolean> | null = null

    private isConfigured() {
        return Boolean(config.blockchain.wsUrl && config.blockchain.factoryContractAddress && config.blockchain.factoryContractMetadataPath)
    }

    private async initialize(): Promise<boolean> {
        try {
            const metadataPath = path.resolve(config.blockchain.factoryContractMetadataPath)
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'))

            const provider = new WsProvider(config.blockchain.wsUrl)
            const api = await ApiPromise.create({ provider })
            await api.isReady

            this.api = api
            this.contract = new ContractPromise(api as any, metadata as any, config.blockchain.factoryContractAddress)

            log.info('[Factory] On-chain factory service enabled')
            return true
        } catch (error) {
            log.error({ err: error }, '[Factory] Failed to initialize')
            return false
        }
    }

    async ensureReady(): Promise<boolean> {
        if (!this.isConfigured()) return false

        if (!this.initPromise) {
            this.initPromise = this.initialize()
        }

        return this.initPromise
    }

    /**
     * Query the Factory contract for the Pair address of (tokenA, tokenB).
     * Returns the pair's AccountId string if it exists, or null if not yet created.
     */
    async getPair(tokenA: string, tokenB: string): Promise<string | null> {
        const ready = await this.ensureReady()
        if (!ready || !this.contract || !this.api) return null

        try {
            const callerPlaceholder = tokenA // any valid address to serve as caller
            const { result, output } = await this.contract.query.getPair(
                callerPlaceholder,
                { gasLimit: -1, storageDepositLimit: null },
                tokenA,
                tokenB,
            )

            if (result.isErr || !output) return null

            const json = output.toJSON() as any
            // The result is Option<AccountId>: { ok: null } or { ok: "5D..." }
            const inner = json?.ok ?? json
            if (!inner || inner === null) return null

            return typeof inner === 'string' ? inner : null
        } catch (e) {
            log.error({ err: e }, '[Factory] getPair error')
            return null
        }
    }

    /**
     * Returns the total number of pairs registered in the Factory.
     */
    async getAllPairsLength(): Promise<number> {
        const ready = await this.ensureReady()
        if (!ready || !this.contract || !this.api) return 0

        try {
            const { result, output } = await this.contract.query.allPairsLength(
                config.blockchain.factoryContractAddress,
                { gasLimit: -1, storageDepositLimit: null },
            )

            if (result.isErr || !output) return 0
            const json = output.toJSON() as any
            const value = json?.ok ?? json
            return typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10)
        } catch (e) {
            log.error({ err: e }, '[Factory] allPairsLength error')
            return 0
        }
    }

    /**
     * Returns all pair addresses from the Factory, in order.
     * Iterates from index 0 to allPairsLength - 1.
     */
    async getAllPairs(): Promise<string[]> {
        const length = await this.getAllPairsLength()
        if (length === 0) return []

        const results = await Promise.all(
            Array.from({ length }, (_, i) =>
                this.contract!.query.allPairs(
                    config.blockchain.factoryContractAddress,
                    { gasLimit: -1, storageDepositLimit: null },
                    i,
                ).then(({ result, output }) => {
                    if (result.isOk && output) {
                        const json = output.toJSON() as { ok?: unknown } | unknown
                        const inner = (json as { ok?: unknown })?.ok ?? json
                        if (inner && typeof inner === 'string') return inner
                    }
                    return null
                }).catch((e: unknown) => {
                    log.error({ err: e, index: i }, '[Factory] allPairs error')
                    return null
                })
            )
        )

        return results.filter((addr): addr is string => addr !== null)
    }

    async disconnect() {
        if (this.api) {
            await this.api.disconnect()
            this.api = null
            this.contract = null
            this.initPromise = null
        }
    }
}

export const factoryService = new FactoryService()
