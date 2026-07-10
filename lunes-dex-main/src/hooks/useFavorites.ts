import { useState, useCallback } from 'react'
import { spotApi } from '../services/spotService'
import { useSDK } from '../context/SDKContext'
import {
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../utils/signing'

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
 * Shared favorites hook — localStorage first, backend sync only on user action.
 *
 * Signed reads consume wallet nonces and open wallet prompts. Do not sync the
 * remote list on mount/remount; route changes and tab navigation must stay
 * read-only from the wallet's perspective.
 */
export function useFavorites(walletAddress: string | null) {
  const { signMessage } = useSDK()
  const [favorites, setFavorites] = useState<string[]>(readFromStorage)

  const signFavoriteAction = useCallback(
    async (action: string, fields?: Record<string, string>) => {
      if (!walletAddress) {
        throw new Error('Wallet address required')
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

      return { ...metadata, signature }
    },
    [signMessage, walletAddress]
  )

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
