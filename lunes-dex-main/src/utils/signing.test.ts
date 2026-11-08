import { it, expect, afterEach, vi } from 'vitest'
import {
  buildSpotOrderSignMessage,
  buildWalletActionMessage,
  getSigningContext,
  setSigningChainGenesis
} from './signing'

const GENESIS = `0x${'ab'.repeat(32)}`

afterEach(() => {
  setSigningChainGenesis(null)
  vi.unstubAllEnvs()
})

it('signs canonical values plus TIF and expiry, bound to domain + chain (v3, same vector as the API)', () => {
  setSigningChainGenesis(GENESIS)
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
    `lunex-order-v3:localhost:${GENESIS}:QAX/QUSD:BUY:LIMIT:2:0:1:123456789:1700000000000:FOK:1792346400000`
  )
})

it('wallet action messages carry domain and chain lines (FE-03)', () => {
  setSigningChainGenesis(GENESIS.toUpperCase().replace('0X', '0x'))
  const message = buildWalletActionMessage({
    action: 'orders.cancel',
    address: '5Grwva',
    nonce: 'n1',
    timestamp: 1,
    fields: { orderId: 'o1' }
  })
  expect(message).toBe(
    [
      'lunex-auth:orders.cancel',
      'domain:localhost',
      `chain:${GENESIS}`,
      'address:5Grwva',
      'orderId:o1',
      'nonce:n1',
      'timestamp:1'
    ].join('\n')
  )
})

it('REACT_APP_* env overrides the window host and runtime genesis', () => {
  vi.stubEnv('REACT_APP_SIGNING_DOMAIN', 'Lunex.Lunes.io')
  vi.stubEnv('REACT_APP_LUNES_GENESIS_HASH', GENESIS)
  setSigningChainGenesis(`0x${'cd'.repeat(32)}`)
  expect(getSigningContext()).toEqual({
    domain: 'lunex.lunes.io',
    chain: GENESIS
  })
})
