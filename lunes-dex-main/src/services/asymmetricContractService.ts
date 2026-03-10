/**
 * AsymmetricContractService
 *
 * Provides typed methods for interacting with the deployed AsymmetricPair ink! 4.x contract.
 * Follows the same pattern as contractService.ts:
 *   1. Dry-run query to get gasRequired
 *   2. .tx.method().signAndSend() with the user's InjectedAccountWithMeta
 *
 * ABI selectors are defined in AsymmetricPair.json.
 * Method naming: ink! snake_case → @polkadot/api-contract camelCase automatically.
 */

import { ApiPromise } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { web3FromAddress } from '@polkadot/extension-dapp'
import AsymmetricPairABI from '../abis/AsymmetricPair.json'

// Gas limit for dry-run calls
const DRY_GAS = { refTime: BigInt('50000000000'), proofSize: BigInt('1000000') }

export interface CurveSide {
    k: string
    gamma: number
    maxCapacityX0: string
    feeBps: number
    currentVolume: string
}

export interface Guardrails {
    gammaMin: number
    gammaMax: number
    canChangeCapacity: boolean
}

export interface DeployParams {
    baseToken: string
    quoteToken: string
    buyGamma: number
    buyMaxCapacity: string // in plancks (u128 string)
    buyFeeBps: number
    sellGamma: number
    sellMaxCapacity: string // in plancks
    sellFeeBps: number
    initialBuyK: string // plancks deposited on buy side
    initialSellK: string // plancks deposited on sell side
}

class AsymmetricContractService {
    private api: ApiPromise | null = null

    setApi(api: ApiPromise) {
        this.api = api
    }

    private makeDryGas() {
        if (!this.api) throw new Error('API not connected')
        return this.api.registry.createType('WeightV2', DRY_GAS) as any // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
    }

    private getContract(contractAddress: string): ContractPromise {
        if (!this.api) throw new Error('API not connected')
        return new ContractPromise(this.api, AsymmetricPairABI as any, contractAddress)
    }

    // ── Queries ───────────────────────────────────────────────────

    /**
     * Get the buy curve state from a deployed contract.
     */
    async getBuyCurve(contractAddress: string, caller: string): Promise<CurveSide | null> {
        try {
            const c = this.getContract(contractAddress)
            const { result, output } = await c.query.getBuyCurve(caller, { gasLimit: this.makeDryGas() })
            if (result.isOk && output) {
                const j = output.toJSON() as any
                const d = j?.ok ?? j
                return {
                    k: String(d.k ?? '0').replace(/,/g, ''),
                    gamma: Number(d.gamma ?? 3),
                    maxCapacityX0: String(d.maxCapacityX0 ?? '0').replace(/,/g, ''),
                    feeBps: Number(d.feeBps ?? 30),
                    currentVolume: String(d.currentVolume ?? '0').replace(/,/g, ''),
                }
            }
        } catch (e) {
            console.error('getBuyCurve error:', e)
        }
        return null
    }

    /**
     * Simulate amountOut from the contract without executing.
     */
    async getQuote(contractAddress: string, caller: string, amountIn: string, isBuy: boolean): Promise<string> {
        try {
            const c = this.getContract(contractAddress)
            const { result, output } = await c.query.getQuote(
                caller,
                { gasLimit: this.makeDryGas() },
                amountIn,
                isBuy,
            )
            if (result.isOk && output) {
                const j = output.toJSON() as any
                return String(j?.ok ?? j ?? '0').replace(/,/g, '')
            }
        } catch (e) {
            console.error('getQuote error:', e)
        }
        return '0'
    }

    // ── Transactions ──────────────────────────────────────────────

