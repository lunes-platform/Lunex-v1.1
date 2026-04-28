import { SubstrateEvent } from '@subql/types'
import { SwapEvent, LiquidityEvent } from '../types'
import {
  makeEventId,
  safeNum,
  getOrCreateWalletSummary,
  getOrCreatePairStats,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'

// ── Router: Swap ───────────────────────────────────────────────
export async function handleRouterSwap(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>

  const trader = String(args.sender ?? signer ?? '')
  const recipient = args.to ? String(args.to) : undefined
  const path = args.path ? JSON.stringify(args.path) : undefined
  const amountIn = safeNum(args.amount_in)
  const amountOut = safeNum(args.amount_out)

  const pairSymbol = derivePairFromPath(args.path)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const swapEvent = SwapEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    contractKind: 'router',
    trader,
    recipient,
    pairSymbol,
    amountIn,
    amountOut,
    tokenIn: extractFirstAddress(args.path),
    tokenOut: extractLastAddress(args.path),
    path,
  })

  await swapEvent.save()

  // Update wallet summary
  const wallet = await getOrCreateWalletSummary(trader, timestamp)
  wallet.totalSwapCount += 1
  wallet.totalSwapVolumeIn += amountIn
  wallet.totalSwapVolumeOut += amountOut
  wallet.lastActivityAt = timestamp
  await wallet.save()

  // Update pair stats
  if (pairSymbol) {
    const pair = await getOrCreatePairStats(pairSymbol, timestamp)
    pair.swapCount += BigInt(1)
    pair.volumeToken0 += amountIn
    pair.volumeToken1 += amountOut
    pair.lastSwapAt = timestamp
    await pair.save()
  }

  // Update daily stats
  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.swapCount += BigInt(1)
  day.swapVolumeUsd += amountIn
  await day.save()
}

// ── Router: LiquidityAdded ─────────────────────────────────────
export async function handleRouterLiquidityAdded(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const provider = String(args.to ?? signer ?? '')
  const amount0 = safeNum(args.amount_a)
  const amount1 = safeNum(args.amount_b)
  const pairSymbol = derivePairFromTwoTokens(args.token_a, args.token_b)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'ADD',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: safeNum(args.liquidity),
  })

  await ev.save()

  const wallet = await getOrCreateWalletSummary(provider, timestamp)
  wallet.totalLiquidityAdded += amount0 + amount1
  wallet.lastActivityAt = timestamp
  await wallet.save()

  if (pairSymbol) {
    const pair = await getOrCreatePairStats(pairSymbol, timestamp)
    pair.liquidityAddCount += BigInt(1)
    await pair.save()
  }

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.liquidityEvents += BigInt(1)
  await day.save()
}

// ── Router: LiquidityRemoved ───────────────────────────────────
export async function handleRouterLiquidityRemoved(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const provider = String(args.to ?? signer ?? '')
  const amount0 = safeNum(args.amount_a)
  const amount1 = safeNum(args.amount_b)
  const pairSymbol = derivePairFromTwoTokens(args.token_a, args.token_b)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'REMOVE',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: safeNum(args.liquidity),
  })

  await ev.save()

  const wallet = await getOrCreateWalletSummary(provider, timestamp)
  wallet.totalLiquidityRemoved += amount0 + amount1
  wallet.lastActivityAt = timestamp
  await wallet.save()

  if (pairSymbol) {
    const pair = await getOrCreatePairStats(pairSymbol, timestamp)
    pair.liquidityRemoveCount += BigInt(1)
    await pair.save()
  }

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.liquidityEvents += BigInt(1)
  await day.save()
}

// ── Pair: Swap (AMM pair contract — Uniswap V2 Swap event) ─────
// Emitted directly by each Pair contract (not the Router):
//   Swap { sender, amount0In, amount1In, amount0Out, amount1Out, to }
// This captures direct swaps that bypass the Router (e.g., flash swaps,
// aggregator integrations) and feeds them into the same analytics tables.
export async function handlePairSwap(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>

  // Uniswap V2 Swap event fields
  const sender = String(args.sender ?? signer ?? '')
  const to = args.to ? String(args.to) : undefined
  const amount0In = safeNum(args.amount0In ?? args.amount_0_in)
  const amount1In = safeNum(args.amount1In ?? args.amount_1_in)
  const amount0Out = safeNum(args.amount0Out ?? args.amount_0_out)
  const amount1Out = safeNum(args.amount1Out ?? args.amount_1_out)

  // Determine effective in/out (one of each pair will be 0)
  const amountIn = amount0In > BigInt(0) ? amount0In : amount1In
  const amountOut = amount0Out > BigInt(0) ? amount0Out : amount1Out

  if (!sender) return

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const swapEvent = SwapEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    contractKind: 'pair',
    trader: sender,
    recipient: to,
    pairSymbol: undefined, // pair contract address is the section; symbol resolved offline
    amountIn,
    amountOut,
    tokenIn: undefined,
    tokenOut: undefined,
    path: undefined,
  })
  await swapEvent.save()

  // Update wallet summary
  const wallet = await getOrCreateWalletSummary(sender, timestamp)
  wallet.totalSwapCount += 1
  wallet.totalSwapVolumeIn += amountIn
  wallet.totalSwapVolumeOut += amountOut
  wallet.lastActivityAt = timestamp
  await wallet.save()

  // Update daily stats
  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.swapCount += BigInt(1)
  day.swapVolumeUsd += amountIn
  await day.save()
}

// ── Helpers ────────────────────────────────────────────────────

function derivePairFromPath(path: unknown): string | undefined {
  if (!Array.isArray(path) || path.length < 2) return undefined
  const first = String(path[0]).slice(0, 8)
  const last = String(path[path.length - 1]).slice(0, 8)
  return `${first}.../${last}...`
}

function derivePairFromTwoTokens(tokenA: unknown, tokenB: unknown): string | undefined {
  if (!tokenA || !tokenB) return undefined
  const a = String(tokenA).slice(0, 8)
  const b = String(tokenB).slice(0, 8)
  return `${a}.../${b}...`
}

function extractFirstAddress(path: unknown): string | undefined {
  if (!Array.isArray(path) || path.length === 0) return undefined
  return String(path[0])
}

function extractLastAddress(path: unknown): string | undefined {
  if (!Array.isArray(path) || path.length === 0) return undefined
  return String(path[path.length - 1])
}
