import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../context/SDKContext', () => ({ useSDK: () => ({ walletAddress: WALLET }) }))
vi.mock('react-helmet-async', () => ({ Helmet: () => null }))
const WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'

import { fetchFaucetConfig, requestDrip } from './faucetClient'
import { FaucetPage } from './index'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('faucetClient', () => {
  it('POSTs address + captcha token and maps a finalized success', async () => {
    const f = vi.fn(async () =>
      json(200, { success: true, sent: [{ symbol: 'LUNES', amount: '10000' }], skipped: [], blockHash: '0xabc' })
    )
    const r = await requestDrip({ address: WALLET, captchaToken: 'tok' }, 'http://faucet', f as any)
    expect(r).toEqual({ kind: 'success', sent: [{ symbol: 'LUNES', amount: '10000' }], skipped: [], blockHash: '0xabc' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://faucet/faucet')
    expect(JSON.parse(String(init.body))).toEqual({ address: WALLET, captchaToken: 'tok' })
  })

  it('maps 429 cooldown, 202 pending and network errors', async () => {
    const limited = vi.fn(async () => json(429, { error: 'Try again in 4h', code: 'ADDRESS_COOLDOWN', retryAfterMs: 60000 }))
    expect(await requestDrip({ address: WALLET }, 'http://f', limited as any)).toMatchObject({
      kind: 'error',
      code: 'ADDRESS_COOLDOWN',
      retryAfterMs: 60000
    })
    const pending = vi.fn(async () => json(202, { pending: true, txHash: '0x1' }))
    expect((await requestDrip({ address: WALLET }, 'http://f', pending as any)).kind).toBe('pending')
    const down = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await requestDrip({ address: WALLET }, 'http://f', down as any)).toMatchObject({ kind: 'error', code: 'NETWORK' })
  })

  it('rejects malformed addresses and missing configuration without calling the faucet', async () => {
    const f = vi.fn()
    expect((await requestDrip({ address: 'abc' }, 'http://f', f as any)).kind).toBe('error')
    expect((await requestDrip({ address: WALLET }, '', f as any)).kind).toBe('error')
    expect(f).not.toHaveBeenCalled()
    expect(await fetchFaucetConfig('', f as any)).toBeNull()
  })
})

describe('FaucetPage', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('prefills the connected wallet and shows amounts from the faucet config (not hard-coded)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, {
          network: 'Lunes Testnet',
          native: { symbol: 'LUNES', amount: '1234' },
          tokens: [{ symbol: 'LUSDT', address: 'x', amount: '55' }],
          cooldownMinutes: 300,
          ipMaxPerWindow: 3,
          ipWindowMinutes: 1440,
          captcha: { required: false, provider: 'turnstile', siteKey: null }
        })
      )
    )
    await act(async () => root.render(<FaucetPage network="testnet" faucetUrl="http://faucet" />))
    await act(async () => undefined)
    expect((container.querySelector('#faucet-address') as HTMLInputElement).value).toBe(WALLET)
    expect(container.textContent).toContain('1234 LUNES')
    expect(container.textContent).toContain('55 LUSDT')
    expect(container.textContent).toMatch(/no\s+monetary value/i)
  })

  it('renders nothing actionable on mainnet', async () => {
    await act(async () => root.render(<FaucetPage network="mainnet" faucetUrl="http://faucet" />))
    expect(container.textContent).toMatch(/only available on testnet/i)
    expect(container.querySelector('#faucet-address')).toBeNull()
  })

  it('warns when REACT_APP_FAUCET_URL is not configured', async () => {
    await act(async () => root.render(<FaucetPage network="testnet" faucetUrl="" />))
    expect(container.textContent).toMatch(/not configured/i)
  })
})