    /**
     * Deploy initial liquidity to a contract (owner only).
     * This is called after contract instantiation to set the initial k values.
     */
    async deployLiquidity(
        contractAddress: string,
        buyK: string,
        sellK: string,
        account: InjectedAccountWithMeta,
    ): Promise<string> {
        const c = this.getContract(contractAddress)
        const injector = await web3FromAddress(account.address)

        const { gasRequired } = await c.query.deployLiquidity(
            account.address,
            { gasLimit: this.makeDryGas() },
            buyK,
            sellK,
        )

        return await new Promise<string>((resolve, reject) => {
            c.tx
                .deployLiquidity({ gasLimit: gasRequired as any, storageDepositLimit: null }, buyK, sellK)
                .signAndSend(account.address, { signer: injector.signer }, (result: any) => {
                    if (result.dispatchError) {
                        reject(new Error(result.dispatchError.toString()))
                    } else if (result.status.isFinalized) {
                        resolve(result.txHash.toHex())
                    }
                })
                .catch(reject)
        })
    }

    /**
     * Update curve parameters (owner or manager within guardrails).
     */
    async updateCurveParameters(
        contractAddress: string,
        isBuy: boolean,
        newGamma: number | null,
        newCapacity: string | null,
        newFeeBps: number | null,
        account: InjectedAccountWithMeta,
    ): Promise<string> {
        const c = this.getContract(contractAddress)
        const injector = await web3FromAddress(account.address)

        const args = [
            isBuy,
            newGamma !== null ? newGamma : null,
            newCapacity !== null ? newCapacity : null,
            newFeeBps !== null ? newFeeBps : null,
        ]

        const { gasRequired } = await c.query.updateCurveParameters(
            account.address,
            { gasLimit: this.makeDryGas() },
            ...args,
        )

        return await new Promise<string>((resolve, reject) => {
            c.tx
                .updateCurveParameters({ gasLimit: gasRequired as any, storageDepositLimit: null }, ...args)
                .signAndSend(account.address, { signer: injector.signer }, (result: any) => {
                    if (result.dispatchError) {
                        reject(new Error(result.dispatchError.toString()))
                    } else if (result.status.isFinalized) {
                        resolve(result.txHash.toHex())
                    }
                })
                .catch(reject)
        })
    }

    /**
     * Set the manager address and guardrails (owner only).
     */
    async setManager(
        contractAddress: string,
        newManager: string | null,
        guardrails: Guardrails,
        account: InjectedAccountWithMeta,
    ): Promise<string> {
        const c = this.getContract(contractAddress)
        const injector = await web3FromAddress(account.address)

        const { gasRequired } = await c.query.setManager(
            account.address,
            { gasLimit: this.makeDryGas() },
            newManager,
            guardrails,
        )

        return await new Promise<string>((resolve, reject) => {
            c.tx
                .setManager({ gasLimit: gasRequired as any, storageDepositLimit: null }, newManager, guardrails)
                .signAndSend(account.address, { signer: injector.signer }, (result: any) => {
                    if (result.dispatchError) {
                        reject(new Error(result.dispatchError.toString()))
                    } else if (result.status.isFinalized) {
                        resolve(result.txHash.toHex())
                    }
                })
                .catch(reject)
        })
    }

    /**
     * Execute an asymmetric swap directly against the contract.
     */
    async asymmetricSwap(
        contractAddress: string,
        amountIn: string,
        isBuy: boolean,
        account: InjectedAccountWithMeta,
    ): Promise<string> {
        const c = this.getContract(contractAddress)
        const injector = await web3FromAddress(account.address)

        const { gasRequired } = await c.query.asymmetricSwap(
            account.address,
            { gasLimit: this.makeDryGas() },
            amountIn,
            isBuy,
        )

        return await new Promise<string>((resolve, reject) => {
            c.tx
                .asymmetricSwap({ gasLimit: gasRequired as any, storageDepositLimit: null }, amountIn, isBuy)
                .signAndSend(account.address, { signer: injector.signer }, (result: any) => {
                    if (result.dispatchError) {
                        reject(new Error(result.dispatchError.toString()))
                    } else if (result.status.isFinalized) {
                        resolve(result.txHash.toHex())
                    }
                })
                .catch(reject)
        })
    }
}

export const asymmetricContractService = new AsymmetricContractService()
