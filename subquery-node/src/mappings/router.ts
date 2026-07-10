import { SubstrateEvent } from '@subql/types'
import { SwapEvent, LiquidityEvent } from '../types'
import {
  makeEventId,
  getOrCreateWalletSummary,
  getOrCreatePairStats,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'
import {
  readContractEmitted,
  decodeRouterSwap,
  decodePairSwap,
  decodeRouterLiquidity,
  pairSymbolFromTokens,
  labelGuard,
} from './contractEvents'

// ── Router: Swap ───────────────────────────────────────────────
export async function handleRouterSwap(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  // Every handler is wired to contracts.ContractEmitted, so each fires for
  // every contract event. Discriminate by the ink! string topic and bail out
  // for anything that isn't a Router Swap.
  const raw = readContractEmitted(event)
  if (!raw || raw.label !== 'RouterContract::Swap') return

  const decoded = decodeRouterSwap(raw.payload)
  if (!decoded) return

  const trader = decoded.sender || signer || ''
  const recipient = decoded.to || undefined
  const path = decoded.path.length > 0 ? JSON.stringify(decoded.path) : undefined
  const amountIn = decoded.amountIn
  const amountOut = decoded.amountOut

  const tokenIn = decoded.path[0]
  const tokenOut = decoded.path[decoded.path.length - 1]
  const pairSymbol = pairSymbolFromTokens(tokenIn, tokenOut)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const swapEvent = SwapEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    contractKind: 'router',
    trader,
    recipient,
    pairSymbol,
    amountIn,
    amountOut,
    tokenIn,
    tokenOut,
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

  // Discriminate by ink! string topic; bail on any non-LiquidityAdded event.
  const raw = labelGuard(event, ['RouterContract::LiquidityAdded'])
  if (!raw) return

  const decoded = decodeRouterLiquidity(raw.payload)
  if (!decoded) return
  const provider = decoded.to || signer || ''
  const amount0 = decoded.amountA
  const amount1 = decoded.amountB
  const pairSymbol = pairSymbolFromTokens(decoded.tokenA, decoded.tokenB)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'ADD',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: decoded.liquidity,
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

  // Discriminate by ink! string topic; bail on any non-LiquidityRemoved event.
  const raw = labelGuard(event, ['RouterContract::LiquidityRemoved'])
  if (!raw) return

  const decoded = decodeRouterLiquidity(raw.payload)
  if (!decoded) return
  const provider = decoded.to || signer || ''
  const amount0 = decoded.amountA
  const amount1 = decoded.amountB
  const pairSymbol = pairSymbolFromTokens(decoded.tokenA, decoded.tokenB)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = LiquidityEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'REMOVE',
    provider,
    pairSymbol,
    amount0,
    amount1,
    lpTokens: decoded.liquidity,
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

  // Discriminate by ink! string topic; bail on any non-Pair-Swap event.
  const raw = readContractEmitted(event)
  if (!raw || raw.label !== 'PairContract::Swap') return

  const decoded = decodePairSwap(raw.payload)
  if (!decoded) return

  const sender = decoded.sender || signer || ''
  const to = decoded.to || undefined
  const amountIn = decoded.amountIn
  const amountOut = decoded.amountOut

  if (!sender) return

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const swapEvent = SwapEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    contractKind: 'pair',
    trader: sender,
    recipient: to,
    // pair contract address is the emitter; per-pair symbol resolved offline
    pairSymbol: raw.contract.slice(0, 12) + '...',
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

