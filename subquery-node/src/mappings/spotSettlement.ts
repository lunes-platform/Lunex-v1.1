import { SubstrateEvent } from '@subql/types'
import { SpotSettlementEvent } from '../types'
import { makeEventId } from './utils'
import {
  labelGuard,
  decodeSpotTransfer,
  decodeTradeSettled,
  pairSymbolFromTokens,
} from './contractEvents'

// ─── spot_settlement: Deposit ──────────────────────────────────────────────
export async function handleSpotDeposit(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event
  const blockNumber = BigInt(block.block.header.number.toString())
  const timestamp = block.timestamp ?? new Date()
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined

  // Discriminate by ink! string topic; bail on any non-Deposit event.
  const raw = labelGuard(event, [
    'SpotSettlement::DepositNative',
    'SpotSettlement::DepositPSP22',
  ])
  if (!raw) return

  const decoded = decodeSpotTransfer(raw.payload, raw.label.endsWith('PSP22'))
  if (!decoded) return
  const account = decoded.user
  const token = decoded.token
  const amount = decoded.amount

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
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

  // Discriminate by ink! string topic; bail on any non-Withdraw event.
  const raw = labelGuard(event, [
    'SpotSettlement::WithdrawNative',
    'SpotSettlement::WithdrawPSP22',
  ])
  if (!raw) return

  const decoded = decodeSpotTransfer(raw.payload, raw.label.endsWith('PSP22'))
  if (!decoded) return
  const account = decoded.user
  const token = decoded.token
  const amount = decoded.amount

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
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

  // Discriminate by ink! string topic; bail on any non-TradeSettled event.
  const raw = labelGuard(event, ['SpotSettlement::TradeSettled'])
  if (!raw) return

  const decoded = decodeTradeSettled(raw.payload)
  if (!decoded) return
  const maker = decoded.maker
  const taker = decoded.taker
  const pairSymbol = pairSymbolFromTokens(decoded.baseToken, decoded.quoteToken)
  const price = decoded.price
  const size = decoded.amount

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx)

  const ev = SpotSettlementEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'SETTLED',
    account: maker,
    counterparty: taker,
    token: decoded.baseToken,
    amount: decoded.amount,
    pairSymbol,
    price,
    size,
    side: undefined,
    fee: undefined,
  })
  await ev.save()
}
