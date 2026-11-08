/**
 * One-signature read sessions.
 *
 * The wallet signs `auth.session` ONCE (on connect, or when the user clicks
 * "Sign in"), and spot-api returns an 8h read-only bearer token. Private
 * reads (orders, trades, rewards, affiliates, copytrade positions, …) send
 * that token instead of prompting the wallet again.
 *
 * Every write (orders, cancels, deposits, withdrawals, votes, profile
 * updates, …) keeps requiring its own wallet signature — the token is never
 * accepted by those endpoints.
 */
import {
  buildWalletActionMessage,
  createSignedActionMetadata,
  signedAuthHeaders
} from '../utils/signing'

const SPOT_API_URL =
  process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

const STORAGE_PREFIX = 'lunex_read_session:'
/** Refresh a little before the server-side expiry. */
const EXPIRY_SKEW_MS = 60_000

type SignMessage = (message: string) => Promise<string>

type StoredSession = {
  token: string
  expiresAt: number
}

/** Per-request signed-read auth (legacy) — still accepted by spot-api. */
export interface SignedReadAuth {
  nonce: string
  timestamp: number
  signature: string
}

/** Session-based read auth. */
export interface SessionReadAuth {
  sessionToken: string
}

export type ReadAuth = SignedReadAuth | SessionReadAuth

export class ReadSessionRequiredError extends Error {
  constructor(message = 'Sign in to view your private data') {
    super(message)
    this.name = 'ReadSessionRequiredError'
  }
}

const memory = new Map<string, StoredSession>()
const inFlight = new Map<string, Promise<string>>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(listener => {
    try {
      listener()
    } catch {
      // listeners must not break session bookkeeping
    }
  })
}

function storageKey(address: string) {
  return `${STORAGE_PREFIX}${address}`
}

function readStored(address: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(address))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.expiresAt === 'number'
    ) {
      return { token: parsed.token, expiresAt: parsed.expiresAt }
    }
  } catch {
    // storage unavailable or corrupted — fall through
  }
  return null
}

function writeStored(address: string, session: StoredSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(storageKey(address), JSON.stringify(session))
    } else {
      sessionStorage.removeItem(storageKey(address))
    }
  } catch {
    // storage unavailable — memory cache still works
  }
}

function isFresh(session: StoredSession | null | undefined) {
  return Boolean(session && session.expiresAt - EXPIRY_SKEW_MS > Date.now())
}

/** Cached, non-expired token for `address`, or null. Never prompts. */
export function getReadSessionToken(address: string | null | undefined) {
  if (!address) return null
  let session = memory.get(address) ?? null
  if (!session) {
    session = readStored(address)
    if (session) memory.set(address, session)
  }
  if (!isFresh(session)) {
    if (session) {
      memory.delete(address)
      writeStored(address, null)
    }
    return null
  }
  return session ? session.token : null
}

export function hasReadSession(address: string | null | undefined) {
  return getReadSessionToken(address) !== null
}

