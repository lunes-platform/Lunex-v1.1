// ── ink! ContractEmitted decoder ───────────────────────────────
//
// The deployed Lunex contracts are ink! 4.2.1, which emit events using
// STRING topics ("PairContract::Swap", "RouterContract::Swap", ...) and
// SCALE-encode the full event payload (including #[ink(topic)] fields) into
// the ContractEmitted `data` blob, prefixed by a 1-byte event-enum variant.
//
// SubQuery's `event.event.data.toJSON()` for a `contracts.ContractEmitted`
// event returns the pallet-level shape `[contractAccountId, dataHex, topics?]`
// — it does NOT expose the inner ink! fields. So `args.amount_in` etc. are
// always `undefined`, which is why every swap was persisted with amount=0.
//
// This module decodes the raw payload bytes manually using the byte layout
// verified against live on-chain events (ws://node, blocks 219..3329):
//
//   RouterContract::Swap  payload =
//     [0]      u8     event-enum variant (0x02)
//     [1..33]  [u8;32] sender   (AccountId)
//     [33..49] u128 LE amount_in
//     [49..65] u128 LE amount_out
//     [65]     compact-u8 path length (n)
//     then n * [u8;32] path token AccountIds
//     then [u8;32] to (AccountId)
//
//   PairContract::Swap    payload =
//     [0]       u8     event-enum variant (0x02)
//     [1..33]   [u8;32] sender (AccountId)
//     [33..65]  [u8;32] to     (AccountId)
//     [65..81]  u128 LE amount_0_in
//     [81..97]  u128 LE amount_1_in
//     [97..113] u128 LE amount_0_out
//     [113..129]u128 LE amount_1_out
//
// Amounts are raw on-chain integers (already in base units) and are stored
// verbatim as BigInt — no decimal rescaling.

import { SubstrateEvent } from '@subql/types'
import { hexToU8a, u8aToHex } from '@polkadot/util'

// NOTE: We intentionally avoid `@polkadot/util-crypto`'s `encodeAddress` here.
// It pulls in WASM/`TextEncoder`, which is NOT available in the SubQuery
// sandbox VM and throws `ReferenceError: TextEncoder is not defined`.
// AccountIds are emitted as 0x-prefixed hex (32 bytes) — stable, non-empty
// identity values. SS58 rendering can be done at query time off-chain.

export type ContractEmittedRaw = {
  contract: string
  payload: Uint8Array
  payloadHex: string
  topics: string[]
  /** ASCII-decoded topic[0], e.g. "PairContract::Swap" */
  label: string
}

/** Decode an ink! string topic back to its ASCII label. */
function topicToLabel(topicHex: string): string {
  try {
    const bytes = hexToU8a(topicHex)
    let s = ''
    for (const c of bytes) {
      if (c >= 32 && c < 127) s += String.fromCharCode(c)
      else s += '.'
    }
    // strip leading/trailing non-printable padding
    return s.replace(/^\.+/, '').replace(/\.+$/, '')
  } catch {
    return ''
  }
}

/**
 * Normalize a `contracts.ContractEmitted` SubstrateEvent into raw parts.
 * Returns `undefined` if this is not a decodable ContractEmitted event.
 */
export function readContractEmitted(event: SubstrateEvent): ContractEmittedRaw | undefined {
  try {
    const data = event.event.data
    if (!data || data.length < 2) return undefined

    const contract = data[0].toString()
    // data[1] is the Bytes payload
    const payloadHex = (data[1] as unknown as { toHex: () => string }).toHex()
    const payload = hexToU8a(payloadHex)

    // Topics may live in data[2] (pallet-contracts emits them inline) or on
    // the event record's `topics`. Prefer inline, fall back to record topics.
    let topicsCodec: unknown[] = []
    if (data.length > 2 && (data[2] as unknown as { map?: unknown }).map) {
      topicsCodec = data[2] as unknown as unknown[]
    } else if ((event as unknown as { topics?: unknown[] }).topics) {
      topicsCodec = (event as unknown as { topics: unknown[] }).topics
    }
    const topics = topicsCodec.map((t) => (t as { toString: () => string }).toString())
    const label = topics.length > 0 ? topicToLabel(topics[0]) : ''

    return { contract, payload, payloadHex, topics, label }
  } catch {
    return undefined
  }
}

