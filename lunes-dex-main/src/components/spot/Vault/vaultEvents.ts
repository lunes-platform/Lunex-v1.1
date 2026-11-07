/**
 * Tiny in-page bus: after a vault deposit/withdraw (or an order that changes
 * reservations) every balance reader re-fetches GET /api/v1/balances.
 */
const listeners = new Set<() => void>()

export function notifyVaultChanged(): void {
  listeners.forEach(l => l())
}

export function subscribeVaultChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
