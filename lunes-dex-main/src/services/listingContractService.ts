/**
 * listingContractService — on-chain token listing (ListingManager).
 *
 * The contract is the source of truth for the listing fee, the minimum
 * LUNES liquidity, the lock period (`tier_config`) and the fee token
 * (`lunes_token`). Flow, as required by `Lunex/contracts/listing_manager`
 * `list_token(tier, token, pair, lp_amount)`:
 *
 *   1. PSP22 `approve(listing_manager, listing_fee)` on the fee token
 *   2. PSP22 `approve(listing_manager, lp_amount)` on the LP (pair) token
 *   3. `list_token` — in ONE transaction: checks the pair is the Factory
 *      TOKEN/WLUNES pair, derives the LUNES/TOKEN share from reserves,
 *      collects + splits the fee 20/50/30, moves the LP into LiquidityLock
 *      and creates the lock (owner = caller). Any failure reverts it all.
 *
 * Every write follows contractService.ts: dry-run query for gas (and to
 * surface contract errors before the wallet opens), sign with the injected
 * extension, resolve only once the block is finalized.
 */
import { ContractPromise } from '@polkadot/api-contract'
import { getSignerFor } from '../wallet/activeWallet'
import ListingManagerABI from '../abis/ListingManager.json'
import PairABI from '../abis/Pair.json'
import { CONTRACTS, NETWORK, TOKENS } from '../config/contracts'
import contractService from './contractService'

const DRY_GAS = {
  refTime: BigInt('100000000000'),
  proofSize: BigInt('2000000')
}

export const LISTING_MANAGER_ADDRESS: string = CONTRACTS.LISTING_MANAGER
export const LISTING_FEE_TOKEN: string =
  CONTRACTS.LISTING_FEE_TOKEN || TOKENS.WLUNES

export const isListingContractConfigured = (): boolean =>
  LISTING_MANAGER_ADDRESS.length >= 10

export type ListingTierNumber = 1 | 2 | 3

/** Raw on-chain tier config (fee-token base units). */
export type OnChainTierConfig = {
  listingFee: bigint
  minLunesLiq: bigint
  lockDurationMs: number
}

export type OnChainListing = {
  id: number
  owner: string
  tokenAddress: string
  pairAddress: string
  lpAmount: bigint
  lunesLiquidity: bigint
  tokenLiquidity: bigint
  lockId: number
  /** ms timestamp the LP can be withdrawn from LiquidityLock */
  unlockAt: number
  feePaid: bigint
  status: string
}

export type ListTokenParams = {
  tier: ListingTierNumber
  tokenAddress: string
  /** Factory TOKEN/WLUNES pair — also the LP token on Lunex */
  pairAddress: string
  lpAmount: bigint
}

const CONTRACT_ERRORS: Record<string, string> = {
  ContractPaused: 'Listings are paused on-chain right now.',
  TokenAlreadyListed: 'This token is already listed on-chain.',
  InvalidTier: 'Invalid listing tier.',
  InsufficientLiquidity:
    'Your LP position is below the minimum LUNES liquidity for this tier.',
  ZeroAmount: 'LP amount and pool liquidity must be greater than zero.',
  TransferFailed:
    'The fee transfer failed — check your fee token balance and approval.',
  LpTransferFailed:
    'Moving your LP tokens into the lock failed — check your LP balance and approval.',
  LockCreationFailed: 'The liquidity lock could not be created.',
  InvalidPair:
    'This pool is not the Lunex TOKEN/WLUNES pair for this token, or it has no liquidity.',
  PairQueryFailed: 'Could not read the pool on-chain.',

  InsufficientAllowance: 'Token approval is too low.',
  InsufficientBalance: 'Insufficient token balance.'
}

// ── Codec helpers ────────────────────────────────────────────────

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v !== '') return BigInt(v.replace(/,/g, ''))
  return BigInt(0)
}

const pick = (o: Record<string, unknown>, camel: string, snake: string) =>
  o[camel] ?? o[snake]

/**
 * Unwraps ink! 4 `Result<Result<T, Error>, LangError>` JSON. Throws a
 * readable error for `Err` variants.
 */
