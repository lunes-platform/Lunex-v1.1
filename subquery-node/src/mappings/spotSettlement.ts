import { SubstrateEvent } from '@subql/types'
import { SpotSettlementEvent } from '../types'
import { makeEventId, safeNum } from './utils'

// ─── spot_settlement: Deposit ──────────────────────────────────────────────
export async function handleSpotDeposit(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const account = String(args.depositor ?? args.account ?? '')
  const token = args.token ? String(args.token) : undefined
  const amount = safeNum(args.amount)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'DEPOSIT',
    account,
    counterparty: undefined,
    token,
    amount,
    pairSymbol: undefined,
    price: undefined,
    size: undefined,
    side: undefined,
    fee: undefined,
  })
  await ev.save()
}

// ─── spot_settlement: Withdraw ─────────────────────────────────────────────
export async function handleSpotWithdraw(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const account = String(args.withdrawer ?? args.account ?? '')
  const token = args.token ? String(args.token) : undefined
  const amount = safeNum(args.amount)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'WITHDRAW',
    account,
    counterparty: undefined,
    token,
    amount,
    pairSymbol: undefined,
    price: undefined,
    size: undefined,
    side: undefined,
    fee: undefined,
  })
  await ev.save()
}

// ─── spot_settlement: Settled ──────────────────────────────────────────────
// Emitted by spot_settlement::settle_trade when a maker/taker pair clears
// on-chain. The contract emits maker + taker as separate parties; the side
// field captures which direction each took.
export async function handleSpotSettled(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  const args = event.event.data.toJSON() as Record<string, unknown>
  const maker = String(args.maker ?? '')
  const taker = String(args.taker ?? '')
  const pairSymbol = args.pair ? String(args.pair) : undefined
  const price = safeNum(args.price)
  const size = safeNum(args.size)
  const side = args.maker_side ? String(args.maker_side) : undefined
  const fee = safeNum(args.fee)

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: event.event.section,
    kind: 'SETTLED',
    account: maker,
    counterparty: taker,
    token: undefined,
    amount: undefined,
    pairSymbol,
    price,
    size,
    side,
    fee,
  })
  await ev.save()
}
