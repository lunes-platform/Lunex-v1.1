import {
  blake2AsU8a,
  cryptoWaitReady,
  secp256k1Compress,
} from '@polkadot/util-crypto';
import { TypeRegistry } from '@polkadot/types';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  buildOrderMessageV2,
  buildAttestationHash,
  attestorKeypairFromSeed,
  attestOrder,
} from '../services/settlementService';

const registry = new TypeRegistry();

// A second, independent address used as the base/quote token AccountId.
const MAKER = '5EEPvb1Nern92UPMQfoQx74UxJAJfPrmsKiXsweAWiYQiar7';
const BASE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // //Alice
const QUOTE = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'; // //Bob

function order(over: Partial<Record<string, unknown>> = {}) {
  return {
    maker: registry.createType('AccountId', MAKER),
    base_token: registry.createType('AccountId', BASE),
    quote_token: registry.createType('AccountId', QUOTE),
    side: 0,
    price: '123456789',
    amount: '1000000000000',
    nonce: '1700000000001',
    expiry: '1893456000000',
    signature: [],
    ...over,
  } as Parameters<typeof buildOrderMessageV2>[0];
}

describe('settlement attestor (ECDSA, ADR-001 option c)', () => {
  beforeAll(async () => {
    await cryptoWaitReady();
  });

  it('builds the v2 order message byte-for-byte matching the contract layout', () => {
    const o = order();
    const msg = buildOrderMessageV2(o);

    // PREFIX_V2 (20) + maker(32) + base(32) + quote(32) + side(1)
    //   + price u128(16) + amount u128(16) + nonce u64(8) + expiry u64(8) = 165
    expect(msg.length).toBe(165);

    const prefix = Buffer.from(msg.slice(0, 20)).toString('latin1');
    expect(prefix).toBe('lunex:v2:spot-order\n');

    // maker / base / quote occupy the next three 32-byte slots, verbatim.
    expect(Buffer.from(msg.slice(20, 52))).toEqual(
      Buffer.from(o.maker.toU8a()),
    );
    expect(Buffer.from(msg.slice(52, 84))).toEqual(
      Buffer.from(o.base_token.toU8a()),
    );
    expect(Buffer.from(msg.slice(84, 116))).toEqual(
      Buffer.from(o.quote_token.toU8a()),
    );

    // side byte
    expect(msg[116]).toBe(0);

    // price: u128 little-endian
    const price = Buffer.from(msg.slice(117, 133));
    let priceVal = 0n;
    for (let i = 15; i >= 0; i -= 1) priceVal = (priceVal << 8n) | BigInt(price[i]);
    expect(priceVal).toBe(123456789n);

    // amount: u128 little-endian
    const amount = Buffer.from(msg.slice(133, 149));
    let amountVal = 0n;
    for (let i = 15; i >= 0; i -= 1)
      amountVal = (amountVal << 8n) | BigInt(amount[i]);
    expect(amountVal).toBe(1000000000000n);

    // nonce: u64 little-endian
    const nonce = Buffer.from(msg.slice(149, 157));
    let nonceVal = 0n;
    for (let i = 7; i >= 0; i -= 1) nonceVal = (nonceVal << 8n) | BigInt(nonce[i]);
    expect(nonceVal).toBe(1700000000001n);

    // expiry: u64 little-endian
    const expiry = Buffer.from(msg.slice(157, 165));
    let expiryVal = 0n;
    for (let i = 7; i >= 0; i -= 1)
      expiryVal = (expiryVal << 8n) | BigInt(expiry[i]);
    expect(expiryVal).toBe(1893456000000n);
  });

  it('excludes filled_amount from the signed message (on-chain storage is canonical)', () => {
    // filled_amount is not a field of OnChainSignedOrder consumed by the
    // builder; the message length is fixed at 165 regardless of fills.
    expect(buildOrderMessageV2(order()).length).toBe(165);
  });

  it('hashes the message with blake2_256 (32 bytes)', () => {
    const o = order();
    const hash = buildAttestationHash(o);
    expect(hash.length).toBe(32);
    expect(Buffer.from(hash)).toEqual(
      Buffer.from(blake2AsU8a(buildOrderMessageV2(o), 256)),
    );
  });

  it('produces a 65-byte recoverable attestation whose pubkey matches the attestor key', () => {
    const seed = blake2AsU8a('attestor-unit-seed', 256);
    const { secretKey, publicKeyCompressed } = attestorKeypairFromSeed(seed);
    expect(publicKeyCompressed.length).toBe(33);

    const o = order();
    const attestation = attestOrder(o, secretKey);
    expect(attestation).toHaveLength(65);

    // Independently recover the pubkey from (attestation, hash) exactly as the
    // contract's ecdsa_recover does, and confirm it equals attestor_pubkey.
    const hash = buildAttestationHash(o);
    const r = BigInt('0x' + Buffer.from(attestation.slice(0, 32)).toString('hex'));
    const s = BigInt('0x' + Buffer.from(attestation.slice(32, 64)).toString('hex'));
    const v = attestation[64];
    expect([0, 1, 27, 28]).toContain(v);
    const recovered = new secp256k1.Signature(r, s, v % 2)
      .recoverPublicKey(Uint8Array.from(hash))
      .toRawBytes(true);

    expect(Buffer.from(recovered)).toEqual(
      Buffer.from(publicKeyCompressed),
    );
  });

  it('a tampered field yields a different hash so the attestation no longer recovers the key', () => {
    const seed = blake2AsU8a('attestor-unit-seed', 256);
    const { secretKey, publicKeyCompressed } = attestorKeypairFromSeed(seed);

    const o = order();
    const attestation = attestOrder(o, secretKey);

    // Attest over the original order, then verify against a tampered order
    // (amount changed) — recovery must NOT match the attestor pubkey, which
    // is exactly the on-chain AttestationInvalid revert path.
    const tamperedHash = buildAttestationHash(order({ amount: '999' }));
    const r = BigInt('0x' + Buffer.from(attestation.slice(0, 32)).toString('hex'));
    const s = BigInt('0x' + Buffer.from(attestation.slice(32, 64)).toString('hex'));
    const v = attestation[64];
    const recovered = new secp256k1.Signature(r, s, v % 2)
      .recoverPublicKey(Uint8Array.from(tamperedHash))
      .toRawBytes(true);

    expect(Buffer.from(recovered)).not.toEqual(
      Buffer.from(publicKeyCompressed),
    );
  });

  it('different attestor seeds produce different pubkeys (key isolation)', () => {
    const a = attestorKeypairFromSeed(blake2AsU8a('seed-a', 256));
    const b = attestorKeypairFromSeed(blake2AsU8a('seed-b', 256));
    expect(Buffer.from(a.publicKeyCompressed)).not.toEqual(
      Buffer.from(b.publicKeyCompressed),
    );
    // sanity: compress is idempotent / 33 bytes
    expect(secp256k1Compress(a.publicKeyCompressed).length).toBe(33);
  });
});