/** Read a little-endian u128 from `bytes` at `offset`. */
function readU128LE(bytes: Uint8Array, offset: number): bigint {
  let v = BigInt(0)
  for (let i = 15; i >= 0; i--) {
    v = (v << BigInt(8)) | BigInt(bytes[offset + i] ?? 0)
  }
  return v
}

/** Read an unsigned little-endian integer of `n` bytes at `offset`. */
function readUintLE(bytes: Uint8Array, offset: number, n: number): bigint {
  let v = BigInt(0)
  for (let i = n - 1; i >= 0; i--) {
    v = (v << BigInt(8)) | BigInt(bytes[offset + i] ?? 0)
  }
  return v
}

/** Read a little-endian u64 (8 bytes) as BigInt. */
function readU64LE(bytes: Uint8Array, offset: number): bigint {
  return readUintLE(bytes, offset, 8)
}

/** Read a little-endian u32 (4 bytes) as BigInt. */
function readU32LE(bytes: Uint8Array, offset: number): bigint {
  return readUintLE(bytes, offset, 4)
}

/** Read a SCALE compact-encoded length (returns value + bytes consumed). */
function readCompactLen(bytes: Uint8Array, offset: number): { value: number; size: number } {
  const b0 = bytes[offset] ?? 0
  const mode = b0 & 0b11
  if (mode === 0b00) return { value: b0 >> 2, size: 1 }
  if (mode === 0b01) {
    const v = ((b0 >> 2) | ((bytes[offset + 1] ?? 0) << 6)) >>> 0
    return { value: v, size: 2 }
  }
  if (mode === 0b10) {
    const v =
      ((b0 >> 2) |
        ((bytes[offset + 1] ?? 0) << 6) |
        ((bytes[offset + 2] ?? 0) << 14) |
        ((bytes[offset + 3] ?? 0) << 22)) >>>
      0
    return { value: v, size: 4 }
  }
  // big-integer mode: byte count encoded in upper bits
  const nBytes = (b0 >> 2) + 4
  return { value: Number(readUintLE(bytes, offset + 1, nBytes)), size: 1 + nBytes }
}

/** Read a 32-byte AccountId at `offset` as 0x-prefixed hex. */
function readAccountId(bytes: Uint8Array, offset: number): string {
  return u8aToHex(bytes.slice(offset, offset + 32))
}

export type DecodedRouterSwap = {
  sender: string
  amountIn: bigint
  amountOut: bigint
  path: string[]
  to: string
}

/** Decode a RouterContract::Swap payload. */
export function decodeRouterSwap(payload: Uint8Array): DecodedRouterSwap | undefined {
  try {
    let off = 1 // skip event-enum variant byte
    const sender = readAccountId(payload, off)
    off += 32
    const amountIn = readU128LE(payload, off)
    off += 16
    const amountOut = readU128LE(payload, off)
    off += 16
    // SCALE compact length for the path Vec<AccountId>. For small vecs this is
    // a single byte = len << 2.
    const compact = payload[off]
    const pathLen = compact >> 2
    off += 1
    const path: string[] = []
    for (let i = 0; i < pathLen; i++) {
      path.push(readAccountId(payload, off))
      off += 32
    }
    const to = readAccountId(payload, off)
    return { sender, amountIn, amountOut, path, to }
  } catch {
    return undefined
  }
}

export type DecodedPairSwap = {
  sender: string
  to: string
  amount0In: bigint
  amount1In: bigint
  amount0Out: bigint
  amount1Out: bigint
  /** effective swapped-in amount (the non-zero of the two ins) */
  amountIn: bigint
  /** effective swapped-out amount (the non-zero of the two outs) */
  amountOut: bigint
}

/** Decode a PairContract::Swap payload. */
export function decodePairSwap(payload: Uint8Array): DecodedPairSwap | undefined {
  try {
    let off = 1 // skip event-enum variant byte
    const sender = readAccountId(payload, off)
    off += 32
    const to = readAccountId(payload, off)
    off += 32
    const amount0In = readU128LE(payload, off)
    off += 16
    const amount1In = readU128LE(payload, off)
    off += 16
    const amount0Out = readU128LE(payload, off)
    off += 16
    const amount1Out = readU128LE(payload, off)
    const amountIn = amount0In > BigInt(0) ? amount0In : amount1In
    const amountOut = amount0Out > BigInt(0) ? amount0Out : amount1Out
    return { sender, to, amount0In, amount1In, amount0Out, amount1Out, amountIn, amountOut }
  } catch {
    return undefined
  }
}

