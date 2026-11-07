/**
 * Cloudflare Turnstile widget (explicit render). The script is injected once,
 * on demand, from https://challenges.cloudflare.com — CSP must allow that
 * origin in script-src and frame-src.
 */
import React, { useEffect, useImperativeHandle, useRef } from 'react'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loading: Promise<TurnstileApi> | null = null

export const loadTurnstile = (doc: Document = document): Promise<TurnstileApi> => {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = doc.createElement('script')
    s.src = TURNSTILE_SRC
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => {
      loading = null
      reject(new Error('turnstile failed to load'))
    }
    doc.head.appendChild(s)
  })
  return loading
}

export type TurnstileHandle = { reset: () => void }

export const Turnstile = React.forwardRef<
  TurnstileHandle,
  { siteKey: string; onToken: (token: string | null) => void; onError?: () => void }
>(({ siteKey, onToken, onError }, ref) => {
  const el = useRef<HTMLDivElement>(null)
  const id = useRef<string | null>(null)
  const cb = useRef(onToken)
  cb.current = onToken

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (id.current && window.turnstile) window.turnstile.reset(id.current)
      cb.current(null)
    }
  }))

  useEffect(() => {
    let alive = true
    loadTurnstile()
      .then(api => {
        if (!alive || !el.current) return
        id.current = api.render(el.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => {
            cb.current(null)
            onError?.()
          }
        })
      })
      .catch(() => onError?.())
    return () => {
      alive = false
      if (id.current && window.turnstile) window.turnstile.remove(id.current)
      id.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  return <div ref={el} data-testid="turnstile" />
})
Turnstile.displayName = 'Turnstile'
