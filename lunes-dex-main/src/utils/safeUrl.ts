/**
 * URL guards for user-controlled data rendered into `href` / `src` (FE-01).
 *
 * React 18 does not block `javascript:` URLs, so every URL that comes from
 * the API (social links, avatars, listing logos, …) goes through one of these
 * before reaching the DOM. Both return `undefined` when the value is unsafe so
 * callers can simply skip rendering the link / image.
 */

/** `rel` for every `target="_blank"` link to an external / user-supplied URL. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer'

type UrlGuardOptions = {
  /** Allow plain `http:`. Defaults to true only in the Vite dev server. */
  allowHttp?: boolean
}

const devAllowsHttp = (): boolean => {
  try {
    return import.meta.env.DEV === true
  } catch {
    return false
  }
}

const hostAllowed = (hostname: string, hosts: readonly string[]): boolean =>
  hosts.some(h => hostname === h || hostname.endsWith(`.${h}`))

/**
 * External link guard: absolute `https:` URL (or `http:` in dev), no embedded
 * credentials, optionally pinned to a host allowlist (exact host or
 * subdomain). Returns the normalized href, or `undefined`.
 */
export const safeExternalUrl = (
  raw: string | null | undefined,
  hosts?: readonly string[],
  options: UrlGuardOptions = {}
): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!value) return undefined
  const allowHttp = options.allowHttp ?? devAllowsHttp()
  let url: URL
  try {
    // No base: relative and protocol-relative inputs throw → rejected.
    url = new URL(value)
  } catch {
    return undefined
  }
  const okProtocol =
    url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
  if (!okProtocol) return undefined
  if (url.username || url.password) return undefined
  if (hosts && !hostAllowed(url.hostname.toLowerCase(), hosts)) return undefined
  return url.href
}

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i

/**
 * Image source guard: `https:` (or `http:` in dev), same-origin absolute path
 * (`/img/…`, never `//host` or `/\host`), `data:image/*` or `blob:`.
 * Returns the trimmed value, or `undefined`.
 */
export const safeImageSrc = (
  raw: string | null | undefined,
  options: UrlGuardOptions = {}
): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!value) return undefined
  if (value.startsWith('/')) {
    return value[1] === '/' || value[1] === '\\' ? undefined : value
  }
  if (DATA_IMAGE.test(value)) return value
  if (value.toLowerCase().startsWith('blob:')) return value
  return safeExternalUrl(value, undefined, options) ? value : undefined
}
