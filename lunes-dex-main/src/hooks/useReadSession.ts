import { useCallback, useEffect, useState } from 'react'
import { useSDK } from '../context/SDKContext'
import {
  ensureReadSession,
  hasReadSession,
  subscribeReadSession
} from '../services/sessionService'

/**
 * Read-session state for the connected wallet. `hasSession` flips (and the
 * component re-renders) whenever a session is created, expires server-side
 * or is cleared. `signIn` asks the wallet for the single `auth.session`
 * signature — call it ONLY from an explicit user action.
 */
export function useReadSession() {
  const { walletAddress, signMessage } = useSDK()
  const [version, setVersion] = useState(0)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeReadSession(() => setVersion(v => v + 1)), [])

  const signIn = useCallback(async () => {
    if (!walletAddress) return false
    setSigningIn(true)
    setError(null)
    try {
      await ensureReadSession(walletAddress, signMessage)
      return true
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      return false
    } finally {
      setSigningIn(false)
    }
  }, [walletAddress, signMessage])

  return {
    address: walletAddress,
    hasSession: hasReadSession(walletAddress),
    /** Changes whenever the session state changes — use as an effect dep. */
    sessionVersion: version,
    signIn,
    signingIn,
    error
  }
}
