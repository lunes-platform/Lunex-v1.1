import { describe, expect, it } from 'vitest'
import { resolveSpotWsUrl } from './spotService'

describe('resolveSpotWsUrl', () => {
  it('uses REACT_APP_SPOT_WS_URL verbatim when set', () => {
    expect(
      resolveSpotWsUrl('wss://ws.lunex.example/ws', 'https://api.lunex.example')
    ).toBe('wss://ws.lunex.example/ws')
  })

  it('derives the nginx /ws route from a public https API URL', () => {
    expect(resolveSpotWsUrl('', 'https://testnet.lunex.example')).toBe(
      'wss://testnet.lunex.example/ws'
    )
    expect(resolveSpotWsUrl(undefined, 'https://lunex.example/')).toBe(
      'wss://lunex.example/ws'
    )
  })

  it('maps the local dev API (:4000) to the dev WS port (:4001)', () => {
    expect(resolveSpotWsUrl(undefined, 'http://localhost:4000')).toBe(
      'ws://localhost:4001'
    )
    expect(resolveSpotWsUrl('  ', 'http://127.0.0.1:4000')).toBe(
      'ws://127.0.0.1:4001'
    )
  })

  it('never yields a hardcoded localhost for a remote API', () => {
    const ws = resolveSpotWsUrl(undefined, 'https://api.lunex.example')
    expect(ws).not.toContain('localhost')
  })
})
