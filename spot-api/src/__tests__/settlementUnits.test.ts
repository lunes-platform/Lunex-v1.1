import { toSettlementPriceUnits } from '../utils/settlementUnits';

it.each([
  [8, 6, '2', '2000000'],
  [8, 8, '2', '200000000'],
  [6, 8, '2', '20000000000'],
  [8, 6, '0.123456', '123456'],
  [8, 6, '1.23456e-1', '123456'],
  [8, 6, '2.000000', '2000000'],
  [18, 6, '20000', '2'],
])(
  'encodes %s/%s decimals price %s as the contract ratio',
  (baseDecimals, quoteDecimals, price, expected) => {
    expect(
      toSettlementPriceUnits(price as string, {
        baseDecimals: baseDecimals as number,
        quoteDecimals: quoteDecimals as number,
      }),
    ).toBe(expected);
  },
);
it('settles one 8-decimal base token at 2 units of a 6-decimal quote token', () => {
  const rawPrice = BigInt(
    toSettlementPriceUnits('2', { baseDecimals: 8, quoteDecimals: 6 }),
  );
  expect((100000000n * rawPrice) / 100000000n).toBe(2000000n);
});
it('does not guess decimals for a pre-existing incomplete snapshot', () => {
  expect(() => toSettlementPriceUnits('2', { baseDecimals: 8 })).toThrow(
    'Missing quote decimals',
  );
});
it('rejects a price whose raw ratio would be rounded', () => {
  expect(() =>
    toSettlementPriceUnits('2', { baseDecimals: 18, quoteDecimals: 6 }),
  ).toThrow('represented exactly');
});
it('rejects overflow instead of silently losing precision', () => {
  expect(() =>
    toSettlementPriceUnits('1e40', { baseDecimals: 8, quoteDecimals: 8 }),
  ).toThrow('exceeds u128');
});
