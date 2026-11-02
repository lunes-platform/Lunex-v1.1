/**
 * useAsymmetricDeploy — React hook for deploying and managing AsymmetricPair contracts.
 *
 * Integrates with:
 *  - contractService (for the shared ApiPromise)
 *  - asymmetricContractService (typed calls to AsymmetricPair)
 *  - SDKContext (wallet connection + currentAccount)
 *  - spot-api backend (/api/v1/asymmetric) to register the strategy in the DB
 */

import { useState, useCallback } from 'react'
import { contractService } from '../services/contractService'
import { asymmetricContractService } from '../services/asymmetricContractService'
import { useSDK } from '../context/SDKContext'
import { web3Accounts } from '@polkadot/extension-dapp'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import {
  buildAsymmetricCreateStrategySignMessage,
  createSignedActionMetadata
} from '../utils/signing'

const API_BASE =
  process.env.REACT_APP_SPOT_API_URL ||
  process.env.REACT_APP_API_URL ||
  'http://localhost:4000'

// ─── Types ────────────────────────────────────────────────────────

export interface DeployStrategyArgs {
  // Token pair
  baseToken: string
  quoteToken: string

  // Buy curve
  buyGamma: number // 1–5
  buyMaxCapacity: string // LUSDT units (human readable, e.g. "10000")
  buyFeeBps: number // 0–1000

  // Sell curve
  sellGamma: number
  sellMaxCapacity: string
  sellFeeBps: number

  // Initial deposit — how many tokens to seed the curve with
  initialBuyK: string // e.g. "1000"
  initialSellK: string

  // Strategy metadata
  pairSymbol: string
  autoRebalance?: boolean
  profitTargetBps?: number
}

export interface DeployState {
  step:
    | 'idle'
    | 'fetching'
    | 'instantiating'
    | 'deploying'
    | 'registering'
    | 'done'
    | 'error'
  txHash: string | null
  contractAddress: string | null
  strategyId: string | null
  error: string | null
}

const PLANCKS_PER_UNIT = 1_000_000_000_000n // 10^12

