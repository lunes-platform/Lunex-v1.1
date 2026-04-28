import { WalletSummary, PairStats, DailyProtocolStats } from '../types'

export function makeEventId(blockNumber: bigint, extrinsicIndex: number, eventIndex: number): string {
  return `${blockNumber}-${extrinsicIndex}-${eventIndex}`
}

export function dateToIsoDate(ts: Date): string {
  return ts.toISOString().slice(0, 10)
}

export function bigFloatZero(): bigint {
  return BigInt(0)
}

export function safeNum(value: unknown): bigint {
  if (value === null || value === undefined) return BigInt(0)
  try {
    const str = String(value).replace(/,/g, '').trim()
    if (!str || str === 'null' || str === 'undefined') return BigInt(0)
    const n = parseFloat(str)
    if (!isFinite(n)) return BigInt(0)
    return BigInt(Math.round(n * 1e12))
  } catch {
    return BigInt(0)
  }
}

export async function getOrCreateWalletSummary(address: string, now: Date): Promise<WalletSummary> {
  let record = await WalletSummary.get(address)
  if (!record) {
    record = WalletSummary.create({
      id: address,
      address,
      totalSwapCount: 0,
      totalSwapVolumeIn: BigInt(0),
      totalSwapVolumeOut: BigInt(0),
      totalLiquidityAdded: BigInt(0),
      totalLiquidityRemoved: BigInt(0),
      totalVaultDeposited: BigInt(0),
      totalVaultWithdrawn: BigInt(0),
      totalTradeCount: 0,
      totalRealizedPnl: BigInt(0),
      winningTrades: 0,
      losingTrades: 0,
      lastActivityAt: now,
      firstActivityAt: now,
    })
  }
  return record
}

export async function getOrCreatePairStats(pairSymbol: string, now: Date): Promise<PairStats> {
  let record = await PairStats.get(pairSymbol)
  if (!record) {
    record = PairStats.create({
      id: pairSymbol,
      pairSymbol,
      swapCount: BigInt(0),
      volumeToken0: BigInt(0),
      volumeToken1: BigInt(0),
      liquidityAddCount: BigInt(0),
      liquidityRemoveCount: BigInt(0),
      lastSwapAt: undefined,
      firstSwapAt: now,
    })
  }
  return record
}

export async function getOrCreateDailyStats(date: string): Promise<DailyProtocolStats> {
  let record = await DailyProtocolStats.get(date)
  if (!record) {
    record = DailyProtocolStats.create({
      id: date,
      date,
      swapCount: BigInt(0),
      swapVolumeUsd: BigInt(0),
      uniqueTraders: 0,
      liquidityEvents: BigInt(0),
      vaultDeposits: BigInt(0),
      vaultWithdrawals: BigInt(0),
      newLeaders: 0,
      activeLeaders: 0,
      newListings: 0,
      totalLunesLocked: BigInt(0),
    })
  }
  return record
}
