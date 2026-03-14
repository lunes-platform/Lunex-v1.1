/**
 * Token Logo Resolver
 *
 * Resolution order:
 *   1. In-memory cache
 *   2. /tokens/{address}.{svg,png,webp} (backend static)
 *   3. Jdenticon fallback (deterministic identicon)
 */

const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

// In-memory cache: address → logo URL or data URI
const logoCache = new Map<string, string>()

const KNOWN_LOGOS: Record<string, string> = {
  LUNES: '/img/lunes-logo.svg',
  WLUNES: '/img/lunes-logo.svg',
  LUSDT: '/img/lusdt.svg',
  GMC: '/img/gmc.svg',
  LETH: '/img/leth.svg',
  LBTC: '/img/lbtc.svg',
}

/**
 * Generate a simple deterministic identicon as SVG data URI
 */
function generateIdenticon(address: string): string {
  const hash = Array.from(address).reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hue = hash % 360
  const saturation = 60 + (hash % 20)
  const lightness = 45 + (hash % 15)
  const bgColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`

  // Generate a simple 5x5 symmetric grid pattern
  const grid: boolean[][] = []
  for (let y = 0; y < 5; y++) {
    grid[y] = []
    for (let x = 0; x < 3; x++) {
      const charCode = address.charCodeAt((y * 3 + x) % address.length) || 0
      grid[y][x] = charCode % 2 === 0
      grid[y][4 - x] = grid[y][x] // mirror
    }
  }

  let rects = ''
  const cellSize = 50
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (grid[y][x]) {
        rects += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${bgColor}"/>`
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250"><rect width="250" height="250" fill="#1a1a1a"/>${rects}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Get the logo URL for a token address.
 * Returns immediately with cached value or fallback identicon.
 */
export function getTokenLogo(address: string, symbol?: string): string {
  if (!address) return generateIdenticon('unknown')

  // Check known logos by symbol
  if (symbol && KNOWN_LOGOS[symbol.toUpperCase()]) {
    return KNOWN_LOGOS[symbol.toUpperCase()]
  }

  // Check cache
  const cached = logoCache.get(address)
  if (cached) return cached

  // Try backend URL (will 404 → browser fallback handled by TokenIcon)
  const url = `${API_BASE}/tokens/${address}.png`
  // Optimistically cache and probe
  logoCache.set(address, url)

  // Background probe: check if the image exists
  const img = new Image()
  img.onload = () => {
    logoCache.set(address, url)
  }
  img.onerror = () => {
    // Try SVG
    const svgUrl = `${API_BASE}/tokens/${address}.svg`
    const img2 = new Image()
    img2.onload = () => {
      logoCache.set(address, svgUrl)
    }
    img2.onerror = () => {
      // Fallback to identicon
      logoCache.set(address, generateIdenticon(address))
    }
    img2.src = svgUrl
  }
  img.src = url

  return url
}

/**
 * Preload registry tokens from API to warm the cache.
 */
export async function preloadTokenLogos(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/tokens`)
    if (!res.ok) return
    const data = await res.json()
    for (const token of data.tokens ?? []) {
      if (token.logoURI) {
        const url = token.logoURI.startsWith('http')
          ? token.logoURI
          : `${API_BASE}${token.logoURI}`
        logoCache.set(token.address, url)
      }
    }
  } catch {
    // Silent — non-critical
  }
}

export { generateIdenticon }
