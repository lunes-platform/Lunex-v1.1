/**
 * Client error telemetry + beta feedback (P0-10).
 *
 * The production build strips `console.*`, so without this nothing that goes
 * wrong in a tester's browser would ever reach us. Two sinks:
 *
 *  1. Self-hosted (always on): POST spot-api `/api/v1/telemetry/client-errors`
 *     — deduplicated per fingerprint and globally throttled.
 *  2. Sentry (optional): lazy-loaded only when REACT_APP_SENTRY_DSN is set,
 *     with tracing disabled and every event scrubbed.
 *
 * Privacy: wallet addresses are replaced by a short non-reversible tag
 * (`addr_xxxxxxxx`), 0x-hex blobs ≥ 64 chars (signatures, tx data) and
 * session/bearer tokens are redacted. Feedback is anonymous; the wallet is
 * only sent when the tester ticks the box.
 */
import { SPOT_API_URL } from '../config/api'
import { NETWORK } from '../config/contracts'

export type ErrorSource = 'boundary' | 'window' | 'unhandledrejection' | 'manual'

export const APP_VERSION: string = process.env.REACT_APP_VERSION || 'dev'

// ─── Scrubbing ───────────────────────────────────────────────────

const SS58_RE = /\b[1-9A-HJ-NP-Za-km-z]{47,48}\b/g
const LONG_HEX_RE = /0x[0-9a-fA-F]{64,}/g
const TOKEN_RE = /\b(lxs1\.[A-Za-z0-9._-]+|Bearer\s+[A-Za-z0-9._~+/=-]+)/g
const SECRET_PARAM_RE = /([?&](?:signature|nonce|token|session|sig)=)[^&#\s]+/gi

/** FNV-1a 32-bit — stable, short, non-reversible tag for an address. */
export const hashAddress = (addr: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < addr.length; i++) {
    h ^= addr.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 'addr_' + h.toString(16).padStart(8, '0')
}

export const scrubText = (s: string): string =>
  String(s)
    .replace(TOKEN_RE, '[token]')
    .replace(SECRET_PARAM_RE, '$1[redacted]')
    .replace(LONG_HEX_RE, '[hex]')
    .replace(SS58_RE, m => hashAddress(m))

/** Deep-scrub every string of a (Sentry) event, bounded in depth/size. */
export const scrubDeep = <T>(value: T, depth = 0): T => {
  if (depth > 8 || value == null) return value
  if (typeof value === 'string') return scrubText(value) as unknown as T
  if (Array.isArray(value))
    return value.slice(0, 200).map(v => scrubDeep(v, depth + 1)) as unknown as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/signature|secret|seed|mnemonic|password|token|authorization/i.test(k))
        continue
      out[k] = scrubDeep(v, depth + 1)
    }
    return out as T
  }
  return value
}

// ─── Error normalisation ─────────────────────────────────────────

const IGNORED = [
  /^Script error\.?$/i, // opaque cross-origin error, no information
  /ResizeObserver loop/i,
  /^Cancel(l)?ed$/i
]

type Normalized = { message: string; stack?: string }

