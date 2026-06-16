export function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M'
  if (vol >= 1_000) return (vol / 1_000).toFixed(0) + 'K'
  return vol.toFixed(0)
}

export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(5)
  return price.toFixed(8)
}
