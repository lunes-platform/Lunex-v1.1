/**
 * M-09 (third pass) — address helpers every reader/writer relies on. One
 * account is one identity whatever encoding a client or a legacy row uses:
 * prefix 42 (canonical), 57 (Lunes), 0 (Polkadot), lower/upper-case hex.
 */
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import {
  accountAddressFilter,
  accountAddressVariants,
  isSameAccount,
  signedAddressFor,
} from '../../utils/validation';

// Alice in every encoding the API accepts.
const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PUBLIC_KEY = decodeAddress(GENERIC);
const LUNES = encodeAddress(PUBLIC_KEY, 57);
const POLKADOT = encodeAddress(PUBLIC_KEY, 0);
const HEX_LOWER = u8aToHex(PUBLIC_KEY);
const HEX_UPPER = `0x${HEX_LOWER.slice(2).toUpperCase()}`;
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const ENCODINGS: Array<[string, string]> = [
  ['prefix 42', GENERIC],
  ['prefix 57', LUNES],
  ['prefix 0', POLKADOT],
  ['lower-case hex', HEX_LOWER],
  ['upper-case hex', HEX_UPPER],
];

describe('accountAddressVariants', () => {
  it('returns the canonical input followed by the Lunes encoding', () => {
    expect(accountAddressVariants(GENERIC)).toEqual([GENERIC, LUNES]);
  });

  it('a prefix-57 input is not repeated', () => {
    expect(accountAddressVariants(LUNES)).toEqual([LUNES, GENERIC]);
  });

  it.each(ENCODINGS.slice(2))(
    'keeps the raw %s string first, then 42 and 57',
    (_label, raw) => {
      expect(accountAddressVariants(raw)).toEqual([raw, GENERIC, LUNES]);
    },
  );

  it('an undecodable input yields only itself', () => {
    expect(accountAddressVariants('legacy-raw')).toEqual(['legacy-raw']);
    expect(accountAddressVariants('0x1234')).toEqual(['0x1234']);
  });
});

describe('accountAddressFilter', () => {
  it.each(ENCODINGS)('%s matches its raw string plus 42 and 57', (_l, raw) => {
    expect(accountAddressFilter(raw)).toEqual({
      in: accountAddressVariants(raw),
    });
  });

  it('an undecodable input stays a plain equality filter', () => {
    expect(accountAddressFilter('wallet-1')).toBe('wallet-1');
  });
});

describe('signedAddressFor', () => {
  it.each(ENCODINGS)(
    'keeps the %s string the client signed when it is the same account',
    (_label, raw) => {
      expect(signedAddressFor(raw, GENERIC)).toBe(raw);
      expect(isSameAccount(raw, GENERIC)).toBe(true);
    },
  );

  it('falls back to the canonical address for another account', () => {
    expect(signedAddressFor(OTHER, GENERIC)).toBe(GENERIC);
  });

  it.each([
    ['missing', undefined],
    ['array', [LUNES, OTHER]],
    ['number', 42],
    ['undecodable', 'not-an-address'],
  ])('falls back to the canonical address (%s)', (_label, raw) => {
    expect(signedAddressFor(raw, GENERIC)).toBe(GENERIC);
  });
});