export const normalizeError = (err: unknown): Normalized => {
  if (err instanceof Error)
    return { message: `${err.name}: ${err.message}`, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try {
    return { message: JSON.stringify(err).slice(0, 500) }
  } catch {
    return { message: String(err) }
  }
}

const firstFrame = (stack?: string) =>
  (stack || '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('at ') || l.includes('@')) || ''

const fingerprint = (source: ErrorSource, n: Normalized) =>
  `${source}|${n.message.replace(/\d+/g, '0').slice(0, 200)}|${firstFrame(n.stack).replace(/:\d+:\d+/g, '')}`

// ─── Reporter ────────────────────────────────────────────────────

export type TelemetryOptions = {
  endpoint?: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** Same fingerprint is sent at most once per window; repeats are counted. */
  dedupWindowMs?: number
  /** Global cap of reports per minute (protects the API from error storms). */
  maxPerMinute?: number
  appVersion?: string
  network?: string
  page?: () => string
}

export type Reporter = {
  report: (err: unknown, source?: ErrorSource) => boolean
  stats: () => { sent: number; suppressed: number; dropped: number }
}

export const createReporter = (opts: TelemetryOptions = {}): Reporter => {
  const endpoint =
    opts.endpoint ?? `${SPOT_API_URL}/api/v1/telemetry/client-errors`
  const now = opts.now ?? Date.now
  const dedupMs = opts.dedupWindowMs ?? 60_000
  const maxPerMinute = opts.maxPerMinute ?? 10
  const seen = new Map<string, { at: number; pending: number }>()
  let windowStart = 0
  let inWindow = 0
  let sent = 0
  let suppressed = 0
  let dropped = 0

  const send = (source: ErrorSource, n: Normalized, count: number) => {
    const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
    if (!f) return
    const body = {
      source,
      message: scrubText(n.message).slice(0, 1000),
      stack: n.stack ? scrubText(n.stack).slice(0, 4000) : undefined,
      count,
      page: scrubText(opts.page ? opts.page() : safePath()).slice(0, 300),
      userAgent:
        typeof navigator !== 'undefined'
          ? navigator.userAgent.slice(0, 300)
          : undefined,
      appVersion: opts.appVersion ?? APP_VERSION,
      network: opts.network ?? NETWORK.name
    }
    try {
      Promise.resolve(
        f(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true
        })
      ).catch(() => undefined)
    } catch {
      /* never let telemetry throw */
    }
  }

  const report = (err: unknown, source: ErrorSource = 'manual'): boolean => {
    const n = normalizeError(err)
    if (IGNORED.some(re => re.test(n.message))) return false
    const key = fingerprint(source, n)
    const t = now()
    const prev = seen.get(key)
    if (prev && t - prev.at < dedupMs) {
      prev.pending++
      suppressed++
      return false
    }
    if (t - windowStart >= 60_000) {
      windowStart = t
      inWindow = 0
    }
    if (inWindow >= maxPerMinute) {
      dropped++
      return false
    }
    inWindow++
    const count = 1 + (prev?.pending ?? 0)
    seen.set(key, { at: t, pending: 0 })
    if (seen.size > 500) seen.delete(seen.keys().next().value as string)
    sent++
    send(source, n, count)
    sentryCapture(err)
    return true
  }

  return { report, stats: () => ({ sent, suppressed, dropped }) }
}

const safePath = () => {
  try {
    return window.location.pathname
  } catch {
    return ''
  }
}

// ─── Sentry (optional, lazy) ─────────────────────────────────────

type SentryLike = { captureException: (e: unknown) => unknown }
let sentry: SentryLike | null = null

const sentryCapture = (err: unknown) => {
  try {
    sentry?.captureException(err)
  } catch {
    /* noop */
  }
}

/** Loads @sentry/react only when a DSN is configured. No PII, no tracing. */
export const initSentry = async (dsn?: string): Promise<boolean> => {
  if (!dsn || sentry) return Boolean(sentry)
  try {
    const S = await import('@sentry/react')
    S.init({
      dsn,
      release: APP_VERSION,
      environment: NETWORK.name,
      tracesSampleRate: 0, // no performance tracing; PII off by default (no sendDefaultPii)
      // Our own window handlers already report (deduplicated) to Sentry.
      integrations: defaults =>
        defaults.filter(i => i.name !== 'GlobalHandlers'),
      beforeSend: event => {
        const e = scrubDeep(event)
        delete e.user
        return e
      },
      beforeBreadcrumb: crumb =>
        crumb.category === 'console' ? null : scrubDeep(crumb)
    })
    sentry = S
    return true
  } catch {
    return false
  }
}

// ─── Global wiring ───────────────────────────────────────────────

let globalReporter: Reporter | null = null

export const getReporter = (): Reporter => {
  if (!globalReporter) globalReporter = createReporter()
  return globalReporter
}

/** Report an error from app code (ErrorBoundary, catch blocks). */
export const reportError = (err: unknown, source: ErrorSource = 'manual') =>
  getReporter().report(err, source)

let installed = false

/** Installs window error / unhandledrejection reporting once. */
export const initTelemetry = (): void => {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', ev => {
    // Resource load errors (img/script) have no `error` and are not bugs.
    if (!ev.error && !ev.message) return
    reportError(ev.error ?? ev.message, 'window')
  })
  window.addEventListener('unhandledrejection', ev => {
    reportError(ev.reason, 'unhandledrejection')
  })
  void initSentry(process.env.REACT_APP_SENTRY_DSN)
}

// ─── Feedback ────────────────────────────────────────────────────

export const FEEDBACK_CATEGORIES = [
  { value: 'BUG', label: 'Bug' },
  { value: 'UX', label: 'Usability / UX' },
  { value: 'FEATURE', label: 'Feature request' },
  { value: 'FAUCET', label: 'Faucet / test tokens' },
  { value: 'OTHER', label: 'Other' }
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]['value']

export type FeedbackInput = {
  category: FeedbackCategory
  message: string
  walletAddress?: string
  txHash?: string
}

export const FEEDBACK_MIN = 5
export const FEEDBACK_MAX = 4000

export const submitFeedback = async (
  input: FeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
  const message = input.message.trim()
  if (message.length < FEEDBACK_MIN)
    return { ok: false, error: `Please write at least ${FEEDBACK_MIN} characters.` }
  if (message.length > FEEDBACK_MAX)
    return { ok: false, error: `Please keep it under ${FEEDBACK_MAX} characters.` }
  const body = {
    category: input.category,
    message,
    walletAddress: input.walletAddress || undefined,
    txHash: input.txHash || undefined,
    page: safePath().slice(0, 300),
    userAgent:
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 300)
        : undefined,
    appVersion: APP_VERSION,
    network: NETWORK.name
  }
  try {
    const res = await fetchImpl(`${SPOT_API_URL}/api/v1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.status === 429)
      return { ok: false, error: 'Too many reports from your network. Please try again later.' }
    if (!res.ok) return { ok: false, error: 'Could not send your report. Please try again.' }
    const data = (await res.json()) as { id?: string }
    return { ok: true, id: String(data.id ?? '') }
  } catch {
    return { ok: false, error: 'Network error. Please try again.' }
  }
}