export function subscribeReadSession(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Returns a valid read-session token for `address`, asking the wallet for a
 * single `auth.session` signature only when no fresh token is cached.
 * Concurrent calls share one in-flight request (one wallet prompt).
 */
export async function ensureReadSession(
  address: string,
  signMessage: SignMessage
): Promise<string> {
  const cached = getReadSessionToken(address)
  if (cached) return cached

  const pending = inFlight.get(address)
  if (pending) return pending

  const request = (async () => {
    const { nonce, timestamp } = createSignedActionMetadata()
    const signature = await signMessage(
      buildWalletActionMessage({
        action: 'auth.session',
        address,
        nonce,
        timestamp
      })
    )
    const res = await fetch(`${SPOT_API_URL}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, nonce, timestamp, signature })
    })
    const data = (await res.json().catch(() => ({}))) as {
      token?: string
      expiresAt?: number
      error?: string
    }
    if (!res.ok || !data.token || typeof data.expiresAt !== 'number') {
      throw new Error(data.error || 'Could not start a read session')
    }
    const session = { token: data.token, expiresAt: data.expiresAt }
    memory.set(address, session)
    writeStored(address, session)
    notify()
    return session.token
  })()

  inFlight.set(address, request)
  try {
    return await request
  } finally {
    inFlight.delete(address)
  }
}

/**
 * Forget the cached session for `address` (or every address). With
 * `revoke`, the token is also revoked server-side (best effort).
 */
export async function clearReadSession(
  address?: string | null,
  options: { revoke?: boolean } = {}
) {
  const addresses = address
    ? [address]
    : Array.from(
        new Set([
          ...Array.from(memory.keys()),
          ...(() => {
            try {
              return Object.keys(sessionStorage)
                .filter(key => key.startsWith(STORAGE_PREFIX))
                .map(key => key.slice(STORAGE_PREFIX.length))
            } catch {
              return [] as string[]
            }
          })()
        ])
      )

  const tokens: string[] = []
  for (const addr of addresses) {
    const session = memory.get(addr) ?? readStored(addr)
    if (session && isFresh(session)) tokens.push(session.token)
    memory.delete(addr)
    writeStored(addr, null)
  }
  if (addresses.length > 0) notify()

  if (options.revoke) {
    await Promise.all(
      tokens.map(token =>
        fetch(`${SPOT_API_URL}/api/v1/auth/session/revoke`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => undefined)
      )
    )
  }
}

/** `Authorization` header for the cached session of `address` (or `{}`). */
export function authHeaders(
  address: string | null | undefined
): Record<string, string> {
  const token = getReadSessionToken(address)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Read auth for `address` without prompting. Throws
 * `ReadSessionRequiredError` when there is no session — the UI should then
 * show a "Sign in" button that calls `ensureReadSession`.
 */
export function requireReadAuth(address: string): SessionReadAuth {
  const token = getReadSessionToken(address)
  if (!token) throw new ReadSessionRequiredError()
  return { sessionToken: token }
}

/**
 * Headers for a read auth: `Authorization` for a session token, the
 * `X-Lunex-*` signature headers for a legacy signed read. Signatures never go
 * in the URL (it leaks into proxy/access logs and browser history).
 */
export function readAuthHeaders(auth: ReadAuth): Record<string, string> {
  return 'sessionToken' in auth
    ? { Authorization: `Bearer ${auth.sessionToken}` }
    : (signedAuthHeaders(auth) as Record<string, string>)
}

const SESSION_ERRORS = [
  'Invalid or expired session',
  'Session not valid for this address'
]

/**
 * Call with an API error message: when the server rejected the session
 * (revoked / expired / server secret rotated) the cached token is dropped so
 * the UI falls back to "Sign in". Returns the error to rethrow.
 */
export function handleReadAuthError(message: string | undefined): Error {
  if (message && SESSION_ERRORS.includes(message)) {
    void clearReadSession()
    return new ReadSessionRequiredError()
  }
  return new Error(message || 'API error')
}

/**
 * fetch() for a private read using the cached session of `address`.
 * Throws `ReadSessionRequiredError` when there is no (valid) session.
 */
export async function readSessionFetch<T>(
  address: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const auth = requireReadAuth(address)
  const res = await fetch(`${SPOT_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
      ...readAuthHeaders(auth)
    }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw handleReadAuthError((data as { error?: string }).error)
  return data as T
}

export type MyOrdersStatus =
  'PENDING_TRIGGER' | 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'

/**
 * Polling-friendly read of the connected wallet's orders using the read
 * session (never prompts the wallet). Omit `status` to get the most recent
 * orders in every status (newest first) — handy for detecting OPEN/PARTIAL ->
 * FILLED transitions. Throws `ReadSessionRequiredError` when the user has not
 * signed in.
 */
export async function fetchMyOrders<TOrder = unknown>(
  address: string,
  options: { status?: MyOrdersStatus; limit?: number; offset?: number } = {}
): Promise<TOrder[]> {
  const params = new URLSearchParams({
    makerAddress: address,
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0)
  })
  if (options.status) params.set('status', options.status)
  const data = await readSessionFetch<{ orders: TOrder[] }>(
    address,
    `/api/v1/orders?${params.toString()}`
  )
  return data.orders
}
