import { useState, useEffect, useCallback } from 'react'
import { spotApi } from '../services/spotService'
import { useSDK } from '../context/SDKContext'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../utils/signing'

const STORAGE_KEY = 'spot_favorites'
const READ_SIGNATURE_TTL_MS = 4 * 60 * 1000
const readSignatureCache = new Map<
  string,
  { nonce: string; timestamp: number; signature: string; expiresAt: number }
>()

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
  const { signMessage } = useSDK()
  const [favorites, setFavorites] = useState<string[]>(readFromStorage)

  const signFavoriteAction = useCallback(
    async (
      action: string,
      fields?: Record<string, string>,
      allowCache = false
    ) => {
      if (!walletAddress) {
        throw new Error('Wallet address required')
      }

      const cacheKey = `${action}:${walletAddress}:${JSON.stringify(fields ?? {})}`
      const cached = readSignatureCache.get(cacheKey)
      if (allowCache && cached && cached.expiresAt > Date.now()) {
        return {
          nonce: cached.nonce,
          timestamp: cached.timestamp,
          signature: cached.signature
        }
      }

      const metadata = createSignedActionMetadata()
      const signature = await signMessage(
        buildWalletActionMessage({
          action,
          address: walletAddress,
          nonce: metadata.nonce,
          timestamp: metadata.timestamp,
          fields
        })
      )

      const auth = { ...metadata, signature }
      if (allowCache) {
        readSignatureCache.set(cacheKey, {
          ...auth,
          expiresAt: Date.now() + READ_SIGNATURE_TTL_MS
        })
      }
      return auth
    },
    [signMessage, walletAddress]
  )

  // Sync with backend when wallet connects
  useEffect(() => {
    if (!walletAddress) return

    let cancelled = false

    const sync = async () => {
      try {
        const auth = await signFavoriteAction('favorites.list', undefined, true)
        const remote = await spotApi.getFavorites(walletAddress, auth)
        if (cancelled) return

        const local = readFromStorage()
        const merged = Array.from(new Set([...local, ...remote]))

        setFavorites(merged)
        writeToStorage(merged)
      } catch {
        // Backend offline — continue with localStorage only
      }
    }

    sync()
    return () => {
      cancelled = true
    }
  }, [signFavoriteAction, walletAddress])

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
          void (async () => {
            try {
              if (prev.includes(symbol)) {
                const auth = await signFavoriteAction('favorites.remove', {
                  pairSymbol: symbol
                })
                await spotApi.removeFavorite(walletAddress, symbol, auth)
              } else {
                const auth = await signFavoriteAction('favorites.add', {
                  pairSymbol: symbol
                })
                await spotApi.addFavorite(walletAddress, symbol, auth)
              }
            } catch {
              // Keep localStorage as fallback if remote sync fails
            }
          })()
        }

        return next
      })
    },
    [signFavoriteAction, walletAddress]
  )

  return { favorites, isFavorite, toggleFavorite }
}
