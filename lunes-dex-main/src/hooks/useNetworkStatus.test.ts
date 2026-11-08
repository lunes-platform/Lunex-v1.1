import { afterEach, describe, expect, it } from 'vitest'
import {
  isWrongNetwork,
  readNetworkEnv,
  resolveNetworkStatus
} from './useNetworkStatus'

const GENESIS = '0x8fca3505cdb04ad26b28d9429fcefc9cab9a3687c2919ac8b97e7184b12ab192'
const OTHER = '0x' + '11'.repeat(32)

describe('isWrongNetwork', () => {
  it('flags a genesis mismatch (case-insensitive)', () => {
    expect(isWrongNetwork({ genesisHash: OTHER }, { genesisHash: GENESIS })).toBe(true)
    expect(isWrongNetwork({ genesisHash: GENESIS.toUpperCase().replace('0X', '0x') }, { genesisHash: GENESIS })).toBe(false)
  })
  it('flags a chain-name mismatch', () => {
    expect(isWrongNetwork({ chainName: 'Lunes Mainnet' }, { chainName: 'Lunes Testnet' })).toBe(true)
    expect(isWrongNetwork({ chainName: ' lunes testnet ' }, { chainName: 'Lunes Testnet' })).toBe(false)
  })
  it('does not flag anything when no expectation is configured', () => {
    expect(isWrongNetwork({ genesisHash: OTHER, chainName: 'x' }, {})).toBe(false)
  })
})

describe('resolveNetworkStatus', () => {
  it('wrong/degraded take precedence over testnet and maintenance', () => {
    expect(resolveNetworkStatus('wrong', { maintenance: true, network: 'testnet' })).toBe('wrong')
    expect(resolveNetworkStatus('degraded', { maintenance: false, network: 'testnet' })).toBe('degraded')
  })
  it('maintenance, then testnet, then ok', () => {
    expect(resolveNetworkStatus('ok', { maintenance: true, network: 'testnet' })).toBe('maintenance')
    expect(resolveNetworkStatus('ok', { maintenance: false, network: 'testnet' })).toBe('testnet')
    expect(resolveNetworkStatus('ok', { maintenance: false, network: 'mainnet' })).toBe('ok')
  })
  it('QA override wins', () => {
    expect(resolveNetworkStatus('ok', { maintenance: false, network: 'mainnet', forced: 'wrong' })).toBe('wrong')
  })
})

describe('readNetworkEnv (explicit process.env reads — the old import.meta.env read was dead)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  it('reads genesis, chain name and maintenance flag', () => {
    delete process.env.REACT_APP_LUNES_GENESIS_HASH
    process.env.REACT_APP_GENESIS_HASH = GENESIS
    process.env.REACT_APP_CHAIN_NAME = 'Lunes Testnet'
    process.env.REACT_APP_MAINTENANCE = 'true'
    expect(readNetworkEnv()).toEqual({ genesisHash: GENESIS, chainName: 'Lunes Testnet', maintenance: true })
  })
  it('REACT_APP_LUNES_GENESIS_HASH (used by signing) is the primary source', () => {
    process.env.REACT_APP_LUNES_GENESIS_HASH = GENESIS
    process.env.REACT_APP_GENESIS_HASH = OTHER
    expect(readNetworkEnv().genesisHash).toBe(GENESIS)
  })
  it('unset vars disable the checks', () => {
    delete process.env.REACT_APP_LUNES_GENESIS_HASH
    delete process.env.REACT_APP_GENESIS_HASH
    delete process.env.REACT_APP_CHAIN_NAME
    delete process.env.REACT_APP_MAINTENANCE
    expect(readNetworkEnv()).toEqual({ genesisHash: undefined, chainName: undefined, maintenance: false })
  })
})
