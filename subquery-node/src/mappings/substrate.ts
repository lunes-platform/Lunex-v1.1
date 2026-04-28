import { SubstrateEvent } from '@subql/types'
import { SwapEvent, LiquidityEvent, TradeEvent } from '../types'
import {
  makeEventId,
  safeNum,
  getOrCreateWalletSummary,
  getOrCreatePairStats,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'

// ── Generic substrate/ContractEmitted fallback ─────────────────
// Handles pallet-level events not covered by the contract-specific handlers.
// Parses known event shapes (swap, liquidityAdd/Remove, tradeOpen/Close).
export async function handleSubstrateEvent(event: SubstrateEvent): Promise<void> {
  const section = event.event.section.toLowerCase()
  const method = event.event.method.toLowerCase()
  const key = `${section}.${method}`

  // Only process events relevant to Lunex
  if (!isRelevantEvent(section, method)) return

  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined
  const args = event.event.data.toJSON() as Record<string, unknown>

  if (key.includes('swap')) {
    await handleGenericSwap({ blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic })
  } else if (key.includes('liquidityadd') || key.includes('minted')) {
    await handleGenericLiquidityAdd({ blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic })
  } else if (key.includes('liquidityremov') || key.includes('burned')) {
    await handleGenericLiquidityRemove({ blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic })
  } else if (key.includes('tradeopen') || key.includes('positionopened')) {
    await handleGenericTradeOpen({ blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic })
  } else if (key.includes('tradeclose') || key.includes('positionclosed') || key.includes('settled')) {
    await handleGenericTradeClose({ blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic })
  }
}

// ── Helpers ────────────────────────────────────────────────────

function isRelevantEvent(section: string, method: string): boolean {
  const relevantPallets = ['router', 'factory', 'pair', 'market', 'orders', 'copytrade', 'social', 'contracts']
  const relevantMethods = ['swap', 'swapexecuted', 'liquidityadded', 'liquidityremoved', 'tradeopened', 'tradeclosed', 'positionopened', 'positionclosed', 'settled', 'minted', 'burned', 'contractemitted']

  if (relevantPallets.some((p) => section.includes(p))) return true
  if (relevantMethods.some((m) => method.includes(m))) return true
  return false
}

type EventContext = {
  blockNumber: bigint
  timestamp: Date
  extrinsicHash: string | undefined
  signer: string | undefined
  args: Record<string, unknown>
  section: string
  idx: number
  extrinsic: any
}

async function handleGenericSwap(ctx: EventContext): Promise<void> {
  const { blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic } = ctx
  const trader = String(args.sender ?? args.trader ?? args.account ?? signer ?? '')
  const amountIn = safeNum(args.amount_in ?? args.amount0In ?? args.amountIn)
  const amountOut = safeNum(args.amount_out ?? args.amount0Out ?? args.amountOut)

  if (!trader) return

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  await SwapEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: section,
    contractKind: 'substrate',
    trader,
    recipient: args.to ? String(args.to) : undefined,
    pairSymbol: args.pair ? String(args.pair) : undefined,
    amountIn,
    amountOut,
    tokenIn: undefined,
    tokenOut: undefined,
    path: undefined,
  }).save()

  const wallet = await getOrCreateWalletSummary(trader, timestamp)
  wallet.totalSwapCount += 1
  wallet.totalSwapVolumeIn += amountIn
  wallet.totalSwapVolumeOut += amountOut
  wallet.lastActivityAt = timestamp
  await wallet.save()

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.swapCount += BigInt(1)
  day.swapVolumeUsd += amountIn
  await day.save()
}

async function handleGenericLiquidityAdd(ctx: EventContext): Promise<void> {
  const { blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic } = ctx
  const provider = String(args.provider ?? args.sender ?? args.to ?? signer ?? '')
  const amount0 = safeNum(args.amount0 ?? args.amount_a ?? args.amount0In)
  const amount1 = safeNum(args.amount1 ?? args.amount_b ?? args.amount1In)
  const pairSymbol = args.pair ? String(args.pair) : undefined

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  await LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: section,
    kind: 'ADD',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: safeNum(args.liquidity ?? args.lp_tokens),
  }).save()

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

async function handleGenericLiquidityRemove(ctx: EventContext): Promise<void> {
  const { blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic } = ctx
  const provider = String(args.provider ?? args.sender ?? args.to ?? signer ?? '')
  const amount0 = safeNum(args.amount0 ?? args.amount_a)
  const amount1 = safeNum(args.amount1 ?? args.amount_b)
  const pairSymbol = args.pair ? String(args.pair) : undefined

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  await LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: section,
    kind: 'REMOVE',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: safeNum(args.liquidity ?? args.lp_tokens),
  }).save()

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

async function handleGenericTradeOpen(ctx: EventContext): Promise<void> {
  const { blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic } = ctx
  const trader = String(args.trader ?? args.account ?? signer ?? '')
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  await TradeEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: section,
    kind: 'OPEN',
    trader,
    pairSymbol: args.pair ? String(args.pair) : undefined,
    side: args.side ? String(args.side).toUpperCase() : undefined,
    size: safeNum(args.size ?? args.amount),
    entryPrice: safeNum(args.entry_price ?? args.price),
    exitPrice: undefined,
    realizedPnl: undefined,
    collateral: safeNum(args.collateral),
  }).save()

  const wallet = await getOrCreateWalletSummary(trader, timestamp)
  wallet.totalTradeCount += 1
  wallet.lastActivityAt = timestamp
  await wallet.save()
}

async function handleGenericTradeClose(ctx: EventContext): Promise<void> {
  const { blockNumber, timestamp, extrinsicHash, signer, args, section, idx, extrinsic } = ctx
  const trader = String(args.trader ?? args.account ?? signer ?? '')
  const realizedPnl = safeNum(args.realized_pnl ?? args.pnl)
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  await TradeEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: section,
    kind: 'CLOSE',
    trader,
    pairSymbol: args.pair ? String(args.pair) : undefined,
    side: args.side ? String(args.side).toUpperCase() : undefined,
    size: safeNum(args.size ?? args.amount),
    entryPrice: safeNum(args.entry_price),
    exitPrice: safeNum(args.exit_price ?? args.price),
    realizedPnl,
    collateral: safeNum(args.collateral),
  }).save()

  const wallet = await getOrCreateWalletSummary(trader, timestamp)
  wallet.totalTradeCount += 1
  wallet.totalRealizedPnl += realizedPnl
  if (realizedPnl > BigInt(0)) wallet.winningTrades += 1
  else if (realizedPnl < BigInt(0)) wallet.losingTrades += 1
  wallet.lastActivityAt = timestamp
  await wallet.save()
}