function toPlancks(units: string, decimals = 12): string {
  try {
    const [intPart, fracPart = ''] = units.split('.')
    const padded = fracPart.padEnd(decimals, '0').slice(0, decimals)
    return (
      BigInt(intPart) * PLANCKS_PER_UNIT +
      BigInt(padded || '0')
    ).toString()
  } catch {
    return '0'
  }
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useAsymmetricDeploy() {
  const { walletAddress, isConnected, signMessage } = useSDK()

  const [state, setState] = useState<DeployState>({
    step: 'idle',
    txHash: null,
    contractAddress: null,
    strategyId: null,
    error: null
  })

  const getAccount =
    useCallback(async (): Promise<InjectedAccountWithMeta | null> => {
      if (!walletAddress) return null
      const accounts = await web3Accounts()
      return accounts.find(a => a.address === walletAddress) ?? null
    }, [walletAddress])

  /**
   * Staged deployment (one call per wallet step, for the tx progress modal):
   *   1. instantiate() — fetch the verified bundle and instantiate the
   *      AsymmetricPair contract (user signs → user is owner)
   *   2. seed()        — deploy_liquidity with the initial k values
   *                      (resolves once finalized, returns the tx hash)
   *   3. register()    — register the strategy on the spot-api backend
   */
  const createDeployment = useCallback(
    (args: DeployStrategyArgs) => {
      let account: InjectedAccountWithMeta | null = null
      let contractAddress: string | null = null
      let txHash: string | null = null
      let strategyId: string | null = null

      const fail = (err: unknown): never => {
        const message =
          err instanceof Error ? err.message : String(err ?? 'Unknown error')
        console.error('[useAsymmetricDeploy] error:', err)
        setState(s => ({ ...s, step: 'error', error: message }))
        throw err instanceof Error ? err : new Error(message)
      }

      const instantiate = async (): Promise<string> => {
        try {
          if (!isConnected || !walletAddress) {
            throw new Error('Wallet not connected')
          }
          account = await getAccount()
          if (!account) throw new Error('Could not find wallet account')

          let api = contractService.getApi()
          if (!api) {
            await contractService.connect('testnet')
            api = contractService.getApi()
          }
          if (!api) throw new Error('Could not connect to Lunes blockchain')
          asymmetricContractService.setApi(api)

          setState({
            step: 'fetching',
            txHash: null,
            contractAddress: null,
            strategyId: null,
            error: null
          })
          const bundleRes = await fetch(
            `${API_BASE}/api/v1/asymmetric/contract-bundle`
          )
          if (!bundleRes.ok) {
            const err = await bundleRes.json().catch(() => ({}))
            throw new Error(
              (err as { error?: string }).error ??
                'Contract bundle unavailable. Build the AsymmetricPair contract first.'
            )
          }
          const bundle = await bundleRes.json()

          setState(s => ({ ...s, step: 'instantiating' }))
          contractAddress = await asymmetricContractService.instantiate(
            bundle,
            args.baseToken,
            args.quoteToken,
            args.buyGamma,
            toPlancks(args.buyMaxCapacity),
            args.buyFeeBps,
            args.sellGamma,
            toPlancks(args.sellMaxCapacity),
            args.sellFeeBps,
            account
          )
          setState(s => ({ ...s, contractAddress }))
          return contractAddress
        } catch (err) {
          return fail(err)
        }
      }

      const seed = async (): Promise<string> => {
        try {
          if (!account || !contractAddress) {
            throw new Error('Contract not instantiated')
          }
          setState(s => ({ ...s, step: 'deploying' }))
          txHash = await asymmetricContractService.deployLiquidity(
            contractAddress,
            toPlancks(args.initialBuyK),
            toPlancks(args.initialSellK),
            account
          )
          setState(s => ({ ...s, txHash }))
          return txHash
        } catch (err) {
          return fail(err)
        }
      }

      const register = async () => {
        try {
          if (!walletAddress || !contractAddress) {
            throw new Error('Contract not deployed')
          }
          setState(s => ({ ...s, step: 'registering' }))

          const signedAction = createSignedActionMetadata()
          const fields = {
            pairAddress: contractAddress,
            isAutoRebalance: args.autoRebalance ?? true,
            buyK: args.initialBuyK,
            buyGamma: args.buyGamma,
            buyMaxCapacity: args.buyMaxCapacity,
            buyFeeTargetBps: args.buyFeeBps,
            sellGamma: args.sellGamma,
            sellMaxCapacity: args.sellMaxCapacity,
            sellFeeTargetBps: args.sellFeeBps,
            sellProfitTargetBps: args.profitTargetBps ?? 300,
            leverageL: '0',
            allocationC: 0.5,
            nonce: signedAction.nonce,
            timestamp: signedAction.timestamp
          }
          const signature = await signMessage(
            buildAsymmetricCreateStrategySignMessage({
              address: walletAddress,
              ...fields
            })
          )

          const res = await fetch(`${API_BASE}/api/v1/asymmetric/strategies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: walletAddress,
              ...fields,
              signature
            })
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(
              (err as { error?: string }).error ?? 'Backend registration failed'
            )
          }
          const data = (await res.json()) as { id?: string }
          strategyId = data.id ?? null

          setState({
            step: 'done',
            txHash,
            contractAddress,
            strategyId,
            error: null
          })
          return { txHash, contractAddress, strategyId }
        } catch (err) {
          return fail(err)
        }
      }

      return {
        instantiate,
        seed,
        register,
        result: () => ({ txHash, contractAddress, strategyId })
      }
    },
    [isConnected, walletAddress, getAccount, signMessage]
  )

  /** Full deployment flow (all stages in sequence). */
  const deploy = useCallback(
    async (args: DeployStrategyArgs) => {
      const d = createDeployment(args)
      await d.instantiate()
      await d.seed()
      const r = await d.register()
      return {
        txHash: r.txHash ?? '',
        contractAddress: r.contractAddress ?? '',
        strategyId: r.strategyId ?? undefined
      }
    },
    [createDeployment]
  )

  /**
   * Update curve parameters of an already-deployed contract.
   */
  const updateParams = useCallback(
    async (
      contractAddress: string,
      isBuy: boolean,
      gamma: number | null,
      maxCapacity: string | null,
      feeBps: number | null
    ) => {
      const account = await getAccount()
      if (!account) throw new Error('Wallet not connected')

      let api = contractService.getApi()
      if (!api) {
        await contractService.connect('testnet')
        api = contractService.getApi()
      }
      if (api) asymmetricContractService.setApi(api)

      return await asymmetricContractService.updateCurveParameters(
        contractAddress,
        isBuy,
        gamma,
        maxCapacity !== null ? toPlancks(maxCapacity) : null,
        feeBps,
        account
      )
    },
    [getAccount]
  )

  const reset = () =>
    setState({
      step: 'idle',
      txHash: null,
      contractAddress: null,
      strategyId: null,
      error: null
    })

  return { state, deploy, createDeployment, updateParams, reset }
}
