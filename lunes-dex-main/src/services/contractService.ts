/**
 * Contract Service for Lunex DEX
 * Handles real blockchain interactions with Ink! smart contracts
 *
 * Method name reference (ink! 4.x + @polkadot/api-contract):
 * - snake_case labels in ABI are exposed as camelCase in JS
 * - NO namespace prefixes (not 'factory::getPair', just 'getPair')
 * - PSP22 selectors override: balance_of=0x6568382f, transfer_from=0x54b3c76e, etc.
 * - Router deadline MUST be in milliseconds (chain uses ms timestamps)
 */

// Heavy @polkadot/* runtime is loaded lazily (dynamic import) so the
// ~388 KB gzip polkadot chunk is NOT pulled into the eager app bundle.
// Only TYPE imports are static (erased at build time, zero runtime cost).
import type { ApiPromise } from '@polkadot/api'
import type { ContractPromise } from '@polkadot/api-contract'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'

// Cached lazily-imported constructors / functions.
type PolkadotApiModule = typeof import('@polkadot/api')
type PolkadotContractModule = typeof import('@polkadot/api-contract')

let apiModulePromise: Promise<PolkadotApiModule> | null = null
let contractModulePromise: Promise<PolkadotContractModule> | null = null

const loadApiModule = (): Promise<PolkadotApiModule> => {
  if (!apiModulePromise) apiModulePromise = import('@polkadot/api')
  return apiModulePromise
}

const loadContractModule = (): Promise<PolkadotContractModule> => {
  if (!contractModulePromise)
    contractModulePromise = import('@polkadot/api-contract')
  return contractModulePromise
}

import { getSignerFor } from '../wallet/activeWallet'

import RouterABI from '../abis/Router.json'
import FactoryABI from '../abis/Factory.json'
import PairABI from '../abis/Pair.json'
import WNativeABI from '../abis/WNative.json'
import StakingABI from '../abis/Staking.json'
import CopyVaultABI from '../abis/CopyVault.json'

/** CopyVault COOLDOWN_PERIOD_MS (Lunex/contracts/copy_vault/lib.rs). */
const COPY_VAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000
import SpotSettlementABI from '../abis/SpotSettlement.json'
import { CONTRACTS, NETWORK } from '../config/contracts'
import { setSigningChainGenesis } from '../utils/signing'
import { isValidSubstrateAddress } from '../utils/address'
import { normalizeReservesForPath } from '../utils/reserveUtils'
import {
  DAY_MS,
  DEFAULT_PROPOSAL_FEE_PLANCK,
  VOTE_COST_PLANCK,
  decodeListingStats,
  decodeProposal,
  decodeStakePosition,
  describeStakingError,
  estimateAprBps,
  inkError,
  toPlanckString,
  unwrapInk
} from '../utils/staking'
import type {
  GovernanceProposal,
  ListingStats,
  StakePositionView
} from '../utils/staking'

// Network configuration — env vars override defaults so local dev node is used automatically
const NETWORKS = {
  testnet: process.env.REACT_APP_RPC_TESTNET || 'wss://ws-test.lunes.io',
  mainnet: process.env.REACT_APP_RPC_MAINNET || 'wss://ws.lunes.io',
  mainnet2: 'wss://ws-lunes-main-01.lunes.io',
  mainnet3: 'wss://ws-lunes-main-02.lunes.io',
  archive: 'wss://ws-archive.lunes.io',
  local: 'ws://127.0.0.1:9944'
}

export interface ContractAddresses {
  factory: string
  router: string
  wnative: string
  staking?: string
  rewards?: string
}

export interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals: number
  totalSupply: string
}

export interface PairInfo {
  address: string
  token0: string
  token1: string
  reserve0: string
  reserve1: string
  totalSupply: string
}

// Dry-run gas limit. proofSize precisa ser generoso (5M) porque swaps passam
// por chamadas cross-contract aninhadas (router→factory→pair→psp22); 1M causava
// ContractTrapped (module 24, 0x02000000) no dry-run do swap.
const DRY_GAS = {
  refTime: BigInt('500000000000'),
  proofSize: BigInt('5000000')
}

class ContractService {
  private api: ApiPromise | null = null
  private isConnected = false
  private contracts: ContractAddresses | null = null

  // Lazily-resolved @polkadot/api-contract ContractPromise constructor.
  // Populated during connect() (after the dynamic import resolves) so that
  // the synchronous this.newContract(...) call sites keep working.
  private ContractPromiseCtor:
    | PolkadotContractModule['ContractPromise']
    | null = null

  // Contract Instances
  private routerContract: ContractPromise | null = null
  private factoryContract: ContractPromise | null = null
  private stakingContract: ContractPromise | null = null

  /**
   * Build a ContractPromise using the lazily-imported constructor.
   * Safe to call after connect() has resolved (ctor is cached).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private newContract(api: ApiPromise, abi: any, address: string) {
    if (!this.ContractPromiseCtor) {
      throw new Error('Polkadot contract module not loaded yet')
    }
    return new this.ContractPromiseCtor(api, abi, address)
  }

  /**
   * Initialize connection to the blockchain
   */
  async connect(network: keyof typeof NETWORKS = 'testnet'): Promise<boolean> {
    if (this.isConnected && this.api) {
      return true
    }

    try {
      const [{ ApiPromise, WsProvider }, { ContractPromise }] =
        await Promise.all([loadApiModule(), loadContractModule()])
      this.ContractPromiseCtor = ContractPromise

      const wsProvider = new WsProvider(NETWORKS[network])
      this.api = await ApiPromise.create({ provider: wsProvider })

      await this.api.isReady
      this.isConnected = true
      // Bind every wallet-signed message to this chain (REACT_APP_LUNES_GENESIS_HASH,
      // when set, still takes precedence inside utils/signing).
      setSigningChainGenesis(this.api.genesisHash.toHex())

      // Contract addresses may have been registered (via setContracts) before
      // connect() ran — e.g. at SDK boot, where connect() is now deferred until
      // first real use. The ContractPromise instances can only be built once
      // this.api exists, so (re)build them here from the stored addresses.
      if (this.contracts) {
        this.setContracts(this.contracts)
      }

      console.log(`Connected to ${network}: ${NETWORKS[network]}`)
      return true
    } catch (error) {
      console.error('Failed to connect to blockchain:', error)
      this.isConnected = false
      return false
    }
  }

  /**
   * Disconnect from blockchain
   */
  async disconnect(): Promise<void> {
    if (this.api) {
      await this.api.disconnect()
      this.api = null
      this.isConnected = false
    }
  }

  /**
   * Set contract addresses and initialize ContractPromise instances
   */
  setContracts(addresses: ContractAddresses): void {
    this.contracts = addresses
    if (this.api) {
      if (this.isValidAddress(addresses.router)) {
        this.routerContract = this.newContract(
          this.api,
          RouterABI as any,
          addresses.router
        )
      }
      if (this.isValidAddress(addresses.factory)) {
        this.factoryContract = this.newContract(
          this.api,
          FactoryABI as any,
          addresses.factory
        )
      }
      if (this.isValidAddress(addresses.staking)) {
        this.stakingContract = this.newContract(
          this.api,
          StakingABI as any,
          addresses.staking!
        )
      }
    }
  }

