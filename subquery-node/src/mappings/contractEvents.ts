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
