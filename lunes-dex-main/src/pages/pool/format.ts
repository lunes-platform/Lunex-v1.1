/** Display formatters shared by the pools, liquidity and asymmetric pages. */

export const usd = (n: number): string => {
  if (!isFinite(n)) return '$0.00'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

export const usdFull = (n: number): string =>
  '$' +
  (isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

export const fmt = (n: number): string => {
  if (!isFinite(n) || n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

/** Raw integer units → human number. */
export const fromUnits = (raw: string | bigint, decimals: number): number => {
  try {
    return Number(BigInt(raw)) / Math.pow(10, decimals)
  } catch {
    return 0
  }
}

/** Keep only digits and one dot (amount inputs). */
export const cleanAmount = (v: string): string => {
  const s = v.replace(',', '.').replace(/[^\d.]/g, '')
  const [i, ...rest] = s.split('.')
  return rest.length ? `${i}.${rest.join('')}` : i
}
