import { describe, expect, it } from 'vitest'
import { EXTERNAL_LINK_REL, safeExternalUrl, safeImageSrc } from '../safeUrl'

// FE-01: user-controlled URLs (social links, avatars, listing logos…) must
// never reach an href/src with a script-capable scheme.

describe('safeExternalUrl', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'javascript://x.com/%0aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://x.com/a',
    '//evil.com/a',
    '/relative/path',
    'not a url',
    ''
  ])('rejects %j', raw => {
    expect(safeExternalUrl(raw)).toBeUndefined()
  })

  it('rejects undefined / null / non-strings', () => {
    expect(safeExternalUrl(undefined)).toBeUndefined()
    expect(safeExternalUrl(null)).toBeUndefined()
    expect(safeExternalUrl(42 as unknown as string)).toBeUndefined()
  })

  it('accepts https and returns the normalized href', () => {
    expect(safeExternalUrl('https://x.com/lunex')).toBe('https://x.com/lunex')
    expect(safeExternalUrl('  https://t.me/lunex  ')).toBe('https://t.me/lunex')
  })

  it('rejects http unless explicitly allowed (dev only)', () => {
    expect(
      safeExternalUrl('http://x.com/a', undefined, { allowHttp: false })
    ).toBeUndefined()
    expect(
      safeExternalUrl('http://localhost:3000/a', undefined, { allowHttp: true })
    ).toBe('http://localhost:3000/a')
  })

  it('pins the host to the allowlist (exact or subdomain)', () => {
    const hosts = ['x.com', 'twitter.com']
    expect(safeExternalUrl('https://x.com/a', hosts)).toBe('https://x.com/a')
    expect(safeExternalUrl('https://mobile.twitter.com/a', hosts)).toBe(
      'https://mobile.twitter.com/a'
    )
    expect(safeExternalUrl('https://evil.com/x.com', hosts)).toBeUndefined()
    expect(safeExternalUrl('https://evilx.com/a', hosts)).toBeUndefined()
    expect(safeExternalUrl('https://x.com.evil.com/a', hosts)).toBeUndefined()
    expect(safeExternalUrl('https://x.com@evil.com/a', hosts)).toBeUndefined()
  })

  it('rejects embedded credentials (phishing-style user@host)', () => {
    expect(safeExternalUrl('https://user:pw@x.com/a')).toBeUndefined()
  })
})

describe('safeImageSrc', () => {
  it.each([
    'https://cdn.example.com/a.png',
    '/img/lunes-green.svg',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    'blob:https://lunex.lunes.io/1234-5678'
  ])('accepts %j', raw => {
    expect(safeImageSrc(raw, { allowHttp: false })).toBe(raw)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.com/a.png',
    '/\\evil.com/a.png',
    'http://cdn.example.com/a.png',
    'relative.png',
    ''
  ])('rejects %j', raw => {
    expect(safeImageSrc(raw, { allowHttp: false })).toBeUndefined()
  })

  it('accepts http only when allowed (dev)', () => {
    expect(
      safeImageSrc('http://localhost:4000/a.png', { allowHttp: true })
    ).toBe('http://localhost:4000/a.png')
  })
})

describe('EXTERNAL_LINK_REL', () => {
  it('isolates the opener and strips the referrer', () => {
    expect(EXTERNAL_LINK_REL).toBe('noopener noreferrer')
  })
})
