import { SubstrateEvent } from '@subql/types'
import { VaultEvent, VaultDailyStat } from '../types'
import {
  makeEventId,
  getOrCreateWalletSummary,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'
import {
  labelGuard,
  decodeVaultDeposited,
  decodeVaultWithdrawn,
  decodeVaultTrade,
  decodeVaultCircuitBreaker,
} from './contractEvents'

// ── Copy Vault: Deposited ──────────────────────────────────────
export async function handleVaultDeposited(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-Deposited event.
  const raw = labelGuard(event, ['CopyVault::Deposited'])
  if (!raw) return

  const decoded = decodeVaultDeposited(raw.payload)
  if (!decoded) return
  const actor = decoded.depositor || signer || ''
  const amountIn = decoded.amount
  const sharesAmount = decoded.sharesMinted
  const sharePrice = decoded.sharePrice

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'DEPOSIT',
    vaultAddress: raw.contract,
    actor,
    leader: undefined,
    amountIn,
    amountOut: undefined,
    sharesAmount,
    sharePrice,
    pairSymbol: undefined,
    equityAfter: undefined,
    performanceFee: undefined,
    drawdownBps: undefined,
  })

  await ev.save()

  const wallet = await getOrCreateWalletSummary(actor, timestamp)
  wallet.totalVaultDeposited += amountIn
  wallet.lastActivityAt = timestamp
  await wallet.save()

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.vaultDeposits += amountIn
  await day.save()
}

// ── Copy Vault: Withdrawn ──────────────────────────────────────
export async function handleVaultWithdrawn(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-Withdrawn event.
  const raw = labelGuard(event, ['CopyVault::Withdrawn'])
  if (!raw) return

  const decoded = decodeVaultWithdrawn(raw.payload)
  if (!decoded) return
  const actor = decoded.depositor || signer || ''
  const amountOut = decoded.amountReceived
  const sharesAmount = decoded.sharesBurned
  const performanceFee = decoded.performanceFee

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'WITHDRAW',
    vaultAddress: raw.contract,
    actor,
    leader: undefined,
    amountIn: undefined,
    amountOut,
    sharesAmount,
    sharePrice: undefined,
    pairSymbol: undefined,
    equityAfter: undefined,
    performanceFee,
    drawdownBps: undefined,
  })

  await ev.save()

  const wallet = await getOrCreateWalletSummary(actor, timestamp)
  wallet.totalVaultWithdrawn += amountOut
  wallet.lastActivityAt = timestamp
  await wallet.save()

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp))
  day.vaultWithdrawals += amountOut
  await day.save()
}

// ── Copy Vault: TradeExecuted ──────────────────────────────────
export async function handleVaultTradeExecuted(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-TradeExecuted event.
  const raw = labelGuard(event, ['CopyVault::TradeExecuted'])
  if (!raw) return

  const decoded = decodeVaultTrade(raw.payload)
  if (!decoded) return
  const leader = decoded.leader || signer || ''
  const amountIn = decoded.amount
  const equityAfter = decoded.vaultEquityAfter
  const pairSymbol = decoded.pair && decoded.pair.includes('/') ? decoded.pair : undefined

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'TRADE_EXECUTED',
    vaultAddress: raw.contract,
    actor: leader,
    leader,
    amountIn,
    amountOut: equityAfter,
    sharesAmount: undefined,
    sharePrice: undefined,
    pairSymbol,
    equityAfter,
    performanceFee: undefined,
    drawdownBps: undefined,
  })

  await ev.save()

  // ── VaultDailyStat: aggregate per-vault per-day ──────────────
  const vaultAddr = raw.contract
  const dayStr = dateToIsoDate(timestamp)
  const statId = `${vaultAddr}_${dayStr}`
  let stat = await VaultDailyStat.get(statId)
  if (!stat) {
    stat = VaultDailyStat.create({
      id: statId,
      vaultAddress: vaultAddr,
      leader,
      date: dayStr,
      tradeCount: 0,
      volumeIn: BigInt(0),
      equityEnd: BigInt(0),
      drawdownBps: undefined,
      lastTradeAt: timestamp,
    })
  }
  stat.tradeCount += 1
  stat.volumeIn   += amountIn
  stat.equityEnd   = equityAfter
  stat.lastTradeAt = timestamp
  await stat.save()

  const wallet = await getOrCreateWalletSummary(leader, timestamp)
  wallet.lastActivityAt = timestamp
  await wallet.save()
}

// ── Copy Vault: CircuitBreakerTriggered ────────────────────────
export async function handleVaultCircuitBreaker(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-CircuitBreaker event.
  const raw = labelGuard(event, ['CopyVault::CircuitBreakerTriggered'])
  if (!raw) return

  const decoded = decodeVaultCircuitBreaker(raw.payload)
  if (!decoded) return
  const vaultAddress = decoded.vault || signer || ''
  const drawdownBps = decoded.drawdownBps
  const equityAfter = decoded.currentEquity

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'CIRCUIT_BREAKER',
    vaultAddress,
    actor: vaultAddress,
    leader: undefined,
    amountIn: decoded.currentEquity,
    amountOut: decoded.highWaterMark,
    sharesAmount: undefined,
    sharePrice: undefined,
    pairSymbol: undefined,
    equityAfter,
    performanceFee: undefined,
    drawdownBps,
  })

  await ev.save()

  // ── VaultDailyStat: record max drawdown seen today ────────────
  const dayStr = dateToIsoDate(timestamp)
  const statId = `${vaultAddress}_${dayStr}`
  let stat = await VaultDailyStat.get(statId)
  if (!stat) {
    stat = VaultDailyStat.create({
      id: statId,
      vaultAddress,
      leader: undefined,
      date: dayStr,
      tradeCount: 0,
      volumeIn: BigInt(0),
      equityEnd: equityAfter,
      drawdownBps,
      lastTradeAt: timestamp,
    })
  } else {
    // Keep the largest drawdown seen today
    if (!stat.drawdownBps || drawdownBps > stat.drawdownBps) {
      stat.drawdownBps = drawdownBps
    }
    stat.equityEnd = equityAfter
  }
  await stat.save()
}

