import { it, expect } from 'vitest'
import { buildSpotOrderSignMessage } from './signing'
it('signs canonical values plus TIF and expiry using the same v2 vector as the API', () => {
  const order = {
    pairSymbol: 'QAX/QUSD',
    side: 'BUY' as const,
    type: 'LIMIT' as const,
    price: '2.0000',
    amount: '1e0',
    nonce: '123456789',
    timestamp: 1700000000000,
    timeInForce: 'FOK',
    expiresAt: '2026-10-18T18:00:00.000Z'
  }
  expect(buildSpotOrderSignMessage(order)).toBe(
    'lunex-order-v2:QAX/QUSD:BUY:LIMIT:2:0:1:123456789:1700000000000:FOK:1792346400000'
  )
})