  getApi(): ApiPromise | null {
    return this.api
  }

  getIsConnected(): boolean {
    return this.isConnected
  }

  private isValidAddress(addr: string | undefined | null): addr is string {
    return typeof addr === 'string' && addr.length >= 10
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private makeDryGas(): any {
    if (!this.api) throw new Error('Not connected')
    return this.api.registry.createType('WeightV2', DRY_GAS)
  }

  /**
   * Unwrap nested ink Result envelopes from output.toJSON().
   * Messages that return `Result<T, E>` produce two layers:
   * `{ ok: { ok: <value> } }` (MessageResult wraps the function Result).
   * Returns the innermost scalar, or null if any layer is `Err`.
   */
  private unwrapResult(json: unknown): unknown {
    let v: unknown = json
    while (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if ('err' in o || 'Err' in o) return null
      if ('ok' in o) {
        v = o.ok
        continue
      }
      if ('Ok' in o) {
        v = o.Ok
        continue
      }
      break
    }
    return v
  }

  /**
   * Decode a pallet dispatchError into a human-readable string.
   * pallet_contracts (module 24) error codes are mapped to names.
   */
  private decodeDispatchError(dispatchError: any): string {
    try {
      if (dispatchError.isModule) {
        const mod = dispatchError.asModule
        const errorIdx = mod.error[0] // first byte = error index
        const palletContracts: Record<number, string> = {
          0: 'OutOfGas',
          1: 'OutputBufferTooSmall',
          2: 'TransferFailed',
          3: 'MaxCallDepthReached',
          4: 'ContractNotFound',
          5: 'CodeTooLarge',
          6: 'InvalidInstantiateInput',
          13: 'DuplicateContract',
          14: 'TerminatedInConstructor',
          16: 'StorageDepositNotEnoughFunds',
          17: 'StorageDepositLimitExhausted',
          19: 'ContractReverted',
          20: 'CodeNotFound',
          23: 'ContractTrapped',
          25: 'ContractReverted'
        }
        if (mod.index?.toNumber?.() === 24 || mod.index === 24) {
          const name = palletContracts[errorIdx] ?? `Error(${errorIdx})`
          if (name === 'ContractReverted') {
            return 'O contrato reverteu. Verifique saldo de tokens e allowances.'
          }
          if (
            name === 'StorageDepositNotEnoughFunds' ||
            name === 'StorageDepositLimitExhausted'
          ) {
            return 'Saldo LUNES insuficiente para storage deposit.'
          }
          if (name === 'OutOfGas') {
            return 'Gas insuficiente para executar a operação.'
          }
          return `Contrato: ${name}`
        }
      }
    } catch {
      // fall through
    }
    return dispatchError.toString()
  }

  /**
   * Get native balance (LUNES) for an account
   */
  async getNativeBalance(accountAddress: string): Promise<string> {
    if (!this.api) throw new Error('Not connected to blockchain')
    try {
      const {
        data: { free }
      } = (await this.api.query.system.account(accountAddress)) as any
      return free.toString()
    } catch (error) {
      console.error('Error getting native balance:', error)
      return '0'
    }
  }

  // ========================================
  // PSP22 Token Methods
  // ========================================

  private getTokenContract(tokenAddress: string): ContractPromise | null {
    if (!this.api || !this.isValidAddress(tokenAddress)) return null
    // Use PairABI — it contains all PSP22 methods with correct selectors
    return this.newContract(this.api, PairABI as any, tokenAddress)
  }

  private getWNativeContract(address: string): ContractPromise | null {
    if (!this.api || !this.isValidAddress(address)) return null
    return this.newContract(this.api, WNativeABI as any, address)
  }

  /**
   * Get token balance for an account
   * ABI label: balance_of → JS: balanceOf   selector: 0x6568382f
   */
  async getTokenBalance(
    tokenAddress: string,
    accountAddress: string
  ): Promise<string> {
    if (!this.api) throw new Error('Not connected to blockchain')

    const contract = this.getTokenContract(tokenAddress)
    if (!contract) return '0'

    try {
      const { result, output } = await contract.query.balanceOf(
        accountAddress,
        { gasLimit: this.makeDryGas() },
        accountAddress
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        return (json?.ok ?? json ?? '0').toString().replace(/,/g, '')
      }
      return '0'
    } catch (error) {
      console.error('Error getting token balance:', error)
      return '0'
    }
  }

  /**
   * Get token allowance
   * ABI label: allowance → JS: allowance   selector: 0x4d47d921
   */
  async getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string
  ): Promise<string> {
    if (!this.api) throw new Error('Not connected to blockchain')

    const contract = this.getTokenContract(tokenAddress)
    if (!contract) return '0'

    try {
      const { result, output } = await contract.query.allowance(
        owner,
        { gasLimit: this.makeDryGas() },
        owner,
        spender
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        return (json?.ok ?? json ?? '0').toString().replace(/,/g, '')
      }
      return '0'
    } catch (error) {
      console.error('Error getting allowance:', error)
      return '0'
    }
  }

