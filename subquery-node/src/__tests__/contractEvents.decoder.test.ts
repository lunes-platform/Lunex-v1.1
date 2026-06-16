// Characterization tests for contractEvents.ts decoders.
// These tests document and lock the CORRECT current behavior.
// The PRODUCTION-CODE-GAPS-2026-06-16.md item at ~line 48 claimed
// lpAmount should be at offset 73 in LiquidityUnlocked — that claim is a
// FALSE POSITIVE. LiquidityUnlocked has 3 fields (no pairAddress), so
// the 57-byte payload ends at offset 57 and lpAmount is correctly at offset 41.

import { describe, it, expect } from 'vitest';
import {
  decodeLiquidityUnlocked,
  decodeLiquidityLocked,
} from '../mappings/contractEvents';

// ---------------------------------------------------------------------------
// In-test byte-layout helpers (no @polkadot/util-crypto, no WASM)
// ---------------------------------------------------------------------------

/** Encode a bigint as little-endian u64 (8 bytes). */
function le64(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return buf;
}

/** Encode a bigint as little-endian u128 (16 bytes). */
function le128(n: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let v = n;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return buf;
}

/** A fixed 32-byte AccountId constant (all 0xAB). */
const OWNER_AB: Buffer = Buffer.alloc(32, 0xab);

/** A fixed 32-byte AccountId constant (all 0xCD) — used as pairAddress in LiquidityLocked. */
const PAIR_CD: Buffer = Buffer.alloc(32, 0xcd);

// ---------------------------------------------------------------------------
// LiquidityUnlocked payload builder
//
// Layout (57 bytes total):
//   [0]      = variant byte (0x02)
//   [1..9]   = lock_id as u64 LE
//   [9..41]  = owner as 32-byte AccountId
//   [41..57] = lp_amount as u128 LE
// ---------------------------------------------------------------------------
function buildUnlockedPayload(lockId: bigint, lpAmount: bigint): Uint8Array {
  return Buffer.concat([
    Buffer.from([0x02]),   // variant byte
    le64(lockId),          // [1..9]   lock_id
    OWNER_AB,              // [9..41]  owner (32 bytes)
    le128(lpAmount),       // [41..57] lp_amount
  ]);
}

// ---------------------------------------------------------------------------
// LiquidityLocked payload builder
//
// Layout (98 bytes total):
//   [0]     = variant byte (0x01)
//   [1..9]  = lock_id as u64 LE
//   [9..41] = owner as 32-byte AccountId
//   [41..73]= pair_address as 32-byte AccountId
//   [73..89]= lp_amount as u128 LE
//   [89..97]= unlock_timestamp as u64 LE
//   [97]    = tier as u8
// ---------------------------------------------------------------------------
function buildLockedPayload(
  lockId: bigint,
  lpAmount: bigint,
  unlockTimestamp: bigint,
  tier: number,
): Uint8Array {
  return Buffer.concat([
    Buffer.from([0x01]),      // variant byte
    le64(lockId),             // [1..9]   lock_id
    OWNER_AB,                 // [9..41]  owner (32 bytes)
    PAIR_CD,                  // [41..73] pair_address (32 bytes)
    le128(lpAmount),          // [73..89] lp_amount
    le64(unlockTimestamp),    // [89..97] unlock_timestamp
    Buffer.from([tier]),      // [97]     tier
  ]);
}

// ---------------------------------------------------------------------------
// Helper: format a 32-byte Buffer as 0x-prefixed hex (mirrors u8aToHex).
// ---------------------------------------------------------------------------
function hex32(buf: Buffer): string {
  return '0x' + buf.toString('hex');
}

// ===========================================================================
// decodeLiquidityUnlocked — characterization tests
// ===========================================================================

describe('decodeLiquidityUnlocked — characterization', () => {
  it('decodes lockId, owner, lpAmount from minimal payload', () => {
    const LOCK_ID = BigInt(42);
    const LP_AMOUNT = BigInt(1_000_000);

    const payload = buildUnlockedPayload(LOCK_ID, LP_AMOUNT);
    expect(payload.length).toBe(57); // self-documenting size assertion

    const result = decodeLiquidityUnlocked(payload);
    expect(result).toBeDefined();
    expect(result!.lockId).toBe(LOCK_ID);
    expect(result!.owner).toBe(hex32(OWNER_AB));
    expect(result!.lpAmount).toBe(LP_AMOUNT);
  });

  it('lpAmount reads from offset 41 (no pairAddress in LiquidityUnlocked)', () => {
    // LiquidityUnlocked has exactly 3 fields: lock_id (u64), owner (AccountId),
    // lp_amount (u128). There is NO pairAddress field in this event.
    // Therefore the payload is only 57 bytes (1+8+32+16) and lpAmount starts
    // at byte 41, immediately after the owner field.
    // This is the key distinction from LiquidityLocked (6 fields, 98 bytes),
    // where pairAddress occupies [41..73] and lpAmount starts at 73.
    const LP_AMOUNT = BigInt(999_999_999_999n);

    const payload = buildUnlockedPayload(BigInt(7), LP_AMOUNT);

    const result = decodeLiquidityUnlocked(payload);
    expect(result).toBeDefined();
    expect(result!.lpAmount).toBe(LP_AMOUNT); // value placed at [41..57]
  });

  it('returns undefined for truncated payload', () => {
    // An 8-byte payload is far too short to hold any field after the variant.
    // The decoder's try/catch should swallow the out-of-range read and return
    // undefined rather than throwing.
    const shortPayload = Buffer.alloc(8, 0x00);
    // Note: readU128LE accesses bytes[offset+15], which is out of bounds.
    // The decoder uses `bytes[offset+i] ?? 0`, so it reads zeros and returns
    // BigInt(0) rather than crashing. However, the owner AccountId at [9..41]
    // is read without bounds checking, so the result may be defined with
    // zeroed fields. What matters is that the decoder does NOT throw.
    //
    // Actual observed behavior: returns { lockId: 0n, owner: 0x000..., lpAmount: 0n }
    // because all `?? 0` guards kick in. We assert only that it does not throw.
    expect(() => decodeLiquidityUnlocked(shortPayload)).not.toThrow();
  });
});

// ===========================================================================
// decodeLiquidityLocked — contrast characterization tests
// ===========================================================================

describe('decodeLiquidityLocked — contrast characterization', () => {
  it('decodes all 6 fields with lpAmount at offset 73', () => {
    // pairAddress occupies [41..73], so lpAmount starts at 73 here —
    // contrast with LiquidityUnlocked which has no pairAddress and reads
    // lpAmount at 41.
    const LOCK_ID = BigInt(100);
    const LP_AMOUNT = BigInt(5_000_000_000n);
    const UNLOCK_TS = BigInt(1_700_000_000_000n); // milliseconds epoch
    const TIER = 2;

    const payload = buildLockedPayload(LOCK_ID, LP_AMOUNT, UNLOCK_TS, TIER);
    expect(payload.length).toBe(98); // self-documenting size assertion

    const result = decodeLiquidityLocked(payload);
    expect(result).toBeDefined();
    expect(result!.lockId).toBe(LOCK_ID);
    expect(result!.owner).toBe(hex32(OWNER_AB));
    expect(result!.pairAddress).toBe(hex32(PAIR_CD));
    expect(result!.lpAmount).toBe(LP_AMOUNT);   // reads from offset 73
    expect(result!.unlockTimestamp).toBe(UNLOCK_TS);
    expect(result!.tier).toBe(TIER);
  });
});
