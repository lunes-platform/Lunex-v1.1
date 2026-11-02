import {
  readContractBalance,
  readContractBoolean,
} from '../utils/contractResult';

const output = (value: unknown) => ({
  toJSON: () => value,
  toString: () => JSON.stringify(value),
});

it('reads a funded vault balance from the ink4 MessageResult', () => {
  expect(readContractBalance(output({ ok: 50000000000 }))).toBe(50000000000n);
});
it('preserves large integer precision and nested Result envelopes', () => {
  expect(
    readContractBalance(
      output({ Ok: { ok: '0xffffffffffffffffffffffffffffffff' } }),
    ),
  ).toBe((1n << 128n) - 1n);
});
it.each([true, false])('reads the on-chain nonce flag %s', (flag) => {
  expect(readContractBoolean(output({ ok: flag }))).toBe(flag);
});
it('supports scalar output from older ABI codecs', () => {
  expect(readContractBalance({ toString: () => '123' })).toBe(123n);
  expect(readContractBoolean({ toString: () => 'true' })).toBe(true);
});
it.each([
  { err: 'Unavailable' },
  { ok: { err: 'NotFound' } },
  { ok: null },
  { ok: { unexpected: true } },
  { ok: '' },
])(
  'does not turn an invalid query into an available balance or unused nonce: %j',
  (value) => {
    expect(() => readContractBalance(output(value))).toThrow();
    expect(() => readContractBoolean(output(value))).toThrow();
  },
);
it('rejects unsafe numeric balances instead of silently rounding funds', () => {
  expect(() =>
    readContractBalance(output({ ok: Number.MAX_SAFE_INTEGER + 1 })),
  ).toThrow('Invalid contract balance');
});