/** Build a stable pair symbol from two token AccountIds (truncated). */
export function pairSymbolFromTokens(a?: string, b?: string): string | undefined {
  if (!a || !b) return undefined
  return `${a.slice(0, 8)}.../${b.slice(0, 8)}...`
}

// ── Non-swap event decoders ────────────────────────────────────
//
// Same approach as the Swap decoders: ink! 4.x SCALE-encodes the full event
// payload (topic fields INCLUDED, in struct-declaration order) into the
// ContractEmitted `data` blob, prefixed by a 1-byte event-enum variant. We
// walk the bytes in declaration order using the field types verified against
// `Lunex/contracts/*/lib.rs`:
//   Balance = u128 (16B LE), Timestamp = u64 (8B LE), AccountId = 32B,
//   ListingId/LockId/nonce = u64 (8B LE), tier = u8 (1B), drawdown_bps = u32,
//   Vec<u8> = SCALE compact length + raw bytes, enum = 1B discriminant.
// All offsets start at 1 to skip the event-enum variant byte.

export type DecodedRouterLiquidity = {
  tokenA: string
  tokenB: string
  amountA: bigint
  amountB: bigint
  liquidity: bigint
  to: string
}

/** Decode RouterContract::LiquidityAdded / LiquidityRemoved (same layout). */
export function decodeRouterLiquidity(payload: Uint8Array): DecodedRouterLiquidity | undefined {
  try {
    let off = 1
    const tokenA = readAccountId(payload, off); off += 32
    const tokenB = readAccountId(payload, off); off += 32
    const amountA = readU128LE(payload, off); off += 16
    const amountB = readU128LE(payload, off); off += 16
    const liquidity = readU128LE(payload, off); off += 16
    const to = readAccountId(payload, off)
    return { tokenA, tokenB, amountA, amountB, liquidity, to }
  } catch {
    return undefined
  }
}

export type DecodedVaultDeposited = {
  depositor: string
  amount: bigint
  sharesMinted: bigint
  sharePrice: bigint
  timestamp: bigint
}

/** Decode CopyVault::Deposited. */
export function decodeVaultDeposited(payload: Uint8Array): DecodedVaultDeposited | undefined {
  try {
    let off = 1
    const depositor = readAccountId(payload, off); off += 32
    const amount = readU128LE(payload, off); off += 16
    const sharesMinted = readU128LE(payload, off); off += 16
    const sharePrice = readU128LE(payload, off); off += 16
    const timestamp = readU64LE(payload, off)
    return { depositor, amount, sharesMinted, sharePrice, timestamp }
  } catch {
    return undefined
  }
}

export type DecodedVaultWithdrawn = {
  depositor: string
  sharesBurned: bigint
  amountReceived: bigint
  performanceFee: bigint
  timestamp: bigint
}

/** Decode CopyVault::Withdrawn. */
export function decodeVaultWithdrawn(payload: Uint8Array): DecodedVaultWithdrawn | undefined {
  try {
    let off = 1
    const depositor = readAccountId(payload, off); off += 32
    const sharesBurned = readU128LE(payload, off); off += 16
    const amountReceived = readU128LE(payload, off); off += 16
    const performanceFee = readU128LE(payload, off); off += 16
    const timestamp = readU64LE(payload, off)
    return { depositor, sharesBurned, amountReceived, performanceFee, timestamp }
  } catch {
    return undefined
  }
}

export type DecodedVaultTrade = {
  leader: string
  pair: string
  side: string
  amount: bigint
  vaultEquityAfter: bigint
  timestamp: bigint
}

