import { useCallback, useState } from 'react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import socialApi, {
  buildCopytradeDepositMessage,
  buildCopytradeWithdrawMessage,
  createSignedActionMetadata,
  CopytradeActivityItem,
  CopytradePosition
} from '../../services/socialService'
import {
  ReadSessionRequiredError,
  requireReadAuth
} from '../../services/sessionService'

const fmtAmt = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  })

/**
 * Follower positions + activity. Both are private reads served with the
 * one-signature read session (no wallet prompt). Without a session, `load`
 * sets `needsSignIn` so the page can show the "Sign in" fallback.
 */
export const useCopyPositions = () => {
  const [positions, setPositions] = useState<CopytradePosition[]>([])
  const [activity, setActivity] = useState<CopytradeActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const load = useCallback(
    async (address: string, opts: { withActivity?: boolean } = {}) => {
      setLoading(true)
      setError('')
      try {
        const auth = requireReadAuth(address)
        setNeedsSignIn(false)
        const nextPositions = await socialApi.getPositions(address, auth)
        setPositions(nextPositions)

        if (opts.withActivity) {
          const nextActivity = await socialApi.getActivity(address, auth, 20)
          setActivity(nextActivity)
        }
        setLoadedFor(address)
      } catch (err: unknown) {
        if (err instanceof ReadSessionRequiredError) {
          setNeedsSignIn(true)
          return
        }
        setError(
          err instanceof Error ? err.message : 'Could not load your positions'
        )
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const reset = useCallback(() => {
    setPositions([])
    setActivity([])
    setLoadedFor(null)
    setError('')
  }, [])

  return {
    positions,
    activity,
    loading,
    loadedFor,
    error,
    needsSignIn,
    load,
    reset
  }
}

/** Deposit into a leader's copy vault through the shared tx flow. */
export const useCopyDeposit = () => {
  const { walletAddress, signMessage } = useSDK()
  const tx = useTx()

  return useCallback(
    (input: {
      leaderId: string
      leaderName: string
      token: string
      amount: string
      onSuccess?: () => void
    }) => {
      if (!walletAddress) return
      const follower = walletAddress
      let signature = ''
      let auth = createSignedActionMetadata()
      const amountLabel = `${fmtAmt(Number(input.amount))} ${input.token}`
      tx.run({
        type: 'social',
        title: 'Starting copy',
        summary: `${input.leaderName} · ${amountLabel}`,
        actTitle: `Copy ${input.leaderName} · ${amountLabel}`,
        successTitle: 'Copying started',
        // No allowance step: vault deposits are authorised by the signed
        // wallet action below (approval steps only show when one is missing).
        steps: [
          {
            label: 'Sign deposit in your wallet',
            wallet: true,
            run: async () => {
              auth = createSignedActionMetadata()
              signature = await signMessage(
                buildCopytradeDepositMessage({
                  leaderId: input.leaderId,
                  followerAddress: follower,
                  token: input.token,
                  amount: input.amount,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp
                })
              )
              return true
            }
          },
          {
            label: 'Waiting for block confirmation',
            run: async () => {
              const res = await socialApi.depositToVault(input.leaderId, {
                followerAddress: follower,
                token: input.token,
                amount: input.amount,
                nonce: auth.nonce,
                timestamp: auth.timestamp,
                signature
              })
              return res.txHash || true
            }
          }
        ],
        onSuccess: input.onSuccess
      })
    },
    [walletAddress, signMessage, tx]
  )
}

/** Withdraw shares from a copy vault through the shared tx flow. */
export const useCopyWithdraw = () => {
  const { signMessage } = useSDK()
  const tx = useTx()

  return useCallback(
    (
      position: CopytradePosition,
      shares: string,
      onSuccess?: () => void,
      opts: { stop?: boolean } = {}
    ) => {
      let signature = ''
      let auth = createSignedActionMetadata()
      const name = position.vault.leaderName || position.vault.name
      const pct =
        position.shareBalance > 0 ? Number(shares) / position.shareBalance : 1
      const valueLabel = `${fmtAmt(position.currentValue * Math.min(1, pct))} ${
        position.vault.collateralToken
      }`
      tx.run({
        type: 'social',
        title: opts.stop ? 'Stopping copy' : 'Withdrawing',
        summary: `${name} Vault · ≈${valueLabel}`,
        actTitle: `${opts.stop ? 'Stop copying' : 'Withdraw'} ${name} Vault`,
        successTitle: opts.stop ? 'Stopped copying' : 'Withdrawn',
        steps: [
          {
            label: 'Sign withdrawal in your wallet',
            wallet: true,
            run: async () => {
              auth = createSignedActionMetadata()
              signature = await signMessage(
                buildCopytradeWithdrawMessage({
                  leaderId: position.vault.leaderId,
                  followerAddress: position.followerAddress,
                  shares,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp
                })
              )
              return true
            }
          },
          {
            label: 'Waiting for block confirmation',
            run: async () => {
              const res = await socialApi.withdrawFromVault(
                position.vault.leaderId,
                {
                  followerAddress: position.followerAddress,
                  shares,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp,
                  signature
                }
              )
              return res.txHash || true
            }
          }
        ],
        onSuccess
      })
    },
    [signMessage, tx]
  )
}
