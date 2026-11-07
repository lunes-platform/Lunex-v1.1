import { describe, expect, it } from 'vitest'
import { faucetNavItems, MORE_NAV } from './nav'

describe('faucet nav item', () => {
  it('is offered on testnet and hidden on mainnet', () => {
    expect(faucetNavItems('testnet').map(i => i.to)).toEqual(['/faucet'])
    expect(faucetNavItems('mainnet')).toEqual([])
  })
  it('is part of the More menu in this (non-mainnet) test build', () => {
    expect(MORE_NAV.some(i => i.key === 'faucet' && i.to === '/faucet')).toBe(true)
  })
})
