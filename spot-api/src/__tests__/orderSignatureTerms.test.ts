import { buildSpotOrderMessage } from '../middleware/auth';
const order = {
  pairSymbol: 'QAX/QUSD',
  side: 'BUY' as const,
  type: 'LIMIT' as const,
  price: '2',
  amount: '1',
  nonce: '123456789',
  timestamp: 1700000000000,
  timeInForce: 'GTC',
  expiresAt: undefined as string | undefined,
};
it.each(['IOC', 'FOK'])(
  'binds the execution policy %s to the signed order',
  (timeInForce) => {
    const changed = { ...order, timeInForce };
    expect(buildSpotOrderMessage(changed)).not.toBe(
      buildSpotOrderMessage(order),
    );
  },
);
it('binds expiry and prevents removing or extending the deadline', () => {
  const original = { ...order, expiresAt: '2026-10-18T18:00:00.000Z' };
  expect(buildSpotOrderMessage(original)).not.toBe(
    buildSpotOrderMessage(order),
  );
  const extended = { ...original, expiresAt: '2026-10-19T18:00:00.000Z' };
  expect(buildSpotOrderMessage(original)).not.toBe(
    buildSpotOrderMessage(extended),
  );
});
it('uses the same canonical decimals as the persisted numeric order', () => {
  expect(
    buildSpotOrderMessage({ ...order, price: '2.0000', amount: '1.00' }),
  ).toBe(buildSpotOrderMessage(order));
  expect(
    buildSpotOrderMessage({ ...order, price: '2e0', amount: '0.1e1' }),
  ).toBe(buildSpotOrderMessage(order));
});
