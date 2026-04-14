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
   * Full deployment flow (no manual address needed):
   *   1. Fetch the verified contract bundle from the backend
   *   2. Instantiate the AsymmetricPair contract on-chain (user signs → user is owner)
   *   3. Call deploy_liquidity to seed the initial k values
   *   4. Register the strategy on the spot-api backend
   */
  const deploy = useCallback(
    async (args: DeployStrategyArgs) => {
      if (!isConnected || !walletAddress) {
        setState(s => ({ ...s, step: 'error', error: 'Wallet not connected' }))
        return
      }

      const account = await getAccount()
      if (!account) {
        setState(s => ({
          ...s,
          step: 'error',
          error: 'Could not find wallet account'
        }))
        return
      }

      try {
        // ── Step 1: Connect to blockchain ─────────────────────────
        let api = contractService.getApi()
        if (!api) {
          await contractService.connect('testnet')
          api = contractService.getApi()
        }
        if (!api) throw new Error('Could not connect to Lunes blockchain')
        asymmetricContractService.setApi(api)

        // ── Step 2: Fetch verified contract bundle from backend ────
        setState(s => ({ ...s, step: 'fetching' }))

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

        // ── Step 3: Instantiate contract on-chain ─────────────────
        // The signing wallet becomes the owner — no manual address needed.
        setState(s => ({ ...s, step: 'instantiating' }))

        const contractAddress = await asymmetricContractService.instantiate(
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

        // ── Step 4: Deploy liquidity (seed initial k values) ──────
        setState(s => ({ ...s, step: 'deploying', contractAddress }))

        const txHash = await asymmetricContractService.deployLiquidity(
          contractAddress,
          toPlancks(args.initialBuyK),
          toPlancks(args.initialSellK),
          account
        )

        // ── Step 5: Register strategy in backend ──────────────────
        setState(s => ({ ...s, step: 'registering', txHash }))

        const signedAction = createSignedActionMetadata()
        const body = {
          userAddress: walletAddress,
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
          timestamp: signedAction.timestamp,
          signature: await signMessage(
            buildAsymmetricCreateStrategySignMessage({
              address: walletAddress,
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
            })
          )
        }

        const res = await fetch(`${API_BASE}/api/v1/asymmetric/strategies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(
            (err as { error?: string }).error ?? 'Backend registration failed'
          )
        }

        const data = (await res.json()) as { id?: string }

        setState({
          step: 'done',
          txHash,
          contractAddress,
          strategyId: data.id ?? null,
          error: null
        })

        return { txHash, contractAddress, strategyId: data.id }
      } catch (err: any) {
        console.error('[useAsymmetricDeploy] error:', err)
        setState(s => ({
          ...s,
          step: 'error',
          error: err.message ?? 'Unknown error'
        }))
        throw err
      }
    },
    [isConnected, walletAddress, getAccount, signMessage]
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

  return { state, deploy, updateParams, reset }
}
