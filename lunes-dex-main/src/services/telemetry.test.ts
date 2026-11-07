import { describe, expect, it, vi } from 'vitest'
import {
  createReporter,
  hashAddress,
  scrubDeep,
  scrubText,
  submitFeedback
} from './telemetry'

const WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'
const SIG = '0x' + 'ab'.repeat(64)

const fakeFetch = () => {
  const calls: { url: string; body: any }[] = []
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ id: 'fb-1' }), { status: 201 })
  })
  return { f: f as unknown as typeof fetch, calls }
}

describe('scrubbing (no PII)', () => {
  it('replaces wallet addresses with a stable short hash', () => {
    const out = scrubText(`balance of ${WALLET} failed`)
    expect(out).not.toContain(WALLET)
    expect(out).toContain(hashAddress(WALLET))
    expect(hashAddress(WALLET)).toMatch(/^addr_[0-9a-f]{8}$/)
    expect(scrubText(WALLET)).toBe(scrubText(WALLET))
  })

  it('redacts signatures, long hex, session tokens and secret query params', () => {
    const out = scrubText(
      `sig ${SIG} auth Bearer lxs1.abc.def url /api?signature=0x12&nonce=99&x=1`
    )
    expect(out).not.toContain(SIG)
    expect(out).not.toContain('lxs1.abc.def')
    expect(out).toContain('signature=[redacted]')
    expect(out).toContain('nonce=[redacted]')
    expect(out).toContain('x=1')
  })

  it('deep-scrubs objects and drops secret-looking keys', () => {
    const out = scrubDeep({
      message: `oops ${WALLET}`,
      extra: { signature: SIG, nested: [WALLET] },
      authorization: 'Bearer x'
    }) as any
    expect(JSON.stringify(out)).not.toContain(WALLET)
    expect(out.extra.signature).toBeUndefined()
    expect(out.authorization).toBeUndefined()
  })
})

describe('reporter (dedup + throttle)', () => {
  it('sends scrubbed payload with app context', () => {
    const { f, calls } = fakeFetch()
    const r = createReporter({ fetchImpl: f, endpoint: '/e', appVersion: '1.2.3', network: 'testnet', page: () => '/swap' })
    const err = new Error(`cannot read ${WALLET}`)
    expect(r.report(err, 'boundary')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ source: 'boundary', appVersion: '1.2.3', network: 'testnet', page: '/swap', count: 1 })
    expect(JSON.stringify(calls[0].body)).not.toContain(WALLET)
  })

  it('deduplicates the same error within the window and aggregates the count', () => {
    let t = 0
    const { f, calls } = fakeFetch()
    const r = createReporter({ fetchImpl: f, endpoint: '/e', now: () => t, dedupWindowMs: 1000 })
    const boom = () => new Error('boom 1')
    r.report(boom(), 'window')
    r.report(boom(), 'window')
    r.report(boom(), 'window')
    expect(calls).toHaveLength(1)
    expect(r.stats().suppressed).toBe(2)
    t = 1500
    r.report(boom(), 'window')
    expect(calls).toHaveLength(2)
    expect(calls[1].body.count).toBe(3)
  })

  it('throttles distinct errors to maxPerMinute', () => {
    const { f, calls } = fakeFetch()
    const r = createReporter({ fetchImpl: f, endpoint: '/e', now: () => 0, maxPerMinute: 3 })
    for (let i = 0; i < 10; i++) r.report(new Error(`err-${String.fromCharCode(97 + i)}`))
    expect(calls).toHaveLength(3)
    expect(r.stats().dropped).toBe(7)
  })

  it('ignores opaque cross-origin and ResizeObserver noise', () => {
    const { f, calls } = fakeFetch()
    const r = createReporter({ fetchImpl: f, endpoint: '/e' })
    expect(r.report('Script error.', 'window')).toBe(false)
    expect(r.report('ResizeObserver loop limit exceeded', 'window')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('never throws when the network fails', () => {
    const r = createReporter({
      endpoint: '/e',
      fetchImpl: (() => {
        throw new Error('offline')
      }) as unknown as typeof fetch
    })
    expect(() => r.report(new Error('x'))).not.toThrow()
  })
})

describe('submitFeedback', () => {
  it('posts category/message and only the wallet the tester chose to attach', async () => {
    const { f, calls } = fakeFetch()
    const res = await submitFeedback({ category: 'BUG', message: '  swap is stuck  ' }, f)
    expect(res).toEqual({ ok: true, id: 'fb-1' })
    expect(calls[0].url).toMatch(/\/api\/v1\/feedback$/)
    expect(calls[0].body.message).toBe('swap is stuck')
    expect(calls[0].body.walletAddress).toBeUndefined()
    await submitFeedback({ category: 'BUG', message: 'with wallet', walletAddress: WALLET }, f)
    expect(calls[1].body.walletAddress).toBe(WALLET)
  })

  it('validates length client-side and maps 429', async () => {
    const { f } = fakeFetch()
    expect((await submitFeedback({ category: 'BUG', message: 'hi' }, f)).ok).toBe(false)
    const limited = vi.fn(async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    const r = await submitFeedback({ category: 'UX', message: 'long enough' }, limited)
    expect(r.ok).toBe(false)
  })
})
