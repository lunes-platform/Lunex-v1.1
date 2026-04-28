import { SubstrateEvent } from '@subql/types'
import { VaultEvent, VaultDailyStat } from '../types'
import {
  makeEventId,
  safeNum,
  getOrCreateWalletSummary,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils'

// ── Copy Vault: Deposited ──────────────────────────────────────
export async function handleVaultDeposited(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const actor = String(args.depositor ?? signer ?? '')
  const amountIn = safeNum(args.amount)
  const sharesAmount = safeNum(args.shares_minted)
  const sharePrice = safeNum(args.share_price)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'DEPOSIT',
    vaultAddress: args.vault ? String(args.vault) : undefined,
    actor,
    leader: args.leader ? String(args.leader) : undefined,
    amountIn,
    amountOut: undefined,
    sharesAmount,
    sharePrice,
    pairSymbol: undefined,
    equityAfter: safeNum(args.vault_equity_after),
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

  const args = event.event.data.toJSON() as Record<string, unknown>
  const actor = String(args.depositor ?? signer ?? '')
  const amountOut = safeNum(args.amount_received)
  const sharesAmount = safeNum(args.shares_burned)
  const performanceFee = safeNum(args.performance_fee)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'WITHDRAW',
    vaultAddress: args.vault ? String(args.vault) : undefined,
    actor,
    leader: args.leader ? String(args.leader) : undefined,
    amountIn: undefined,
    amountOut,
    sharesAmount,
    sharePrice: undefined,
    pairSymbol: undefined,
    equityAfter: safeNum(args.vault_equity_after),
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

  const args = event.event.data.toJSON() as Record<string, unknown>
  const leader = String(args.leader ?? signer ?? '')
  const amountIn = safeNum(args.amount)
  const equityAfter = safeNum(args.vault_equity_after)

  const pairBytes = args.pair
  const pairSymbol = decodePairBytes(pairBytes)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'TRADE_EXECUTED',
    vaultAddress: args.vault ? String(args.vault) : undefined,
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
  const vaultAddr = args.vault ? String(args.vault) : event.event.section
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

  const args = event.event.data.toJSON() as Record<string, unknown>
  const vaultAddress = String(args.vault ?? signer ?? '')
  const drawdownBps = safeNum(args.drawdown_bps)
  const equityAfter = safeNum(args.current_equity)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = VaultEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'CIRCUIT_BREAKER',
    vaultAddress,
    actor: vaultAddress,
    leader: undefined,
    amountIn: safeNum(args.current_equity),
    amountOut: safeNum(args.high_water_mark),
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

// ── Helpers ────────────────────────────────────────────────────

function decodePairBytes(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    try {
      const str = String.fromCharCode(...(value as number[]))
      return str.includes('/') ? str : undefined
    } catch {
      return undefined
    }
  }
  if (typeof value === 'string' && value.includes('/')) {
    return value
  }
  return undefined
}