/** Decode CopyVault::TradeExecuted (pair is Vec<u8>, side is enum). */
export function decodeVaultTrade(payload: Uint8Array): DecodedVaultTrade | undefined {
  try {
    let off = 1
    const leader = readAccountId(payload, off); off += 32
    const { value: pairLen, size } = readCompactLen(payload, off); off += size
    let pair = ''
    for (let i = 0; i < pairLen; i++) {
      const c = payload[off + i] ?? 0
      pair += c >= 32 && c < 127 ? String.fromCharCode(c) : ''
    }
    off += pairLen
    const sideByte = payload[off] ?? 0; off += 1
    const side = sideByte === 0 ? 'BUY' : 'SELL'
    const amount = readU128LE(payload, off); off += 16
    const vaultEquityAfter = readU128LE(payload, off)
    return { leader, pair, side, amount, vaultEquityAfter, timestamp: BigInt(0) }
  } catch {
    return undefined
  }
}

export type DecodedVaultCircuitBreaker = {
  vault: string
  currentEquity: bigint
  highWaterMark: bigint
  drawdownBps: bigint
}

/** Decode CopyVault::CircuitBreakerTriggered. */
export function decodeVaultCircuitBreaker(
  payload: Uint8Array,
): DecodedVaultCircuitBreaker | undefined {
  try {
    let off = 1
    const vault = readAccountId(payload, off); off += 32
    const currentEquity = readU128LE(payload, off); off += 16
    const highWaterMark = readU128LE(payload, off); off += 16
    const drawdownBps = readU32LE(payload, off)
    return { vault, currentEquity, highWaterMark, drawdownBps }
  } catch {
    return undefined
  }
}

export type DecodedTokenListed = {
  listingId: bigint
  owner: string
  tokenAddress: string
  pairAddress: string
  tier: number
  lockId: bigint
}

/** Decode ListingManager::TokenListed. */
export function decodeTokenListed(payload: Uint8Array): DecodedTokenListed | undefined {
  try {
    let off = 1
    const listingId = readU64LE(payload, off); off += 8
    const owner = readAccountId(payload, off); off += 32
    const tokenAddress = readAccountId(payload, off); off += 32
    const pairAddress = readAccountId(payload, off); off += 32
    const tier = payload[off] ?? 0; off += 1
    const lockId = readU64LE(payload, off)
    return { listingId, owner, tokenAddress, pairAddress, tier, lockId }
  } catch {
    return undefined
  }
}

export type DecodedFeeDistributed = {
  listingId: bigint
  stakingAmount: bigint
  treasuryAmount: bigint
  rewardsAmount: bigint
}

/** Decode ListingManager::FeeDistributed. */
export function decodeFeeDistributed(payload: Uint8Array): DecodedFeeDistributed | undefined {
  try {
    let off = 1
    const listingId = readU64LE(payload, off); off += 8
    const stakingAmount = readU128LE(payload, off); off += 16
    const treasuryAmount = readU128LE(payload, off); off += 16
    const rewardsAmount = readU128LE(payload, off)
    return { listingId, stakingAmount, treasuryAmount, rewardsAmount }
  } catch {
    return undefined
  }
}

export type DecodedLiquidityLocked = {
  lockId: bigint
  owner: string
  pairAddress: string
  lpAmount: bigint
  unlockTimestamp: bigint
  tier: number
}

/** Decode LiquidityLock::LiquidityLocked. */
export function decodeLiquidityLocked(payload: Uint8Array): DecodedLiquidityLocked | undefined {
  try {
    let off = 1
    const lockId = readU64LE(payload, off); off += 8
    const owner = readAccountId(payload, off); off += 32
    const pairAddress = readAccountId(payload, off); off += 32
    const lpAmount = readU128LE(payload, off); off += 16
    const unlockTimestamp = readU64LE(payload, off); off += 8
    const tier = payload[off] ?? 0
    return { lockId, owner, pairAddress, lpAmount, unlockTimestamp, tier }
  } catch {
    return undefined
  }
}

export type DecodedLiquidityUnlocked = {
  lockId: bigint
  owner: string
  lpAmount: bigint
}

/** Decode LiquidityLock::LiquidityUnlocked. */
export function decodeLiquidityUnlocked(
  payload: Uint8Array,
): DecodedLiquidityUnlocked | undefined {
  try {
    let off = 1
    const lockId = readU64LE(payload, off); off += 8
    const owner = readAccountId(payload, off); off += 32
    const lpAmount = readU128LE(payload, off)
    return { lockId, owner, lpAmount }
  } catch {
    return undefined
  }
}

export type DecodedStaked = {
  staker: string
  amount: bigint
  duration: bigint
}

