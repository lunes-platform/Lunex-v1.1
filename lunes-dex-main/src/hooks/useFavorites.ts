import { useState, useEffect, useCallback } from 'react'
import { spotApi } from '../services/spotService'

const STORAGE_KEY = 'spot_favorites'

function readFromStorage(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : ['WLUNES/LUSDT']
  } catch {
    return ['WLUNES/LUSDT']
  }
}

function writeToStorage(favorites: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
}

/**
 * Shared favorites hook — localStorage + backend sync.
 *
 * - Always reads/writes localStorage for instant UX.
 * - When `walletAddress` is provided, syncs with spot-api backend.
 * - On connect: merges localStorage + backend, saves union to both.
 * - On toggle: updates both localStorage and backend in parallel.
 */
export function useFavorites(walletAddress: string | null) {
  const [favorites, setFavorites] = useState<string[]>(readFromStorage)

  // Sync with backend when wallet connects
  useEffect(() => {
    if (!walletAddress) return

    let cancelled = false

    const sync = async () => {
      try {
        const remote = await spotApi.getFavorites(walletAddress)
        if (cancelled) return

        const local = readFromStorage()
        const merged = Array.from(new Set([...local, ...remote]))

        // Push any local-only favorites to backend
        const toSync = merged.filter(s => !remote.includes(s))
        await Promise.all(
          toSync.map(s => spotApi.addFavorite(walletAddress, s).catch(() => {}))
        )

        setFavorites(merged)
        writeToStorage(merged)
      } catch {
        // Backend offline — continue with localStorage only
      }
    }

    sync()
    return () => { cancelled = true }
  }, [walletAddress])

  const isFavorite = useCallback(
    (symbol: string) => favorites.includes(symbol),
    [favorites]
  )

  const toggleFavorite = useCallback(
    (symbol: string) => {
      setFavorites(prev => {
        const next = prev.includes(symbol)
          ? prev.filter(s => s !== symbol)
          : [...prev, symbol]

        writeToStorage(next)

        // Sync with backend if wallet connected
        if (walletAddress) {
          if (prev.includes(symbol)) {
            spotApi.removeFavorite(walletAddress, symbol).catch(() => {})
          } else {
            spotApi.addFavorite(walletAddress, symbol).catch(() => {})
          }
        }

        return next
      })
    },
    [walletAddress]
  )

  return { favorites, isFavorite, toggleFavorite }
}