const unwrap = (json: unknown): unknown => {
  let cur = json as Record<string, unknown> | null
  for (let depth = 0; depth < 2 && cur && typeof cur === 'object'; depth++) {
    if ('err' in cur || 'Err' in cur) {
      const e = cur.err ?? cur.Err
      const key =
        typeof e === 'string'
          ? e
          : e && typeof e === 'object'
            ? Object.keys(e as object)[0]
            : String(e)
      throw new Error(CONTRACT_ERRORS[key] ?? `Contract error: ${key}`)
    }
    if ('ok' in cur || 'Ok' in cur) {
      cur = (cur.ok ?? cur.Ok) as Record<string, unknown> | null
      continue
    }
    break
  }
  return cur
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decodeDispatchError = (api: any, dispatchError: any): string => {
  try {
    if (dispatchError?.isModule) {
      const { section, name } = api.registry.findMetaError(
        dispatchError.asModule
      )
      if (section === 'contracts' && name === 'ContractReverted')
        return 'The contract reverted — nothing was charged.'
      return `${section}.${name}`
    }
  } catch {
    // fall through
  }
  return String(dispatchError)
}

// ── Contracts ────────────────────────────────────────────────────

const getApi = async () => {
  let api = contractService.getApi()
  if (!api) {
    await contractService.connect(NETWORK.name)
    api = contractService.getApi()
  }
  if (!api) throw new Error('Not connected to the Lunes network')
  return api
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dryGas = async (): Promise<any> =>
  (await getApi()).registry.createType('WeightV2', DRY_GAS)

const manager = async (): Promise<ContractPromise> => {
  if (!isListingContractConfigured())
    throw new Error('The listing contract is not deployed on this network yet.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ContractPromise(
    await getApi(),
    ListingManagerABI as any,
    LISTING_MANAGER_ADDRESS
  )
}

const psp22 = async (address: string): Promise<ContractPromise> =>
  // Pair ABI carries the PSP22 messages with the right selectors (same as
  // contractService.getTokenContract).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new ContractPromise(await getApi(), PairABI as any, address)

const query = async (
  contract: ContractPromise,
  method: string,
  caller: string,
  args: unknown[]
): Promise<unknown> => {
  const fn = contract.query[method]
  if (!fn) throw new Error(`Contract message ${method} not found in ABI`)
  const { result, output } = await fn(
    caller,
    { gasLimit: await dryGas(), storageDepositLimit: null },
    ...args
  )
  if (result.isErr) {
    throw new Error(decodeDispatchError(await getApi(), result.asErr))
  }
  return unwrap(output?.toJSON())
}

/**
 * Dry-run → sign → wait for finalization. Resolves the extrinsic hash only
 * when the block holding it is finalized without a dispatch error.
 */
const sendFinalized = async (
  contract: ContractPromise,
  method: string,
  signer: string,
  args: unknown[],
  onBroadcast?: () => void
): Promise<string> => {
  const api = await getApi()
  const q = contract.query[method]
  const tx = contract.tx[method]
  if (!q || !tx) throw new Error(`Contract message ${method} not found in ABI`)

  const { gasRequired, result, output } = await q(
    signer,
    { gasLimit: await dryGas(), storageDepositLimit: null },
    ...args
  )
  if (result.isErr) throw new Error(decodeDispatchError(api, result.asErr))
  unwrap(output?.toJSON()) // throws on Err(..) before the wallet opens

  const walletSigner = getSignerFor(signer)
  return new Promise<string>((resolve, reject) => {
    let broadcast = false
    let unsub: (() => void) | undefined
    tx({ gasLimit: gasRequired, storageDepositLimit: null }, ...args)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .signAndSend(signer, { signer: walletSigner }, (res: any) => {
        if (!broadcast && !res.status.isFuture) {
          broadcast = true
          onBroadcast?.()
        }
        if (res.dispatchError) {
          unsub?.()
          reject(new Error(decodeDispatchError(api, res.dispatchError)))
          return
        }
        if (
          res.status.isDropped ||
          res.status.isInvalid ||
          res.status.isUsurped ||
          res.status.isFinalityTimeout
        ) {
          unsub?.()
          reject(new Error('The transaction was dropped by the network.'))
          return
        }
        if (res.status.isFinalized) {
          unsub?.()
          resolve(res.txHash.toHex())
        }
      })
      .then(u => {
        unsub = u
      })
      .catch(reject)
  })
}

// ── Reads ────────────────────────────────────────────────────────

export const readTierConfig = async (
  tier: ListingTierNumber
): Promise<OnChainTierConfig> => {
  const c = await manager()
  const o = (await query(c, 'tierConfig', LISTING_MANAGER_ADDRESS, [
    tier
  ])) as Record<string, unknown>
  return {
    listingFee: toBig(pick(o, 'listingFee', 'listing_fee')),
    minLunesLiq: toBig(pick(o, 'minLunesLiq', 'min_lunes_liq')),
    lockDurationMs: Number(toBig(pick(o, 'lockDurationMs', 'lock_duration_ms')))
  }
}

export const readIsPaused = async (): Promise<boolean> => {
  const c = await manager()
  return !!(await query(c, 'isPaused', LISTING_MANAGER_ADDRESS, []))
}

export const readTokenListing = async (
  tokenAddress: string
): Promise<OnChainListing | null> => {
  const c = await manager()
  const id = await query(c, 'getTokenListing', LISTING_MANAGER_ADDRESS, [
    tokenAddress
  ])
  if (id === null || id === undefined) return null
  const rec = (await query(c, 'getListing', LISTING_MANAGER_ADDRESS, [
    Number(id)
  ])) as Record<string, unknown> | null
  if (!rec) return null
  return {
    id: Number(id),
    owner: String(rec.owner),
    tokenAddress: String(pick(rec, 'tokenAddress', 'token_address')),
    pairAddress: String(pick(rec, 'pairAddress', 'pair_address')),
    lpAmount: toBig(pick(rec, 'lpAmount', 'lp_amount')),
    lunesLiquidity: toBig(pick(rec, 'lunesLiquidity', 'lunes_liquidity')),
    tokenLiquidity: toBig(pick(rec, 'tokenLiquidity', 'token_liquidity')),
    lockId: Number(pick(rec, 'lockId', 'lock_id')),
    unlockAt: Number(toBig(pick(rec, 'unlockAt', 'unlock_at'))),
    feePaid: toBig(pick(rec, 'feePaid', 'fee_paid')),
    status: String(rec.status)
  }
}

/** Fee token (= pool base token, WLUNES) and the decimals tiers are scaled by. */
export const readFeeToken = async (): Promise<{
  address: string
  decimals: number
}> => {
  const c = await manager()
  const [address, decimals] = await Promise.all([
    query(c, 'lunesToken', LISTING_MANAGER_ADDRESS, []),
    query(c, 'lunesDecimals', LISTING_MANAGER_ADDRESS, [])
  ])
  return { address: String(address), decimals: Number(decimals) }
}

export const readAllowance = async (
  token: string,
  owner: string
): Promise<bigint> =>
  toBig(
    await contractService.getAllowance(token, owner, LISTING_MANAGER_ADDRESS)
  )

// ── Writes ───────────────────────────────────────────────────────

/** PSP22 approve(listing_manager, amount). Resolves the finalized tx hash. */
export const approveForListing = async (
  token: string,
  amount: bigint,
  signer: string,
  onBroadcast?: () => void
): Promise<string> =>
  sendFinalized(
    await psp22(token),
    'approve',
    signer,
    [LISTING_MANAGER_ADDRESS, amount.toString()],
    onBroadcast
  )

/**
 * list_token — pays the tier fee and moves the LP into LiquidityLock in one
 * transaction. Resolves once finalized, after re-reading the listing.
 */
export const listToken = async (
  p: ListTokenParams,
  signer: string,
  onBroadcast?: () => void
): Promise<{ txHash: string; listing: OnChainListing }> => {
  const txHash = await sendFinalized(
    await manager(),
    'listToken',
    signer,
    [p.tier, p.tokenAddress, p.pairAddress, p.lpAmount.toString()],
    onBroadcast
  )
  const listing = await readTokenListing(p.tokenAddress)
  if (!listing)
    throw new Error(
      `Transaction ${txHash} finalized but no listing was recorded on-chain.`
    )
  return { txHash, listing }
}