/** Decode StakingContract::Staked. */
export function decodeStaked(payload: Uint8Array): DecodedStaked | undefined {
  try {
    let off = 1
    const staker = readAccountId(payload, off); off += 32
    const amount = readU128LE(payload, off); off += 16
    const duration = readU64LE(payload, off)
    return { staker, amount, duration }
  } catch {
    return undefined
  }
}

export type DecodedUnstaked = {
  staker: string
  amount: bigint
  rewards: bigint
  penalty: bigint
}

/** Decode StakingContract::Unstaked. */
export function decodeUnstaked(payload: Uint8Array): DecodedUnstaked | undefined {
  try {
    let off = 1
    const staker = readAccountId(payload, off); off += 32
    const amount = readU128LE(payload, off); off += 16
    const rewards = readU128LE(payload, off); off += 16
    const penalty = readU128LE(payload, off)
    return { staker, amount, rewards, penalty }
  } catch {
    return undefined
  }
}

export type DecodedRewardsClaimed = {
  staker: string
  amount: bigint
}

/** Decode StakingContract::RewardsClaimed. */
export function decodeRewardsClaimed(payload: Uint8Array): DecodedRewardsClaimed | undefined {
  try {
    let off = 1
    const staker = readAccountId(payload, off); off += 32
    const amount = readU128LE(payload, off)
    return { staker, amount }
  } catch {
    return undefined
  }
}

export type DecodedSpotDeposit = {
  user: string
  token?: string
  amount: bigint
}

/**
 * Decode SpotSettlement::DepositNative | DepositPSP22 | WithdrawNative |
 * WithdrawPSP22. Native variants = { user, amount }; PSP22 variants insert a
 * `token` AccountId between them. Discriminate via the `isPsp22` flag derived
 * from the event label.
 */
export function decodeSpotTransfer(
  payload: Uint8Array,
  isPsp22: boolean,
): DecodedSpotDeposit | undefined {
  try {
    let off = 1
    const user = readAccountId(payload, off); off += 32
    let token: string | undefined
    if (isPsp22) {
      token = readAccountId(payload, off); off += 32
    }
    const amount = readU128LE(payload, off)
    return { user, token, amount }
  } catch {
    return undefined
  }
}

export type DecodedTradeSettled = {
  maker: string
  taker: string
  baseToken: string
  quoteToken: string
  price: bigint
  amount: bigint
  makerNonce: bigint
  takerNonce: bigint
}

/** Decode SpotSettlement::TradeSettled. */
export function decodeTradeSettled(payload: Uint8Array): DecodedTradeSettled | undefined {
  try {
    let off = 1
    const maker = readAccountId(payload, off); off += 32
    const taker = readAccountId(payload, off); off += 32
    const baseToken = readAccountId(payload, off); off += 32
    const quoteToken = readAccountId(payload, off); off += 32
    const price = readU128LE(payload, off); off += 16
    const amount = readU128LE(payload, off); off += 16
    const makerNonce = readU64LE(payload, off); off += 8
    const takerNonce = readU64LE(payload, off)
    return { maker, taker, baseToken, quoteToken, price, amount, makerNonce, takerNonce }
  } catch {
    return undefined
  }
}

// ── Label guard ────────────────────────────────────────────────
//
// EVERY mapping handler is wired to the same `contracts.ContractEmitted`
// filter in project.yaml, so each handler fires for EVERY contract event in a
// block — not just its own. Without discrimination each handler decodes the
// wrong payload (`event.data.toJSON()` yields the pallet-level array, so all
// inner ink! fields are `undefined`) and persists a zeroed/garbage row.
//
// `labelGuard` resolves a `ContractEmitted` event to its raw parts and returns
// it ONLY when the ink! string topic matches one of the handler's accepted
// labels. Handlers call it as the first statement and bail out (`return`) on
// `undefined`, so they no longer pollute their table with rows from foreign
// events. Labels follow the ink! `<ContractStruct>::<EventStruct>` convention,
// verified against live on-chain events.
export function labelGuard(
  event: SubstrateEvent,
  accepted: string[],
): ContractEmittedRaw | undefined {
  const raw = readContractEmitted(event)
  if (!raw || !accepted.includes(raw.label)) return undefined
  return raw
}