  /**
   * Get token info (name, symbol, decimals, totalSupply)
   * WNative ABI labels: token_name/token_symbol/token_decimals/total_supply
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    if (!this.api) return null

    // Use WNative ABI for metadata (has token_name/symbol/decimals)
    const contract =
      this.getWNativeContract(tokenAddress) ||
      this.getTokenContract(tokenAddress)
    if (!contract) return null

    const caller = tokenAddress // any valid address works for query

    try {
      const [nameQ, symbolQ, decimalsQ, supplyQ] = await Promise.all([
        contract.query.tokenName(caller, { gasLimit: this.makeDryGas() }),
        contract.query.tokenSymbol(caller, { gasLimit: this.makeDryGas() }),
        contract.query.tokenDecimals(caller, { gasLimit: this.makeDryGas() }),
        contract.query.totalSupply(caller, { gasLimit: this.makeDryGas() })
      ])

      const extract = (q: any) => {
        const j = q.output?.toJSON()
        return j?.ok ?? j
      }

      // decimals errado distorce todos os valores do token em ordens de
      // magnitude — nunca fabricar um default; sem decimals, não há TokenInfo.
      const rawDecimals = Number(extract(decimalsQ))
      if (!Number.isFinite(rawDecimals) || rawDecimals < 0) {
        console.error(
          `Token decimals unavailable for ${tokenAddress} — refusing to fabricate metadata`
        )
        return null
      }

      return {
        address: tokenAddress,
        name: String(extract(nameQ) ?? 'Unknown'),
        symbol: String(extract(symbolQ) ?? '???'),
        decimals: rawDecimals,
        totalSupply: String(extract(supplyQ) ?? '0').replace(/,/g, '')
      }
    } catch (error) {
      console.error('Error getting token info:', error)
      return null
    }
  }

  /**
   * Approve token spending
   * ABI label: approve → JS: approve   selector: 0xb20f1bbd
   */
  async approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: string,
    account: InjectedAccountWithMeta
  ): Promise<boolean> {
    if (!this.api) throw new Error('Not connected to blockchain')

    const contract = this.getTokenContract(tokenAddress)
    if (!contract) return false

    try {
      const signer = getSignerFor(account.address)

      const { gasRequired } = await contract.query.approve(
        account.address,
        { gasLimit: this.makeDryGas() },
        spenderAddress,
        amount
      )

      await new Promise<void>((resolve, reject) => {
        contract.tx
          .approve(
            { gasLimit: gasRequired, storageDepositLimit: null },
            spenderAddress,
            amount
          )
          .signAndSend(account.address, { signer }, (result: any) => {
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()))
            } else if (result.status.isFinalized) {
              // Wait for finalization (not just isInBlock) so the nonce is
              // fully committed on-chain before any subsequent signAndSend
              // call reads accountNextIndex. Resolving at isInBlock caused a
              // nonce race on the second remove-liquidity cycle: the approve
              // nonce hadn't propagated yet when the remove tx was signed,
              // producing "1010: Invalid Transaction: bad signature".
              resolve()
            }
          })
          .catch(reject)
      })

      return true
    } catch (error) {
      console.error('Error approving token:', error)
      return false
    }
  }

  // ========================================
  // Factory Methods
  // ========================================

  /**
   * Get pair address for two tokens
   * ABI label: get_pair → JS: getPair
   */
  async getPair(tokenA: string, tokenB: string): Promise<string | null> {
    if (!this.api || !this.factoryContract) {
      throw new Error('Not connected or contracts not set')
    }
    // Both legs must be valid AccountIds before they hit the contract layer,
    // otherwise createType throws "Invalid base58" instead of returning "no pair".
    if (!isValidSubstrateAddress(tokenA) || !isValidSubstrateAddress(tokenB)) {
      return null
    }

    try {
      const caller = tokenA // any valid address
      const { result, output } = await this.factoryContract.query.getPair(
        caller,
        { gasLimit: this.makeDryGas() },
        tokenA,
        tokenB
      )

      if (result.isOk && output) {
        const addr = this.unwrapResult(output.toJSON())
        return typeof addr === 'string' &&
          isValidSubstrateAddress(addr) &&
          addr !==
            '0x0000000000000000000000000000000000000000000000000000000000000000' &&
          addr !== '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuYmJFpN'
          ? addr
          : null
      }
      return null
    } catch (error) {
      console.error('Error getting pair:', error)
      return null
    }
  }

  /**
   * Get total number of deployed pairs from factory
   * ABI label: all_pairs_length → JS: allPairsLength
   */
  async allPairsLength(): Promise<number> {
    if (!this.api || !this.factoryContract) return 0
    try {
      const FACTORY_ADDR = CONTRACTS.FACTORY
      if (!FACTORY_ADDR) return 0
      const { result, output } =
        await this.factoryContract.query.allPairsLength(FACTORY_ADDR, {
          gasLimit: this.makeDryGas()
        })
      if (result.isOk && output) {
        const j = output.toJSON() as any
        return Number(j?.ok ?? j ?? 0)
      }
      return 0
    } catch {
      return 0
    }
  }

  /**
   * Get pair address at index from factory
   * ABI label: all_pairs → JS: allPairs   param: pid: u64
   */
  async allPairs(index: number): Promise<string | null> {
    if (!this.api || !this.factoryContract) return null
    try {
      const FACTORY_ADDR = CONTRACTS.FACTORY
      if (!FACTORY_ADDR) return null
      const { result, output } = await this.factoryContract.query.allPairs(
        FACTORY_ADDR,
        { gasLimit: this.makeDryGas() },
        index
      )
      if (result.isOk && output) {
        const j = output.toJSON() as any
        const addr = j?.ok ?? j
        return addr && addr !== null ? String(addr) : null
      }
      return null
    } catch {
      return null
    }
  }

  // ========================================
  // Pair Methods
  // ========================================

  /**
   * Get reserves from a pair
   * ABI label: get_reserves → JS: getReserves
   */
  async getReserves(
    pairAddress: string
  ): Promise<{ reserve0: string; reserve1: string; timestamp: number } | null> {
    if (!this.api) throw new Error('Not connected to blockchain')
    if (!this.isValidAddress(pairAddress)) return null

    const contract = this.newContract(this.api, PairABI as any, pairAddress)

    try {
      const caller = pairAddress
      const { result, output } = await contract.query.getReserves(caller, {
        gasLimit: this.makeDryGas()
      })

      if (result.isOk && output) {
        const decoded = output.toJSON() as any
        const data = decoded?.ok ?? decoded
        if (data && Array.isArray(data)) {
          return {
            reserve0: data[0].toString().replace(/,/g, ''),
            reserve1: data[1].toString().replace(/,/g, ''),
            timestamp: Number(data[2] ?? 0)
          }
        }
        if (data) {
          return {
            reserve0: (data.reserve0 ?? data[0] ?? '0')
              .toString()
              .replace(/,/g, ''),
            reserve1: (data.reserve1 ?? data[1] ?? '0')
              .toString()
              .replace(/,/g, ''),
            timestamp: Number(data.blockTimestampLast ?? data[2] ?? 0)
          }
        }
      }
      return null
    } catch (error) {
      console.error('Error getting reserves:', error)
      return null
    }
  }

  /**
   * Get token0 address from a pair contract
   * ABI label: token_0 → JS: token0
   */
  async getPairToken0(pairAddress: string): Promise<string | null> {
    if (!this.api || !this.isValidAddress(pairAddress)) return null
    const contract = this.newContract(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.token0(pairAddress, {
        gasLimit: this.makeDryGas()
      })
      if (result.isOk && output) {
        const j = output.toJSON() as any
        return String(j?.ok ?? j ?? '')
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get token1 address from a pair contract
   * ABI label: token_1 → JS: token1
   */
  async getPairToken1(pairAddress: string): Promise<string | null> {
    if (!this.api || !this.isValidAddress(pairAddress)) return null
    const contract = this.newContract(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.token1(pairAddress, {
        gasLimit: this.makeDryGas()
      })
      if (result.isOk && output) {
        const j = output.toJSON() as any
        return String(j?.ok ?? j ?? '')
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get LP token total supply from a pair contract
   * ABI label: total_supply → JS: totalSupply
   */
  async getPairTotalSupply(pairAddress: string): Promise<string> {
    if (!this.api || !this.isValidAddress(pairAddress)) return '0'
    const contract = this.newContract(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.totalSupply(pairAddress, {
        gasLimit: this.makeDryGas()
      })
      if (result.isOk && output) {
        const j = output.toJSON() as any
        return String(j?.ok ?? j ?? '0').replace(/,/g, '')
      }
      return '0'
    } catch {
      return '0'
    }
  }

  /**
   * Get pair info (pair address + reserves + totalSupply)
   */
  async getPairInfo(tokenA: string, tokenB: string): Promise<PairInfo | null> {
    const pairAddress = await this.getPair(tokenA, tokenB)
    if (!pairAddress) return null

    const reserves = await this.getReserves(pairAddress)
    if (!reserves) return null

    if (!this.api || !this.isValidAddress(pairAddress)) return null
    const contract = this.newContract(this.api, PairABI as any, pairAddress)
    const { output } = await contract.query.totalSupply(pairAddress, {
      gasLimit: this.makeDryGas()
    })
    const json = output?.toJSON() as any
    const actualSupply = (json?.ok ?? json ?? '0').toString().replace(/,/g, '')

    return {
      address: pairAddress,
      token0: tokenA,
      token1: tokenB,
      reserve0: reserves.reserve0,
      reserve1: reserves.reserve1,
      totalSupply: actualSupply
    }
  }

  // ========================================
  // Router Methods
  // ========================================

  /**
   * Get output amount for a swap using router.get_amount_out
   * ABI label: get_amount_out → JS: getAmountOut
   * Args: amount_in: u128, reserve_in: u128, reserve_out: u128
   */
  async getAmountsOut(
    amountIn: string,
    path: string[]
  ): Promise<string[] | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }
    if (path.length < 2) return null
    // Guard against the native sentinel / unconfigured token addresses reaching
    // createType('AccountId', …), which throws "Invalid base58". A bad address
    // means there is simply no pair → surface as null (insufficient liquidity).
    if (!path.every(addr => isValidSubstrateAddress(addr))) return null

    try {
      const caller = path[0]
      // For a simple 2-hop path, get reserves from the pair and compute
      const pairAddress = await this.getPair(path[0], path[1])
      if (!pairAddress) return null

      const reserves = await this.getReserves(pairAddress)
      if (!reserves) return null

      // BUG-01 FIX: pair stores reserves in canonical order (token0 < token1 by
      // address). We must swap them when path[0] is the canonical token_1 so that
      // reserve_in corresponds to the token being sold and reserve_out to the token
      // being bought — matching the router contract's expectation.
      const pairToken0 = await this.getPairToken0(pairAddress)
      const { reserveIn, reserveOut } = normalizeReservesForPath(
        pairToken0 ?? path[0],
        path[0],
        reserves.reserve0,
        reserves.reserve1
      )

      // Use router.get_amount_out(amount_in, reserve_in, reserve_out)
      const { result, output } = await this.routerContract.query.getAmountOut(
        caller,
        { gasLimit: this.makeDryGas() },
        amountIn,
        reserveIn.toString(),
        reserveOut.toString()
      )

      if (result.isOk && output) {
        // get_amount_out retorna Result<Balance,RouterError> → dupla camada
        // de Result no toJSON; unwrapResult desce até o Balance (ou null em Err).
        const inner = this.unwrapResult(output.toJSON())
        if (inner === null || inner === undefined) return null
        const amountOut = inner.toString().replace(/,/g, '')
        return [amountIn, amountOut]
      }
      return null
    } catch (error) {
      console.error('Error getting amounts out:', error)
      return null
    }
  }

  /**
   * Execute swap
   * ABI label: swap_exact_tokens_for_tokens → JS: swapExactTokensForTokens
   * Deadline MUST be in milliseconds (chain uses ms timestamps)
   */
  async swapExactTokensForTokens(
    amountIn: string,
    amountOutMin: string,
    path: string[],
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      // Approve input token only if allowance is insufficient
      const currentAllowance = await this.getAllowance(
        path[0],
        account.address,
        contracts.router
      )
      const approved =
        BigInt(currentAllowance) >= BigInt(amountIn) ||
        (await this.approveToken(path[0], contracts.router, amountIn, account))
      if (!approved) throw new Error('Failed to approve token')

      // Use deadline in ms
      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } =
        await this.routerContract.query.swapExactTokensForTokens(
          account.address,
          { gasLimit: this.makeDryGas() },
          amountIn,
          amountOutMin,
          path,
          to,
          deadlineMs
        )

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .swapExactTokensForTokens(
            { gasLimit: gasRequired, storageDepositLimit: null },
            amountIn,
            amountOutMin,
            path,
            to,
            deadlineMs
          )
          .signAndSend(account.address, { signer }, (result: any) => {
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()))
            } else if (result.status.isFinalized) {
              resolve(result.txHash.toHex())
            }
          })
          .catch(reject)
      })
    } catch (error) {
      console.error('Error executing swap:', error)
      throw error
    }
  }

  /**
   * Add liquidity
   * ABI label: add_liquidity → JS: addLiquidity
   */
  async addLiquidity(
    tokenA: string,
    tokenB: string,
    amountADesired: string,
    amountBDesired: string,
    amountAMin: string,
    amountBMin: string,
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      // Only approve if current allowance is insufficient (avoids redundant signatures)
      const [allowanceA, allowanceB] = await Promise.all([
        this.getAllowance(tokenA, account.address, contracts.router),
        this.getAllowance(tokenB, account.address, contracts.router)
      ])
      if (BigInt(allowanceA) < BigInt(amountADesired)) {
        await this.approveToken(
          tokenA,
          contracts.router,
          amountADesired,
          account
        )
      }
      if (BigInt(allowanceB) < BigInt(amountBDesired)) {
        await this.approveToken(
          tokenB,
          contracts.router,
          amountBDesired,
          account
        )
      }

      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired, output: dryOutput } =
        await this.routerContract.query.addLiquidity(
          account.address,
          { gasLimit: this.makeDryGas() },
          tokenA,
          tokenB,
          amountADesired,
          amountBDesired,
          amountAMin,
          amountBMin,
          to,
          deadlineMs
        )

      // Detect contract-level errors before signing (ink! Err variant in dry-run output)
      if (dryOutput) {
        const dryJson = (dryOutput as any).toJSON?.() as any
        const dryErr = dryJson?.err ?? dryJson?.Err
        if (dryErr !== undefined && dryErr !== null) {
          const errName =
            typeof dryErr === 'string' ? dryErr : JSON.stringify(dryErr)
          // Check for common causes and give actionable messages
          if (
            errName.toLowerCase().includes('insufficientbalance') ||
            errName.toLowerCase().includes('balance')
          ) {
            throw new Error(
              `Saldo insuficiente de tokens para adicionar liquidez (${errName})`
            )
          }
          throw new Error(`addLiquidity reverteria na chain: ${errName}`)
        }
      }

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .addLiquidity(
            { gasLimit: gasRequired, storageDepositLimit: null },
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            to,
            deadlineMs
          )
          .signAndSend(account.address, { signer }, (result: any) => {
            if (result.dispatchError) {
              reject(new Error(this.decodeDispatchError(result.dispatchError)))
            } else if (result.status.isFinalized) {
              resolve(result.txHash.toHex())
            }
          })
          .catch(reject)
      })
    } catch (error) {
      console.error('Error adding liquidity:', error)
      throw error
    }
  }

  /**
   * Remove liquidity
   * ABI label: remove_liquidity → JS: removeLiquidity
   */
  async removeLiquidity(
    tokenA: string,
    tokenB: string,
    liquidity: string,
    amountAMin: string,
    amountBMin: string,
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      // NOTE: approve is intentionally NOT performed here.
      // SDKContext.removeLiquidity already handles the allowance check and
      // calls approveToken before invoking this method. Doing a second approve
      // here would (a) waste gas, (b) consume an extra nonce immediately before
      // the removeLiquidity signAndSend, producing a nonce race that causes
      // "1010: Invalid Transaction: bad signature" on repeated remove calls.
      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } = await this.routerContract.query.removeLiquidity(
        account.address,
        { gasLimit: this.makeDryGas() },
        tokenA,
        tokenB,
        liquidity,
        amountAMin,
        amountBMin,
        to,
        deadlineMs
      )

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .removeLiquidity(
            { gasLimit: gasRequired, storageDepositLimit: null },
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            to,
            deadlineMs
          )
          .signAndSend(account.address, { signer }, (result: any) => {
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()))
            } else if (result.status.isFinalized) {
              resolve(result.txHash.toHex())
            }
          })
          .catch(reject)
      })
    } catch (error) {
      console.error('Error removing liquidity:', error)
      throw error
    }
  }

  // ========================================
  // Native (LUNES) Router Methods
  // ========================================
  //
  // LUNES is the native coin; pools trade the WLUNES wrapper. These methods let
  // the user transact in native LUNES directly — the Router wraps/unwraps
  // internally. The native amount rides as the call `value` on payable methods
  // (no PSP22 approval for the native leg).

  /**
   * Swap an exact amount of native LUNES for tokens.
   * ABI label: swap_exact_native_for_tokens → JS: swapExactNativeForTokens
   * The native amount is the call value (not a positional arg). No approval.
   */
  async swapExactNativeForTokens(
    amountIn: string,
    amountOutMin: string,
    path: string[],
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } =
        await this.routerContract.query.swapExactNativeForTokens(
          account.address,
          { gasLimit: this.makeDryGas(), value: amountIn },
          amountOutMin,
          path,
          to,
          deadlineMs
        )

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .swapExactNativeForTokens(
            {
              gasLimit: gasRequired,
              storageDepositLimit: null,
              value: amountIn
            },
            amountOutMin,
            path,
            to,
            deadlineMs
          )
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error executing native swap:', error)
      throw error
    }
  }

  /**
   * Swap an exact amount of tokens for native LUNES.
   * ABI label: swap_exact_tokens_for_native → JS: swapExactTokensForNative
   * Approves the input token (path[0]) before swapping.
   */
  async swapExactTokensForNative(
    amountIn: string,
    amountOutMin: string,
    path: string[],
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      const currentAllowance = await this.getAllowance(
        path[0],
        account.address,
        contracts.router
      )
      const approved =
        BigInt(currentAllowance) >= BigInt(amountIn) ||
        (await this.approveToken(path[0], contracts.router, amountIn, account))
      if (!approved) throw new Error('Failed to approve token')

      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } =
        await this.routerContract.query.swapExactTokensForNative(
          account.address,
          { gasLimit: this.makeDryGas() },
          amountIn,
          amountOutMin,
          path,
          to,
          deadlineMs
        )

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .swapExactTokensForNative(
            { gasLimit: gasRequired, storageDepositLimit: null },
            amountIn,
            amountOutMin,
            path,
            to,
            deadlineMs
          )
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error executing tokens-for-native swap:', error)
      throw error
    }
  }

  /**
   * Add liquidity with native LUNES + a token.
   * ABI label: add_liquidity_native → JS: addLiquidityNative
   * The native amount is the call value. Approves the token leg only.
   */
  async addLiquidityNative(
    token: string,
    amountTokenDesired: string,
    amountNativeDesired: string,
    amountTokenMin: string,
    amountNativeMin: string,
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      const allowance = await this.getAllowance(
        token,
        account.address,
        contracts.router
      )
      if (BigInt(allowance) < BigInt(amountTokenDesired)) {
        await this.approveToken(
          token,
          contracts.router,
          amountTokenDesired,
          account
        )
      }

      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const {
        result: dryResult,
        gasRequired,
        output: dryOutput
      } = await this.routerContract.query.addLiquidityNative(
        account.address,
        { gasLimit: this.makeDryGas(), value: amountNativeDesired },
        token,
        amountTokenDesired,
        amountTokenMin,
        amountNativeMin,
        to,
        deadlineMs
      )

      if (dryResult.isErr) {
        throw new Error(this.decodeDispatchError(dryResult.asErr))
      }
      if (dryOutput) {
        let dryJson = dryOutput.toJSON() as any
        while (
          dryJson &&
          typeof dryJson === 'object' &&
          ('ok' in dryJson || 'Ok' in dryJson)
        ) {
          dryJson = 'ok' in dryJson ? dryJson.ok : dryJson.Ok
        }
        const dryErr = dryJson?.err ?? dryJson?.Err
        if (dryErr !== undefined && dryErr !== null) {
          const errName =
            typeof dryErr === 'string' ? dryErr : JSON.stringify(dryErr)
          throw new Error(`addLiquidityNative reverteria na chain: ${errName}`)
        }
      }

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .addLiquidityNative(
            {
              gasLimit: gasRequired,
              storageDepositLimit: null,
              value: amountNativeDesired
            },
            token,
            amountTokenDesired,
            amountTokenMin,
            amountNativeMin,
            to,
            deadlineMs
          )
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error adding native liquidity:', error)
      throw error
    }
  }

  /**
   * Remove liquidity from a native (WLUNES/token) pair, receiving native LUNES.
   * ABI label: remove_liquidity_native → JS: removeLiquidityNative
   * Like removeLiquidity, the LP-token approval is handled by the caller
   * (SDKContext) to avoid a nonce race from a second signAndSend here.
   */
  async removeLiquidityNative(
    token: string,
    liquidity: string,
    amountTokenMin: string,
    amountNativeMin: string,
    to: string,
    deadline: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.routerContract) {
      throw new Error('Not connected or contracts not set')
    }

    try {
      const signer = getSignerFor(account.address)
      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } =
        await this.routerContract.query.removeLiquidityNative(
          account.address,
          { gasLimit: this.makeDryGas() },
          token,
          liquidity,
          amountTokenMin,
          amountNativeMin,
          to,
          deadlineMs
        )

      return await new Promise((resolve, reject) => {
        if (!this.routerContract) {
          reject(new Error('Router not initialized'))
          return
        }
        this.routerContract.tx
          .removeLiquidityNative(
            { gasLimit: gasRequired, storageDepositLimit: null },
            token,
            liquidity,
            amountTokenMin,
            amountNativeMin,
            to,
            deadlineMs
          )
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error removing native liquidity:', error)
      throw error
    }
  }

  // ========================================
  // WNative Wrap / Unwrap (1:1, no fee)
  // ========================================

  /** Wrap native LUNES into WLUNES 1:1 (WNative.deposit, value = amount). */
  async wrapNative(
    amount: string,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api) throw new Error('Not connected to blockchain')
    const waddr = this.contracts?.wnative || ''
    const contract = this.getWNativeContract(waddr)
    if (!contract) throw new Error('WNative contract not available')

    try {
      const signer = getSignerFor(account.address)

      const { gasRequired } = await contract.query.deposit(account.address, {
        gasLimit: this.makeDryGas(),
        value: amount
      })

      return await new Promise((resolve, reject) => {
        contract.tx
          .deposit({
            gasLimit: gasRequired,
            storageDepositLimit: null,
            value: amount
          })
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error wrapping native:', error)
      throw error
    }
  }

  /** Unwrap WLUNES back to native LUNES 1:1 (WNative.withdraw(amount)). */
  async unwrapNative(
    amount: string,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api) throw new Error('Not connected to blockchain')
    const waddr = this.contracts?.wnative || ''
    const contract = this.getWNativeContract(waddr)
    if (!contract) throw new Error('WNative contract not available')

    try {
      const signer = getSignerFor(account.address)

      const { gasRequired } = await contract.query.withdraw(
        account.address,
        { gasLimit: this.makeDryGas() },
        amount
      )

      return await new Promise((resolve, reject) => {
        contract.tx
          .withdraw(
            { gasLimit: gasRequired, storageDepositLimit: null },
            amount
          )
          .signAndSend(
            account.address,
            { signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(
                  new Error(this.decodeDispatchError(result.dispatchError))
                )
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error unwrapping native:', error)
      throw error
    }
  }

  // ========================================
  // Staking Methods
  // (Lunex/contracts/staking/lib.rs — stakes NATIVE LUNES, one position per
  //  account; durations/timestamps in ms. Every tx below dry-runs first,
  //  then resolves ONLY on isFinalized — see sendStakingTx.)
  // ========================================

  /**
   * Dry-run `method` (surfacing contract errors before the wallet prompt),
   * then sign/send it and resolve with the tx hash only once the block is
   * FINALIZED. Rejects on dispatchError and on dropped/invalid/usurped.
   */
  private async sendStakingTx(
    method: string,
    account: InjectedAccountWithMeta,
    args: unknown[],
    value?: string
  ): Promise<string> {
    const contract = this.stakingContract
    if (!this.api || !contract) {
      throw new Error('Staking contract not connected')
    }
    const signer = getSignerFor(account.address)
    const withValue = value !== undefined ? { value } : {}

    const {
      result: dryResult,
      gasRequired,
      output: dryOutput
    } = await contract.query[method](
      account.address,
      { gasLimit: this.makeDryGas(), ...withValue },
      ...args
    )
    if (dryResult?.isErr) {
      throw new Error(this.decodeDispatchError(dryResult.asErr))
    }
    const dryErr = dryOutput ? inkError(dryOutput.toJSON()) : null
    if (dryErr) throw new Error(describeStakingError(dryErr))

    return await new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | null = null
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        fn()
        if (unsub) unsub()
      }
      contract.tx[method](
        { gasLimit: gasRequired, storageDepositLimit: null, ...withValue },
        ...args
      )
        .signAndSend(account.address, { signer }, (result: any) => {
          if (result.dispatchError) {
            finish(() =>
              reject(new Error(this.decodeDispatchError(result.dispatchError)))
            )
          } else if (
            result.status?.isInvalid ||
            result.status?.isDropped ||
            result.status?.isUsurped
          ) {
            finish(() =>
              reject(new Error('Transaction dropped or invalid — not included.'))
            )
          } else if (result.status?.isFinalized) {
            finish(() => resolve(result.txHash.toHex()))
          }
        })
        .then((u: () => void) => {
          unsub = u
          if (done) u()
        })
        .catch((err: unknown) => finish(() => reject(err)))
    })
  }

  /**
   * Get the account's stake position + contract totals.
   * ABI: get_stake(account) -> Option<StakePosition>,
   *      get_stats() -> (total_staked, total_rewards_distributed, stakers),
   *      get_pending_rewards(account) -> Result<Balance>.
   * `lockPeriod` is the position's lock in days; `apr` is the base APR % for
   * its tier × quantity multiplier (excludes the early-adopter bonus).
   */
  async getStakingUserInfo(accountAddress: string): Promise<{
    totalStaked: string
    userStaked: string
    pendingRewards: string
    apr: string
    lockPeriod: number
    position: StakePositionView | null
    /** Funded APY pool (planck) — caps what claim/unstake can pay now. */
    rewardsPool: string | null
  } | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const dry = { gasLimit: this.makeDryGas() }
      const [stakeResult, statsResult, pendingResult, pools] = await Promise.all([
        this.stakingContract.query.getStake(accountAddress, dry, accountAddress),
        this.stakingContract.query.getStats(accountAddress, dry),
        this.stakingContract.query
          .getPendingRewards(accountAddress, dry, accountAddress)
          .catch(() => null),
        this.getRewardPools()
      ])

      let totalStaked = '0'
      const stats = statsResult.result.isOk
        ? unwrapInk(statsResult.output?.toJSON())
        : null
      if (Array.isArray(stats)) totalStaked = toPlanckString(stats[0])

      const decoded =
        stakeResult.result.isOk && stakeResult.output
          ? decodeStakePosition(stakeResult.output.toJSON())
          : null
      const position = decoded?.active ? decoded : null

      let pendingRewards = '0'
      // get_pending_rewards also returns APY still OWED after an unstake
      // (pool was short) — keep it visible/claimable without a position.
      if (pendingResult?.result?.isOk && pendingResult.output) {
        const json = pendingResult.output.toJSON()
        if (!inkError(json)) pendingRewards = toPlanckString(unwrapInk(json))
      }

      const aprBps = position
        ? estimateAprBps(position.tier, BigInt(position.amount))
        : 0
      return {
        totalStaked,
        userStaked: position ? position.amount : '0',
        pendingRewards,
        apr: String(aprBps / 100),
        lockPeriod: position ? Math.round(position.durationMs / DAY_MS) : 0,
        position,
        rewardsPool: pools?.apyPool ?? null
      }
    } catch {
      console.warn(
        'getStakingUserInfo: Query failed (contract not deployed or ABI mismatch).'
      )
    }

    return null
  }

  /**
   * Stake native LUNES. `amount` is planck (8 decimals) sent as the call
   * `value`; `durationMs` is the lock (7..365 days, in ms) — the contract's
   * only argument. One active position per account.
   */
  async stake(
    amount: string,
    durationMs: number,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    try {
      return await this.sendStakingTx('stake', account, [durationMs], amount)
    } catch (error) {
      console.error('Error staking:', error)
      throw error
    }
  }

  /**
   * Unstake the whole position (contract `unstake()` takes no args). Pays
   * principal + rewards, minus a 5% penalty before the lock ends.
   */
  async unstake(account: InjectedAccountWithMeta): Promise<string | null> {
    try {
      return await this.sendStakingTx('unstake', account, [])
    } catch (error) {
      console.error('Error unstaking:', error)
      throw error
    }
  }

  /** Claim staking rewards without unstaking. */
  async claimRewards(account: InjectedAccountWithMeta): Promise<string | null> {
    try {
      return await this.sendStakingTx('claimRewards', account, [])
    } catch (error) {
      console.error('Error claiming rewards:', error)
      throw error
    }
  }

  /**
   * Get proposal details from the Staking/Governance contract.
   * YES votes = `vote_count`, NO votes = `votes_against` (see decodeProposal).
   */
  async getProposal(proposalId: number): Promise<GovernanceProposal | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } = await this.stakingContract.query.getProposal(
        this.contracts?.staking || '',
        { gasLimit: this.makeDryGas() },
        proposalId
      )
      if (result.isOk && output) {
        return decodeProposal(output.toJSON(), proposalId)
      }
    } catch (err) {
      console.warn(`getProposal(${proposalId}): Query failed`, err)
    }
    return null
  }

  /**
   * Funded reward pools: get_reward_pools() -> (apy_rewards_pool,
   * trading_rewards_pool, total_credited_rewards). APY/bonus payouts are
   * capped by `apyPool`; the rest stays owed (never paid from principal).
   */
  async getRewardPools(): Promise<{
    apyPool: string
    tradingPool: string
    credited: string
  } | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } =
        await this.stakingContract.query.getRewardPools(
          this.contracts?.staking || '',
          { gasLimit: this.makeDryGas() }
        )
      const v = result?.isOk && output ? unwrapInk(output.toJSON()) : null
      if (Array.isArray(v)) {
        return {
          apyPool: toPlanckString(v[0]),
          tradingPool: toPlanckString(v[1]),
          credited: toPlanckString(v[2])
        }
      }
    } catch (err) {
      console.warn('getRewardPools: Query failed', err)
    }
    return null
  }

  /** Live proposal fee (planck) from get_current_proposal_fee(). */
  async getProposalFee(): Promise<string> {
    const fallback = DEFAULT_PROPOSAL_FEE_PLANCK.toString()
    if (!this.api || !this.stakingContract) return fallback
    try {
      const { result, output } =
        await this.stakingContract.query.getCurrentProposalFee(
          this.contracts?.staking || '',
          { gasLimit: this.makeDryGas() }
        )
      if (result?.isOk && output) {
        const fee = toPlanckString(unwrapInk(output.toJSON()))
        if (fee !== '0') return fee
      }
    } catch (err) {
      console.warn('getProposalFee: Query failed', err)
    }
    return fallback
  }

  /**
   * Get voting power for an address (based on staked amount)
   */
  async getVotingPower(accountAddress: string): Promise<string> {
    if (!this.api || !this.stakingContract) return '0'
    try {
      const { result, output } =
        await this.stakingContract.query.getVotingPower(
          accountAddress,
          { gasLimit: this.makeDryGas() },
          accountAddress
        )

      if (result.isOk && output) {
        const json = output.toJSON()
        if (inkError(json)) return '0'
        return toPlanckString(unwrapInk(json))
      }
    } catch (err) {
      console.warn('getVotingPower: Query failed', err)
    }
    return '0'
  }

  /**
   * Vote on a governance proposal. The contract charges VOTE_COST
   * (10 LUNES) per vote, sent as the call value; one vote per proposal.
   */
  async vote(
    proposalId: number,
    approve: boolean,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    try {
      return await this.sendStakingTx(
        'vote',
        account,
        [proposalId, approve],
        VOTE_COST_PLANCK.toString()
      )
    } catch (error) {
      console.error('Error voting:', error)
      throw error
    }
  }

  /**
   * Create a listing proposal. Pays the live proposal fee (native LUNES) as
   * the call value; requires ≥ 10,000 LUNES staked.
   */
  async createProposal(
    name: string,
    description: string,
    tokenAddress: string,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    try {
      const fee = await this.getProposalFee()
      return await this.sendStakingTx(
        'createProposal',
        account,
        [name, description, tokenAddress],
        fee
      )
    } catch (error) {
      console.error('Error creating proposal:', error)
      throw error
    }
  }

  // ─── CopyVault (copy trading) ─────────────────────────────────
  // The follower's OWN wallet signs deposit/withdraw on the vault contract
  // (the contract credits/pays `caller`). The backend never moves vault funds;
  // it only journals the finalized tx proven by { txHash, blockHash }.

  /**
   * Deposit native LUNES into a CopyVault. `amountPlancks` is the payable
   * call value (8-decimal plancks). Resolves only when finalized.
   */
  async depositToCopyVault(
    vaultAddress: string,
    amountPlancks: string,
    account: InjectedAccountWithMeta
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendCopyVaultTx('deposit', vaultAddress, account, {
      value: amountPlancks,
      args: []
    })
  }

  /** Burn `sharesPlancks` vault shares; the contract pays the caller. */
  async withdrawFromCopyVault(
    vaultAddress: string,
    sharesPlancks: string,
    account: InjectedAccountWithMeta
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendCopyVaultTx('withdraw', vaultAddress, account, {
      args: [sharesPlancks]
    })
  }

  /**
   * Start the 24h cooldown required by the contract for a withdrawal larger
   * than 10% of the vault shares (no funds move). Resolves on finality.
   */
  async requestCopyVaultWithdrawal(
    vaultAddress: string,
    sharesPlancks: string,
    account: InjectedAccountWithMeta
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendCopyVaultTx('requestWithdrawal', vaultAddress, account, {
      args: [sharesPlancks]
    })
  }

  /** Pending large-withdrawal request of `follower`, or null. */
  async getCopyVaultWithdrawalRequest(
    vaultAddress: string,
    follower: string
  ): Promise<{ shares: string; unlockAt: number } | null> {
    if (!this.api) throw new Error('Not connected to blockchain')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault: any = this.newContract(
      this.api,
      CopyVaultABI as any,
      vaultAddress
    )
    const { result, output } = await vault.query.getWithdrawalRequest(
      follower,
      { gasLimit: this.makeDryGas(), storageDepositLimit: null },
      follower
    )
    if (!result.isOk || !output) return null
    let json = output.toJSON() as any
    if (json && typeof json === 'object' && ('ok' in json || 'Ok' in json)) {
      json = 'ok' in json ? json.ok : json.Ok
    }
    if (!json || typeof json !== 'object') return null
    const shares = BigInt(json.shares).toString()
    const requestedAt = Number(json.requestedAt ?? json.requested_at)
    return { shares, unlockAt: requestedAt + COPY_VAULT_COOLDOWN_MS }
  }

  private async sendCopyVaultTx(
    method: 'deposit' | 'withdraw' | 'requestWithdrawal',
    vaultAddress: string,
    account: InjectedAccountWithMeta,
    call: { value?: string; args: string[] }
  ): Promise<{ txHash: string; blockHash: string }> {
    if (!this.api) throw new Error('Not connected to blockchain')
    if (!this.isValidAddress(vaultAddress)) {
      throw new Error('Copy vault is not deployed on-chain')
    }
    const signer = getSignerFor(account.address)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault: any = this.newContract(
      this.api,
      CopyVaultABI as any,
      vaultAddress
    )
    const valueOpt = call.value !== undefined ? { value: call.value } : {}

    const {
      result: dryResult,
      gasRequired,
      output: dryOutput
    } = await vault.query[method](
      account.address,
      { gasLimit: this.makeDryGas(), storageDepositLimit: null, ...valueOpt },
      ...call.args
    )
    if (dryResult.isErr) {
      throw new Error(this.decodeDispatchError(dryResult.asErr))
    }
    if (dryOutput) {
      let dryJson = dryOutput.toJSON() as any
      while (
        dryJson &&
        typeof dryJson === 'object' &&
        ('ok' in dryJson || 'Ok' in dryJson)
      ) {
        dryJson = 'ok' in dryJson ? dryJson.ok : dryJson.Ok
      }
      const dryErr = dryJson?.err ?? dryJson?.Err
      if (dryErr !== undefined && dryErr !== null) {
        const errName =
          typeof dryErr === 'string' ? dryErr : JSON.stringify(dryErr)
        throw new Error(`CopyVault.${method} would revert on-chain: ${errName}`)
      }
    }

    return await new Promise((resolve, reject) => {
      vault.tx[method](
        { gasLimit: gasRequired, storageDepositLimit: null, ...valueOpt },
        ...call.args
      )
        .signAndSend(account.address, { signer }, (result: any) => {
          if (result.dispatchError) {
            reject(new Error(this.decodeDispatchError(result.dispatchError)))
          } else if (result.status.isFinalized) {
            // Fund-moving: resolve ONLY on finality. The finalized block hash
            // is part of the proof the API verifies before crediting.
            resolve({
              txHash: result.txHash.toHex(),
              blockHash: result.status.asFinalized.toHex()
            })
          }
        })
        .catch(reject)
    })
  }

  /**
   * get_listing_stats() -> (u32 proposals, u32 active_stakers, u32 approved).
   * Proposal ids are 1..=totalProposals.
   */
  async getListingStats(): Promise<ListingStats | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } =
        await this.stakingContract.query.getListingStats(
          this.contracts?.staking || '',
          { gasLimit: this.makeDryGas() }
        )
      if (result.isOk && output) return decodeListingStats(output.toJSON())
    } catch (err) {
      console.warn('getListingStats: Query failed', err)
    }
    return null
  }

  // ════════════════════════════════════════════════════════════════
  // SPOT SETTLEMENT VAULT (spot orderbook custody) — P0-5
  // ════════════════════════════════════════════════════════════════
  // The user's OWN wallet funds and drains the spot_settlement vault
  // (CONTRACTS.SPOT_SETTLEMENT). The contract credits/pays `caller`; spot-api
  // reads the vault balance on-chain, it never moves vault funds itself.
  // Every call is dry-run first (no broadcast on a SpotError) and resolves
  // ONLY on isFinalized. Amounts are raw token units as decimal strings.

  /** deposit_native (payable): `amountUnits` is the call value. */
  async spotVaultDepositNative(
    address: string,
    amountUnits: string
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendSpotVaultTx('depositNative', address, {
      value: amountUnits,
      args: []
    })
  }

  /** deposit_psp22(token, amount). Requires an allowance ≥ amount first. */
  async spotVaultDepositPsp22(
    address: string,
    token: string,
    amountUnits: string
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendSpotVaultTx('depositPsp22', address, {
      args: [token, amountUnits]
    })
  }

  async spotVaultWithdrawNative(
    address: string,
    amountUnits: string
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendSpotVaultTx('withdrawNative', address, {
      args: [amountUnits]
    })
  }

  async spotVaultWithdrawPsp22(
    address: string,
    token: string,
    amountUnits: string
  ): Promise<{ txHash: string; blockHash: string }> {
    return this.sendSpotVaultTx('withdrawPsp22', address, {
      args: [token, amountUnits]
    })
  }

  /**
   * PSP22 approve(vault, amount) — EXACT amount, never infinite. PSP22
   * approve sets (not adds) the allowance, and deposit_psp22 consumes it.
   */
  async spotVaultApprove(
    address: string,
    token: string,
    amountUnits: string
  ): Promise<{ txHash: string; blockHash: string }> {
    const vault = this.requireSpotVault()
    await this.ensureSpotVaultApi()
    // Pair ABI carries the PSP22 messages with the repo's selectors.
    const contract = this.newContract(this.api!, PairABI as any, token)
    return this.dryRunAndSendFinalized(contract, 'approve', address, {
      args: [vault, amountUnits]
    })
  }

  /** Current allowance of the vault on `token` (raw units). */
  async spotVaultAllowance(address: string, token: string): Promise<bigint> {
    const vault = this.requireSpotVault()
    await this.ensureSpotVaultApi()
    return BigInt((await this.getAllowance(token, address, vault)) || '0')
  }

  private requireSpotVault(): string {
    const vault = CONTRACTS.SPOT_SETTLEMENT
    if (!this.isValidAddress(vault)) {
      throw new Error('Spot settlement vault is not configured')
    }
    return vault
  }

  private async ensureSpotVaultApi(): Promise<void> {
    if (!this.api || !this.isConnected) await this.connect(NETWORK.name)
    if (!this.api) throw new Error('Not connected to blockchain')
  }

  private async sendSpotVaultTx(
    method: 'depositNative' | 'depositPsp22' | 'withdrawNative' | 'withdrawPsp22',
    address: string,
    call: { value?: string; args: string[] }
  ): Promise<{ txHash: string; blockHash: string }> {
    const vault = this.requireSpotVault()
    await this.ensureSpotVaultApi()
    const contract = this.newContract(this.api!, SpotSettlementABI as any, vault)
    return this.dryRunAndSendFinalized(contract, method, address, call)
  }

  private async dryRunAndSendFinalized(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contract: any,
    method: string,
    address: string,
    call: { value?: string; args: string[] }
  ): Promise<{ txHash: string; blockHash: string }> {
    const signer = getSignerFor(address)
    const valueOpt = call.value !== undefined ? { value: call.value } : {}
    const {
      result: dryResult,
      gasRequired,
      output: dryOutput
    } = await contract.query[method](
      address,
      { gasLimit: this.makeDryGas(), storageDepositLimit: null, ...valueOpt },
      ...call.args
    )
    if (dryResult.isErr) {
      throw new Error(this.decodeDispatchError(dryResult.asErr))
    }
    if (dryOutput) {
      let json = dryOutput.toJSON() as any
      while (json && typeof json === 'object' && ('ok' in json || 'Ok' in json)) {
        json = 'ok' in json ? json.ok : json.Ok
      }
      const err = json?.err ?? json?.Err
      if (err !== undefined && err !== null) {
        throw new Error(describeSpotVaultError(err))
      }
    }

    return await new Promise((resolve, reject) => {
      contract.tx[method](
        { gasLimit: gasRequired, storageDepositLimit: null, ...valueOpt },
        ...call.args
      )
        .signAndSend(address, { signer }, (result: any) => {
          if (result.dispatchError) {
            reject(new Error(this.decodeDispatchError(result.dispatchError)))
          } else if (result.status.isFinalized) {
            // Fund-moving: resolve ONLY on finality (never isInBlock).
            resolve({
              txHash: result.txHash.toHex(),
              blockHash: result.status.asFinalized.toHex()
            })
          }
        })
        .catch(reject)
    })
  }
  // ═══════════════════════ end SPOT SETTLEMENT VAULT ═══════════════
}

/** Human message for a spot_settlement `SpotError` / PSP22Error dry-run. */
function describeSpotVaultError(err: unknown): string {
  const name =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object'
        ? Object.keys(err as Record<string, unknown>)[0]
        : String(err)
  const key = (name || '').charAt(0).toLowerCase() + (name || '').slice(1)
  const messages: Record<string, string> = {
    depositTooSmall: 'Below the vault minimum deposit.',
    zeroAmount: 'Enter an amount.',
    withdrawExceedsBalance: 'Exceeds your available vault balance.',
    contractPaused: 'The spot vault is paused.',
    pSP22TransferFailed:
      'Token transfer failed — check your token balance and allowance.',
    psp22TransferFailed:
      'Token transfer failed — check your token balance and allowance.',
    nativeTransferFailed: 'The vault could not send LUNES.',
    reentrancy: 'Vault busy — try again.',
    insufficientBalance: 'Insufficient balance.',
    insufficientAllowance: 'Allowance too low — approve again.'
  }
  return messages[key] ?? `Spot vault call would revert on-chain: ${name}`
}

// Export singleton instance
export const contractService = new ContractService()
export default contractService
