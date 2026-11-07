/**
 * Client for the testnet faucet service (`faucet/`): GET /faucet/config and
 * POST /faucet. The faucet itself enforces captcha + cooldowns; nothing here
 * is a security boundary.
 */

export const FAUCET_URL = (process.env.REACT_APP_FAUCET_URL || '').replace(/\/+$/, '')
export const TURNSTILE_SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY || ''

export type FaucetConfig = {
  network: string
  native: { symbol: string; amount: string }
  tokens: { symbol: string; address: string; amount: string }[]
  cooldownMinutes: number
  ipMaxPerWindow: number
  ipWindowMinutes: number
  captcha: { required: boolean; provider: string; siteKey: string | null }
}

export type DripResult =
  | { kind: 'success'; sent: { symbol: string; amount: string }[]; skipped: { symbol: string }[]; blockHash: string }
  | { kind: 'pending'; txHash?: string; message: string }
  | { kind: 'error'; code?: string; message: string; retryAfterMs?: number }

const SS58 = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/
export const looksLikeLunesAddress = (a: string) => SS58.test(a.trim())

export const fetchFaucetConfig = async (
  base = FAUCET_URL,
  fetchImpl: typeof fetch = fetch
): Promise<FaucetConfig | null> => {
  if (!base) return null
  try {
    const res = await fetchImpl(`${base}/faucet/config`)
    if (!res.ok) return null
    return (await res.json()) as FaucetConfig
  } catch {
    return null
  }
}

export const requestDrip = async (
  input: { address: string; captchaToken?: string },
  base = FAUCET_URL,
  fetchImpl: typeof fetch = fetch
): Promise<DripResult> => {
  if (!base) return { kind: 'error', code: 'NOT_CONFIGURED', message: 'Faucet is not configured for this deployment.' }
  const address = input.address.trim()
  if (!looksLikeLunesAddress(address))
    return { kind: 'error', code: 'INVALID_ADDRESS', message: 'Enter a valid Lunes address (starts with 5…).' }
  try {
    const res = await fetchImpl(`${base}/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, captchaToken: input.captchaToken })
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (res.status === 200 && data.success)
      return { kind: 'success', sent: data.sent ?? [], skipped: data.skipped ?? [], blockHash: String(data.blockHash ?? '') }
    if (res.status === 202)
      return { kind: 'pending', txHash: data.txHash, message: data.error || 'Submitted, waiting for finalization.' }
    return {
      kind: 'error',
      code: data.code,
      message: data.error || `Faucet error (HTTP ${res.status}).`,
      retryAfterMs: typeof data.retryAfterMs === 'number' ? data.retryAfterMs : undefined
    }
  } catch {
    return { kind: 'error', code: 'NETWORK', message: 'Could not reach the faucet. Try again later.' }
  }
}
