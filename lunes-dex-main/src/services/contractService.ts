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

import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import type { InjectedAccountWithMeta } from '@polkadot/extension-inject/types'
import { web3FromAddress } from '@polkadot/extension-dapp'

import RouterABI from '../abis/Router.json'
import FactoryABI from '../abis/Factory.json'
import PairABI from '../abis/Pair.json'
import WNativeABI from '../abis/WNative.json'
import StakingABI from '../abis/Staking.json'

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

export interface SwapQuote {
  amountOut: string
  amountOutFormatted: string
  priceImpact: string
  minimumReceived: string
  executionPrice: string
  route: string[]
}

// Dry-run gas limit (conservative)
const DRY_GAS = { refTime: BigInt('50000000000'), proofSize: BigInt('1000000') }

class ContractService {
  private api: ApiPromise | null = null
  private isConnected = false
  private network: keyof typeof NETWORKS = 'testnet'
  private contracts: ContractAddresses | null = null

  // Contract Instances
  private routerContract: ContractPromise | null = null
  private factoryContract: ContractPromise | null = null
  private stakingContract: ContractPromise | null = null

  /**
   * Initialize connection to the blockchain
   */
  async connect(network: keyof typeof NETWORKS = 'testnet'): Promise<boolean> {
    if (this.isConnected && this.api) {
      return true
    }

    try {
      this.network = network
      const wsProvider = new WsProvider(NETWORKS[network])
      this.api = await ApiPromise.create({ provider: wsProvider })

      await this.api.isReady
      this.isConnected = true

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
      this.routerContract = new ContractPromise(
        this.api,
        RouterABI as any,
        addresses.router
      )
      this.factoryContract = new ContractPromise(
        this.api,
        FactoryABI as any,
        addresses.factory
      )
      if (addresses.staking) {
        this.stakingContract = new ContractPromise(
          this.api,
          StakingABI as any,
          addresses.staking
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private makeDryGas(): any {
    if (!this.api) throw new Error('Not connected')
    return this.api.registry.createType('WeightV2', DRY_GAS)
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
    if (!this.api) return null
    // Use PairABI — it contains all PSP22 methods with correct selectors
    return new ContractPromise(this.api, PairABI as any, tokenAddress)
  }

  private getWNativeContract(address: string): ContractPromise | null {
    if (!this.api) return null
    return new ContractPromise(this.api, WNativeABI as any, address)
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

      return {
        address: tokenAddress,
        name: String(extract(nameQ) ?? 'Unknown'),
        symbol: String(extract(symbolQ) ?? '???'),
        decimals: Number(extract(decimalsQ) ?? 12),
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
      const injector = await web3FromAddress(account.address)

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
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve()
              }
            }
          )
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

    try {
      const caller = tokenA // any valid address
      const { result, output } = await this.factoryContract.query.getPair(
        caller,
        { gasLimit: this.makeDryGas() },
        tokenA,
        tokenB
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        const addr = json?.ok ?? json
        return addr &&
          addr !==
          '0x0000000000000000000000000000000000000000000000000000000000000000'
          ? String(addr)
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
      const FACTORY_ADDR = process.env.REACT_APP_FACTORY_CONTRACT || '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2'
      const { result, output } = await this.factoryContract.query.allPairsLength(
        FACTORY_ADDR,
        { gasLimit: this.makeDryGas() }
      )
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
      const FACTORY_ADDR = process.env.REACT_APP_FACTORY_CONTRACT || '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2'
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

    const contract = new ContractPromise(this.api, PairABI as any, pairAddress)

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
    if (!this.api) return null
    const contract = new ContractPromise(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.token0(
        pairAddress,
        { gasLimit: this.makeDryGas() }
      )
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
    if (!this.api) return null
    const contract = new ContractPromise(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.token1(
        pairAddress,
        { gasLimit: this.makeDryGas() }
      )
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
    if (!this.api) return '0'
    const contract = new ContractPromise(this.api, PairABI as any, pairAddress)
    try {
      const { result, output } = await contract.query.totalSupply(
        pairAddress,
        { gasLimit: this.makeDryGas() }
      )
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

    if (!this.api) return null
    const contract = new ContractPromise(this.api, PairABI as any, pairAddress)
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

    try {
      const caller = path[0]
      // For a simple 2-hop path, get reserves from the pair and compute
      const pairAddress = await this.getPair(path[0], path[1])
      if (!pairAddress) return null

      const reserves = await this.getReserves(pairAddress)
      if (!reserves) return null

      // Use router.get_amount_out(amount_in, reserve_in, reserve_out)
      const { result, output } = await this.routerContract.query.getAmountOut(
        caller,
        { gasLimit: this.makeDryGas() },
        amountIn,
        reserves.reserve0,
        reserves.reserve1
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        const amountOut = (json?.ok ?? json ?? '0').toString().replace(/,/g, '')
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
      const injector = await web3FromAddress(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      // Approve input token
      const approved = await this.approveToken(
        path[0],
        contracts.router,
        amountIn,
        account
      )
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
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
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
      const injector = await web3FromAddress(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      await this.approveToken(tokenA, contracts.router, amountADesired, account)
      await this.approveToken(tokenB, contracts.router, amountBDesired, account)

      const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000

      const { gasRequired } = await this.routerContract.query.addLiquidity(
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
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
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
      const injector = await web3FromAddress(account.address)
      const contracts = this.contracts
      if (!contracts) throw new Error('Contracts not initialized')

      const pairAddress = await this.getPair(tokenA, tokenB)
      if (pairAddress) {
        await this.approveToken(
          pairAddress,
          contracts.router,
          liquidity,
          account
        )
      }

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
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error removing liquidity:', error)
      throw error
    }
  }

  // ========================================
  // Staking Methods
  // ========================================

  /**
   * Get user staking info
   * Uses StakingStub.json ABI
   */
  async getStakingUserInfo(accountAddress: string): Promise<{
    totalStaked: string
    userStaked: string
    pendingRewards: string
    apr: string
    lockPeriod: number
  } | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } = await this.stakingContract.query.getUserInfo(
        accountAddress,
        { gasLimit: this.makeDryGas() },
        accountAddress
      )

      if (result.isOk && output) {
        // Process output if the ABI matches
        const json = output.toJSON() as any
        const obj = json?.ok ?? json
        if (obj && typeof obj === 'object') {
          return {
            totalStaked: String(obj.totalStaked ?? '1000000000000000'),
            userStaked: String(obj.userStaked ?? '0'),
            pendingRewards: String(obj.pendingRewards ?? '0'),
            apr: String(obj.apr ?? '120'),
            lockPeriod: Number(obj.lockPeriod ?? 7)
          }
        }
      }
    } catch (err) {
      console.warn(
        'getStakingUserInfo: Query failed (contract not deployed or ABI mismatch).'
      )
    }

    return null
  }

  /**
   * Stake LP tokens
   */
  async stake(
    amount: string,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.stakingContract) {
      throw new Error('Staking contract not connected')
    }

    try {
      const injector = await web3FromAddress(account.address)

      // Get gas required
      const { gasRequired } = await this.stakingContract.query.stake(
        account.address,
        { gasLimit: this.makeDryGas() },
        amount
      )

      return await new Promise((resolve, reject) => {
        if (!this.stakingContract) {
          reject(new Error('Staking contract not initialized'))
          return
        }
        this.stakingContract.tx
          .stake({ gasLimit: gasRequired, storageDepositLimit: null }, amount)
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error staking:', error)
      throw error
    }
  }

  /**
   * Unstake LP tokens
   */
  async unstake(
    amount: string,
    account: InjectedAccountWithMeta
  ): Promise<string | null> {
    if (!this.api || !this.stakingContract) {
      throw new Error('Staking contract not connected')
    }

    try {
      const injector = await web3FromAddress(account.address)

      const { gasRequired } = await this.stakingContract.query.unstake(
        account.address,
        { gasLimit: this.makeDryGas() },
        amount
      )

      return await new Promise((resolve, reject) => {
        if (!this.stakingContract) {
          reject(new Error('Staking contract not initialized'))
          return
        }
        this.stakingContract.tx
          .unstake({ gasLimit: gasRequired, storageDepositLimit: null }, amount)
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error unstaking:', error)
      throw error
    }
  }

  /**
   * Claim Staking Rewards
   */
  async claimRewards(account: InjectedAccountWithMeta): Promise<string | null> {
    if (!this.api || !this.stakingContract) {
      throw new Error('Staking contract not connected')
    }

    try {
      const injector = await web3FromAddress(account.address)

      const { gasRequired } = await this.stakingContract.query.claimRewards(
        account.address,
        { gasLimit: this.makeDryGas() }
      )

      return await new Promise((resolve, reject) => {
        if (!this.stakingContract) {
          reject(new Error('Staking contract not initialized'))
          return
        }
        this.stakingContract.tx
          .claimRewards({ gasLimit: gasRequired, storageDepositLimit: null })
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            }
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error claiming rewards:', error)
      throw error
    }
  }

  /**
   * Get proposal details from the Staking/Governance contract
   */
  async getProposal(proposalId: number): Promise<{
    id: number
    name: string
    description: string
    tokenAddress: string
    proposer: string
    votesYes: number
    votesNo: number
    votingDeadline: number
    executed: boolean
    active: boolean
    fee: string
  } | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } = await this.stakingContract.query.getProposal(
        this.contracts?.staking || '',
        { gasLimit: this.makeDryGas() },
        proposalId,
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        const obj = json?.ok ?? json
        if (obj && typeof obj === 'object') {
          return {
            id: proposalId,
            name: String(obj.name ?? ''),
            description: String(obj.description ?? ''),
            tokenAddress: String(obj.tokenAddress ?? ''),
            proposer: String(obj.proposer ?? ''),
            votesYes: Number(obj.votesYes ?? 0),
            votesNo: Number(obj.votesNo ?? 0),
            votingDeadline: Number(obj.votingDeadline ?? 0),
            executed: Boolean(obj.executed),
            active: Boolean(obj.active),
            fee: String(obj.fee ?? '0'),
          }
        }
      }
    } catch (err) {
      console.warn(`getProposal(${proposalId}): Query failed`, err)
    }
    return null
  }

  /**
   * Get voting power for an address (based on staked amount)
   */
  async getVotingPower(accountAddress: string): Promise<string> {
    if (!this.api || !this.stakingContract) return '0'
    try {
      const { result, output } = await this.stakingContract.query.getVotingPower(
        accountAddress,
        { gasLimit: this.makeDryGas() },
        accountAddress,
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        const inner = json?.ok ?? json
        return String(inner ?? '0')
      }
    } catch (err) {
      console.warn('getVotingPower: Query failed', err)
    }
    return '0'
  }

  /**
   * Vote on a governance proposal (on-chain transaction)
   */
  async vote(
    proposalId: number,
    approve: boolean,
    account: InjectedAccountWithMeta,
  ): Promise<string | null> {
    if (!this.api || !this.stakingContract) {
      throw new Error('Staking contract not connected')
    }

    try {
      const injector = await web3FromAddress(account.address)

      const { gasRequired } = await this.stakingContract.query.vote(
        account.address,
        { gasLimit: this.makeDryGas() },
        proposalId,
        approve,
      )

      return await new Promise((resolve, reject) => {
        if (!this.stakingContract) {
          reject(new Error('Staking contract not initialized'))
          return
        }
        this.stakingContract.tx
          .vote({ gasLimit: gasRequired, storageDepositLimit: null }, proposalId, approve)
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            },
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error voting:', error)
      throw error
    }
  }

  /**
   * Create a listing proposal (on-chain transaction)
   * Requires payment of proposal fee in native LUNES
   */
  async createProposal(
    name: string,
    description: string,
    tokenAddress: string,
    account: InjectedAccountWithMeta,
  ): Promise<string | null> {
    if (!this.api || !this.stakingContract) {
      throw new Error('Staking contract not connected')
    }

    try {
      const injector = await web3FromAddress(account.address)

      // Get the current proposal fee from contract
      const { output: feeOutput } = await this.stakingContract.query.getCurrentProposalFee(
        account.address,
        { gasLimit: this.makeDryGas() },
      )

      let fee = BigInt('100000000000') // Default 1000 LUNES (8 decimals)
      if (feeOutput) {
        const feeJson = feeOutput.toJSON() as any
        const feeVal = feeJson?.ok ?? feeJson
        if (feeVal) fee = BigInt(String(feeVal))
      }

      const { gasRequired } = await this.stakingContract.query.createProposal(
        account.address,
        { gasLimit: this.makeDryGas(), value: fee },
        name,
        description,
        tokenAddress,
      )

      return await new Promise((resolve, reject) => {
        if (!this.stakingContract) {
          reject(new Error('Staking contract not initialized'))
          return
        }
        this.stakingContract.tx
          .createProposal(
            { gasLimit: gasRequired, storageDepositLimit: null, value: fee },
            name,
            description,
            tokenAddress,
          )
          .signAndSend(
            account.address,
            { signer: injector.signer },
            (result: any) => {
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()))
              } else if (result.status.isInBlock || result.status.isFinalized) {
                resolve(result.txHash.toHex())
              }
            },
          )
          .catch(reject)
      })
    } catch (error) {
      console.error('Error creating proposal:', error)
      throw error
    }
  }

  /**
   * Get the total number of proposals (from listing stats)
   */
  async getListingStats(): Promise<{ totalProposals: number; approvedProposals: number } | null> {
    if (!this.api || !this.stakingContract) return null
    try {
      const { result, output } = await this.stakingContract.query.getListingStats(
        this.contracts?.staking || '',
        { gasLimit: this.makeDryGas() },
      )

      if (result.isOk && output) {
        const json = output.toJSON() as any
        const obj = json?.ok ?? json
        if (obj && typeof obj === 'object') {
          return {
            totalProposals: Number(obj.totalProposals ?? 0),
            approvedProposals: Number(obj.approvedProposals ?? 0),
          }
        }
      }
    } catch (err) {
      console.warn('getListingStats: Query failed', err)
    }
    return null
  }
}

// Export singleton instance
export const contractService = new ContractService()
export default contractService
